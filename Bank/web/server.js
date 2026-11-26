'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'bank-db.json');
const SECRET_PATH = path.join(DATA_DIR, '.session-secret');

const MAX_SAFE_CENTS = 99999999999999; // $999,999,999,999.99 (matches DECIMAL(19,2) practical range)
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function getSessionSecret() {
  if (process.env.BANK_SESSION_SECRET) {
    return process.env.BANK_SESSION_SECRET;
  }
  ensureDataDir();
  if (fs.existsSync(SECRET_PATH)) {
    return fs.readFileSync(SECRET_PATH, 'utf8').trim();
  }
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_PATH, secret, { mode: 0o600 });
  return secret;
}

const SESSION_SECRET = getSessionSecret();

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, storedHash) {
  if (typeof password !== 'string' || typeof storedHash !== 'string') return false;
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expectedHex] = parts;
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = crypto.scryptSync(password, salt, 64);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

/**
 * Strictly parses positive decimal monetary amounts with at most 2 decimal places.
 * Mirrors AccountDAO.validAmount(BigDecimal) with RoundingMode.UNNECESSARY.
 */
function parseAmountToCents(input) {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    input = String(input);
  }
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) return null;

  const [wholePart, fracPart = ''] = trimmed.split('.');
  const normalized = wholePart + fracPart.padEnd(2, '0');
  const cents = Number(normalized);
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_SAFE_CENTS) {
    return null;
  }
  return cents;
}

function parseAccountNumber(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function createInitialDb() {
  const now = Date.now();
  const iso = (offsetMs) => new Date(now - offsetMs).toISOString();

  return {
    nextAccountNumber: 10010003,
    nextTransactionId: 50006,
    accounts: [
      {
        accountNumber: 10010001,
        customerName: 'Meridian Logistics Corp',
        passwordHash: hashPassword('Meridian@2026'),
        balanceCents: 12545000, // $125,450.00
        active: true,
        createdAt: iso(1000 * 60 * 60 * 24 * 45),
      },
      {
        accountNumber: 10010002,
        customerName: 'Apex Retail Holdings',
        passwordHash: hashPassword('Apex@2026'),
        balanceCents: 4892050, // $48,920.50
        active: true,
        createdAt: iso(1000 * 60 * 60 * 24 * 30),
      },
    ],
    transactions: [
      {
        transactionId: 50001,
        payerAccountNumber: null,
        receiverAccountNumber: 10010001,
        amountCents: 15000000,
        transactionType: 'Deposit',
        createdAt: iso(1000 * 60 * 60 * 24 * 20),
      },
      {
        transactionId: 50002,
        payerAccountNumber: null,
        receiverAccountNumber: 10010002,
        amountCents: 3500000,
        transactionType: 'Deposit',
        createdAt: iso(1000 * 60 * 60 * 24 * 16),
      },
      {
        transactionId: 50003,
        payerAccountNumber: 10010001,
        receiverAccountNumber: 10010002,
        amountCents: 1850000,
        transactionType: 'Transfer',
        createdAt: iso(1000 * 60 * 60 * 24 * 9),
      },
      {
        transactionId: 50004,
        payerAccountNumber: 10010001,
        receiverAccountNumber: null,
        amountCents: 605000,
        transactionType: 'Withdrawal',
        createdAt: iso(1000 * 60 * 60 * 24 * 4),
      },
      {
        transactionId: 50005,
        payerAccountNumber: 10010002,
        receiverAccountNumber: null,
        amountCents: 457950,
        transactionType: 'Withdrawal',
        createdAt: iso(1000 * 60 * 60 * 24 * 2),
      },
    ],
  };
}

function loadDb(dbPath = DB_PATH) {
  ensureDataDir();
  if (!fs.existsSync(dbPath)) {
    const initial = createInitialDb();
    saveDb(initial, dbPath);
    return initial;
  }
  return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
}

function saveDb(db, dbPath = DB_PATH) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${dbPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmpPath, dbPath);
}

function signSessionToken(accountNumber) {
  const payload = Buffer.from(
    JSON.stringify({ sub: accountNumber, exp: Date.now() + SESSION_TTL_MS })
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

function verifySessionToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed.sub !== 'number' || typeof parsed.exp !== 'number') {
      return null;
    }
    if (Date.now() > parsed.exp) return null;
    return parsed.sub;
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const result = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (key) result[key] = decodeURIComponent(val);
  }
  return result;
}

function sanitizeAccount(account) {
  return {
    accountNumber: account.accountNumber,
    customerName: account.customerName,
    balanceCents: account.balanceCents,
    active: account.active,
    createdAt: account.createdAt,
  };
}

function createBankApp(options = {}) {
  const dbPath = options.dbPath || DB_PATH;
  let db = loadDb(dbPath);
  let mutex = Promise.resolve();

  function withDbLock(fn) {
    const next = mutex.then(() => fn(), () => fn());
    mutex = next.catch(() => {});
    return next;
  }

  function findAccount(accountNumber) {
    return db.accounts.find((a) => a.accountNumber === accountNumber) || null;
  }

  function enrichTransaction(tx) {
    const payer = tx.payerAccountNumber ? findAccount(tx.payerAccountNumber) : null;
    const receiver = tx.receiverAccountNumber ? findAccount(tx.receiverAccountNumber) : null;
    return {
      ...tx,
      payerName: payer ? payer.customerName : null,
      receiverName: receiver ? receiver.customerName : null,
    };
  }

  function getAccountTransactions(accountNumber) {
    return db.transactions
      .filter(
        (tx) =>
          tx.payerAccountNumber === accountNumber ||
          tx.receiverAccountNumber === accountNumber
      )
      .sort((a, b) => b.transactionId - a.transactionId)
      .map(enrichTransaction);
  }

  function getAccountSummary(accountNumber) {
    const txs = db.transactions.filter(
      (tx) =>
        tx.payerAccountNumber === accountNumber ||
        tx.receiverAccountNumber === accountNumber
    );
    let totalInflowCents = 0;
    let totalOutflowCents = 0;
    for (const tx of txs) {
      if (tx.receiverAccountNumber === accountNumber) {
        totalInflowCents += tx.amountCents;
      }
      if (tx.payerAccountNumber === accountNumber) {
        totalOutflowCents += tx.amountCents;
      }
    }
    return {
      transactionCount: txs.length,
      totalInflowCents,
      totalOutflowCents,
    };
  }

  function readJsonBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > 64 * 1024) {
          reject(Object.assign(new Error('Payload too large'), { status: 413 }));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (chunks.length === 0) return resolve({});
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(Object.assign(new Error('Invalid JSON payload'), { status: 400 }));
        }
      });
      req.on('error', reject);
    });
  }

  function sendJson(res, status, data, extraHeaders = {}) {
    const body = JSON.stringify(data);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    });
    res.end(body);
  }

  function setSessionCookie(res, token) {
    const maxAge = Math.floor(SESSION_TTL_MS / 1000);
    return `meridian_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}`;
  }

  function clearSessionCookie() {
    return 'meridian_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0';
  }

  function getAuthenticatedAccount(req) {
    const cookies = parseCookies(req);
    const authHeader = req.headers.authorization;
    const bearer =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : null;
    const token = cookies.meridian_session || bearer;
    const accountNumber = verifySessionToken(token);
    if (!accountNumber) return null;
    const account = findAccount(accountNumber);
    if (!account || !account.active) return null;
    return account;
  }

  async function handleApi(req, res, urlObj) {
    const pathname = urlObj.pathname;
    const method = req.method;

    if (method === 'GET' && pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, mode: 'server', service: 'Meridian Commercial Bank API' });
    }

    if (method === 'POST' && pathname === '/api/auth/register') {
      const body = await readJsonBody(req);
      const customerName = typeof body.customerName === 'string' ? body.customerName.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';

      if (customerName.length < 2 || customerName.length > 80) {
        return sendJson(res, 400, { error: 'Account holder name must be between 2 and 80 characters.' });
      }
      if (password.length < 6 || password.length > 128) {
        return sendJson(res, 400, { error: 'Password must be at least 6 characters.' });
      }

      return withDbLock(() => {
        const account = {
          accountNumber: db.nextAccountNumber++,
          customerName,
          passwordHash: hashPassword(password),
          balanceCents: 0,
          active: true,
          createdAt: new Date().toISOString(),
        };
        db.accounts.push(account);
        saveDb(db, dbPath);

        const token = signSessionToken(account.accountNumber);
        return sendJson(
          res,
          201,
          { account: sanitizeAccount(account), summary: getAccountSummary(account.accountNumber) },
          { 'Set-Cookie': setSessionCookie(res, token) }
        );
      });
    }

    if (method === 'POST' && pathname === '/api/auth/login') {
      const body = await readJsonBody(req);
      const accountNumber = parseAccountNumber(body.accountNumber);
      const password = typeof body.password === 'string' ? body.password : '';

      if (!accountNumber || !password) {
        return sendJson(res, 400, { error: 'Valid account number and password are required.' });
      }

      const account = findAccount(accountNumber);
      if (!account || !account.active) {
        return sendJson(res, 401, { error: 'Account not found or inactive.' });
      }
      if (!verifyPassword(password, account.passwordHash)) {
        return sendJson(res, 401, { error: 'Incorrect password.' });
      }

      const token = signSessionToken(account.accountNumber);
      return sendJson(
        res,
        200,
        {
          account: sanitizeAccount(account),
          summary: getAccountSummary(account.accountNumber),
        },
        { 'Set-Cookie': setSessionCookie(res, token) }
      );
    }

    if (method === 'POST' && pathname === '/api/auth/logout') {
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
    }

    // Authenticated routes below
    const currentAccount = getAuthenticatedAccount(req);
    if (!currentAccount) {
      return sendJson(res, 401, { error: 'Authentication required.' });
    }

    if (method === 'GET' && pathname === '/api/account/me') {
      return sendJson(res, 200, {
        account: sanitizeAccount(currentAccount),
        summary: getAccountSummary(currentAccount.accountNumber),
      });
    }

    if (method === 'GET' && pathname === '/api/account/lookup') {
      const targetNo = parseAccountNumber(urlObj.searchParams.get('accountNumber'));
      if (!targetNo) {
        return sendJson(res, 400, { error: 'Enter a valid account number.' });
      }
      if (targetNo === currentAccount.accountNumber) {
        return sendJson(res, 400, { error: 'Cannot transfer to your own account.' });
      }
      const target = findAccount(targetNo);
      if (!target || !target.active) {
        return sendJson(res, 404, { error: 'Active recipient account not found.' });
      }
      return sendJson(res, 200, {
        accountNumber: target.accountNumber,
        customerName: target.customerName,
        active: target.active,
      });
    }

    if (method === 'GET' && pathname === '/api/transactions') {
      return sendJson(res, 200, {
        transactions: getAccountTransactions(currentAccount.accountNumber),
      });
    }

    if (method === 'POST' && pathname === '/api/transactions/deposit') {
      const body = await readJsonBody(req);
      const cents = parseAmountToCents(body.amount);
      if (!cents) {
        return sendJson(res, 400, {
          error: 'Enter a positive deposit amount with at most two decimal places.',
        });
      }

      return withDbLock(() => {
        const account = findAccount(currentAccount.accountNumber);
        if (!account || !account.active) {
          return sendJson(res, 403, { error: 'Account is inactive.' });
        }
        if (account.balanceCents + cents > MAX_SAFE_CENTS) {
          return sendJson(res, 400, { error: 'Amount exceeds maximum ledger capacity.' });
        }
        account.balanceCents += cents;
        const tx = {
          transactionId: db.nextTransactionId++,
          payerAccountNumber: null,
          receiverAccountNumber: account.accountNumber,
          amountCents: cents,
          transactionType: 'Deposit',
          createdAt: new Date().toISOString(),
        };
        db.transactions.push(tx);
        saveDb(db, dbPath);

        return sendJson(res, 200, {
          account: sanitizeAccount(account),
          summary: getAccountSummary(account.accountNumber),
          transaction: enrichTransaction(tx),
        });
      });
    }

    if (method === 'POST' && pathname === '/api/transactions/withdraw') {
      const body = await readJsonBody(req);
      const cents = parseAmountToCents(body.amount);
      if (!cents) {
        return sendJson(res, 400, {
          error: 'Enter a positive withdrawal amount with at most two decimal places.',
        });
      }

      return withDbLock(() => {
        const account = findAccount(currentAccount.accountNumber);
        if (!account || !account.active) {
          return sendJson(res, 403, { error: 'Account is inactive.' });
        }
        if (cents > account.balanceCents) {
          return sendJson(res, 400, { error: 'Insufficient available balance.' });
        }
        account.balanceCents -= cents;
        const tx = {
          transactionId: db.nextTransactionId++,
          payerAccountNumber: account.accountNumber,
          receiverAccountNumber: null,
          amountCents: cents,
          transactionType: 'Withdrawal',
          createdAt: new Date().toISOString(),
        };
        db.transactions.push(tx);
        saveDb(db, dbPath);

        return sendJson(res, 200, {
          account: sanitizeAccount(account),
          summary: getAccountSummary(account.accountNumber),
          transaction: enrichTransaction(tx),
        });
      });
    }

    if (method === 'POST' && pathname === '/api/transactions/transfer') {
      const body = await readJsonBody(req);
      const receiverNo = parseAccountNumber(body.receiverAccountNumber);
      const cents = parseAmountToCents(body.amount);

      if (!receiverNo) {
        return sendJson(res, 400, { error: 'Enter a valid recipient account number.' });
      }
      if (!cents) {
        return sendJson(res, 400, {
          error: 'Enter a positive transfer amount with at most two decimal places.',
        });
      }
      if (receiverNo === currentAccount.accountNumber) {
        return sendJson(res, 400, { error: 'Self-transfers are not permitted.' });
      }

      return withDbLock(() => {
        const payer = findAccount(currentAccount.accountNumber);
        const receiver = findAccount(receiverNo);
        if (!payer || !payer.active) {
          return sendJson(res, 403, { error: 'Sender account is inactive.' });
        }
        if (!receiver || !receiver.active) {
          return sendJson(res, 404, { error: 'Active recipient account not found.' });
        }
        if (cents > payer.balanceCents) {
          return sendJson(res, 400, { error: 'Insufficient available balance for transfer.' });
        }
        if (receiver.balanceCents + cents > MAX_SAFE_CENTS) {
          return sendJson(res, 400, { error: 'Transfer exceeds recipient ledger limit.' });
        }

        payer.balanceCents -= cents;
        receiver.balanceCents += cents;
        const tx = {
          transactionId: db.nextTransactionId++,
          payerAccountNumber: payer.accountNumber,
          receiverAccountNumber: receiver.accountNumber,
          amountCents: cents,
          transactionType: 'Transfer',
          createdAt: new Date().toISOString(),
        };
        db.transactions.push(tx);
        saveDb(db, dbPath);

        return sendJson(res, 200, {
          account: sanitizeAccount(payer),
          summary: getAccountSummary(payer.accountNumber),
          transaction: enrichTransaction(tx),
        });
      });
    }

    if (method === 'POST' && pathname === '/api/account/password') {
      const body = await readJsonBody(req);
      const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
      const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

      if (!verifyPassword(currentPassword, currentAccount.passwordHash)) {
        return sendJson(res, 401, { error: 'Current password is incorrect.' });
      }
      if (newPassword.length < 6 || newPassword.length > 128) {
        return sendJson(res, 400, { error: 'New password must be at least 6 characters.' });
      }

      return withDbLock(() => {
        const account = findAccount(currentAccount.accountNumber);
        account.passwordHash = hashPassword(newPassword);
        saveDb(db, dbPath);
        return sendJson(res, 200, { ok: true, message: 'Password updated successfully.' });
      });
    }

    if (method === 'POST' && pathname === '/api/account/close') {
      const body = await readJsonBody(req);
      const password = typeof body.password === 'string' ? body.password : '';
      if (!verifyPassword(password, currentAccount.passwordHash)) {
        return sendJson(res, 401, { error: 'Password verification failed.' });
      }

      return withDbLock(() => {
        const account = findAccount(currentAccount.accountNumber);
        account.active = false;
        saveDb(db, dbPath);
        return sendJson(
          res,
          200,
          { ok: true, message: 'Account closed.' },
          { 'Set-Cookie': clearSessionCookie() }
        );
      });
    }

    return sendJson(res, 404, { error: 'Endpoint not found.' });
  }

  function serveStatic(req, res, urlObj) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method Not Allowed');
      return;
    }

    let reqPath = decodeURIComponent(urlObj.pathname);
    if (reqPath === '/') reqPath = '/index.html';

    const resolved = path.resolve(PUBLIC_DIR, `.${reqPath}`);
    if (!resolved.startsWith(PUBLIC_DIR)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    let filePath = resolved;
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const content = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
    if (req.method === 'HEAD') {
      res.end();
    } else {
      res.end(content);
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      if (urlObj.pathname.startsWith('/api/')) {
        await handleApi(req, res, urlObj);
      } else {
        serveStatic(req, res, urlObj);
      }
    } catch (err) {
      const status = err && err.status ? err.status : 500;
      sendJson(res, status, {
        error: status === 500 ? 'Internal server error.' : err.message,
      });
    }
  });

  return server;
}

if (require.main === module) {
  const server = createBankApp();
  server.listen(PORT, HOST, () => {
    console.log(`Meridian Commercial Bank server running at http://localhost:${PORT}`);
  });
}

module.exports = {
  createBankApp,
  parseAmountToCents,
  hashPassword,
  verifyPassword,
};


'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { createBankApp, parseAmountToCents } = require('../server');

function extractCookie(headers) {
  const setCookie = headers['set-cookie'];
  if (!setCookie) return '';
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return first.split(';')[0];
}

function dispatch(server, pathname, { method = 'GET', body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const req = new PassThrough();
    req.url = pathname;
    req.method = method;
    req.headers = { host: 'localhost' };
    if (body !== undefined) req.headers['content-type'] = 'application/json';
    if (cookie) req.headers.cookie = cookie;

    const chunks = [];
    let statusCode = 200;
    const resHeaders = {};

    const res = new PassThrough();
    res.writeHead = (status, headers = {}) => {
      statusCode = status;
      for (const [k, v] of Object.entries(headers)) {
        resHeaders[k.toLowerCase()] = v;
      }
      return res;
    };
    res.setHeader = (k, v) => {
      resHeaders[k.toLowerCase()] = v;
    };
    res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    res.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      resolve({ status: statusCode, headers: resHeaders, text: raw });
    });
    res.on('error', reject);

    server.emit('request', req, res);

    if (body !== undefined) {
      req.end(JSON.stringify(body));
    } else {
      req.end();
    }
  });
}

async function api(server, pathname, options = {}) {
  const res = await dispatch(server, pathname, options);
  let data = {};
  try {
    data = JSON.parse(res.text);
  } catch {
    data = {};
  }
  return { status: res.status, data, cookie: extractCookie(res.headers) };
}

test('parseAmountToCents enforces positive 2-decimal precision', () => {
  assert.equal(parseAmountToCents('100'), 10000);
  assert.equal(parseAmountToCents('12.5'), 1250);
  assert.equal(parseAmountToCents('0.01'), 1);
  assert.equal(parseAmountToCents('0'), null);
  assert.equal(parseAmountToCents('-5.00'), null);
  assert.equal(parseAmountToCents('10.123'), null);
  assert.equal(parseAmountToCents('abc'), null);
});

test('full commercial banking lifecycle and atomic ledger', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meridian-bank-test-'));
  const dbPath = path.join(tmpDir, 'bank-db.json');
  const app = createBankApp({ dbPath });

  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // 1. Health & static files
  const health = await api(app, '/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.ok, true);

  const htmlRes = await dispatch(app, '/');
  assert.equal(htmlRes.status, 200);
  assert.match(htmlRes.text, /MERIDIAN/);

  // 2. Register two accounts
  const regA = await api(app, '/api/auth/register', {
    method: 'POST',
    body: { customerName: 'Alpha Treasury', password: 'Password@1' },
  });
  assert.equal(regA.status, 201);
  assert.equal(regA.data.account.balanceCents, 0);
  assert.equal(regA.data.account.active, true);
  const acctA = regA.data.account.accountNumber;
  const cookieA = regA.cookie;
  assert.ok(cookieA);

  const regB = await api(app, '/api/auth/register', {
    method: 'POST',
    body: { customerName: 'Beta Holdings', password: 'Password@2' },
  });
  assert.equal(regB.status, 201);
  const acctB = regB.data.account.accountNumber;
  const cookieB = regB.cookie;

  // 3. Reject invalid deposit amounts (>2 decimals, zero, negative)
  const badDep = await api(app, '/api/transactions/deposit', {
    method: 'POST',
    cookie: cookieA,
    body: { amount: '15.999' },
  });
  assert.equal(badDep.status, 400);

  // 4. Deposit $1,000.50 into A
  const goodDep = await api(app, '/api/transactions/deposit', {
    method: 'POST',
    cookie: cookieA,
    body: { amount: '1000.50' },
  });
  assert.equal(goodDep.status, 200);
  assert.equal(goodDep.data.account.balanceCents, 100050);
  assert.equal(goodDep.data.transaction.transactionType, 'Deposit');

  // 5. Reject overdraft withdrawal, then allow valid withdrawal
  const badWd = await api(app, '/api/transactions/withdraw', {
    method: 'POST',
    cookie: cookieA,
    body: { amount: '2000.00' },
  });
  assert.equal(badWd.status, 400);

  const goodWd = await api(app, '/api/transactions/withdraw', {
    method: 'POST',
    cookie: cookieA,
    body: { amount: '200.25' },
  });
  assert.equal(goodWd.status, 200);
  assert.equal(goodWd.data.account.balanceCents, 80025);

  // 6. Lookup recipient B, reject self-transfer, execute valid transfer A -> B
  const lookupB = await api(app, `/api/account/lookup?accountNumber=${acctB}`, {
    cookie: cookieA,
  });
  assert.equal(lookupB.status, 200);
  assert.equal(lookupB.data.customerName, 'Beta Holdings');

  const selfTx = await api(app, '/api/transactions/transfer', {
    method: 'POST',
    cookie: cookieA,
    body: { receiverAccountNumber: acctA, amount: '10.00' },
  });
  assert.equal(selfTx.status, 400);

  const txAB = await api(app, '/api/transactions/transfer', {
    method: 'POST',
    cookie: cookieA,
    body: { receiverAccountNumber: acctB, amount: '300.25' },
  });
  assert.equal(txAB.status, 200);
  assert.equal(txAB.data.account.balanceCents, 50000);
  assert.equal(txAB.data.transaction.transactionType, 'Transfer');

  const meB = await api(app, '/api/account/me', { cookie: cookieB });
  assert.equal(meB.status, 200);
  assert.equal(meB.data.account.balanceCents, 30025);

  // 7. Verify ledger entries for A
  const ledgerA = await api(app, '/api/transactions', { cookie: cookieA });
  assert.equal(ledgerA.status, 200);
  assert.equal(ledgerA.data.transactions.length, 3);

  // 8. Change password for B and verify login with new password
  const pwRes = await api(app, '/api/account/password', {
    method: 'POST',
    cookie: cookieB,
    body: { currentPassword: 'Password@2', newPassword: 'NewPassword@2' },
  });
  assert.equal(pwRes.status, 200);

  const badLoginB = await api(app, '/api/auth/login', {
    method: 'POST',
    body: { accountNumber: acctB, password: 'Password@2' },
  });
  assert.equal(badLoginB.status, 401);

  const goodLoginB = await api(app, '/api/auth/login', {
    method: 'POST',
    body: { accountNumber: acctB, password: 'NewPassword@2' },
  });
  assert.equal(goodLoginB.status, 200);

  // 9. Close account B -> cannot login and cannot receive transfers
  const closeB = await api(app, '/api/account/close', {
    method: 'POST',
    cookie: cookieB,
    body: { password: 'NewPassword@2' },
  });
  assert.equal(closeB.status, 200);

  const closedLoginB = await api(app, '/api/auth/login', {
    method: 'POST',
    body: { accountNumber: acctB, password: 'NewPassword@2' },
  });
  assert.equal(closedLoginB.status, 401);

  const transferToClosed = await api(app, '/api/transactions/transfer', {
    method: 'POST',
    cookie: cookieA,
    body: { receiverAccountNumber: acctB, amount: '50.00' },
  });
  assert.equal(transferToClosed.status, 404);
});

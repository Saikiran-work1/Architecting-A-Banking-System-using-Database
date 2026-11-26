/**
 * Meridian Commercial Bank — Client Data & Ledger Engine
 * Mirrors Bank.java, Account.java, AccountDAO.java, Transaction.java, and PasswordUtil.java.
 * Automatically uses the Node.js REST API when hosted dynamically, or runs an identical
 * browser-persisted ledger engine when deployed to static hosting (Vercel, Netlify, GitHub Pages).
 */

const MAX_SAFE_CENTS = 99999999999999;
const STORAGE_DB_KEY = 'meridian_commercial_bank_db_v1';
const STORAGE_SESSION_KEY = 'meridian_commercial_bank_session_v1';

export function parseAmountToCents(input) {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    input = String(input);
  }
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) return null;

  const [wholePart, fracPart = ''] = trimmed.split('.');
  const cents = Number(wholePart + fracPart.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_SAFE_CENTS) {
    return null;
  }
  return cents;
}

export function formatCents(cents) {
  const numeric = Number(cents || 0);
  const abs = Math.abs(numeric) / 100;
  const formatted = abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return numeric < 0 ? `-$${formatted}` : `$${formatted}`;
}

export function parseAccountNumber(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

// Browser-compatible salted password hashing (WebCrypto PBKDF2 with fallback for insecure file:// origins)
async function hashPasswordBrowser(password) {
  const saltBytes = new Uint8Array(16);
  if (globalThis.crypto && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(saltBytes);
  } else {
    for (let i = 0; i < saltBytes.length; i += 1) {
      saltBytes[i] = Math.floor(Math.random() * 256);
    }
  }
  const saltHex = Array.from(saltBytes, (b) => b.toString(16).padStart(2, '0')).join('');

  if (globalThis.crypto && globalThis.crypto.subtle) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: saltBytes, iterations: 120000, hash: 'SHA-256' },
      keyMaterial,
      256
    );
    const hashHex = Array.from(new Uint8Array(bits), (b) =>
      b.toString(16).padStart(2, '0')
    ).join('');
    return `pbkdf2$${saltHex}$${hashHex}`;
  }

  // Deterministic salted fallback only when WebCrypto subtle is unavailable (e.g. file://)
  return `salted$${saltHex}$${fallbackDigest(saltHex + ':' + password)}`;
}

async function verifyPasswordBrowser(password, storedHash) {
  if (typeof password !== 'string' || typeof storedHash !== 'string') return false;
  const parts = storedHash.split('$');
  if (parts.length !== 3) return false;
  const [scheme, saltHex, expectedHex] = parts;

  if (scheme === 'pbkdf2' && globalThis.crypto && globalThis.crypto.subtle) {
    const saltBytes = new Uint8Array(
      saltHex.match(/.{1,2}/g).map((byte) => Number.parseInt(byte, 16))
    );
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: saltBytes, iterations: 120000, hash: 'SHA-256' },
      keyMaterial,
      256
    );
    const actualHex = Array.from(new Uint8Array(bits), (b) =>
      b.toString(16).padStart(2, '0')
    ).join('');
    return constantTimeEqual(actualHex, expectedHex);
  }

  if (scheme === 'salted') {
    return constantTimeEqual(fallbackDigest(saltHex + ':' + password), expectedHex);
  }

  return false;
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function fallbackDigest(str) {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < str.length; i += 1) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

class LocalBankBackend {
  constructor() {
    this.mode = 'static';
  }

  async ensureDb() {
    const raw = localStorage.getItem(STORAGE_DB_KEY);
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch {
        // Re-seed if corrupted
      }
    }
    const now = Date.now();
    const iso = (offsetMs) => new Date(now - offsetMs).toISOString();
    const db = {
      nextAccountNumber: 10010003,
      nextTransactionId: 50006,
      accounts: [
        {
          accountNumber: 10010001,
          customerName: 'Meridian Logistics Corp',
          passwordHash: await hashPasswordBrowser('Meridian@2026'),
          balanceCents: 12545000,
          active: true,
          createdAt: iso(1000 * 60 * 60 * 24 * 45),
        },
        {
          accountNumber: 10010002,
          customerName: 'Apex Retail Holdings',
          passwordHash: await hashPasswordBrowser('Apex@2026'),
          balanceCents: 4892050,
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
    this.saveDb(db);
    return db;
  }

  saveDb(db) {
    localStorage.setItem(STORAGE_DB_KEY, JSON.stringify(db));
  }

  sanitize(account) {
    return {
      accountNumber: account.accountNumber,
      customerName: account.customerName,
      balanceCents: account.balanceCents,
      active: account.active,
      createdAt: account.createdAt,
    };
  }

  summaryFor(db, accountNumber) {
    let transactionCount = 0;
    let totalInflowCents = 0;
    let totalOutflowCents = 0;
    for (const tx of db.transactions) {
      if (tx.payerAccountNumber === accountNumber || tx.receiverAccountNumber === accountNumber) {
        transactionCount += 1;
      }
      if (tx.receiverAccountNumber === accountNumber) totalInflowCents += tx.amountCents;
      if (tx.payerAccountNumber === accountNumber) totalOutflowCents += tx.amountCents;
    }
    return { transactionCount, totalInflowCents, totalOutflowCents };
  }

  enrichTx(db, tx) {
    const payer = tx.payerAccountNumber
      ? db.accounts.find((a) => a.accountNumber === tx.payerAccountNumber)
      : null;
    const receiver = tx.receiverAccountNumber
      ? db.accounts.find((a) => a.accountNumber === tx.receiverAccountNumber)
      : null;
    return {
      ...tx,
      payerName: payer ? payer.customerName : null,
      receiverName: receiver ? receiver.customerName : null,
    };
  }

  async requireSession(db) {
    const raw = localStorage.getItem(STORAGE_SESSION_KEY);
    if (!raw) throw new Error('Authentication required.');
    const sessionAccount = parseAccountNumber(raw);
    const account = db.accounts.find((a) => a.accountNumber === sessionAccount);
    if (!account || !account.active) {
      localStorage.removeItem(STORAGE_SESSION_KEY);
      throw new Error('Authentication required.');
    }
    return account;
  }

  async register({ customerName, password }) {
    const name = typeof customerName === 'string' ? customerName.trim() : '';
    if (name.length < 2 || name.length > 80) {
      throw new Error('Account holder name must be between 2 and 80 characters.');
    }
    if (typeof password !== 'string' || password.length < 6) {
      throw new Error('Password must be at least 6 characters.');
    }
    const db = await this.ensureDb();
    const account = {
      accountNumber: db.nextAccountNumber++,
      customerName: name,
      passwordHash: await hashPasswordBrowser(password),
      balanceCents: 0,
      active: true,
      createdAt: new Date().toISOString(),
    };
    db.accounts.push(account);
    this.saveDb(db);
    localStorage.setItem(STORAGE_SESSION_KEY, String(account.accountNumber));
    return {
      account: this.sanitize(account),
      summary: this.summaryFor(db, account.accountNumber),
    };
  }

  async login({ accountNumber, password }) {
    const acNo = parseAccountNumber(accountNumber);
    if (!acNo || !password) throw new Error('Valid account number and password are required.');
    const db = await this.ensureDb();
    const account = db.accounts.find((a) => a.accountNumber === acNo);
    if (!account || !account.active) throw new Error('Account not found or inactive.');
    const valid = await verifyPasswordBrowser(password, account.passwordHash);
    if (!valid) throw new Error('Incorrect password.');
    localStorage.setItem(STORAGE_SESSION_KEY, String(account.accountNumber));
    return {
      account: this.sanitize(account),
      summary: this.summaryFor(db, account.accountNumber),
    };
  }

  async logout() {
    localStorage.removeItem(STORAGE_SESSION_KEY);
    return { ok: true };
  }

  async me() {
    const db = await this.ensureDb();
    const account = await this.requireSession(db);
    return {
      account: this.sanitize(account),
      summary: this.summaryFor(db, account.accountNumber),
    };
  }

  async lookup(accountNumber) {
    const db = await this.ensureDb();
    const current = await this.requireSession(db);
    const targetNo = parseAccountNumber(accountNumber);
    if (!targetNo) throw new Error('Enter a valid account number.');
    if (targetNo === current.accountNumber) {
      throw new Error('Cannot transfer to your own account.');
    }
    const target = db.accounts.find((a) => a.accountNumber === targetNo);
    if (!target || !target.active) throw new Error('Active recipient account not found.');
    return {
      accountNumber: target.accountNumber,
      customerName: target.customerName,
      active: target.active,
    };
  }

  async transactions() {
    const db = await this.ensureDb();
    const current = await this.requireSession(db);
    const list = db.transactions
      .filter(
        (tx) =>
          tx.payerAccountNumber === current.accountNumber ||
          tx.receiverAccountNumber === current.accountNumber
      )
      .sort((a, b) => b.transactionId - a.transactionId)
      .map((tx) => this.enrichTx(db, tx));
    return { transactions: list };
  }

  async deposit({ amount }) {
    const cents = parseAmountToCents(amount);
    if (!cents) throw new Error('Enter a positive deposit amount with at most two decimal places.');
    const db = await this.ensureDb();
    const account = await this.requireSession(db);
    if (account.balanceCents + cents > MAX_SAFE_CENTS) {
      throw new Error('Amount exceeds maximum ledger capacity.');
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
    this.saveDb(db);
    return {
      account: this.sanitize(account),
      summary: this.summaryFor(db, account.accountNumber),
      transaction: this.enrichTx(db, tx),
    };
  }

  async withdraw({ amount }) {
    const cents = parseAmountToCents(amount);
    if (!cents) throw new Error('Enter a positive withdrawal amount with at most two decimal places.');
    const db = await this.ensureDb();
    const account = await this.requireSession(db);
    if (cents > account.balanceCents) throw new Error('Insufficient available balance.');
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
    this.saveDb(db);
    return {
      account: this.sanitize(account),
      summary: this.summaryFor(db, account.accountNumber),
      transaction: this.enrichTx(db, tx),
    };
  }

  async transfer({ receiverAccountNumber, amount }) {
    const targetNo = parseAccountNumber(receiverAccountNumber);
    const cents = parseAmountToCents(amount);
    if (!targetNo) throw new Error('Enter a valid recipient account number.');
    if (!cents) throw new Error('Enter a positive transfer amount with at most two decimal places.');

    const db = await this.ensureDb();
    const payer = await this.requireSession(db);
    if (targetNo === payer.accountNumber) throw new Error('Self-transfers are not permitted.');
    const receiver = db.accounts.find((a) => a.accountNumber === targetNo);
    if (!receiver || !receiver.active) throw new Error('Active recipient account not found.');
    if (cents > payer.balanceCents) throw new Error('Insufficient available balance for transfer.');

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
    this.saveDb(db);
    return {
      account: this.sanitize(payer),
      summary: this.summaryFor(db, payer.accountNumber),
      transaction: this.enrichTx(db, tx),
    };
  }

  async changePassword({ currentPassword, newPassword }) {
    const db = await this.ensureDb();
    const account = await this.requireSession(db);
    const valid = await verifyPasswordBrowser(currentPassword, account.passwordHash);
    if (!valid) throw new Error('Current password is incorrect.');
    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      throw new Error('New password must be at least 6 characters.');
    }
    account.passwordHash = await hashPasswordBrowser(newPassword);
    this.saveDb(db);
    return { ok: true, message: 'Password updated successfully.' };
  }

  async closeAccount({ password }) {
    const db = await this.ensureDb();
    const account = await this.requireSession(db);
    const valid = await verifyPasswordBrowser(password, account.passwordHash);
    if (!valid) throw new Error('Password verification failed.');
    account.active = false;
    this.saveDb(db);
    localStorage.removeItem(STORAGE_SESSION_KEY);
    return { ok: true, message: 'Account closed.' };
  }

  resetDemoData() {
    localStorage.removeItem(STORAGE_DB_KEY);
    localStorage.removeItem(STORAGE_SESSION_KEY);
  }
}

class ServerBankBackend {
  constructor() {
    this.mode = 'server';
  }

  async request(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      ...options,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `Request failed (${response.status})`);
    }
    return data;
  }

  register(payload) {
    return this.request('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) });
  }

  login(payload) {
    return this.request('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) });
  }

  logout() {
    return this.request('/api/auth/logout', { method: 'POST' });
  }

  me() {
    return this.request('/api/account/me');
  }

  lookup(accountNumber) {
    return this.request(`/api/account/lookup?accountNumber=${encodeURIComponent(accountNumber)}`);
  }

  transactions() {
    return this.request('/api/transactions');
  }

  deposit(payload) {
    return this.request('/api/transactions/deposit', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  withdraw(payload) {
    return this.request('/api/transactions/withdraw', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  transfer(payload) {
    return this.request('/api/transactions/transfer', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  changePassword(payload) {
    return this.request('/api/account/password', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  closeAccount(payload) {
    return this.request('/api/account/close', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }
}

export async function createBankClient() {
  if (window.location.protocol === 'file:') {
    return new LocalBankBackend();
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch('/api/health', { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (data && data.ok) return new ServerBankBackend();
    }
  } catch {
    // Fall back to static browser ledger engine
  }
  return new LocalBankBackend();
}


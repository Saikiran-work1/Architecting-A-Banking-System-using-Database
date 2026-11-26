import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal localStorage and window shims to test the static browser engine in Node
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
globalThis.window = { location: { protocol: 'file:' } };

const { createBankClient, parseAmountToCents, formatCents } = await import('../public/bank-engine.js');

test('static browser bank engine supports full banking lifecycle', async () => {
  localStorage.clear();
  const client = await createBankClient();
  assert.equal(client.mode, 'static');
  assert.equal(parseAmountToCents('42.50'), 4250);
  assert.equal(formatCents(4250), '$42.50');

  // Pre-seeded demo account login
  const demo = await client.login({ accountNumber: '10010001', password: 'Meridian@2026' });
  assert.equal(demo.account.customerName, 'Meridian Logistics Corp');
  assert.equal(demo.account.balanceCents, 12545000);

  // Register new account
  const reg = await client.register({ customerName: 'Static Corp', password: 'Password@9' });
  assert.equal(reg.account.balanceCents, 0);
  const newAcct = reg.account.accountNumber;

  // Deposit, withdraw, transfer to seeded account
  const dep = await client.deposit({ amount: '500.00' });
  assert.equal(dep.account.balanceCents, 50000);

  const wd = await client.withdraw({ amount: '125.50' });
  assert.equal(wd.account.balanceCents, 37450);

  const tx = await client.transfer({ receiverAccountNumber: 10010002, amount: '74.50' });
  assert.equal(tx.account.balanceCents, 30000);

  const ledger = await client.transactions();
  assert.equal(ledger.transactions.length, 3);

  // Change password and close account
  await client.changePassword({ currentPassword: 'Password@9', newPassword: 'Password@10' });
  await client.logout();

  await assert.rejects(
    () => client.login({ accountNumber: newAcct, password: 'Password@9' }),
    /Incorrect password/
  );
  await client.login({ accountNumber: newAcct, password: 'Password@10' });
  await client.closeAccount({ password: 'Password@10' });
  await assert.rejects(
    () => client.login({ accountNumber: newAcct, password: 'Password@10' }),
    /Account not found or inactive/
  );
});

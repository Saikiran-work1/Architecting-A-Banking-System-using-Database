import { createBankClient, formatCents, parseAmountToCents } from './bank-engine.js';

const state = {
  client: null,
  account: null,
  summary: { transactionCount: 0, totalInflowCents: 0, totalOutflowCents: 0 },
  transactions: [],
  activeTab: 'overview',
  ledgerFilter: 'ALL',
  ledgerSearch: '',
};

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTimestamp(iso) {
  try {
    return new Date(iso).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function showToast(message, type = 'success') {
  const container = $('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.remove();
  }, 4000);
}

function setAlert(id, message) {
  const el = $(id);
  if (!message) {
    el.textContent = '';
    el.classList.add('hidden');
  } else {
    el.textContent = message;
    el.classList.remove('hidden');
  }
}

function openModal({ eyebrow = 'OFFICIAL RECORD', title, bodyHtml, footerButtons }) {
  $('modal-eyebrow').textContent = eyebrow;
  $('modal-title').textContent = title;
  $('modal-body').innerHTML = bodyHtml;

  const footer = $('modal-footer');
  footer.innerHTML = '';
  if (Array.isArray(footerButtons) && footerButtons.length > 0) {
    for (const btnCfg of footerButtons) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = btnCfg.className || 'btn btn-primary';
      btn.textContent = btnCfg.label;
      btn.addEventListener('click', btnCfg.onClick);
      footer.appendChild(btn);
    }
  } else {
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn btn-primary';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', closeModal);
    footer.appendChild(closeBtn);
  }

  $('modal-backdrop').classList.remove('hidden');
}

function closeModal() {
  $('modal-backdrop').classList.add('hidden');
}

function switchAuthTab(mode) {
  const isLogin = mode === 'login';
  $('tab-btn-login').classList.toggle('active', isLogin);
  $('tab-btn-login').setAttribute('aria-selected', String(isLogin));
  $('tab-btn-register').classList.toggle('active', !isLogin);
  $('tab-btn-register').setAttribute('aria-selected', String(!isLogin));

  $('login-form').classList.toggle('hidden', !isLogin);
  $('register-form').classList.toggle('hidden', isLogin);
  setAlert('login-error', '');
  setAlert('register-error', '');
}

function updatePasswordStrength(pw) {
  const bar = $('register-strength-bar');
  let score = 0;
  if (pw.length >= 6) score += 25;
  if (pw.length >= 10) score += 25;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score += 25;
  if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) score += 25;

  bar.style.width = `${score}%`;
  if (score <= 25) bar.style.backgroundColor = '#b42318';
  else if (score <= 50) bar.style.backgroundColor = '#d97706';
  else if (score <= 75) bar.style.backgroundColor = '#1a56db';
  else bar.style.backgroundColor = '#0e7c5b';
}

function renderViews() {
  const loggedIn = Boolean(state.account);
  $('public-view').classList.toggle('hidden', loggedIn);
  $('dashboard-view').classList.toggle('hidden', !loggedIn);

  if (loggedIn) {
    renderDashboard();
  }
}

function switchDashboardTab(tabName) {
  state.activeTab = tabName;
  document.querySelectorAll('.dash-tab').forEach((sec) => {
    sec.classList.toggle('hidden', sec.id !== `tab-${tabName}`);
  });
  document.querySelectorAll('.sidebar-nav .nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  $('dash-sidebar').classList.remove('open');
}

function describeTransaction(tx) {
  const me = state.account.accountNumber;
  if (tx.transactionType === 'Deposit') {
    return {
      direction: 'credit',
      signedAmount: `+${formatCents(tx.amountCents)}`,
      counterparty: 'Treasury Cash / Direct Deposit',
    };
  }
  if (tx.transactionType === 'Withdrawal') {
    return {
      direction: 'debit',
      signedAmount: `-${formatCents(tx.amountCents)}`,
      counterparty: 'Commercial Disbursement',
    };
  }
  if (tx.payerAccountNumber === me) {
    const label = tx.receiverName
      ? `To ${tx.receiverName} (#${tx.receiverAccountNumber})`
      : `To Account #${tx.receiverAccountNumber}`;
    return {
      direction: 'debit',
      signedAmount: `-${formatCents(tx.amountCents)}`,
      counterparty: label,
    };
  }
  const label = tx.payerName
    ? `From ${tx.payerName} (#${tx.payerAccountNumber})`
    : `From Account #${tx.payerAccountNumber}`;
  return {
    direction: 'credit',
    signedAmount: `+${formatCents(tx.amountCents)}`,
    counterparty: label,
  };
}

function showTransactionReceipt(tx) {
  const desc = describeTransaction(tx);
  const bodyHtml = `
    <dl class="receipt-dl">
      <div><dt>Transaction ID</dt><dd class="tabular">#${escapeHtml(tx.transactionId)}</dd></div>
      <div><dt>Transaction Type</dt><dd>${escapeHtml(tx.transactionType)}</dd></div>
      <div><dt>Payer Account</dt><dd class="tabular">${tx.payerAccountNumber ? `#${escapeHtml(tx.payerAccountNumber)}${tx.payerName ? ` (${escapeHtml(tx.payerName)})` : ''}` : 'External / Deposit'}</dd></div>
      <div><dt>Receiver Account</dt><dd class="tabular">${tx.receiverAccountNumber ? `#${escapeHtml(tx.receiverAccountNumber)}${tx.receiverName ? ` (${escapeHtml(tx.receiverName)})` : ''}` : 'External / Withdrawal'}</dd></div>
      <div><dt>Amount</dt><dd class="tabular ${desc.direction === 'credit' ? 'amount-credit' : 'amount-debit'}">${escapeHtml(desc.signedAmount)}</dd></div>
      <div><dt>Posted Timestamp</dt><dd>${escapeHtml(formatTimestamp(tx.createdAt))}</dd></div>
    </dl>
  `;
  openModal({
    eyebrow: 'MERIDIAN OFFICIAL LEDGER RECEIPT',
    title: `Transaction #${tx.transactionId}`,
    bodyHtml,
  });
}

function renderActivityBars() {
  const container = $('activity-bars');
  const totals = { Deposit: 0, Withdrawal: 0, Transfer: 0 };
  for (const tx of state.transactions) {
    if (totals[tx.transactionType] !== undefined) {
      totals[tx.transactionType] += tx.amountCents;
    }
  }
  const maxVal = Math.max(totals.Deposit, totals.Withdrawal, totals.Transfer, 1);

  const items = [
    { label: 'Deposits', amount: totals.Deposit, cls: 'deposit' },
    { label: 'Withdrawals', amount: totals.Withdrawal, cls: 'withdrawal' },
    { label: 'Transfers', amount: totals.Transfer, cls: 'transfer' },
  ];

  container.innerHTML = items
    .map((item) => {
      const pct = Math.round((item.amount / maxVal) * 100);
      return `
        <div>
          <div class="bar-row-head">
            <span>${escapeHtml(item.label)}</span>
            <strong class="tabular">${escapeHtml(formatCents(item.amount))}</strong>
          </div>
          <div class="bar-track">
            <div class="bar-fill ${item.cls}" style="width: ${pct}%"></div>
          </div>
        </div>
      `;
    })
    .join('');
}

function renderRecentTransactions() {
  const tbody = $('recent-tx-tbody');
  const recent = state.transactions.slice(0, 5);
  if (recent.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No posted transactions yet.</td></tr>';
    return;
  }

  tbody.innerHTML = recent
    .map((tx) => {
      const desc = describeTransaction(tx);
      return `
        <tr data-tx-id="${escapeHtml(tx.transactionId)}" style="cursor:pointer;">
          <td class="tabular">#${escapeHtml(tx.transactionId)}</td>
          <td><span class="tx-type-badge ${escapeHtml(tx.transactionType)}">${escapeHtml(tx.transactionType)}</span></td>
          <td>${escapeHtml(desc.counterparty)}</td>
          <td class="num-col tabular ${desc.direction === 'credit' ? 'amount-credit' : 'amount-debit'}">${escapeHtml(desc.signedAmount)}</td>
        </tr>
      `;
    })
    .join('');

  tbody.querySelectorAll('tr[data-tx-id]').forEach((row) => {
    row.addEventListener('click', () => {
      const id = Number(row.dataset.txId);
      const tx = state.transactions.find((t) => t.transactionId === id);
      if (tx) showTransactionReceipt(tx);
    });
  });
}

function getFilteredTransactions() {
  const q = state.ledgerSearch.trim().toLowerCase();
  return state.transactions.filter((tx) => {
    if (state.ledgerFilter !== 'ALL' && tx.transactionType !== state.ledgerFilter) {
      return false;
    }
    if (!q) return true;
    const desc = describeTransaction(tx);
    const haystack = [
      tx.transactionId,
      tx.transactionType,
      tx.payerAccountNumber || '',
      tx.receiverAccountNumber || '',
      desc.counterparty,
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });
}

function renderLedgerTable() {
  const tbody = $('ledger-tbody');
  const filtered = getFilteredTransactions();

  if (filtered.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="6" class="empty-state">No matching transactions in ledger.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered
    .map((tx) => {
      const desc = describeTransaction(tx);
      return `
        <tr>
          <td class="tabular">#${escapeHtml(tx.transactionId)}</td>
          <td>${escapeHtml(formatTimestamp(tx.createdAt))}</td>
          <td><span class="tx-type-badge ${escapeHtml(tx.transactionType)}">${escapeHtml(tx.transactionType)}</span></td>
          <td>${escapeHtml(desc.counterparty)}</td>
          <td class="num-col tabular ${desc.direction === 'credit' ? 'amount-credit' : 'amount-debit'}">${escapeHtml(desc.signedAmount)}</td>
          <td class="action-col">
            <button type="button" class="link-btn view-receipt-btn" data-tx-id="${escapeHtml(tx.transactionId)}">View</button>
          </td>
        </tr>
      `;
    })
    .join('');

  tbody.querySelectorAll('.view-receipt-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.txId);
      const tx = state.transactions.find((t) => t.transactionId === id);
      if (tx) showTransactionReceipt(tx);
    });
  });
}

function renderDashboard() {
  const ac = state.account;
  const formattedBal = formatCents(ac.balanceCents);

  $('topbar-user-name').textContent = ac.customerName;
  $('topbar-account-no').textContent = `Acct #${ac.accountNumber}`;
  $('sidebar-balance').textContent = formattedBal;
  $('sidebar-acct').textContent = `Account #${ac.accountNumber}`;

  $('overview-greeting').textContent = `Welcome, ${ac.customerName}`;
  $('overview-balance').textContent = formattedBal;
  $('overview-holder').textContent = ac.customerName;
  $('overview-acct-no').textContent = `#${ac.accountNumber}`;

  $('kpi-inflows').textContent = formatCents(state.summary.totalInflowCents);
  $('kpi-outflows').textContent = formatCents(state.summary.totalOutflowCents);
  $('kpi-count').textContent = String(state.summary.transactionCount);

  $('transfer-avail-hint').textContent = formattedBal;
  $('withdraw-avail-hint').textContent = formattedBal;

  $('profile-name').textContent = ac.customerName;
  $('profile-acct-no').textContent = `#${ac.accountNumber}`;
  $('profile-created').textContent = formatTimestamp(ac.createdAt);
  $('profile-balance').textContent = formattedBal;

  renderActivityBars();
  renderRecentTransactions();
  renderLedgerTable();
}

async function refreshLedgerData() {
  const [meRes, txRes] = await Promise.all([state.client.me(), state.client.transactions()]);
  state.account = meRes.account;
  state.summary = meRes.summary;
  state.transactions = txRes.transactions;
  renderViews();
}

function exportLedgerCsv() {
  const rows = getFilteredTransactions();
  if (rows.length === 0) {
    showToast('No transactions to export.', 'error');
    return;
  }
  const header = ['Transaction ID', 'Timestamp', 'Type', 'Payer Account', 'Receiver Account', 'Amount (USD)'];
  const lines = [header.join(',')];
  for (const tx of rows) {
    const amountStr = (tx.amountCents / 100).toFixed(2);
    lines.push(
      [
        tx.transactionId,
        `"${tx.createdAt}"`,
        tx.transactionType,
        tx.payerAccountNumber ?? '',
        tx.receiverAccountNumber ?? '',
        amountStr,
      ].join(',')
    );
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `meridian-statement-${state.account.accountNumber}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast('Statement exported as CSV.');
}

function wireEvents() {
  // Auth tab switching & header buttons
  $('tab-btn-login').addEventListener('click', () => switchAuthTab('login'));
  $('tab-btn-register').addEventListener('click', () => switchAuthTab('register'));

  $('header-signin-btn').addEventListener('click', () => {
    switchAuthTab('login');
    $('auth-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('login-account-number').focus();
  });

  $('header-open-btn').addEventListener('click', () => {
    switchAuthTab('register');
    $('auth-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('register-name').focus();
  });

  // Password show/hide toggles
  document.querySelectorAll('.toggle-pw-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = $(btn.dataset.target);
      const isHidden = input.type === 'password';
      input.type = isHidden ? 'text' : 'password';
      btn.textContent = isHidden ? 'Hide' : 'Show';
    });
  });

  $('register-password').addEventListener('input', (e) => {
    updatePasswordStrength(e.target.value);
  });

  // Demo quick-fill login
  document.querySelectorAll('.demo-account-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      $('login-account-number').value = btn.dataset.ac;
      $('login-password').value = btn.dataset.pw;
      $('login-form').requestSubmit();
    });
  });

  // Login submit
  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    setAlert('login-error', '');
    const submitBtn = $('login-submit-btn');
    submitBtn.disabled = true;
    try {
      const accountNumber = $('login-account-number').value.trim();
      const password = $('login-password').value;
      const res = await state.client.login({ accountNumber, password });
      state.account = res.account;
      state.summary = res.summary;
      const txRes = await state.client.transactions();
      state.transactions = txRes.transactions;
      $('login-form').reset();
      switchDashboardTab('overview');
      renderViews();
      showToast(`Signed in to Account #${res.account.accountNumber}`);
    } catch (err) {
      setAlert('login-error', err.message || 'Sign in failed.');
    } finally {
      submitBtn.disabled = false;
    }
  });

  // Register submit
  $('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    setAlert('register-error', '');
    const customerName = $('register-name').value.trim();
    const password = $('register-password').value;
    const confirm = $('register-confirm').value;

    if (customerName.length < 2) {
      setAlert('register-error', 'Please enter a valid account holder name.');
      return;
    }
    if (password.length < 6) {
      setAlert('register-error', 'Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setAlert('register-error', 'Passwords do not match.');
      return;
    }

    const submitBtn = $('register-submit-btn');
    submitBtn.disabled = true;
    try {
      const res = await state.client.register({ customerName, password });
      state.account = res.account;
      state.summary = res.summary;
      state.transactions = [];
      $('register-form').reset();
      updatePasswordStrength('');
      switchDashboardTab('overview');
      renderViews();

      openModal({
        eyebrow: 'NEW COMMERCIAL ACCOUNT PROVISIONED',
        title: 'Account Created Successfully',
        bodyHtml: `
          <p style="margin-top:0;color:#475569;">
            Your commercial account is now active. Save your generated account number for future sign-ins and incoming transfers.
          </p>
          <dl class="receipt-dl">
            <div><dt>Account Holder</dt><dd>${escapeHtml(res.account.customerName)}</dd></div>
            <div><dt>Account Number</dt><dd class="tabular" style="font-size:1.15rem;color:#1a56db;">#${escapeHtml(res.account.accountNumber)}</dd></div>
            <div><dt>Opening Balance</dt><dd class="tabular">$0.00</dd></div>
            <div><dt>Status</dt><dd><span class="badge-active">ACTIVE</span></dd></div>
          </dl>
        `,
      });
    } catch (err) {
      setAlert('register-error', err.message || 'Account creation failed.');
    } finally {
      submitBtn.disabled = false;
    }
  });

  // Reset browser demo button (static mode only)
  $('reset-demo-btn').addEventListener('click', () => {
    if (typeof state.client.resetDemoData === 'function') {
      state.client.resetDemoData();
      showToast('Browser demo ledger reset to initial commercial accounts.');
    }
  });

  // Dashboard nav & mobile drawer
  $('mobile-menu-btn').addEventListener('click', () => {
    $('dash-sidebar').classList.toggle('open');
  });

  document.querySelectorAll('.sidebar-nav .nav-item').forEach((btn) => {
    btn.addEventListener('click', () => switchDashboardTab(btn.dataset.tab));
  });

  document.querySelectorAll('[data-goto-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchDashboardTab(btn.dataset.gotoTab));
  });

  // Logout
  $('logout-btn').addEventListener('click', async () => {
    await state.client.logout();
    state.account = null;
    state.transactions = [];
    renderViews();
    showToast('Signed out securely.');
  });

  // Quick preset chips for Deposit / Withdraw
  document.querySelectorAll('.preset-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      $(chip.dataset.target).value = chip.dataset.val;
    });
  });

  // Deposit
  $('deposit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    setAlert('deposit-error', '');
    const amount = $('deposit-amount').value.trim();
    if (!parseAmountToCents(amount)) {
      setAlert('deposit-error', 'Enter a positive amount with at most two decimal places.');
      return;
    }
    const btn = $('deposit-submit-btn');
    btn.disabled = true;
    try {
      const res = await state.client.deposit({ amount });
      $('deposit-form').reset();
      await refreshLedgerData();
      showToast(`Deposited ${formatCents(res.transaction.amountCents)} (Tx #${res.transaction.transactionId})`);
    } catch (err) {
      setAlert('deposit-error', err.message || 'Deposit failed.');
    } finally {
      btn.disabled = false;
    }
  });

  // Withdraw
  $('withdraw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    setAlert('withdraw-error', '');
    const amount = $('withdraw-amount').value.trim();
    if (!parseAmountToCents(amount)) {
      setAlert('withdraw-error', 'Enter a positive amount with at most two decimal places.');
      return;
    }
    const btn = $('withdraw-submit-btn');
    btn.disabled = true;
    try {
      const res = await state.client.withdraw({ amount });
      $('withdraw-form').reset();
      await refreshLedgerData();
      showToast(`Withdrew ${formatCents(res.transaction.amountCents)} (Tx #${res.transaction.transactionId})`);
    } catch (err) {
      setAlert('withdraw-error', err.message || 'Withdrawal failed.');
    } finally {
      btn.disabled = false;
    }
  });

  // Verify transfer recipient
  $('verify-recipient-btn').addEventListener('click', async () => {
    const preview = $('recipient-preview');
    const receiver = $('transfer-receiver').value.trim();
    preview.classList.remove('hidden', 'valid', 'invalid');
    try {
      const res = await state.client.lookup(receiver);
      preview.classList.add('valid');
      preview.textContent = `Verified Active Recipient: ${res.customerName} (#${res.accountNumber})`;
    } catch (err) {
      preview.classList.add('invalid');
      preview.textContent = err.message || 'Recipient verification failed.';
    }
  });

  $('transfer-receiver').addEventListener('input', () => {
    $('recipient-preview').classList.add('hidden');
  });

  // Execute transfer
  $('transfer-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    setAlert('transfer-error', '');
    const receiverAccountNumber = $('transfer-receiver').value.trim();
    const amount = $('transfer-amount').value.trim();
    if (!parseAmountToCents(amount)) {
      setAlert('transfer-error', 'Enter a positive transfer amount with at most two decimal places.');
      return;
    }
    const btn = $('transfer-submit-btn');
    btn.disabled = true;
    try {
      const res = await state.client.transfer({ receiverAccountNumber, amount });
      $('transfer-form').reset();
      $('recipient-preview').classList.add('hidden');
      await refreshLedgerData();
      showToast(`Transferred ${formatCents(res.transaction.amountCents)} to #${receiverAccountNumber}`);
    } catch (err) {
      setAlert('transfer-error', err.message || 'Transfer failed.');
    } finally {
      btn.disabled = false;
    }
  });

  // Ledger filters & search
  document.querySelectorAll('#ledger-type-filters .filter-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      state.ledgerFilter = pill.dataset.type;
      document.querySelectorAll('#ledger-type-filters .filter-pill').forEach((p) => {
        p.classList.toggle('active', p === pill);
      });
      renderLedgerTable();
    });
  });

  $('ledger-search-input').addEventListener('input', (e) => {
    state.ledgerSearch = e.target.value;
    renderLedgerTable();
  });

  $('export-csv-btn').addEventListener('click', exportLedgerCsv);

  // Change password
  $('password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    setAlert('password-error', '');
    const currentPassword = $('pw-current').value;
    const newPassword = $('pw-new').value;
    const confirm = $('pw-confirm').value;

    if (newPassword.length < 6) {
      setAlert('password-error', 'New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirm) {
      setAlert('password-error', 'New passwords do not match.');
      return;
    }

    const btn = $('password-submit-btn');
    btn.disabled = true;
    try {
      await state.client.changePassword({ currentPassword, newPassword });
      $('password-form').reset();
      showToast('Password updated successfully.');
    } catch (err) {
      setAlert('password-error', err.message || 'Failed to update password.');
    } finally {
      btn.disabled = false;
    }
  });

  // Close account modal
  $('open-close-account-btn').addEventListener('click', () => {
    openModal({
      eyebrow: 'PERMANENT ACCOUNT DEACTIVATION',
      title: `Close Account #${state.account.accountNumber}`,
      bodyHtml: `
        <p style="margin-top:0;color:#475569;">
          Closing this account sets <code>is_active = false</code>. You will be signed out and
          cannot perform future transactions on this account.
        </p>
        <div class="field-group" style="margin-bottom:0;">
          <label for="close-confirm-pw">Enter your password to confirm</label>
          <input id="close-confirm-pw" type="password" placeholder="Current password" />
        </div>
        <div id="close-modal-error" class="form-alert hidden" style="margin-top:12px;margin-bottom:0;"></div>
      `,
      footerButtons: [
        {
          label: 'Cancel',
          className: 'btn btn-outline-sm',
          onClick: closeModal,
        },
        {
          label: 'Confirm Close Account',
          className: 'btn btn-danger',
          onClick: async () => {
            const pw = $('close-confirm-pw').value;
            const errBox = $('close-modal-error');
            errBox.classList.add('hidden');
            try {
              await state.client.closeAccount({ password: pw });
              closeModal();
              state.account = null;
              state.transactions = [];
              renderViews();
              showToast('Account closed and deactivated.');
            } catch (err) {
              errBox.textContent = err.message || 'Could not close account.';
              errBox.classList.remove('hidden');
            }
          },
        },
      ],
    });
  });

  // Modal close listeners
  $('modal-close-btn').addEventListener('click', closeModal);
  $('modal-done-btn').addEventListener('click', closeModal);
  $('modal-backdrop').addEventListener('click', (e) => {
    if (e.target === $('modal-backdrop')) closeModal();
  });
}

async function init() {
  state.client = await createBankClient();
  const modeLabel =
    state.client.mode === 'server' ? 'Live API Server' : 'Browser Ledger Mode (Static)';
  $('public-mode-pill').textContent = modeLabel;
  $('dash-mode-pill').textContent = modeLabel;
  if (state.client.mode === 'static') {
    $('reset-demo-btn').classList.remove('hidden');
  }

  wireEvents();

  try {
    await refreshLedgerData();
  } catch {
    state.account = null;
    renderViews();
  }
}

init();


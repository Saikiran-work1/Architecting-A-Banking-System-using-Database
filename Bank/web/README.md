# Meridian Commercial Bank — Web Portal

Commercial banking web application modeled directly on the Java/MySQL `BankSystem` reference project (`Account`, `Bank`, `AccountDAO`, `Transaction`, `PasswordUtil`).

## Features Modeled on the Reference Project

- **Account Provisioning**: Sequential account number generation, `$0.00` opening balance, and `active` lifecycle flag.
- **Cryptographic Authentication**: Salted `scrypt` hashing on the Node.js server (and salted WebCrypto `PBKDF2` in static browser mode) with constant-time comparison.
- **Fixed-Point Monetary Validation**: Exact integer-cents arithmetic enforcing positive amounts with at most two decimal places (matching `BigDecimal` / `DECIMAL(19,2)`).
- **Atomic Operations & Audit Ledger**: Deposits, withdrawals, and inter-account transfers update balances and post `bank_transactions` entries atomically, with recipient lookup, CSV statement export, and official transaction receipts.
- **Account Governance**: Password rotation and permanent account closure (`active = false`).

## Pre-Seeded Demo Accounts

For immediate evaluation on the Sign In screen:
- **Meridian Logistics Corp** — Account `#10010001` / Password: `Meridian@2026`
- **Apex Retail Holdings** — Account `#10010002` / Password: `Apex@2026`

## Run Locally (Node.js 18+)

No external npm packages are required. From `web/`:

```powershell
node server.js
```

Then open `http://localhost:3000`.

Run the automated test suite:

```powershell
node --test tests/bank.test.js
```

## Deployment Options

1. **Node.js Hosting (Render, Railway, Fly.io, VPS)**:
   - Root directory: `web`
   - Start command: `node server.js`
   - Optional environment variables: `PORT`, `BANK_SESSION_SECRET`

2. **Static Hosting (Vercel, Netlify, GitHub Pages, Cloudflare Pages)**:
   - Publish / root directory: `web/public`
   - When no `/api/health` backend is present, the app automatically switches to its built-in browser ledger engine (`localStorage`) so all banking flows still work out of the box.


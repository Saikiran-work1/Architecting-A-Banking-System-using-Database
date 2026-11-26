# Bank application database setup

The application reads its MySQL connection settings from environment variables:

- `BANK_DB_URL` (for example, `jdbc:mysql://localhost:3306/bank`)
- `BANK_DB_USERNAME`
- `BANK_DB_PASSWORD`

In PowerShell, set them for the current terminal session before starting the app:

```powershell
$env:BANK_DB_URL = "jdbc:mysql://localhost:3306/bank"
$env:BANK_DB_USERNAME = "your_database_user"
$env:BANK_DB_PASSWORD = "your_database_password"
java -cp ".;lib/*" BankSystem
```

The database must already contain the `accounts` table with `account_number`,
`customer_name`, `password`, `balance` (`DECIMAL(19,2)`), and `is_active` columns.
On startup, the app creates `bank_transactions` if it does not exist. The MySQL
user needs permission to read and update `accounts`, insert accounts and ledger
rows, and create the transaction table once.

Balances use `BigDecimal`; deposits, withdrawals, transfers, and their ledger
entries commit together. Monetary input with more than two nonzero decimal
places is rejected. Do not commit credentials to source control. Since the old
root password was exposed in source, rotate it in MySQL and set the new value
only in `BANK_DB_PASSWORD` (prefer a dedicated application user over `root`).

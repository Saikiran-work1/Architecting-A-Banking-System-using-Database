# Architecting-A-Banking-System-using-Database
# Console Banking System (Java + JDBC + MySQL)

A command-line banking application written in Java. Customers can create an account, log in, check balance, deposit, withdraw, transfer money, change their password and close their account. All data is stored in MySQL, passwords are hashed with BCrypt, and every money movement is recorded in a transaction ledger.

This project was built as a learning exercise. Besides explaining how to run it, this README documents the **architecture**, the **SQL we wrote**, the **security decisions** (password hashing, credentials), the **exception handling strategy**, and **what we learned** along the way.

---

## Table of Contents

1. [Features](#1-features)
2. [Tech Stack](#2-tech-stack)
3. [Project Structure](#3-project-structure)
4. [Architecture](#4-architecture)
5. [Database Design and SQL](#5-database-design-and-sql)
6. [Password Hashing with BCrypt](#6-password-hashing-with-bcrypt)
7. [Money Handling with BigDecimal](#7-money-handling-with-bigdecimal)
8. [Transactions (ACID) in JDBC](#8-transactions-acid-in-jdbc)
9. [Exception Handling](#9-exception-handling)
10. [Configuration and Secrets](#10-configuration-and-secrets)
11. [Setup and Running](#11-setup-and-running)
12. [Sample Session](#12-sample-session)
13. [What We Learned](#13-what-we-learned)
14. [Known Limitations and Future Improvements](#14-known-limitations-and-future-improvements)

---

## 1. Features

| Feature | Description |
|---|---|
| Create account | Name and password; the database generates the account number |
| Login | Account number and password verified against a BCrypt hash |
| Check balance | Reads the balance of the logged-in account |
| Deposit | Adds money and records a ledger entry |
| Withdraw | Subtracts money only if the balance is sufficient |
| Transfer | Moves money between two active accounts atomically |
| Change password | Re-hashes the new password and updates the database |
| Close account | Allowed only when the balance is exactly zero (soft close) |
| Transaction ledger | Every deposit, withdrawal and transfer is stored in `bank_transactions` |

---

## 2. Tech Stack

- **Java 11+** (uses `String.isBlank()`, try-with-resources, `BigDecimal`)
- **JDBC** for database access (no ORM, so we see the raw SQL)
- **MySQL 8** as the database
- **jBCrypt** (`org.mindrot.jbcrypt`) for password hashing
- **MySQL Connector/J** as the JDBC driver

---

## 3. Project Structure

```
.
├── BankSystem.java          # Console UI (menus, input reading)
├── Bank.java                # Business/service layer + in-memory account cache
├── AccountDAO.java          # Data Access Object: all SQL lives here
├── DatabaseConnection.java  # Connection factory + schema initialisation
├── Account.java             # Domain model (customer account)
├── Transaction.java         # Domain model (ledger entry)
├── PasswordUtil.java        # BCrypt hash and verify helpers
├── README.md
└── lib/                     # jbcrypt.jar and mysql-connector-j.jar
```

| Class | Responsibility |
|---|---|
| `BankSystem` | Presentation layer. Prints menus, reads input, calls `Bank`. Contains **no SQL**. |
| `Bank` | Service layer. Validates business rules, calls the DAO, then keeps the in-memory objects in sync. |
| `AccountDAO` | Persistence layer. Executes SQL with `PreparedStatement`, manages DB transactions. |
| `DatabaseConnection` | Reads credentials from environment variables, opens connections, creates the ledger table. |
| `Account` | Holds account state and simple rules (positive amounts, no overdraft). |
| `Transaction` | Immutable value object describing a ledger row. |
| `PasswordUtil` | One place for hashing and verifying passwords. |

---

## 4. Architecture

The application follows a classic **layered architecture**. Each layer only talks to the layer directly below it.

```
┌─────────────────────────────────────────────┐
│  Presentation Layer      BankSystem         │  console menus, Scanner input
└───────────────────────┬─────────────────────┘
                        │ calls
┌───────────────────────▼─────────────────────┐
│  Service / Business Layer     Bank          │  rules, orchestration, cache
└───────────────────────┬─────────────────────┘
                        │ calls
┌───────────────────────▼─────────────────────┐
│  Data Access Layer        AccountDAO        │  SQL, JDBC transactions
└───────────────────────┬─────────────────────┘
                        │ uses
┌───────────────────────▼─────────────────────┐
│  Infrastructure     DatabaseConnection      │  env vars, DriverManager
│                     PasswordUtil (BCrypt)   │
└───────────────────────┬─────────────────────┘
                        │
                   MySQL database
```

Domain models (`Account`, `Transaction`) are used by all layers.

### 4.1 Design decisions

**DAO pattern.** All SQL is isolated in `AccountDAO`. If we ever switch from MySQL to PostgreSQL, or from JDBC to JPA, only this class changes.

**Database is the source of truth.** The `Bank` class keeps a `List<Account>` in memory for fast lookups, but every money movement is first applied in the database. Only if the database update succeeds is the in-memory object updated:

```java
// Bank.deposit
if (!accountDAO.deposit(accountNumber, amount)) return false;  // DB first
return account.deposit(amount);                                 // then memory
```

**Defence in depth (validate twice).** Rules like "amount must be positive" and "balance must be enough" are checked in `Bank` (fast feedback), in `Account` (domain rule), and again in SQL (`WHERE balance >= ?`). The SQL check is the one that truly protects the data, because it is atomic.

**Database generates account numbers.** `AUTO_INCREMENT` plus `RETURN_GENERATED_KEYS` means we never risk two accounts with the same number.

**Soft close.** Closing an account sets `is_active = FALSE` instead of deleting the row, so the transaction history stays valid.

### 4.2 Request flow example: Transfer

```
User chooses "Transfer"
  → BankSystem.transfer()          reads receiver number + amount
    → Bank.transfer()              checks both accounts exist, are active, amount > 0, enough balance
      → AccountDAO.transfer()      BEGIN
                                     UPDATE payer   SET balance = balance - ? ... AND balance >= ?
                                     UPDATE receiver SET balance = balance + ?
                                     INSERT INTO bank_transactions ...
                                   COMMIT  (or ROLLBACK on any failure)
      ← true / false
    → Bank updates in-memory payer and receiver balances
  ← "Transfer successful." / "Transfer failed."
```

---

## 5. Database Design and SQL

### 5.1 The `accounts` table

The application expects this table to exist already. A suggested definition:

```sql
CREATE DATABASE IF NOT EXISTS bank;
USE bank;

CREATE TABLE IF NOT EXISTS accounts (
    account_number INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    customer_name  VARCHAR(100) NOT NULL,
    password       VARCHAR(100) NOT NULL,          -- BCrypt hash (60 chars)
    balance        DECIMAL(19,2) NOT NULL DEFAULT 0.00,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE
);
```

Why these choices:

- `DECIMAL(19,2)` for money. Never `FLOAT` or `DOUBLE`, which cannot represent values like 0.10 exactly.
- `password` column holds the BCrypt hash, never the plain password.
- `AUTO_INCREMENT` lets MySQL assign unique account numbers.

### 5.2 The `bank_transactions` table (created by the app)

`DatabaseConnection.initializeSchema()` runs this at startup:

```sql
CREATE TABLE IF NOT EXISTS bank_transactions (
    transaction_id          BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    payer_account_number    INT NULL,
    receiver_account_number INT NULL,
    amount                  DECIMAL(19,2) NOT NULL,
    transaction_type        VARCHAR(20) NOT NULL,
    created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_bank_transactions_payer (payer_account_number),
    INDEX idx_bank_transactions_receiver (receiver_account_number)
);
```

Key ideas:

- `CREATE TABLE IF NOT EXISTS` makes startup **idempotent**: running the app many times is safe.
- `payer` and `receiver` are `NULL`able because a **deposit** has no payer (money comes from outside) and a **withdrawal** has no receiver.
- Indexes on both account columns make "show all transactions for account X" fast.
- `created_at` defaults to the current timestamp, so Java never has to supply it.

How each operation fills the ledger:

| Type | payer | receiver |
|---|---|---|
| Deposit | `NULL` | account number |
| Withdrawal | account number | `NULL` |
| Transfer | payer account | receiver account |

### 5.3 Every query used in the project

**Create an account** (returns the generated key):

```sql
INSERT INTO accounts (customer_name, password, balance, is_active) VALUES (?, ?, ?, ?);
```

**Load all accounts at startup:**

```sql
SELECT account_number, customer_name, password, balance, is_active FROM accounts;
```

**Deposit** (only into an active account):

```sql
UPDATE accounts SET balance = balance + ? WHERE account_number = ? AND is_active = TRUE;
```

**Withdraw** (only if active and enough money):

```sql
UPDATE accounts SET balance = balance - ?
WHERE account_number = ? AND is_active = TRUE AND balance >= ?;
```

**Transfer** (two updates and one insert in one transaction):

```sql
UPDATE accounts SET balance = balance - ? WHERE account_number = ? AND is_active = TRUE AND balance >= ?;
UPDATE accounts SET balance = balance + ? WHERE account_number = ? AND is_active = TRUE;
INSERT INTO bank_transactions (payer_account_number, receiver_account_number, amount, transaction_type)
VALUES (?, ?, ?, ?);
```

**Change password:**

```sql
UPDATE accounts SET password = ? WHERE account_number = ?;
```

**Close account** (only if balance is exactly zero):

```sql
UPDATE accounts SET is_active = FALSE
WHERE account_number = ? AND is_active = TRUE AND balance = 0;
```

### 5.4 SQL techniques we practised

**1. `PreparedStatement` and `?` placeholders.** Values are never concatenated into the SQL string. This prevents **SQL injection**. Compare:

```java
// DANGEROUS: never do this
String sql = "SELECT * FROM accounts WHERE account_number = " + userInput;

// SAFE: what this project does
PreparedStatement ps = con.prepareStatement("SELECT * FROM accounts WHERE account_number = ?");
ps.setInt(1, accountNumber);
```

**2. Atomic arithmetic in SQL.** We write `balance = balance - ?` instead of reading the balance in Java, subtracting, and writing it back. The read-modify-write approach can lose updates if two operations happen together. The single `UPDATE` is atomic.

**3. Conditions inside the `WHERE` clause.** `AND balance >= ?` turns the overdraft check and the update into one indivisible step. If the condition fails, **0 rows are updated**.

**4. Checking `executeUpdate()` row counts.** It returns the number of affected rows. We treat anything other than exactly `1` as failure:

```java
if (ps.executeUpdate() != 1) { con.rollback(); return false; }
```

**5. Generated keys.**

```java
con.prepareStatement(sql, PreparedStatement.RETURN_GENERATED_KEYS);
...
try (ResultSet keys = ps.getGeneratedKeys()) {
    if (keys.next()) account.setAccountNumber(keys.getInt(1));
}
```

**6. Handling `NULL` in JDBC.** Use `setNull(index, Types.INTEGER)` for missing payer or receiver, and `Integer` (not `int`) in Java so null is representable.

**7. Indexes.** Added on foreign-key-like columns to speed up lookups.

**8. try-with-resources.** `Connection`, `PreparedStatement` and `ResultSet` are all `AutoCloseable`, so they are closed automatically even when exceptions occur. No resource leaks.

### 5.5 Handy queries for exploring the data

```sql
-- All accounts
SELECT account_number, customer_name, balance, is_active FROM accounts;

-- Full ledger, newest first
SELECT * FROM bank_transactions ORDER BY created_at DESC;

-- History of one account (as payer or receiver)
SELECT * FROM bank_transactions
WHERE payer_account_number = 1 OR receiver_account_number = 1
ORDER BY created_at DESC;

-- Total money held by the bank
SELECT SUM(balance) AS total_deposits FROM accounts WHERE is_active = TRUE;

-- Integrity check: does ledger activity agree with balances?
SELECT a.account_number, a.balance,
       COALESCE(SUM(CASE WHEN t.receiver_account_number = a.account_number THEN t.amount END), 0)
     - COALESCE(SUM(CASE WHEN t.payer_account_number    = a.account_number THEN t.amount END), 0) AS ledger_balance
FROM accounts a
LEFT JOIN bank_transactions t
       ON a.account_number IN (t.payer_account_number, t.receiver_account_number)
GROUP BY a.account_number, a.balance;
```

---

## 6. Password Hashing with BCrypt

### 6.1 Why hash?

If the database is leaked, plain-text passwords expose every customer (and every other site where they reused that password). Passwords must be stored as one-way **hashes**.

### 6.2 Why BCrypt and not SHA-256 or MD5?

| | MD5 / SHA-256 | BCrypt |
|---|---|---|
| Speed | Very fast (bad for passwords: attackers try billions per second) | Deliberately slow |
| Salt | You must add it yourself | Built in, random per password |
| Tunable cost | No | Yes (work factor) |

### 6.3 How it is used here

```java
public static String hashPassword(String password) {
    return BCrypt.hashpw(password, BCrypt.gensalt(12));   // cost factor 12
}

public static boolean verifyPassword(String password, String hashedPassword) {
    return BCrypt.checkpw(password, hashedPassword);
}
```

A stored hash looks like this:

```
$2a$12$N9qo8uLOickgx2ZMRZoMye...(60 characters total)
 │   │  └── salt + hash
 │   └───── cost factor (2^12 rounds)
 └───────── algorithm version
```

What we learned:

- **Salt is random and stored inside the hash**, so two users with the same password get different hashes, and we need no separate salt column.
- **Verification re-hashes** the typed password using the salt and cost from the stored hash, then compares. We never "decrypt" anything.
- **Cost factor 12** means 2¹² iterations. Raising it by 1 doubles the time. Pick the highest value that still feels fast enough on your server.
- **Never hash a hash.** `Account` has a second constructor with an `alreadyHashed` flag, used when loading rows from the database. Without it, loading an account would hash the existing BCrypt string again, and the user could never log in.

```java
Account(int accountNumber, String customerName, String passwordHash,
        BigDecimal balance, boolean active, boolean alreadyHashed)
```

- **Rollback on failure.** `Bank.changePassword` remembers the old hash, and restores it if the database update fails, so memory and database never disagree.

You can test the hashing on its own:

```bash
java -cp ".;lib/*" PasswordUtil
```

It prints the hash, then `true` for the correct password and `false` for a wrong one.

---

## 7. Money Handling with BigDecimal

Using `double` for money is a classic bug:

```java
System.out.println(0.1 + 0.2);   // 0.30000000000000004
```

So this project uses `java.math.BigDecimal` everywhere and `DECIMAL(19,2)` in MySQL.

Key points:

- Compare with `compareTo`, **not** `equals` (`new BigDecimal("2.0").equals(new BigDecimal("2.00"))` is `false`).
- Use `signum()` to test sign: `amount.signum() <= 0` means zero or negative.
- Create from a `String` (`new BigDecimal("10.50")`), never from a `double`.
- **Two-decimal validation** in `AccountDAO.validAmount`:

```java
amount.setScale(2, RoundingMode.UNNECESSARY);
```

`RoundingMode.UNNECESSARY` throws `ArithmeticException` if rounding would be needed. So `10.50` and `10.5` pass, while `10.555` is rejected. We use an exception as a validation signal here.

---

## 8. Transactions (ACID) in JDBC

A transfer is two balance updates plus a ledger row. If the app crashes between the debit and the credit, money would vanish. Database **transactions** solve this: either everything happens or nothing does.

The pattern used in `AccountDAO`:

```java
try (Connection con = DatabaseConnection.getConnection()) {
    con.setAutoCommit(false);              // 1. start a transaction
    try {
        // 2. run several statements
        // if any check fails:  con.rollback(); return false;
        con.commit();                      // 3. make it permanent
        return true;
    } catch (SQLException e) {
        con.rollback();                    // 4. undo everything on error
        throw e;
    }
}
```

| Letter | Meaning | Where we see it |
|---|---|---|
| **A**tomicity | All or nothing | Debit, credit and ledger insert commit together |
| **C**onsistency | Rules always hold | `balance >= ?` prevents negative balances |
| **I**solation | Concurrent operations do not interfere | Row locks taken by `UPDATE` |
| **D**urability | Committed data survives crashes | MySQL InnoDB |

Important details:

- JDBC defaults to **auto-commit**, where every statement commits immediately. Turning it off is what creates a transaction.
- The ledger row is inserted **in the same transaction** as the balance change, so the ledger can never disagree with the balances.
- The table must use the **InnoDB** engine (default in MySQL 8) for transactions to work.

---

## 9. Exception Handling

We handled errors at the layer where they can be dealt with meaningfully.

| Exception | Where | How it is handled |
|---|---|---|
| `SQLException` | `AccountDAO` | Caught, a message is printed to `System.err`, the method returns `false`. Inside transactions it triggers `rollback()` first. |
| `SQLException` (rethrown) | `getAllAccounts`, `initializeSchema` | Declared with `throws`, because startup cannot continue without the database. |
| `IllegalStateException` | `DatabaseConnection.requiredEnv` | Thrown when an environment variable is missing or blank (**fail fast**). |
| `IllegalStateException` | `Bank` constructor | Wraps the `SQLException` with a clear message and the original cause (**exception chaining**). |
| `ArithmeticException` | `AccountDAO.validAmount` | Used to detect more than 2 decimal places. |
| `NumberFormatException` | `BankSystem.readAmount` | Caught, prints "Invalid amount." and returns `BigDecimal.ZERO`, which later fails validation. |
| Null checks | `Bank`, `Account` | Methods return `false` or `null` for missing accounts or `null` amounts instead of throwing `NullPointerException`. |

### Patterns worth remembering

**Translate exceptions between layers.** A low-level `IllegalStateException` for a missing env var is converted into an `SQLException` inside `getConnection()`, so callers only need to deal with one exception type:

```java
try {
    return DriverManager.getConnection(requiredEnv("BANK_DB_URL"), ...);
} catch (IllegalStateException e) {
    throw new SQLException(e.getMessage(), e);
}
```

**Nested try blocks for rollback.** The outer `try` owns the connection (closing it automatically). The inner `try` handles rollback. If `rollback()` is called and the exception is re-thrown, the outer `catch` reports it.

**Chain the cause.** `new IllegalStateException("message", e)` keeps the original stack trace for debugging.

**Do not leak secrets in messages.** Error output only prints `e.getMessage()` and never the password or connection string.

**Return value vs exception.** Expected, normal failures (insufficient funds, wrong password) return `false` or `null`. Unexpected failures (database down, missing config) use exceptions.

---

## 10. Configuration and Secrets

Credentials are **not** in the source code. They are read from environment variables:

| Variable | Example |
|---|---|
| `BANK_DB_URL` | `jdbc:mysql://localhost:3306/bank` |
| `BANK_DB_USERNAME` | `bank_app` |
| `BANK_DB_PASSWORD` | *(your password)* |

Lessons learned:

- A password hard-coded in source ends up in Git history forever. Since the original root password was once exposed in code, **rotate it** and set the new value only in the environment.
- Use a **dedicated MySQL user** with limited privileges instead of `root`:

```sql
CREATE USER 'bank_app'@'localhost' IDENTIFIED BY 'a_strong_password';
GRANT SELECT, INSERT, UPDATE ON bank.accounts TO 'bank_app'@'localhost';
GRANT SELECT, INSERT, CREATE ON bank.bank_transactions TO 'bank_app'@'localhost';
FLUSH PRIVILEGES;
```

- Add a `.gitignore` for anything containing secrets and for compiled files:

```
*.class
.env
lib/
```

---

## 11. Setup and Running

### Prerequisites

- JDK 11 or newer
- MySQL 8 running locally
- `jbcrypt-0.4.jar` and `mysql-connector-j-*.jar` placed in a `lib/` folder

### Steps

1. **Create the database and `accounts` table** using the SQL in [section 5.1](#51-the-accounts-table).

2. **Set the environment variables.**

   PowerShell (Windows):

   ```powershell
   $env:BANK_DB_URL = "jdbc:mysql://localhost:3306/bank"
   $env:BANK_DB_USERNAME = "bank_app"
   $env:BANK_DB_PASSWORD = "your_database_password"
   ```

   Bash (Linux/macOS):

   ```bash
   export BANK_DB_URL="jdbc:mysql://localhost:3306/bank"
   export BANK_DB_USERNAME="bank_app"
   export BANK_DB_PASSWORD="your_database_password"
   ```

3. **Compile.**

   ```powershell
   javac -cp ".;lib/*" *.java
   ```

   (On Linux/macOS use `:` instead of `;` in the classpath: `-cp ".:lib/*"`.)

4. **Run.**

   ```powershell
   java -cp ".;lib/*" BankSystem
   ```

The `bank_transactions` table is created automatically on first start.

### Common problems

| Symptom | Likely cause |
|---|---|
| `Missing required environment variable` | Variables not set in the **same terminal** that runs Java |
| `No suitable driver found` | MySQL Connector jar not on the classpath |
| `ClassNotFoundException: org.mindrot.jbcrypt.BCrypt` | jBCrypt jar not on the classpath |
| `Access denied for user` | Wrong username or password, or missing privileges |
| `Table 'bank.accounts' doesn't exist` | The `accounts` table has not been created |
| `Could not initialize or load the bank database` | MySQL not running or wrong URL |

---

## 12. Sample Session

```
===== WELCOME TO OUR BANK =====
1. Create Account
2. Login
3. Exit
Enter your choice: 1
Enter your name: Ravi
Create your password: Secret@123
Account created successfully.
Your account number is: 1

Enter your choice: 2
Enter your account number: 1
Enter your password: Secret@123
Login successful.

===== ACCOUNT DASHBOARD =====
Welcome, Ravi
...
Enter your choice: 2
Enter amount: 5000.50
Amount deposited successfully.

Enter your choice: 3
Enter amount: 99999
Insufficient balance or invalid amount.
```

---

## 13. What We Learned

**Java and OOP**
- Separating code into layers (UI, service, data access) makes each class small and testable.
- Encapsulation: `private` fields with controlled getters and setters; package-private methods (`getPasswordHash`) for internal use only.
- Constructor overloading (the `alreadyHashed` flag) to handle two different creation scenarios.
- Immutable objects (`Transaction` uses `final` fields).
- Using wrapper types (`Integer`) when `null` is a valid value.

**SQL and JDBC**
- Writing `INSERT`, `SELECT` and conditional `UPDATE` statements, and wiring them with `PreparedStatement`.
- Preventing SQL injection with parameters.
- Using `DECIMAL` for money, indexes for speed, `NULL` where data is legitimately absent.
- Manual transaction control: `setAutoCommit(false)`, `commit()`, `rollback()`.
- Doing safe arithmetic inside SQL rather than in Java.
- Reading the affected row count to know whether an update really happened.
- Closing resources properly with try-with-resources.

**Security**
- Never store plain-text passwords; use a slow, salted algorithm such as BCrypt.
- Never hard-code credentials; use environment variables and a least-privilege database user.
- Rotate any secret that has ever been committed.

**Correctness**
- Floating-point numbers are unsuitable for money; `BigDecimal` is the correct tool.
- Validate at several layers, but let the **database enforce the final rule** atomically.
- Keep the in-memory state and the database consistent: write to the database first, update memory afterwards.

**Error handling**
- Fail fast on bad configuration, recover gracefully from expected user errors.
- Chain exceptions to keep the root cause.
- Roll back on failure so partial changes never persist.

---

## 14. Known Limitations and Future Improvements

Being honest about the weak spots is part of learning. These are good next steps:

1. **Non-numeric menu input crashes the app.** `scanner.nextInt()` throws `InputMismatchException` if the user types letters. Fix: read lines with `nextLine()` and parse with `Integer.parseInt` inside a `try/catch`.
2. **`readAmount` returns zero on bad input**, which then fails later with a generic message. Returning `null` or throwing a custom exception would allow a clearer error.
3. **In-memory cache can go stale.** If another process changes the database, `Bank`'s list will not know. Options: query the database for each operation, or drop the cache.
4. **Not thread-safe.** The `ArrayList` and `Account` fields have no synchronization. Fine for a single-user console app, not for a server.
5. **No login attempt limit.** Add a failed-attempts counter and temporary lockout.
6. **Password policy.** No minimum length or complexity checks; empty passwords are accepted.
7. **`Transaction` class is not used yet.** Add `AccountDAO.getTransactions(accountNumber)` and a "Mini Statement" menu option that prints them.
8. **No connection pooling.** A new connection is opened per operation. Use HikariCP for real workloads.
9. **No automated tests.** Add JUnit tests for `Account` and `PasswordUtil`, and integration tests against a test database.
10. **Use a build tool.** Maven or Gradle would manage the jBCrypt and MySQL dependencies instead of a manual `lib/` folder.
11. **Replace `System.out` / `System.err` with a logging library** (SLF4J + Logback).
12. **Account closing is irreversible from the UI.** Consider an admin "reactivate" option.
13. **Stored procedures / constraints.** Add `CHECK (balance >= 0)` (MySQL 8.0.16+) as an extra database-level safety net.

---

## License

Educational project. Use and modify freely.

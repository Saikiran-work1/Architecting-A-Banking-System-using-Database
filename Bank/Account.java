import java.math.BigDecimal;

class Account {
    private int accountNumber;
    private final String customerName;
    private String passwordHash;
    private BigDecimal balance;
    private boolean active;

    public Account(int accountNumber, String customerName, String password) {
        this(accountNumber, customerName, PasswordUtil.hashPassword(password),
             BigDecimal.ZERO, true, true);
    }

    // Used when loading a persisted BCrypt hash; never hash the hash again.
    Account(int accountNumber, String customerName, String passwordHash,
            BigDecimal balance, boolean active, boolean alreadyHashed) {
        this.accountNumber = accountNumber;
        this.customerName = customerName;
        this.passwordHash = alreadyHashed ? passwordHash : PasswordUtil.hashPassword(passwordHash);
        this.balance = balance;
        this.active = active;
    }

    public boolean deposit(BigDecimal amount) {
        if (amount == null || amount.signum() <= 0) return false;
        balance = balance.add(amount);
        return true;
    }

    public boolean withdraw(BigDecimal amount) {
        if (amount == null || amount.signum() <= 0 || amount.compareTo(balance) > 0) return false;
        balance = balance.subtract(amount);
        return true;
    }

    public BigDecimal checkBalance() { return balance; }
    public boolean verifyPassword(String password) { return PasswordUtil.verifyPassword(password, passwordHash); }
    public void closeAccount() { active = false; }
    public void changePassword(String newPassword) { passwordHash = PasswordUtil.hashPassword(newPassword); }
    public String getName() { return customerName; }
    public int getAccountNumber() { return accountNumber; }
    public boolean isActive() { return active; }
    String getPasswordHash() { return passwordHash; }
    void setPasswordHash(String passwordHash) { this.passwordHash = passwordHash; }
    public void setAccountNumber(int accountNumber) { this.accountNumber = accountNumber; }
    public void setBalance(BigDecimal balance) { this.balance = balance; }
    public void setActive(boolean active) { this.active = active; }
}

import java.math.BigDecimal;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;

class Bank {
    private final List<Account> accounts = new ArrayList<>();
    private final AccountDAO accountDAO = new AccountDAO();

    public Bank() {
        try {
            DatabaseConnection.initializeSchema();
            accounts.addAll(accountDAO.getAllAccounts());
        } catch (SQLException e) {
            throw new IllegalStateException("Could not initialize or load the bank database", e);
        }
    }

    public Account createAccount(String customerName, String password) {
        Account account = new Account(0, customerName, password);
        if (!accountDAO.createAccount(account)) return null;
        accounts.add(account);
        return account;
    }

    public Account findAccount(int accountNumber) {
        for (Account account : accounts) if (account.getAccountNumber() == accountNumber) return account;
        return null;
    }

    public boolean deposit(int accountNumber, BigDecimal amount) {
        Account account = findAccount(accountNumber);
        if (account == null || !account.isActive() || amount == null || amount.signum() <= 0) return false;
        if (!accountDAO.deposit(accountNumber, amount)) return false;
        return account.deposit(amount);
    }

    public boolean withdraw(int accountNumber, BigDecimal amount) {
        Account account = findAccount(accountNumber);
        if (account == null || !account.isActive() || amount == null || amount.signum() <= 0
                || amount.compareTo(account.checkBalance()) > 0) return false;
        if (!accountDAO.withdraw(accountNumber, amount)) return false;
        return account.withdraw(amount);
    }

    public boolean transfer(int payerAcNo, int receiverAcNo, BigDecimal amount) {
        Account payer = findAccount(payerAcNo);
        Account receiver = findAccount(receiverAcNo);
        if (payer == null || receiver == null || payerAcNo == receiverAcNo
                || !payer.isActive() || !receiver.isActive() || amount == null || amount.signum() <= 0
                || amount.compareTo(payer.checkBalance()) > 0) return false;
        if (!accountDAO.transfer(payerAcNo, receiverAcNo, amount)) return false;
        payer.withdraw(amount);
        receiver.deposit(amount);
        return true;
    }

    public boolean closeAccount(int accountNumber) {
        Account account = findAccount(accountNumber);
        if (account == null || !account.isActive()
                || account.checkBalance().compareTo(BigDecimal.ZERO) != 0
                || !accountDAO.closeAccount(accountNumber)) return false;
        account.closeAccount();
        return true;
    }

    public boolean changePassword(Account account, String password) {
        String oldHash = account.getPasswordHash();
        account.changePassword(password);
        if (accountDAO.updatePassword(account)) return true;
        account.setPasswordHash(oldHash);
        return false;
    }
}

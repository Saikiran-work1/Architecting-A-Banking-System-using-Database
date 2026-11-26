import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;

class AccountDAO {
    public boolean createAccount(Account account) {
        String sql = "INSERT INTO accounts (customer_name, password, balance, is_active) VALUES (?, ?, ?, ?)";
        try (Connection con = DatabaseConnection.getConnection();
             PreparedStatement ps = con.prepareStatement(sql, PreparedStatement.RETURN_GENERATED_KEYS)) {
            ps.setString(1, account.getName());
            ps.setString(2, account.getPasswordHash());
            ps.setBigDecimal(3, BigDecimal.ZERO);
            ps.setBoolean(4, account.isActive());
            if (ps.executeUpdate() != 1) return false;
            try (ResultSet keys = ps.getGeneratedKeys()) {
                if (!keys.next()) return false;
                account.setAccountNumber(keys.getInt(1));
                return true;
            }
        } catch (SQLException e) {
            System.err.println("Database error creating account: " + e.getMessage());
            return false;
        }
    }

    public List<Account> getAllAccounts() throws SQLException {
        List<Account> accounts = new ArrayList<>();
        String sql = "SELECT account_number, customer_name, password, balance, is_active FROM accounts";
        try (Connection con = DatabaseConnection.getConnection();
             PreparedStatement ps = con.prepareStatement(sql);
             ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                accounts.add(new Account(rs.getInt("account_number"), rs.getString("customer_name"),
                        rs.getString("password"), rs.getBigDecimal("balance"), rs.getBoolean("is_active"), true));
            }
        }
        return accounts;
    }

    public boolean deposit(int accountNumber, BigDecimal amount) {
        return applySingleAccountChange(accountNumber, amount, "Deposit", true);
    }

    public boolean withdraw(int accountNumber, BigDecimal amount) {
        return applySingleAccountChange(accountNumber, amount, "Withdrawal", false);
    }

    private boolean applySingleAccountChange(int accountNumber, BigDecimal amount, String type, boolean deposit) {
        if (!validAmount(amount)) return false;
        String update = deposit
                ? "UPDATE accounts SET balance = balance + ? WHERE account_number = ? AND is_active = TRUE"
                : "UPDATE accounts SET balance = balance - ? WHERE account_number = ? AND is_active = TRUE AND balance >= ?";
        try (Connection con = DatabaseConnection.getConnection()) {
            con.setAutoCommit(false);
            try {
                try (PreparedStatement ps = con.prepareStatement(update)) {
                    ps.setBigDecimal(1, amount);
                    ps.setInt(2, accountNumber);
                    if (!deposit) ps.setBigDecimal(3, amount);
                    if (ps.executeUpdate() != 1) { con.rollback(); return false; }
                }
                insertTransaction(con, deposit ? null : accountNumber, deposit ? accountNumber : null, amount, type);
                con.commit();
                return true;
            } catch (SQLException e) {
                con.rollback();
                throw e;
            }
        } catch (SQLException e) {
            System.err.println("Database error recording " + type.toLowerCase() + ": " + e.getMessage());
            return false;
        }
    }

    public boolean transfer(int from, int to, BigDecimal amount) {
        if (from == to || !validAmount(amount)) return false;
        try (Connection con = DatabaseConnection.getConnection()) {
            con.setAutoCommit(false);
            try {
                try (PreparedStatement debit = con.prepareStatement(
                        "UPDATE accounts SET balance = balance - ? WHERE account_number = ? AND is_active = TRUE AND balance >= ?");
                     PreparedStatement credit = con.prepareStatement(
                        "UPDATE accounts SET balance = balance + ? WHERE account_number = ? AND is_active = TRUE")) {
                    debit.setBigDecimal(1, amount); debit.setInt(2, from); debit.setBigDecimal(3, amount);
                    if (debit.executeUpdate() != 1) { con.rollback(); return false; }
                    credit.setBigDecimal(1, amount); credit.setInt(2, to);
                    if (credit.executeUpdate() != 1) { con.rollback(); return false; }
                }
                insertTransaction(con, from, to, amount, "Transfer");
                con.commit();
                return true;
            } catch (SQLException e) {
                con.rollback();
                throw e;
            }
        } catch (SQLException e) {
            System.err.println("Database error recording transfer: " + e.getMessage());
            return false;
        }
    }

    private void insertTransaction(Connection con, Integer payer, Integer receiver,
                                   BigDecimal amount, String type) throws SQLException {
        String sql = "INSERT INTO bank_transactions (payer_account_number, receiver_account_number, amount, transaction_type) VALUES (?, ?, ?, ?)";
        try (PreparedStatement ps = con.prepareStatement(sql)) {
            if (payer == null) ps.setNull(1, java.sql.Types.INTEGER); else ps.setInt(1, payer);
            if (receiver == null) ps.setNull(2, java.sql.Types.INTEGER); else ps.setInt(2, receiver);
            ps.setBigDecimal(3, amount);
            ps.setString(4, type);
            ps.executeUpdate();
        }
    }

    public boolean updatePassword(Account account) {
        String sql = "UPDATE accounts SET password = ? WHERE account_number = ?";
        try (Connection con = DatabaseConnection.getConnection(); PreparedStatement ps = con.prepareStatement(sql)) {
            ps.setString(1, account.getPasswordHash());
            ps.setInt(2, account.getAccountNumber());
            return ps.executeUpdate() == 1;
        } catch (SQLException e) {
            System.err.println("Database error updating password: " + e.getMessage());
            return false;
        }
    }

    public boolean closeAccount(int accountNumber) {
        String sql = "UPDATE accounts SET is_active = FALSE "
                + "WHERE account_number = ? AND is_active = TRUE AND balance = 0";
        try (Connection con = DatabaseConnection.getConnection(); PreparedStatement ps = con.prepareStatement(sql)) {
            ps.setInt(1, accountNumber);
            return ps.executeUpdate() == 1;
        } catch (SQLException e) {
            System.err.println("Database error closing account: " + e.getMessage());
            return false;
        }
    }

    private boolean validAmount(BigDecimal amount) {
        if (amount == null || amount.signum() <= 0) return false;
        try {
            amount.setScale(2, RoundingMode.UNNECESSARY);
            return true;
        } catch (ArithmeticException e) {
            return false;
        }
    }
}

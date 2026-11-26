import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;

public class DatabaseConnection {
    private static String requiredEnv(String key) {
        String value = System.getenv(key);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Missing required environment variable: " + key);
        }
        return value;
    }

    public static Connection getConnection() throws SQLException {
        try {
            return DriverManager.getConnection(requiredEnv("BANK_DB_URL"),
                    requiredEnv("BANK_DB_USERNAME"), requiredEnv("BANK_DB_PASSWORD"));
        } catch (IllegalStateException e) {
            throw new SQLException(e.getMessage(), e);
        }
    }

    public static void initializeSchema() throws SQLException {
        String sql = "CREATE TABLE IF NOT EXISTS bank_transactions ("
                + "transaction_id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,"
                + "payer_account_number INT NULL, receiver_account_number INT NULL,"
                + "amount DECIMAL(19,2) NOT NULL, transaction_type VARCHAR(20) NOT NULL,"
                + "created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,"
                + "INDEX idx_bank_transactions_payer (payer_account_number),"
                + "INDEX idx_bank_transactions_receiver (receiver_account_number))";
        try (Connection con = getConnection(); Statement statement = con.createStatement()) {
            statement.executeUpdate(sql);
        }
    }
}

import java.math.BigDecimal;

class Transaction {
    private final long transactionId;
    private final Integer payerAcNo;
    private final Integer receiverAcNo;
    private final BigDecimal amount;
    private final String transactionType;

    public Transaction(long transactionId, Integer payerAcNo, Integer receiverAcNo,
                       BigDecimal amount, String transactionType) {
        this.transactionId = transactionId;
        this.payerAcNo = payerAcNo;
        this.receiverAcNo = receiverAcNo;
        this.amount = amount;
        this.transactionType = transactionType;
    }

    public String getTransactionDetails() {
        return "Transaction ID: " + transactionId + "\nPayer Account Number: " + payerAcNo
                + "\nReceiver Account Number: " + receiverAcNo + "\nAmount: " + amount
                + "\nTransaction Type: " + transactionType;
    }
}

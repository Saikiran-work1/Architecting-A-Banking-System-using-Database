import java.util.Scanner;
import java.math.BigDecimal;

class BankSystem
{
    public static void main(String[] args)
    {
        Scanner scanner = new Scanner(System.in);
        Bank bank = new Bank();

        while (true)
        {
            System.out.println("\n===== WELCOME TO OUR BANK =====");
            System.out.println("1. Create Account");
            System.out.println("2. Login");
            System.out.println("3. Exit");
            System.out.print("Enter your choice: ");

            int choice = scanner.nextInt();
            scanner.nextLine();

            if (choice == 1)
            {
                createAccount(bank, scanner);
            }
            else if (choice == 2)
            {
                login(bank, scanner);
            }
            else if (choice == 3)
            {
                System.out.println("Thank you for using our bank.");
                break;
            }
            else
            {
                System.out.println("Invalid choice.");
            }
        }

        scanner.close();
    }


    
public static void createAccount(Bank bank, Scanner scanner)
{
    System.out.print("Enter your name: ");
    String name = scanner.nextLine();

    System.out.print("Create your password: ");
    String password = scanner.nextLine();

    Account account = bank.createAccount(name, password);

    if (account == null)
    {
        System.out.println(
            "Account creation failed. Please try again."
        );
        return;
    }

    System.out.println("Account created successfully.");
    System.out.println(
        "Your account number is: " + account.getAccountNumber()
    );
}



    public static void login(Bank bank, Scanner scanner)
    {
        System.out.print("Enter your account number: ");
        int accountNumber = scanner.nextInt();
        scanner.nextLine();

        Account account = bank.findAccount(accountNumber);

        if (account == null || !account.isActive())
        {
            System.out.println("Account not found.");
            return;
        }

        System.out.print("Enter your password: ");
        String password = scanner.nextLine();

        if (account.verifyPassword(password))
        {
            System.out.println("Login successful.");
            showDashboard(bank, account, scanner);
        }
        else
        {
            System.out.println("Incorrect password.");
        }
    }


    public static void showDashboard(Bank bank, Account account,
                                     Scanner scanner)
    {
        while (true)
        {
            System.out.println("\n===== ACCOUNT DASHBOARD =====");
            System.out.println("Welcome, " + account.getName());
            System.out.println("1. Check Balance");
            System.out.println("2. Deposit");
            System.out.println("3. Withdraw");
            System.out.println("4. Transfer");
            System.out.println("5. Profile");
            System.out.println("6. Change Password");
            System.out.println("7. Close Account (balance must be zero)");
            System.out.println("8. Logout");

            System.out.print("Enter your choice: ");

            int choice = scanner.nextInt();
            scanner.nextLine();

            if (choice == 1)
            {
                System.out.println(
                    "Balance: " + account.checkBalance()
                );
            }
            else if (choice == 2)
            {
                System.out.print("Enter amount: ");
                BigDecimal amount = readAmount(scanner);
                System.out.println(bank.deposit(account.getAccountNumber(), amount)
                        ? "Amount deposited successfully." : "Deposit failed. Enter a positive amount.");
            }
            else if (choice == 3)
            {
                System.out.print("Enter amount: ");
                BigDecimal amount = readAmount(scanner);

                if (bank.withdraw(account.getAccountNumber(), amount))
                {
                    System.out.println("Withdrawal successful.");
                }
                else
                {
                    System.out.println("Insufficient balance or invalid amount.");
                }
            }
            else if (choice == 4)
            {
                transfer(bank, account, scanner);
            }
            else if (choice == 5)
            {
                System.out.println("Name: " + account.getName());
                System.out.println(
                    "Account Number: " + account.getAccountNumber()
                );
            }
            else if (choice == 6)
            {
                System.out.print("Enter new password: ");
                String newPassword = scanner.nextLine();

                System.out.println(bank.changePassword(account, newPassword)
                        ? "Password changed successfully." : "Password change failed.");
            }
            else if (choice == 7)
            {
                if (bank.closeAccount(account.getAccountNumber()))
                {
                    System.out.println("Account closed successfully.");
                    break;
                }
                System.out.println("Account cannot be closed. Withdraw or transfer the remaining balance first.");
            }
            else if (choice == 8)
            {
                System.out.println("Logged out successfully.");
                break;
            }
            else
            {
                System.out.println("Invalid choice.");
            }
        }
    }


    public static void transfer(Bank bank, Account payer,
                                Scanner scanner)
    {
        System.out.print("Enter receiver account number: ");
        int receiverAcNo = scanner.nextInt();
        scanner.nextLine();

        System.out.print("Enter amount: ");
        BigDecimal amount = readAmount(scanner);

        boolean success = bank.transfer(
            payer.getAccountNumber(),
            receiverAcNo,
            amount
        );

        if (success)
        {
            System.out.println("Transfer successful.");
        }
        else
        {
            System.out.println("Transfer failed.");
        }
    }

    private static BigDecimal readAmount(Scanner scanner) {
        String input = scanner.nextLine().trim();
        try {
            return new BigDecimal(input);
        } catch (NumberFormatException e) {
            System.out.println("Invalid amount.");
            return BigDecimal.ZERO;
        }
    }
}

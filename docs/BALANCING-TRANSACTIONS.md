# Balancing Transactions

## Overview

A **balancing transaction** is used to settle differences between partners when one person has contributed more or less than their fair share to shared expenses. It creates a synchronized set of 4 transactions across all budgets to maintain consistency.

## When to Use

Use a balancing transaction when:
- One partner has overpaid on shared expenses
- You need to settle up at the end of a period
- Account balances between personal and shared budgets have diverged
- A partner reimburses the other for shared expenses

## How It Works

A balancing transaction moves money from one partner to another, recording the transfer in all relevant places:

```
BEFORE BALANCING:
┌─────────────────────────┐     ┌─────────────────────────┐
│  PERSON A PERSONAL      │     │  PERSON B PERSONAL      │
│  Shared Expenses: €300  │     │  Shared Expenses: €100  │
│  (overpaid €100)        │     │  (underpaid €100)       │
└─────────────────────────┘     └─────────────────────────┘

BALANCING: B sends €100 to A

AFTER BALANCING:
┌─────────────────────────┐     ┌─────────────────────────┐
│  PERSON A PERSONAL      │     │  PERSON B PERSONAL      │
│  Shared Expenses: €300  │     │  Shared Expenses: €100  │
│  Balancing: +€100       │     │  Balancing: -€100       │
│  (net: €200)            │     │  (net: €200)            │
└─────────────────────────┘     └─────────────────────────┘
```

## The 4 Transactions

When you create a balancing transaction of €100 from Person A to Person B:

| # | Budget | Account | Category | Amount | Description |
|---|--------|---------|----------|--------|-------------|
| 1 | Person A (Personal) | Selected Account | Balancing | -€100 | Money leaving A's budget |
| 2 | Person B (Personal) | Selected Account | Balancing | +€100 | Money entering B's budget |
| 3 | Shared Budget | A's Contribution Account | — | -€100 | Decrease A's contribution balance |
| 4 | Shared Budget | B's Contribution Account | — | +€100 | Increase B's contribution balance |

## Transaction Linking

All 4 transactions are linked with a **Balancing ID** embedded in the memo field:

```
Format: #B-XXXXXX#
Example: #B-A3K9M2#
```

The `B-` prefix identifies this as a balancing transaction (vs regular linked transactions or monthly contributions). This allows:

- **Consistency tracking**: The system can verify all 4 transactions exist
- **Easy identification**: Search for the ID to find related transactions
- **Audit trail**: See which transactions belong together

## Example Transaction Memos

```
Transaction 1 (A's Personal):
  Payee: "Balancing to B"
  Memo: "Settling up for groceries #B-A3K9M2#"

Transaction 2 (B's Personal):
  Payee: "Balancing from A"
  Memo: "Settling up for groceries #B-A3K9M2#"

Transaction 3 (Shared - A's Account):
  Payee: "Balancing to B"
  Memo: "Settling up for groceries #B-A3K9M2#"

Transaction 4 (Shared - B's Account):
  Payee: "Balancing from A"
  Memo: "Settling up for groceries #B-A3K9M2#"
```

## Account Selection

When creating a balancing transaction, you must select:

1. **From Member**: The person sending money (will have outflows)
2. **To Member**: The person receiving money (will have inflows)
3. **From Account**: The account in the "From" member's personal budget
4. **To Account**: The account in the "To" member's personal budget

The shared budget accounts are automatically determined by the member's contribution account configuration.

## Real-World Flow

When Person A pays €100 to Person B to settle up:

### Physical Money
```
A's Bank Account ──€100──► B's Bank Account
```

### YNAB Recording (4 transactions)

**1. Person A's Personal Budget**
- Account: A's checking account
- Payee: Balancing to B
- Category: Shared Expense Balancing
- Amount: -€100

**2. Person B's Personal Budget**
- Account: B's checking account
- Payee: Balancing from A
- Category: Shared Expense Balancing
- Amount: +€100

**3. Shared Budget - A's Contribution Account**
- Account: A Contributions
- Payee: Balancing to B
- Amount: -€100 (no category - affects account balance only)

**4. Shared Budget - B's Contribution Account**
- Account: B Contributions
- Payee: Balancing from A
- Amount: +€100 (no category - affects account balance only)

## Effect on Balances

After a balancing transaction:

| Location | Change |
|----------|--------|
| A's Personal Balancing Category | -€100 |
| B's Personal Balancing Category | +€100 |
| A's Contribution Account (Shared) | -€100 |
| B's Contribution Account (Shared) | +€100 |

The **Personal Available** (Shared Expenses + Balancing) should now match the **Shared Account** balance for each member.

## Verification

In the Consistency tool, balancing transactions are:
- Grouped by their `#B-XXXXXX#` ID
- Marked as complete when all 4 transactions exist
- Flagged as incomplete if any transactions are missing

## Tips

1. **Add context to memo**: Include why you're balancing (e.g., "December groceries overpayment")
2. **Same date**: Use the same date as the actual bank transfer
3. **Verify afterwards**: Check the Monthly view to confirm accounts are now synced
4. **Regular balancing**: Consider balancing monthly to keep accounts aligned

## Common Scenarios

### Scenario 1: Monthly Settlement
At month end, A has €150 in Shared Expenses, B has €50. B owes A €50.
- Create balancing: €50 from B to A

### Scenario 2: Large Purchase Reimbursement
A paid €500 for furniture (shared expense). B reimburses €250.
- Create balancing: €250 from B to A

### Scenario 3: Correcting Account Drift
Personal Available shows €1,000 but Shared Account shows €900.
- Create balancing to re-sync (depends on who actually has the money)

# YNAB Couple Budget System

A system for managing shared household finances while maintaining individual budget autonomy. Supports one shared budget with multiple individual budgets linked through contribution tracking.

## Overview

This system allows couples (or roommates) to:
- Maintain separate personal budgets with full autonomy
- Contribute variable amounts to a shared household budget
- Track who paid for what and balance expenses fairly
- Adjust contribution rates month-to-month without restructuring

## Architecture

```
┌──────────────────────┐     ┌──────────────────────┐
│   PERSON A BUDGET    │     │   PERSON B BUDGET    │
│                      │     │                      │
│ Shared Expenses: €X  │     │ Shared Expenses: €Y  │
│ Balancing: €0        │     │ Balancing: €0        │
└──────────┬───────────┘     └───────────┬──────────┘
           │                             │
           │    (mirrored as income)     │
           ▼                             ▼
┌─────────────────────────────────────────────────────┐
│               SHARED HOUSEHOLD BUDGET               │
│                                                     │
│  Person A Contributions Account ◄── €X income      │
│  Person B Contributions Account ◄── €Y income      │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │ Categories funded by combined contributions │   │
│  │ - Rent, Utilities, Groceries, Fun, etc.     │   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

## Setup Guide

### 1. Individual Budgets (one per person)

Each person creates their own YNAB budget with:

#### Required Categories

| Category | Purpose |
|----------|---------|
| **Shared Expenses** | Monthly contribution to household budget |
| **Shared Expense Balancing** | Direct payments between partners |

#### How to Use

- Budget your monthly contribution amount in "Shared Expenses"
- When you spend on shared items, categorize to "Shared Expenses"
- When partner pays you directly (settling up), categorize to "Balancing"
- When you pay partner directly, categorize to "Balancing" (negative)

### 2. Shared Household Budget

One shared budget that both partners reference:

#### Accounts (one per contributor)

| Account | Type | Purpose |
|---------|------|---------|
| Person A Contributions | Checking | Track A's contributions & spending |
| Person B Contributions | Checking | Track B's contributions & spending |
| Deposit (optional) | Tracking | Security deposits, escrow |

#### Category Groups

**Fixed/Recurring**
- Rent/Mortgage
- Utilities (Electric, Gas, Water)
- Internet
- Insurance
- Subscriptions (shared ones like YNAB, streaming)

**Variable Living**
- Groceries
- Home Accessories
- Home Maintenance
- Gifts (shared)

**Discretionary/Fun**
- Eating Out / Takeaway
- Entertainment
- Travel
- Activities

**Special Goals** (as needed)
- Moving expenses
- Large purchases
- Events (weddings, trips)

### 3. Monthly Workflow

#### Beginning of Month

1. **Each person** decides their contribution amount
2. **Each person** budgets that amount in their personal "Shared Expenses" category
3. **In shared budget**, record income to each person's contribution account:
   - Payee: "Person A Budgeted" / "Person B Budgeted"
   - Category: "Inflow: Ready to Assign"
   - Flag with consistent color (e.g., purple) for easy identification

#### Throughout the Month

1. **When spending on shared expenses:**
   - Record transaction in shared budget under the spender's contribution account
   - Categorize appropriately (Groceries, Rent, etc.)
   - In personal budget, same transaction goes to "Shared Expenses" category

2. **When settling up between partners:**
   - In personal budget: categorize to "Balancing"
   - In shared budget: can record as transfer or adjustment

#### End of Month

- Review shared budget to see category spending
- Contribution accounts show each person's actual spending
- Adjust next month's contributions if needed

## Contribution Strategies

### Fixed Percentage
Each person contributes a set percentage based on income:
- Person A (60% household income) → contributes 60%
- Person B (40% household income) → contributes 40%

### Fixed Amount
Each person contributes a set amount regardless of income:
- Both contribute €1,500/month
- Equal split regardless of earnings

### Variable/Flexible
Adjust monthly based on circumstances:
- Month 1: A contributes €2,000, B contributes €1,500
- Month 2: A contributes €1,800, B contributes €1,800
- Useful when income fluctuates

### Expense-Based
One person covers certain categories:
- Person A: Rent, Internet
- Person B: Groceries, Utilities
- Less flexible but simpler tracking

## Tips & Best Practices

### Naming Conventions
- Use consistent payee names for contributions: "PersonName Budgeted"
- Flag contribution transactions with a unique color
- Add memo with month: "December", "2024-12"

### Reconciliation
- Personal budget "Shared Expenses" balance should roughly match contribution account activity
- "Balancing" category catches direct transfers that don't go through shared budget

### Communication
- Review shared budget together monthly
- Discuss large purchases before making them
- Agree on contribution changes before implementing

### Handling Imbalances
If one person consistently overspends from their contribution account:
1. Use "Balancing" category in personal budgets to settle up
2. Or adjust next month's contribution amounts
3. Or transfer between contribution accounts in shared budget

See [BALANCING-TRANSACTIONS.md](./BALANCING-TRANSACTIONS.md) for detailed documentation on how to create balancing transactions that automatically sync across all 4 accounts.

For the complete transaction linking system documentation, see [TRANSACTION-LINKING.md](./TRANSACTION-LINKING.md).

## Example: Real Configuration

### Personal Budget (Person A)
```
Category Groups:
├── Shared Expenses
│   ├── Shared Expenses (€2,200 budgeted)
│   └── Shared Expense Balancing (€0)
├── Personal Costs
│   ├── Transportation
│   ├── Phone
│   └── etc.
└── Investments
    └── etc.
```

### Shared Household Budget
```
Accounts:
├── Person A Contributions (income: €2,200)
└── Person B Contributions (income: €1,800)

Category Groups:
├── Fixed Bills
│   ├── Rent (€1,330)
│   ├── Electricity/Gas (€150)
│   ├── Internet (€50)
│   └── Insurance (€40)
├── Living
│   ├── Groceries (€500)
│   ├── Home Accessories (€200)
│   └── Gifts (€50)
└── Fun
    ├── Eating Out (€400)
    ├── Travel (€400)
    └── Entertainment (€100)
```

## Scaling to More People

This system scales to roommates or larger households:

1. Add more individual budgets (one per person)
2. Add more contribution accounts in shared budget
3. Each person budgets their share in personal "Shared Expenses"
4. Contribution percentages can vary per person

```
Shared Budget Accounts:
├── Person A Contributions (40%)
├── Person B Contributions (35%)
└── Person C Contributions (25%)
```

## Troubleshooting

### "My Shared Expenses category is negative"
You've spent more than budgeted. Either:
- Add more to the category from Ready to Assign
- Reduce spending for rest of month
- Cover overage next month

### "Contribution accounts don't balance"
This is normal - they track spending, not actual bank balances. The "balance" shows net contribution minus spending.

### "We need to make a large shared purchase"
Options:
1. Save up in a dedicated category over months
2. One person pays, other reimburses over time via "Balancing"
3. Temporarily increase contributions

---

*System designed for flexibility and autonomy while maintaining fair shared expense tracking.*

# YNAB Couple Budget System - Specification v1.0

## Overview

A web dashboard to manage linked YNAB budgets between couples. Supports one shared (household) budget connected to multiple individual budgets through category bindings.

---

## Core Concepts

### Budget Types
- **Shared Budget**: Household expenses, contains contribution accounts per person
- **Individual Budget**: Personal budget with a "Shared Expenses" category linked to shared budget

### Category Binding
A binding connects:
- Individual budget → Shared Expenses category (outflow from personal)
- Shared budget → Contribution Account (inflow to household)

### The Golden Rule
```
Monthly Shared Expenses Activity = Budgeted Amount + Balancing Inflows
```
Violations break the sync and must be flagged.

### Balancing
Direct payments between partners that offset shared expenses without going through the household budget.

---

## Data Model

```
CoupleSystem
├── shared_budget_id
├── members[]
│   ├── name
│   ├── individual_budget_id
│   ├── shared_expenses_category_id    # In their personal budget
│   ├── balancing_category_id          # In their personal budget
│   └── contribution_account_id        # In shared budget
└── category_mappings[]                # Optional: map shared categories to personal ones
```

---

## Screen 1: Setup & Sync Status

### Purpose
Configure budget bindings, verify transaction sync, surface issues.

### Sections

#### 1.1 API Connection
- API key input (stored in browser localStorage only)
- Connection status indicator
- List of accessible budgets

#### 1.2 Budget Binding
- Select shared budget from dropdown
- For each member:
  - Select individual budget
  - Select/create "Shared Expenses" category
  - Select/create "Balancing" category
  - Auto-detect or manually select contribution account in shared budget

#### 1.3 Category Analysis (on binding)
When binding is set, analyze existing data:

| Metric | Description |
|--------|-------------|
| Transaction count match | Compare txn counts between personal shared category and contribution account |
| Amount match | Compare total amounts |
| Date range coverage | First/last transaction dates |
| Unmatched transactions | List transactions in one but not other |
| Suggested matches | Transactions with same date/amount but not linked |

#### 1.4 Sync Issues Panel
Active issues requiring attention:

| Issue Type | Description |
|------------|-------------|
| Golden Rule Violation | Month where activity ≠ budgeted + balancing |
| Missing Contribution | Budgeted in personal but no matching inflow in shared |
| Orphan Transaction | Transaction in shared with no personal budget match |
| Overbudget Spillover | Ready to Assign affected by previous month overspend |

---

## Screen 2: Monthly Budget

### Purpose
View and manage monthly contributions and budgeting for current/past months.

### Sections

#### 2.1 Month Selector
- Month/year picker
- Quick nav: current, previous, next

#### 2.2 Contribution Summary
Per member, per month:

| Field | Source | Editable |
|-------|--------|----------|
| Budgeted (Personal) | Personal budget → Shared Expenses category | Yes |
| Contributed (Shared) | Shared budget → Contribution account inflows | Display only |
| Balancing Received | Personal budget → Balancing category inflows | Display only |
| Balancing Sent | Personal budget → Balancing category outflows | Display only |
| Net Balancing | Received - Sent | Display only |
| Expected Activity | Budgeted + Net Balancing | Calculated |
| Actual Activity | Personal → Shared Expenses activity | Display only |
| Status | OK / Mismatch / Overspent | Calculated |

#### 2.3 Totals Row
- Combined household contribution
- Contribution percentages per member
- Total household spending

#### 2.4 Actions
| Action | Effect |
|--------|--------|
| Update Personal Budget | API call to update category budgeted amount |
| Record Contribution | Create inflow transaction in shared budget contribution account |
| Quick Balance | Create balancing transactions in both personal budgets |

#### 2.5 Golden Rule Validator
Visual indicator per member:
```
✓ Activity (€2,150) = Budgeted (€2,200) + Balancing (-€50)
✗ Activity (€2,300) ≠ Budgeted (€2,200) + Balancing (€0) → Overspent by €100
```

#### 2.6 Month Health Warnings
- Categories overspent in shared budget
- Contribution account negative balance
- Uncleared transactions older than 7 days

---

## Screen 3: Analytics

### Purpose
Analyze spending patterns and contribution history.

### Sections

#### 3.1 Time Range Selector
- Preset: 3mo, 6mo, 12mo, YTD, All time
- Custom date range

#### 3.2 Contribution History
Chart + table showing per month:
- Each member's contribution amount
- Contribution percentage split
- Trend line

#### 3.3 Spending by Category
Shared budget spending breakdown:
- By category (pie/bar chart)
- By category over time (stacked area)
- Top 10 categories table with totals

#### 3.4 Spending by Member
Who paid for what (based on contribution account activity):
- Total per member
- By category per member
- Percentage of shared expenses each member actually paid

#### 3.5 Patterns
| Pattern | Description |
|---------|-------------|
| Recurring expenses | Same payee, similar amount, regular interval |
| Expense trends | Month-over-month change per category |
| Anomalies | Unusually large transactions |
| Seasonal patterns | Categories that spike in certain months |

#### 3.6 Balancing History
- Net balancing per month per member
- Cumulative balance (who "owes" whom over time)
- Balancing transaction list

---

## API Operations Required

### Read Operations
| Operation | YNAB Endpoint |
|-----------|---------------|
| List budgets | GET /budgets |
| Get budget details | GET /budgets/{id} |
| List accounts | GET /budgets/{id}/accounts |
| List categories | GET /budgets/{id}/categories |
| Get month | GET /budgets/{id}/months/{month} |
| List transactions | GET /budgets/{id}/transactions |

### Write Operations
| Operation | YNAB Endpoint |
|-----------|---------------|
| Update category budget | PATCH /budgets/{id}/months/{month}/categories/{id} |
| Create transaction | POST /budgets/{id}/transactions |

---

## Validation Rules

### Hard Rules (block save)
1. Budgeted amount cannot be negative
2. Contribution must match between personal budgeted and shared inflow
3. Cannot modify reconciled transactions

### Soft Rules (warn only)
1. Golden rule violation detected
2. Shared budget has overspent categories
3. Large single transaction (>€500 configurable)
4. Contribution percentage changed significantly from average

---

## Edge Cases

| Case | Handling |
|------|----------|
| Mid-month budget change | Track as separate contribution transaction, sum for month |
| Shared expense paid from wrong account | Flag in sync issues, suggest correction |
| Refund on shared expense | Treat as negative activity, reduce expected |
| One member has no transactions | Valid state, show zeros |
| Category renamed | Match by ID, not name |
| New month, no budget set | Prompt to set budget, show last month as suggestion |

---

## Local Storage Schema

```json
{
  "ynab_api_key": "encrypted-key",
  "config": {
    "shared_budget_id": "uuid",
    "members": [
      {
        "name": "Matteo",
        "budget_id": "uuid",
        "shared_category_id": "uuid",
        "balancing_category_id": "uuid",
        "contribution_account_id": "uuid"
      }
    ]
  },
  "cache": {
    "budgets": { "data": [], "fetched_at": "timestamp" },
    "transactions": { "budget_id": { "data": [], "server_knowledge": 123 } }
  }
}
```

---

## Technical Constraints

1. **No server storage**: All config in browser localStorage
2. **API key security**: Never transmitted to any server, direct YNAB calls only
3. **Rate limiting**: YNAB allows 200 requests/hour, implement caching
4. **Delta sync**: Use server_knowledge for incremental transaction fetches
5. **Offline tolerance**: Cache recent data, work offline for read-only views

---

## Out of Scope (v1)

- Automatic transaction creation/sync
- Multi-currency support
- More than 2 members (architecture supports it, UI doesn't)
- Mobile-specific UI
- Push notifications
- Split transactions handling
- Scheduled/recurring transaction management

---

## Success Metrics

1. Setup completes in <5 minutes for existing YNAB users
2. Golden rule violations detected within 1 day of occurrence
3. Monthly budgeting takes <2 minutes
4. Page load <3 seconds with cached data

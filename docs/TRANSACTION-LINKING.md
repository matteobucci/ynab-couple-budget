# Transaction Linking System

## Overview

The YNAB Couple Budget system uses a **memo-based linking system** to connect related transactions across multiple budgets. This enables tracking of shared expenses, balancing transfers, and monthly contributions.

## How It Works

Every linked transaction contains a unique **Link ID** embedded in the transaction memo field:

```
Groceries at Supermarket #A3K9M2#
```

The ID is wrapped in `#` delimiters, making it easy to identify and extract.

## ID Formats

There are three types of Link IDs, each with a distinct format:

| Type | Format | Example | Purpose |
|------|--------|---------|---------|
| **Regular** | `#XXXXXX#` | `#A3K9M2#` | Links expense transactions between personal and shared budgets |
| **Balancing** | `#B-XXXXXX#` | `#B-K7N4P2#` | Links balancing transaction sets (4 transactions) |
| **Monthly** | `#M-MM-YY#` | `#M-01-26#` | Links monthly contribution income transactions |

### Character Set

IDs use a 30-character alphanumeric set that excludes visually confusing characters:
```
ABCDEFGHJKLMNPQRSTUVWXYZ23456789
```

Excluded: `I`, `O`, `1`, `0` (too similar to each other)

## Transaction Types

### 1. Regular Expense Links (`#XXXXXX#`)

Links a transaction in your personal budget to a matching transaction in the shared budget.

**Example Flow:**
```
You pay €50 for groceries

Personal Budget (Your Shared Expenses category):
  Payee: Supermarket
  Amount: -€50
  Memo: Weekly groceries #A3K9M2#

Shared Budget (Your Contribution Account):
  Payee: Supermarket
  Amount: -€50
  Memo: Weekly groceries #A3K9M2#
```

**Link Completion:**
- Requires at least 1 personal transaction + 1 shared transaction with matching ID
- The Consistency tool shows incomplete links

### 2. Balancing Transaction Links (`#B-XXXXXX#`)

Links 4 transactions that represent a balancing transfer between partners.

**Example Flow:**
```
Person A sends €100 to Person B to settle up

1. Person A Personal Budget (Balancing category):
   Payee: Balancing to Person B
   Amount: -€100
   Memo: Settling up #B-K7N4P2#

2. Person B Personal Budget (Balancing category):
   Payee: Balancing from Person A
   Amount: +€100
   Memo: Settling up #B-K7N4P2#

3. Shared Budget (A's Contribution Account):
   Payee: Balancing to Person B
   Amount: -€100
   Memo: Settling up #B-K7N4P2#

4. Shared Budget (B's Contribution Account):
   Payee: Balancing from Person A
   Amount: +€100
   Memo: Settling up #B-K7N4P2#
```

**Link Completion:**
- Requires all 4 transactions (personal transactions for each member + shared transactions for each member)
- The `B-` prefix identifies this as a balancing set

### 3. Monthly Income Links (`#M-MM-YY#`)

Links monthly contribution income transactions in the shared budget.

**Example Flow:**
```
January 2026 monthly contribution

Shared Budget (Your Contribution Account):
  Payee: January Contribution
  Amount: +€2,000
  Memo: Monthly contribution #M-01-26#
```

**Link Completion:**
- Requires at least 1 shared budget transaction
- The `M-MM-YY` format identifies the month/year

## LinkUtils API

All ID operations are centralized in `LinkUtils` (defined in `utils.js`):

### ID Generation

```javascript
// Generate a random 6-character ID
LinkUtils.generateId()  // Returns: "A3K9M2"

// Generate a balancing transaction ID
LinkUtils.generateBalancingId()  // Returns: "B-K7N4P2"

// Generate a monthly income ID
LinkUtils.generateMonthlyId(1, 2026)  // Returns: "M-01-26"
```

### ID Formatting

```javascript
// Format ID as a memo tag
LinkUtils.formatIdTag("A3K9M2")  // Returns: "#A3K9M2#"

// Add ID to memo (appends or replaces existing)
LinkUtils.appendIdToMemo("Groceries", "A3K9M2")
// Returns: "Groceries #A3K9M2#"

LinkUtils.appendIdToMemo("Old memo #OLDID#", "NEWID")
// Returns: "Old memo #NEWID#"
```

### ID Extraction

```javascript
// Extract ID from memo
LinkUtils.extractId("Groceries #A3K9M2#")  // Returns: "A3K9M2"
LinkUtils.extractId("No ID here")  // Returns: null

// Check if memo has an ID
LinkUtils.hasId("Groceries #A3K9M2#")  // Returns: true
LinkUtils.hasId("No ID here")  // Returns: false
```

### ID Type Detection

```javascript
// Check ID type
LinkUtils.isBalancingId("B-K7N4P2")  // Returns: true
LinkUtils.isMonthlyId("M-01-26")  // Returns: true
LinkUtils.isRegularId("A3K9M2")  // Returns: true

// Get type as string
LinkUtils.getIdType("B-K7N4P2")  // Returns: "balancing"
LinkUtils.getIdType("M-01-26")  // Returns: "monthly"
LinkUtils.getIdType("A3K9M2")  // Returns: "regular"

// Parse monthly ID
LinkUtils.parseMonthlyId("M-01-26")
// Returns: { month: 1, year: 2026 }
```

## Usage in Modules

### Consistency Module

The Consistency module uses linking to:
1. Analyze all transactions and group by ID
2. Identify unlinked transactions
3. Allow manual linking of transactions
4. Create duplicate transactions in shared budget
5. Track monthly contributions

```javascript
// Consistency delegates to LinkUtils
Consistency.extractId(memo)  // → LinkUtils.extractId(memo)
Consistency.generateId()  // → LinkUtils.generateId()
```

### Monthly Module

The Monthly module uses linking to:
1. Create balancing transactions with shared IDs
2. Track which transactions belong to the same balancing set

```javascript
// Monthly delegates to LinkUtils
Monthly.generateBalancingId()  // → LinkUtils.generateBalancingId()
Monthly.formatMemoWithId(memo, id)  // → LinkUtils.appendIdToMemo(memo, id)
```

## Link Validation

The system validates link completeness based on type:

| Type | Complete When |
|------|---------------|
| Regular | 1+ personal transaction AND 1+ shared transaction |
| Balancing | 2 personal transactions (one per member) AND 2 shared transactions (one per member) |
| Monthly | 1+ shared transaction |

## Transaction Matching

When manually linking transactions, the system suggests matches based on:

1. **Amount Match**: Transactions must match within 0.01 currency units (100 milliunits)
2. **Date Match**: Transactions must be within 7 days of each other

```javascript
// From Consistency module
isGoodMatch(personalTxn, sharedTxn) {
  const amountMatch = Math.abs(personalTxn.amount - sharedTxn.amount) < 100;
  const dateMatch = Math.abs(dateDiff) <= 7;
  return amountMatch && dateMatch;
}
```

## Best Practices

### 1. Consistent Memos
Include descriptive text before the ID tag:
```
Good: "Groceries at Costco #A3K9M2#"
Avoid: "#A3K9M2#"  (no context)
```

### 2. Don't Edit IDs Manually
Let the system generate and manage IDs. Manual editing can break links.

### 3. Use the Consistency Tool
Regularly check the Consistency tool to:
- Find unlinked transactions
- Verify balancing sets are complete
- Track monthly contribution status

### 4. Verify Balancing Transactions
After creating balancing transactions, check:
- All 4 transactions appear in the Consistency tool
- The link shows as "Complete"
- Account balances are properly adjusted

## Troubleshooting

### "Transaction Not Linking"
1. Check that both transactions have the exact same ID
2. Verify the ID format is correct (wrapped in `#`)
3. Ensure transactions are after the cutoff date (if configured)

### "Incomplete Balancing Set"
1. Verify all 4 transactions were created
2. Check each transaction has the same balancing ID
3. Look for typos in the ID tag

### "Monthly Income Not Tracked"
1. Verify the memo contains the correct `#M-MM-YY#` format
2. Check the month/year matches the transaction date
3. Ensure the transaction is in the correct contribution account

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     LinkUtils                           │
│  (utils.js - Shared ID generation and parsing)          │
├─────────────────────────────────────────────────────────┤
│  generateId()          generateBalancingId()            │
│  generateMonthlyId()   formatIdTag()                    │
│  extractId()           hasId()                          │
│  appendIdToMemo()      isBalancingId()                  │
│  isMonthlyId()         parseMonthlyId()                 │
│  getIdType()           ID_REGEX                         │
└─────────────────────────────────────────────────────────┘
                          │
          ┌───────────────┴───────────────┐
          ▼                               ▼
┌──────────────────────┐     ┌──────────────────────┐
│   Consistency.js     │     │     Monthly.js       │
│                      │     │                      │
│  - analyzeLinks()    │     │  - createBalancing   │
│  - linkWithSelected()│     │    Transaction()     │
│  - duplicateToShared │     │  - generateBalancing │
│  - createMonthlyIncome│    │    Id()              │
└──────────────────────┘     └──────────────────────┘
```

## Related Documentation

- [BALANCING-TRANSACTIONS.md](./BALANCING-TRANSACTIONS.md) - Detailed balancing transaction guide
- [README.md](./README.md) - System overview and setup
- [QUICK-REFERENCE.md](./QUICK-REFERENCE.md) - Quick reference card

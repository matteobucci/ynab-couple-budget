# YNAB Couple Budget

A client-side web app for managing shared finances between partners using [YNAB](https://www.ynab.com/) (You Need A Budget). Connects directly to the YNAB API from the browser — no backend, no accounts, no data leaves your machine.

## The Problem

YNAB is built for individuals. When two people share household expenses but keep separate finances, things get messy fast:

- **Who paid for what?** One partner buys groceries, the other pays rent. Without tracking, nobody knows who's ahead.
- **Variable contributions.** Maybe one person earns more and contributes 60%. Or contributions change month to month. YNAB has no native way to model this.
- **Three budgets, zero coordination.** Each person has a personal budget, plus there's a shared household budget. Transactions need to appear in the right places across all three, with matching amounts and categories. Doing this manually is tedious and error-prone.
- **Settling up is a nightmare.** When one partner overspends from the shared pool, you need balancing transactions across four accounts (two personal + two shared) that all stay in sync.

## The Solution

This tool sits on top of your existing YNAB budgets and handles the coordination layer. The core idea is simple: **link transactions across budgets using IDs embedded in memo fields**.

```
Personal Budget (Matteo)          Shared Household Budget
┌─────────────────────────┐       ┌─────────────────────────┐
│ Groceries  -€80  #A3K9# │ ───── │ Groceries  -€80  #A3K9# │
│ Shared Expenses category │       │ Matteo's account         │
└─────────────────────────┘       └─────────────────────────┘
```

Each shared expense exists in both your personal budget (categorized as "Shared Expenses") and the household budget (categorized by type). A short ID tag like `#A3K9M2#` in the memo ties them together. The app manages these links and keeps everything in sync.

## How It Works for a Couple

### Budget Structure

You need three YNAB budgets:

```
┌──────────────────────┐     ┌──────────────────────┐
│   PERSON A BUDGET    │     │   PERSON B BUDGET    │
│                      │     │                      │
│ Shared Expenses: €X  │     │ Shared Expenses: €Y  │
│ Balancing: €0        │     │ Balancing: €0        │
└──────────┬───────────┘     └───────────┬──────────┘
           │    (mirrored as income)     │
           ▼                             ▼
┌─────────────────────────────────────────────────────┐
│               SHARED HOUSEHOLD BUDGET               │
│                                                     │
│  Person A Account  ◄── €X contribution/month        │
│  Person B Account  ◄── €Y contribution/month        │
│                                                     │
│  Rent · Groceries · Utilities · Fun · ...           │
└─────────────────────────────────────────────────────┘
```

Each person maintains full autonomy over their personal budget. The shared budget tracks combined spending. This tool bridges the gap.

### Monthly Workflow

**Start of month:**
1. Each person decides their contribution (can be equal, percentage-based, or whatever you agree on)
2. Open the **Monthly** screen, enter amounts, and hit Apply — the app creates income transactions in the shared budget and adjusts your personal budget categories automatically

**Throughout the month:**
1. When you pay for something shared, record it in your personal budget under "Shared Expenses"
2. Open the **Transactions** screen — you'll see your unlinked personal transactions on the left and the shared budget on the right
3. Click a personal transaction, then click "+" to copy it to the shared budget — or click a matching shared transaction to link them. The app generates a link ID and writes it to both memos

**When things are uneven:**
1. If one partner has overspent from the shared pool, open **Settle Up**
2. Enter the amount and direction — the app creates four linked balancing transactions (two personal + one transfer in shared) and adjusts your budget categories to keep the math clean

### Transaction Types

The app uses three ID formats in memo fields:

| Type | Format | Example | Purpose |
|------|--------|---------|---------|
| Regular expense | `#XXXXXX#` | `#A3K9M2#` | Links a personal transaction to its shared budget counterpart |
| Balancing | `#B-XXXXXX#` | `#B-K7WP3N#` | Groups the 4 transactions in a settle-up set |
| Monthly income | `#M-MM-YY#` | `#M-02-26#` | Tags monthly contribution transactions |

## Features

- **Dashboard** — Balances, sync status, attention items (unlinked transactions, imbalances)
- **Transaction Linking** — Side-by-side view of personal and shared transactions. Link, copy, or mark as monthly with one click. Smart matching highlights likely pairs.
- **Monthly Allocations** — Set contribution amounts, auto-calculate the split between Shared Expenses and Balancing categories, create income transactions in the shared budget
- **Settle Up** — Create balancing transaction sets across all budgets with automatic budget category adjustments
- **Analytics** — Spending trends, category breakdowns, member contribution comparisons over time

## Setup

1. Open `index.html` in a browser (or deploy to any static host)
2. Get a [YNAB Personal Access Token](https://app.ynab.com/settings/developer)
3. Enter the token and connect
4. Select your shared household budget
5. Add each member: pick their personal budget, map the "Shared Expenses" and "Balancing" categories, and select their contribution account in the shared budget

All configuration is stored in your browser's localStorage. Your API key never leaves your browser.

## Deploy

This is a static site with no build step. Deploy the entire directory to any static host:

- **Netlify** — Connect the repo; `netlify.toml` is included
- **GitHub Pages** — Enable Pages on the repo
- **Local** — `npx serve .` and open `http://localhost:3000`

## Project Structure

```
├── index.html          # Single-page application shell
├── css/app.css         # All styles
├── js/
│   ├── app.js          # Initialization, navigation, connection
│   ├── store.js        # Reactive state management (pub/sub)
│   ├── data-service.js # Caching layer with delta sync
│   ├── ynab-client.js  # YNAB REST API client
│   ├── storage.js      # localStorage wrapper
│   ├── utils.js        # Link ID utilities, formatting, confirm modal
│   ├── charts.js       # Chart rendering (Canvas)
│   ├── setup.js        # Settings and member configuration
│   ├── overview.js     # Dashboard screen
│   ├── consistency.js  # Transaction linking and settle-up
│   ├── monthly.js      # Monthly allocation planner
│   └── analytics.js    # Spending analytics and charts
├── docs/               # Detailed system documentation
├── netlify.toml        # Netlify deploy config
└── README.md
```

## Documentation

See `docs/` for detailed documentation:

- [System Overview](docs/README.md) — How the linked budget system works
- [Quick Reference](docs/QUICK-REFERENCE.md) — Cheat sheet for daily use
- [Transaction Linking](docs/TRANSACTION-LINKING.md) — How transaction linking works
- [Balancing Transactions](docs/BALANCING-TRANSACTIONS.md) — How settle-up works

## Privacy

- Runs entirely in your browser — no backend, no server, no tracking
- Your YNAB API key is stored in localStorage, never transmitted anywhere except to the YNAB API
- Transaction data is cached locally for performance; clear it anytime from settings

## License

MIT

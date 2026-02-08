/**
 * Analytics Screen Module
 * Handles historical data analysis and spending patterns
 */
const Analytics = {
  elements: {},
  state: {
    timeRange: '6mo',
    data: null,
    loading: false,
    error: null
  },

  // Debug mode - enabled when running locally
  get debug() {
    return window.location.hostname === 'localhost' || window.DEV_API_KEY;
  },

  log(...args) {
    if (this.debug) console.log('[Analytics]', ...args);
  },

  init(elements) {
    this.elements = elements;
    this.state.subscribed = false;
    this.log('init called, timeRangeBtns:', this.elements.timeRangeBtns?.length || 0, 'buttons');
    this.bindEvents();
    this.subscribeToStore();
  },

  /**
   * Subscribe to Store changes for reactive updates
   */
  subscribeToStore() {
    if (this.state.subscribed) return;

    // Subscribe to transaction changes to refresh analytics
    Store.subscribe('transactions', () => {
      if (this.isScreenVisible() && this.state.data) {
        // Transactions changed, refresh analytics
        this.loadAnalytics();
      }
    });

    this.state.subscribed = true;
  },

  /**
   * Check if analytics screen is currently visible
   */
  isScreenVisible() {
    return this.elements.analyticsContent?.style?.display !== 'none';
  },

  bindEvents() {
    // Time range selector
    this.log('bindEvents: attaching to', this.elements.timeRangeBtns?.length || 0, 'buttons');
    this.elements.timeRangeBtns?.forEach(btn => {
      btn.addEventListener('click', () => {
        this.log('Time range clicked:', btn.dataset.range);
        this.state.timeRange = btn.dataset.range;
        this.updateTimeRangeUI();
        this.loadAnalytics();
      });
    });

    // Refresh button
    this.elements.refreshAnalyticsBtn?.addEventListener('click', () => {
      this.loadAnalytics(true);
    });
  },

  initScreen() {
    // Don't show anything until initial load is complete
    if (!App.state.initialLoadComplete) return;

    const config = Store.getConfig();

    const isConfigured = config.sharedBudgetId &&
      config.members?.length > 0 &&
      config.members.every(m => m.budgetId && m.sharedCategoryId && m.contributionAccountId);

    if (!isConfigured) {
      this.elements.analyticsNotConfigured.style.display = 'block';
      this.elements.analyticsContent.style.display = 'none';
      return;
    }

    this.elements.analyticsNotConfigured.style.display = 'none';
    this.elements.analyticsContent.style.display = 'block';

    this.updateTimeRangeUI();

    if (!this.state.data) {
      this.loadAnalytics();
    }
  },

  updateTimeRangeUI() {
    this.elements.timeRangeBtns?.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.range === this.state.timeRange);
    });
  },

  getDateRange() {
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0); // Last day of current month
    let start;

    switch (this.state.timeRange) {
      case '3mo':
        start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
        break;
      case '6mo':
        start = new Date(now.getFullYear(), now.getMonth() - 5, 1);
        break;
      case '12mo':
        start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
        break;
      case 'ytd':
        start = new Date(now.getFullYear(), 0, 1);
        break;
      case 'all':
        // Limit to 5 years to avoid storage quota issues
        start = new Date(now.getFullYear() - 5, now.getMonth(), 1);
        break;
      default:
        start = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    }

    return {
      start: start.toISOString().split('T')[0],
      end: end.toISOString().split('T')[0]
    };
  },

  async loadAnalytics(forceRefresh = false) {
    const config = Store.getConfig();

    this.log('loadAnalytics called, timeRange:', this.state.timeRange, 'forceRefresh:', forceRefresh);

    this.state.loading = true;
    this.state.error = null;
    this.showLoading(true);

    try {
      const { start, end } = this.getDateRange();
      this.log('Date range:', start, 'to', end);

      const memberData = [];

      for (const member of config.members) {
        const data = await this.loadMemberAnalytics(config.sharedBudgetId, member, start, end);
        memberData.push(data);
      }

      // Load shared budget transactions for category breakdown
      const sharedBudgetTxns = await DataService.getTransactions(config.sharedBudgetId, {
        sinceDate: start
      });
      const filteredSharedTxns = sharedBudgetTxns.filter(t =>
        t.date >= start && t.date <= end &&
        t.amount < 0 && // Only expenses (outflows)
        !t.transfer_account_id // Exclude transfers between accounts
      );

      // Get category breakdown from shared budget
      const sharedCategoryBreakdown = this.getCategoryBreakdown(filteredSharedTxns);

      // Build member-to-category spending map using linked transactions
      const memberCategorySpending = this.buildMemberCategorySpending(
        filteredSharedTxns,
        memberData,
        config.members
      );

      this.state.data = {
        timeRange: this.state.timeRange,
        start,
        end,
        members: memberData,
        sharedTransactions: filteredSharedTxns,
        sharedCategoryBreakdown,
        memberCategorySpending
      };

      this.log('Data loaded, members:', memberData.length, 'rendering...');
      this.renderAnalytics();

    } catch (error) {
      console.error('Analytics load failed:', error);
      this.state.error = error;
      this.renderError(error);
    } finally {
      this.state.loading = false;
      this.showLoading(false);
    }
  },

  async loadMemberAnalytics(sharedBudgetId, member, startDate, endDate) {
    // Get all transactions from member's contribution account in the SHARED budget
    const accountTxns = await DataService.getTransactions(sharedBudgetId, {
      accountId: member.contributionAccountId,
      sinceDate: startDate
    });

    // Filter to date range
    const filteredTxns = accountTxns.filter(t =>
      t.date >= startDate && t.date <= endDate
    );

    // Separate by type:
    // - Contributed: inflows (positive amounts) to "Ready to Assign" (no category) - monthly contributions
    // - Reimbursements: inflows that ARE categorized - returns/refunds that offset spending
    // - Spent: outflows (negative amounts) that are NOT transfers - actual spending
    // - Transfers: transactions that ARE transfers - balancing between members
    const contributions = filteredTxns.filter(t => t.amount > 0 && !t.category_id);
    const reimbursements = filteredTxns.filter(t => t.amount > 0 && t.category_id && !t.transfer_account_id);
    const spending = filteredTxns.filter(t => t.amount < 0 && !t.transfer_account_id);
    const transfers = filteredTxns.filter(t => t.transfer_account_id);

    // Group by month
    const monthlyData = this.groupByMonth(spending, contributions, transfers);

    // Category breakdown (from actual spending)
    const categoryBreakdown = this.getCategoryBreakdown(spending);

    // Calculate totals
    const totalContributed = contributions
      .reduce((sum, t) => sum + t.amount, 0);

    const totalReimbursements = reimbursements
      .reduce((sum, t) => sum + t.amount, 0);

    const totalSpent = spending
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);

    // Transfers: positive = received from other member, negative = sent to other member
    const totalTransfersIn = transfers
      .filter(t => t.amount > 0)
      .reduce((sum, t) => sum + t.amount, 0);

    const totalTransfersOut = transfers
      .filter(t => t.amount < 0)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);

    return {
      member,
      transactions: spending,
      contributions: contributions,
      reimbursements: reimbursements,
      transfers: transfers,
      monthlyData,
      categoryBreakdown,
      totals: {
        spent: totalSpent,
        contributed: totalContributed,
        reimbursements: totalReimbursements,
        transfersIn: totalTransfersIn,
        transfersOut: totalTransfersOut,
        netTransfers: totalTransfersIn - totalTransfersOut
      }
    };
  },

  groupByMonth(spending, contributions, transfers) {
    const months = {};

    // Process spending (outflows, non-transfers)
    spending.forEach(t => {
      const month = t.date.substring(0, 7);
      if (!months[month]) {
        months[month] = { spent: 0, contributed: 0, transfersIn: 0, transfersOut: 0 };
      }
      months[month].spent += Math.abs(t.amount);
    });

    // Process contributions (inflows)
    contributions.forEach(t => {
      const month = t.date.substring(0, 7);
      if (!months[month]) {
        months[month] = { spent: 0, contributed: 0, transfersIn: 0, transfersOut: 0 };
      }
      months[month].contributed += t.amount;
    });

    // Process transfers (between members)
    transfers.forEach(t => {
      const month = t.date.substring(0, 7);
      if (!months[month]) {
        months[month] = { spent: 0, contributed: 0, transfersIn: 0, transfersOut: 0 };
      }
      if (t.amount > 0) {
        months[month].transfersIn += t.amount;
      } else {
        months[month].transfersOut += Math.abs(t.amount);
      }
    });

    // Sort by month
    return Object.entries(months)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, data]) => ({
        month,
        ...data,
        netTransfers: data.transfersIn - data.transfersOut
      }));
  },

  getCategoryBreakdown(transactions) {
    const categories = {};

    transactions.forEach(t => {
      if (t.amount >= 0) return; // Skip inflows

      const categoryName = t.category_name || 'Uncategorized';
      if (!categories[categoryName]) {
        categories[categoryName] = { name: categoryName, amount: 0, count: 0 };
      }
      categories[categoryName].amount += Math.abs(t.amount);
      categories[categoryName].count++;
    });

    return Object.values(categories)
      .sort((a, b) => b.amount - a.amount);
  },

  // Build a map of which member paid for which category
  // Simply checks the account_id - each member has their own contribution account
  buildMemberCategorySpending(sharedTxns, memberData, members) {
    // Result: { memberName: { categoryName: amount } }
    const result = {};
    members.forEach(m => {
      result[m.name] = {};
    });

    // Build a map of contribution account IDs to member names
    const accountToMember = {};
    members.forEach(m => {
      if (m.contributionAccountId) {
        accountToMember[m.contributionAccountId] = m.name;
      }
    });

    // For each shared transaction, attribute based on which account it's in
    sharedTxns.forEach(txn => {
      if (txn.amount >= 0) return; // Skip inflows

      const categoryName = txn.category_name || 'Uncategorized';
      const amount = Math.abs(txn.amount);

      // Find who paid by checking the account
      const payer = accountToMember[txn.account_id];

      if (payer) {
        if (!result[payer][categoryName]) {
          result[payer][categoryName] = 0;
        }
        result[payer][categoryName] += amount;
      } else {
        // Transaction in an account not assigned to any member
        if (!result['Other']) {
          result['Other'] = {};
        }
        if (!result['Other'][categoryName]) {
          result['Other'][categoryName] = 0;
        }
        result['Other'][categoryName] += amount;
      }
    });

    return result;
  },

  showLoading(show) {
    if (this.elements.analyticsLoading) {
      this.elements.analyticsLoading.style.display = show ? 'block' : 'none';
    }

    // Hide error state when loading
    if (this.elements.analyticsError) {
      this.elements.analyticsError.style.display = 'none';
    }

    // Hide content sections while loading
    ['cumulativeChartCard', 'contributionHistoryCard', 'moneyFlowCard', 'spendingBreakdownCard', 'memberComparisonCard', 'trendsCard'].forEach(cardName => {
      if (this.elements[cardName]) {
        this.elements[cardName].style.display = show ? 'none' : 'block';
      }
    });
  },

  renderError(error) {
    // Hide all content cards
    ['cumulativeChartCard', 'contributionHistoryCard', 'moneyFlowCard', 'spendingBreakdownCard', 'memberComparisonCard', 'trendsCard'].forEach(cardName => {
      if (this.elements[cardName]) {
        this.elements[cardName].style.display = 'none';
      }
    });

    // Determine user-friendly error message
    let title = 'Failed to Load Analytics';
    let message = error.message || 'An unexpected error occurred.';
    let suggestion = 'Please try again or contact support if the problem persists.';

    if (error.message?.includes('Network error') || error.message?.includes('fetch')) {
      title = 'Connection Error';
      message = 'Could not connect to YNAB.';
      suggestion = 'Please check your internet connection and try again.';
    } else if (error.message?.includes('401') || error.message?.includes('Unauthorized')) {
      title = 'Authentication Error';
      message = 'Your API key appears to be invalid or expired.';
      suggestion = 'Please check your API key in Settings.';
    } else if (error.message?.includes('429') || error.message?.includes('rate limit')) {
      title = 'Rate Limited';
      message = 'Too many requests to YNAB API.';
      suggestion = 'Please wait a moment and try again.';
    } else if (error.message?.includes('500') || error.message?.includes('502') || error.message?.includes('503')) {
      title = 'Service Unavailable';
      message = 'YNAB service is temporarily unavailable.';
      suggestion = 'Please try again in a few minutes.';
    }

    // Show or create error container
    let errorContainer = this.elements.analyticsError;
    if (!errorContainer) {
      errorContainer = document.createElement('div');
      errorContainer.id = 'analytics-error';
      errorContainer.className = 'analytics-error-state';
      this.elements.analyticsContent.insertBefore(errorContainer, this.elements.analyticsContent.firstChild.nextSibling);
      this.elements.analyticsError = errorContainer;
    }

    errorContainer.innerHTML = `
      <div class="error-state-content">
        <div class="error-state-icon">&#9888;</div>
        <h3 class="error-state-title">${Utils.escapeHtml(title)}</h3>
        <p class="error-state-message">${Utils.escapeHtml(message)}</p>
        <p class="error-state-suggestion">${Utils.escapeHtml(suggestion)}</p>
        <button class="btn btn-primary" id="btn-retry-analytics">Try Again</button>
      </div>
    `;

    errorContainer.style.display = 'block';

    // Bind retry button
    document.getElementById('btn-retry-analytics')?.addEventListener('click', () => {
      this.loadAnalytics(true);
    });
  },

  renderAnalytics() {
    if (!this.state.data) return;

    // Hide error state if visible
    if (this.elements.analyticsError) {
      this.elements.analyticsError.style.display = 'none';
    }

    this.renderCumulativeChart();
    this.renderContributionHistory();
    this.renderMoneyFlow();
    this.renderSpendingBreakdown();
    this.renderMemberComparison();
    this.renderTrends();
  },

  renderCumulativeChart() {
    const { members, sharedTransactions } = this.state.data;

    // Collect all months from all members and shared transactions
    const allMonths = new Set();
    members.forEach(m => {
      m.monthlyData.forEach(md => allMonths.add(md.month));
    });
    sharedTransactions.forEach(t => {
      allMonths.add(t.date.substring(0, 7));
    });
    const sortedMonths = Array.from(allMonths).sort();

    if (sortedMonths.length === 0) {
      this.elements.cumulativeChartContainer.innerHTML = '<p class="text-muted">No data available for the selected time range.</p>';
      this.elements.cumulativeChartCard.style.display = 'block';
      return;
    }

    // Get expenses from shared budget transactions grouped by month
    const expensesByMonth = {};
    sharedTransactions.forEach(t => {
      const month = t.date.substring(0, 7);
      if (!expensesByMonth[month]) {
        expensesByMonth[month] = 0;
      }
      expensesByMonth[month] += Math.abs(t.amount);
    });

    // Build cumulative data
    let cumulativeExpenses = 0;
    const cumulativeByMember = {};
    members.forEach(m => {
      cumulativeByMember[m.member.name] = 0;
    });

    const chartData = sortedMonths.map(month => {
      // Get expenses from shared budget for this month
      const monthExpenses = expensesByMonth[month] || 0;
      cumulativeExpenses += monthExpenses;

      // Get contributions per member for this month
      const memberData = {};
      members.forEach(m => {
        const md = m.monthlyData.find(d => d.month === month);
        cumulativeByMember[m.member.name] += (md?.contributed || 0);
        memberData[m.member.name] = cumulativeByMember[m.member.name];
      });

      return {
        month,
        monthLabel: this.formatMonthLabel(month, true),
        expenses: cumulativeExpenses,
        ...memberData
      };
    });

    // Calculate summary stats
    const totalExpenses = cumulativeExpenses;
    const memberTotals = members.map(m => ({
      name: m.member.name,
      total: cumulativeByMember[m.member.name]
    }));

    // Render summary cards above the chart
    const memberSummaryHtml = memberTotals.map(m => `
      <div class="cumulative-stat">
        <span class="cumulative-stat-label">${Utils.escapeHtml(m.name)}'s Contributions</span>
        <span class="cumulative-stat-value">${Utils.formatCurrency(YnabClient.fromMilliunits(m.total))}</span>
      </div>
    `).join('');

    const summaryHtml = `
      <div class="cumulative-summary">
        <div class="cumulative-stat">
          <span class="cumulative-stat-label">Total Household Expenses</span>
          <span class="cumulative-stat-value text-danger">${Utils.formatCurrency(YnabClient.fromMilliunits(totalExpenses))}</span>
        </div>
        ${memberSummaryHtml}
      </div>
      <div id="cumulative-chart"></div>
    `;

    this.elements.cumulativeChartContainer.innerHTML = summaryHtml;
    this.elements.cumulativeChartCard.style.display = 'block';

    // Render the chart
    const chartContainer = document.getElementById('cumulative-chart');
    if (chartContainer && chartData.length > 0) {
      Charts.cumulativeExpensesChart(chartContainer, {
        data: chartData,
        members: members.map(m => m.member.name),
        height: 280,
        showLegend: true
      });
    }
  },

  renderContributionHistory() {
    const { members, start, end } = this.state.data;

    // Collect all months from all members
    const allMonths = new Set();
    members.forEach(m => {
      m.monthlyData.forEach(md => allMonths.add(md.month));
    });
    const sortedMonths = Array.from(allMonths).sort();

    // Prepare chart data
    const chartData = sortedMonths.map(month => ({
      month,
      monthLabel: this.formatMonthLabel(month, true),
      members: members.map(m => {
        const monthData = m.monthlyData.find(md => md.month === month);
        return {
          name: m.member.name,
          spent: monthData?.spent || 0,
          contributed: monthData?.contributed || 0
        };
      })
    }));

    // Build table rows
    const rows = sortedMonths.map(month => {
      const monthLabel = this.formatMonthLabel(month);
      const memberCells = members.map(m => {
        const monthData = m.monthlyData.find(md => md.month === month);
        if (!monthData) return '<td class="text-muted">-</td><td class="text-muted">-</td>';

        return `
          <td class="text-danger">${Utils.formatCurrency(YnabClient.fromMilliunits(monthData.spent))}</td>
          <td class="text-success">${Utils.formatCurrency(YnabClient.fromMilliunits(monthData.contributed))}</td>
        `;
      }).join('');

      // Calculate totals for the row
      const totalSpent = members.reduce((sum, m) => {
        const md = m.monthlyData.find(d => d.month === month);
        return sum + (md?.spent || 0);
      }, 0);
      const totalContributed = members.reduce((sum, m) => {
        const md = m.monthlyData.find(d => d.month === month);
        return sum + (md?.contributed || 0);
      }, 0);

      return `
        <tr>
          <td class="month-label">${monthLabel}</td>
          ${memberCells}
          <td class="text-danger font-bold">${Utils.formatCurrency(YnabClient.fromMilliunits(totalSpent))}</td>
          <td class="text-success font-bold">${Utils.formatCurrency(YnabClient.fromMilliunits(totalContributed))}</td>
        </tr>
      `;
    }).join('');

    // Build header
    const memberHeaders = members.map(m => `
      <th colspan="2">${Utils.escapeHtml(m.member.name)}</th>
    `).join('');
    const memberSubHeaders = members.map(() => `
      <th>Spent</th>
      <th>Contrib.</th>
    `).join('');

    // Calculate grand totals
    const grandTotalSpent = members.reduce((sum, m) => sum + m.totals.spent, 0);
    const grandTotalContributed = members.reduce((sum, m) => sum + m.totals.contributed, 0);
    const memberTotals = members.map(m => `
      <td class="text-danger">${Utils.formatCurrency(YnabClient.fromMilliunits(m.totals.spent))}</td>
      <td class="text-success">${Utils.formatCurrency(YnabClient.fromMilliunits(m.totals.contributed))}</td>
    `).join('');

    const html = `
      <div class="contribution-chart-container" id="contribution-chart"></div>
      <div class="analytics-table-wrapper analytics-table-limited">
        <table class="analytics-table">
          <thead>
            <tr>
              <th rowspan="2">Month</th>
              ${memberHeaders}
              <th colspan="2">Total</th>
            </tr>
            <tr>
              ${memberSubHeaders}
              <th>Spent</th>
              <th>Contrib.</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
          <tfoot>
            <tr>
              <td><strong>Total</strong></td>
              ${memberTotals}
              <td class="text-danger font-bold">${Utils.formatCurrency(YnabClient.fromMilliunits(grandTotalSpent))}</td>
              <td class="text-success font-bold">${Utils.formatCurrency(YnabClient.fromMilliunits(grandTotalContributed))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;

    this.elements.contributionHistoryContainer.innerHTML = html;
    this.elements.contributionHistoryCard.style.display = 'block';

    // Render the chart
    const chartContainer = document.getElementById('contribution-chart');
    if (chartContainer && chartData.length > 0) {
      Charts.contributionChart(chartContainer, {
        data: chartData,
        height: 220,
        showLegend: true
      });
    }
  },

  renderMoneyFlow() {
    const { members, sharedCategoryBreakdown, memberCategorySpending } = this.state.data;
    const colors = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

    // Build sources: each member who actually paid for things
    const memberNames = members.map(m => m.member.name);
    const allPayers = [...memberNames];
    if (memberCategorySpending['Other']) {
      allPayers.push('Other');
    }

    const sources = allPayers.map((name, i) => {
      // Calculate total this member actually paid (sum across all categories)
      const spending = memberCategorySpending[name] || {};
      const totalPaid = Object.values(spending).reduce((sum, amt) => sum + amt, 0);
      return {
        name,
        amount: totalPaid,
        color: name === 'Other' ? '#94a3b8' : colors[i % colors.length]
      };
    }).filter(s => s.amount > 0);

    const totalPaid = sources.reduce((sum, s) => sum + s.amount, 0);

    // If no data, show message
    if (sources.length === 0 || sharedCategoryBreakdown.length === 0) {
      this.elements.moneyFlowContainer.innerHTML = '<p class="text-muted">No spending data available for the selected time range.</p>';
      this.elements.moneyFlowCard.style.display = 'block';
      return;
    }

    // Build targets with actual flows from members
    const targets = sharedCategoryBreakdown
      .slice(0, 10)
      .map(cat => ({
        name: cat.name,
        amount: cat.amount,
        flows: sources.map(s => {
          const memberSpending = memberCategorySpending[s.name] || {};
          const amountFromMember = memberSpending[cat.name] || 0;
          return {
            source: s.name,
            amount: amountFromMember
          };
        }).filter(f => f.amount > 0)
      }));

    // Prepare sankey data
    const sankeyData = {
      sources,
      targets
    };

    // Render the Sankey chart
    this.elements.moneyFlowContainer.innerHTML = '<div id="sankey-chart-container"></div>';
    this.elements.moneyFlowCard.style.display = 'block';

    const sankeyContainer = document.getElementById('sankey-chart-container');
    if (sankeyContainer) {
      Charts.sankeyChart(sankeyContainer, {
        data: sankeyData,
        height: 400,
        showLabels: true
      });
    }
  },

  renderSpendingBreakdown() {
    const { sharedCategoryBreakdown } = this.state.data;

    // Use categories from shared budget
    const sortedCategories = sharedCategoryBreakdown.slice(0, 15);
    const totalSpent = sortedCategories.reduce((sum, c) => sum + c.amount, 0);
    const colors = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

    // Build table
    const rows = sortedCategories.map((cat, i) => {
      const percentage = totalSpent > 0 ? (cat.amount / totalSpent * 100) : 0;
      const color = colors[i % colors.length];

      return `
        <tr>
          <td>
            <span class="category-dot" style="background: ${color}"></span>
            ${Utils.escapeHtml(cat.name)}
          </td>
          <td class="text-right">${cat.count}</td>
          <td class="text-right">${Utils.formatCurrency(YnabClient.fromMilliunits(cat.amount))}</td>
          <td class="text-right">${percentage.toFixed(1)}%</td>
          <td>
            <div class="percentage-bar-inline">
              <div class="percentage-bar-fill" style="width: ${percentage}%; background: ${color}"></div>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    const html = `
      <div class="spending-summary">
        <div class="spending-total">
          <span class="spending-total-label">Total Spending</span>
          <span class="spending-total-value">${Utils.formatCurrency(YnabClient.fromMilliunits(totalSpent))}</span>
        </div>
        <div class="spending-category-count">
          <span class="spending-total-label">Categories</span>
          <span class="spending-total-value">${sortedCategories.length}</span>
        </div>
      </div>
      <div class="analytics-table-wrapper">
        <table class="analytics-table">
          <thead>
            <tr>
              <th>Category</th>
              <th class="text-right">Txns</th>
              <th class="text-right">Amount</th>
              <th class="text-right">%</th>
              <th style="width: 150px"></th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    `;

    this.elements.spendingBreakdownContainer.innerHTML = html;
    this.elements.spendingBreakdownCard.style.display = 'block';
  },

  renderMemberComparison() {
    const { members } = this.state.data;

    // Store transaction data for hover display
    this._memberTxnData = {};
    members.forEach(m => {
      this._memberTxnData[m.member.name] = {
        spent: m.transactions,
        contributed: m.contributions,
        reimbursements: m.reimbursements,
        transfers: m.transfers
      };
    });

    const totalSpent = members.reduce((sum, m) => sum + m.totals.spent, 0);
    const totalContributed = members.reduce((sum, m) => sum + m.totals.contributed, 0);
    const colors = ['#2563eb', '#10b981', '#f59e0b'];

    const memberCards = members.map((m, i) => {
      const spentPct = totalSpent > 0 ? (m.totals.spent / totalSpent * 100) : 0;
      const contribPct = totalContributed > 0 ? (m.totals.contributed / totalContributed * 100) : 0;
      const color = colors[i % colors.length];

      const avgMonthlySpent = m.monthlyData.length > 0
        ? m.totals.spent / m.monthlyData.length
        : 0;
      const avgMonthlyContrib = m.monthlyData.length > 0
        ? m.totals.contributed / m.monthlyData.length
        : 0;

      const memberName = Utils.escapeHtml(m.member.name);

      // Net spending = spent - reimbursements
      const netSpent = m.totals.spent - m.totals.reimbursements;

      return `
        <div class="member-analytics-card" style="border-left-color: ${color}">
          <h4>${memberName}</h4>
          <div class="member-analytics-stats">
            <div class="member-stat clickable" onclick="Analytics.showTxnDetails('${memberName}', 'spent')">
              <span class="member-stat-label">Gross Spent <small>(${m.transactions.length} txns)</small></span>
              <span class="member-stat-value text-danger">${Utils.formatCurrency(YnabClient.fromMilliunits(m.totals.spent))}</span>
            </div>
            <div class="member-stat clickable" onclick="Analytics.showTxnDetails('${memberName}', 'reimbursements')">
              <span class="member-stat-label">Reimbursements <small>(${m.reimbursements.length} txns)</small></span>
              <span class="member-stat-value text-success">${Utils.formatCurrency(YnabClient.fromMilliunits(m.totals.reimbursements))}</span>
            </div>
            <div class="member-stat">
              <span class="member-stat-label">Net Spent</span>
              <span class="member-stat-value text-danger">${Utils.formatCurrency(YnabClient.fromMilliunits(netSpent))}</span>
              <span class="member-stat-pct">${spentPct.toFixed(1)}% of household</span>
            </div>
            <div class="member-stat clickable" onclick="Analytics.showTxnDetails('${memberName}', 'contributed')">
              <span class="member-stat-label">Contributed <small>(${m.contributions.length} txns)</small></span>
              <span class="member-stat-value text-success">${Utils.formatCurrency(YnabClient.fromMilliunits(m.totals.contributed))}</span>
              <span class="member-stat-pct">${contribPct.toFixed(1)}% of household</span>
            </div>
            <div class="member-stat clickable" onclick="Analytics.showTxnDetails('${memberName}', 'transfers')">
              <span class="member-stat-label">Net Transfers <small>(${m.transfers.length} txns)</small></span>
              <span class="member-stat-value ${m.totals.netTransfers >= 0 ? 'text-success' : 'text-danger'}">
                ${Utils.formatCurrency(YnabClient.fromMilliunits(m.totals.netTransfers))}
              </span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Contribution split visualization
    const splitBars = members.map((m, i) => {
      const pct = totalContributed > 0 ? (m.totals.contributed / totalContributed * 100) : 0;
      return `<div class="split-segment" style="width: ${pct}%; background: ${colors[i % colors.length]}" title="${m.member.name}: ${pct.toFixed(1)}%"></div>`;
    }).join('');

    const splitLegend = members.map((m, i) => {
      const pct = totalContributed > 0 ? (m.totals.contributed / totalContributed * 100) : 0;
      return `
        <div class="split-legend-item">
          <span class="split-legend-dot" style="background: ${colors[i % colors.length]}"></span>
          ${Utils.escapeHtml(m.member.name)}: ${pct.toFixed(1)}%
        </div>
      `;
    }).join('');

    const html = `
      <div class="contribution-split-section">
        <h4>Contribution Split</h4>
        <div class="contribution-split-bar">
          ${splitBars}
        </div>
        <div class="contribution-split-legend">
          ${splitLegend}
        </div>
      </div>
      <div class="member-analytics-grid">
        ${memberCards}
      </div>
    `;

    this.elements.memberComparisonContainer.innerHTML = html;
    this.elements.memberComparisonCard.style.display = 'block';
  },

  renderTrends() {
    const { members } = this.state.data;

    // Calculate month-over-month trends
    const allMonthlyData = {};
    members.forEach(m => {
      m.monthlyData.forEach(md => {
        if (!allMonthlyData[md.month]) {
          allMonthlyData[md.month] = { spent: 0, contributed: 0 };
        }
        allMonthlyData[md.month].spent += md.spent;
        allMonthlyData[md.month].contributed += md.contributed;
      });
    });

    const sortedMonths = Object.entries(allMonthlyData)
      .sort((a, b) => a[0].localeCompare(b[0]));

    // Calculate trends
    const trends = [];

    if (sortedMonths.length >= 2) {
      const lastMonth = sortedMonths[sortedMonths.length - 1];
      const prevMonth = sortedMonths[sortedMonths.length - 2];

      const spendingChange = lastMonth[1].spent - prevMonth[1].spent;
      const spendingPctChange = prevMonth[1].spent > 0
        ? (spendingChange / prevMonth[1].spent * 100)
        : 0;

      const contribChange = lastMonth[1].contributed - prevMonth[1].contributed;
      const contribPctChange = prevMonth[1].contributed > 0
        ? (contribChange / prevMonth[1].contributed * 100)
        : 0;

      trends.push({
        label: 'Spending vs Last Month',
        value: spendingPctChange,
        absolute: spendingChange,
        type: spendingChange <= 0 ? 'good' : 'bad'
      });

      trends.push({
        label: 'Contributions vs Last Month',
        value: contribPctChange,
        absolute: contribChange,
        type: contribChange >= 0 ? 'good' : 'bad'
      });
    }

    // Average calculations
    if (sortedMonths.length > 0) {
      const totalMonths = sortedMonths.length;
      const avgSpending = sortedMonths.reduce((sum, [_, d]) => sum + d.spent, 0) / totalMonths;
      const avgContrib = sortedMonths.reduce((sum, [_, d]) => sum + d.contributed, 0) / totalMonths;

      trends.push({
        label: 'Avg Monthly Spending',
        value: null,
        absolute: avgSpending,
        type: 'neutral'
      });

      trends.push({
        label: 'Avg Monthly Contributions',
        value: null,
        absolute: avgContrib,
        type: 'neutral'
      });
    }

    // Build trend cards
    const trendCards = trends.map(t => {
      let icon = '';
      let changeText = '';

      if (t.value !== null) {
        icon = t.value > 0 ? '↑' : t.value < 0 ? '↓' : '→';
        changeText = `<span class="trend-change ${t.type}">${icon} ${Math.abs(t.value).toFixed(1)}%</span>`;
      }

      return `
        <div class="trend-card ${t.type}">
          <div class="trend-label">${t.label}</div>
          <div class="trend-value">${Utils.formatCurrency(YnabClient.fromMilliunits(t.absolute))}</div>
          ${changeText}
        </div>
      `;
    }).join('');

    // Find top spending patterns
    const payeeSpending = {};
    members.forEach(m => {
      m.transactions.forEach(t => {
        if (t.amount >= 0) return;
        const payee = t.payee_name || 'Unknown';
        if (!payeeSpending[payee]) {
          payeeSpending[payee] = { name: payee, amount: 0, count: 0 };
        }
        payeeSpending[payee].amount += Math.abs(t.amount);
        payeeSpending[payee].count++;
      });
    });

    const topPayees = Object.values(payeeSpending)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    const topPayeesHtml = topPayees.map(p => `
      <div class="top-payee-item">
        <span class="top-payee-name">${Utils.escapeHtml(p.name)}</span>
        <span class="top-payee-count">${p.count} txns</span>
        <span class="top-payee-amount">${Utils.formatCurrency(YnabClient.fromMilliunits(p.amount))}</span>
      </div>
    `).join('');

    const html = `
      <div class="trends-grid">
        ${trendCards}
      </div>
      <div class="top-payees-section">
        <h4>Top Spending Recipients</h4>
        <div class="top-payees-list">
          ${topPayeesHtml}
        </div>
      </div>
    `;

    this.elements.trendsContainer.innerHTML = html;
    this.elements.trendsCard.style.display = 'block';
  },

  formatMonthLabel(monthStr, short = false) {
    const [year, month] = monthStr.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1, 1);
    if (short) {
      // Return "Jan'24" format for charts
      const monthName = date.toLocaleDateString('en-US', { month: 'short' });
      const shortYear = year.slice(-2);
      return `${monthName}'${shortYear}`;
    }
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
  },

  /**
   * Show transaction details modal for debugging
   */
  showTxnDetails(memberName, type) {
    const data = this._memberTxnData?.[memberName];
    if (!data) {
      alert('No data available');
      return;
    }

    const txns = data[type] || [];
    const typeLabels = {
      spent: 'Spending Transactions (outflows, non-transfers)',
      contributed: 'Contribution Transactions (inflows to Ready to Assign)',
      reimbursements: 'Reimbursement Transactions (categorized inflows)',
      transfers: 'Transfer Transactions (between members)'
    };

    // Sort by date descending
    const sorted = [...txns].sort((a, b) => b.date.localeCompare(a.date));

    // Calculate total
    const total = sorted.reduce((sum, t) => sum + t.amount, 0);

    // Build transaction list HTML
    const txnRows = sorted.map(t => {
      const amount = YnabClient.fromMilliunits(t.amount);
      const amountClass = t.amount >= 0 ? 'text-success' : 'text-danger';
      const payee = t.payee_name || (t.transfer_account_id ? 'Transfer' : 'Unknown');
      const category = t.category_name || '-';
      const memo = t.memo || '';

      return `
        <tr>
          <td>${t.date}</td>
          <td>${Utils.escapeHtml(payee)}</td>
          <td>${Utils.escapeHtml(category)}</td>
          <td class="${amountClass}" style="text-align: right; font-family: monospace;">
            ${Utils.formatCurrency(amount)}
          </td>
          <td style="font-size: 0.75rem; color: #666;">${Utils.escapeHtml(memo)}</td>
        </tr>
      `;
    }).join('');

    // Create modal
    const modal = document.createElement('div');
    modal.className = 'txn-details-modal';
    modal.innerHTML = `
      <div class="txn-details-backdrop" onclick="Analytics.closeTxnDetails()"></div>
      <div class="txn-details-content">
        <div class="txn-details-header">
          <h3>${memberName} - ${typeLabels[type]}</h3>
          <button class="txn-details-close" onclick="Analytics.closeTxnDetails()">&times;</button>
        </div>
        <div class="txn-details-summary">
          <span><strong>${sorted.length}</strong> transactions</span>
          <span>Total: <strong class="${total >= 0 ? 'text-success' : 'text-danger'}">${Utils.formatCurrency(YnabClient.fromMilliunits(total))}</strong></span>
        </div>
        <div class="txn-details-table-wrapper">
          <table class="txn-details-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Payee</th>
                <th>Category</th>
                <th style="text-align: right;">Amount</th>
                <th>Memo</th>
              </tr>
            </thead>
            <tbody>
              ${txnRows || '<tr><td colspan="5" class="text-muted">No transactions</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
  },

  /**
   * Close transaction details modal
   */
  closeTxnDetails() {
    const modal = document.querySelector('.txn-details-modal');
    if (modal) {
      modal.remove();
    }
  }
};

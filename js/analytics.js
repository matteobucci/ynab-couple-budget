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
    error: null,
    sectionModes: {
      allocations: 'monthly',
      expenses: 'monthly',
      balancing: 'monthly'
    }
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

    // Mode toggles (Monthly/Cumulative) per section
    document.querySelectorAll('.chart-mode-toggle').forEach(toggle => {
      const section = toggle.dataset.section;
      toggle.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const mode = btn.dataset.mode;
          this.state.sectionModes[section] = mode;
          // Update active state
          toggle.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
          this.renderSection(section);
        });
      });
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
        t.date >= start && t.date <= end && TxnTypes.isExpense(t)
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

    // Classify transactions by type
    const { contributions, reimbursements, expenses, balancingTransfers } = TxnTypes.classifySharedTransactions(filteredTxns);
    const spending = expenses;
    const transfers = balancingTransfers;

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
    ['allocationsCard', 'expensesCard', 'balancingCard'].forEach(cardName => {
      if (this.elements[cardName]) {
        this.elements[cardName].style.display = show ? 'none' : 'block';
      }
    });
  },

  renderError(error) {
    // Hide all content cards
    ['allocationsCard', 'expensesCard', 'balancingCard'].forEach(cardName => {
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

    // Store transaction data for detail modals
    this._memberTxnData = {};
    this.state.data.members.forEach(m => {
      this._memberTxnData[m.member.name] = {
        spent: m.transactions,
        contributed: m.contributions,
        reimbursements: m.reimbursements,
        transfers: m.transfers
      };
    });

    this.renderSection('allocations');
    this.renderSection('expenses');
    this.renderSection('balancing');
  },

  renderSection(section) {
    const mode = this.state.sectionModes[section];
    switch (section) {
      case 'allocations':
        mode === 'cumulative' ? this.renderAllocationsCumulative() : this.renderAllocationsMonthly();
        break;
      case 'expenses':
        mode === 'cumulative' ? this.renderExpensesCumulative() : this.renderExpensesMonthly();
        break;
      case 'balancing':
        mode === 'cumulative' ? this.renderBalancingCumulative() : this.renderBalancingMonthly();
        break;
    }
  },

  // ---- ALLOCATIONS SECTION ----

  renderAllocationsMonthly() {
    const { members } = this.state.data;
    const sortedMonths = this.getAllSortedMonths();
    const colors = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

    if (sortedMonths.length === 0) {
      this.elements.allocationsContainer.innerHTML = '<p class="text-muted">No allocation data for the selected time range.</p>';
      this.elements.allocationsCard.style.display = 'block';
      return;
    }

    // Summary stats
    const totalContributed = members.reduce((sum, m) => sum + m.totals.contributed, 0);
    const avgMonthly = sortedMonths.length > 0 ? totalContributed / sortedMonths.length : 0;

    const memberSummaryHtml = members.map((m, i) => {
      const pct = totalContributed > 0 ? (m.totals.contributed / totalContributed * 100) : 0;
      return `
        <div class="analytics-summary-stat clickable" onclick="Analytics.showTxnDetails('${Utils.escapeHtml(m.member.name)}', 'contributed')">
          <span class="analytics-summary-label">${Utils.escapeHtml(m.member.name)}</span>
          <span class="analytics-summary-value text-success">${Utils.formatCurrency(YnabClient.fromMilliunits(m.totals.contributed))}</span>
          <span class="analytics-summary-sub">${pct.toFixed(0)}% of total</span>
        </div>
      `;
    }).join('');

    // Bar chart data
    const chartData = sortedMonths.map(month => ({
      label: this.formatMonthLabel(month, true),
      values: members.map((m, i) => {
        const md = m.monthlyData.find(d => d.month === month);
        return {
          name: m.member.name,
          value: md?.contributed || 0,
          color: colors[i % colors.length]
        };
      })
    }));

    const html = `
      <div class="analytics-summary-row">
        <div class="analytics-summary-stat">
          <span class="analytics-summary-label">Total Contributed</span>
          <span class="analytics-summary-value">${Utils.formatCurrency(YnabClient.fromMilliunits(totalContributed))}</span>
        </div>
        <div class="analytics-summary-stat">
          <span class="analytics-summary-label">Monthly Average</span>
          <span class="analytics-summary-value">${Utils.formatCurrency(YnabClient.fromMilliunits(avgMonthly))}</span>
        </div>
        ${memberSummaryHtml}
      </div>
      <div id="allocations-chart"></div>
    `;

    this.elements.allocationsContainer.innerHTML = html;
    this.elements.allocationsCard.style.display = 'block';

    const chartContainer = document.getElementById('allocations-chart');
    if (chartContainer && chartData.length > 0) {
      Charts.barChart(chartContainer, { data: chartData, height: 260 });
    }
  },

  renderAllocationsCumulative() {
    const { members } = this.state.data;
    const sortedMonths = this.getAllSortedMonths();
    const colors = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

    if (sortedMonths.length === 0) {
      this.elements.allocationsContainer.innerHTML = '<p class="text-muted">No allocation data for the selected time range.</p>';
      this.elements.allocationsCard.style.display = 'block';
      return;
    }

    // Build cumulative data
    const cumulativeByMember = {};
    members.forEach(m => { cumulativeByMember[m.member.name] = 0; });

    const chartData = sortedMonths.map(month => {
      const point = { month, monthLabel: this.formatMonthLabel(month, true) };
      members.forEach(m => {
        const md = m.monthlyData.find(d => d.month === month);
        cumulativeByMember[m.member.name] += (md?.contributed || 0);
        point[m.member.name] = cumulativeByMember[m.member.name];
      });
      // Use total contributions as "expenses" line for the cumulative chart
      point.expenses = Object.values(cumulativeByMember).reduce((s, v) => s + v, 0);
      return point;
    });

    // Summary
    const memberTotals = members.map(m => ({
      name: m.member.name,
      total: cumulativeByMember[m.member.name]
    }));

    const memberSummaryHtml = memberTotals.map(m => `
      <div class="analytics-summary-stat">
        <span class="analytics-summary-label">${Utils.escapeHtml(m.name)}</span>
        <span class="analytics-summary-value text-success">${Utils.formatCurrency(YnabClient.fromMilliunits(m.total))}</span>
      </div>
    `).join('');

    const html = `
      <div class="analytics-summary-row">
        ${memberSummaryHtml}
      </div>
      <div id="allocations-cumulative-chart"></div>
    `;

    this.elements.allocationsContainer.innerHTML = html;
    this.elements.allocationsCard.style.display = 'block';

    // Render line chart using contributionChart (shows per-member lines)
    const chartContainer = document.getElementById('allocations-cumulative-chart');
    if (chartContainer && chartData.length > 0) {
      // Build data in the format contributionChart expects
      const lineData = sortedMonths.map((month, i) => ({
        month,
        monthLabel: this.formatMonthLabel(month, true),
        members: members.map(m => {
          const cumVal = chartData[i][m.member.name] || 0;
          return { name: m.member.name, spent: 0, contributed: cumVal };
        })
      }));
      Charts.contributionChart(chartContainer, {
        data: lineData,
        height: 260,
        showLegend: true
      });
    }
  },

  // ---- EXPENSES SECTION ----

  renderExpensesMonthly() {
    const { members, sharedTransactions, sharedCategoryBreakdown } = this.state.data;
    const sortedMonths = this.getAllSortedMonths();
    const colors = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];
    const catColors = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

    // Group expenses by month from shared transactions
    const expensesByMonth = {};
    sharedTransactions.forEach(t => {
      const month = t.date.substring(0, 7);
      if (!expensesByMonth[month]) expensesByMonth[month] = 0;
      expensesByMonth[month] += Math.abs(t.amount);
    });

    const totalSpent = sharedTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const avgMonthly = sortedMonths.length > 0 ? totalSpent / sortedMonths.length : 0;

    // Per-member spending summary
    const memberSpendingHtml = members.map((m, i) => `
      <div class="analytics-summary-stat clickable" onclick="Analytics.showTxnDetails('${Utils.escapeHtml(m.member.name)}', 'spent')">
        <span class="analytics-summary-label">${Utils.escapeHtml(m.member.name)}</span>
        <span class="analytics-summary-value text-danger">${Utils.formatCurrency(YnabClient.fromMilliunits(m.totals.spent))}</span>
      </div>
    `).join('');

    // Bar chart: total household spending per month
    const chartData = sortedMonths.map(month => ({
      label: this.formatMonthLabel(month, true),
      values: [{
        name: 'Expenses',
        value: expensesByMonth[month] || 0,
        color: '#ef4444'
      }]
    }));

    // Category breakdown table
    const sortedCategories = sharedCategoryBreakdown.slice(0, 12);
    const catTotal = sortedCategories.reduce((sum, c) => sum + c.amount, 0);
    const categoryRows = sortedCategories.map((cat, i) => {
      const pct = catTotal > 0 ? (cat.amount / catTotal * 100) : 0;
      const color = catColors[i % catColors.length];
      return `
        <tr>
          <td><span class="category-dot" style="background: ${color}"></span> ${Utils.escapeHtml(cat.name)}</td>
          <td class="text-right">${cat.count}</td>
          <td class="text-right">${Utils.formatCurrency(YnabClient.fromMilliunits(cat.amount))}</td>
          <td class="text-right">${pct.toFixed(1)}%</td>
          <td><div class="percentage-bar-inline"><div class="percentage-bar-fill" style="width: ${pct}%; background: ${color}"></div></div></td>
        </tr>
      `;
    }).join('');

    const html = `
      <div class="analytics-summary-row">
        <div class="analytics-summary-stat">
          <span class="analytics-summary-label">Total Spending</span>
          <span class="analytics-summary-value text-danger">${Utils.formatCurrency(YnabClient.fromMilliunits(totalSpent))}</span>
        </div>
        <div class="analytics-summary-stat">
          <span class="analytics-summary-label">Monthly Average</span>
          <span class="analytics-summary-value">${Utils.formatCurrency(YnabClient.fromMilliunits(avgMonthly))}</span>
        </div>
        ${memberSpendingHtml}
      </div>
      <div id="expenses-chart"></div>
      ${sortedCategories.length > 0 ? `
        <div class="analytics-category-breakdown">
          <h4>By Category</h4>
          <div class="analytics-table-wrapper">
            <table class="analytics-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th class="text-right">Txns</th>
                  <th class="text-right">Amount</th>
                  <th class="text-right">%</th>
                  <th style="width: 120px"></th>
                </tr>
              </thead>
              <tbody>${categoryRows}</tbody>
            </table>
          </div>
        </div>
      ` : ''}
    `;

    this.elements.expensesContainer.innerHTML = html;
    this.elements.expensesCard.style.display = 'block';

    const chartContainer = document.getElementById('expenses-chart');
    if (chartContainer && chartData.length > 0) {
      Charts.barChart(chartContainer, { data: chartData, height: 240 });
    }
  },

  renderExpensesCumulative() {
    const { members, sharedTransactions } = this.state.data;
    const sortedMonths = this.getAllSortedMonths();

    if (sortedMonths.length === 0) {
      this.elements.expensesContainer.innerHTML = '<p class="text-muted">No expense data for the selected time range.</p>';
      this.elements.expensesCard.style.display = 'block';
      return;
    }

    // Group expenses by month
    const expensesByMonth = {};
    sharedTransactions.forEach(t => {
      const month = t.date.substring(0, 7);
      if (!expensesByMonth[month]) expensesByMonth[month] = 0;
      expensesByMonth[month] += Math.abs(t.amount);
    });

    // Build cumulative data
    let cumulativeExpenses = 0;
    const cumulativeByMember = {};
    members.forEach(m => { cumulativeByMember[m.member.name] = 0; });

    const chartData = sortedMonths.map(month => {
      cumulativeExpenses += (expensesByMonth[month] || 0);
      const point = {
        month,
        monthLabel: this.formatMonthLabel(month, true),
        expenses: cumulativeExpenses
      };
      members.forEach(m => {
        const md = m.monthlyData.find(d => d.month === month);
        cumulativeByMember[m.member.name] += (md?.contributed || 0);
        point[m.member.name] = cumulativeByMember[m.member.name];
      });
      return point;
    });

    const totalExpenses = cumulativeExpenses;
    const totalContributed = Object.values(cumulativeByMember).reduce((s, v) => s + v, 0);

    const html = `
      <div class="analytics-summary-row">
        <div class="analytics-summary-stat">
          <span class="analytics-summary-label">Total Expenses</span>
          <span class="analytics-summary-value text-danger">${Utils.formatCurrency(YnabClient.fromMilliunits(totalExpenses))}</span>
        </div>
        <div class="analytics-summary-stat">
          <span class="analytics-summary-label">Total Contributions</span>
          <span class="analytics-summary-value text-success">${Utils.formatCurrency(YnabClient.fromMilliunits(totalContributed))}</span>
        </div>
      </div>
      <div id="expenses-cumulative-chart"></div>
    `;

    this.elements.expensesContainer.innerHTML = html;
    this.elements.expensesCard.style.display = 'block';

    const chartContainer = document.getElementById('expenses-cumulative-chart');
    if (chartContainer && chartData.length > 0) {
      Charts.cumulativeExpensesChart(chartContainer, {
        data: chartData,
        members: members.map(m => m.member.name),
        height: 280,
        showLegend: true
      });
    }
  },

  // ---- BALANCING SECTION ----

  renderBalancingMonthly() {
    const { members } = this.state.data;
    const sortedMonths = this.getAllSortedMonths();
    const colors = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

    // Summary stats
    const totalTransfersIn = members.reduce((sum, m) => sum + m.totals.transfersIn, 0);
    const totalTransfersOut = members.reduce((sum, m) => sum + m.totals.transfersOut, 0);
    const numSettleUps = members.reduce((sum, m) => sum + m.transfers.length, 0);

    const memberBalancingHtml = members.map((m, i) => {
      const net = m.totals.netTransfers;
      return `
        <div class="analytics-summary-stat clickable" onclick="Analytics.showTxnDetails('${Utils.escapeHtml(m.member.name)}', 'transfers')">
          <span class="analytics-summary-label">${Utils.escapeHtml(m.member.name)}</span>
          <span class="analytics-summary-value ${net >= 0 ? 'text-success' : 'text-danger'}">${Utils.formatCurrency(YnabClient.fromMilliunits(net))}</span>
          <span class="analytics-summary-sub">net</span>
        </div>
      `;
    }).join('');

    // Bar chart: net transfers per member per month
    const chartData = sortedMonths.map(month => ({
      label: this.formatMonthLabel(month, true),
      values: members.map((m, i) => {
        const md = m.monthlyData.find(d => d.month === month);
        // Show absolute transfers out (settle-up payments)
        return {
          name: m.member.name,
          value: (md?.transfersOut || 0),
          color: colors[i % colors.length]
        };
      })
    }));

    const html = `
      <div class="analytics-summary-row">
        <div class="analytics-summary-stat">
          <span class="analytics-summary-label">Total Settled</span>
          <span class="analytics-summary-value">${Utils.formatCurrency(YnabClient.fromMilliunits(totalTransfersOut))}</span>
        </div>
        <div class="analytics-summary-stat">
          <span class="analytics-summary-label">Settle-ups</span>
          <span class="analytics-summary-value">${Math.floor(numSettleUps / 2)}</span>
        </div>
        ${memberBalancingHtml}
      </div>
      <div id="balancing-chart"></div>
    `;

    this.elements.balancingContainer.innerHTML = html;
    this.elements.balancingCard.style.display = 'block';

    const chartContainer = document.getElementById('balancing-chart');
    if (chartContainer && chartData.length > 0) {
      Charts.barChart(chartContainer, { data: chartData, height: 240 });
    }
  },

  renderBalancingCumulative() {
    const { members } = this.state.data;
    const sortedMonths = this.getAllSortedMonths();

    if (sortedMonths.length === 0) {
      this.elements.balancingContainer.innerHTML = '<p class="text-muted">No balancing data for the selected time range.</p>';
      this.elements.balancingCard.style.display = 'block';
      return;
    }

    // Build cumulative net transfers per member
    const cumulativeNet = {};
    members.forEach(m => { cumulativeNet[m.member.name] = 0; });

    const chartData = sortedMonths.map(month => ({
      month,
      monthLabel: this.formatMonthLabel(month, true),
      members: members.map(m => {
        const md = m.monthlyData.find(d => d.month === month);
        cumulativeNet[m.member.name] += (md?.netTransfers || 0);
        return {
          name: m.member.name,
          spent: 0,
          contributed: cumulativeNet[m.member.name]
        };
      })
    }));

    const memberSummaryHtml = members.map(m => {
      const net = cumulativeNet[m.member.name];
      return `
        <div class="analytics-summary-stat">
          <span class="analytics-summary-label">${Utils.escapeHtml(m.member.name)}</span>
          <span class="analytics-summary-value ${net >= 0 ? 'text-success' : 'text-danger'}">${Utils.formatCurrency(YnabClient.fromMilliunits(net))}</span>
          <span class="analytics-summary-sub">cumulative net</span>
        </div>
      `;
    }).join('');

    const html = `
      <div class="analytics-summary-row">
        ${memberSummaryHtml}
      </div>
      <div id="balancing-cumulative-chart"></div>
    `;

    this.elements.balancingContainer.innerHTML = html;
    this.elements.balancingCard.style.display = 'block';

    const chartContainer = document.getElementById('balancing-cumulative-chart');
    if (chartContainer && chartData.length > 0) {
      Charts.contributionChart(chartContainer, {
        data: chartData,
        height: 260,
        showLegend: true
      });
    }
  },

  // ---- HELPERS ----

  getAllSortedMonths() {
    const { members, sharedTransactions } = this.state.data;
    const allMonths = new Set();
    members.forEach(m => {
      m.monthlyData.forEach(md => allMonths.add(md.month));
    });
    sharedTransactions.forEach(t => {
      allMonths.add(t.date.substring(0, 7));
    });
    return Array.from(allMonths).sort();
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

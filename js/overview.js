/**
 * YNAB Couple Budget - Overview/Dashboard Module
 * Provides a quick summary of balances, sync status, and items needing attention
 *
 * Uses Store subscriptions for reactive updates when transactions change.
 */
const Overview = {
  elements: {},
  state: {
    loaded: false,
    data: null,
    accountBalances: null,
    subscribed: false
  },

  init(elements) {
    this.elements = {
      notConfigured: document.getElementById('overview-not-configured'),
      content: document.getElementById('overview-content'),
      balancesContent: document.getElementById('overview-balances-content'),
      attentionContent: document.getElementById('overview-attention'),
      insightsContent: document.getElementById('overview-insights-content'),
      goTransactionsBtn: document.getElementById('btn-go-transactions'),
      goSettleBtn: document.getElementById('btn-go-settle'),
      goAnalyticsBtn: document.getElementById('btn-go-analytics'),
      refreshBtn: document.getElementById('btn-refresh-overview')
    };

    this.bindEvents();
    this.subscribeToStore();
  },

  /**
   * Subscribe to Store changes for reactive updates
   */
  subscribeToStore() {
    if (this.state.subscribed) return;

    // Subscribe to transaction changes to update insights
    Store.subscribe('transactions', () => {
      if (this.state.loaded) {
        this.onTransactionsChanged();
      }
    });

    this.state.subscribed = true;
  },

  /**
   * Handle transaction changes from Store
   */
  onTransactionsChanged() {
    // Recalculate insights when transactions change
    if (this.state.data) {
      const config = Store.getConfig();
      const insights = this.calculateInsights(this.state.data.transactions, config.members, config);
      this.renderInsights(insights, config);
    }
  },

  bindEvents() {
    // Quick action buttons
    this.elements.goTransactionsBtn?.addEventListener('click', () => {
      App.navigateTo('transactions');
    });

    this.elements.goSettleBtn?.addEventListener('click', () => {
      App.navigateTo('transactions');
      // Open the settle modal after navigating
      setTimeout(() => {
        Consistency.openSettleModal();
      }, 100);
    });

    this.elements.goAnalyticsBtn?.addEventListener('click', () => {
      App.navigateTo('analytics');
    });

    this.elements.refreshBtn?.addEventListener('click', () => {
      this.loadData(true);
    });
  },

  isConfigured() {
    return App.isConfigured();
  },

  initScreen() {
    if (!this.isConfigured()) {
      this.elements.notConfigured.style.display = 'block';
      this.elements.content.style.display = 'none';
      return;
    }

    this.elements.notConfigured.style.display = 'none';
    this.elements.content.style.display = 'block';

    if (!this.state.loaded) {
      this.loadData();
    }
  },

  async loadData(forceRefresh = false) {
    try {
      const config = Store.getConfig();
      const members = config.members || [];

      if (!config.sharedBudgetId || members.length === 0) {
        return;
      }

      // Load transactions from DataService
      // Structure: { shared: [], members: { memberId: [] } }
      const transactions = {
        shared: [],
        members: {}
      };

      // Load shared budget transactions
      const sharedTxns = await DataService.getTransactions(config.sharedBudgetId, { forceRefresh });
      transactions.shared = sharedTxns;

      // Load personal budget transactions for each member
      for (const member of members) {
        if (member.budgetId && member.sharedCategoryId) {
          const personalTxns = await DataService.getTransactions(member.budgetId, {
            categoryId: member.sharedCategoryId,
            forceRefresh
          });
          transactions.members[member.name] = personalTxns;
        }
      }

      // Fetch actual account balances for consistency check
      const accountBalances = await this.fetchAccountBalances(config, members);
      this.state.accountBalances = accountBalances;

      // Calculate balances and insights
      const balances = this.calculateBalances(transactions, members, config, accountBalances);
      const attentionItems = this.getAttentionItems(transactions, members, config);
      const insights = this.calculateInsights(transactions, members, config);

      this.state.data = { balances, attentionItems, insights, transactions };
      this.state.loaded = true;

      this.renderBalances(balances, config, accountBalances);
      this.renderAttentionItems(attentionItems);
      this.renderInsights(insights, config);

    } catch (error) {
      console.error('Failed to load overview data:', error);
      Utils.showToast('Failed to load overview data', 'error');
    }
  },

  /**
   * Fetch actual account balances from YNAB for consistency checking
   */
  async fetchAccountBalances(config, members) {
    try {
      const accounts = await YnabClient.getAccounts(config.sharedBudgetId);
      const balances = {};

      members.forEach(member => {
        const account = accounts.find(a => a.id === member.contributionAccountId);
        if (account) {
          balances[member.name] = account.balance / 1000; // Convert from milliunits
        }
      });

      return balances;
    } catch (error) {
      console.error('Failed to fetch account balances:', error);
      return null;
    }
  },

  calculateBalances(transactions, members, config, accountBalances) {
    const balances = [];

    members.forEach(member => {
      // Use actual account balance from YNAB
      const balance = accountBalances?.[member.name] ?? 0;

      balances.push({
        name: member.name,
        balance: balance
      });
    });

    // Calculate net balance (household total)
    const totalBalance = balances.reduce((sum, b) => sum + b.balance, 0);

    return { members: balances, total: totalBalance };
  },

  getAttentionItems(transactions, members, config) {
    const items = [];
    const cutoffDate = config.consistencyCutoffDate || null;

    members.forEach(member => {
      const personalTxns = (transactions.members?.[member.name] || []).filter(txn => {
        if (cutoffDate && txn.date < cutoffDate) return false;
        if (txn.deleted) return false;
        return !LinkUtils.hasId(txn.memo);
      });

      const sharedTxns = (transactions.shared || []).filter(txn => {
        if (txn.account_id !== member.contributionAccountId) return false;
        if (cutoffDate && txn.date < cutoffDate) return false;
        if (txn.deleted) return false;
        return !LinkUtils.hasId(txn.memo);
      });

      if (personalTxns.length > 0) {
        items.push({
          type: 'warning',
          icon: '&#9888;',
          title: `${member.name}: ${personalTxns.length} unlinked personal transaction${personalTxns.length !== 1 ? 's' : ''}`,
          description: 'These transactions need to be linked to the shared budget.',
          action: {
            label: 'Link Now',
            handler: () => App.navigateTo('transactions')
          }
        });
      }

      if (sharedTxns.length > 0) {
        items.push({
          type: 'warning',
          icon: '&#9888;',
          title: `${member.name}: ${sharedTxns.length} unlinked shared transaction${sharedTxns.length !== 1 ? 's' : ''}`,
          description: 'These transactions in the shared budget are not yet linked.',
          action: {
            label: 'Link Now',
            handler: () => App.navigateTo('transactions')
          }
        });
      }
    });

    // Check for balance imbalances between members
    if (members.length >= 2) {
      const balances = this.calculateBalances(transactions, members, config, this.state.accountBalances);
      const memberBalances = balances.members;

      if (memberBalances.length >= 2) {
        const diff = Math.abs(memberBalances[0].balance - memberBalances[1].balance);
        if (diff > 100) { // Threshold of 100 currency units
          const higher = memberBalances[0].balance > memberBalances[1].balance
            ? memberBalances[0] : memberBalances[1];
          const lower = memberBalances[0].balance > memberBalances[1].balance
            ? memberBalances[1] : memberBalances[0];

          items.push({
            type: 'info',
            icon: '&#9878;',
            title: `Balance difference: ${Utils.formatCurrency(diff)}`,
            description: `${higher.name} has contributed more than ${lower.name}. Consider settling up.`,
            action: {
              label: 'Settle Up',
              handler: () => {
                App.navigateTo('transactions');
                setTimeout(() => {
                  Consistency.openSettleModal();
                }, 100);
              }
            }
          });
        }
      }
    }

    return items;
  },

  renderBalances(balances, config, accountBalances) {
    if (!this.elements.balancesContent) return;

    let html = '<div class="balance-cards">';

    balances.members.forEach(member => {
      const valueClass = member.balance > 0 ? 'positive' : member.balance < 0 ? 'negative' : 'neutral';

      html += `
        <div class="balance-item">
          <span class="balance-name">${Utils.escapeHtml(member.name)}</span>
          <span class="balance-value ${valueClass}">${Utils.formatCurrency(member.balance)}</span>
        </div>
      `;
    });

    // Add household total
    const totalClass = balances.total >= 0 ? 'positive' : 'negative';

    html += `
      <div class="balance-item" style="border-left-color: #6366f1;">
        <span class="balance-name"><strong>Household Total</strong></span>
        <span class="balance-value ${totalClass}">${Utils.formatCurrency(balances.total)}</span>
      </div>
    `;

    html += '</div>';
    this.elements.balancesContent.innerHTML = html;
  },

  renderAttentionItems(items) {
    if (!this.elements.attentionContent) return;

    if (items.length === 0) {
      this.elements.attentionContent.innerHTML = `
        <div class="no-attention">
          <div class="no-attention-icon">&#10003;</div>
          <div class="no-attention-text">All caught up! No items need attention.</div>
        </div>
      `;
      return;
    }

    let html = '<div class="attention-list">';

    items.forEach((item, index) => {
      html += `
        <div class="attention-item ${item.type}">
          <div class="attention-icon">${item.icon}</div>
          <div class="attention-content">
            <div class="attention-title">${Utils.escapeHtml(item.title)}</div>
            <div class="attention-description">${Utils.escapeHtml(item.description)}</div>
            ${item.action ? `
              <div class="attention-action">
                <button class="btn btn-secondary btn-small" data-action-index="${index}">
                  ${Utils.escapeHtml(item.action.label)}
                </button>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    });

    html += '</div>';
    this.elements.attentionContent.innerHTML = html;

    // Bind action handlers
    this.elements.attentionContent.querySelectorAll('[data-action-index]').forEach(btn => {
      const index = parseInt(btn.dataset.actionIndex);
      if (items[index]?.action?.handler) {
        btn.addEventListener('click', items[index].action.handler);
      }
    });
  },

  /**
   * Calculate insights and analytics for the overview panel
   */
  calculateInsights(transactions, members, config) {
    const cutoffDate = config.consistencyCutoffDate || null;
    const now = new Date();
    const currentMonth = now.toISOString().slice(0, 7); // YYYY-MM
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7);

    // Get all shared transactions, excluding transfers between accounts
    const allSharedTxns = (transactions.shared || []).filter(txn => {
      if (txn.deleted) return false;
      if (cutoffDate && txn.date < cutoffDate) return false;
      if (txn.transfer_account_id) return false; // Exclude transfers
      return true;
    });

    // Current month expenses (outflows only, no transfers)
    const currentMonthTxns = allSharedTxns.filter(txn => txn.date.startsWith(currentMonth) && txn.amount < 0);
    const currentMonthSpending = Math.abs(currentMonthTxns.reduce((sum, txn) => sum + txn.amount, 0) / 1000);

    // Last month expenses
    const lastMonthTxns = allSharedTxns.filter(txn => txn.date.startsWith(lastMonth) && txn.amount < 0);
    const lastMonthSpending = Math.abs(lastMonthTxns.reduce((sum, txn) => sum + txn.amount, 0) / 1000);

    // Calculate spending change
    let spendingChange = null;
    if (lastMonthSpending > 0) {
      spendingChange = ((currentMonthSpending - lastMonthSpending) / lastMonthSpending) * 100;
    }

    // Total transactions this period
    const totalTransactions = allSharedTxns.length;

    // Recent activity (last 7 days, no transfers)
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const recentTxns = allSharedTxns.filter(txn => txn.date >= sevenDaysAgo);
    const recentCount = recentTxns.length;
    const recentSpending = Math.abs(recentTxns.filter(t => t.amount < 0).reduce((sum, txn) => sum + txn.amount, 0) / 1000);

    // Member spending percentages (excluding transfers)
    const memberStats = members.map(member => {
      const memberTxns = allSharedTxns.filter(txn => txn.account_id === member.contributionAccountId);
      const outflows = memberTxns.filter(t => t.amount < 0);
      const totalOutflow = Math.abs(outflows.reduce((sum, txn) => sum + txn.amount, 0) / 1000);
      return {
        name: member.name,
        transactionCount: memberTxns.length,
        totalOutflow
      };
    });

    // Total outflow for percentage calculation
    const totalOutflow = memberStats.reduce((sum, m) => sum + m.totalOutflow, 0);
    memberStats.forEach(m => {
      m.percentage = totalOutflow > 0 ? (m.totalOutflow / totalOutflow) * 100 : 0;
    });

    // Average transaction size
    const avgTransactionSize = currentMonthTxns.length > 0
      ? currentMonthSpending / currentMonthTxns.length
      : 0;

    // Build member account lookup for attributing expenses
    const accountToMember = {};
    members.forEach(m => {
      if (m.contributionAccountId) accountToMember[m.contributionAccountId] = m.name;
    });

    // Top 5 expenses this month (by absolute amount)
    const top5Expenses = [...currentMonthTxns]
      .sort((a, b) => a.amount - b.amount) // most negative first
      .slice(0, 5)
      .map(txn => ({
        amount: Math.abs(txn.amount / 1000),
        payee: txn.payee_name || 'Unknown',
        date: txn.date,
        member: accountToMember[txn.account_id] || 'Unknown'
      }));

    // Total allocated this month (contributions = inflows with no category_id)
    // Use all shared txns including transfers for this, from the unfiltered set
    const allSharedUnfiltered = (transactions.shared || []).filter(txn => {
      if (txn.deleted) return false;
      if (cutoffDate && txn.date < cutoffDate) return false;
      return true;
    });
    const currentMonthContributions = allSharedUnfiltered.filter(txn =>
      txn.date.startsWith(currentMonth) && txn.amount > 0 && !txn.category_id && !txn.transfer_account_id
    );
    const totalAllocated = currentMonthContributions.reduce((sum, txn) => sum + txn.amount, 0) / 1000;
    const remainingBudget = totalAllocated - currentMonthSpending;

    return {
      currentMonthSpending,
      lastMonthSpending,
      spendingChange,
      totalTransactions,
      recentCount,
      recentSpending,
      memberStats,
      avgTransactionSize,
      top5Expenses,
      totalAllocated,
      remainingBudget,
      currentMonth: now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    };
  },

  /**
   * Render the insights panel
   */
  renderInsights(insights, config) {
    if (!this.elements.insightsContent) return;

    const monthName = new Date().toLocaleDateString('en-US', { month: 'long' });

    // Spending change indicator
    let changeHtml = '';
    if (insights.spendingChange !== null) {
      const isUp = insights.spendingChange > 0;
      const changeClass = isUp ? 'change-up' : 'change-down';
      const changeIcon = isUp ? '&#9650;' : '&#9660;';
      changeHtml = `
        <span class="spending-change ${changeClass}">
          ${changeIcon} ${Math.abs(insights.spendingChange).toFixed(1)}% vs last month
        </span>
      `;
    }

    // Member contribution bars
    let memberBarsHtml = '';
    if (insights.memberStats.length > 0) {
      const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'];
      memberBarsHtml = `
        <div class="insight-contribution">
          <div class="contribution-bar-container">
            ${insights.memberStats.map((m, i) => `
              <div class="contribution-segment" style="width: ${m.percentage}%; background: ${colors[i % colors.length]}"
                   title="${Utils.escapeHtml(m.name)}: ${m.percentage.toFixed(1)}%"></div>
            `).join('')}
          </div>
          <div class="contribution-legend">
            ${insights.memberStats.map((m, i) => `
              <span class="legend-item">
                <span class="legend-dot" style="background: ${colors[i % colors.length]}"></span>
                ${Utils.escapeHtml(m.name)}: ${m.percentage.toFixed(0)}%
              </span>
            `).join('')}
          </div>
        </div>
      `;
    }

    const html = `
      <div class="insights-grid">
        <!-- This Month Spending -->
        <div class="insight-card highlight">
          <div class="insight-label">${monthName} Spending</div>
          <div class="insight-value">${Utils.formatCurrency(insights.currentMonthSpending)}</div>
          ${changeHtml}
        </div>

        <!-- Recent Activity -->
        <div class="insight-card">
          <div class="insight-label">Last 7 Days</div>
          <div class="insight-value">${Utils.formatCurrency(insights.recentSpending)}</div>
          <div class="insight-sub">${insights.recentCount} transaction${insights.recentCount !== 1 ? 's' : ''}</div>
        </div>

        <!-- Average Transaction -->
        <div class="insight-card">
          <div class="insight-label">Avg Transaction</div>
          <div class="insight-value">${Utils.formatCurrency(insights.avgTransactionSize)}</div>
          <div class="insight-sub">This month</div>
        </div>

        <!-- Total Allocated -->
        <div class="insight-card">
          <div class="insight-label">Allocated</div>
          <div class="insight-value">${Utils.formatCurrency(insights.totalAllocated)}</div>
          <div class="insight-sub">This month</div>
        </div>

        <!-- Remaining Budget -->
        <div class="insight-card">
          <div class="insight-label">Remaining</div>
          <div class="insight-value ${insights.remainingBudget >= 0 ? '' : 'negative'}">${Utils.formatCurrency(insights.remainingBudget)}</div>
          <div class="insight-sub">Allocated - spent</div>
        </div>
      </div>

      <!-- Contribution Split -->
      <div class="insight-section">
        <div class="insight-section-title">Spending Distribution</div>
        ${memberBarsHtml}
      </div>

      ${insights.top5Expenses.length > 0 ? `
        <div class="insight-section">
          <div class="insight-section-title">Top Expenses This Month</div>
          <div class="top-expenses-list">
            ${insights.top5Expenses.map(txn => {
              const dateFormatted = new Date(txn.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              return `
                <div class="top-expense-item">
                  <div class="top-expense-info">
                    <span class="top-expense-payee">${Utils.escapeHtml(txn.payee)}</span>
                    <span class="top-expense-meta">${Utils.escapeHtml(txn.member)} &middot; ${dateFormatted}</span>
                  </div>
                  <span class="top-expense-amount">${Utils.formatCurrency(txn.amount)}</span>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      ` : ''}
    `;

    this.elements.insightsContent.innerHTML = html;
  },

  // Force a refresh when navigating to the screen
  refresh() {
    this.state.loaded = false;
    this.loadData();
  }
};

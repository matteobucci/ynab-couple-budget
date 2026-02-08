/**
 * Monthly Screen Module - Allocation Planner
 * Allows users to set their monthly contribution and automatically
 * calculates the split between Shared Expenses and Balancing categories.
 *
 * Logic:
 * - Total Allocation = what user wants to contribute
 * - Balancing Activity = net transfers in/out (from balancing transactions)
 * - Shared Expenses Budget = Total Allocation - Balancing Activity
 * - Balancing Budget = -(Balancing Activity) to keep Available at 0
 */
const Monthly = {
  _busy: false,
  elements: {},
  state: {
    selectedMonth: null,
    monthOffset: 0, // 0 = current month, positive = future, negative = past
    visibleMonthCount: 5,
    monthsData: {},
    allocations: {}, // { 'YYYY-MM': { memberName: amount } }
    loading: false
  },

  init(elements) {
    this.elements = elements;
    this.bindEvents();
  },

  bindEvents() {
    this.elements.refreshMonthBtn?.addEventListener('click', () => this.loadData(true));
    this.elements.prevMonthBtn?.addEventListener('click', () => this.navigatePrev());
    this.elements.nextMonthBtn?.addEventListener('click', () => this.navigateNext());
  },

  initScreen() {
    if (!App.state.initialLoadComplete) return;

    const config = Store.getConfig();
    const isConfigured = config.sharedBudgetId &&
      config.members?.length > 0 &&
      config.members.every(m => m.budgetId && m.sharedCategoryId && m.contributionAccountId);

    if (!isConfigured) {
      this.elements.monthlyNotConfigured.style.display = 'block';
      this.elements.monthlyContent.style.display = 'none';
      return;
    }

    this.elements.monthlyNotConfigured.style.display = 'none';
    this.elements.monthlyContent.style.display = 'block';

    // Load saved allocations from config (check both new and legacy keys)
    const newAllocations = config.monthlyAllocations || {};
    const legacyAllocations = config.monthlyBudgets || {};

    // Merge legacy into new (new takes precedence)
    this.state.allocations = {};
    for (const month of Object.keys(legacyAllocations)) {
      this.state.allocations[month] = { ...legacyAllocations[month] };
    }
    for (const month of Object.keys(newAllocations)) {
      this.state.allocations[month] = { ...this.state.allocations[month], ...newAllocations[month] };
    }

    // Set selected month to current month if not set
    if (!this.state.selectedMonth) {
      this.state.selectedMonth = this.getCurrentMonthStr();
    }

    this.loadData();
  },

  getCurrentMonthStr() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  },

  getMonthStr(offset) {
    const now = new Date();
    const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  },

  getVisibleMonths() {
    const months = [];
    const startOffset = this.state.monthOffset - Math.floor(this.state.visibleMonthCount / 2);
    for (let i = 0; i < this.state.visibleMonthCount; i++) {
      months.push(this.getMonthStr(startOffset + i));
    }
    return months;
  },

  navigatePrev() {
    this.state.monthOffset -= this.state.visibleMonthCount;
    this.renderMonthSelector();
    this.loadVisibleMonthsData();
  },

  navigateNext() {
    this.state.monthOffset += this.state.visibleMonthCount;
    this.renderMonthSelector();
    this.loadVisibleMonthsData();
  },

  selectMonth(monthStr) {
    this.state.selectedMonth = monthStr;
    this.renderMonthSelector();
    this.loadSelectedMonthData();
  },

  async loadData(forceRefresh = false) {
    if (this.state.loading) return;
    this.state.loading = true;
    this.showLoading(true);

    try {
      const config = Store.getConfig();

      // Preload transactions for all budgets
      const budgetIds = [config.sharedBudgetId, ...config.members.map(m => m.budgetId)];
      const uniqueBudgetIds = [...new Set(budgetIds)];
      await DataService.preloadTransactions(uniqueBudgetIds, { forceRefresh });

      // Render month selector
      this.renderMonthSelector();

      // Load data for visible months
      await this.loadVisibleMonthsData();

      // Load selected month data
      await this.loadSelectedMonthData();

      // Render history
      this.renderHistory();

    } catch (error) {
      console.error('Failed to load monthly data:', error);
      Utils.showToast(`Failed to load data: ${error.message}`, 'error');
    } finally {
      this.state.loading = false;
      this.showLoading(false);
    }
  },

  async loadVisibleMonthsData() {
    const months = this.getVisibleMonths();
    for (const month of months) {
      if (!this.state.monthsData[month]) {
        await this.loadMonthData(month);
      }
    }
  },

  async loadSelectedMonthData() {
    const month = this.state.selectedMonth;
    if (!this.state.monthsData[month]) {
      await this.loadMonthData(month);
    }
    this.renderAllocationPanel();
  },

  async loadMonthData(monthStr) {
    const config = Store.getConfig();
    const monthData = { members: {} };

    for (const member of config.members) {
      const data = await this.loadMemberMonthData(member, monthStr, config);
      monthData.members[member.name] = data;
    }

    this.state.monthsData[monthStr] = monthData;
  },

  async loadMemberMonthData(member, monthStr, config) {
    const monthDate = `${monthStr}-01`;

    try {
      // Get category data from personal budget
      const personalMonth = await DataService.getMonthData(member.budgetId, monthDate);
      const sharedCategory = personalMonth.categories?.find(c => c.id === member.sharedCategoryId);
      const balancingCategory = member.balancingCategoryId
        ? personalMonth.categories?.find(c => c.id === member.balancingCategoryId)
        : null;

      return {
        sharedBudgeted: sharedCategory?.budgeted || 0,
        sharedActivity: sharedCategory?.activity || 0,
        sharedAvailable: sharedCategory?.balance || 0,
        balancingBudgeted: balancingCategory?.budgeted || 0,
        balancingActivity: balancingCategory?.activity || 0,
        balancingAvailable: balancingCategory?.balance || 0
      };
    } catch (error) {
      // Future months may not exist in YNAB yet - return empty data
      if (error.message?.includes('not found') || error.message?.includes('404')) {
        return {
          sharedBudgeted: 0,
          sharedActivity: 0,
          sharedAvailable: 0,
          balancingBudgeted: 0,
          balancingActivity: 0,
          balancingAvailable: 0
        };
      }
      throw error;
    }
  },

  showLoading(show) {
    if (this.elements.monthlyLoading) {
      this.elements.monthlyLoading.style.display = show ? 'block' : 'none';
    }
  },

  formatMonthLabel(monthStr, short = false) {
    const [year, month] = monthStr.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1, 1);
    if (short) {
      return date.toLocaleDateString('en-US', { month: 'short' });
    }
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
  },

  renderMonthSelector() {
    const months = this.getVisibleMonths();
    const currentMonth = this.getCurrentMonthStr();

    const monthsHtml = months.map(month => {
      const isSelected = month === this.state.selectedMonth;
      const isCurrent = month === currentMonth;
      const isFuture = month > currentMonth;

      return `
        <button class="month-btn ${isSelected ? 'selected' : ''} ${isCurrent ? 'current' : ''} ${isFuture ? 'future' : ''}"
                data-month="${month}"
                onclick="Monthly.selectMonth('${month}')">
          <span class="month-name">${this.formatMonthLabel(month, true)}</span>
          <span class="month-year">${month.split('-')[0]}</span>
        </button>
      `;
    }).join('');

    if (this.elements.monthList) {
      this.elements.monthList.innerHTML = monthsHtml;
    }
  },

  renderAllocationPanel() {
    const config = Store.getConfig();
    const month = this.state.selectedMonth;
    const monthData = this.state.monthsData[month];

    if (!monthData) {
      this.elements.allocationPanel.innerHTML = '<p class="text-muted">Loading...</p>';
      return;
    }

    const currentMonth = this.getCurrentMonthStr();
    const isFuture = month > currentMonth;
    const isPast = month < currentMonth;

    const membersHtml = config.members.map(member => {
      const data = monthData.members[member.name] || {};

      // Current values from YNAB
      const currentSharedBudgeted = YnabClient.fromMilliunits(data.sharedBudgeted || 0);
      const currentBalancingBudgeted = YnabClient.fromMilliunits(data.balancingBudgeted || 0);
      const balancingActivity = YnabClient.fromMilliunits(data.balancingActivity || 0);

      // Calculate implied Total Allocation from YNAB
      // Total Allocation = Shared Budgeted - Balancing Activity
      // (If you received money via balancing, your net contribution is less)
      // (If you paid money via balancing, your net contribution is more)
      const impliedAllocation = currentSharedBudgeted - balancingActivity;

      // Use saved allocation if exists, otherwise use implied from YNAB
      const savedAllocation = this.state.allocations[month]?.[member.name];
      const totalAllocation = savedAllocation !== undefined ? savedAllocation : impliedAllocation;

      // Calculate what Shared Expenses should be based on total allocation
      // Shared Budget = Total Allocation + Balancing Activity
      const sharedExpensesBudget = totalAllocation + balancingActivity;

      // Expected balancing budget = negative of activity to make available = 0
      const expectedBalancingBudget = -balancingActivity;

      // Check if current budget matches expected
      const isSharedCorrect = Math.abs(currentSharedBudgeted - sharedExpensesBudget) < 0.01;
      const isBalancingCorrect = Math.abs(currentBalancingBudgeted - expectedBalancingBudget) < 0.01;
      const isApplied = totalAllocation > 0 && isSharedCorrect && isBalancingCorrect;

      return `
        <div class="allocation-member-card">
          <div class="allocation-member-header">
            <h4>${Utils.escapeHtml(member.name)}</h4>
            ${isApplied ? '<span class="applied-badge">Applied</span>' : ''}
          </div>

          <div class="allocation-form">
            <div class="allocation-row">
              <label>Total Allocation</label>
              <div class="allocation-input-wrapper">
                <span class="currency-symbol">€</span>
                <input type="number"
                       class="allocation-input"
                       id="allocation-${Utils.escapeHtml(member.name)}"
                       value="${totalAllocation || ''}"
                       placeholder="0.00"
                       step="0.01"
                       min="0"
                       onchange="Monthly.onAllocationChange('${Utils.escapeHtml(member.name)}', this.value)">
              </div>
            </div>

            <div class="allocation-row calculated">
              <label>+ Balancing Activity</label>
              <span class="allocation-value ${balancingActivity < 0 ? 'negative' : balancingActivity > 0 ? 'positive' : ''}">${Utils.formatCurrency(balancingActivity)}</span>
            </div>

            <div class="allocation-row calculated result">
              <label>= Shared Expenses Budget</label>
              <span class="allocation-value">${Utils.formatCurrency(sharedExpensesBudget)}</span>
            </div>

            <div class="allocation-divider"></div>

            <div class="allocation-row ynab-value">
              <label>Shared Budget in YNAB</label>
              <span class="allocation-value ${isSharedCorrect ? 'correct' : 'incorrect'}">${Utils.formatCurrency(currentSharedBudgeted)}</span>
            </div>

            <div class="allocation-row ynab-value">
              <label>Balancing Budget in YNAB</label>
              <span class="allocation-value ${isBalancingCorrect ? 'correct' : 'incorrect'}">${Utils.formatCurrency(currentBalancingBudgeted)}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    const html = `
      <div class="allocation-panel-header">
        <h3>${this.formatMonthLabel(month)}</h3>
        ${isPast ? '<span class="month-tag past">Past</span>' : ''}
        ${isFuture ? '<span class="month-tag future">Future</span>' : ''}
      </div>

      <div class="allocation-members-grid">
        ${membersHtml}
      </div>

      <div class="allocation-actions">
        <button class="btn btn-primary" onclick="Monthly.applyToYnab()">
          Apply to YNAB
        </button>
        <p class="help-text">This will set the Shared Expenses and Balancing category budgets in your personal budgets.</p>
      </div>
    `;

    this.elements.allocationPanel.innerHTML = html;
  },

  onAllocationChange(memberName, value) {
    const month = this.state.selectedMonth;
    const amount = parseFloat(value) || 0;

    if (!this.state.allocations[month]) {
      this.state.allocations[month] = {};
    }

    if (amount > 0) {
      this.state.allocations[month][memberName] = amount;
    } else {
      delete this.state.allocations[month][memberName];
    }

    // Save to config
    this.saveAllocations();

    // Re-render to update calculations
    this.renderAllocationPanel();

    // Also update history table with cached data
    this.renderHistoryIfLoaded();
  },

  saveAllocations() {
    const config = Store.getConfig();
    config.monthlyAllocations = this.state.allocations;
    // Clean up legacy key if present
    if (config.monthlyBudgets) {
      delete config.monthlyBudgets;
    }
    Store.setConfig(config);
  },

  async applyToYnab() {
    if (this._busy) return;
    this._busy = true;
    try {
    const config = Store.getConfig();
    const month = this.state.selectedMonth;
    const monthDate = `${month}-01`;
    const monthData = this.state.monthsData[month];
    const allocations = this.state.allocations[month] || {};

    if (Object.keys(allocations).length === 0) {
      Utils.showToast('Please set allocation amounts first', 'error');
      return;
    }

    // Build detail list for confirmation modal
    const detailItems = config.members
      .filter(m => allocations[m.name])
      .map(member => {
        const allocation = allocations[member.name];
        const data = monthData?.members[member.name] || {};
        const balancingActivity = YnabClient.fromMilliunits(data.balancingActivity || 0);
        const sharedExpensesBudget = allocation + balancingActivity;
        return `
          <div class="confirm-detail-item">
            <span class="detail-label">${Utils.escapeHtml(member.name)}</span>
            <span class="detail-value">${Utils.formatCurrency(allocation)} total → ${Utils.formatCurrency(sharedExpensesBudget)} shared</span>
          </div>
        `;
      }).join('');

    const confirmed = await Utils.confirm({
      title: `Apply Allocations — ${this.formatMonthLabel(month)}`,
      html: `
        <p>This will update your YNAB budgets:</p>
        <div class="confirm-detail-list">${detailItems}</div>
        <p>For each member, this sets the <strong>Shared Expenses</strong> and <strong>Balancing</strong> category budgets, and creates a contribution transaction in the shared budget.</p>
      `,
      confirmText: 'Apply to YNAB',
      cancelText: 'Cancel'
    });

    if (!confirmed) return;

    this.showLoading(true);

    try {
      // Parse month for monthly ID generation
      const [year, monthNum] = month.split('-').map(Number);
      const monthlyId = LinkUtils.generateMonthlyId(monthNum, year);
      const monthLabel = new Date(year, monthNum - 1, 1)
        .toLocaleDateString('en-US', { year: 'numeric', month: 'long' });

      for (const member of config.members) {
        const allocation = allocations[member.name];
        if (!allocation) continue;

        const data = monthData?.members[member.name] || {};
        const balancingActivity = YnabClient.fromMilliunits(data.balancingActivity || 0);

        // Calculate budgets
        // Shared Budget = Total Allocation + Balancing Activity
        const sharedExpensesBudget = allocation + balancingActivity;
        const balancingBudget = -balancingActivity; // To make available = 0

        // Convert to milliunits
        const sharedMilliunits = YnabClient.toMilliunits(sharedExpensesBudget);
        const balancingMilliunits = YnabClient.toMilliunits(balancingBudget);

        // Update Shared Expenses category in personal budget
        await YnabClient.updateCategoryBudget(
          member.budgetId,
          monthDate,
          member.sharedCategoryId,
          sharedMilliunits
        );

        // Update Balancing category if configured
        if (member.balancingCategoryId) {
          await YnabClient.updateCategoryBudget(
            member.budgetId,
            monthDate,
            member.balancingCategoryId,
            balancingMilliunits
          );
        }

        // Create or update contribution transaction in shared budget
        await this.ensureContributionTransaction(
          config,
          member,
          month,
          allocation,
          monthlyId,
          monthLabel
        );
      }

      Utils.showToast('Allocations applied to YNAB!', 'success');

      // Invalidate cache and reload
      for (const member of config.members) {
        DataService.invalidateMonthCache(member.budgetId, monthDate);
      }
      DataService.invalidateBudgetCache(config.sharedBudgetId);

      // Reload data and refresh history
      delete this.state.monthsData[month];
      await this.loadSelectedMonthData();
      this.renderHistory();

    } catch (error) {
      console.error('Failed to apply allocations:', error);
      Utils.showToast(`Failed to apply: ${error.message}`, 'error');
    } finally {
      this.showLoading(false);
    }
    } finally {
      this._busy = false;
    }
  },

  /**
   * Ensure a contribution transaction exists in the shared budget for the given month
   * Creates a new one or updates existing if amount differs
   */
  /**
   * Look up the "Inflow: Ready to Assign" category for a budget.
   * Caches the result for the session.
   */
  _readyToAssignCache: {},
  async getReadyToAssignCategoryId(budgetId) {
    if (this._readyToAssignCache[budgetId]) return this._readyToAssignCache[budgetId];

    const categoryGroups = await YnabClient.getCategories(budgetId);
    for (const group of (categoryGroups || [])) {
      for (const cat of (group.categories || [])) {
        if (cat.name === 'Inflow: Ready to Assign') {
          this._readyToAssignCache[budgetId] = cat.id;
          return cat.id;
        }
      }
    }
    return null;
  },

  async ensureContributionTransaction(config, member, month, amount, monthlyId, monthLabel) {
    const monthDate = `${month}-01`;
    const expectedMemo = `#${monthlyId}#`;
    const amountMilliunits = YnabClient.toMilliunits(amount);

    // Get existing transactions for this member's contribution account
    const transactions = await DataService.getTransactions(config.sharedBudgetId, {
      accountId: member.contributionAccountId,
      month: month
    });

    // Look for existing transaction with this monthly ID
    const existingTxn = transactions.find(txn => {
      const id = LinkUtils.extractId(txn.memo);
      return id === monthlyId;
    });

    if (existingTxn) {
      // Update if amount differs
      if (existingTxn.amount !== amountMilliunits) {
        await YnabClient.updateTransaction(config.sharedBudgetId, existingTxn.id, {
          amount: amountMilliunits
        });
        console.log(`[Monthly] Updated contribution for ${member.name}: ${Utils.formatCurrency(amount)}`);
      }
    } else {
      // Look up "Inflow: Ready to Assign" category
      const readyToAssignId = await this.getReadyToAssignCategoryId(config.sharedBudgetId);

      // Create new contribution transaction
      const txnData = {
        account_id: member.contributionAccountId,
        date: monthDate,
        amount: amountMilliunits,
        payee_name: `Monthly Contribution - ${monthLabel}`,
        memo: expectedMemo,
        cleared: 'cleared',
        approved: true,
        flag_color: 'purple'
      };
      if (readyToAssignId) {
        txnData.category_id = readyToAssignId;
      }

      await YnabClient.createTransaction(config.sharedBudgetId, txnData);
      console.log(`[Monthly] Created contribution for ${member.name}: ${Utils.formatCurrency(amount)}`);
    }
  },

  renderHistory() {
    const config = Store.getConfig();

    // Get last 12 months
    const months = [];
    for (let i = 11; i >= 0; i--) {
      months.push(this.getMonthStr(-i));
    }

    // Load any missing month data (catch errors per-month so one failure doesn't block all)
    const loadPromises = months.map(async month => {
      if (!this.state.monthsData[month]) {
        try {
          await this.loadMonthData(month);
        } catch (error) {
          console.warn(`Failed to load month data for ${month}:`, error);
        }
      }
    });

    Promise.all(loadPromises)
      .then(() => this.renderHistoryTable(months, config))
      .catch(error => {
        console.error('Failed to render history:', error);
        this.renderHistoryTable(months, config);
      });
  },

  /**
   * Re-render history table using already-loaded data (no API calls).
   * Used after allocation changes to update the table instantly.
   */
  renderHistoryIfLoaded() {
    const config = Store.getConfig();
    const months = [];
    for (let i = 11; i >= 0; i--) {
      months.push(this.getMonthStr(-i));
    }

    // Only render if we have data for at least some months
    if (months.some(m => this.state.monthsData[m])) {
      this.renderHistoryTable(months, config);
    }
  },

  renderHistoryTable(months, config) {
    const headerCells = months.map(m =>
      `<th class="history-month-header">${this.formatMonthLabel(m, true)}<br><small>${m.split('-')[0]}</small></th>`
    ).join('');

    // Calculate allocations for each member and month
    const allocationsByMonth = {};
    months.forEach(month => {
      allocationsByMonth[month] = {};
      config.members.forEach(member => {
        const data = this.state.monthsData[month]?.members[member.name] || {};
        const sharedBudgeted = YnabClient.fromMilliunits(data.sharedBudgeted || 0);
        const balancingActivity = YnabClient.fromMilliunits(data.balancingActivity || 0);
        const impliedAllocation = sharedBudgeted - balancingActivity;
        const savedAllocation = this.state.allocations[month]?.[member.name];
        allocationsByMonth[month][member.name] = savedAllocation !== undefined ? savedAllocation : impliedAllocation;
      });
    });

    const memberRows = config.members.map(member => {
      const cells = months.map(month => {
        const totalAllocation = allocationsByMonth[month][member.name];
        const hasValue = totalAllocation > 0;

        return `
          <td class="history-cell ${hasValue ? 'has-value' : ''}">
            ${hasValue ? Utils.formatCurrency(totalAllocation) : '—'}
          </td>
        `;
      }).join('');

      return `
        <tr>
          <td class="history-member-name">${Utils.escapeHtml(member.name)}</td>
          ${cells}
        </tr>
      `;
    }).join('');

    // Calculate totals for each month
    const totalCells = months.map(month => {
      const total = config.members.reduce((sum, member) => {
        const allocation = allocationsByMonth[month][member.name];
        return sum + (allocation > 0 ? allocation : 0);
      }, 0);
      const hasValue = total > 0;

      return `
        <td class="history-cell history-total-cell ${hasValue ? 'has-value' : ''}">
          ${hasValue ? Utils.formatCurrency(total) : '—'}
        </td>
      `;
    }).join('');

    const totalRow = `
      <tr class="history-total-row">
        <td class="history-member-name history-total-label">Total</td>
        ${totalCells}
      </tr>
    `;

    const html = `
      <div class="history-table-wrapper">
        <table class="history-table">
          <thead>
            <tr>
              <th class="history-member-col">Member</th>
              ${headerCells}
            </tr>
          </thead>
          <tbody>
            ${memberRows}
            ${totalRow}
          </tbody>
        </table>
      </div>
    `;

    this.elements.monthlyTableContainer.innerHTML = html;
  }
};

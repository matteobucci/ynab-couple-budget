/**
 * YNAB Couple Budget - Main Application
 * Coordinates modules and handles core state
 */
const App = {
  state: {
    connected: false,
    budgets: [],
    budgetDetails: {},
    settingsOpen: false,
    initialLoadComplete: false
  },

  elements: {},

  init() {
    // Initialize reactive store first (loads config and cached transactions)
    Store.init();

    this.cacheElements();
    this.initModules();
    this.bindEvents();
    this.restoreState();
  },

  cacheElements() {
    this.elements = {
      // Initial Loading
      initialLoading: document.getElementById('initial-loading'),
      initialLoadingText: document.querySelector('#initial-loading p'),

      // Settings Panel
      settingsBtn: document.getElementById('btn-settings'),
      settingsPanel: document.getElementById('settings-panel'),
      closeSettingsBtn: document.getElementById('btn-close-settings'),

      // Connection
      connectionStatus: document.getElementById('connection-status'),
      statusText: document.querySelector('.status-text'),
      apiKeyInput: document.getElementById('api-key'),
      toggleKeyBtn: document.getElementById('toggle-key-visibility'),
      connectBtn: document.getElementById('btn-connect'),
      disconnectBtn: document.getElementById('btn-disconnect'),

      // Navigation
      navBtns: document.querySelectorAll('.nav-btn'),
      screens: document.querySelectorAll('.screen'),

      // Setup/Binding (in settings panel)
      bindingSection: document.getElementById('binding-section'),
      sharedBudgetSelect: document.getElementById('shared-budget'),
      membersConfig: document.getElementById('members-config'),
      membersList: document.getElementById('members-list'),
      addMemberBtn: document.getElementById('btn-add-member'),
      consistencyCutoffInput: document.getElementById('consistency-cutoff'),
      consistencySettingsSection: document.getElementById('consistency-settings-section'),

      // Overview Screen (new dashboard)
      overviewNotConfigured: document.getElementById('overview-not-configured'),
      overviewContent: document.getElementById('overview-content'),

      // Transactions Screen (combines old Transactions + Consistency)
      transactionsNotConfigured: document.getElementById('transactions-not-configured'),
      transactionsContent: document.getElementById('transactions-content'),
      transactionsLoading: document.getElementById('transactions-loading'),
      transactionsSummary: document.getElementById('transactions-summary'),
      refreshTransactionsBtn: document.getElementById('btn-refresh-transactions'),
      memberTabs: document.getElementById('member-tabs'),
      linkingModeBanner: document.getElementById('linking-mode-banner'),
      cancelLinkingBtn: document.getElementById('btn-cancel-linking'),
      personalTransactions: document.getElementById('personal-transactions'),
      personalBalances: document.getElementById('personal-balances'),
      sharedTransactions: document.getElementById('shared-transactions'),
      sharedBalances: document.getElementById('shared-balances'),
      linkedContainer: document.getElementById('linked-container'),
      // Settle Up Modal
      settleModal: document.getElementById('settle-modal'),
      openSettleBtn: document.getElementById('btn-open-settle'),
      closeSettleBtn: document.getElementById('btn-close-settle'),
      cancelSettleBtn: document.getElementById('btn-cancel-settle'),
      // Balancing form (now in modal)
      balancingAmount: document.getElementById('balancing-amount'),
      balancingFrom: document.getElementById('balancing-from'),
      balancingFromAccount: document.getElementById('balancing-from-account'),
      balancingTo: document.getElementById('balancing-to'),
      balancingToAccount: document.getElementById('balancing-to-account'),
      balancingDate: document.getElementById('balancing-date'),
      balancingMemo: document.getElementById('balancing-memo'),
      balancingPreview: document.getElementById('balancing-preview'),
      createBalancingBtn: document.getElementById('btn-create-balancing'),

      // Monthly Screen (allocation planner)
      monthlyNotConfigured: document.getElementById('monthly-not-configured'),
      monthlyContent: document.getElementById('monthly-content'),
      monthlyLoading: document.getElementById('monthly-loading'),
      monthSelector: document.getElementById('month-selector'),
      monthList: document.getElementById('month-list'),
      prevMonthBtn: document.getElementById('btn-prev-month'),
      nextMonthBtn: document.getElementById('btn-next-month'),
      allocationPanel: document.getElementById('allocation-panel'),
      monthlyTableContainer: document.getElementById('monthly-table-container'),
      refreshMonthBtn: document.getElementById('btn-refresh-month'),

      // Analytics
      analyticsNotConfigured: document.getElementById('analytics-not-configured'),
      analyticsContent: document.getElementById('analytics-content'),
      analyticsLoading: document.getElementById('analytics-loading'),
      timeRangeBtns: document.querySelectorAll('.time-range-btn'),
      refreshAnalyticsBtn: document.getElementById('btn-refresh-analytics'),
      cumulativeChartCard: document.getElementById('cumulative-chart-card'),
      cumulativeChartContainer: document.getElementById('cumulative-chart-container'),
      contributionHistoryCard: document.getElementById('contribution-history-card'),
      contributionHistoryContainer: document.getElementById('contribution-history-container'),
      moneyFlowCard: document.getElementById('money-flow-card'),
      moneyFlowContainer: document.getElementById('money-flow-container'),
      spendingBreakdownCard: document.getElementById('spending-breakdown-card'),
      spendingBreakdownContainer: document.getElementById('spending-breakdown-container'),
      memberComparisonCard: document.getElementById('member-comparison-card'),
      memberComparisonContainer: document.getElementById('member-comparison-container'),
      trendsCard: document.getElementById('trends-card'),
      trendsContainer: document.getElementById('trends-container'),

      // Toast
      toastContainer: document.getElementById('toast-container')
    };
  },

  initModules() {
    // Initialize sub-modules with their required elements
    Setup.init({
      sharedBudgetSelect: this.elements.sharedBudgetSelect,
      membersConfig: this.elements.membersConfig,
      membersList: this.elements.membersList,
      addMemberBtn: this.elements.addMemberBtn
    });

    // Initialize Overview module (new dashboard)
    Overview.init({});

    // Initialize Consistency module (now handles the Transactions screen)
    Consistency.init({
      consistencyNotConfigured: this.elements.transactionsNotConfigured,
      consistencyContent: this.elements.transactionsContent,
      consistencyLoading: this.elements.transactionsLoading,
      consistencySummary: this.elements.transactionsSummary,
      memberTabs: this.elements.memberTabs,
      linkingModeBanner: this.elements.linkingModeBanner,
      cancelLinkingBtn: this.elements.cancelLinkingBtn,
      personalTransactions: this.elements.personalTransactions,
      personalBalances: this.elements.personalBalances,
      sharedTransactions: this.elements.sharedTransactions,
      sharedBalances: this.elements.sharedBalances,
      linkedContainer: this.elements.linkedContainer,
      refreshConsistencyBtn: this.elements.refreshTransactionsBtn,
      // Settle Up Modal elements
      settleModal: this.elements.settleModal,
      openSettleBtn: this.elements.openSettleBtn,
      closeSettleBtn: this.elements.closeSettleBtn,
      cancelSettleBtn: this.elements.cancelSettleBtn,
      // Balancing form elements (now in modal)
      balancingAmount: this.elements.balancingAmount,
      balancingFrom: this.elements.balancingFrom,
      balancingFromAccount: this.elements.balancingFromAccount,
      balancingTo: this.elements.balancingTo,
      balancingToAccount: this.elements.balancingToAccount,
      balancingDate: this.elements.balancingDate,
      balancingMemo: this.elements.balancingMemo,
      balancingPreview: this.elements.balancingPreview,
      createBalancingBtn: this.elements.createBalancingBtn
    });

    // Initialize Monthly module (allocation planner)
    Monthly.init({
      monthlyNotConfigured: this.elements.monthlyNotConfigured,
      monthlyContent: this.elements.monthlyContent,
      monthlyLoading: this.elements.monthlyLoading,
      monthSelector: this.elements.monthSelector,
      monthList: this.elements.monthList,
      prevMonthBtn: this.elements.prevMonthBtn,
      nextMonthBtn: this.elements.nextMonthBtn,
      allocationPanel: this.elements.allocationPanel,
      monthlyTableContainer: this.elements.monthlyTableContainer,
      refreshMonthBtn: this.elements.refreshMonthBtn
    });

    Analytics.init({
      analyticsNotConfigured: this.elements.analyticsNotConfigured,
      analyticsContent: this.elements.analyticsContent,
      analyticsLoading: this.elements.analyticsLoading,
      timeRangeBtns: this.elements.timeRangeBtns,
      refreshAnalyticsBtn: this.elements.refreshAnalyticsBtn,
      cumulativeChartCard: this.elements.cumulativeChartCard,
      cumulativeChartContainer: this.elements.cumulativeChartContainer,
      contributionHistoryCard: this.elements.contributionHistoryCard,
      contributionHistoryContainer: this.elements.contributionHistoryContainer,
      moneyFlowCard: this.elements.moneyFlowCard,
      moneyFlowContainer: this.elements.moneyFlowContainer,
      spendingBreakdownCard: this.elements.spendingBreakdownCard,
      spendingBreakdownContainer: this.elements.spendingBreakdownContainer,
      memberComparisonCard: this.elements.memberComparisonCard,
      memberComparisonContainer: this.elements.memberComparisonContainer,
      trendsCard: this.elements.trendsCard,
      trendsContainer: this.elements.trendsContainer
    });
  },

  bindEvents() {
    // Settings panel toggle
    this.elements.settingsBtn.addEventListener('click', () => this.toggleSettings());
    this.elements.closeSettingsBtn.addEventListener('click', () => this.closeSettings());

    // API Key toggle
    this.elements.toggleKeyBtn.addEventListener('click', () => {
      const input = this.elements.apiKeyInput;
      input.type = input.type === 'password' ? 'text' : 'password';
    });

    // Connection
    this.elements.connectBtn.addEventListener('click', () => this.connect());
    this.elements.disconnectBtn.addEventListener('click', () => this.disconnect());
    this.elements.apiKeyInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.connect();
    });

    // Navigation
    this.elements.navBtns.forEach(btn => {
      btn.addEventListener('click', () => this.navigateTo(btn.dataset.screen));
    });

    // Consistency cutoff date
    this.elements.consistencyCutoffInput?.addEventListener('change', () => {
      Store.updateConfig({ consistencyCutoffDate: this.elements.consistencyCutoffInput.value });
      Utils.showToast('Cutoff date saved', 'success');
    });

    // Close settings when clicking outside
    document.addEventListener('click', (e) => {
      if (this.state.settingsOpen &&
          !this.elements.settingsPanel.contains(e.target) &&
          !this.elements.settingsBtn.contains(e.target)) {
        this.closeSettings();
      }
    });

    // Close settings on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.state.settingsOpen) {
        this.closeSettings();
      }
    });
  },

  toggleSettings() {
    if (this.state.settingsOpen) {
      this.closeSettings();
    } else {
      this.openSettings();
    }
  },

  openSettings() {
    this.state.settingsOpen = true;
    this.elements.settingsPanel.style.display = 'block';
    this.elements.settingsBtn.classList.add('active');
  },

  closeSettings() {
    this.state.settingsOpen = false;
    this.elements.settingsPanel.style.display = 'none';
    this.elements.settingsBtn.classList.remove('active');
  },

  restoreState() {
    let apiKey = Storage.getApiKey();

    if (!apiKey && window.DEV_API_KEY) {
      apiKey = window.DEV_API_KEY;
      console.log('Using development API key from environment');
    }

    if (apiKey) {
      this.elements.apiKeyInput.value = apiKey;
      this.connect(true);
    } else {
      // No API key - hide loading and show settings panel
      this.hideInitialLoading();
      this.openSettings();
    }
  },

  setLoadingMessage(message) {
    if (this.elements.initialLoadingText) {
      this.elements.initialLoadingText.textContent = message;
    }
  },

  hideInitialLoading() {
    this.state.initialLoadComplete = true;
    if (this.elements.initialLoading) {
      this.elements.initialLoading.classList.add('hidden');
    }
    // Show appropriate content based on configuration state
    this.updateScreenVisibility();
  },

  updateScreenVisibility() {
    // Only update visibility after initial load is complete
    if (!this.state.initialLoadComplete) return;

    const isConfigured = this.isConfigured();

    // Update overview screen
    if (this.elements.overviewNotConfigured && this.elements.overviewContent) {
      if (isConfigured) {
        this.elements.overviewNotConfigured.style.display = 'none';
        this.elements.overviewContent.style.display = 'block';
      } else {
        this.elements.overviewNotConfigured.style.display = 'block';
        this.elements.overviewContent.style.display = 'none';
      }
    }

    // Update transactions screen
    if (this.elements.transactionsNotConfigured && this.elements.transactionsContent) {
      if (isConfigured) {
        this.elements.transactionsNotConfigured.style.display = 'none';
        this.elements.transactionsContent.style.display = 'block';
      } else {
        this.elements.transactionsNotConfigured.style.display = 'block';
        this.elements.transactionsContent.style.display = 'none';
      }
    }
  },

  // Connection
  async connect(silent = false) {
    const apiKey = this.elements.apiKeyInput.value.trim();

    if (!apiKey) {
      if (!silent) Utils.showToast('Please enter an API key', 'error');
      if (silent) this.hideInitialLoading();
      return;
    }

    this.setConnectionStatus('loading', 'Connecting...');
    this.setLoadingMessage('Connecting to YNAB...');
    this.elements.connectBtn.disabled = true;

    try {
      YnabClient.init(apiKey);
      await YnabClient.testConnection();

      Storage.setApiKey(apiKey);

      this.state.connected = true;
      this.setConnectionStatus('connected', 'Connected');
      this.elements.connectBtn.disabled = true;
      this.elements.disconnectBtn.disabled = false;

      if (!silent) Utils.showToast('Connected to YNAB!', 'success');

      this.setLoadingMessage('Loading budgets...');
      await this.loadBudgets();

      // Hide initial loading overlay
      this.hideInitialLoading();

      // Initialize the Overview screen (default landing page)
      Overview.initScreen();

    } catch (error) {
      this.setConnectionStatus('disconnected', 'Connection Failed');
      this.elements.connectBtn.disabled = false;
      this.hideInitialLoading();
      if (!silent) Utils.showToast(error.message, 'error');
      if (silent) this.openSettings();
    }
  },

  async disconnect() {
    const confirmed = await Utils.confirm({
      title: 'Disconnect',
      message: 'Disconnect from YNAB? This will clear your API key and all cached data.',
      confirmText: 'Disconnect',
      cancelText: 'Cancel',
      danger: true
    });
    if (!confirmed) return;

    Storage.clearApiKey();
    Storage.clearCache();
    YnabClient.apiKey = null;

    this.state.connected = false;
    this.state.budgets = [];
    this.state.budgetDetails = {};

    this.setConnectionStatus('disconnected', 'Not Connected');
    this.elements.apiKeyInput.value = '';
    this.elements.connectBtn.disabled = false;
    this.elements.disconnectBtn.disabled = true;

    this.elements.bindingSection.style.display = 'none';

    // Reset all screens to not-configured state
    if (this.elements.overviewNotConfigured) {
      this.elements.overviewNotConfigured.style.display = 'block';
    }
    if (this.elements.overviewContent) {
      this.elements.overviewContent.style.display = 'none';
    }
    if (this.elements.transactionsNotConfigured) {
      this.elements.transactionsNotConfigured.style.display = 'block';
    }
    if (this.elements.transactionsContent) {
      this.elements.transactionsContent.style.display = 'none';
    }

    Utils.showToast('Disconnected', 'info');
  },

  setConnectionStatus(status, text) {
    this.elements.connectionStatus.className = `status ${status}`;
    this.elements.statusText.textContent = text;
  },

  // Check if system is fully configured
  isConfigured() {
    const config = Store.getConfig();
    return config.sharedBudgetId &&
      config.members?.length > 0 &&
      config.members.every(m => m.budgetId && m.sharedCategoryId && m.contributionAccountId);
  },

  // Navigation
  navigateTo(screenName) {
    this.elements.navBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.screen === screenName);
    });
    this.elements.screens.forEach(screen => {
      screen.classList.toggle('active', screen.id === `screen-${screenName}`);
    });

    // Initialize the appropriate screen
    if (screenName === 'overview') {
      Overview.initScreen();
    } else if (screenName === 'transactions') {
      Consistency.initScreen();
    } else if (screenName === 'monthly') {
      Monthly.initScreen();
    } else if (screenName === 'analytics') {
      Analytics.initScreen();
    }
  },

  // Budgets
  async loadBudgets() {
    try {
      let budgets = Storage.getCachedBudgets();

      if (!budgets) {
        budgets = await YnabClient.getBudgets();
        Storage.setCachedBudgets(budgets);
      }

      this.state.budgets = budgets;
      this.populateBudgetSelects(budgets);
      this.elements.bindingSection.style.display = 'block';
      this.elements.consistencySettingsSection.style.display = 'block';

      // Restore cutoff date
      const config = Store.getConfig();
      if (config.consistencyCutoffDate && this.elements.consistencyCutoffInput) {
        this.elements.consistencyCutoffInput.value = config.consistencyCutoffDate;
      }

      await Setup.restoreConfig(budgets, this.state.budgetDetails);

    } catch (error) {
      Utils.showToast(`Failed to load budgets: ${error.message}`, 'error');
    }
  },

  populateBudgetSelects(budgets) {
    const options = budgets.map(b =>
      `<option value="${b.id}">${Utils.escapeHtml(b.name)}</option>`
    ).join('');

    this.elements.sharedBudgetSelect.innerHTML =
      '<option value="">Select shared budget...</option>' + options;
  },

  async loadBudgetDetails(budgetId) {
    if (this.state.budgetDetails[budgetId]) {
      return this.state.budgetDetails[budgetId];
    }

    let details = Storage.getCachedBudgetDetails(budgetId);

    if (!details) {
      // YnabClient.getBudget returns { budget, serverKnowledge }
      // We only need the budget object for details
      const result = await YnabClient.getBudget(budgetId);
      details = result.budget;
      Storage.setCachedBudgetDetails(budgetId, details);
    }

    this.state.budgetDetails[budgetId] = details;
    return details;
  }
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => App.init());

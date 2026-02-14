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
    settingsMode: null, // 'setup' or 'settings'
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
      // Landing Page
      landingPage: document.getElementById('landing-page'),
      landingCtaTop: document.getElementById('landing-cta-top'),
      landingCtaBottom: document.getElementById('landing-cta-bottom'),

      // App chrome (hidden when landing is shown)
      header: document.querySelector('.header'),
      nav: document.querySelector('.nav'),
      main: document.querySelector('.main'),

      // Initial Loading
      initialLoading: document.getElementById('initial-loading'),
      initialLoadingText: document.querySelector('#initial-loading p'),

      // Settings Modal
      settingsBtn: document.getElementById('btn-settings'),
      settingsModal: document.getElementById('settings-modal'),
      settingsModalTitle: document.getElementById('settings-modal-title'),
      closeSettingsBtn: document.getElementById('btn-close-settings'),
      settingsDoneActions: document.getElementById('settings-done-actions'),
      settingsDoneBtn: document.getElementById('btn-settings-done'),

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
      settlePhase2: document.getElementById('settle-phase-2'),
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
      allocationsCard: document.getElementById('analytics-allocations-card'),
      allocationsContainer: document.getElementById('analytics-allocations-container'),
      expensesCard: document.getElementById('analytics-expenses-card'),
      expensesContainer: document.getElementById('analytics-expenses-container'),
      balancingCard: document.getElementById('analytics-balancing-card'),
      balancingContainer: document.getElementById('analytics-balancing-container'),

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
      settlePhase2: this.elements.settlePhase2,
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
      allocationsCard: this.elements.allocationsCard,
      allocationsContainer: this.elements.allocationsContainer,
      expensesCard: this.elements.expensesCard,
      expensesContainer: this.elements.expensesContainer,
      balancingCard: this.elements.balancingCard,
      balancingContainer: this.elements.balancingContainer
    });
  },

  bindEvents() {
    // Landing page CTAs → open setup dialog over landing
    this.elements.landingCtaTop?.addEventListener('click', () => {
      this.openSetupDialog();
    });
    this.elements.landingCtaBottom?.addEventListener('click', () => {
      this.openSetupDialog();
    });

    // Settings modal: gear icon → settings mode, close button
    this.elements.settingsBtn.addEventListener('click', () => this.openSettingsDialog());
    this.elements.closeSettingsBtn.addEventListener('click', () => this.closeSettingsDialog());
    this.elements.settingsDoneBtn?.addEventListener('click', () => this.closeSettingsDialog());

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

    // Close settings modal when clicking backdrop (settings mode only)
    this.elements.settingsModal?.addEventListener('click', (e) => {
      if (e.target === this.elements.settingsModal && this.state.settingsMode === 'settings') {
        this.closeSettingsDialog();
      }
    });

    // Close settings on Escape key (settings mode only, or setup mode when configured)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.state.settingsOpen) {
        if (this.state.settingsMode === 'settings' ||
            (this.state.settingsMode === 'setup' && this.isConfigured())) {
          this.closeSettingsDialog();
        }
      }
    });
  },

  openSetupDialog() {
    this.state.settingsMode = 'setup';
    this.state.settingsOpen = true;
    this.elements.settingsModal.dataset.mode = 'setup';
    this.elements.settingsModalTitle.textContent = 'Set Up Your System';
    this.elements.settingsModal.style.display = 'flex';
    this.updateSetupDoneButton();
    this.elements.apiKeyInput.focus();
  },

  openSettingsDialog() {
    this.state.settingsMode = 'settings';
    this.state.settingsOpen = true;
    this.elements.settingsModal.dataset.mode = 'settings';
    this.elements.settingsModalTitle.textContent = 'Settings';
    this.elements.settingsDoneActions.style.display = 'none';
    this.elements.settingsModal.style.display = 'flex';
  },

  closeSettingsDialog() {
    // In setup mode, only allow closing if configured
    if (this.state.settingsMode === 'setup' && !this.isConfigured()) return;

    const wasSetup = this.state.settingsMode === 'setup';
    this.state.settingsOpen = false;
    this.state.settingsMode = null;
    this.elements.settingsModal.style.display = 'none';
    this.elements.settingsBtn.classList.remove('active');

    // If closing from setup mode, transition landing → app
    if (wasSetup) {
      this.showApp();
    }
  },

  updateSetupDoneButton() {
    if (this.state.settingsMode !== 'setup') return;
    const configured = this.isConfigured();
    this.elements.settingsDoneActions.style.display = configured ? 'flex' : 'none';
  },

  showLanding() {
    if (this.elements.landingPage) this.elements.landingPage.style.display = 'block';
    if (this.elements.header) this.elements.header.style.display = 'none';
    if (this.elements.nav) this.elements.nav.style.display = 'none';
    if (this.elements.main) this.elements.main.style.display = 'none';
    // Close settings modal if open
    if (this.elements.settingsModal) {
      this.elements.settingsModal.style.display = 'none';
      this.state.settingsOpen = false;
      this.state.settingsMode = null;
    }
  },

  showApp() {
    if (this.elements.landingPage) this.elements.landingPage.style.display = 'none';
    if (this.elements.header) this.elements.header.style.display = '';
    if (this.elements.nav) this.elements.nav.style.display = '';
    if (this.elements.main) this.elements.main.style.display = '';
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
      // No API key - show landing page
      this.hideInitialLoading();
      this.showLanding();
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
    // If connected and not in setup mode, ensure app chrome is visible
    if (this.state.connected && this.state.settingsMode !== 'setup') {
      this.showApp();
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
      if (silent) this.openSettingsDialog();
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

    // Show landing page again
    this.showLanding();

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

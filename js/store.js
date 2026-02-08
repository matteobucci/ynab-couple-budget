/**
 * Reactive Store - Central state management with pub/sub
 *
 * This Store is the source of truth for UI state. It:
 * 1. Receives data from DataService (does NOT make API calls itself)
 * 2. Provides reactive subscriptions for UI modules
 * 3. Computes derived state (linkedPairs, balances, syncStatus)
 * 4. Persists config to localStorage
 *
 * Data Flow:
 *   API → DataService (caching) → Store (reactive state) → Modules (subscribers)
 */
const Store = {
  // ==================
  // State
  // ==================
  state: {
    // Configuration (persisted to localStorage)
    config: null,

    // Raw transactions by budget { budgetId: Transaction[] }
    transactions: {},

    // Computed/derived state (recomputed when transactions change)
    linkedPairs: [],
    unlinkedPersonal: {},
    unlinkedShared: {},
    linkedPersonal: {},   // { memberName: Transaction[] } - linked personal txns
    linkedShared: {},     // { memberName: Transaction[] } - linked shared txns
    balances: {},         // { memberName: { personal, shared, net } }
    syncStatus: null,     // { linked, unlinked, total, complete, incomplete }

    // Metadata
    lastSync: {},         // { budgetId: timestamp }
    initialized: false
  },

  // ==================
  // Pub/Sub System
  // ==================
  _listeners: new Map(),  // key -> Set<callback>

  /**
   * Subscribe to state changes
   * Supports fine-grained keys like 'transactions.{budgetId}'
   * @param {string} key - State key to subscribe to
   * @param {function} callback - Called with new value when state changes
   * @returns {function} Unsubscribe function
   */
  subscribe(key, callback) {
    if (!this._listeners.has(key)) {
      this._listeners.set(key, new Set());
    }
    this._listeners.get(key).add(callback);

    // Return unsubscribe function
    return () => this._listeners.get(key).delete(callback);
  },

  /**
   * Notify subscribers of state change
   * Notifies both exact key and parent key subscribers
   */
  _notify(key) {
    const value = this._getNestedValue(key);

    // Notify exact subscribers
    this._listeners.get(key)?.forEach(cb => {
      try {
        cb(value);
      } catch (e) {
        console.error(`Store subscriber error for "${key}":`, e);
      }
    });

    // Notify parent subscribers (e.g., 'transactions' when 'transactions.xyz' changes)
    const parts = key.split('.');
    if (parts.length > 1) {
      const parentKey = parts[0];
      this._listeners.get(parentKey)?.forEach(cb => {
        try {
          cb(this.state[parentKey]);
        } catch (e) {
          console.error(`Store subscriber error for "${parentKey}":`, e);
        }
      });
    }
  },

  /**
   * Get nested value from state using dot notation
   */
  _getNestedValue(key) {
    const parts = key.split('.');
    let value = this.state;
    for (const part of parts) {
      if (value === undefined || value === null) return undefined;
      value = value[part];
    }
    return value;
  },

  // ==================
  // State Setters
  // ==================

  /**
   * Initialize store from localStorage
   * Called once on app startup
   */
  init() {
    if (this.state.initialized) return;

    // Load config from localStorage
    this.state.config = Storage.getConfig();

    // Load cached transactions from localStorage
    const txnCache = Storage.getTransactionCache();
    Object.entries(txnCache).forEach(([budgetId, cache]) => {
      if (cache.transactions) {
        this.state.transactions[budgetId] = cache.transactions;
        this.state.lastSync[budgetId] = cache.lastFetch;
      }
    });

    // Compute derived state if we have transactions
    if (Object.keys(this.state.transactions).length > 0) {
      this._recomputeDerivedState();
    }

    this.state.initialized = true;
    console.log('Store initialized', {
      hasConfig: !!this.state.config?.sharedBudgetId,
      budgetsLoaded: Object.keys(this.state.transactions).length
    });
  },

  /**
   * Set configuration
   * @param {object} config - Full config object
   */
  setConfig(config) {
    this.state.config = config;
    Storage.setConfig(config);
    this._notify('config');

    // Recompute derived state as it depends on config
    this._recomputeDerivedState();
  },

  /**
   * Update configuration (partial update)
   * @param {object} updates - Partial config updates
   */
  updateConfig(updates) {
    this.state.config = { ...this.state.config, ...updates };
    Storage.setConfig(this.state.config);
    this._notify('config');

    // Recompute derived state as it depends on config
    this._recomputeDerivedState();
  },

  /**
   * Set transactions for a budget
   * Called by DataService after fetching from API
   * @param {string} budgetId - Budget ID
   * @param {Array} transactions - Transaction array
   */
  setTransactions(budgetId, transactions) {
    this.state.transactions[budgetId] = transactions;
    this.state.lastSync[budgetId] = Date.now();

    // Notify fine-grained subscribers
    this._notify(`transactions.${budgetId}`);

    // Recompute derived state
    this._recomputeDerivedState();
  },

  /**
   * Update a single transaction (after API mutation)
   * @param {string} budgetId - Budget ID
   * @param {object} transaction - Updated transaction
   */
  updateTransaction(budgetId, transaction) {
    const txns = this.state.transactions[budgetId];
    if (!txns) return;

    const index = txns.findIndex(t => t.id === transaction.id);
    if (index >= 0) {
      txns[index] = transaction;
    } else {
      txns.push(transaction);
    }

    this._notify(`transactions.${budgetId}`);
    this._recomputeDerivedState();
  },

  /**
   * Remove a transaction (after API deletion)
   * @param {string} budgetId - Budget ID
   * @param {string} transactionId - Transaction ID to remove
   */
  removeTransaction(budgetId, transactionId) {
    const txns = this.state.transactions[budgetId];
    if (!txns) return;

    const index = txns.findIndex(t => t.id === transactionId);
    if (index >= 0) {
      txns.splice(index, 1);
      this._notify(`transactions.${budgetId}`);
      this._recomputeDerivedState();
    }
  },

  /**
   * Clear transactions for a budget (forces reload on next access)
   * @param {string} budgetId - Budget ID
   */
  clearBudgetTransactions(budgetId) {
    delete this.state.transactions[budgetId];
    delete this.state.lastSync[budgetId];
    this._notify(`transactions.${budgetId}`);
    this._recomputeDerivedState();
  },

  // ==================
  // Derived State Computation
  // ==================

  /**
   * Recompute all derived state from transactions
   * Called whenever transactions or config changes
   */
  _recomputeDerivedState() {
    const config = this.state.config;
    if (!config?.members?.length) return;

    this._computeLinkedPairs();
    this._computeSyncStatus();
    this._computeBalances();
  },

  /**
   * Compute linked pairs from transactions
   * Moved from Consistency.analyzeLinks()
   */
  _computeLinkedPairs() {
    const config = this.state.config;
    if (!config?.members?.length || !config.sharedBudgetId) return;

    const byId = {};
    const unlinkedPersonal = {};
    const unlinkedShared = {};
    const linkedPersonal = {};
    const linkedShared = {};

    // Initialize per member
    config.members.forEach(m => {
      unlinkedPersonal[m.name] = [];
      unlinkedShared[m.name] = [];
      linkedPersonal[m.name] = [];
      linkedShared[m.name] = [];
    });

    // Process each member's personal transactions (both shared expenses and balancing categories)
    config.members.forEach(member => {
      // Get transactions from shared expenses category
      const sharedCategoryTxns = this._getFilteredTransactions(
        member.budgetId,
        { categoryId: member.sharedCategoryId }
      );

      // Get transactions from balancing category (if configured)
      const balancingCategoryTxns = member.balancingCategoryId
        ? this._getFilteredTransactions(member.budgetId, { categoryId: member.balancingCategoryId })
        : [];

      // Combine both (use Set to avoid duplicates by transaction ID)
      const seenIds = new Set();
      const personalTxns = [];
      [...sharedCategoryTxns, ...balancingCategoryTxns].forEach(txn => {
        if (!seenIds.has(txn.id)) {
          seenIds.add(txn.id);
          personalTxns.push(txn);
        }
      });

      personalTxns.forEach(txn => {
        // Skip deleted transactions
        if (txn.deleted) return;

        const id = LinkUtils.extractId(txn.memo);
        if (id) {
          if (!byId[id]) byId[id] = { personal: {}, shared: [] };
          if (!byId[id].personal[member.name]) byId[id].personal[member.name] = [];
          byId[id].personal[member.name].push(txn);
          // Track linked transactions for display
          if (!linkedPersonal[member.name]) linkedPersonal[member.name] = [];
          linkedPersonal[member.name].push({ ...txn, linkId: id });
        } else {
          if (!unlinkedPersonal[member.name]) unlinkedPersonal[member.name] = [];
          unlinkedPersonal[member.name].push(txn);
        }
      });

      // Process shared budget transactions for this member's account
      const sharedTxns = this._getFilteredTransactions(
        config.sharedBudgetId,
        { accountId: member.contributionAccountId }
      );

      sharedTxns.forEach(txn => {
        // Skip deleted transactions
        if (txn.deleted) return;

        const id = LinkUtils.extractId(txn.memo);
        if (id) {
          if (!byId[id]) byId[id] = { personal: {}, shared: [] };
          byId[id].shared.push({ ...txn, memberName: member.name });
          // Track linked transactions for display
          if (!linkedShared[member.name]) linkedShared[member.name] = [];
          linkedShared[member.name].push({ ...txn, linkId: id });
        } else {
          if (!unlinkedShared[member.name]) unlinkedShared[member.name] = [];
          unlinkedShared[member.name].push(txn);
        }
      });
    });

    // Convert to linkedPairs array
    const linkedPairs = Object.entries(byId).map(([id, group]) => ({
      id,
      isBalancing: LinkUtils.isBalancingId(id),
      isMonthly: LinkUtils.isMonthlyId(id),
      monthlyInfo: LinkUtils.parseMonthlyId(id),
      personal: group.personal,
      shared: group.shared,
      isComplete: this._isLinkComplete(id, group, config.members.length)
    }));

    // Sort by date (most recent first)
    linkedPairs.sort((a, b) => {
      const aDate = this._getGroupLatestDate(a);
      const bDate = this._getGroupLatestDate(b);
      return bDate.localeCompare(aDate);
    });

    // Sort all arrays by date (most recent first)
    Object.keys(unlinkedPersonal).forEach(member => {
      unlinkedPersonal[member].sort((a, b) => b.date.localeCompare(a.date));
    });
    Object.keys(unlinkedShared).forEach(member => {
      unlinkedShared[member].sort((a, b) => b.date.localeCompare(a.date));
    });
    Object.keys(linkedPersonal).forEach(member => {
      linkedPersonal[member].sort((a, b) => b.date.localeCompare(a.date));
    });
    Object.keys(linkedShared).forEach(member => {
      linkedShared[member].sort((a, b) => b.date.localeCompare(a.date));
    });

    this.state.linkedPairs = linkedPairs;
    this.state.unlinkedPersonal = unlinkedPersonal;
    this.state.unlinkedShared = unlinkedShared;
    this.state.linkedPersonal = linkedPersonal;
    this.state.linkedShared = linkedShared;

    this._notify('linkedPairs');
    this._notify('unlinkedPersonal');
    this._notify('unlinkedShared');
    this._notify('linkedPersonal');
    this._notify('linkedShared');
  },

  /**
   * Check if a link is complete
   */
  _isLinkComplete(id, group, memberCount) {
    if (LinkUtils.isBalancingId(id)) {
      const personalCount = Object.values(group.personal).flat().length;
      return personalCount === memberCount && group.shared.length === memberCount;
    } else if (LinkUtils.isMonthlyId(id)) {
      return group.shared.length >= 1;
    } else {
      const hasPersonal = Object.values(group.personal).flat().length >= 1;
      const hasShared = group.shared.length >= 1;
      return hasPersonal && hasShared;
    }
  },

  /**
   * Get latest date from a linked group
   */
  _getGroupLatestDate(group) {
    let latest = '0000-00-00';
    Object.values(group.personal).flat().forEach(t => {
      if (t.date > latest) latest = t.date;
    });
    group.shared.forEach(t => {
      if (t.date > latest) latest = t.date;
    });
    return latest;
  },

  /**
   * Compute sync status
   */
  _computeSyncStatus() {
    const linkedPairs = this.state.linkedPairs;
    const unlinkedPersonal = this.state.unlinkedPersonal;
    const unlinkedShared = this.state.unlinkedShared;

    const complete = linkedPairs.filter(p => p.isComplete).length;
    const incomplete = linkedPairs.filter(p => !p.isComplete).length;

    let unlinkedCount = 0;
    Object.values(unlinkedPersonal).forEach(arr => unlinkedCount += arr.length);
    Object.values(unlinkedShared).forEach(arr => unlinkedCount += arr.length);

    this.state.syncStatus = {
      linked: linkedPairs.length,
      complete,
      incomplete,
      unlinked: unlinkedCount,
      total: linkedPairs.length + unlinkedCount
    };

    this._notify('syncStatus');
  },

  /**
   * Compute member balances
   */
  _computeBalances() {
    const config = this.state.config;
    if (!config?.members?.length) return;

    const balances = {};

    config.members.forEach(member => {
      // Sum personal shared expense transactions
      const personalTxns = this._getFilteredTransactions(
        member.budgetId,
        { categoryId: member.sharedCategoryId }
      );
      const personalTotal = personalTxns.reduce((sum, t) => sum + t.amount, 0);

      // Sum shared budget transactions for this member
      const sharedTxns = this._getFilteredTransactions(
        config.sharedBudgetId,
        { accountId: member.contributionAccountId }
      );
      const sharedTotal = sharedTxns.reduce((sum, t) => sum + t.amount, 0);

      balances[member.name] = {
        personal: personalTotal,
        shared: sharedTotal,
        net: personalTotal + sharedTotal  // Both are negative, so this gives delta
      };
    });

    this.state.balances = balances;
    this._notify('balances');
  },

  /**
   * Get filtered transactions from store (client-side filtering)
   */
  _getFilteredTransactions(budgetId, options = {}) {
    let txns = this.state.transactions[budgetId] || [];

    if (options.accountId) {
      txns = txns.filter(t => t.account_id === options.accountId);
    }
    if (options.categoryId) {
      txns = txns.filter(t => t.category_id === options.categoryId);
    }
    if (options.sinceDate) {
      txns = txns.filter(t => t.date >= options.sinceDate);
    }
    if (options.untilDate) {
      txns = txns.filter(t => t.date <= options.untilDate);
    }

    return txns;
  },

  // ==================
  // Getters (convenience methods)
  // ==================

  /**
   * Get config (returns cached or from localStorage)
   */
  getConfig() {
    if (!this.state.config) {
      this.state.config = Storage.getConfig();
    }
    return this.state.config;
  },

  /**
   * Get transactions for a budget
   */
  getTransactions(budgetId, options = {}) {
    return this._getFilteredTransactions(budgetId, options);
  },

  /**
   * Check if budget has transactions loaded
   */
  hasTransactions(budgetId) {
    return !!this.state.transactions[budgetId]?.length;
  },

  /**
   * Get all budget IDs that have transactions loaded
   */
  getLoadedBudgetIds() {
    return Object.keys(this.state.transactions);
  },

  // ==================
  // Debug Utilities
  // ==================
  debug: {
    logState() {
      console.log('Store state:', JSON.parse(JSON.stringify(Store.state)));
    },
    logSubscribers() {
      const subs = {};
      Store._listeners.forEach((callbacks, key) => {
        subs[key] = callbacks.size;
      });
      console.table(subs);
    },
    getState() {
      return JSON.parse(JSON.stringify(Store.state));
    }
  }
};

// Make debug available in console
window.StoreDebug = Store.debug;

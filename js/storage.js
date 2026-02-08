/**
 * Local Storage Manager
 * Handles all localStorage operations with JSON serialization
 * Includes transaction caching with delta sync support
 *
 * Storage limits: ~5-10MB for localStorage
 * Implements automatic cleanup when quota is exceeded
 */
const Storage = {
  KEYS: {
    API_KEY: 'ynab_api_key',
    CONFIG: 'ynab_config',
    CACHE: 'ynab_cache',
    TRANSACTIONS: 'ynab_transactions'
  },

  // Essential transaction fields to cache (reduces storage by ~60%)
  TRANSACTION_FIELDS: ['id', 'date', 'amount', 'payee_name', 'memo', 'account_id', 'category_id', 'category_name', 'deleted', 'cleared'],

  /**
   * Get a value from localStorage
   */
  get(key) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    } catch (e) {
      console.error('Storage.get error:', e);
      return null;
    }
  },

  /**
   * Set a value in localStorage with quota handling
   */
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      if (e.name === 'QuotaExceededError') {
        console.warn('Storage quota exceeded, attempting cleanup...');
        // Try to free up space and retry
        if (this.freeUpSpace(key)) {
          try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
          } catch (e2) {
            console.error('Storage.set failed after cleanup:', e2);
            return false;
          }
        }
      }
      console.error('Storage.set error:', e);
      return false;
    }
  },

  /**
   * Free up localStorage space when quota is exceeded
   */
  freeUpSpace(targetKey) {
    console.log('Freeing up storage space...');

    // 1. Clear month data caches first (least important)
    const cache = this.get(this.KEYS.CACHE);
    if (cache) {
      const keysToDelete = Object.keys(cache).filter(k => k.startsWith('month_'));
      keysToDelete.forEach(k => delete cache[k]);
      if (cache.lastFetch) {
        Object.keys(cache.lastFetch).filter(k => k.startsWith('month_')).forEach(k => delete cache.lastFetch[k]);
      }
      try {
        localStorage.setItem(this.KEYS.CACHE, JSON.stringify(cache));
        console.log('Cleared month data caches');
      } catch (e) {
        // Continue cleanup
      }
    }

    // 2. If target is transactions, try trimming old transactions
    if (targetKey === this.KEYS.TRANSACTIONS) {
      const txnCache = this.get(this.KEYS.TRANSACTIONS);
      if (txnCache) {
        // Trim each budget to last 2 years of transactions
        const twoYearsAgo = new Date();
        twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
        const cutoffDate = twoYearsAgo.toISOString().split('T')[0];

        Object.keys(txnCache).forEach(budgetId => {
          if (txnCache[budgetId]?.transactions) {
            const before = txnCache[budgetId].transactions.length;
            txnCache[budgetId].transactions = txnCache[budgetId].transactions.filter(t => t.date >= cutoffDate);
            const after = txnCache[budgetId].transactions.length;
            if (before !== after) {
              console.log(`Trimmed ${before - after} old transactions from budget ${budgetId}`);
            }
          }
        });

        try {
          localStorage.setItem(this.KEYS.TRANSACTIONS, JSON.stringify(txnCache));
          return true;
        } catch (e) {
          // Still over quota, clear all transaction caches
          console.log('Still over quota, clearing all transaction caches');
          localStorage.removeItem(this.KEYS.TRANSACTIONS);
          return true;
        }
      }
    }

    // 3. Last resort: clear transaction cache entirely
    localStorage.removeItem(this.KEYS.TRANSACTIONS);
    console.log('Cleared all transaction caches');
    return true;
  },

  /**
   * Remove a value from localStorage
   */
  remove(key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch (e) {
      console.error('Storage.remove error:', e);
      return false;
    }
  },

  /**
   * API Key management
   */
  getApiKey() {
    return this.get(this.KEYS.API_KEY);
  },

  setApiKey(key) {
    return this.set(this.KEYS.API_KEY, key);
  },

  clearApiKey() {
    return this.remove(this.KEYS.API_KEY);
  },

  /**
   * Configuration management
   */
  getConfig() {
    return this.get(this.KEYS.CONFIG) || {
      sharedBudgetId: null,
      members: []
    };
  },

  setConfig(config) {
    return this.set(this.KEYS.CONFIG, config);
  },

  updateConfig(updates) {
    const config = this.getConfig();
    return this.setConfig({ ...config, ...updates });
  },

  /**
   * Cache management (for budgets and budget details)
   */
  getCache() {
    return this.get(this.KEYS.CACHE) || {
      budgets: null,
      budgetDetails: {},
      lastFetch: {}
    };
  },

  setCache(cache) {
    return this.set(this.KEYS.CACHE, cache);
  },

  getCachedBudgets() {
    const cache = this.getCache();
    const maxAge = 5 * 60 * 1000; // 5 minutes

    if (cache.budgets && cache.lastFetch.budgets) {
      const age = Date.now() - cache.lastFetch.budgets;
      if (age < maxAge) {
        return cache.budgets;
      }
    }
    return null;
  },

  setCachedBudgets(budgets) {
    const cache = this.getCache();
    cache.budgets = budgets;
    cache.lastFetch.budgets = Date.now();
    return this.setCache(cache);
  },

  getCachedBudgetDetails(budgetId) {
    const cache = this.getCache();
    const maxAge = 2 * 60 * 1000; // 2 minutes

    if (cache.budgetDetails[budgetId] && cache.lastFetch[`budget_${budgetId}`]) {
      const age = Date.now() - cache.lastFetch[`budget_${budgetId}`];
      if (age < maxAge) {
        return cache.budgetDetails[budgetId];
      }
    }
    return null;
  },

  setCachedBudgetDetails(budgetId, details) {
    const cache = this.getCache();
    cache.budgetDetails[budgetId] = details;
    cache.lastFetch[`budget_${budgetId}`] = Date.now();
    return this.setCache(cache);
  },

  clearCache() {
    return this.remove(this.KEYS.CACHE);
  },

  // ==================
  // Transaction Cache with Delta Sync
  // ==================

  /**
   * Get transaction cache structure
   * Structure: { budgetId: { transactions: [], serverKnowledge: number, lastFetch: timestamp, sinceDate: string } }
   */
  getTransactionCache() {
    return this.get(this.KEYS.TRANSACTIONS) || {};
  },

  setTransactionCache(cache) {
    return this.set(this.KEYS.TRANSACTIONS, cache);
  },

  /**
   * Get cached transactions for a budget
   * Returns null if cache is stale or doesn't exist
   */
  getCachedTransactions(budgetId, maxAge = 10 * 60 * 1000) {
    const cache = this.getTransactionCache();
    const budgetCache = cache[budgetId];

    if (!budgetCache) return null;

    const age = Date.now() - budgetCache.lastFetch;
    if (age > maxAge) return null;

    return {
      transactions: budgetCache.transactions,
      serverKnowledge: budgetCache.serverKnowledge,
      sinceDate: budgetCache.sinceDate
    };
  },

  /**
   * Set cached transactions for a budget
   * Only stores essential fields to reduce storage usage
   */
  setCachedTransactions(budgetId, transactions, serverKnowledge, sinceDate) {
    const cache = this.getTransactionCache();

    // Strip transactions to essential fields only (saves ~60% storage)
    const minimalTransactions = transactions.map(t => {
      const minimal = {};
      this.TRANSACTION_FIELDS.forEach(field => {
        if (t[field] !== undefined) {
          minimal[field] = t[field];
        }
      });
      return minimal;
    });

    cache[budgetId] = {
      transactions: minimalTransactions,
      serverKnowledge,
      sinceDate,
      lastFetch: Date.now()
    };
    return this.setTransactionCache(cache);
  },

  /**
   * Update cached transactions with delta (new/changed transactions)
   */
  updateCachedTransactions(budgetId, deltaTransactions, newServerKnowledge) {
    const cache = this.getTransactionCache();
    const budgetCache = cache[budgetId];

    if (!budgetCache) {
      // No existing cache, just set the new transactions
      return this.setCachedTransactions(budgetId, deltaTransactions, newServerKnowledge, null);
    }

    // Merge delta into existing transactions
    const existingMap = new Map(budgetCache.transactions.map(t => [t.id, t]));

    // Update or add delta transactions (strip to essential fields)
    deltaTransactions.forEach(t => {
      if (t.deleted) {
        existingMap.delete(t.id);
      } else {
        // Strip to essential fields
        const minimal = {};
        this.TRANSACTION_FIELDS.forEach(field => {
          if (t[field] !== undefined) {
            minimal[field] = t[field];
          }
        });
        existingMap.set(t.id, minimal);
      }
    });

    const mergedTransactions = Array.from(existingMap.values());

    cache[budgetId] = {
      ...budgetCache,
      transactions: mergedTransactions,
      serverKnowledge: newServerKnowledge,
      lastFetch: Date.now()
    };

    return this.setTransactionCache(cache);
  },

  /**
   * Clear transaction cache for a specific budget
   */
  clearBudgetTransactionCache(budgetId) {
    const cache = this.getTransactionCache();
    delete cache[budgetId];
    return this.setTransactionCache(cache);
  },

  /**
   * Clear all transaction caches
   */
  clearAllTransactionCaches() {
    return this.remove(this.KEYS.TRANSACTIONS);
  },

  /**
   * Get server knowledge for a budget (for delta sync)
   */
  getServerKnowledge(budgetId) {
    const cache = this.getTransactionCache();
    return cache[budgetId]?.serverKnowledge || null;
  },

  // ==================
  // Month Data Cache
  // ==================

  /**
   * Get cached month data
   * Structure: { budgetId_month: { data, lastFetch } }
   */
  getCachedMonthData(budgetId, month) {
    const cache = this.getCache();
    const key = `month_${budgetId}_${month}`;
    const maxAge = 5 * 60 * 1000; // 5 minutes

    if (cache[key] && cache.lastFetch[key]) {
      const age = Date.now() - cache.lastFetch[key];
      if (age < maxAge) {
        return cache[key];
      }
    }
    return null;
  },

  setCachedMonthData(budgetId, month, data) {
    const cache = this.getCache();
    const key = `month_${budgetId}_${month}`;
    cache[key] = data;
    cache.lastFetch[key] = Date.now();
    return this.setCache(cache);
  },

  /**
   * Clear cached month data for a specific budget and month
   */
  clearCachedMonthData(budgetId, month) {
    const cache = this.getCache();
    const key = `month_${budgetId}_${month}`;
    delete cache[key];
    delete cache.lastFetch[key];
    this.setCache(cache);
  },

  /**
   * Clear all stored data
   */
  clearAll() {
    this.clearApiKey();
    this.remove(this.KEYS.CONFIG);
    this.clearCache();
    this.clearAllTransactionCaches();
  },

  /**
   * Get storage usage info (for debugging)
   */
  getStorageInfo() {
    let totalSize = 0;
    const sizes = {};

    for (const key of Object.keys(localStorage)) {
      const size = (localStorage.getItem(key) || '').length * 2; // UTF-16
      sizes[key] = (size / 1024).toFixed(2) + ' KB';
      totalSize += size;
    }

    return {
      total: (totalSize / 1024 / 1024).toFixed(2) + ' MB',
      breakdown: sizes
    };
  }
};

// Make storage info available in console for debugging
window.getStorageInfo = () => {
  const info = Storage.getStorageInfo();
  console.log('localStorage usage:', info.total);
  console.table(info.breakdown);
  return info;
};

// Clear transaction cache command
window.clearTransactionCache = () => {
  Storage.clearAllTransactionCaches();
  console.log('Transaction cache cleared. Refresh the page to reload data.');
};

/**
 * DataService - Centralized data fetching with caching and delta sync
 *
 * This service dramatically reduces API calls by:
 * 1. Caching transactions per budget with delta sync (server_knowledge)
 * 2. Loading all transactions at once, then filtering client-side
 * 3. Caching month data to avoid repeated fetches
 * 4. Using the full budget endpoint which returns everything in one call
 *
 * API Request Savings:
 * - Before: 240+ requests for Monthly (60 months × 2 members × 2 calls each)
 * - After: ~6-10 requests total (2 budgets × 2-3 calls, then cached)
 */
const DataService = {
  // In-memory cache for the current session
  _memoryCache: {
    transactions: {},  // { budgetId: { data, timestamp, sinceDate } }
    months: {},        // { budgetId_month: { data, timestamp } }
    budgets: {}        // { budgetId: { data, timestamp } }
  },

  // Track if we've shown quota warning this session
  _quotaWarningShown: false,

  // Track budgets where localStorage caching failed (use memory only)
  _storageFailed: new Set(),

  // Memory cache TTL (10 minutes for in-session, still validates with localStorage)
  MEMORY_CACHE_TTL: 10 * 60 * 1000,

  /**
   * Get all transactions for a budget (cached with delta sync)
   * This is the main method - all modules should use this
   */
  async getTransactions(budgetId, options = {}) {
    const {
      forceRefresh = false,
      sinceDate = null
    } = options;

    const requestedSinceDate = sinceDate || this._getDefaultSinceDate();

    // Check memory cache first
    const memCached = this._memoryCache.transactions[budgetId];
    if (!forceRefresh && memCached && Date.now() - memCached.timestamp < this.MEMORY_CACHE_TTL) {
      const memCachedSinceDate = memCached.sinceDate;

      // If memory cache covers the requested date range, use it
      if (!memCachedSinceDate || requestedSinceDate >= memCachedSinceDate) {
        return this._filterTransactions(memCached.data, options);
      }

      // Need older data than memory cache has - check if storage failed previously
      if (this._storageFailed.has(budgetId)) {
        // Storage failed before, just use what we have
        console.log(`[DataService] Storage failed previously for ${budgetId}, using memory cache`);
        return this._filterTransactions(memCached.data, options);
      }
    }

    // Check localStorage cache (skip if storage already failed for this budget)
    const storageCached = this._storageFailed.has(budgetId) ? null : Storage.getCachedTransactions(budgetId);

    if (storageCached && !forceRefresh) {
      const cachedSinceDate = storageCached.sinceDate;

      // If requesting data older than cached, we need to fetch more
      if (cachedSinceDate && requestedSinceDate < cachedSinceDate) {
        console.log(`[DataService] Requested date ${requestedSinceDate} is older than cached ${cachedSinceDate}, fetching full range`);
        return this._fetchAndCacheTransactions(budgetId, requestedSinceDate, options);
      }

      // Use delta sync - fetch only changes since last fetch
      const serverKnowledge = storageCached.serverKnowledge;

      try {
        const result = await YnabClient.getAllTransactions(budgetId, {
          lastKnowledge: serverKnowledge
        });

        // Merge delta with cached data
        if (result.transactions.length > 0) {
          Storage.updateCachedTransactions(budgetId, result.transactions, result.serverKnowledge);
          // Get the merged result
          const updated = Storage.getCachedTransactions(budgetId, Infinity);
          this._memoryCache.transactions[budgetId] = {
            data: updated.transactions,
            timestamp: Date.now(),
            sinceDate: cachedSinceDate
          };
          // Update Store with merged data
          Store.setTransactions(budgetId, updated.transactions);
          return this._filterTransactions(updated.transactions, options);
        }

        // No changes, use cached data
        this._memoryCache.transactions[budgetId] = {
          data: storageCached.transactions,
          timestamp: Date.now(),
          sinceDate: cachedSinceDate
        };
        // Update Store with cached data
        Store.setTransactions(budgetId, storageCached.transactions);
        return this._filterTransactions(storageCached.transactions, options);

      } catch (error) {
        console.warn('Delta sync failed, using cached data:', error);
        // Still update Store with cached data
        Store.setTransactions(budgetId, storageCached.transactions);
        return this._filterTransactions(storageCached.transactions, options);
      }
    }

    // No cache or force refresh - fetch all transactions
    return this._fetchAndCacheTransactions(budgetId, requestedSinceDate, options);
  },

  /**
   * Fetch transactions from API and attempt to cache them
   * Handles quota exceeded errors and API errors gracefully
   */
  async _fetchAndCacheTransactions(budgetId, sinceDate, options) {
    try {
      const result = await YnabClient.getAllTransactions(budgetId, {
        sinceDate: sinceDate
      });

      // Try to cache the results
      const cacheSuccess = Storage.setCachedTransactions(budgetId, result.transactions, result.serverKnowledge, sinceDate);

      if (!cacheSuccess) {
        // Storage failed (likely quota exceeded)
        this._storageFailed.add(budgetId);
        this._showQuotaWarning();
      }

      // Always update memory cache (this always works)
      this._memoryCache.transactions[budgetId] = {
        data: result.transactions,
        timestamp: Date.now(),
        sinceDate: sinceDate
      };

      // Update Store with fresh data
      Store.setTransactions(budgetId, result.transactions);

      return this._filterTransactions(result.transactions, options);

    } catch (error) {
      // Check if we have any cached data to fall back to
      const memCached = this._memoryCache.transactions[budgetId];
      const storageCached = Storage.getCachedTransactions(budgetId);

      if (memCached?.data?.length > 0) {
        console.warn(`[DataService] API fetch failed, using memory cache:`, error.message);
        this._showApiError(error);
        return this._filterTransactions(memCached.data, options);
      }

      if (storageCached?.transactions?.length > 0) {
        console.warn(`[DataService] API fetch failed, using storage cache:`, error.message);
        this._showApiError(error);
        this._memoryCache.transactions[budgetId] = {
          data: storageCached.transactions,
          timestamp: Date.now(),
          sinceDate: storageCached.sinceDate
        };
        Store.setTransactions(budgetId, storageCached.transactions);
        return this._filterTransactions(storageCached.transactions, options);
      }

      // No cache available, re-throw with user-friendly message
      this._showApiError(error);
      throw error;
    }
  },

  /**
   * Show API error notification (only once per error type per session)
   */
  _apiErrorsShown: new Set(),

  _showApiError(error) {
    const errorKey = error.message?.substring(0, 50) || 'unknown';
    if (this._apiErrorsShown.has(errorKey)) return;
    this._apiErrorsShown.add(errorKey);

    let userMessage = 'Failed to fetch data from YNAB.';

    if (error.message?.includes('Network error') || error.message?.includes('fetch')) {
      userMessage = 'Network error. Please check your internet connection.';
    } else if (error.message?.includes('401') || error.message?.includes('Unauthorized')) {
      userMessage = 'Authentication failed. Please check your API key in Settings.';
    } else if (error.message?.includes('429') || error.message?.includes('rate limit')) {
      userMessage = 'Too many requests. Please wait a moment and try again.';
    } else if (error.message?.includes('500') || error.message?.includes('502') || error.message?.includes('503')) {
      userMessage = 'YNAB service is temporarily unavailable. Please try again later.';
    } else if (error.message) {
      userMessage = `Error: ${error.message}`;
    }

    if (typeof Utils !== 'undefined' && Utils.showToast) {
      Utils.showToast(userMessage, 'error', 6000);
    }
  },

  /**
   * Show quota exceeded warning (only once per session)
   */
  _showQuotaWarning() {
    if (this._quotaWarningShown) return;
    this._quotaWarningShown = true;

    // Use Utils.showToast if available, otherwise console
    if (typeof Utils !== 'undefined' && Utils.showToast) {
      Utils.showToast(
        'Storage limit reached. Data will be cached in memory only for this session. Consider using a shorter time range.',
        'warning',
        8000
      );
    } else {
      console.warn('[DataService] Storage quota exceeded - using memory-only cache');
    }
  },

  /**
   * Filter transactions client-side (much faster than API filtering)
   */
  _filterTransactions(transactions, options) {
    let filtered = transactions;

    // Filter by account
    if (options.accountId) {
      filtered = filtered.filter(t => t.account_id === options.accountId);
    }

    // Filter by category
    if (options.categoryId) {
      filtered = filtered.filter(t => t.category_id === options.categoryId);
    }

    // Filter by date range
    if (options.sinceDate) {
      filtered = filtered.filter(t => t.date >= options.sinceDate);
    }
    if (options.untilDate) {
      filtered = filtered.filter(t => t.date <= options.untilDate);
    }

    // Filter by month (YYYY-MM format)
    if (options.month) {
      const monthPrefix = options.month.substring(0, 7); // Handle YYYY-MM or YYYY-MM-DD
      filtered = filtered.filter(t => t.date.startsWith(monthPrefix));
    }

    return filtered;
  },

  /**
   * Default since date (2 years back to balance coverage vs storage)
   * Reduces localStorage usage while covering typical use cases
   */
  _getDefaultSinceDate() {
    const date = new Date();
    date.setFullYear(date.getFullYear() - 2);
    return date.toISOString().split('T')[0];
  },

  /**
   * Get month data for a budget (category budgeted amounts, balances, etc.)
   * Uses caching to avoid repeated calls
   */
  async getMonthData(budgetId, month) {
    const cacheKey = `${budgetId}_${month}`;

    // Check memory cache
    const memCached = this._memoryCache.months[cacheKey];
    if (memCached && Date.now() - memCached.timestamp < this.MEMORY_CACHE_TTL) {
      return memCached.data;
    }

    // Check localStorage
    const storageCached = Storage.getCachedMonthData(budgetId, month);
    if (storageCached) {
      this._memoryCache.months[cacheKey] = {
        data: storageCached,
        timestamp: Date.now()
      };
      return storageCached;
    }

    // Fetch from API
    const monthData = await YnabClient.getMonth(budgetId, month);

    // Cache it
    Storage.setCachedMonthData(budgetId, month, monthData);
    this._memoryCache.months[cacheKey] = {
      data: monthData,
      timestamp: Date.now()
    };

    return monthData;
  },

  /**
   * Get budget details (accounts, categories, etc.)
   * This wraps App.loadBudgetDetails for consistency
   */
  async getBudgetDetails(budgetId) {
    return await App.loadBudgetDetails(budgetId);
  },

  /**
   * Pre-load transactions for multiple budgets in parallel
   * Useful for initial load of the app
   */
  async preloadTransactions(budgetIds, options = {}) {
    const promises = budgetIds.map(budgetId =>
      this.getTransactions(budgetId, options).catch(err => {
        console.error(`Failed to preload transactions for ${budgetId}:`, err);
        return [];
      })
    );
    return Promise.all(promises);
  },

  /**
   * Pre-load month data for visible months (for Monthly screen)
   * Only loads what's needed, not all 60 months
   */
  async preloadMonthData(budgetId, months) {
    const promises = months.map(month =>
      this.getMonthData(budgetId, month).catch(err => {
        console.error(`Failed to preload month ${month}:`, err);
        return null;
      })
    );
    return Promise.all(promises);
  },

  /**
   * Calculate transaction activity for a specific account in a month
   * Uses cached transactions
   */
  async getAccountActivityForMonth(budgetId, accountId, month) {
    const transactions = await this.getTransactions(budgetId, {
      accountId,
      month
    });

    return transactions.reduce((sum, t) => sum + t.amount, 0);
  },

  /**
   * Get category data for a specific month
   * Uses cached month data
   */
  async getCategoryForMonth(budgetId, categoryId, month) {
    const monthData = await this.getMonthData(budgetId, month);
    return monthData.categories?.find(c => c.id === categoryId) || null;
  },

  /**
   * Invalidate cache for a budget (call after creating/updating/deleting transactions)
   */
  invalidateBudgetCache(budgetId) {
    delete this._memoryCache.transactions[budgetId];
    // Don't clear localStorage - let delta sync handle it
    // Just clear the memory cache timestamp to force a refresh on next access
  },

  /**
   * Invalidate month cache for a specific budget and month
   * Call this after updating category budgets
   */
  invalidateMonthCache(budgetId, month) {
    const cacheKey = `${budgetId}_${month}`;
    delete this._memoryCache.months[cacheKey];
    // Also clear from localStorage
    Storage.clearCachedMonthData(budgetId, month);
  },

  /**
   * Clear all caches
   */
  clearAllCaches() {
    this._memoryCache = {
      transactions: {},
      months: {},
      budgets: {}
    };
    Storage.clearAllTransactionCaches();
    Storage.clearCache();
  }
};

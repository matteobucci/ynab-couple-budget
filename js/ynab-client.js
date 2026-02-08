/**
 * YNAB API Client
 * Direct browser-to-YNAB API communication with delta sync support
 */
const YnabClient = {
  BASE_URL: 'https://api.ynab.com/v1',
  apiKey: null,

  /**
   * Initialize the client with an API key
   */
  init(apiKey) {
    this.apiKey = apiKey;
  },

  /**
   * Check if client is initialized
   */
  isInitialized() {
    return !!this.apiKey;
  },

  /**
   * Make an authenticated request to YNAB API
   * Returns the full response data (including server_knowledge)
   */
  async request(endpoint, options = {}) {
    if (!this.apiKey) {
      throw new Error('API key not configured');
    }

    const url = `${this.BASE_URL}${endpoint}`;
    const headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      ...options.headers
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers
      });

      if (response.status === 401) {
        throw new Error('Invalid API key');
      }

      if (response.status === 404) {
        throw new Error('Resource not found');
      }

      if (response.status === 429) {
        throw new Error('Rate limit exceeded. Please wait a moment and try again.');
      }

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.detail || `API error: ${response.status}`);
      }

      const data = await response.json();
      return data.data;
    } catch (error) {
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        throw new Error('Network error. Please check your connection.');
      }
      throw error;
    }
  },

  /**
   * Test API connection
   */
  async testConnection() {
    const data = await this.request('/user');
    return data.user;
  },

  // ==================
  // Budgets
  // ==================

  /**
   * Get all budgets (minimal info)
   */
  async getBudgets() {
    const data = await this.request('/budgets');
    return data.budgets;
  },

  /**
   * Get a single budget with full details
   * This returns ALL budget data: accounts, categories, months, payees
   * Use this instead of multiple individual requests!
   */
  async getBudget(budgetId, lastKnowledge = null) {
    let endpoint = `/budgets/${budgetId}`;
    if (lastKnowledge) {
      endpoint += `?last_knowledge_of_server=${lastKnowledge}`;
    }
    const data = await this.request(endpoint);
    return {
      budget: data.budget,
      serverKnowledge: data.server_knowledge
    };
  },

  // ==================
  // Accounts
  // ==================

  /**
   * Get all accounts for a budget
   */
  async getAccounts(budgetId) {
    const data = await this.request(`/budgets/${budgetId}/accounts`);
    return data.accounts;
  },

  /**
   * Get a single account
   */
  async getAccount(budgetId, accountId) {
    const data = await this.request(`/budgets/${budgetId}/accounts/${accountId}`);
    return data.account;
  },

  // ==================
  // Categories
  // ==================

  /**
   * Get all category groups with categories
   */
  async getCategories(budgetId) {
    const data = await this.request(`/budgets/${budgetId}/categories`);
    return data.category_groups;
  },

  /**
   * Get a single category
   */
  async getCategory(budgetId, categoryId) {
    const data = await this.request(`/budgets/${budgetId}/categories/${categoryId}`);
    return data.category;
  },

  // ==================
  // Months
  // ==================

  /**
   * Get all budget months (summary only)
   */
  async getMonths(budgetId) {
    const data = await this.request(`/budgets/${budgetId}/months`);
    return data.months;
  },

  /**
   * Get a single month with full category details
   */
  async getMonth(budgetId, month) {
    const data = await this.request(`/budgets/${budgetId}/months/${month}`);
    return data.month;
  },

  /**
   * Update category budgeted amount for a month
   */
  async updateCategoryBudget(budgetId, month, categoryId, budgeted) {
    const data = await this.request(
      `/budgets/${budgetId}/months/${month}/categories/${categoryId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ category: { budgeted } })
      }
    );
    return data.category;
  },

  // ==================
  // Transactions
  // ==================

  /**
   * Get ALL transactions for a budget with optional delta sync
   * This is the most efficient way to get transactions - one request for everything
   * Then filter client-side by account/category as needed
   */
  async getAllTransactions(budgetId, options = {}) {
    const params = new URLSearchParams();

    if (options.sinceDate) {
      params.append('since_date', options.sinceDate);
    }
    if (options.lastKnowledge) {
      params.append('last_knowledge_of_server', options.lastKnowledge);
    }

    let endpoint = `/budgets/${budgetId}/transactions`;
    const queryString = params.toString();
    if (queryString) {
      endpoint += `?${queryString}`;
    }

    const data = await this.request(endpoint);
    return {
      transactions: data.transactions,
      serverKnowledge: data.server_knowledge
    };
  },

  /**
   * Get transactions with optional filters
   * NOTE: Each filter type is a SEPARATE API call. Prefer getAllTransactions() + client-side filtering
   */
  async getTransactions(budgetId, options = {}) {
    const params = new URLSearchParams();

    if (options.sinceDate) {
      params.append('since_date', options.sinceDate);
    }
    if (options.type) {
      params.append('type', options.type);
    }

    let endpoint = `/budgets/${budgetId}/transactions`;
    if (options.accountId) {
      endpoint = `/budgets/${budgetId}/accounts/${options.accountId}/transactions`;
    } else if (options.categoryId) {
      endpoint = `/budgets/${budgetId}/categories/${options.categoryId}/transactions`;
    }

    const queryString = params.toString();
    if (queryString) {
      endpoint += `?${queryString}`;
    }

    const data = await this.request(endpoint);
    return data.transactions;
  },

  /**
   * Create a transaction
   */
  async createTransaction(budgetId, transaction) {
    const data = await this.request(`/budgets/${budgetId}/transactions`, {
      method: 'POST',
      body: JSON.stringify({ transaction })
    });
    return data.transaction;
  },

  /**
   * Update a transaction
   */
  async updateTransaction(budgetId, transactionId, transaction) {
    const data = await this.request(
      `/budgets/${budgetId}/transactions/${transactionId}`,
      {
        method: 'PUT',
        body: JSON.stringify({ transaction })
      }
    );
    return data.transaction;
  },

  /**
   * Delete a transaction
   */
  async deleteTransaction(budgetId, transactionId) {
    const data = await this.request(
      `/budgets/${budgetId}/transactions/${transactionId}`,
      {
        method: 'DELETE'
      }
    );
    return data.transaction;
  },

  // ==================
  // Payees
  // ==================

  /**
   * Get all payees
   */
  async getPayees(budgetId) {
    const data = await this.request(`/budgets/${budgetId}/payees`);
    return data.payees;
  },

  // ==================
  // Helpers
  // ==================

  /**
   * Convert milliunits to currency amount
   */
  fromMilliunits(milliunits) {
    return milliunits / 1000;
  },

  /**
   * Convert currency amount to milliunits
   */
  toMilliunits(amount) {
    return Math.round(amount * 1000);
  },

  /**
   * Format currency for display
   */
  formatCurrency(milliunits, currency = 'EUR') {
    const amount = this.fromMilliunits(milliunits);
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency
    }).format(amount);
  }
};

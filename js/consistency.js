/**
 * Consistency Tool Module
 * Tracks and links transactions across budgets using memo-embedded IDs
 *
 * Uses LinkUtils for ID generation and parsing (see utils.js)
 * ID Formats:
 * - Regular expense: #XXXXXX# (6 char alphanumeric)
 * - Balancing: #B-XXXXXX# (B prefix for balancing sets)
 * - Monthly income: #M-MM-YY# (M prefix with month-year)
 */
const Consistency = {
  elements: {},
  _busy: false, // Prevents concurrent mutations

  state: {
    loading: false,
    selectedMember: null,
    linkingMode: false,
    selectedPersonalTxn: null,
    filterUnmatched: true,
    transactions: {
      personal: {}, // { memberId: transactions[] }
      shared: []
    },
    linkedPairs: [],
    unlinkedPersonal: {},
    unlinkedShared: {},
    linkedPersonal: {},
    linkedShared: {},
    settleModalOpen: false,
    sharedAccounts: []  // Shared budget accounts (needed for transfer_payee_id)
  },

  // Delegate ID operations to shared LinkUtils (see utils.js)
  get ID_REGEX() { return LinkUtils.ID_REGEX; },
  generateId() { return LinkUtils.generateId(); },
  generateBalancingId() { return LinkUtils.generateBalancingId(); },
  generateMonthlyId(month, year) { return LinkUtils.generateMonthlyId(month, year); },
  formatIdTag(id) { return LinkUtils.formatIdTag(id); },
  extractId(memo) { return LinkUtils.extractId(memo); },
  hasId(memo) { return LinkUtils.hasId(memo); },
  appendIdToMemo(memo, id) { return LinkUtils.appendIdToMemo(memo, id); },
  isBalancingId(id) { return LinkUtils.isBalancingId(id); },
  isMonthlyId(id) { return LinkUtils.isMonthlyId(id); },
  parseMonthlyId(id) { return LinkUtils.parseMonthlyId(id); },

  init(elements) {
    this.elements = elements;
    this.state.memberAccounts = {}; // For balancing form account selection
    this.state.subscribed = false;
    // Restore filter preference from localStorage
    const savedFilter = Storage.get('consistency_filter_unmatched');
    this.state.filterUnmatched = savedFilter !== null ? savedFilter : true;
    this.bindEvents();
    this.subscribeToStore();
  },

  /**
   * Subscribe to Store changes for reactive updates
   */
  subscribeToStore() {
    if (this.state.subscribed) return;

    // Subscribe to linkedPairs changes
    Store.subscribe('linkedPairs', (linkedPairs) => {
      if (!this.state.loading && this.isScreenVisible()) {
        this.state.linkedPairs = linkedPairs;
        this.renderLinkedPairs();
      }
    });

    // Subscribe to unlinked transaction changes
    Store.subscribe('unlinkedPersonal', (unlinked) => {
      if (!this.state.loading && this.isScreenVisible()) {
        this.state.unlinkedPersonal = unlinked;
        this.renderTransactionColumns();
      }
    });

    Store.subscribe('unlinkedShared', (unlinked) => {
      if (!this.state.loading && this.isScreenVisible()) {
        this.state.unlinkedShared = unlinked;
        this.renderTransactionColumns();
      }
    });

    // Subscribe to linked transaction changes (for rendering linked lists)
    Store.subscribe('linkedPersonal', (linked) => {
      if (!this.state.loading && this.isScreenVisible()) {
        this.state.linkedPersonal = linked;
        this.renderTransactionColumns();
      }
    });

    Store.subscribe('linkedShared', (linked) => {
      if (!this.state.loading && this.isScreenVisible()) {
        this.state.linkedShared = linked;
        this.renderTransactionColumns();
      }
    });

    this.state.subscribed = true;
  },

  /**
   * Check if consistency screen is currently visible
   */
  isScreenVisible() {
    return this.elements.consistencyContent?.style?.display !== 'none';
  },

  bindEvents() {
    this.elements.refreshConsistencyBtn?.addEventListener('click', () => this.loadData(true));
    this.elements.cancelLinkingBtn?.addEventListener('click', () => this.cancelLinking());

    // Settle Up Modal events
    this.elements.openSettleBtn?.addEventListener('click', () => this.openSettleModal());
    this.elements.closeSettleBtn?.addEventListener('click', () => this.closeSettleModal());
    this.elements.cancelSettleBtn?.addEventListener('click', () => this.closeSettleModal());
    this.elements.settleModal?.addEventListener('click', (e) => {
      if (e.target === this.elements.settleModal) this.closeSettleModal();
    });

    // Balancing form events
    this.elements.balancingAmount?.addEventListener('input', () => this.updateBalancingPreview());
    this.elements.balancingFrom?.addEventListener('change', () => this.onFromMemberChange());
    this.elements.balancingTo?.addEventListener('change', () => this.onToMemberChange());
    this.elements.balancingFromAccount?.addEventListener('change', () => this.updateBalancingPreview());
    this.elements.balancingToAccount?.addEventListener('change', () => this.updateBalancingPreview());
    this.elements.createBalancingBtn?.addEventListener('click', () => this.createBalancingTransaction());

    // Close modal on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.state.settleModalOpen) {
        this.closeSettleModal();
      }
    });
  },

  openSettleModal() {
    this.state.settleModalOpen = true;
    this.elements.settleModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    // Reset to phase 1
    if (this.elements.settlePhase2) this.elements.settlePhase2.style.display = 'none';
    if (this.elements.balancingFrom) this.elements.balancingFrom.value = '';
    if (this.elements.balancingTo) this.elements.balancingTo.value = '';
    if (this.elements.balancingAmount) this.elements.balancingAmount.value = '';
    if (this.elements.balancingFromAccount) {
      this.elements.balancingFromAccount.innerHTML = '<option value="">Select member first...</option>';
      this.elements.balancingFromAccount.disabled = true;
    }
    if (this.elements.balancingToAccount) {
      this.elements.balancingToAccount.innerHTML = '<option value="">Select member first...</option>';
      this.elements.balancingToAccount.disabled = true;
    }
    if (this.elements.balancingMemo) this.elements.balancingMemo.value = '';
    if (this.elements.balancingPreview) this.elements.balancingPreview.innerHTML = '';
    if (this.elements.createBalancingBtn) this.elements.createBalancingBtn.disabled = true;
  },

  closeSettleModal() {
    this.state.settleModalOpen = false;
    this.elements.settleModal.style.display = 'none';
    document.body.style.overflow = '';
  },

  initScreen() {
    if (!App.state.initialLoadComplete) return;

    const config = Store.getConfig();
    const isConfigured = config.sharedBudgetId &&
      config.members?.length > 0 &&
      config.members.every(m => m.budgetId && m.sharedCategoryId && m.contributionAccountId);

    if (!isConfigured) {
      this.elements.consistencyNotConfigured.style.display = 'block';
      this.elements.consistencyContent?.style && (this.elements.consistencyContent.style.display = 'none');
      return;
    }

    this.elements.consistencyNotConfigured.style.display = 'none';
    this.elements.consistencyContent?.style && (this.elements.consistencyContent.style.display = 'block');

    // Set default selected member
    if (!this.state.selectedMember && config.members.length > 0) {
      this.state.selectedMember = config.members[0].name;
    }

    // Initialize balancing form
    this.populateMemberDropdowns(config.members);
    if (this.elements.balancingDate) {
      this.elements.balancingDate.value = new Date().toISOString().split('T')[0];
    }

    if (Object.keys(this.state.transactions.shared).length === 0) {
      this.loadData();
    } else {
      this.renderAll();
    }
  },

  // Balancing form methods
  populateMemberDropdowns(members) {
    const options = members.map((m, i) =>
      `<option value="${i}">${Utils.escapeHtml(m.name)}</option>`
    ).join('');

    if (this.elements.balancingFrom) {
      this.elements.balancingFrom.innerHTML = '<option value="">Select member...</option>' + options;
    }
    if (this.elements.balancingTo) {
      this.elements.balancingTo.innerHTML = '<option value="">Select member...</option>' + options;
    }
  },

  async onFromMemberChange() {
    const fromIndex = this.elements.balancingFrom?.value;
    await this.loadMemberAccounts(fromIndex, this.elements.balancingFromAccount);
    this.checkSettlePhaseTransition();
    this.updateBalancingPreview();
  },

  async onToMemberChange() {
    const toIndex = this.elements.balancingTo?.value;
    await this.loadMemberAccounts(toIndex, this.elements.balancingToAccount);
    this.checkSettlePhaseTransition();
    this.updateBalancingPreview();
  },

  checkSettlePhaseTransition() {
    const fromIndex = this.elements.balancingFrom?.value;
    const toIndex = this.elements.balancingTo?.value;

    if (fromIndex === '' || toIndex === '' || fromIndex === toIndex) return;

    const config = Store.getConfig();
    const fromMember = config.members[parseInt(fromIndex)];
    const toMember = config.members[parseInt(toIndex)];
    if (!fromMember || !toMember) return;

    // Calculate suggested amount from contribution account balances
    const fromBalance = this.state.accountBalances?.[fromMember.name] || 0;
    const toBalance = this.state.accountBalances?.[toMember.name] || 0;
    const difference = fromBalance - toBalance;
    const suggestedAmount = Math.abs(difference) / 2;

    // Auto-populate amount if not already set
    if (!this.elements.balancingAmount?.value) {
      this.elements.balancingAmount.value = suggestedAmount > 0 ? suggestedAmount.toFixed(2) : '';
    }

    // Show phase 2
    if (this.elements.settlePhase2) {
      this.elements.settlePhase2.style.display = '';
    }
  },

  async loadMemberAccounts(memberIndex, selectElement) {
    if (!selectElement) return;

    if (memberIndex === '' || memberIndex === undefined) {
      selectElement.innerHTML = '<option value="">Select member first...</option>';
      selectElement.disabled = true;
      return;
    }

    const config = Store.getConfig();
    const member = config.members[parseInt(memberIndex)];
    if (!member) return;

    // Check cache first
    if (this.state.memberAccounts[memberIndex]) {
      this.populateAccountSelect(selectElement, this.state.memberAccounts[memberIndex]);
      return;
    }

    selectElement.innerHTML = '<option value="">Loading accounts...</option>';
    selectElement.disabled = true;

    try {
      const accounts = await YnabClient.getAccounts(member.budgetId);
      const budgetAccounts = accounts.filter(a => !a.closed && a.on_budget);
      this.state.memberAccounts[memberIndex] = budgetAccounts;
      this.populateAccountSelect(selectElement, budgetAccounts);
    } catch (error) {
      console.error('Failed to load accounts:', error);
      selectElement.innerHTML = '<option value="">Failed to load accounts</option>';
    }
  },

  populateAccountSelect(selectElement, accounts) {
    const options = accounts.map(a =>
      `<option value="${a.id}">${Utils.escapeHtml(a.name)}</option>`
    ).join('');
    selectElement.innerHTML = '<option value="">Select account...</option>' + options;
    selectElement.disabled = false;
  },

  updateBalancingPreview() {
    if (!this.elements.balancingPreview) return;

    const config = Store.getConfig();
    const amount = parseFloat(this.elements.balancingAmount?.value) || 0;
    const fromIndex = this.elements.balancingFrom?.value;
    const toIndex = this.elements.balancingTo?.value;
    const fromAccountId = this.elements.balancingFromAccount?.value;
    const toAccountId = this.elements.balancingToAccount?.value;

    if (!amount || fromIndex === '' || toIndex === '' || fromIndex === toIndex) {
      this.elements.balancingPreview.innerHTML = '';
      if (this.elements.createBalancingBtn) this.elements.createBalancingBtn.disabled = true;
      return;
    }

    const fromMember = config.members[parseInt(fromIndex)];
    const toMember = config.members[parseInt(toIndex)];

    if (!fromMember || !toMember) {
      this.elements.balancingPreview.innerHTML = '';
      if (this.elements.createBalancingBtn) this.elements.createBalancingBtn.disabled = true;
      return;
    }

    if (!fromMember.balancingCategoryId || !toMember.balancingCategoryId) {
      this.elements.balancingPreview.innerHTML = `
        <div class="balancing-preview-error">
          Both members must have a balancing category configured in Settings.
        </div>
      `;
      if (this.elements.createBalancingBtn) this.elements.createBalancingBtn.disabled = true;
      return;
    }

    if (!fromAccountId || !toAccountId) {
      this.elements.balancingPreview.innerHTML = `
        <div class="balancing-preview-error">
          Please select accounts for both members.
        </div>
      `;
      if (this.elements.createBalancingBtn) this.elements.createBalancingBtn.disabled = true;
      return;
    }

    const fromAccounts = this.state.memberAccounts[fromIndex] || [];
    const toAccounts = this.state.memberAccounts[toIndex] || [];
    const fromAccount = fromAccounts.find(a => a.id === fromAccountId);
    const toAccount = toAccounts.find(a => a.id === toAccountId);

    const formattedAmount = Utils.formatCurrency(amount);

    // Get current contribution account balances
    const fromContribBalance = this.state.accountBalances?.[fromMember.name] || 0;
    const toContribBalance = this.state.accountBalances?.[toMember.name] || 0;

    // Calculate new balances after transaction
    const fromNewBalance = fromContribBalance - amount;
    const toNewBalance = toContribBalance + amount;

    const html = `
      <div class="settle-preview-compact">
        <div class="settle-preview-headline">
          <strong>${Utils.escapeHtml(fromMember.name)}</strong> pays <strong>${Utils.escapeHtml(toMember.name)}</strong> <strong>${formattedAmount}</strong>
        </div>
        <div class="balancing-balance-preview">
          <div class="balance-preview-title">Contribution account balances:</div>
          <div class="balance-preview-row">
            <span class="balance-preview-name">${Utils.escapeHtml(fromMember.name)}:</span>
            <span class="balance-preview-current">${Utils.formatCurrency(fromContribBalance)}</span>
            <span class="balance-preview-arrow">→</span>
            <span class="balance-preview-new ${fromNewBalance >= 0 ? 'positive' : 'negative'}">${Utils.formatCurrency(fromNewBalance)}</span>
          </div>
          <div class="balance-preview-row">
            <span class="balance-preview-name">${Utils.escapeHtml(toMember.name)}:</span>
            <span class="balance-preview-current">${Utils.formatCurrency(toContribBalance)}</span>
            <span class="balance-preview-arrow">→</span>
            <span class="balance-preview-new ${toNewBalance >= 0 ? 'positive' : 'negative'}">${Utils.formatCurrency(toNewBalance)}</span>
          </div>
        </div>
        <div class="settle-preview-note">4 transactions will be created across personal and shared budgets</div>
      </div>
    `;

    this.elements.balancingPreview.innerHTML = html;
    if (this.elements.createBalancingBtn) this.elements.createBalancingBtn.disabled = false;
  },

  async createBalancingTransaction() {
    if (this._busy) return;
    this._busy = true;
    try {
    const config = Store.getConfig();
    const amount = parseFloat(this.elements.balancingAmount?.value) || 0;
    const fromIndex = parseInt(this.elements.balancingFrom?.value);
    const toIndex = parseInt(this.elements.balancingTo?.value);
    const fromAccountId = this.elements.balancingFromAccount?.value;
    const toAccountId = this.elements.balancingToAccount?.value;
    const date = this.elements.balancingDate?.value;
    const userMemo = this.elements.balancingMemo?.value || '';

    if (!amount || isNaN(fromIndex) || isNaN(toIndex) || !date || !fromAccountId || !toAccountId) {
      Utils.showToast('Please fill in all fields', 'error');
      return;
    }

    const fromMember = config.members[fromIndex];
    const toMember = config.members[toIndex];
    const amountMilliunits = YnabClient.toMilliunits(amount);

    const fromAccounts = this.state.memberAccounts[fromIndex] || [];
    const toAccounts = this.state.memberAccounts[toIndex] || [];
    const fromAccount = fromAccounts.find(a => a.id === fromAccountId);
    const toAccount = toAccounts.find(a => a.id === toAccountId);

    const linkId = this.generateBalancingId();
    const memo = this.appendIdToMemo(userMemo, linkId);

    const confirmed = await Utils.confirm({
      title: 'Create Settle-Up Transactions',
      html: `
        <p><strong>${Utils.escapeHtml(fromMember.name)}</strong> pays <strong>${Utils.escapeHtml(toMember.name)}</strong> <strong>${Utils.formatCurrency(amount)}</strong></p>
        <div class="confirm-detail-list">
          <div class="confirm-detail-item">
            <span class="detail-label">${Utils.escapeHtml(fromMember.name)} — Personal<br><small>${fromAccount?.name || 'N/A'}</small></span>
            <span class="detail-value text-danger">-${Utils.formatCurrency(amount)}</span>
          </div>
          <div class="confirm-detail-item">
            <span class="detail-label">${Utils.escapeHtml(toMember.name)} — Personal<br><small>${toAccount?.name || 'N/A'}</small></span>
            <span class="detail-value text-success">+${Utils.formatCurrency(amount)}</span>
          </div>
          <div class="confirm-detail-item">
            <span class="detail-label">Shared Budget<br><small>Transfer: ${Utils.escapeHtml(fromMember.name)} → ${Utils.escapeHtml(toMember.name)}</small></span>
            <span class="detail-value">${Utils.formatCurrency(amount)}</span>
          </div>
        </div>
        <p>Date: <strong>${Utils.escapeHtml(date)}</strong></p>
      `,
      confirmText: 'Create Transactions',
      cancelText: 'Cancel'
    });

    if (!confirmed) return;

    if (this.elements.createBalancingBtn) {
      this.elements.createBalancingBtn.disabled = true;
      this.elements.createBalancingBtn.textContent = 'Creating...';
    }

    try {
      // Check if budget adjustment is needed for fromMember
      const fromCategoryBal = this.state.categoryBalances?.[fromMember.name];
      if (fromCategoryBal && fromCategoryBal.balancing < amount) {
        // Need to move budget from shared expenses to balancing
        const amountToMove = amount - fromCategoryBal.balancing;
        const currentMonth = this.state.currentMonth;

        if (fromCategoryBal.shared < amountToMove) {
          Utils.showToast('Insufficient budget to settle this amount', 'error');
          return;
        }

        // Update budgets: reduce shared, increase balancing
        const newSharedBudgeted = YnabClient.toMilliunits(fromCategoryBal.sharedBudgeted - amountToMove);
        const newBalancingBudgeted = YnabClient.toMilliunits(fromCategoryBal.balancingBudgeted + amountToMove);

        await YnabClient.updateCategoryBudget(
          fromMember.budgetId,
          currentMonth,
          fromMember.sharedCategoryId,
          newSharedBudgeted
        );

        await YnabClient.updateCategoryBudget(
          fromMember.budgetId,
          currentMonth,
          fromMember.balancingCategoryId,
          newBalancingBudgeted
        );

        Utils.showToast(`Moved ${Utils.formatCurrency(amountToMove)} from Shared Expenses to Balancing`, 'info');
      }

      // Create the 4 linked transactions
      await YnabClient.createTransaction(fromMember.budgetId, {
        account_id: fromAccountId,
        date: date,
        amount: -amountMilliunits,
        category_id: fromMember.balancingCategoryId,
        payee_name: `Balancing to ${toMember.name}`,
        memo: memo,
        cleared: 'cleared',
        approved: true
      });

      await YnabClient.createTransaction(toMember.budgetId, {
        account_id: toAccountId,
        date: date,
        amount: amountMilliunits,
        category_id: toMember.balancingCategoryId,
        payee_name: `Balancing from ${fromMember.name}`,
        memo: memo,
        cleared: 'cleared',
        approved: true
      });

      // Create a TRANSFER in shared budget (single transaction, YNAB creates matching entry)
      // Get the destination account's transfer_payee_id
      const destAccount = this.state.sharedAccounts.find(a => a.id === toMember.contributionAccountId);
      if (!destAccount || !destAccount.transfer_payee_id) {
        throw new Error(`Could not find transfer payee for ${toMember.name}'s contribution account`);
      }

      await YnabClient.createTransaction(config.sharedBudgetId, {
        account_id: fromMember.contributionAccountId,
        date: date,
        amount: -amountMilliunits,
        payee_id: destAccount.transfer_payee_id,  // This makes it a transfer
        memo: memo,
        cleared: 'cleared',
        approved: true
      });

      Utils.showToast('Settle-up transactions created successfully', 'success');

      // Reset form
      if (this.elements.balancingAmount) this.elements.balancingAmount.value = '';
      if (this.elements.balancingFrom) this.elements.balancingFrom.value = '';
      if (this.elements.balancingFromAccount) {
        this.elements.balancingFromAccount.innerHTML = '<option value="">Select member first...</option>';
        this.elements.balancingFromAccount.disabled = true;
      }
      if (this.elements.balancingTo) this.elements.balancingTo.value = '';
      if (this.elements.balancingToAccount) {
        this.elements.balancingToAccount.innerHTML = '<option value="">Select member first...</option>';
        this.elements.balancingToAccount.disabled = true;
      }
      if (this.elements.balancingMemo) this.elements.balancingMemo.value = '';
      if (this.elements.balancingPreview) this.elements.balancingPreview.innerHTML = '';

      // Close the modal
      this.closeSettleModal();

      // Invalidate caches and reload
      DataService.invalidateBudgetCache(fromMember.budgetId);
      DataService.invalidateBudgetCache(toMember.budgetId);
      DataService.invalidateBudgetCache(config.sharedBudgetId);

      await this.loadData(true);

    } catch (error) {
      console.error('Failed to create balancing transactions:', error);
      Utils.showToast(`Failed to create transactions: ${error.message}`, 'error');
    } finally {
      if (this.elements.createBalancingBtn) {
        this.elements.createBalancingBtn.disabled = false;
        this.elements.createBalancingBtn.textContent = 'Create Balancing Transactions';
      }
    }
    } finally {
      this._busy = false;
    }
  },

  async loadData(forceRefresh = false) {
    const config = Store.getConfig();
    if (this.state.loading) return;

    this.state.loading = true;
    this.showLoading(true);

    try {
      // Store cutoff date in state for rendering
      this.state.cutoffDate = config.consistencyCutoffDate || '2020-01-01';

      // OPTIMIZATION: Use DataService for cached transactions
      // Load ALL transactions (DataService uses 2-year default), don't filter by cutoff
      // We'll display all but grey out those before cutoff
      // DataService now writes to Store, which computes linkedPairs automatically
      const personalTxns = {};
      for (const member of config.members) {
        // Load transactions from shared expenses category
        const sharedCategoryTxns = await DataService.getTransactions(member.budgetId, {
          categoryId: member.sharedCategoryId,
          forceRefresh
        });

        // Load transactions from balancing category (if configured)
        const balancingCategoryTxns = member.balancingCategoryId
          ? await DataService.getTransactions(member.budgetId, {
              categoryId: member.balancingCategoryId,
              forceRefresh
            })
          : [];

        // Combine both (use Set to avoid duplicates by transaction ID)
        const seenIds = new Set();
        const combinedTxns = [];
        [...sharedCategoryTxns, ...balancingCategoryTxns].forEach(txn => {
          if (!seenIds.has(txn.id)) {
            seenIds.add(txn.id);
            combinedTxns.push(txn);
          }
        });

        personalTxns[member.name] = combinedTxns.map(t => ({
          ...t,
          memberName: member.name,
          memberId: member.budgetId,
          source: 'personal',
          isBeforeCutoff: t.date < this.state.cutoffDate
        }));
      }

      // Load shared budget transactions (contribution accounts) - grouped by member
      const sharedTxns = {};
      for (const member of config.members) {
        const txns = await DataService.getTransactions(config.sharedBudgetId, {
          accountId: member.contributionAccountId,
          forceRefresh
        });
        sharedTxns[member.name] = txns.map(t => ({
          ...t,
          memberName: member.name,
          accountId: member.contributionAccountId,
          source: 'shared',
          isBeforeCutoff: t.date < this.state.cutoffDate
        }));
      }

      this.state.transactions.personal = personalTxns;
      this.state.transactions.shared = sharedTxns;

      // Load balances for display in column headers
      await this.loadBalances(config, forceRefresh);

      // Sync computed state from Store (Store computes linkedPairs when DataService updates)
      this.state.linkedPairs = Store.state.linkedPairs || [];
      this.state.unlinkedPersonal = Store.state.unlinkedPersonal || {};
      this.state.unlinkedShared = Store.state.unlinkedShared || {};
      this.state.linkedPersonal = Store.state.linkedPersonal || {};
      this.state.linkedShared = Store.state.linkedShared || {};

      this.renderAll();

    } catch (error) {
      console.error('Failed to load consistency data:', error);
      Utils.showToast(`Failed to load data: ${error.message}`, 'error');
    } finally {
      this.state.loading = false;
      this.showLoading(false);
    }
  },

  async loadBalances(config, forceRefresh) {
    const currentMonth = new Date().toISOString().slice(0, 7) + '-01';
    this.state.currentMonth = currentMonth;

    // Load category balances for each member's personal budget
    this.state.categoryBalances = {};
    for (const member of config.members) {
      try {
        const monthData = await DataService.getMonthData(member.budgetId, currentMonth);
        const categories = monthData?.categories || [];

        // Find shared expenses category balance
        const sharedCategory = categories.find(c => c.id === member.sharedCategoryId);
        // Find balancing category balance
        const balancingCategory = categories.find(c => c.id === member.balancingCategoryId);

        this.state.categoryBalances[member.name] = {
          shared: sharedCategory ? YnabClient.fromMilliunits(sharedCategory.balance) : 0,
          sharedBudgeted: sharedCategory ? YnabClient.fromMilliunits(sharedCategory.budgeted) : 0,
          balancing: balancingCategory ? YnabClient.fromMilliunits(balancingCategory.balance) : 0,
          balancingBudgeted: balancingCategory ? YnabClient.fromMilliunits(balancingCategory.budgeted) : 0
        };
      } catch (error) {
        console.warn(`Failed to load category balances for ${member.name}:`, error);
        this.state.categoryBalances[member.name] = { shared: 0, sharedBudgeted: 0, balancing: 0, balancingBudgeted: 0 };
      }
    }

    // Load contribution account balances from shared budget
    this.state.accountBalances = {};
    this.state.sharedAccounts = [];
    try {
      const accounts = await YnabClient.getAccounts(config.sharedBudgetId);
      this.state.sharedAccounts = accounts;  // Store for transfer_payee_id lookup
      for (const member of config.members) {
        const account = accounts.find(a => a.id === member.contributionAccountId);
        this.state.accountBalances[member.name] = account
          ? YnabClient.fromMilliunits(account.balance)
          : 0;
      }
    } catch (error) {
      console.warn('Failed to load account balances:', error);
      config.members.forEach(m => {
        this.state.accountBalances[m.name] = 0;
      });
    }
  },

  analyzeLinks() {
    const config = Store.getConfig();

    // Group all transactions by their ID
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

    // Process personal transactions
    Object.entries(this.state.transactions.personal).forEach(([memberName, txns]) => {
      // Ensure arrays exist for this member (in case of name mismatch)
      if (!linkedPersonal[memberName]) linkedPersonal[memberName] = [];
      if (!unlinkedPersonal[memberName]) unlinkedPersonal[memberName] = [];

      txns.forEach(txn => {
        const id = this.extractId(txn.memo);
        if (id) {
          if (!byId[id]) byId[id] = { personal: {}, shared: [] };
          if (!byId[id].personal[memberName]) byId[id].personal[memberName] = [];
          byId[id].personal[memberName].push(txn);
          // Also track linked transactions for display
          linkedPersonal[memberName].push({ ...txn, linkId: id });
        } else {
          unlinkedPersonal[memberName].push(txn);
        }
      });
    });

    // Process shared transactions
    Object.entries(this.state.transactions.shared).forEach(([memberName, txns]) => {
      // Ensure arrays exist for this member (in case of name mismatch)
      if (!linkedShared[memberName]) linkedShared[memberName] = [];
      if (!unlinkedShared[memberName]) unlinkedShared[memberName] = [];

      txns.forEach(txn => {
        const id = this.extractId(txn.memo);
        if (id) {
          if (!byId[id]) byId[id] = { personal: {}, shared: [] };
          byId[id].shared.push(txn);
          // Also track linked transactions for display
          linkedShared[memberName].push({ ...txn, linkId: id });
        } else {
          unlinkedShared[memberName].push(txn);
        }
      });
    });

    // Convert byId to linkedPairs array
    const linkedPairs = Object.entries(byId).map(([id, group]) => ({
      id,
      isBalancing: this.isBalancingId(id),
      isMonthly: this.isMonthlyId(id),
      monthlyInfo: this.parseMonthlyId(id),
      personal: group.personal,
      shared: group.shared,
      isComplete: this.isLinkComplete(id, group)
    }));

    // Sort by date (most recent first)
    linkedPairs.sort((a, b) => {
      const aDate = this.getGroupLatestDate(a);
      const bDate = this.getGroupLatestDate(b);
      return bDate.localeCompare(aDate);
    });

    // Sort unlinked by date (most recent first)
    Object.keys(unlinkedPersonal).forEach(member => {
      unlinkedPersonal[member].sort((a, b) => b.date.localeCompare(a.date));
    });
    Object.keys(unlinkedShared).forEach(member => {
      unlinkedShared[member].sort((a, b) => b.date.localeCompare(a.date));
    });
    // Sort linked by date (most recent first)
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

    // Count transaction types for summary
    this.state.balancingCount = linkedPairs.filter(p => p.isBalancing).length;
    this.state.monthlyCount = linkedPairs.filter(p => p.isMonthly).length;
  },

  isLinkComplete(id, group) {
    const config = Store.getConfig();
    const memberCount = config.members.length;

    if (this.isBalancingId(id)) {
      const personalCount = Object.values(group.personal).flat().length;
      return personalCount === memberCount && group.shared.length === memberCount;
    } else if (this.isMonthlyId(id)) {
      return group.shared.length >= 1;
    } else {
      const hasPersonal = Object.values(group.personal).flat().length >= 1;
      const hasShared = group.shared.length >= 1;
      return hasPersonal && hasShared;
    }
  },

  // Get details about what's missing from an incomplete link
  getMissingDetails(id, group) {
    const config = Store.getConfig();
    const missing = [];

    if (this.isBalancingId(id)) {
      // Balancing needs transactions for each member in both personal and shared
      config.members.forEach(m => {
        if (!group.personal[m.name] || group.personal[m.name].length === 0) {
          missing.push(`${m.name} personal`);
        }
        if (!group.shared.some(t => t.memberName === m.name)) {
          missing.push(`${m.name} shared`);
        }
      });
    } else if (this.isMonthlyId(id)) {
      if (group.shared.length === 0) {
        missing.push('shared transaction');
      }
    } else {
      // Regular link needs at least one personal and one shared
      if (Object.values(group.personal).flat().length === 0) {
        missing.push('personal');
      }
      if (group.shared.length === 0) {
        missing.push('shared');
      }
    }

    return missing;
  },

  // Get the link type badge HTML
  getLinkTypeBadge(pair) {
    if (pair.isBalancing) {
      return '<span class="link-type-badge type-balancing"><span class="link-type-icon">&#9878;</span> Balancing</span>';
    } else if (pair.isMonthly) {
      const info = this.parseMonthlyId(pair.id);
      const monthName = info ? new Date(info.year, info.month - 1).toLocaleDateString('en-US', { month: 'short' }) : '';
      return `<span class="link-type-badge type-monthly"><span class="link-type-icon">&#128197;</span> ${monthName} ${info?.year || ''}</span>`;
    } else {
      return '<span class="link-type-badge type-regular">Expense</span>';
    }
  },

  getGroupLatestDate(group) {
    let latest = '1900-01-01';
    Object.values(group.personal).flat().forEach(t => {
      if (t.date > latest) latest = t.date;
    });
    group.shared.forEach(t => {
      if (t.date > latest) latest = t.date;
    });
    return latest;
  },

  showLoading(show) {
    if (this.elements.consistencyLoading) {
      this.elements.consistencyLoading.style.display = show ? 'block' : 'none';
    }
  },

  renderAll() {
    this.renderMemberTabs();
    this.renderSummary();
    this.renderBalances();
    this.renderTransactionColumns();
    this.renderLinkedPairs();
  },

  renderBalances() {
    const member = this.state.selectedMember;
    const categoryBal = this.state.categoryBalances?.[member] || { shared: 0, balancing: 0, sharedBudgeted: 0, balancingBudgeted: 0 };
    const accountBal = this.state.accountBalances?.[member] || 0;

    // Personal balances (left column)
    if (this.elements.personalBalances) {
      const sharedClass = categoryBal.shared >= 0 ? 'positive' : 'negative';
      const balancingClass = categoryBal.balancing >= 0 ? 'positive' : 'negative';

      // Determine transfer button state
      // If balancing is negative: offer to move from Shared to Balancing (to fix)
      // If balancing is positive: offer to move from Balancing to Shared (to return)
      const balancingIsNegative = categoryBal.balancing < 0;
      const balancingIsPositive = categoryBal.balancing > 0;
      const amountToTransfer = Math.abs(categoryBal.balancing);

      let transferButton = '';
      let transferDirection = null; // 'toBalancing' or 'toShared'

      if (balancingIsNegative) {
        // Need to move from Shared to Balancing
        const canFix = categoryBal.shared >= amountToTransfer;
        transferDirection = 'toBalancing';
        transferButton = `
          <button class="btn-fix-balance ${canFix ? '' : 'disabled'}"
                  data-direction="toBalancing"
                  ${canFix ? '' : 'disabled'}
                  title="${canFix ? `Move ${Utils.formatCurrency(amountToTransfer)} from Shared to Balancing` : 'Not enough in Shared Expenses'}">
            ← Fix
          </button>
        `;
      } else if (balancingIsPositive) {
        // Can move from Balancing back to Shared
        transferDirection = 'toShared';
        transferButton = `
          <button class="btn-fix-balance btn-return"
                  data-direction="toShared"
                  title="Move ${Utils.formatCurrency(amountToTransfer)} from Balancing to Shared">
            → Return
          </button>
        `;
      }

      this.elements.personalBalances.innerHTML = `
        <div class="balance-row">
          <span class="balance-label">Shared:</span>
          <span class="balance-value ${sharedClass}">${Utils.formatCurrency(categoryBal.shared)}</span>
        </div>
        <div class="balance-row">
          <span class="balance-label">Balancing:</span>
          <span class="balance-value ${balancingClass}">${Utils.formatCurrency(categoryBal.balancing)}</span>
          ${transferButton}
        </div>
      `;

      // Bind transfer button event
      const btn = this.elements.personalBalances.querySelector('.btn-fix-balance:not(.disabled)');
      if (btn) {
        btn.addEventListener('click', () => {
          const direction = btn.dataset.direction;
          this.transferBudget(member, amountToTransfer, direction);
        });
      }
    }

    // Shared budget account balance (right column)
    if (this.elements.sharedBalances) {
      const accountClass = accountBal >= 0 ? 'positive' : 'negative';

      this.elements.sharedBalances.innerHTML = `
        <div class="balance-row">
          <span class="balance-label">Balance:</span>
          <span class="balance-value ${accountClass}">${Utils.formatCurrency(accountBal)}</span>
        </div>
      `;
    }
  },

  // Transfer budget between Shared Expenses and Balancing categories
  async transferBudget(memberName, amountToMove, direction) {
    if (this._busy) return;
    this._busy = true;
    try {
    const config = Store.getConfig();
    const member = config.members.find(m => m.name === memberName);
    if (!member) return;

    const categoryBal = this.state.categoryBalances?.[memberName];
    if (!categoryBal) return;

    const fromCategory = direction === 'toBalancing' ? 'Shared Expenses' : 'Balancing';
    const toCategory = direction === 'toBalancing' ? 'Balancing' : 'Shared Expenses';

    const confirmed = await Utils.confirm({
      title: 'Move Budget',
      message: `Move ${Utils.formatCurrency(amountToMove)} from ${fromCategory} to ${toCategory} for ${memberName}?`,
      confirmText: 'Move',
      cancelText: 'Cancel'
    });

    if (!confirmed) return;

    try {
      const currentMonth = this.state.currentMonth;

      let newSharedBudgeted, newBalancingBudgeted;

      if (direction === 'toBalancing') {
        // Move from Shared to Balancing
        newSharedBudgeted = YnabClient.toMilliunits(categoryBal.sharedBudgeted - amountToMove);
        newBalancingBudgeted = YnabClient.toMilliunits(categoryBal.balancingBudgeted + amountToMove);
      } else {
        // Move from Balancing to Shared
        newSharedBudgeted = YnabClient.toMilliunits(categoryBal.sharedBudgeted + amountToMove);
        newBalancingBudgeted = YnabClient.toMilliunits(categoryBal.balancingBudgeted - amountToMove);
      }

      // Update shared expenses budget
      await YnabClient.updateCategoryBudget(
        member.budgetId,
        currentMonth,
        member.sharedCategoryId,
        newSharedBudgeted
      );

      // Update balancing budget
      await YnabClient.updateCategoryBudget(
        member.budgetId,
        currentMonth,
        member.balancingCategoryId,
        newBalancingBudgeted
      );

      Utils.showToast(`Moved ${Utils.formatCurrency(amountToMove)} to ${toCategory}`, 'success');

      // Reload balances to reflect changes
      await this.loadBalances(config, true);
      this.renderBalances();

    } catch (error) {
      console.error('Failed to transfer budget:', error);
      Utils.showToast(`Failed to update budget: ${error.message}`, 'error');
    }
    } finally {
      this._busy = false;
    }
  },

  renderMemberTabs() {
    const config = Store.getConfig();

    const tabs = config.members.map(member => {
      const unlinkedCount =
        (this.state.unlinkedPersonal[member.name] || []).filter(t => !t.isBeforeCutoff).length +
        (this.state.unlinkedShared[member.name] || []).filter(t => !t.isBeforeCutoff).length;
      const isActive = this.state.selectedMember === member.name;

      return `
        <button class="member-tab ${isActive ? 'active' : ''}" data-member="${Utils.escapeHtml(member.name)}">
          ${Utils.escapeHtml(member.name)}
          ${unlinkedCount > 0 ? `<span class="tab-badge">${unlinkedCount}</span>` : ''}
        </button>
      `;
    }).join('');

    this.elements.memberTabs.innerHTML = tabs;

    // Bind click events
    this.elements.memberTabs.querySelectorAll('.member-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.state.selectedMember = tab.dataset.member;
        this.cancelLinking();
        this.renderAll();
      });
    });
  },

  renderSummary() {
    const member = this.state.selectedMember;
    const cutoffDate = this.state.cutoffDate || '2020-01-01';

    // Count only transactions AFTER cutoff date for unlinked counts
    const personalCount = (this.state.unlinkedPersonal[member] || []).filter(t => !t.isBeforeCutoff).length;
    const sharedCount = (this.state.unlinkedShared[member] || []).filter(t => !t.isBeforeCutoff).length;
    const totalLinked = this.state.linkedPairs.filter(p =>
      p.personal[member]?.length > 0 || p.shared.some(t => t.memberName === member)
    ).length;

    // Format cutoff date for display
    const cutoffFormatted = new Date(cutoffDate + 'T00:00:00').toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric'
    });

    const html = `
      <div class="consistency-summary-header">
        <span class="summary-since">Since ${cutoffFormatted}</span>
      </div>
      <div class="consistency-stats">
        <div class="stat-item ${personalCount > 0 ? 'warning' : 'success'}">
          <span class="stat-number">${personalCount}</span>
          <span class="stat-label">Unlinked in Personal Budget</span>
        </div>
        <div class="stat-item ${sharedCount > 0 ? 'warning' : 'success'}">
          <span class="stat-number">${sharedCount}</span>
          <span class="stat-label">Unlinked in Shared Budget</span>
        </div>
        <div class="stat-item">
          <span class="stat-number">${totalLinked}</span>
          <span class="stat-label">Linked Pairs</span>
        </div>
      </div>
      <div class="consistency-filter">
        <label class="filter-toggle">
          <input type="checkbox" id="filter-unmatched" ${this.state.filterUnmatched ? 'checked' : ''}>
          <span>Show only unmatched</span>
        </label>
      </div>
    `;

    this.elements.consistencySummary.innerHTML = html;

    // Bind filter toggle
    const filterCheckbox = document.getElementById('filter-unmatched');
    filterCheckbox?.addEventListener('change', (e) => {
      this.state.filterUnmatched = e.target.checked;
      Storage.set('consistency_filter_unmatched', this.state.filterUnmatched);
      this.renderTransactionColumns();
    });
  },

  renderTransactionColumns() {
    this.renderPersonalColumn();
    this.renderSharedColumn();
  },

  renderPersonalColumn() {
    const member = this.state.selectedMember;
    const unlinkedTxns = this.state.unlinkedPersonal[member] || [];
    const linkedTxns = this.state.linkedPersonal[member] || [];

    // Combine all transactions and sort by date (most recent first)
    let allTransactions = [
      ...unlinkedTxns.map(t => ({ ...t, isLinked: false })),
      ...linkedTxns.map(t => ({ ...t, isLinked: true }))
    ].sort((a, b) => b.date.localeCompare(a.date));

    // Apply filter: show only unmatched (not linked, not before cutoff)
    if (this.state.filterUnmatched) {
      allTransactions = allTransactions.filter(t => !t.isLinked && !t.isBeforeCutoff);
    }

    if (allTransactions.length === 0) {
      this.elements.personalTransactions.innerHTML = `
        <div class="empty-state">
          <p>No transactions found</p>
        </div>
      `;
      return;
    }

    const rows = allTransactions.map(txn => {
      const isSelected = this.state.selectedPersonalTxn?.id === txn.id;
      const isBeforeCutoff = txn.isBeforeCutoff;
      const isLinked = txn.isLinked;
      const linkType = isLinked ? this.getLinkTypeClass(txn.linkId) : '';
      const isBalancing = isLinked && this.isBalancingId(txn.linkId);

      // Show delete button for balancing transactions (not before cutoff)
      const showDelete = isBalancing && !isBeforeCutoff;

      return `
        <div class="txn-row ${isSelected ? 'selected' : ''} ${isBeforeCutoff ? 'before-cutoff' : ''} ${isLinked ? 'linked' : ''} ${linkType}"
             data-txn-id="${txn.id}" data-source="personal" data-linked="${isLinked}" ${isLinked ? `data-link-id="${txn.linkId}"` : ''}>
          <div class="txn-main" data-action="select">
            <div class="txn-date">${this.formatDate(txn.date)}</div>
            <div class="txn-payee">
              ${Utils.escapeHtml(txn.payee_name || 'Unknown')}
              ${isLinked ? `<span class="txn-link-badge" title="#${txn.linkId}#">${this.getLinkTypeIcon(txn.linkId)}</span>` : ''}
            </div>
            <div class="txn-amount ${txn.amount < 0 ? 'outflow' : 'inflow'}">
              ${Utils.formatCurrency(YnabClient.fromMilliunits(Math.abs(txn.amount)))}
            </div>
          </div>
          <div class="txn-actions">
            ${!isLinked && !isBeforeCutoff ? `
              <button class="btn-txn-action btn-link" data-action="link" title="Link with existing shared transaction">
                <span>&#128279;</span>
              </button>
              <button class="btn-txn-action btn-copy" data-action="copy" title="Copy to shared budget">
                <span>&#128203;</span>
              </button>
            ` : ''}
            ${showDelete ? `
              <button class="btn-txn-action btn-delete" data-action="delete-balancing" title="Delete all balancing transactions">
                <span>&#128465;</span>
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');

    this.elements.personalTransactions.innerHTML = rows;
    this.bindPersonalColumnEvents();
  },

  // Helper to get link type class for styling
  getLinkTypeClass(linkId) {
    if (this.isBalancingId(linkId)) return 'link-balancing';
    if (this.isMonthlyId(linkId)) return 'link-monthly';
    return 'link-regular';
  },

  // Helper to get link type icon
  getLinkTypeIcon(linkId) {
    if (this.isBalancingId(linkId)) return '&#9878;';
    if (this.isMonthlyId(linkId)) return '&#128197;';
    return '&#128279;';
  },

  renderSharedColumn() {
    const member = this.state.selectedMember;
    const unlinkedTxns = this.state.unlinkedShared[member] || [];
    const linkedTxns = this.state.linkedShared[member] || [];

    // Combine all transactions and sort by date (most recent first)
    let allTransactions = [
      ...unlinkedTxns.map(t => ({ ...t, isLinked: false })),
      ...linkedTxns.map(t => ({ ...t, isLinked: true }))
    ].sort((a, b) => b.date.localeCompare(a.date));

    // Apply filter: show only unmatched (not linked, not before cutoff)
    if (this.state.filterUnmatched) {
      allTransactions = allTransactions.filter(t => !t.isLinked && !t.isBeforeCutoff);
    }

    if (allTransactions.length === 0) {
      this.elements.sharedTransactions.innerHTML = `
        <div class="empty-state">
          <p>No transactions found</p>
        </div>
      `;
      return;
    }

    const rows = allTransactions.map(txn => {
      const isBeforeCutoff = txn.isBeforeCutoff;
      const isLinked = txn.isLinked;
      const linkType = isLinked ? this.getLinkTypeClass(txn.linkId) : '';

      // Only allow linking for unlinked transactions after cutoff
      const canLink = this.state.linkingMode && !isLinked && !isBeforeCutoff && this.isGoodMatch(this.state.selectedPersonalTxn, txn);
      const isInflow = txn.amount > 0;

      // Show unlink button for linked transactions (not for before-cutoff)
      const showUnlink = isLinked && !isBeforeCutoff;
      // Show monthly button for unlinked inflows after cutoff
      const showMonthly = !isLinked && !isBeforeCutoff && isInflow;
      // Show delete button for all transactions after cutoff
      const showDelete = !isBeforeCutoff;

      return `
        <div class="txn-row ${canLink ? 'linkable' : ''} ${this.state.linkingMode && !isLinked && !canLink ? 'dimmed' : ''} ${isBeforeCutoff ? 'before-cutoff' : ''} ${isLinked ? 'linked' : ''} ${linkType}"
             data-txn-id="${txn.id}" data-source="shared" data-linked="${isLinked}" ${isLinked ? `data-link-id="${txn.linkId}"` : ''}>
          <div class="txn-main" data-action="link">
            <div class="txn-date">${this.formatDate(txn.date)}</div>
            <div class="txn-payee">
              ${Utils.escapeHtml(txn.payee_name || 'Unknown')}
              ${isLinked ? `<span class="txn-link-badge" title="#${txn.linkId}#">${this.getLinkTypeIcon(txn.linkId)}</span>` : ''}
            </div>
            <div class="txn-amount ${txn.amount < 0 ? 'outflow' : 'inflow'}">
              ${Utils.formatCurrency(YnabClient.fromMilliunits(Math.abs(txn.amount)))}
            </div>
          </div>
          <div class="txn-actions">
            ${showMonthly ? `
              <button class="btn-txn-action btn-monthly" data-action="monthly" title="Mark as Monthly Contribution">
                <span>M</span>
              </button>
            ` : ''}
            ${showUnlink ? `
              <button class="btn-txn-action btn-unlink" data-action="unlink" title="Remove link">
                <span>&#10005;</span>
              </button>
            ` : ''}
            ${showDelete ? `
              <button class="btn-txn-action btn-delete" data-action="delete" title="Delete from shared budget">
                <span>&#128465;</span>
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');

    this.elements.sharedTransactions.innerHTML = rows;
    this.bindSharedColumnEvents();
  },

  bindPersonalColumnEvents() {
    this.elements.personalTransactions.querySelectorAll('.txn-row').forEach(row => {
      const isLinked = row.dataset.linked === 'true';
      const linkId = row.dataset.linkId;

      // Link button - enters linking mode for this transaction
      row.querySelector('.btn-link')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const txnId = row.dataset.txnId;
        this.selectPersonalTransaction(txnId);
      });

      // Copy button - copies to shared budget
      row.querySelector('.btn-copy')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const txnId = row.dataset.txnId;
        this.duplicateToShared(txnId);
      });

      // Delete balancing button (deletes all 4 linked transactions)
      row.querySelector('[data-action="delete-balancing"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteBalancingFromPersonal(linkId);
      });

      // Hover highlighting for linked transactions
      if (isLinked && linkId) {
        row.addEventListener('mouseenter', () => this.highlightLinkedTransactions(linkId, true));
        row.addEventListener('mouseleave', () => this.highlightLinkedTransactions(linkId, false));
      }
    });
  },

  bindSharedColumnEvents() {
    this.elements.sharedTransactions.querySelectorAll('.txn-row').forEach(row => {
      const isLinked = row.dataset.linked === 'true';
      const isBeforeCutoff = row.classList.contains('before-cutoff');
      const linkId = row.dataset.linkId;

      row.querySelector('.txn-main').addEventListener('click', () => {
        if (!this.state.linkingMode) return;
        if (isLinked || isBeforeCutoff) return; // Don't allow linking linked or before-cutoff transactions

        const txnId = row.dataset.txnId;
        this.linkWithSelected(txnId);
      });

      // Monthly contribution button
      row.querySelector('.btn-monthly')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const txnId = row.dataset.txnId;
        this.showMonthlyPicker(txnId);
      });

      // Unlink button
      row.querySelector('.btn-unlink')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const txnId = row.dataset.txnId;
        this.unlinkTransaction(txnId, linkId);
      });

      // Delete button
      row.querySelector('.btn-delete')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const txnId = row.dataset.txnId;
        this.deleteSharedTransaction(txnId);
      });

      // Hover highlighting for linked transactions
      if (isLinked && linkId) {
        row.addEventListener('mouseenter', () => this.highlightLinkedTransactions(linkId, true));
        row.addEventListener('mouseleave', () => this.highlightLinkedTransactions(linkId, false));
      }
    });
  },

  // Highlight all transactions with the same link ID
  highlightLinkedTransactions(linkId, highlight) {
    const className = 'link-highlight';
    const selector = `[data-link-id="${linkId}"]`;

    // Find all matching transactions in both columns
    this.elements.personalTransactions.querySelectorAll(selector).forEach(row => {
      if (highlight) {
        row.classList.add(className);
      } else {
        row.classList.remove(className);
      }
    });

    this.elements.sharedTransactions.querySelectorAll(selector).forEach(row => {
      if (highlight) {
        row.classList.add(className);
      } else {
        row.classList.remove(className);
      }
    });
  },

  // Unlink a transaction by removing the link ID from its memo
  async unlinkTransaction(txnId, linkId) {
    if (this._busy) return;
    this._busy = true;
    try {
    const member = this.state.selectedMember;
    const config = Store.getConfig();

    // Find the transaction in linked shared
    const txn = this.state.linkedShared[member]?.find(t => t.id === txnId);
    if (!txn) {
      Utils.showToast('Transaction not found', 'error');
      return;
    }

    const confirmed = await Utils.confirm({
      title: 'Remove Link',
      html: `
        <p>Remove link from this transaction?</p>
        <div class="confirm-detail-list">
          <div class="confirm-detail-item">
            <span class="detail-label">${Utils.escapeHtml(txn.payee_name || 'Unknown')}<br><small>${txn.date}</small></span>
            <span class="detail-value"><code>#${Utils.escapeHtml(linkId)}#</code></span>
          </div>
        </div>
        <p>This will only remove the link from this shared budget transaction.</p>
      `,
      confirmText: 'Remove Link',
      cancelText: 'Cancel'
    });

    if (!confirmed) return;

    try {
      // Remove the link ID from the memo
      const newMemo = this.removeLinkFromMemo(txn.memo, linkId);

      await YnabClient.updateTransaction(config.sharedBudgetId, txn.id, {
        memo: newMemo
      });

      Utils.showToast('Link removed from transaction', 'success');

      // Update local state
      this.updateLocalTransactionMemo(txn.id, newMemo, 'shared');
      // Sync computed state from Store
      this.state.linkedPairs = Store.state.linkedPairs || [];
      this.state.unlinkedPersonal = Store.state.unlinkedPersonal || {};
      this.state.unlinkedShared = Store.state.unlinkedShared || {};
      this.state.linkedPersonal = Store.state.linkedPersonal || {};
      this.state.linkedShared = Store.state.linkedShared || {};
      this.renderAll();

    } catch (error) {
      console.error('Failed to unlink transaction:', error);
      Utils.showToast(`Failed to unlink: ${error.message}`, 'error');
    }
    } finally {
      this._busy = false;
    }
  },

  // Remove a link ID from a memo string
  removeLinkFromMemo(memo, linkId) {
    if (!memo) return '';
    // Match the pattern #linkId# with optional surrounding whitespace
    const pattern = new RegExp(`\\s*#${linkId}#\\s*`, 'g');
    return memo.replace(pattern, ' ').trim();
  },

  // Delete a transaction from the shared budget
  // If it's a balancing transaction, delete all linked transactions across all budgets
  async deleteSharedTransaction(txnId) {
    if (this._busy) return;
    this._busy = true;
    try {
    const member = this.state.selectedMember;
    const config = Store.getConfig();

    // Find the transaction in either linked or unlinked shared
    let txn = this.state.linkedShared[member]?.find(t => t.id === txnId);
    if (!txn) {
      txn = this.state.unlinkedShared[member]?.find(t => t.id === txnId);
    }

    if (!txn) {
      Utils.showToast('Transaction not found', 'error');
      return;
    }

    // Check if this is a balancing transaction
    const linkId = this.extractId(txn.memo);
    if (linkId && this.isBalancingId(linkId)) {
      // This is a balancing transaction - delete all linked transactions
      await this.deleteBalancingTransactionSet(linkId, txn);
      return;
    }

    // Regular transaction deletion (not balancing)
    const amount = Utils.formatCurrency(YnabClient.fromMilliunits(Math.abs(txn.amount)));
    const confirmed = await Utils.confirm({
      title: 'Delete Transaction',
      html: `
        <p>Delete this transaction from the shared budget?</p>
        <div class="confirm-detail-list">
          <div class="confirm-detail-item">
            <span class="detail-label">${Utils.escapeHtml(txn.payee_name || 'Unknown')}<br><small>${txn.date}</small></span>
            <span class="detail-value ${txn.amount < 0 ? 'text-danger' : 'text-success'}">${txn.amount < 0 ? '-' : ''}${amount}</span>
          </div>
        </div>
        <div class="confirm-warning">This action cannot be undone.</div>
      `,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      danger: true
    });

    if (!confirmed) return;

    try {
      await YnabClient.deleteTransaction(config.sharedBudgetId, txnId);

      Utils.showToast('Transaction deleted', 'success');

      // Update shared account balance locally (reverse the transaction amount)
      this.state.accountBalances[member] = (this.state.accountBalances[member] || 0)
        - YnabClient.fromMilliunits(txn.amount);

      // Remove from local state
      this.removeLocalTransaction(txnId, 'shared');
      // Sync computed state from Store
      this.state.linkedPairs = Store.state.linkedPairs || [];
      this.state.unlinkedPersonal = Store.state.unlinkedPersonal || {};
      this.state.unlinkedShared = Store.state.unlinkedShared || {};
      this.state.linkedPersonal = Store.state.linkedPersonal || {};
      this.state.linkedShared = Store.state.linkedShared || {};
      this.renderAll();

      // Invalidate cache to ensure fresh data on next load
      DataService.invalidateBudgetCache(config.sharedBudgetId);

    } catch (error) {
      console.error('Failed to delete transaction:', error);
      Utils.showToast(`Failed to delete: ${error.message}`, 'error');
    }
    } finally {
      this._busy = false;
    }
  },

  // Delete balancing transaction set from personal column
  async deleteBalancingFromPersonal(linkId) {
    if (this._busy) return;
    this._busy = true;
    try {
      if (!linkId) {
        Utils.showToast('Transaction not found', 'error');
        return;
      }

      // Find the linked pair for this balancing ID
      const linkedPair = this.state.linkedPairs.find(p => p.id === linkId);
      if (!linkedPair) {
        Utils.showToast('Could not find linked transactions', 'error');
        return;
      }

      // Delegate to the main delete method
      await this.deleteBalancingTransactionSet(linkId, null);
    } finally {
      this._busy = false;
    }
  },

  // Delete all transactions in a balancing set (all 4 linked transactions)
  async deleteBalancingTransactionSet(linkId, triggerTxn) {
    const config = Store.getConfig();

    // Find all linked transactions
    const linkedPair = this.state.linkedPairs.find(p => p.id === linkId);
    if (!linkedPair) {
      Utils.showToast('Could not find linked transactions', 'error');
      return;
    }

    // Collect all transactions to delete
    const transactionsToDelete = [];

    // Personal budget transactions
    Object.entries(linkedPair.personal).forEach(([memberName, txns]) => {
      const memberConfig = config.members.find(m => m.name === memberName);
      if (memberConfig) {
        txns.forEach(txn => {
          transactionsToDelete.push({
            budgetId: memberConfig.budgetId,
            txnId: txn.id,
            memberName,
            type: 'personal',
            date: txn.date,
            payee: txn.payee_name,
            amount: txn.amount
          });
        });
      }
    });

    // Shared budget transactions
    linkedPair.shared.forEach(txn => {
      transactionsToDelete.push({
        budgetId: config.sharedBudgetId,
        txnId: txn.id,
        memberName: txn.memberName,
        type: 'shared',
        date: txn.date,
        payee: txn.payee_name,
        amount: txn.amount
      });
    });

    if (transactionsToDelete.length === 0) {
      Utils.showToast('No linked transactions found', 'error');
      return;
    }

    // Build confirmation modal with transaction details
    const txnListHtml = transactionsToDelete.map(t => {
      const amount = Utils.formatCurrency(YnabClient.fromMilliunits(Math.abs(t.amount)));
      const sign = t.amount < 0 ? '-' : '+';
      const valueClass = t.amount < 0 ? 'text-danger' : 'text-success';
      return `
        <div class="confirm-detail-item">
          <span class="detail-label">${Utils.escapeHtml(t.memberName)} (${t.type})<br><small>${t.date}</small></span>
          <span class="detail-value ${valueClass}">${sign}${amount}</span>
        </div>
      `;
    }).join('');

    const confirmed = await Utils.confirm({
      title: `Delete ${transactionsToDelete.length} Balancing Transactions`,
      html: `
        <p>Link ID: <code>#${Utils.escapeHtml(linkId)}#</code></p>
        <div class="confirm-detail-list">${txnListHtml}</div>
        <div class="confirm-warning">This action cannot be undone.</div>
      `,
      confirmText: 'Delete All',
      cancelText: 'Cancel',
      danger: true
    });

    if (!confirmed) return;

    try {
      // Delete all transactions
      const budgetsToInvalidate = new Set();
      let deleteCount = 0;

      for (const txnInfo of transactionsToDelete) {
        try {
          await YnabClient.deleteTransaction(txnInfo.budgetId, txnInfo.txnId);
          budgetsToInvalidate.add(txnInfo.budgetId);
          deleteCount++;

          // Also remove from local state
          if (txnInfo.type === 'shared') {
            this.removeLocalTransaction(txnInfo.txnId, 'shared', txnInfo.memberName);
          } else {
            this.removeLocalTransaction(txnInfo.txnId, 'personal', txnInfo.memberName);
          }
        } catch (error) {
          console.error(`Failed to delete transaction ${txnInfo.txnId}:`, error);
        }
      }

      // Invalidate all affected budget caches
      budgetsToInvalidate.forEach(budgetId => {
        DataService.invalidateBudgetCache(budgetId);
      });

      Utils.showToast(`Deleted ${deleteCount} balancing transactions`, 'success');

      // Adjust budgets for affected personal budgets
      // After deleting balancing transactions, move freed budget back from Balancing to Shared Expenses
      const currentMonth = this.state.currentMonth || new Date().toISOString().slice(0, 7) + '-01';
      const affectedMembers = new Set();
      for (const txnInfo of transactionsToDelete) {
        if (txnInfo.type === 'personal') {
          affectedMembers.add(txnInfo.memberName);
        }
      }

      for (const memberName of affectedMembers) {
        const memberConfig = config.members.find(m => m.name === memberName);
        if (!memberConfig) continue;

        try {
          // Invalidate month cache and get fresh category data after deletions
          DataService.invalidateMonthCache(memberConfig.budgetId, currentMonth);
          const monthData = await DataService.getMonthData(memberConfig.budgetId, currentMonth);
          const categories = monthData?.categories || [];

          const balancingCat = categories.find(c => c.id === memberConfig.balancingCategoryId);
          const sharedCat = categories.find(c => c.id === memberConfig.sharedCategoryId);

          if (!balancingCat || !sharedCat) continue;

          const balancingAvailable = balancingCat.balance; // milliunits

          if (balancingAvailable > 0) {
            // Excess budget in balancing — move back to shared expenses
            const newBalancingBudgeted = balancingCat.budgeted - balancingAvailable;
            const newSharedBudgeted = sharedCat.budgeted + balancingAvailable;

            await YnabClient.updateCategoryBudget(
              memberConfig.budgetId, currentMonth, memberConfig.balancingCategoryId, newBalancingBudgeted
            );
            await YnabClient.updateCategoryBudget(
              memberConfig.budgetId, currentMonth, memberConfig.sharedCategoryId, newSharedBudgeted
            );

            DataService.invalidateMonthCache(memberConfig.budgetId, currentMonth);
            Utils.showToast(
              `${memberName}: Moved ${Utils.formatCurrency(YnabClient.fromMilliunits(balancingAvailable))} from Balancing back to Shared Expenses`,
              'info'
            );
          } else if (balancingAvailable < 0) {
            // Deficit in balancing — cover from shared expenses if possible
            const deficit = Math.abs(balancingAvailable);
            if (sharedCat.balance >= deficit) {
              const newBalancingBudgeted = balancingCat.budgeted + deficit;
              const newSharedBudgeted = sharedCat.budgeted - deficit;

              await YnabClient.updateCategoryBudget(
                memberConfig.budgetId, currentMonth, memberConfig.balancingCategoryId, newBalancingBudgeted
              );
              await YnabClient.updateCategoryBudget(
                memberConfig.budgetId, currentMonth, memberConfig.sharedCategoryId, newSharedBudgeted
              );

              DataService.invalidateMonthCache(memberConfig.budgetId, currentMonth);
              Utils.showToast(
                `${memberName}: Moved ${Utils.formatCurrency(YnabClient.fromMilliunits(deficit))} from Shared Expenses to cover Balancing deficit`,
                'info'
              );
            }
          }
        } catch (error) {
          console.warn(`Failed to adjust budgets for ${memberName}:`, error);
        }
      }

      // Update local category balance state
      await this.loadBalances(config, true);

      // Re-analyze and render
      // Sync computed state from Store
      this.state.linkedPairs = Store.state.linkedPairs || [];
      this.state.unlinkedPersonal = Store.state.unlinkedPersonal || {};
      this.state.unlinkedShared = Store.state.unlinkedShared || {};
      this.state.linkedPersonal = Store.state.linkedPersonal || {};
      this.state.linkedShared = Store.state.linkedShared || {};
      this.renderAll();

    } catch (error) {
      console.error('Failed to delete balancing transaction set:', error);
      Utils.showToast(`Failed to delete: ${error.message}`, 'error');
    }
  },

  // Remove a transaction from local state
  // memberName is optional - defaults to selected member
  removeLocalTransaction(txnId, source, memberName = null) {
    const member = memberName || this.state.selectedMember;
    const config = Store.getConfig();

    if (source === 'shared') {
      if (this.state.transactions.shared[member]) {
        this.state.transactions.shared[member] = this.state.transactions.shared[member].filter(t => t.id !== txnId);
      }
      // Sync to Store so derived state recomputes
      Store.removeTransaction(config.sharedBudgetId, txnId);
    } else if (source === 'personal') {
      if (this.state.transactions.personal[member]) {
        this.state.transactions.personal[member] = this.state.transactions.personal[member].filter(t => t.id !== txnId);
      }
      // Sync to Store so derived state recomputes
      const memberConfig = config.members.find(m => m.name === member);
      if (memberConfig) {
        Store.removeTransaction(memberConfig.budgetId, txnId);
      }
    }
  },

  async showMonthlyPicker(txnId) {
    if (this._busy) return;
    this._busy = true;
    try {
    const member = this.state.selectedMember;
    const txn = this.state.unlinkedShared[member]?.find(t => t.id === txnId);
    if (!txn) return;

    // Generate month options for the last 12 months
    const months = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      const label = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
      const id = this.generateMonthlyId(month, year);
      months.push({ year, month, label, id });
    }

    // Default to the month of the transaction
    const txnDate = new Date(txn.date);
    const defaultMonth = txnDate.getMonth() + 1;
    const defaultYear = txnDate.getFullYear();

    const monthOptions = months.map(m => {
      const selected = m.month === defaultMonth && m.year === defaultYear ? 'selected' : '';
      return `<option value="${m.month}-${m.year}" ${selected}>${m.label} (#${m.id}#)</option>`;
    }).join('');

    let selectedMonthValue = `${defaultMonth}-${defaultYear}`;

    const confirmed = await Utils.confirm({
      title: 'Mark as Monthly Contribution',
      html: `
        <div class="confirm-detail-list">
          <div class="confirm-detail-item">
            <span class="detail-label">${Utils.escapeHtml(txn.payee_name || 'Unknown')}<br><small>${txn.date}</small></span>
            <span class="detail-value">${Utils.formatCurrency(YnabClient.fromMilliunits(txn.amount))}</span>
          </div>
        </div>
        <div class="form-group" style="margin-top: 12px;">
          <label>Month</label>
          <select id="monthly-month-select">
            ${monthOptions}
          </select>
        </div>
        <p style="margin-top: 8px;">This will add a monthly ID tag to the memo.</p>
      `,
      confirmText: 'Mark as Monthly',
      cancelText: 'Cancel',
      onReady(modal) {
        const sel = modal.querySelector('#monthly-month-select');
        if (sel) {
          selectedMonthValue = sel.value;
          sel.addEventListener('change', () => { selectedMonthValue = sel.value; });
        }
      }
    });

    if (!confirmed) return;

    const parts = selectedMonthValue.split('-');
    const selectedMonth = parseInt(parts[0]);
    const selectedYear = parseInt(parts[1]);

    await this.markAsMonthly(txnId, selectedMonth, selectedYear);
    } finally {
      this._busy = false;
    }
  },

  async markAsMonthly(txnId, month, year) {
    const member = this.state.selectedMember;
    const config = Store.getConfig();
    const txn = this.state.unlinkedShared[member]?.find(t => t.id === txnId);

    if (!txn) return;

    const monthlyId = this.generateMonthlyId(month, year);
    const newMemo = this.appendIdToMemo(txn.memo, monthlyId);
    const monthLabel = new Date(year, month - 1, 1).toLocaleDateString('en-US', { year: 'numeric', month: 'long' });

    try {
      // Update the shared transaction memo
      await YnabClient.updateTransaction(config.sharedBudgetId, txn.id, {
        memo: newMemo
      });

      Utils.showToast(`Marked as ${monthLabel} contribution (#${monthlyId}#)`, 'success');

      // Update local state and re-render without API call
      this.updateLocalTransactionMemo(txn.id, newMemo, 'shared');
      // Sync computed state from Store
      this.state.linkedPairs = Store.state.linkedPairs || [];
      this.state.unlinkedPersonal = Store.state.unlinkedPersonal || {};
      this.state.unlinkedShared = Store.state.unlinkedShared || {};
      this.state.linkedPersonal = Store.state.linkedPersonal || {};
      this.state.linkedShared = Store.state.linkedShared || {};
      this.renderAll();

    } catch (error) {
      console.error('Failed to mark as monthly:', error);
      Utils.showToast(`Failed to update: ${error.message}`, 'error');
    }
  },

  // Update a transaction's memo in local state
  updateLocalTransactionMemo(txnId, newMemo, source) {
    const member = this.state.selectedMember;
    const config = Store.getConfig();

    if (source === 'personal') {
      const txns = this.state.transactions.personal[member];
      const txn = txns?.find(t => t.id === txnId);
      if (txn) {
        txn.memo = newMemo;
        // Sync to Store so derived state (linkedPairs, etc.) recomputes
        const memberConfig = config.members.find(m => m.name === member);
        if (memberConfig) {
          Store.updateTransaction(memberConfig.budgetId, { ...txn, memo: newMemo });
        }
      }
    } else if (source === 'shared') {
      const txns = this.state.transactions.shared[member];
      const txn = txns?.find(t => t.id === txnId);
      if (txn) {
        txn.memo = newMemo;
        // Sync to Store so derived state recomputes
        Store.updateTransaction(config.sharedBudgetId, { ...txn, memo: newMemo });
      }
    }
  },

  selectPersonalTransaction(txnId) {
    const member = this.state.selectedMember;
    const txn = this.state.unlinkedPersonal[member]?.find(t => t.id === txnId);
    if (!txn) return;

    // Toggle selection
    if (this.state.selectedPersonalTxn?.id === txnId) {
      this.cancelLinking();
      return;
    }

    this.state.selectedPersonalTxn = txn;
    this.state.linkingMode = true;
    this.elements.linkingModeBanner.style.display = 'flex';

    // Count matching transactions and update banner
    const sharedTxns = this.state.unlinkedShared[member] || [];
    const matchCount = sharedTxns.filter(st => this.isGoodMatch(txn, st)).length;

    // Update banner text with match count
    const bannerText = this.elements.linkingModeBanner.querySelector('.linking-mode-text');
    if (bannerText) {
      const matchInfo = matchCount > 0
        ? `<span class="linking-mode-match-count">${matchCount} match${matchCount !== 1 ? 'es' : ''} found</span>`
        : '<span class="linking-mode-match-count" style="background: rgba(239, 68, 68, 0.3);">No matches</span>';
      bannerText.innerHTML = `Select a shared transaction below to link ${matchInfo}`;
    }

    // Re-render columns to show selection state
    this.renderTransactionColumns();
  },

  cancelLinking() {
    this.state.linkingMode = false;
    this.state.selectedPersonalTxn = null;
    this.elements.linkingModeBanner.style.display = 'none';

    // Reset banner text
    const bannerText = this.elements.linkingModeBanner.querySelector('.linking-mode-text');
    if (bannerText) {
      bannerText.innerHTML = 'Select a shared transaction below to link';
    }

    this.renderTransactionColumns();
  },

  isGoodMatch(personalTxn, sharedTxn) {
    if (!personalTxn || !sharedTxn) return false;

    // Same amount (within small tolerance for rounding)
    const amountMatch = Math.abs(personalTxn.amount - sharedTxn.amount) < 100;

    // Within 7 days
    const daysDiff = Math.abs(new Date(personalTxn.date) - new Date(sharedTxn.date)) / (1000 * 60 * 60 * 24);
    const dateMatch = daysDiff <= 7;

    return amountMatch && dateMatch;
  },

  async linkWithSelected(sharedTxnId) {
    if (this._busy) return;
    this._busy = true;
    try {
    const member = this.state.selectedMember;
    const personalTxn = this.state.selectedPersonalTxn;
    const sharedTxn = this.state.unlinkedShared[member]?.find(t => t.id === sharedTxnId);

    if (!personalTxn || !sharedTxn) {
      this.cancelLinking();
      return;
    }

    const config = Store.getConfig();
    const memberConfig = config.members.find(m => m.name === member);
    const newId = this.generateId();

    const personalNewMemo = this.appendIdToMemo(personalTxn.memo, newId);
    const sharedNewMemo = this.appendIdToMemo(sharedTxn.memo, newId);

    try {
      // Update personal transaction memo
      await YnabClient.updateTransaction(memberConfig.budgetId, personalTxn.id, {
        memo: personalNewMemo
      });

      // Update shared transaction memo
      await YnabClient.updateTransaction(config.sharedBudgetId, sharedTxn.id, {
        memo: sharedNewMemo
      });

      Utils.showToast(`Linked with ID #${newId}#`, 'success');

      // Update local state and re-render without API call
      this.updateLocalTransactionMemo(personalTxn.id, personalNewMemo, 'personal');
      this.updateLocalTransactionMemo(sharedTxn.id, sharedNewMemo, 'shared');

      this.cancelLinking();
      // Sync computed state from Store
      this.state.linkedPairs = Store.state.linkedPairs || [];
      this.state.unlinkedPersonal = Store.state.unlinkedPersonal || {};
      this.state.unlinkedShared = Store.state.unlinkedShared || {};
      this.state.linkedPersonal = Store.state.linkedPersonal || {};
      this.state.linkedShared = Store.state.linkedShared || {};
      this.renderAll();

    } catch (error) {
      console.error('Failed to link transactions:', error);
      Utils.showToast(`Failed to link: ${error.message}`, 'error');
    }
    } finally {
      this._busy = false;
    }
  },

  async duplicateToShared(personalTxnId) {
    if (this._busy) return;
    this._busy = true;
    try {
    const member = this.state.selectedMember;
    const config = Store.getConfig();
    const memberConfig = config.members.find(m => m.name === member);
    const txn = this.state.unlinkedPersonal[member]?.find(t => t.id === personalTxnId);

    if (!txn || !memberConfig) return;

    const newId = this.generateId();
    const newMemo = this.appendIdToMemo(txn.memo, newId);

    const confirmed = await Utils.confirm({
      title: 'Copy to Shared Budget',
      html: `
        <div class="confirm-detail-list">
          <div class="confirm-detail-item">
            <span class="detail-label">${Utils.escapeHtml(txn.payee_name || 'Unknown')}<br><small>${txn.date}</small></span>
            <span class="detail-value">${Utils.formatCurrency(YnabClient.fromMilliunits(txn.amount))}</span>
          </div>
        </div>
        <p>This will create a matching transaction in the shared budget and link them with ID <code>#${Utils.escapeHtml(newId)}#</code></p>
      `,
      confirmText: 'Copy & Link',
      cancelText: 'Cancel'
    });

    if (!confirmed) return;

    try {
      // Create in shared budget
      const newSharedTxn = await YnabClient.createTransaction(config.sharedBudgetId, {
        account_id: memberConfig.contributionAccountId,
        date: txn.date,
        amount: txn.amount,
        payee_name: txn.payee_name,
        memo: newMemo,
        cleared: 'cleared',
        approved: true
      });

      // Update original transaction memo
      await YnabClient.updateTransaction(memberConfig.budgetId, personalTxnId, {
        memo: newMemo
      });

      Utils.showToast('Transaction copied and linked', 'success');

      // Update local state - update personal memo and add new shared transaction
      this.updateLocalTransactionMemo(personalTxnId, newMemo, 'personal');

      // Add the new shared transaction to local state
      if (!this.state.transactions.shared[member]) {
        this.state.transactions.shared[member] = [];
      }
      this.state.transactions.shared[member].push({
        ...newSharedTxn,
        memberName: member,
        accountId: memberConfig.contributionAccountId,
        source: 'shared'
      });

      // Sync new transaction to Store so derived state recomputes
      Store.updateTransaction(config.sharedBudgetId, newSharedTxn);

      // Update shared account balance locally
      this.state.accountBalances[member] = (this.state.accountBalances[member] || 0)
        + YnabClient.fromMilliunits(txn.amount);

      // Re-sync from Store (now up-to-date) and render
      this.state.linkedPairs = Store.state.linkedPairs || [];
      this.state.unlinkedPersonal = Store.state.unlinkedPersonal || {};
      this.state.unlinkedShared = Store.state.unlinkedShared || {};
      this.state.linkedPersonal = Store.state.linkedPersonal || {};
      this.state.linkedShared = Store.state.linkedShared || {};
      this.renderAll();

    } catch (error) {
      console.error('Failed to duplicate transaction:', error);
      Utils.showToast(`Failed to copy: ${error.message}`, 'error');
    }
    } finally {
      this._busy = false;
    }
  },


  renderLinkedPairs() {
    const member = this.state.selectedMember;
    const memberPairs = this.state.linkedPairs.filter(p =>
      p.personal[member]?.length > 0 || p.shared.some(t => t.memberName === member)
    );

    if (memberPairs.length === 0) {
      this.elements.linkedContainer.innerHTML = '<p class="text-muted">No linked transactions for this member.</p>';
      return;
    }

    // Count by type for summary
    const balancingCount = memberPairs.filter(p => p.isBalancing).length;
    const monthlyCount = memberPairs.filter(p => p.isMonthly).length;
    const regularCount = memberPairs.filter(p => !p.isBalancing && !p.isMonthly).length;
    const incompleteCount = memberPairs.filter(p => !p.isComplete).length;

    const rows = memberPairs.slice(0, 50).map(pair => {
      const personalTxns = pair.personal[member] || [];
      const sharedTxns = pair.shared.filter(t => t.memberName === member);

      // Get transaction name from shared or personal (prefer shared as it has the payee)
      const txnName = sharedTxns[0]?.payee_name || personalTxns[0]?.payee_name || '';
      const displayName = txnName ? Utils.escapeHtml(txnName) : '<span class="text-muted">-</span>';

      const personalInfo = personalTxns.length > 0
        ? `${personalTxns[0].date}<br><span class="txn-amount">${Utils.formatCurrency(YnabClient.fromMilliunits(personalTxns[0].amount))}</span>`
        : '<span class="text-muted">-</span>';

      const sharedInfo = sharedTxns.length > 0
        ? `${sharedTxns[0].date}<br><span class="txn-amount">${Utils.formatCurrency(YnabClient.fromMilliunits(sharedTxns[0].amount))}</span>`
        : '<span class="text-muted">-</span>';

      const typeBadge = this.getLinkTypeBadge(pair);

      // Show what's missing for incomplete links
      let missingHtml = '';
      if (!pair.isComplete) {
        const missing = this.getMissingDetails(pair.id, pair);
        if (missing.length > 0) {
          missingHtml = `<div class="incomplete-details">Missing: ${missing.map(m => `<span class="missing-item">${m}</span>`).join('')}</div>`;
        }
      }

      return `
        <tr class="${pair.isComplete ? '' : 'incomplete'}">
          <td>
            <div class="link-id-container">
              <code class="link-id">#${pair.id}#</code>
              ${typeBadge}
            </div>
            ${missingHtml}
          </td>
          <td class="txn-name-cell">${displayName}</td>
          <td>${personalInfo}</td>
          <td>${sharedInfo}</td>
          <td><span class="status-badge ${pair.isComplete ? 'complete' : 'incomplete'}">${pair.isComplete ? '✓' : '!'}</span></td>
        </tr>
      `;
    }).join('');

    // Summary header with type counts
    const summaryHtml = `
      <div class="linked-pairs-summary" style="display: flex; gap: 1rem; margin-bottom: 0.75rem; font-size: 0.8rem;">
        <span><span class="link-type-badge type-regular">Expense</span> ${regularCount}</span>
        <span><span class="link-type-badge type-balancing">Balancing</span> ${balancingCount}</span>
        <span><span class="link-type-badge type-monthly">Monthly</span> ${monthlyCount}</span>
        ${incompleteCount > 0 ? `<span style="color: #991b1b;">⚠ ${incompleteCount} incomplete</span>` : ''}
      </div>
    `;

    this.elements.linkedContainer.innerHTML = `
      ${summaryHtml}
      <table class="consistency-table">
        <thead>
          <tr><th>ID & Type</th><th>Name</th><th>Personal</th><th>Shared</th><th></th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      ${memberPairs.length > 50 ? `<p class="text-muted">Showing 50 of ${memberPairs.length}</p>` : ''}
    `;
  },

  renderMonthlyConfig() {
    const config = Store.getConfig();
    const member = this.state.selectedMember;
    const months = this.getLast12Months();

    const monthlyLinks = this.state.linkedPairs.filter(p => p.isMonthly);
    const monthlyByKey = {};
    monthlyLinks.forEach(link => {
      if (link.monthlyInfo) {
        const key = `${link.monthlyInfo.year}-${link.monthlyInfo.month.toString().padStart(2, '0')}`;
        monthlyByKey[key] = link;
      }
    });

    const monthRows = months.map(monthStr => {
      const [year, month] = monthStr.split('-');
      const monthLabel = new Date(parseInt(year), parseInt(month) - 1, 1)
        .toLocaleDateString('en-US', { year: 'numeric', month: 'short' });

      const expectedId = this.generateMonthlyId(parseInt(month), parseInt(year));
      const existingLink = monthlyByKey[monthStr];
      const savedAmount = config.monthlyBudgets?.[monthStr]?.[member] || '';
      const linkedTxn = existingLink?.shared.find(t => t.memberName === member);

      return `
        <tr>
          <td class="month-label">${monthLabel}</td>
          <td><code>#${expectedId}#</code></td>
          <td>
            <div class="monthly-config-cell">
              <input type="number" class="monthly-amount-input"
                data-month="${monthStr}" data-member="${member}"
                value="${savedAmount}" placeholder="0.00" step="0.01">
              ${linkedTxn
                ? `<span class="monthly-linked" title="${Utils.formatCurrency(YnabClient.fromMilliunits(linkedTxn.amount))}">✓</span>`
                : `<button class="btn-small btn-create-monthly" data-month="${monthStr}" title="Create">+</button>`
              }
            </div>
          </td>
        </tr>
      `;
    }).join('');

    this.elements.monthlyConfigContainer.innerHTML = `
      <table class="consistency-table monthly-config-table">
        <thead>
          <tr><th>Month</th><th>ID Tag</th><th>Amount</th></tr>
        </thead>
        <tbody>${monthRows}</tbody>
      </table>
      <div class="monthly-config-actions">
        <button class="btn btn-secondary btn-small" id="btn-save-monthly-config">Save Amounts</button>
      </div>
    `;

    this.bindMonthlyConfigEvents();
  },

  bindMonthlyConfigEvents() {
    document.getElementById('btn-save-monthly-config')?.addEventListener('click', () => {
      this.saveMonthlyConfig();
    });

    this.elements.monthlyConfigContainer.querySelectorAll('.btn-create-monthly').forEach(btn => {
      btn.addEventListener('click', () => {
        const month = btn.dataset.month;
        this.createMonthlyIncome(month);
      });
    });
  },

  getLast12Months() {
    const months = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(date.toISOString().split('T')[0].substring(0, 7));
    }
    return months;
  },

  saveMonthlyConfig() {
    const config = Store.getConfig();
    const inputs = this.elements.monthlyConfigContainer.querySelectorAll('.monthly-amount-input');

    const monthlyBudgets = config.monthlyBudgets || {};
    inputs.forEach(input => {
      const month = input.dataset.month;
      const member = input.dataset.member;
      const value = parseFloat(input.value) || 0;

      if (!monthlyBudgets[month]) monthlyBudgets[month] = {};

      if (value > 0) {
        monthlyBudgets[month][member] = value;
      } else {
        delete monthlyBudgets[month][member];
      }
    });

    config.monthlyBudgets = monthlyBudgets;
    Store.setConfig(config);
    Utils.showToast('Monthly configuration saved', 'success');
  },

  async createMonthlyIncome(monthStr) {
    if (this._busy) return;
    this._busy = true;
    try {
      const member = this.state.selectedMember;
      const config = Store.getConfig();
      const memberConfig = config.members.find(m => m.name === member);
      if (!memberConfig) return;

      const [year, month] = monthStr.split('-').map(Number);
      const amount = config.monthlyBudgets?.[monthStr]?.[member];

      if (!amount) {
        Utils.showToast('Please set the monthly amount first', 'error');
        return;
      }

      const id = this.generateMonthlyId(month, year);
      const monthLabel = new Date(year, month - 1, 1)
        .toLocaleDateString('en-US', { year: 'numeric', month: 'long' });

      const confirmed = await Utils.confirm({
        title: 'Create Monthly Income',
        html: `
          <div class="confirm-detail-list">
            <div class="confirm-detail-item">
              <span class="detail-label">Member</span>
              <span class="detail-value">${Utils.escapeHtml(member)}</span>
            </div>
            <div class="confirm-detail-item">
              <span class="detail-label">Month</span>
              <span class="detail-value">${Utils.escapeHtml(monthLabel)}</span>
            </div>
            <div class="confirm-detail-item">
              <span class="detail-label">Amount</span>
              <span class="detail-value">${Utils.formatCurrency(amount)}</span>
            </div>
            <div class="confirm-detail-item">
              <span class="detail-label">Tag</span>
              <span class="detail-value"><code>#${Utils.escapeHtml(id)}#</code></span>
            </div>
          </div>
        `,
        confirmText: 'Create',
        cancelText: 'Cancel'
      });

      if (!confirmed) return;

      await YnabClient.createTransaction(config.sharedBudgetId, {
        account_id: memberConfig.contributionAccountId,
        date: `${monthStr}-01`,
        amount: YnabClient.toMilliunits(amount),
        payee_name: `Monthly Contribution - ${monthLabel}`,
        memo: `#${id}#`,
        cleared: 'cleared',
        approved: true
      });

      Utils.showToast('Monthly income transaction created', 'success');
      await this.loadData();
    } catch (error) {
      console.error('Failed to create monthly income:', error);
      Utils.showToast(`Failed to create: ${error.message}`, 'error');
    } finally {
      this._busy = false;
    }
  },

  formatDate(dateStr) {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
};

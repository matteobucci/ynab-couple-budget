/**
 * Setup Screen Module
 * Handles member configuration and budget binding
 */
const Setup = {
  elements: {},
  _saveTimer: null,

  init(elements) {
    this.elements = elements;
    this.bindEvents();
  },

  bindEvents() {
    this.elements.sharedBudgetSelect.addEventListener('change', (e) => {
      this.onSharedBudgetSelected(e.target.value);
    });

    this.elements.addMemberBtn.addEventListener('click', () => this.addMemberCard());
  },

  async restoreConfig(budgets, budgetDetails) {
    const config = Store.getConfig();

    if (config.sharedBudgetId) {
      this.elements.sharedBudgetSelect.value = config.sharedBudgetId;
      // Wait for shared budget to load before adding member cards
      await this.onSharedBudgetSelected(config.sharedBudgetId, false);
    }

    if (config.members && config.members.length > 0) {
      config.members.forEach(member => this.addMemberCard(member));
    }
  },

  async onSharedBudgetSelected(budgetId, showToast = true) {
    if (!budgetId) {
      this.elements.membersConfig.style.display = 'none';
      return;
    }

    Store.updateConfig({ sharedBudgetId: budgetId });

    try {
      await App.loadBudgetDetails(budgetId);
      this.elements.membersConfig.style.display = 'block';
      this.updateAllMemberAccountOptions();
      if (showToast) Utils.showToast('Shared budget selected', 'success');
    } catch (error) {
      Utils.showToast(`Failed to load budget: ${error.message}`, 'error');
    }
  },

  addMemberCard(existingData = null) {
    const budgets = App.state.budgets;
    const sharedBudgetId = this.elements.sharedBudgetSelect.value;

    const budgetOptions = budgets.map(b =>
      `<option value="${b.id}" ${existingData?.budgetId === b.id ? 'selected' : ''}>
        ${Utils.escapeHtml(b.name)}
      </option>`
    ).join('');

    const sharedDetails = App.state.budgetDetails[sharedBudgetId];
    const accountOptions = sharedDetails?.accounts
      ?.filter(a => a.on_budget && !a.closed)
      ?.map(a => `<option value="${a.id}" ${existingData?.contributionAccountId === a.id ? 'selected' : ''}>
          ${Utils.escapeHtml(a.name)}
        </option>`)
      ?.join('') || '';

    const card = document.createElement('div');
    card.className = 'member-card';
    card.innerHTML = `
      <div class="member-card-header">
        <input type="text" class="member-name" placeholder="Member name (e.g., Matteo)"
               value="${Utils.escapeHtml(existingData?.name || '')}">
        <button class="btn-remove" title="Remove member">&times;</button>
      </div>
      <div class="member-card-grid">
        <div class="member-card-section">
          <h4>Personal Budget</h4>
          <div class="form-group">
            <select class="member-budget">
              <option value="">Select budget...</option>
              ${budgetOptions}
            </select>
          </div>
          <div class="form-group">
            <label>Shared Expenses Category</label>
            <select class="member-shared-category">
              <option value="">Select category...</option>
            </select>
          </div>
          <div class="form-group">
            <label>Balancing Category</label>
            <select class="member-balancing-category">
              <option value="">Select category...</option>
            </select>
          </div>
        </div>
        <div class="member-card-section">
          <h4>In Shared Budget</h4>
          <div class="form-group">
            <label>Contribution Account</label>
            <select class="member-account">
              <option value="">Select account...</option>
              ${accountOptions}
            </select>
            <small>Their account in the household budget</small>
          </div>
        </div>
      </div>
    `;

    // Bind events
    card.querySelector('.btn-remove').addEventListener('click', async () => {
      const name = card.querySelector('.member-name').value.trim() || 'this member';
      const confirmed = await Utils.confirm({
        title: 'Remove Member',
        message: `Remove ${name}? This will clear all their budget and category bindings.`,
        confirmText: 'Remove',
        cancelText: 'Cancel',
        danger: true
      });
      if (!confirmed) return;
      card.remove();
      this.saveMembersConfig();
    });

    card.querySelector('.member-name').addEventListener('input', () => {
      clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(() => this.saveMembersConfig(), 400);
    });
    card.querySelector('.member-budget').addEventListener('change', (e) => {
      this.onMemberBudgetSelected(card, e.target.value);
    });
    card.querySelector('.member-shared-category').addEventListener('change', () => this.saveMembersConfig());
    card.querySelector('.member-balancing-category').addEventListener('change', () => this.saveMembersConfig());
    card.querySelector('.member-account').addEventListener('change', () => this.saveMembersConfig());

    this.elements.membersList.appendChild(card);

    if (existingData?.budgetId) {
      this.onMemberBudgetSelected(card, existingData.budgetId, existingData);
    }
  },

  updateAllMemberAccountOptions() {
    const sharedBudgetId = this.elements.sharedBudgetSelect.value;
    const sharedDetails = App.state.budgetDetails[sharedBudgetId];

    if (!sharedDetails?.accounts) return;

    const accountOptions = sharedDetails.accounts
      .filter(a => a.on_budget && !a.closed)
      .map(a => `<option value="${a.id}">${Utils.escapeHtml(a.name)}</option>`)
      .join('');

    this.elements.membersList.querySelectorAll('.member-account').forEach(select => {
      const currentValue = select.value;
      select.innerHTML = '<option value="">Select account...</option>' + accountOptions;
      if (currentValue) select.value = currentValue;
    });
  },

  async onMemberBudgetSelected(card, budgetId, existingData = null) {
    const sharedCatSelect = card.querySelector('.member-shared-category');
    const balancingCatSelect = card.querySelector('.member-balancing-category');

    if (!budgetId) {
      sharedCatSelect.innerHTML = '<option value="">Select category...</option>';
      balancingCatSelect.innerHTML = '<option value="">Select category...</option>';
      return;
    }

    sharedCatSelect.innerHTML = '<option value="">Loading categories...</option>';
    balancingCatSelect.innerHTML = '<option value="">Loading categories...</option>';
    sharedCatSelect.disabled = true;
    balancingCatSelect.disabled = true;

    try {
      const categoryGroups = await YnabClient.getCategories(budgetId);

      const categories = [];
      for (const group of (categoryGroups || [])) {
        if (group.hidden) continue;
        const groupCategories = group.categories || [];
        for (const cat of groupCategories) {
          if (cat.hidden) continue;
          categories.push({
            id: cat.id,
            name: cat.name,
            group: group.name
          });
        }
      }

      if (categories.length === 0) {
        sharedCatSelect.innerHTML = '<option value="">No categories found</option>';
        balancingCatSelect.innerHTML = '<option value="">No categories found</option>';
        Utils.showToast('No categories found in budget', 'warning');
        return;
      }

      const categoryOptions = categories.map(c =>
        `<option value="${c.id}">${Utils.escapeHtml(c.group)} → ${Utils.escapeHtml(c.name)}</option>`
      ).join('');

      sharedCatSelect.innerHTML = '<option value="">Select category...</option>' + categoryOptions;
      balancingCatSelect.innerHTML = '<option value="">Select category...</option>' + categoryOptions;

      if (existingData?.sharedCategoryId) {
        sharedCatSelect.value = existingData.sharedCategoryId;
      }
      if (existingData?.balancingCategoryId) {
        balancingCatSelect.value = existingData.balancingCategoryId;
      }

      this.saveMembersConfig();

    } catch (error) {
      console.error('Failed to load categories:', error);
      sharedCatSelect.innerHTML = '<option value="">Error loading categories</option>';
      balancingCatSelect.innerHTML = '<option value="">Error loading categories</option>';
      Utils.showToast(`Failed to load categories: ${error.message}`, 'error');
    } finally {
      sharedCatSelect.disabled = false;
      balancingCatSelect.disabled = false;
    }
  },

  saveMembersConfig() {
    const cards = this.elements.membersList.querySelectorAll('.member-card');
    const members = [];
    let hasEmptyNames = false;

    cards.forEach(card => {
      const nameInput = card.querySelector('.member-name');
      const name = nameInput.value.trim();
      const budgetId = card.querySelector('.member-budget').value;
      const sharedCategoryId = card.querySelector('.member-shared-category').value;
      const balancingCategoryId = card.querySelector('.member-balancing-category').value;
      const contributionAccountId = card.querySelector('.member-account').value;

      // Validate name
      if (!name) {
        nameInput.classList.add('input-error');
        hasEmptyNames = true;
      } else {
        nameInput.classList.remove('input-error');
      }

      members.push({
        name,
        budgetId,
        sharedCategoryId,
        balancingCategoryId,
        contributionAccountId
      });
    });

    // Show or hide validation message
    this.showValidationMessage(hasEmptyNames && cards.length > 0
      ? 'Please enter a name for each member before saving.'
      : null);

    if (hasEmptyNames) return;

    const wasConfigured = App.isConfigured();
    Store.updateConfig({ members });

    // Update the setup Done button visibility
    App.updateSetupDoneButton();

    // Update screen visibility immediately so the user doesn't need to switch tabs
    App.updateScreenVisibility();

    // If the system just became fully configured, handle transition
    if (!wasConfigured && App.isConfigured()) {
      // In setup mode, auto-close dialog and show app
      if (App.state.settingsMode === 'setup') {
        App.closeSettingsDialog();
        Overview.state.loaded = false;
        Overview.initScreen();
      } else {
        // In settings mode, trigger data load for the active screen
        const activeScreen = document.querySelector('.nav-btn.active')?.dataset.screen;
        if (activeScreen === 'overview') {
          Overview.state.loaded = false;
          Overview.initScreen();
        } else if (activeScreen === 'transactions') {
          Consistency.initScreen();
        } else if (activeScreen === 'monthly') {
          Monthly.initScreen();
        } else if (activeScreen === 'analytics') {
          Analytics.initScreen();
        }
      }
    }
  },

  showValidationMessage(message) {
    let msgEl = this.elements.membersList.parentElement.querySelector('.members-validation-msg');
    if (message) {
      if (!msgEl) {
        msgEl = document.createElement('div');
        msgEl.className = 'members-validation-msg';
        this.elements.membersList.parentElement.insertBefore(msgEl, this.elements.membersList.nextSibling);
      }
      msgEl.textContent = message;
      msgEl.style.display = 'block';
    } else if (msgEl) {
      msgEl.style.display = 'none';
    }
  }
};

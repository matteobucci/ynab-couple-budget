/**
 * Transaction Classification Module
 * Centralizes all transaction type determination logic.
 * Pure functions — depends only on LinkUtils (from utils.js).
 */
const TxnTypes = {
  // --- Shared budget classification ---

  isContribution(txn) {
    if (txn.amount <= 0) return false;
    // Monthly link ID is the strongest signal
    const id = LinkUtils.extractId(txn.memo);
    if (id && LinkUtils.isMonthlyId(id)) return true;
    // Uncategorized inflow or "Ready to Assign" without a regular link ID
    if (!id && (!txn.category_id || txn.category_name === 'Inflow: Ready to Assign')) return true;
    return false;
  },

  isReimbursement(txn) {
    return txn.amount > 0 && !this.isContribution(txn) && !txn.transfer_account_id;
  },

  isExpense(txn) {
    return txn.amount < 0 && !txn.transfer_account_id;
  },

  isBalancingTransfer(txn) {
    return !!txn.transfer_account_id;
  },

  classifyShared(txn) {
    if (txn.transfer_account_id) return 'balancing';
    if (this.isContribution(txn)) return 'contribution';
    if (txn.amount > 0) return 'reimbursement';
    return 'expense';
  },

  // --- Personal budget classification ---

  isPersonalExpense(txn) {
    return txn.amount < 0;
  },

  isPersonalReimbursement(txn) {
    return txn.amount > 0;
  },

  // --- Link classification (delegates to LinkUtils) ---

  isLinked(txn) {
    return LinkUtils.hasId(txn.memo);
  },

  getLinkType(txn) {
    const id = LinkUtils.extractId(txn.memo);
    return LinkUtils.getIdType(id);
  },

  getLinkId(txn) {
    return LinkUtils.extractId(txn.memo);
  },

  // --- Filtering helpers ---

  isBeforeCutoff(txn, cutoffDate) {
    return txn.date < cutoffDate;
  },

  isActive(txn) {
    return !txn.deleted;
  },

  // --- Batch classifier ---

  classifySharedTransactions(txns) {
    const contributions = [];
    const reimbursements = [];
    const expenses = [];
    const balancingTransfers = [];

    for (const txn of txns) {
      switch (this.classifyShared(txn)) {
        case 'contribution': contributions.push(txn); break;
        case 'reimbursement': reimbursements.push(txn); break;
        case 'expense': expenses.push(txn); break;
        case 'balancing': balancingTransfers.push(txn); break;
      }
    }

    return { contributions, reimbursements, expenses, balancingTransfers };
  }
};

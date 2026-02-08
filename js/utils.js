/**
 * Transaction Linking Utilities
 * Shared ID generation and parsing for linking transactions across budgets
 *
 * ID Formats:
 * - Regular expense: #XXXXXX# (6 char alphanumeric)
 * - Balancing: #B-XXXXXX# (B prefix for balancing transaction sets)
 * - Monthly income: #M-MM-YY# (M prefix with month-year)
 *
 * All IDs are embedded in transaction memos between # delimiters.
 */
const LinkUtils = {
  // Regex to extract ID from memo (captures content between # markers)
  ID_REGEX: /#([A-Z0-9-]+)#/,

  // Character set for random ID generation (excludes confusing chars: I, O, 1, 0)
  ID_CHARS: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',

  /**
   * Generate a random 6-character alphanumeric ID
   * @returns {string} ID like "A3K9M2"
   */
  generateId() {
    let id = '';
    for (let i = 0; i < 6; i++) {
      id += this.ID_CHARS.charAt(Math.floor(Math.random() * this.ID_CHARS.length));
    }
    return id;
  },

  /**
   * Generate a balancing transaction ID
   * @returns {string} ID like "B-A3K9M2"
   */
  generateBalancingId() {
    return `B-${this.generateId()}`;
  },

  /**
   * Generate a monthly income ID for a specific month
   * @param {number} month - Month number (1-12)
   * @param {number} year - Full year (e.g., 2026)
   * @returns {string} ID like "M-01-26"
   */
  generateMonthlyId(month, year) {
    const mm = month.toString().padStart(2, '0');
    const yy = year.toString().slice(-2);
    return `M-${mm}-${yy}`;
  },

  /**
   * Format an ID as a memo tag
   * @param {string} id - The ID to format
   * @returns {string} Tag like "#A3K9M2#"
   */
  formatIdTag(id) {
    return `#${id}#`;
  },

  /**
   * Extract ID from a transaction memo
   * @param {string} memo - Transaction memo text
   * @returns {string|null} Extracted ID or null if not found
   */
  extractId(memo) {
    if (!memo) return null;
    const match = memo.match(this.ID_REGEX);
    return match ? match[1] : null;
  },

  /**
   * Check if memo contains an ID tag
   * @param {string} memo - Transaction memo text
   * @returns {boolean}
   */
  hasId(memo) {
    return this.ID_REGEX.test(memo || '');
  },

  /**
   * Append or replace ID in memo
   * @param {string} memo - Original memo text
   * @param {string} id - ID to add
   * @returns {string} Memo with ID tag
   */
  appendIdToMemo(memo, id) {
    const tag = this.formatIdTag(id);
    if (!memo) return tag;
    if (this.hasId(memo)) {
      return memo.replace(this.ID_REGEX, tag);
    }
    return `${memo} ${tag}`;
  },

  /**
   * Check if ID is a balancing transaction ID
   * @param {string} id - ID to check
   * @returns {boolean}
   */
  isBalancingId(id) {
    return id && id.startsWith('B-');
  },

  /**
   * Check if ID is a monthly income ID
   * @param {string} id - ID to check
   * @returns {boolean}
   */
  isMonthlyId(id) {
    return id && id.startsWith('M-');
  },

  /**
   * Check if ID is a regular expense ID (no prefix)
   * @param {string} id - ID to check
   * @returns {boolean}
   */
  isRegularId(id) {
    return id && !id.includes('-');
  },

  /**
   * Parse monthly ID to extract month and year
   * @param {string} id - Monthly ID like "M-01-26"
   * @returns {{month: number, year: number}|null}
   */
  parseMonthlyId(id) {
    if (!this.isMonthlyId(id)) return null;
    const parts = id.split('-');
    if (parts.length !== 3) return null;
    return {
      month: parseInt(parts[1]),
      year: 2000 + parseInt(parts[2])
    };
  },

  /**
   * Get the type of transaction ID
   * @param {string} id - ID to check
   * @returns {'balancing'|'monthly'|'regular'|null}
   */
  getIdType(id) {
    if (!id) return null;
    if (this.isBalancingId(id)) return 'balancing';
    if (this.isMonthlyId(id)) return 'monthly';
    return 'regular';
  }
};

/**
 * Utility functions
 */
const Utils = {
  /**
   * Format currency amount
   */
  formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'EUR'
    }).format(amount);
  },

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  /**
   * Get first day of month with optional offset
   */
  getMonthStart(offsetMonths = 0) {
    const date = new Date();
    date.setMonth(date.getMonth() + offsetMonths);
    date.setDate(1);
    return date.toISOString().split('T')[0];
  },

  /**
   * Get month string in YYYY-MM-01 format
   */
  getMonthString(date = null) {
    const d = date || new Date();
    return d.toISOString().split('T')[0].substring(0, 7) + '-01';
  },

  /**
   * Show toast notification
   * @param {string} message - The message to display
   * @param {string} type - Toast type: 'info', 'success', 'error', 'warning'
   * @param {number} duration - Duration in ms before auto-dismiss (default: 4000)
   */
  showToast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  /**
   * Show an in-app confirmation modal (replaces native confirm())
   * @param {object} options
   * @param {string} options.title - Modal title
   * @param {string} [options.message] - Plain text message (use html for rich content)
   * @param {string} [options.html] - HTML body content (takes precedence over message)
   * @param {string} [options.confirmText] - Confirm button text (default: "Confirm")
   * @param {string} [options.cancelText] - Cancel button text (default: "Cancel")
   * @param {boolean} [options.danger] - Use red danger button style
   * @returns {Promise<boolean>} Resolves true if confirmed, false if cancelled
   */
  confirm({ title, message, html, confirmText, cancelText, danger, onReady }) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay confirm-modal-overlay';
      overlay.style.display = 'flex';

      const modal = document.createElement('div');
      modal.className = 'modal confirm-modal';

      const bodyContent = html || `<p>${this.escapeHtml(message || '')}</p>`;

      modal.innerHTML = `
        <div class="modal-header">
          <h3>${this.escapeHtml(title || 'Confirm')}</h3>
        </div>
        <div class="modal-body confirm-body">
          ${bodyContent}
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary confirm-cancel">${this.escapeHtml(cancelText || 'Cancel')}</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'} confirm-ok">${this.escapeHtml(confirmText || 'Confirm')}</button>
        </div>
      `;

      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      document.body.style.overflow = 'hidden';

      const cleanup = (result) => {
        document.body.style.overflow = '';
        document.removeEventListener('keydown', keyHandler);
        overlay.remove();
        resolve(result);
      };

      const keyHandler = (e) => {
        if (e.key === 'Escape') cleanup(false);
      };
      document.addEventListener('keydown', keyHandler);

      modal.querySelector('.confirm-cancel').addEventListener('click', () => cleanup(false));
      modal.querySelector('.confirm-ok').addEventListener('click', () => cleanup(true));
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) cleanup(false);
      });

      // Notify caller the modal is ready (for attaching listeners to form elements)
      if (onReady) onReady(modal);

      // Focus the confirm button
      modal.querySelector('.confirm-ok').focus();
    });
  }
};

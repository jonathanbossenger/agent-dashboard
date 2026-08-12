// Shared utilities and constants — no imports, no side effects.

export const $ = (selector, root = document) => root.querySelector(selector);

export const IS_MAC = /mac/i.test(navigator.userAgentData?.platform || navigator.platform || '');
export const COPILOT_ISSUE_ASSIGNEE_LOGINS = new Set(['copilot', 'copilot-swe-agent[bot]']);
export const NEW_GITHUB_REPO_URL = 'https://github.com/new';
export const GITHUB_BTN_LABEL_BROWSE = 'Browse GitHub issues and pull requests';
export const GITHUB_BTN_LABEL_CREATE = 'Create GitHub repository';
export const RESTORE_RESUME_RETRY_DELAY_MS = 500;
export const LAYOUT_SAVE_DEBOUNCE_MS = 150;
export const SAVED_FLASH_DURATION_MS = 1200;
export const TERM_SCROLLBACK_LINES = 5000;
export const HEALTH_POLL_INTERVAL_MS = 10000;
export const DEFAULT_TERM_FONT_SIZE = 12;
export const MIN_TERM_FONT_SIZE = 6;
export const MAX_TERM_FONT_SIZE = 32;

export function currentTermFontSize() {
  const stored = parseInt(localStorage.getItem('termFontSize'), 10);
  return (stored >= MIN_TERM_FONT_SIZE && stored <= MAX_TERM_FONT_SIZE) ? stored : DEFAULT_TERM_FONT_SIZE;
}

export const COPILOT_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M7.998 15.035c-4.562 0-7.873-2.914-7.998-3.749V9.338c.085-.628.677-1.686 1.588-2.065.013-.07.024-.143.036-.218.029-.183.06-.384.126-.612-.201-.508-.254-1.084-.254-1.656 0-.87.128-1.769.693-2.484.579-.733 1.494-1.124 2.724-1.261 1.206-.134 2.262.034 2.944.765.05.053.096.108.139.165.044-.057.094-.112.143-.165.682-.731 1.738-.899 2.944-.765 1.23.137 2.145.528 2.724 1.261.566.715.693 1.614.693 2.484 0 .572-.053 1.148-.254 1.656.066.228.098.429.126.612.012.076.024.148.037.218.924.385 1.522 1.471 1.591 2.095v1.872c0 .766-3.351 3.795-8.002 3.795Zm0-1.485c2.28 0 4.584-1.11 5.002-1.433V7.862l-.023-.116c-.49.21-1.075.291-1.727.291-1.146 0-2.059-.327-2.71-.991A3.222 3.222 0 0 1 8 6.303a3.24 3.24 0 0 1-.544.743c-.65.664-1.563.991-2.71.991-.652 0-1.236-.081-1.727-.291l-.023.116v4.255c.419.323 2.722 1.433 5.002 1.433ZM6.762 2.83c-.193-.206-.637-.413-1.682-.297-1.019.113-1.479.404-1.713.7-.247.312-.369.789-.369 1.554 0 .793.129 1.171.308 1.371.162.181.519.379 1.442.379.853 0 1.339-.235 1.638-.54.315-.322.527-.827.617-1.553.117-.935-.037-1.395-.241-1.614Zm4.155-.297c-1.044-.116-1.488.091-1.681.297-.204.219-.359.679-.242 1.614.091.726.303 1.231.618 1.553.299.305.784.54 1.638.54.922 0 1.28-.198 1.442-.379.179-.2.308-.578.308-1.371 0-.765-.123-1.242-.37-1.554-.233-.296-.693-.587-1.713-.7Z"/><path d="M6.25 9.037a.75.75 0 0 1 .75.75v1.501a.75.75 0 0 1-1.5 0V9.787a.75.75 0 0 1 .75-.75Zm4.25.75v1.501a.75.75 0 0 1-1.5 0V9.787a.75.75 0 0 1 1.5 0Z"/></svg>';
export const COPILOT_ASSIGNED_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16Zm3.78-9.72a.751.751 0 0 0-.018-1.042.751.751 0 0 0-1.042-.018L6.75 9.19 5.28 7.72a.751.751 0 0 0-1.042.018.751.751 0 0 0-.018 1.042l2 2a.75.75 0 0 0 1.06 0l4.5-4.5Z"/></svg>';
export const MERGE_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.27a2.751 2.751 0 1 1-1.5 0V5.607a2.751 2.751 0 1 1 1.95-.453ZM4.25 13.5a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM4.25 5a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z"/></svg>';
export const READY_FOR_REVIEW_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"/></svg>';
export const CLOSE_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 1 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/></svg>';

export function currentTermTheme() {
  const styles = getComputedStyle(document.documentElement);
  return {
    background: styles.getPropertyValue('--term-bg').trim() || '#111111',
    foreground: styles.getPropertyValue('--term-fg').trim() || '#dddddd',
    cursor: styles.getPropertyValue('--term-cursor').trim() || '#dddddd',
    selectionBackground: styles.getPropertyValue('--term-selection').trim() || 'rgba(120,180,255,0.30)',
  };
}

export function isLoopbackOrigin() {
  const host = (window.location.hostname || '').toLowerCase();
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
}

export function formatUptime(seconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const units = [
    ['month', 30 * 24 * 60 * 60],
    ['week', 7 * 24 * 60 * 60],
    ['day', 24 * 60 * 60],
    ['hour', 60 * 60],
    ['minute', 60],
    ['second', 1],
  ];
  for (const [label, size] of units) {
    if (totalSeconds >= size) {
      const value = Math.floor(totalSeconds / size);
      return `${value} ${label}${value === 1 ? '' : 's'}`;
    }
  }
  return '0 seconds';
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function issueHasCopilotAssigned(item) {
  if (!item || !Array.isArray(item.assignees)) return false;
  return item.assignees.some((assignee) => typeof assignee === 'string'
    && COPILOT_ISSUE_ASSIGNEE_LOGINS.has(assignee.toLowerCase()));
}

export function isPrimaryModifierPressed(keyboardEvent) {
  // AltGr presents as Ctrl+Alt on many international layouts; ignore it so
  // typing special characters does not accidentally trigger global shortcuts.
  if (keyboardEvent.getModifierState && keyboardEvent.getModifierState('AltGraph')) return false;
  const hasPrimary = keyboardEvent.metaKey || keyboardEvent.ctrlKey;
  if (!hasPrimary) return false;
  // Reject "both held" combinations and require a single primary modifier.
  if (keyboardEvent.metaKey && keyboardEvent.ctrlKey) return false;
  return true;
}

export function isOpenCard(card) {
  return !!(card && card.el && card.el.isConnected);
}

export function isTypingContext(node) {
  if (!(node instanceof Element)) return false;
  return !!node.closest('input, textarea, select, [contenteditable], [role="textbox"], .xterm-helper-textarea');
}

let modalDialogQueue = Promise.resolve();

function enqueueModalDialog(runDialog) {
  const pending = modalDialogQueue.then(runDialog, runDialog);
  modalDialogQueue = pending.catch(() => {});
  return pending;
}

export function showConfirmDialog({
  title = 'Confirm action',
  message = 'Are you sure?',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
} = {}) {
  const runDialog = () => new Promise((resolve) => {
    const dialog = $('#confirm-dialog');
    const titleEl = $('#confirm-dialog-title');
    const messageEl = $('#confirm-dialog-message');
    const confirmBtn = $('#confirm-dialog-confirm');
    const cancelBtn = $('#confirm-dialog-cancel');
    if (!dialog || !titleEl || !messageEl || !confirmBtn || !cancelBtn || typeof dialog.showModal !== 'function') {
      resolve(window.confirm(String(message || 'Are you sure?')));
      return;
    }
    titleEl.textContent = title;
    messageEl.textContent = message;
    confirmBtn.textContent = confirmLabel;
    cancelBtn.textContent = cancelLabel;
    confirmBtn.classList.toggle('danger', !!danger);

    const onClose = () => {
      dialog.removeEventListener('close', onClose);
      resolve(dialog.returnValue === 'confirm');
    };
    dialog.addEventListener('close', onClose);
    try {
      dialog.showModal();
      requestAnimationFrame(() => confirmBtn.focus());
    } catch (_) {
      dialog.removeEventListener('close', onClose);
      resolve(window.confirm(String(message || 'Are you sure?')));
    }
  });

  return enqueueModalDialog(runDialog);
}

export function showPromptDialog({
  title = 'Enter a value',
  message = '',
  label = 'Value',
  defaultValue = '',
  placeholder = '',
  confirmLabel = 'Save',
  cancelLabel = 'Cancel',
} = {}) {
  const runDialog = () => new Promise((resolve) => {
    const dialog = $('#prompt-dialog');
    const titleEl = $('#prompt-dialog-title');
    const messageEl = $('#prompt-dialog-message');
    const labelEl = $('#prompt-dialog-label');
    const inputEl = $('#prompt-dialog-input');
    const closeBtn = $('#prompt-dialog-close');
    const confirmBtn = $('#prompt-dialog-confirm');
    const cancelBtn = $('#prompt-dialog-cancel');
    if (!dialog || !titleEl || !messageEl || !labelEl || !inputEl || !closeBtn || !confirmBtn || !cancelBtn || typeof dialog.showModal !== 'function') {
      resolve(window.prompt(String(title || message || label || 'Enter a value'), defaultValue));
      return;
    }

    titleEl.textContent = title;
    messageEl.textContent = message;
    messageEl.hidden = !message;
    labelEl.textContent = label;
    inputEl.value = defaultValue;
    inputEl.placeholder = placeholder;
    confirmBtn.textContent = confirmLabel;
    cancelBtn.textContent = cancelLabel;

    const syncState = () => {
      confirmBtn.disabled = !inputEl.value.trim();
    };

    const onCancel = () => {
      dialog.close('cancel');
    };

    const onClose = () => {
      dialog.removeEventListener('close', onClose);
      inputEl.removeEventListener('input', syncState);
      closeBtn.removeEventListener('click', onCancel);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(dialog.returnValue === 'confirm' ? inputEl.value : null);
    };

    inputEl.addEventListener('input', syncState);
    closeBtn.addEventListener('click', onCancel);
    cancelBtn.addEventListener('click', onCancel);
    dialog.addEventListener('close', onClose);
    syncState();

    try {
      dialog.showModal();
      requestAnimationFrame(() => {
        inputEl.focus();
        inputEl.select();
      });
    } catch (_) {
      try {
        if (dialog.open) dialog.close('cancel');
      } catch (_) {}
      dialog.removeEventListener('close', onClose);
      inputEl.removeEventListener('input', syncState);
      closeBtn.removeEventListener('click', onCancel);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(window.prompt(String(title || message || label || 'Enter a value'), defaultValue));
    }
  });

  return enqueueModalDialog(runDialog);
}

export function showErrorToast(message, timeoutMs = 4200) {
  const host = $('#toast-stack');
  if (!host) return;
  const toast = document.createElement('div');
  toast.className = 'toast toast-error';
  toast.setAttribute('role', 'alert');
  toast.textContent = message || 'Something went wrong.';
  host.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  const dismiss = () => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 180);
  };
  setTimeout(dismiss, timeoutMs);
}

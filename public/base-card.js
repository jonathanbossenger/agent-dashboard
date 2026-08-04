// BaseCard — shared terminal lifecycle for Card and TerminalCard.
// Subclasses must set the following instance properties before calling any
// BaseCard method: this.el, this.termEl, this.statusEl, this.expandBtn.
// Subclasses that need sendRaw / fitAndResize / initTerminal must expose a
// `currentTaskId` property (own data property or getter).

import { currentTermTheme, currentTermFontSize, TERM_SCROLLBACK_LINES } from './utils.js';

export class BaseCard {
  // Must be called AFTER the card element is attached to the DOM so the
  // FitAddon can measure the container.
  initTerminal() {
    this.term = new Terminal({
      theme: currentTermTheme(),
      fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
      fontSize: currentTermFontSize(),
      cursorBlink: true,
      convertEol: true,
      scrollback: TERM_SCROLLBACK_LINES,
    });
    this.fitAddon = new FitAddon.FitAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.open(this.termEl);

    // User keystrokes → server stdin (only when a task is live).
    this.term.onData((data) => {
      if (this.currentTaskId) this.sendRaw(data);
    });

    // Refit + push new size to the PTY when the container changes.
    this.resizeObserver = new ResizeObserver(() => this.fitAndResize());
    this.resizeObserver.observe(this.termEl);
    requestAnimationFrame(() => this.fitAndResize());
  }

  fitAndResize() {
    if (!this.fitAddon || !this.termEl.isConnected) return;
    if (this.termEl.clientWidth === 0 || this.termEl.clientHeight === 0) return;
    try { this.fitAddon.fit(); } catch (_) { return; }
    const cols = this.term.cols;
    const rows = this.term.rows;
    const sizeSignature = `${cols}x${rows}`;
    if (sizeSignature === this.lastSentSize) return;
    this.lastSentSize = sizeSignature;
    if (!this.currentTaskId) return;
    fetch(`/api/tasks/${this.currentTaskId}/resize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cols, rows }),
    }).catch(() => {});
  }

  applyTermTheme() {
    if (this.term) this.term.options.theme = currentTermTheme();
  }

  applyTermFontSize() {
    if (this.term) {
      this.term.options.fontSize = currentTermFontSize();
      requestAnimationFrame(() => this.fitAndResize());
    }
  }

  setStatus(text, cls) {
    this.statusEl.textContent = text;
    this.statusEl.className = 'card-status' + (cls ? ' ' + cls : '');
  }

  sendRaw(data) {
    if (!this.currentTaskId) return;
    fetch(`/api/tasks/${this.currentTaskId}/input`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data }),
    }).catch(() => {});
  }

  toggleExpand() {
    const main = document.querySelector('#cards');
    const willExpand = !this.el.classList.contains('expanded');
    const applyExpand = () => {
      for (const cardEl of main.querySelectorAll('.card')) {
        cardEl.classList.remove('expanded');
      }
      if (willExpand) {
        this.el.classList.add('expanded');
        main.classList.add('has-expanded');
        this.expandBtn.innerHTML = '&#x2921;';
        this.expandBtn.title = 'Collapse';
      } else {
        main.classList.remove('has-expanded');
        this.expandBtn.innerHTML = '&#x2922;';
        this.expandBtn.title = 'Expand';
      }
    };
    if (!document.startViewTransition) { applyExpand(); return; }
    this.el.style.viewTransitionName = 'card-active';
    const transition = document.startViewTransition(applyExpand);
    transition.finished.finally(() => { this.el.style.viewTransitionName = ''; });
  }
}

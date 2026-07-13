import { BaseCard } from './base-card.js';
import {
  $, isOpenCard, GITHUB_BTN_LABEL_BROWSE, GITHUB_BTN_LABEL_CREATE,
  NEW_GITHUB_REPO_URL, RESTORE_RESUME_RETRY_DELAY_MS, showConfirmDialog,
} from './utils.js';
import {
  cards, termCards, agentsById, appState,
  fillAgentSelect, toTildePath, clearActiveCardIfMatch,
} from './state.js';
import { enableCardDragging } from './drag.js';

export class Card extends BaseCard {
  constructor() {
    super();
    const template = $('#card-template');
    this.el = template.content.firstElementChild.cloneNode(true);
    this.agentSelect = $('.card-agent', this.el);
    this.cwd = $('.card-cwd', this.el);
    this.cwdBrowse = $('.card-cwd-browse', this.el);
    this.githubBtn = $('.card-github', this.el);
    this.runBtn = $('.card-run', this.el);
    this.openTermBtn = $('.card-open-term', this.el);
    this.openEditorBtn = $('.card-open-editor', this.el);
    this.cloneBtn = $('.card-clone', this.el);
    this.closeBtn = $('.card-close', this.el);
    this.expandBtn = $('.card-expand', this.el);
    this.statusEl = $('.card-status', this.el);
    this.termEl = $('.card-term', this.el);
    this.taskForm = $('.card-form', this.el);
    this.headerEl = $('.card-header', this.el);
    this.dragHandleEl = $('.card-drag-handle', this.el);

    this.taskIds = new Set();
    this.currentTaskId = null;
    this.lastTaskId = null;
    this.currentSource = null;
    this.lastEventId = null;
    this._reconnecting = false;
    this._errorCheckPending = false;
    this.term = null;
    this.fitAddon = null;
    this.resizeObserver = null;
    this.lastSentSize = null;
    this._checkGitHubTimer = null;
    this._killForCwdTimer = null;
    this._githubAbortCtrl = null;
    this._killRequestedTaskId = null;
    this._runningTaskCwd = '';
    this.githubUrl = '';
    this.linkedTerminalCard = null;
    this.linkedGitHubCard = null;

    this.refreshAgentSelect();

    this.taskForm.addEventListener('submit', (submitEvent) => { submitEvent.preventDefault(); if (!this.currentTaskId) this.run(); });
    this.runBtn.addEventListener('click', (clickEvent) => {
      if (!this.currentTaskId) return;
      clickEvent.preventDefault();
      this.kill().catch((err) => {
        this.setStatus(err.message || 'kill failed', 'err');
        console.error('[concilium] kill failed:', err);
      });
    });
    this.cwdBrowse.addEventListener('click', () => this.browseCwd());
    this.closeBtn.addEventListener('click', () => this.close());
    this.expandBtn.addEventListener('click', () => this.toggleExpand());
    this.openTermBtn.addEventListener('click', () => this.openTerminalCard());
    this.openEditorBtn.addEventListener('click', () => this.openEditor());
    this.cloneBtn.addEventListener('click', () => appState.addCard({ afterEl: this.el, agentId: this.agentSelect.value, cwd: this.cwd.value, autoRun: true }));
    this.githubBtn.addEventListener('click', () => this.openGitHubCard());
    this.agentSelect.addEventListener('change', () => appState.saveLayout());
    this.cwd.addEventListener('input', () => {
      appState.saveLayout();
      this.updatePreferredEditorButton();
      this.scheduleCheckGitHub();
      this.scheduleKillForCwdChange();
    });
    this.cwd.addEventListener('keydown', (keyboardEvent) => {
      if (keyboardEvent.key === 'Enter' && !this.currentTaskId) {
        keyboardEvent.preventDefault();
        this.run();
      }
    });
    enableCardDragging(this.el, this.dragHandleEl || this.headerEl);

    cards.add(this);
    this.syncLinkedCardButtons();
    this.updatePreferredEditorButton();
  }

  // Must be called AFTER the card element is attached to the DOM.
  initTerminal() {
    super.initTerminal();
    this.term.writeln('\x1b[2m(select an agent and click Start)\x1b[0m');
  }

  refreshAgentSelect() {
    fillAgentSelect(this.agentSelect, this.agentSelect.value);
  }

  setRunning(running) {
    const label = running ? 'Kill' : 'Start';
    this.runBtn.innerHTML = `<span aria-hidden="true">${running ? '⏹' : '▶'}</span>`;
    this.runBtn.title = label;
    this.runBtn.setAttribute('aria-label', label);
    this.runBtn.classList.toggle('card-kill', running);
    if (running) this.term.focus();
  }

  setGitHubBtnMode(mode) {
    if (mode === 'hidden') {
      this.githubBtn.hidden = true;
      this.githubBtn.disabled = false;
      return;
    }
    const label = mode === 'browse' ? GITHUB_BTN_LABEL_BROWSE : GITHUB_BTN_LABEL_CREATE;
    this.githubBtn.title = label;
    this.githubBtn.setAttribute('aria-label', label);
    this.githubBtn.hidden = false;
    this.syncLinkedCardButtons();
  }

  syncLinkedCardButtons() {
    this.openTermBtn.disabled = isOpenCard(this.linkedTerminalCard);
    this.githubBtn.disabled = !this.githubBtn.hidden && isOpenCard(this.linkedGitHubCard);
  }

  focusLinkedCard(card) {
    if (!isOpenCard(card)) return;
    appState.activeCardEl = card.el;
    card.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (typeof card.term?.focus === 'function') card.term.focus();
  }

  releaseLinkedTerminalCard(card) {
    if (this.linkedTerminalCard !== card) return;
    this.linkedTerminalCard = null;
    this.syncLinkedCardButtons();
  }

  releaseLinkedGitHubCard(card) {
    if (this.linkedGitHubCard !== card) return;
    this.linkedGitHubCard = null;
    this.syncLinkedCardButtons();
  }

  openTerminalCard() {
    if (isOpenCard(this.linkedTerminalCard)) {
      this.focusLinkedCard(this.linkedTerminalCard);
      return this.linkedTerminalCard;
    }
    const card = appState.addTerminalCard({ cwd: this.cwd.value.trim(), afterEl: this.el, parentCard: this });
    this.linkedTerminalCard = card;
    this.syncLinkedCardButtons();
    return card;
  }

  updatePreferredEditorButton() {
    const shouldShow = appState.canUsePreferredEditor && appState.preferredEditorConfigured;
    this.openEditorBtn.hidden = !shouldShow;
    this.openEditorBtn.disabled = !shouldShow || !this.cwd.value.trim();
  }

  async openEditor() {
    const directoryPath = this.cwd.value.trim();
    if (!directoryPath) return;
    this.openEditorBtn.disabled = true;
    try {
      const response = await fetch('/api/system/open-editor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: directoryPath }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        this.setStatus(data.error || 'editor failed', 'err');
      }
    } catch (err) {
      console.error('[concilium] openEditor failed:', err);
      this.setStatus('editor failed', 'err');
    } finally {
      this.updatePreferredEditorButton();
    }
  }

  async run() {
    const agentId = this.agentSelect.value;
    if (!agentId) { this.setStatus('select an agent', 'err'); return { ok: false, error: 'select an agent' }; }

    if (this.currentSource) { this.currentSource.close(); this.currentSource = null; }
    this.term.reset();
    this.lastEventId = null;
    this._reconnecting = false;
    this._errorCheckPending = false;
    this.lastSentSize = null;
    this._killRequestedTaskId = null;
    clearTimeout(this._killForCwdTimer);
    this._killForCwdTimer = null;
    this._runningTaskCwd = '';

    const body = { agent_id: agentId };
    const cwd = this.cwd.value.trim();
    if (cwd) body.cwd = cwd;
    if (this.fitAddon && this.termEl.isConnected) {
      try { this.fitAddon.fit(); } catch (_) {}
    }
    if (this.term?.cols > 0 && this.term?.rows > 0) {
      body.cols = this.term.cols;
      body.rows = this.term.rows;
    }

    const response = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) {
      const error = data.error || 'failed';
      this.setStatus(error, 'err');
      return { ok: false, error };
    }

    this.taskIds.add(data.task_id);
    this.lastTaskId = data.task_id;
    this._runningTaskCwd = cwd;
    appState.saveLayout();
    this.attach(data.task_id);
    // Push our current dimensions to the freshly spawned PTY.
    this.fitAndResize();
    return { ok: true };
  }

  attach(taskId, taskHint = null) {
    this.currentTaskId = taskId;
    if (taskHint && typeof taskHint.cwd === 'string') this._runningTaskCwd = taskHint.cwd.trim();
    // A new source supersedes any previous recovery state — onopen for the new
    // source must not overwrite the status that attach() is about to set.
    this._reconnecting = false;
    // When restoring a finished task, don't pretend it is still running.
    // taskHint is the task row passed in by restoreLayout (already fetched);
    // null means a freshly-launched task, which is always live.
    const isLive = !taskHint || taskHint.status === 'running';
    this.setStatus(isLive ? 'task running…' : 'task restoring…', isLive ? 'running' : undefined);
    this.setRunning(isLive);

    // Include ?since= when we already have a lastEventId (SQLite row id) so
    // the server skips events the terminal has already rendered (avoids
    // duplicate output on manual reconnect after the EventSource was recreated).
    const streamUrl = this.lastEventId !== null
      ? `/api/stream/${taskId}?since=${this.lastEventId}`
      : `/api/stream/${taskId}`;
    const eventSource = new EventSource(streamUrl);
    this.currentSource = eventSource;

    // Restore running status when the EventSource (re)opens successfully.
    // Only do this when recovering from an onerror — on the initial connect
    // attach() has already set the correct status above.
    eventSource.onopen = () => {
      if (this.currentTaskId === taskId && this._reconnecting) {
        this._reconnecting = false;
        this.setStatus('task running…', 'running');
      }
    };

    eventSource.addEventListener('output', (messageEvent) => {
      let outputEvent;
      try { outputEvent = JSON.parse(messageEvent.data); } catch (_) { return; }
      // Skip stdin events: the PTY echoes user input back as stdout, so
      // rendering stdin would double-print every keystroke.
      if (outputEvent.stream === 'stdin') return;
      // Track the latest row id so we can resume from here if the stream is
      // interrupted and the EventSource needs to be recreated (?since=).
      if (outputEvent.id) this.lastEventId = outputEvent.id;
      this.term.write(outputEvent.data);
    });
    eventSource.addEventListener('end', (messageEvent) => {
      let exitInfo = {};
      try { exitInfo = JSON.parse(messageEvent.data); } catch (_) {}
      const exitLine = `\r\n\x1b[2m[exit ${exitInfo.exitCode ?? '?'}${exitInfo.signal ? ' ' + exitInfo.signal : ''}]\x1b[0m\r\n`;
      this.term.write(exitLine);
      this.setStatus(`task ${exitInfo.status || 'ended'}`, exitInfo.status === 'done' ? 'ok' : 'err');
      this.setRunning(false);
      eventSource.close();
      if (this.currentSource === eventSource) this.currentSource = null;
      this.currentTaskId = null;
      this._killRequestedTaskId = null;
      this._runningTaskCwd = '';
    });
    eventSource.onerror = () => {
      const capturedTaskId = this.currentTaskId;
      if (!capturedTaskId) { this.setRunning(false); return; }
      // Show reconnecting status but do NOT close the EventSource — the browser
      // will automatically retry (sending Last-Event-ID so the server skips
      // already-delivered events). This handles the common case of a laptop
      // sleeping/locking which causes ERR_NETWORK_IO_SUSPENDED.
      this._reconnecting = true;
      this.setStatus('task reconnecting…', 'warn');
      // Guard against multiple in-flight checks during extended backoff retries.
      if (this._errorCheckPending) return;
      this._errorCheckPending = true;
      // Re-fetch to check whether the task still exists. Close only on 404.
      fetch(`/api/tasks/${capturedTaskId}`).then((checkResponse) => {
        this._errorCheckPending = false;
        if (this.currentTaskId !== capturedTaskId) return; // superseded
        if (!checkResponse.ok) {
          // Task is gone — nothing to reconnect to.
          eventSource.close();
          if (this.currentSource === eventSource) this.currentSource = null;
          this.setStatus('task lost connection', 'err');
          this.currentTaskId = null;
          this._killRequestedTaskId = null;
          this._runningTaskCwd = '';
          this.setRunning(false);
        }
        // Task still alive — EventSource will reconnect on its own.
      }).catch(() => {
        this._errorCheckPending = false;
        // fetch also failed — network is down; EventSource will keep retrying.
        if (this.currentTaskId !== capturedTaskId) return; // superseded
        this.setStatus('task reconnecting…', 'warn');
      });
    };
  }

  // Force-reconnect the stream for the current task. Called when the page
  // becomes visible again or the network comes back online after a device
  // sleep/lock, in case the EventSource ended up in a permanently closed state
  // rather than auto-reconnecting.
  async reconnectStream() {
    if (!this.currentTaskId) return;
    if (this.currentSource && this.currentSource.readyState !== EventSource.CLOSED) return;
    if (this.currentSource) {
      this.currentSource.close();
      this.currentSource = null;
    }
    const taskId = this.currentTaskId;
    let taskData;
    try {
      const response = await fetch(`/api/tasks/${taskId}`);
      if (this.currentTaskId !== taskId) return; // superseded
      if (!response.ok) {
        this.setStatus('task lost connection', 'err');
        this.currentTaskId = null;
        this._killRequestedTaskId = null;
        this._runningTaskCwd = '';
        this.setRunning(false);
        return;
      }
      taskData = await response.json();
    } catch (_) {
      if (this.currentTaskId !== taskId) return; // superseded
      // Network still down — attach optimistically; onerror will keep retrying.
      taskData = { status: 'running' };
    }
    if (this.currentTaskId !== taskId) return; // superseded
    // Re-attach using the real task status. lastEventId is preserved so the new
    // EventSource URL includes ?since= and avoids duplicate terminal output.
    this.attach(taskId, taskData);
  }

  async browseCwd() {
    this.cwdBrowse.disabled = true;
    try {
      let selectedPath = '';
      if (appState.publicServer && typeof appState.browseDirectory === 'function') {
        selectedPath = await appState.browseDirectory(this.cwd.value.trim()) || '';
      } else {
        const response = await fetch('/api/system/pick-directory', { method: 'POST' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) { this.setStatus(data.error || 'browse failed', 'err'); return; }
        selectedPath = data.path || '';
      }
      if (!selectedPath) return;
      this.cwd.value = toTildePath(selectedPath);
      this.updatePreferredEditorButton();
      appState.saveLayout();
      this.checkGitHub();
      // Programmatic .value updates do not fire input events.
      this.scheduleKillForCwdChange();
    } finally {
      this.cwdBrowse.disabled = false;
    }
  }

  scheduleCheckGitHub() {
    clearTimeout(this._checkGitHubTimer);
    this._checkGitHubTimer = setTimeout(() => this.checkGitHub(), 150);
  }

  scheduleKillForCwdChange() {
    clearTimeout(this._killForCwdTimer);
    this._killForCwdTimer = setTimeout(() => this.killForCwdChange(), 150);
  }

  async checkGitHub() {
    const directoryPath = this.cwd.value.trim();
    if (!directoryPath) { this.githubUrl = ''; this.setGitHubBtnMode('hidden'); return; }
    // Cancel any in-flight request so stale responses don't overwrite newer results.
    if (this._githubAbortCtrl) this._githubAbortCtrl.abort();
    this._githubAbortCtrl = new AbortController();
    const { signal } = this._githubAbortCtrl;
    try {
      const response = await fetch('/api/system/github-url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: directoryPath }),
        signal,
      });
      if (!response.ok) { this.githubUrl = ''; this.setGitHubBtnMode('create'); return; }
      const data = await response.json().catch(() => ({}));
      if (data.url) {
        this.githubUrl = data.url;
        this.setGitHubBtnMode('browse');
      } else {
        this.githubUrl = '';
        this.setGitHubBtnMode('create');
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('[concilium] checkGitHub failed:', err);
      this.githubUrl = '';
      this.setGitHubBtnMode('create');
    }
  }

  openGitHubCard() {
    if (!this.githubUrl) {
      window.open(NEW_GITHUB_REPO_URL, '_blank', 'noopener,noreferrer');
      return null;
    }
    if (isOpenCard(this.linkedGitHubCard)) {
      this.focusLinkedCard(this.linkedGitHubCard);
      return this.linkedGitHubCard;
    }
    const card = appState.addGitHubCard({ afterEl: this.el, repoUrl: this.githubUrl, parentCard: this });
    this.linkedGitHubCard = card;
    this.syncLinkedCardButtons();
    return card;
  }

  killForCwdChange() {
    if (!this.currentTaskId) return;
    const nextCwd = this.cwd.value.trim();
    if (nextCwd === this._runningTaskCwd) return;
    if (this._killRequestedTaskId === this.currentTaskId) return;
    const taskId = this.currentTaskId;
    this._killRequestedTaskId = taskId;
    this.setStatus('killing: cwd changed…', 'warn');
    this.kill({ confirm: false }).catch((err) => {
      if (this._killRequestedTaskId !== taskId) return;
      this._killRequestedTaskId = null;
      this.setStatus('auto-kill failed', 'err');
      console.error(`[concilium] auto-kill after cwd change failed for task ${taskId}:`, err);
    });
  }

  async kill({ confirm = true } = {}) {
    if (!this.currentTaskId) return;
    if (confirm) {
      const shouldKill = await showConfirmDialog({
        title: 'Kill running task',
        message: 'Kill the currently running task?',
        confirmLabel: 'Kill',
        danger: true,
      });
      if (!shouldKill) return;
    }
    const response = await fetch(`/api/tasks/${this.currentTaskId}/kill`, { method: 'POST' });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `kill failed (${response.status})`);
    }
  }

  async close() {
    clearTimeout(this._checkGitHubTimer);
    clearTimeout(this._killForCwdTimer);
    if (this._githubAbortCtrl) this._githubAbortCtrl.abort();
    const linkedTerminalCard = this.linkedTerminalCard;
    const linkedGitHubCard = this.linkedGitHubCard;
    this.linkedTerminalCard = null;
    this.linkedGitHubCard = null;
    this._runningTaskCwd = '';
    if (this.currentSource) { this.currentSource.close(); this.currentSource = null; }
    if (this.resizeObserver) { this.resizeObserver.disconnect(); this.resizeObserver = null; }
    if (this.term) { try { this.term.dispose(); } catch (_) {} this.term = null; }
    if (this.el.classList.contains('expanded')) {
      document.querySelector('#cards').classList.remove('has-expanded');
    }
    const ids = [...this.taskIds];
    this.taskIds.clear();
    cards.delete(this);
    clearActiveCardIfMatch(this.el);
    this.el.remove();
    appState.saveLayout();
    await Promise.all([
      isOpenCard(linkedTerminalCard) ? linkedTerminalCard.close() : Promise.resolve(),
      isOpenCard(linkedGitHubCard) ? Promise.resolve(linkedGitHubCard.close()) : Promise.resolve(),
    ]);
    // Fire-and-forget deletes; server will kill any still-running tasks first.
    await Promise.all(ids.map((id) =>
      fetch(`/api/tasks/${id}`, { method: 'DELETE' }).catch(() => {})
    ));
  }
}

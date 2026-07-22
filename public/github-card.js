import { $, issueHasCopilotAssigned, isOpenCard, COPILOT_ICON_SVG, COPILOT_ASSIGNED_ICON_SVG, MERGE_ICON_SVG, READY_FOR_REVIEW_ICON_SVG, CLOSE_ICON_SVG } from './utils.js';
import { appState, clearActiveCardIfMatch } from './state.js';
import { enableCardDragging } from './drag.js';

export class GitHubCard {
  constructor(parentCard = null) {
    const template = $('#github-card-template');
    this.el = template.content.firstElementChild.cloneNode(true);
    this.titleEl = $('.card-term-label', this.el);
    this.statusEl = $('.card-status', this.el);
    this.closeBtn = $('.card-close', this.el);
    this.newIssueBtn = $('.card-new-issue', this.el);
    this.refreshBtn = $('.card-refresh', this.el);
    this.issuesEl = $('.github-issues', this.el);
    this.pullsEl = $('.github-prs', this.el);
    this.issuesLinkEl = $('.github-issues-link', this.el);
    this.pullsLinkEl = $('.github-prs-link', this.el);
    this.headerEl = $('.card-header', this.el);
    this.dragHandleEl = $('.card-drag-handle', this.el);
    this._loadAbortCtrl = null;
    this.currentUrl = '';
    this.parentCard = parentCard;

    this.closeBtn.addEventListener('click', () => this.close());
    this.newIssueBtn.addEventListener('click', () => this.openNewIssueDialog());
    this.refreshBtn.addEventListener('click', () => this.load(this.currentUrl));
    enableCardDragging(this.el, this.dragHandleEl || this.headerEl);
  }

  setStatus(text, cls) {
    this.statusEl.textContent = text;
    this.statusEl.className = 'card-status' + (cls ? ' ' + cls : '');
  }

  renderList(el, items, emptyText, { withPullActions = false, withIssueActions = false } = {}) {
    el.replaceChildren();
    if (!items.length) {
      const emptyItem = document.createElement('li');
      emptyItem.className = 'muted';
      emptyItem.textContent = emptyText;
      el.appendChild(emptyItem);
      return;
    }
    for (const item of items) {
      const listItem = document.createElement('li');
      const link = document.createElement('a');
      link.href = item.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = `#${item.number} ${item.title}`;
      link.className = 'github-list-link';
      listItem.appendChild(link);
      // Show linked issue/PR numbers (e.g. "(#11)" or "(#11, #12)") after the title.
      const linkedRefs = [
        ...(Array.isArray(item.linkedIssues) ? item.linkedIssues.map((n) => ({ n, path: 'issues' })) : []),
        ...(Array.isArray(item.linkedPulls)  ? item.linkedPulls.map((n) => ({ n, path: 'pull' }))   : []),
      ];
      if (linkedRefs.length && this.currentUrl) {
        const refsEl = document.createElement('span');
        refsEl.className = 'github-linked-refs';
        refsEl.appendChild(document.createTextNode('('));
        for (const [i, { n, path }] of linkedRefs.entries()) {
          if (i > 0) refsEl.appendChild(document.createTextNode(', '));
          const refLink = document.createElement('a');
          refLink.href = `${this.currentUrl}/${path}/${n}`;
          refLink.target = '_blank';
          refLink.rel = 'noopener noreferrer';
          refLink.textContent = `#${n}`;
          refsEl.appendChild(refLink);
        }
        refsEl.appendChild(document.createTextNode(')'));
        listItem.appendChild(refsEl);
      }
      if (Array.isArray(item.assignees) && item.assignees.length) {
        const assigneesWrap = document.createElement('span');
        assigneesWrap.className = 'github-assignees';
        for (const login of item.assignees) {
          const assigneeEl = document.createElement('span');
          assigneeEl.className = 'github-assignee';
          assigneeEl.textContent = `@${login}`;
          assigneeEl.title = `Assigned to ${login}`;
          assigneesWrap.appendChild(assigneeEl);
        }
        listItem.appendChild(assigneesWrap);
      }
      if (item.branch) {
        const branchWrap = document.createElement('span');
        branchWrap.className = 'github-branch';
        const branchCode = document.createElement('code');
        branchCode.className = 'github-branch-name';
        branchCode.textContent = item.branch;
        branchCode.title = item.branch;
        branchWrap.appendChild(branchCode);
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'github-branch-copy';
        copyBtn.setAttribute('aria-label', `Copy branch name ${item.branch}`);
        copyBtn.title = 'Copy branch name';
        copyBtn.innerHTML = '<svg height="14" width="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 010 1.5h-1.5a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-1.5a.75.75 0 011.5 0v1.5A1.75 1.75 0 019.25 16h-7.5A1.75 1.75 0 010 14.25v-7.5z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0114.25 11h-7.5A1.75 1.75 0 015 9.25v-7.5zm1.75-.25a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-7.5a.25.25 0 00-.25-.25h-7.5z"/></svg>';
        copyBtn.addEventListener('click', (clickEvent) => {
          clickEvent.preventDefault();
          clickEvent.stopPropagation();
          this.copyBranch(item.branch, copyBtn);
        });
        branchWrap.appendChild(copyBtn);
        listItem.appendChild(branchWrap);
      }
      if (withPullActions) {
        const actions = document.createElement('span');
        actions.className = 'github-pr-actions';
        if (item.draft) {
          const readyBtn = document.createElement('button');
          readyBtn.type = 'button';
          readyBtn.className = 'github-pr-action github-pr-action-ready github-pr-action-control';
          readyBtn.innerHTML = READY_FOR_REVIEW_ICON_SVG;
          readyBtn.title = 'Mark pull request ready for review';
          readyBtn.setAttribute('aria-label', 'Mark pull request ready for review');
          readyBtn.addEventListener('click', (clickEvent) => {
            clickEvent.preventDefault();
            clickEvent.stopPropagation();
            this.runMarkReadyAction(item, readyBtn);
          });
          actions.appendChild(readyBtn);
        } else {
          const methodSelect = document.createElement('select');
          methodSelect.className = 'github-pr-merge-method github-pr-action-control';
          methodSelect.title = 'Select merge method';
          const methods = [
            { value: 'merge', label: 'Merge commit' },
            { value: 'squash', label: 'Squash' },
            { value: 'rebase', label: 'Rebase' },
          ];
          for (const method of methods) {
            const option = document.createElement('option');
            option.value = method.value;
            option.textContent = method.label;
            methodSelect.appendChild(option);
          }
          actions.appendChild(methodSelect);
          const mergeBtn = document.createElement('button');
          mergeBtn.type = 'button';
          mergeBtn.className = 'github-pr-action github-pr-action-merge github-pr-action-control';
          mergeBtn.innerHTML = MERGE_ICON_SVG;
          mergeBtn.title = 'Merge pull request';
          mergeBtn.setAttribute('aria-label', 'Merge pull request');
          mergeBtn.addEventListener('click', (clickEvent) => {
            clickEvent.preventDefault();
            clickEvent.stopPropagation();
            this.runPullAction(item, mergeBtn, { action: 'merge', methodSelect });
          });
          actions.appendChild(mergeBtn);
        }
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'github-pr-action github-pr-action-close github-pr-action-control';
        closeBtn.innerHTML = CLOSE_ICON_SVG;
        closeBtn.title = 'Close pull request';
        closeBtn.setAttribute('aria-label', 'Close pull request');
        closeBtn.addEventListener('click', (clickEvent) => {
          clickEvent.preventDefault();
          clickEvent.stopPropagation();
          this.runPullAction(item, closeBtn, { action: 'close' });
        });
        actions.appendChild(closeBtn);
        listItem.appendChild(actions);
      }
      if (withIssueActions) {
        const actions = document.createElement('span');
        actions.className = 'github-issue-actions';
        if (issueHasCopilotAssigned(item)) {
          const assigned = document.createElement('span');
          assigned.className = 'github-issue-assigned';
          assigned.innerHTML = COPILOT_ASSIGNED_ICON_SVG;
          assigned.title = 'Assigned to Copilot';
          assigned.setAttribute('aria-label', 'Assigned to Copilot');
          actions.appendChild(assigned);
        } else {
          const assignBtn = document.createElement('button');
          assignBtn.type = 'button';
          assignBtn.className = 'github-issue-action github-issue-action-assign';
          assignBtn.innerHTML = COPILOT_ICON_SVG;
          assignBtn.title = 'Assign to Copilot agent';
          assignBtn.setAttribute('aria-label', 'Assign to Copilot agent');
          assignBtn.addEventListener('click', (clickEvent) => {
            clickEvent.preventDefault();
            clickEvent.stopPropagation();
            this.runIssueAction(item, assignBtn, 'assign_copilot');
          });
          actions.appendChild(assignBtn);
        }
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'github-issue-action github-issue-action-close';
        closeBtn.innerHTML = CLOSE_ICON_SVG;
        closeBtn.title = 'Close issue';
        closeBtn.setAttribute('aria-label', 'Close issue');
        closeBtn.addEventListener('click', (clickEvent) => {
          clickEvent.preventDefault();
          clickEvent.stopPropagation();
          this.runIssueAction(item, closeBtn, 'close');
        });
        actions.appendChild(closeBtn);
        listItem.appendChild(actions);
      }
      el.appendChild(listItem);
    }
  }

  async copyBranch(branch, copyButton) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(branch);
      } else {
        const fallbackTextarea = document.createElement('textarea');
        fallbackTextarea.value = branch;
        fallbackTextarea.setAttribute('readonly', '');
        fallbackTextarea.style.position = 'absolute';
        fallbackTextarea.style.left = '-9999px';
        document.body.appendChild(fallbackTextarea);
        fallbackTextarea.select();
        document.execCommand('copy');
        fallbackTextarea.remove();
      }
      copyButton.classList.add('copied');
      copyButton.title = 'Copied!';
      clearTimeout(copyButton._copyTimer);
      copyButton._copyTimer = setTimeout(() => {
        copyButton.classList.remove('copied');
        copyButton.title = 'Copy branch name';
      }, 1200);
    } catch (err) {
      console.error('[concilium] branch copy failed:', err);
    }
  }

  async runPullAction(item, actionButton, { action = 'merge', methodSelect = null } = {}) {
    const isMerge = action === 'merge';
    const actionLabel = isMerge ? 'merge' : 'close';
    const statusVerb = isMerge ? 'merging' : 'closing';
    const successVerb = isMerge ? 'merged' : 'closed';
    const mergeMethod = isMerge ? ((methodSelect && methodSelect.value) || 'merge') : undefined;
    const actionsContainer = actionButton.parentElement;
    const controls = actionsContainer ? [...actionsContainer.querySelectorAll('.github-pr-action-control')] : [actionButton];
    for (const control of controls) control.disabled = true;
    this.setStatus(`${statusVerb} #${item.number}…`, 'running');
    try {
      const response = await fetch('/api/system/github-pulls/action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: this.currentUrl,
          pullNumber: item.number,
          action,
          sha: isMerge ? (item.headSha || undefined) : undefined,
          mergeMethod: isMerge ? mergeMethod : undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        this.setStatus(data.error || `failed to ${actionLabel} #${item.number}`, 'err');
        return;
      }
      const successFallback = `pull request #${item.number} ${successVerb}`;
      this.setStatus(data.message || successFallback, 'ok');
      await this.load(this.currentUrl, { excludePullNumbers: new Set([item.number]) });
    } catch (err) {
      console.error('[concilium] pull request action failed:', err);
      this.setStatus(`failed to ${actionLabel} #${item.number}`, 'err');
    } finally {
      for (const control of controls) control.disabled = false;
    }
  }

  async runMarkReadyAction(item, readyButton) {
    if (!item.nodeId) {
      this.setStatus(`cannot mark #${item.number} ready (missing GraphQL id)`, 'err');
      return;
    }
    readyButton.disabled = true;
    this.setStatus(`marking #${item.number} ready…`, 'running');
    try {
      const response = await fetch('/api/system/github-pulls/action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: this.currentUrl,
          pullNumber: item.number,
          action: 'mark_ready',
          nodeId: item.nodeId,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        this.setStatus(data.error || `failed to mark #${item.number} ready`, 'err');
        return;
      }
      const successFallback = `pull request #${item.number} ready for review`;
      this.setStatus(data.message || successFallback, 'ok');
      await this.load(this.currentUrl);
    } catch (err) {
      console.error('[concilium] mark-ready action failed:', err);
      this.setStatus(`failed to mark #${item.number} ready`, 'err');
    } finally {
      readyButton.disabled = false;
    }
  }

  async runIssueAction(item, issueButton, action = 'assign_copilot') {
    const issueActionConfig = {
      assign_copilot: {
        progress: 'assigning',
        failureVerb: 'assign',
        successFallback: `issue #${item.number} assigned`,
      },
      close: {
        progress: 'closing',
        failureVerb: 'close',
        successFallback: `issue #${item.number} closed`,
      },
    };
    const actionConfig = issueActionConfig[action];
    if (!actionConfig) return;
    issueButton.disabled = true;
    this.setStatus(`${actionConfig.progress} #${item.number}…`, 'running');
    try {
      const response = await fetch('/api/system/github-issues/action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: this.currentUrl,
          issueNumber: item.number,
          action,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        this.setStatus(data.error || `failed to ${actionConfig.failureVerb} #${item.number}`, 'err');
        return;
      }
      this.setStatus(data.message || actionConfig.successFallback, 'ok');
      const loadOpts = action === 'close' ? { excludeIssueNumbers: new Set([item.number]) } : {};
      await this.load(this.currentUrl, loadOpts);
    } catch (err) {
      console.error('[concilium] issue action failed:', err);
      this.setStatus(`failed to ${actionConfig.failureVerb} #${item.number}`, 'err');
    } finally {
      issueButton.disabled = false;
    }
  }

  setTitle(url) {
    if (!url) return;
    const base = url.replace(/\/+$/, '');
    const short = base.replace(/^https:\/\/github\.com\//, '');
    this.titleEl.replaceChildren();
    this.titleEl.appendChild(document.createTextNode('GitHub — '));
    const repoLink = document.createElement('a');
    repoLink.href = base;
    repoLink.target = '_blank';
    repoLink.rel = 'noopener noreferrer';
    repoLink.textContent = short;
    repoLink.className = 'github-card-title-link';
    repoLink.title = `Open ${short} on GitHub`;
    this.titleEl.appendChild(repoLink);
    this.currentUrl = base;
    this.newIssueBtn.hidden = false;
    this.pullsLinkEl.href = base + '/pulls';
    this.issuesLinkEl.href = base + '/issues';
  }

  openNewIssueDialog() {
    if (!this.currentUrl) return;
    appState.openNewIssueDialog(this.currentUrl, async (issue) => {
      await this.load(this.currentUrl);
      if (issue && issue.copilotAssignmentRequested && issue.copilotAssigned === false) {
        this.setStatus('issue created (copilot assignment failed)', 'warn');
      } else {
        this.setStatus('issue created', 'ok');
      }
    });
  }

  async load(repoUrlHint = '', { excludeIssueNumbers = null, excludePullNumbers = null } = {}) {
    if (this._loadAbortCtrl) this._loadAbortCtrl.abort();
    this._loadAbortCtrl = new AbortController();
    const { signal } = this._loadAbortCtrl;
    this.setTitle(repoUrlHint);
    this.setStatus('loading…', 'running');
    this.renderList(this.issuesEl, [], 'loading…');
    this.renderList(this.pullsEl, [], 'loading…');
    this.refreshBtn.classList.add('spinning');
    this.refreshBtn.disabled = true;
    try {
      const response = await fetch('/api/system/github-items', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: repoUrlHint }),
        signal,
      });
      let data = {};
      try {
        data = await response.json();
      } catch (_) {}
      if (!response.ok) {
        this.setStatus(data.error || 'failed', 'err');
        this.renderList(this.issuesEl, [], 'unable to load');
        this.renderList(this.pullsEl, [], 'unable to load');
        return;
      }
      const url = data.url || repoUrlHint;
      this.setTitle(url);
      // GitHub's /issues?state=open and /pulls?state=open endpoints can briefly
      // include an item we just transitioned out of `open` (PATCH/PUT propagation
      // lag). When the caller knows an item should no longer appear, filter it
      // from the freshly fetched list so the UI doesn't show it as still open.
      let issues = Array.isArray(data.issues) ? data.issues : [];
      let pulls = Array.isArray(data.pulls) ? data.pulls : [];
      if (excludeIssueNumbers && excludeIssueNumbers.size) {
        issues = issues.filter((issue) => !excludeIssueNumbers.has(issue.number));
      }
      if (excludePullNumbers && excludePullNumbers.size) {
        pulls = pulls.filter((pull) => !excludePullNumbers.has(pull.number));
      }
      this.renderList(this.issuesEl, issues, 'no open issues', { withIssueActions: true });
      this.renderList(this.pullsEl, pulls, 'no open pull requests', { withPullActions: true });
      this.setStatus(data.error || data.warning || 'loaded', data.error ? 'warn' : data.warning ? 'warn' : 'ok');
    } catch (err) {
      if (err.name === 'AbortError') return;
      this.setStatus('failed', 'err');
      this.renderList(this.issuesEl, [], 'unable to load');
      this.renderList(this.pullsEl, [], 'unable to load');
    } finally {
      if (!signal.aborted) {
        this.refreshBtn.classList.remove('spinning');
        this.refreshBtn.disabled = false;
      }
    }
  }

  close() {
    if (this._loadAbortCtrl) this._loadAbortCtrl.abort();
    if (this.parentCard) this.parentCard.releaseLinkedGitHubCard(this);
    clearActiveCardIfMatch(this.el);
    if (this.el.parentNode) this.el.remove();
  }
}

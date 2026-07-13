import { $, IS_MAC, formatUptime, formatBytes, isTypingContext, isPrimaryModifierPressed, RESTORE_RESUME_RETRY_DELAY_MS, LAYOUT_SAVE_DEBOUNCE_MS, SAVED_FLASH_DURATION_MS, HEALTH_POLL_INTERVAL_MS, showConfirmDialog, showErrorToast } from './utils.js';
import { agentsById, cards, termCards, appState } from './state.js';
import { Card } from './card.js';
import { GitHubCard } from './github-card.js';
import { TerminalCard } from './terminal-card.js';
import { openGitCheatsheet, getGitCheatsheetTargetCard, clearGitCheatsheetTargetCard } from './git-cheatsheet.js';

// Wire up the git cheatsheet opener slot used by TerminalCard instances.
TerminalCard.prototype._openGitCheatsheet = function () { openGitCheatsheet(this); };
const HISTORY_TASK_FETCH_LIMIT = 1000;
const HISTORY_EMPTY_CELL = '—';

function cardInsertTarget(main, clientX, clientY) {
  const siblings = [...main.querySelectorAll('.card:not(.dragging)')];
  if (siblings.length === 0) return null;
  let closestCard = null;
  let closestRect = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const sibling of siblings) {
    const rect = sibling.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const offsetX = clientX - centerX;
    const offsetY = clientY - centerY;
    const distance = offsetX * offsetX + offsetY * offsetY;
    if (distance < closestDistance) {
      closestDistance = distance;
      closestCard = sibling;
      closestRect = rect;
    }
  }
  if (!closestCard || !closestRect) return null;
  const offsetX = clientX - (closestRect.left + closestRect.width / 2);
  const offsetY = clientY - (closestRect.top + closestRect.height / 2);
  const insertBefore = Math.abs(offsetX) > Math.abs(offsetY) ? offsetX < 0 : offsetY < 0;
  return insertBefore ? closestCard : closestCard.nextElementSibling;
}

function focusCardFromNode(node) {
  if (!(node instanceof Element)) return;
  const cardEl = node.closest('.card');
  if (cardEl) appState.activeCardEl = cardEl;
}

function activeSessionCard() {
  if (appState.activeCardEl && appState.activeCardEl.isConnected) {
    for (const card of cards) {
      if (card.el === appState.activeCardEl) return card;
    }
  }
  return cards.values().next().value || null;
}

function activeAnyCard() {
  if (appState.activeCardEl && appState.activeCardEl.isConnected) {
    for (const card of cards) {
      if (card.el === appState.activeCardEl) return card;
    }
    for (const card of termCards) {
      if (card.el === appState.activeCardEl) return card;
    }
  }
  return cards.values().next().value || termCards.values().next().value || null;
}

function triggerHeaderAction(keyboardEvent, selector) {
  const button = $(selector);
  if (!button) return false;
  keyboardEvent.preventDefault();
  button.click();
  return true;
}

function openShortcutsDialog() {
  const shortcutsDialog = $('#shortcuts-dialog');
  if (!shortcutsDialog) return;
  if (shortcutsDialog.open) return;
  try { shortcutsDialog.showModal(); } catch (_) {}
}

function handleKeyboardShortcut(keyboardEvent) {
  if (keyboardEvent.defaultPrevented || keyboardEvent.repeat || keyboardEvent.isComposing) return;
  if (!isPrimaryModifierPressed(keyboardEvent)) return;
  if (!keyboardEvent.altKey || keyboardEvent.shiftKey) return;
  if (isTypingContext(keyboardEvent.target) || isTypingContext(document.activeElement)) return;

  const keyCode = keyboardEvent.code;
  if (keyCode === 'KeyN') { keyboardEvent.preventDefault(); addCard(); return; }
  if (keyCode === 'KeyR') {
    const card = activeSessionCard();
    if (!card) return;
    keyboardEvent.preventDefault();
    if (card.currentTaskId) card.kill(); else card.run();
    return;
  }
  if (keyCode === 'Backquote') {
    const card = activeSessionCard();
    if (!card) return;
    keyboardEvent.preventDefault();
    card.openTerminalCard();
    return;
  }
  if (keyCode === 'KeyE') {
    const card = activeAnyCard();
    if (!card) return;
    keyboardEvent.preventDefault();
    card.toggleExpand();
    return;
  }
  if (keyCode === 'KeyP') { triggerHeaderAction(keyboardEvent, '#new-project-btn'); return; }
  if (keyCode === 'KeyS') { triggerHeaderAction(keyboardEvent, '#open-settings'); return; }
  if (keyCode === 'KeyT') { triggerHeaderAction(keyboardEvent, '#theme-toggle'); return; }
  if (keyCode === 'Slash') { keyboardEvent.preventDefault(); openShortcutsDialog(); }
}

async function loadHealth() {
  try {
    const response = await fetch('/api/health');
    const data = await response.json();
    const parts = [
      `pid ${data.pid}`,
      `up ${formatUptime(data.uptime)}`,
    ];
    if (Number.isFinite(data.liveTasks)) parts.push(`${data.liveTasks} live`);
    if (Number.isFinite(data.totalEvents)) parts.push(`${data.totalEvents.toLocaleString()} events`);
    if (Number.isFinite(data.logsDirBytes)) parts.push(`${formatBytes(data.logsDirBytes)} logs`);
    $('#health').textContent = parts.join(' \u00b7 ');
    if (data.homeDir) appState.homeDir = data.homeDir;
  } catch (_) {
    $('#health').textContent = 'offline';
  }
}

async function loadAgents() {
  const response = await fetch('/api/agents');
  const agents = await response.json();
  agentsById.clear();
  for (const agent of agents) agentsById.set(agent.id, agent);
  for (const card of cards) card.refreshAgentSelect();
}

function formatHistoryTimestamp(ts) {
  if (!Number.isFinite(ts)) return HISTORY_EMPTY_CELL;
  return new Date(ts).toLocaleString();
}

function isTaskFinished(task) {
  return !!(task && Number.isFinite(task.ended_at));
}

// --- card factories --------------------------------------------------------

function addTerminalCard({ cwd = '', afterEl = null, parentCard = null } = {}) {
  const card = new TerminalCard(parentCard);
  const main = $('#cards');
  if (afterEl && afterEl.parentNode === main) {
    main.insertBefore(card.el, afterEl.nextSibling);
  } else {
    main.appendChild(card.el);
  }
  card.initTerminal();
  card.launch(cwd);
  return card;
}

function addGitHubCard({ afterEl = null, repoUrl = '', parentCard = null } = {}) {
  const card = new GitHubCard(parentCard);
  const main = $('#cards');
  if (afterEl && afterEl.parentNode === main) {
    main.insertBefore(card.el, afterEl.nextSibling);
  } else {
    main.appendChild(card.el);
  }
  card.load(repoUrl);
  return card;
}

function addCard({ afterEl = null, agentId = '', cwd = '', autoRun = false } = {}) {
  const card = new Card();
  const main = $('#cards');
  if (afterEl && afterEl.parentNode === main) {
    main.insertBefore(card.el, afterEl.nextSibling);
  } else {
    main.appendChild(card.el);
  }
  card.initTerminal();
  if (agentId) card.agentSelect.value = agentId;
  if (cwd) { card.cwd.value = cwd; card.updatePreferredEditorButton(); card.checkGitHub(); }
  saveLayout();
  if (autoRun && agentId) card.run();
  return card;
}

// Register factories into appState so card classes can call them at runtime.
appState.addCard = addCard;
appState.addTerminalCard = addTerminalCard;
appState.addGitHubCard = addGitHubCard;
appState.saveLayout = () => saveLayout();
appState.openNewIssueDialog = (repoUrl, cb) => openNewIssueDialog(repoUrl, cb);

// --- session persistence ---------------------------------------------------

function currentLayoutState() {
  const order = [...$('#cards').querySelectorAll('.card')];
  const cardByElement = new Map([...cards].map((card) => [card.el, card]));
  return order
    .map((el) => cardByElement.get(el))
    .filter(Boolean)
    .map((card) => ({
      agentId: card.agentSelect.value,
      cwd: card.cwd.value,
      lastTaskId: card.lastTaskId || null,
    }));
}

let saveLayoutTimer = null;

function saveLayout() {
  if (!appState.layoutReady) return;
  clearTimeout(saveLayoutTimer);
  saveLayoutTimer = setTimeout(() => {
    fetch('/api/system/layout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(currentLayoutState()),
    }).then((response) => {
      if (!response.ok) console.error('[concilium] failed to save layout: HTTP', response.status);
    }).catch((err) => console.error('[concilium] failed to save layout:', err));
  }, LAYOUT_SAVE_DEBOUNCE_MS);
}

async function restoreLayout() {
  let savedStates;
  try {
    const response = await fetch('/api/system/layout');
    if (response.ok) savedStates = await response.json();
  } catch (err) {
    console.error('[concilium] failed to load saved layout:', err);
  }
  if (!Array.isArray(savedStates) || savedStates.length === 0) {
    addCard();
  } else {
    const entries = savedStates.map((savedState) => {
      const card = addCard({ agentId: savedState.agentId, cwd: savedState.cwd });
      return { card, savedState };
    });
    await Promise.all(entries.map(async ({ card, savedState }) => {
      if (savedState.lastTaskId) {
        card.taskIds.add(savedState.lastTaskId);
      }
      const agentMissing = savedState.agentId && !agentsById.has(savedState.agentId);
      if (!savedState.agentId) { card.setStatus('select an agent', 'warn'); return; }
      if (agentMissing) { card.setStatus(`agent "${savedState.agentId}" no longer exists`, 'err'); return; }
      const tryResume = async () => {
        try {
          const result = await card.run();
          if (result && result.ok) return null;
          const message = result && result.error ? result.error : 'resume failed \u2014 check agent configuration and retry';
          return new Error(message);
        } catch (err) { return err; }
      };
      let resumeErr = await tryResume();
      if (resumeErr) {
        await new Promise((resolve) => setTimeout(resolve, RESTORE_RESUME_RETRY_DELAY_MS));
        resumeErr = await tryResume();
      }
      if (resumeErr) {
        console.error('[concilium] failed to resume saved card session:', resumeErr);
        const detail = resumeErr.message ? `: ${resumeErr.message}` : '';
        card.setStatus(`failed to resume saved session${detail}`, 'err');
      }
    }));
  }
  appState.layoutReady = true;
}

window.addEventListener('beforeunload', () => {
  if (!appState.layoutReady) return;
  navigator.sendBeacon(
    '/api/system/layout',
    new Blob([JSON.stringify(currentLayoutState())], { type: 'application/json' }),
  );
});

$('#cards').addEventListener('dragover', (dragEvent) => {
  if (!appState.draggingCardEl) return;
  dragEvent.preventDefault();
  const main = $('#cards');
  const target = cardInsertTarget(main, dragEvent.clientX, dragEvent.clientY);
  main.insertBefore(appState.draggingCardEl, target);
});

// --- settings dialog -------------------------------------------------------

const settingsDialog = $('#settings-dialog');
const onboardingDialog = $('#onboarding-dialog');
const onboardingFirstAgentForm = $('#onboarding-first-agent-form');
const onboardingAddAgentForm = $('#onboarding-add-agent-form');
const onboardingAgentsTableBody = $('#onboarding-agents-table tbody');
const onboardingGitHubTokenForm = $('#onboarding-github-token-form');
const onboardingGitHubTokenInput = $('#onboarding-github-token');
const onboardingGitHubTokenClearBtn = $('#onboarding-github-token-clear');
const onboardingBackBtn = $('#onboarding-back');
const onboardingNextBtn = $('#onboarding-next');
const onboardingFinishBtn = $('#onboarding-finish');
const agentForm = $('#agent-form');
const preferredEditorHeading = $('#preferred-editor-heading');
const preferredEditorForm = $('#preferred-editor-form');
const preferredEditorCommandInput = $('#preferred-editor-command');
const preferredEditorArgsInput = $('#preferred-editor-args');
const preferredEditorClearBtn = $('#preferred-editor-clear');
const githubTokenForm = $('#github-token-form');
const githubTokenInput = $('#github-token');
const githubTokenClearBtn = $('#github-token-clear');
const newProjectDlg = $('#new-project-dialog');
const newProjectForm = $('#new-project-form');
const newProjectNameInput = $('#new-project-name');
const newProjectTargetInput = $('#new-project-target');
const newProjectPrivateInput = $('#new-project-private');
const newProjectBrowseBtn = $('#new-project-target-browse');
const newProjectCreateBtn = $('#new-project-create');
const newProjectStatusEl = $('#new-project-status');
const newIssueDlg = $('#new-issue-dialog');
const newIssueForm = $('#new-issue-form');
const newIssueRepoInput = $('#new-issue-repo');
const newIssueTitleInput = $('#new-issue-title');
const newIssueBodyInput = $('#new-issue-body');
const newIssueAssignCopilotInput = $('#new-issue-assign-copilot');
const newIssueCreateBtn = $('#new-issue-create');
const newIssueStatusEl = $('#new-issue-status');
const shortcutsDialog = $('#shortcuts-dialog');
const historyDialog = $('#history-dialog');
const historyTableBody = $('#history-table tbody');
const historyRefreshBtn = $('#history-refresh');
let editingId = null;
let onboardingStep = 1;
let onboardingHasAgent = false;
let onboardingHasToken = false;
let newProjectCheckAbortCtrl = null;
let newIssueRepoUrl = '';
let newIssueCreatedHook = null;

function setFormMode(mode, agent) {
  editingId = mode === 'edit' ? agent.id : null;
  $('#agent-form-title').textContent = mode === 'edit' ? `Edit agent: ${agent.id}` : 'Add agent';
  $('#agent-submit').textContent = mode === 'edit' ? 'Save' : 'Add';
  $('#agent-cancel').hidden = mode !== 'edit';
  agentForm.id.value = agent?.id || '';
  agentForm.id.disabled = mode === 'edit';
  agentForm.name.value = agent?.name || '';
  agentForm.command.value = agent?.command || '';
  agentForm.args.value = (agent?.args || []).join(' ');
  agentForm.interactive.checked = !!agent?.interactive;
}

function replayHistoryTask(task) {
  const card = addCard({ cwd: task.cwd || '' });
  if (card.term) card.term.reset();
  card.taskIds.add(task.id);
  card.lastTaskId = task.id;
  card.lastEventId = null;
  card.attach(task.id, task);
  appState.activeCardEl = card.el;
  card.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (historyDialog.open) historyDialog.close();
}

async function refreshTaskHistory() {
  if (!historyTableBody) return;
  if (historyRefreshBtn) historyRefreshBtn.disabled = true;
  try {
    const params = new URLSearchParams({ limit: String(HISTORY_TASK_FETCH_LIMIT) });
    const response = await fetch(`/api/tasks?${params}`);
    if (!response.ok) throw new Error(`Failed to fetch task history: HTTP ${response.status}`);
    const tasks = await response.json();
    const finished = Array.isArray(tasks) ? tasks.filter(isTaskFinished) : [];

    historyTableBody.replaceChildren();
    if (finished.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 6;
      cell.textContent = 'No finished tasks available.';
      cell.className = 'muted';
      row.appendChild(cell);
      historyTableBody.appendChild(row);
      return;
    }

    for (const task of finished) {
      const row = document.createElement('tr');
      const idCell = document.createElement('td');
      idCell.textContent = String(task.id);
      const agentCell = document.createElement('td');
      agentCell.textContent = task.agent_id || HISTORY_EMPTY_CELL;
      const cwdCell = document.createElement('td');
      const cwdCode = document.createElement('code');
      cwdCode.textContent = task.cwd || HISTORY_EMPTY_CELL;
      cwdCell.appendChild(cwdCode);
      const startedCell = document.createElement('td');
      startedCell.textContent = formatHistoryTimestamp(task.started_at);
      const statusCell = document.createElement('td');
      statusCell.textContent = task.status || 'unknown';
      const actionsCell = document.createElement('td');
      actionsCell.className = 'actions';
      const replayBtn = document.createElement('button');
      replayBtn.type = 'button';
      replayBtn.className = 'row-btn';
      replayBtn.textContent = 'replay';
      replayBtn.addEventListener('click', () => replayHistoryTask(task));
      actionsCell.appendChild(replayBtn);
      row.append(idCell, agentCell, cwdCell, startedCell, statusCell, actionsCell);
      historyTableBody.appendChild(row);
    }
  } catch (err) {
    console.error('[concilium] failed to load task history:', err);
    showErrorToast('Failed to load task history.');
  } finally {
    if (historyRefreshBtn) historyRefreshBtn.disabled = false;
  }
}

function refreshPreferredEditorButtons() {
  for (const card of cards) card.updatePreferredEditorButton();
}

function agentPayloadFromForm(form, includeId = false) {
  const fields = form.elements;
  const payload = {
    name: fields.name.value.trim() || fields.id.value.trim(),
    command: fields.command.value.trim(),
    interactive: fields.interactive.checked,
    args: fields.args.value.trim() ? fields.args.value.trim().split(/\s+/) : [],
  };
  if (includeId) payload.id = fields.id.value.trim();
  return payload;
}

async function refreshAgentsTable() {
  const response = await fetch('/api/agents');
  const agents = await response.json();
  const tbody = $('#agents-table tbody');
  tbody.replaceChildren();
  for (const agent of agents) {
    const row = document.createElement('tr');
    const tdId = document.createElement('td'); tdId.textContent = agent.id;
    const tdName = document.createElement('td'); tdName.textContent = agent.name || '';
    const tdCmd = document.createElement('td');
    const cmdCode = document.createElement('code');
    cmdCode.textContent = agent.command + (agent.args ? ' ' + agent.args.join(' ') : '');
    tdCmd.appendChild(cmdCode);
    const tdMode = document.createElement('td'); tdMode.textContent = agent.interactive ? 'PTY' : 'piped';
    const actions = document.createElement('td'); actions.className = 'actions';
    row.append(tdId, tdName, tdCmd, tdMode, actions);
    const editBtn = document.createElement('button');
    editBtn.type = 'button'; editBtn.className = 'row-btn'; editBtn.textContent = 'edit';
    editBtn.addEventListener('click', () => setFormMode('edit', agent));
    const delBtn = document.createElement('button');
    delBtn.type = 'button'; delBtn.className = 'row-btn danger'; delBtn.textContent = 'delete';
    delBtn.addEventListener('click', async () => {
      const shouldDelete = await showConfirmDialog({
        title: 'Delete agent',
        message: `Delete agent "${agent.id}"?`,
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!shouldDelete) return;
      const deleteResponse = await fetch(`/api/agents/${encodeURIComponent(agent.id)}`, { method: 'DELETE' });
      if (!deleteResponse.ok) { showErrorToast('delete failed'); return; }
      await refreshAgentsTable();
      await loadAgents();
    });
    actions.append(editBtn, delBtn);
    tbody.appendChild(row);
  }
}

async function listAgents() {
  const response = await fetch('/api/agents');
  return response.json();
}

async function addAgent(payload) {
  const response = await fetch('/api/agents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'save failed');
  }
}

function setOnboardingStep(step) {
  onboardingStep = Math.max(1, Math.min(4, step));
  for (const section of onboardingDialog.querySelectorAll('.onboarding-step')) {
    section.hidden = Number(section.dataset.step) !== onboardingStep;
  }
  onboardingBackBtn.disabled = onboardingStep === 1;
  onboardingNextBtn.hidden = onboardingStep === 4;
  onboardingNextBtn.disabled = (onboardingStep === 1 || onboardingStep === 2) && !onboardingHasAgent;
  onboardingFinishBtn.hidden = onboardingStep !== 4;
  onboardingFinishBtn.disabled = !onboardingHasAgent;
}

async function refreshOnboardingAgentsTable() {
  const agents = await listAgents();
  onboardingAgentsTableBody.replaceChildren();
  for (const agent of agents) {
    const row = document.createElement('tr');
    const tdId = document.createElement('td'); tdId.textContent = agent.id;
    const tdName = document.createElement('td'); tdName.textContent = agent.name || '';
    const tdCmd = document.createElement('td');
    const cmdCode = document.createElement('code');
    cmdCode.textContent = agent.command + (agent.args ? ' ' + agent.args.join(' ') : '');
    tdCmd.appendChild(cmdCode);
    const tdMode = document.createElement('td'); tdMode.textContent = agent.interactive ? 'PTY' : 'piped';
    const actions = document.createElement('td'); actions.className = 'actions';
    row.append(tdId, tdName, tdCmd, tdMode, actions);
    const delBtn = document.createElement('button');
    delBtn.type = 'button'; delBtn.className = 'row-btn danger'; delBtn.textContent = 'delete';
    delBtn.addEventListener('click', async () => {
      const shouldDelete = await showConfirmDialog({
        title: 'Delete agent',
        message: `Delete agent "${agent.id}"?`,
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!shouldDelete) return;
      const deleteResponse = await fetch(`/api/agents/${encodeURIComponent(agent.id)}`, { method: 'DELETE' });
      if (!deleteResponse.ok) { showErrorToast('delete failed'); return; }
      await Promise.all([refreshOnboardingAgentsTable(), refreshAgentsTable(), loadAgents()]);
    });
    actions.appendChild(delBtn);
    onboardingAgentsTableBody.appendChild(row);
  }
  onboardingHasAgent = agents.length > 0;
  setOnboardingStep(onboardingStep);
}

async function refreshOnboardingTokenState() {
  const response = await fetch('/api/system/github-token');
  if (!response.ok) {
    console.error('[concilium] failed to fetch onboarding token state: HTTP', response.status);
    onboardingHasToken = false;
    onboardingGitHubTokenInput.placeholder = 'github_pat_...';
    return;
  }
  const data = await response.json().catch(() => ({}));
  onboardingHasToken = data.hasToken === true;
  onboardingGitHubTokenInput.placeholder = onboardingHasToken ? 'token already saved' : 'github_pat_...';
}

async function maybeStartOnboarding() {
  const response = await fetch('/api/system/onboarding');
  if (!response.ok) return;
  const data = await response.json().catch(() => ({}));
  if (!data.needsOnboarding) return;
  onboardingFirstAgentForm.reset();
  onboardingAddAgentForm.reset();
  onboardingGitHubTokenInput.value = '';
  onboardingHasToken = data.hasToken === true;
  onboardingGitHubTokenInput.placeholder = onboardingHasToken ? 'token already saved' : 'github_pat_...';
  setOnboardingStep(1);
  await refreshOnboardingAgentsTable();
  onboardingDialog.showModal();
  onboardingFirstAgentForm.elements.id.focus();
}

async function refreshDiscoverTable() {
  const discoverResponse = await fetch('/api/agents/discover');
  const discoveredAgents = await discoverResponse.json();
  const existingAgentsResponse = await fetch('/api/agents');
  const existingIds = new Set((await existingAgentsResponse.json()).map((agent) => agent.id));
  const tbody = $('#discover-table tbody');
  tbody.replaceChildren();
  for (const discovered of discoveredAgents) {
    const row = document.createElement('tr');
    const tdId = document.createElement('td'); tdId.textContent = discovered.id;
    const tdCmd = document.createElement('td');
    const cmdCode = document.createElement('code'); cmdCode.textContent = discovered.command;
    tdCmd.appendChild(cmdCode);
    const tdPath = document.createElement('td');
    const pathSpan = document.createElement('span');
    if (discovered.found) { pathSpan.className = 'found'; pathSpan.textContent = discovered.found; }
    else {
      pathSpan.className = 'muted';
      pathSpan.textContent = 'not found';
      if (typeof discovered.searchedPath === 'string' && discovered.searchedPath) {
        pathSpan.title = `Searched PATH: ${discovered.searchedPath}`;
      }
    }
    tdPath.appendChild(pathSpan);
    const actions = document.createElement('td'); actions.className = 'actions';
    row.append(tdId, tdCmd, tdPath, actions);
    if (discovered.found && !existingIds.has(discovered.id)) {
      const addBtn = document.createElement('button');
      addBtn.type = 'button'; addBtn.className = 'row-btn'; addBtn.textContent = 'add';
      addBtn.addEventListener('click', async () => {
        const addResponse = await fetch('/api/agents', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: discovered.id, name: discovered.name, command: discovered.found, interactive: discovered.interactive }),
        });
        if (!addResponse.ok) { showErrorToast('add failed'); return; }
        await refreshAgentsTable();
        await refreshDiscoverTable();
        await loadAgents();
      });
      actions.appendChild(addBtn);
    } else if (existingIds.has(discovered.id)) {
      const alreadyAdded = document.createElement('span');
      alreadyAdded.className = 'muted'; alreadyAdded.textContent = 'already added';
      actions.appendChild(alreadyAdded);
    }
    tbody.appendChild(row);
  }
}

async function loadGitHubToken() {
  const response = await fetch('/api/system/github-token');
  githubTokenInput.value = '';
  githubTokenInput.placeholder = 'github_pat_...';
  if (!response.ok) return;
  const data = await response.json().catch((err) => {
    console.error('[concilium] failed to parse github-token response:', err);
    return {};
  });
  if (data.hasToken === true) githubTokenInput.placeholder = 'token already saved';
}

async function loadPreferredEditorSettings() {
  preferredEditorHeading.hidden = !appState.canUsePreferredEditor;
  preferredEditorForm.hidden = !appState.canUsePreferredEditor;
  preferredEditorCommandInput.value = '';
  preferredEditorArgsInput.value = '';
  appState.preferredEditorConfigured = false;
  if (!appState.canUsePreferredEditor) { refreshPreferredEditorButtons(); return; }
  const response = await fetch('/api/system/preferred-editor');
  if (!response.ok) { refreshPreferredEditorButtons(); return; }
  const data = await response.json().catch(() => ({}));
  if (data.available !== true) {
    preferredEditorHeading.hidden = true;
    preferredEditorForm.hidden = true;
    appState.canUsePreferredEditor = false;
    refreshPreferredEditorButtons();
    return;
  }
  const editor = data.preferredEditor && typeof data.preferredEditor === 'object' ? data.preferredEditor : {};
  preferredEditorCommandInput.value = typeof editor.command === 'string' ? editor.command : '';
  preferredEditorArgsInput.value = Array.isArray(editor.args) ? editor.args.join(' ') : '';
  appState.preferredEditorConfigured = data.configured === true;
  refreshPreferredEditorButtons();
}

function setNewProjectStatus(text, cls = '') {
  newProjectStatusEl.textContent = text;
  newProjectStatusEl.classList.remove('ok', 'warn', 'err');
  if (cls) newProjectStatusEl.classList.add(cls);
}

function updateNewProjectCreateState() {
  newProjectCreateBtn.disabled = !(newProjectNameInput.value.trim() && newProjectTargetInput.value.trim());
}

function setNewIssueStatus(text, cls = '') {
  newIssueStatusEl.textContent = text;
  newIssueStatusEl.classList.remove('ok', 'warn', 'err');
  if (cls) newIssueStatusEl.classList.add(cls);
}

function updateNewIssueCreateState() {
  newIssueCreateBtn.disabled = !newIssueTitleInput.value.trim();
}

function openNewIssueDialog(repoUrl, onCreated = null) {
  const base = (repoUrl || '').replace(/\/+$/, '');
  if (!base) return;
  newIssueRepoUrl = base;
  newIssueCreatedHook = typeof onCreated === 'function' ? onCreated : null;
  newIssueForm.reset();
  newIssueRepoInput.value = base.replace(/^https:\/\/github\.com\//, '');
  setNewIssueStatus('Enter a title to create an issue.');
  updateNewIssueCreateState();
  newIssueDlg.showModal();
  newIssueTitleInput.focus();
}

async function checkNewProjectName(name) {
  if (newProjectCheckAbortCtrl) newProjectCheckAbortCtrl.abort();
  newProjectCheckAbortCtrl = new AbortController();
  const { signal } = newProjectCheckAbortCtrl;
  try {
    const response = await fetch('/api/system/new-project/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
      signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setNewProjectStatus(data.error || 'Unable to validate project name.', 'err'); return false; }
    if (data.canCreate) {
      const ownerPrefix = data.owner ? `${data.owner}/` : '';
      setNewProjectStatus(`Repository ${ownerPrefix}${name} is available.`, 'ok');
      return true;
    } else {
      setNewProjectStatus(data.reason || 'This project name is unavailable.', 'warn');
      return false;
    }
  } catch (err) {
    if (err.name === 'AbortError') return false;
    setNewProjectStatus('Unable to validate project name.', 'err');
    return false;
  }
}

async function browseNewProjectTarget() {
  newProjectBrowseBtn.disabled = true;
  try {
    const response = await fetch('/api/system/pick-directory', { method: 'POST' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setNewProjectStatus(data.error || 'browse failed', 'err'); return; }
    if (data.path) {
      const h = appState.homeDir;
      newProjectTargetInput.value = h && (data.path === h || data.path.startsWith(h + '/'))
        ? '~' + data.path.slice(h.length)
        : data.path;
      updateNewProjectCreateState();
    }
  } finally {
    newProjectBrowseBtn.disabled = false;
  }
}

agentForm.addEventListener('submit', async (submitEvent) => {
  submitEvent.preventDefault();
  const payload = agentPayloadFromForm(agentForm);
  let response;
  if (editingId) {
    response = await fetch(`/api/agents/${encodeURIComponent(editingId)}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    });
  } else {
    payload.id = agentForm.id.value.trim();
    response = await fetch('/api/agents', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    });
  }
  if (!response.ok) { const err = await response.json().catch(() => ({})); showErrorToast(err.error || 'save failed'); return; }
  setFormMode('add');
  await refreshAgentsTable();
  await loadAgents();
});

$('#agent-cancel').addEventListener('click', (clickEvent) => { clickEvent.preventDefault(); setFormMode('add'); });
$('#discover-btn').addEventListener('click', refreshDiscoverTable);
preferredEditorForm.addEventListener('submit', async (submitEvent) => {
  submitEvent.preventDefault();
  const submitBtn = preferredEditorForm.querySelector('button[type="submit"]');
  const submitLabel = submitBtn ? submitBtn.dataset.label || submitBtn.textContent : '';
  if (submitBtn && !submitBtn.dataset.label) submitBtn.dataset.label = submitLabel;
  const response = await fetch('/api/system/preferred-editor', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command: preferredEditorCommandInput.value, args: preferredEditorArgsInput.value.trim() ? preferredEditorArgsInput.value.trim().split(/\s+/) : [] }),
  });
  if (!response.ok) { const err = await response.json().catch(() => ({})); showErrorToast(err.error || 'save failed'); return; }
  await loadPreferredEditorSettings();
  if (submitBtn) { submitBtn.textContent = 'Saved'; setTimeout(() => { submitBtn.textContent = submitBtn.dataset.label || submitLabel; }, SAVED_FLASH_DURATION_MS); }
});
preferredEditorClearBtn.addEventListener('click', () => { preferredEditorCommandInput.value = ''; preferredEditorArgsInput.value = ''; preferredEditorCommandInput.focus(); });
githubTokenForm.addEventListener('submit', async (submitEvent) => {
  submitEvent.preventDefault();
  const submitBtn = githubTokenForm.querySelector('button[type="submit"]');
  const submitLabel = submitBtn ? submitBtn.dataset.label || submitBtn.textContent : '';
  if (submitBtn && !submitBtn.dataset.label) submitBtn.dataset.label = submitLabel;
  const response = await fetch('/api/system/github-token', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ GITHUB_TOKEN: githubTokenInput.value }),
  });
  if (!response.ok) { const err = await response.json().catch(() => ({})); showErrorToast(err.error || 'save failed'); return; }
  await loadGitHubToken();
  if (submitBtn) { submitBtn.textContent = 'Saved'; setTimeout(() => { submitBtn.textContent = submitBtn.dataset.label || submitLabel; }, SAVED_FLASH_DURATION_MS); }
});
githubTokenClearBtn.addEventListener('click', () => { githubTokenInput.value = ''; githubTokenInput.focus(); });
$('#close-settings').addEventListener('click', () => settingsDialog.close());
$('#open-settings').addEventListener('click', async () => {
  setFormMode('add');
  $('#discover-table tbody').replaceChildren();
  await Promise.all([refreshAgentsTable(), loadPreferredEditorSettings(), loadGitHubToken()]);
  settingsDialog.showModal();
});
onboardingDialog.addEventListener('cancel', (cancelEvent) => cancelEvent.preventDefault());
onboardingBackBtn.addEventListener('click', () => setOnboardingStep(onboardingStep - 1));
onboardingNextBtn.addEventListener('click', async () => {
  if (onboardingStep === 1 || onboardingStep === 2) { await refreshOnboardingAgentsTable(); if (!onboardingHasAgent) return; }
  setOnboardingStep(onboardingStep + 1);
});
onboardingFinishBtn.addEventListener('click', async () => {
  const response = await fetch('/api/system/onboarding/complete', { method: 'POST' });
  if (!response.ok) { const err = await response.json().catch(() => ({})); showErrorToast(err.error || 'finish failed'); return; }
  onboardingDialog.close();
  await Promise.all([refreshAgentsTable(), loadAgents()]);
});
onboardingFirstAgentForm.addEventListener('submit', async (submitEvent) => {
  submitEvent.preventDefault();
  try {
    const shouldAdvance = onboardingStep === 1;
    await addAgent(agentPayloadFromForm(onboardingFirstAgentForm, true));
    onboardingFirstAgentForm.reset();
    await Promise.all([refreshOnboardingAgentsTable(), refreshAgentsTable(), loadAgents()]);
    if (shouldAdvance) setOnboardingStep(2);
  } catch (err) { showErrorToast(err.message || 'add failed'); }
});
onboardingAddAgentForm.addEventListener('submit', async (submitEvent) => {
  submitEvent.preventDefault();
  try {
    await addAgent(agentPayloadFromForm(onboardingAddAgentForm, true));
    onboardingAddAgentForm.reset();
    await Promise.all([refreshOnboardingAgentsTable(), refreshAgentsTable(), loadAgents()]);
  } catch (err) { showErrorToast(err.message || 'add failed'); }
});
onboardingGitHubTokenForm.addEventListener('submit', async (submitEvent) => {
  submitEvent.preventDefault();
  const token = onboardingGitHubTokenInput.value.trim();
  if (!token) {
    if (!onboardingHasToken) await refreshOnboardingTokenState();
    onboardingGitHubTokenInput.value = '';
    return;
  }
  const response = await fetch('/api/system/github-token', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ GITHUB_TOKEN: token }),
  });
  if (!response.ok) { const err = await response.json().catch(() => ({})); showErrorToast(err.error || 'save failed'); return; }
  await refreshOnboardingTokenState();
  onboardingGitHubTokenInput.value = '';
  if (onboardingStep === 3) setOnboardingStep(4);
});
onboardingGitHubTokenClearBtn.addEventListener('click', () => { onboardingGitHubTokenInput.value = ''; onboardingGitHubTokenInput.focus(); });

$('#new-card-btn').addEventListener('click', () => addCard());
$('#new-project-btn').addEventListener('click', () => {
  newProjectForm.reset();
  if (appState.homeDir) newProjectTargetInput.value = '~';
  if (newProjectCheckAbortCtrl) newProjectCheckAbortCtrl.abort();
  setNewProjectStatus('Enter a project name and target location.');
  updateNewProjectCreateState();
  newProjectDlg.showModal();
  newProjectNameInput.focus();
});
$('#close-new-project').addEventListener('click', () => newProjectDlg.close());
newProjectDlg.addEventListener('close', () => { if (newProjectCheckAbortCtrl) newProjectCheckAbortCtrl.abort(); });
newProjectNameInput.addEventListener('input', updateNewProjectCreateState);
newProjectTargetInput.addEventListener('input', updateNewProjectCreateState);
newProjectBrowseBtn.addEventListener('click', browseNewProjectTarget);
newProjectForm.addEventListener('submit', async (submitEvent) => {
  submitEvent.preventDefault();
  if (newProjectCreateBtn.disabled) return;
  const originalButtonText = newProjectCreateBtn.textContent;
  newProjectCreateBtn.disabled = true;
  newProjectCreateBtn.textContent = 'Checking\u2026';
  setNewProjectStatus('Checking repository availability\u2026');
  try {
    const name = newProjectNameInput.value.trim();
    const canCreate = await checkNewProjectName(name);
    if (!canCreate) { updateNewProjectCreateState(); return; }
    newProjectCreateBtn.textContent = 'Creating\u2026';
    setNewProjectStatus('Creating repository and cloning locally\u2026');
    const response = await fetch('/api/system/new-project', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, targetPath: newProjectTargetInput.value.trim(), private: newProjectPrivateInput.checked }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const baseError = data.error || 'Project creation failed.';
      setNewProjectStatus(data.repoUrl ? `${baseError} ${data.repoUrl}` : baseError, 'err');
      return;
    }
    const h = appState.homeDir;
    const rawCwd = typeof data.cwd === 'string' ? data.cwd : '';
    const cwd = rawCwd && h && (rawCwd === h || rawCwd.startsWith(h + '/')) ? '~' + rawCwd.slice(h.length) : rawCwd;
    const card = addCard({ cwd });
    if (typeof data.private === 'boolean') card.setStatus(`repo created (${data.private ? 'private' : 'public'})`, 'ok');
    newProjectDlg.close();
  } catch (err) {
    console.error('[concilium] new project creation failed:', err);
    setNewProjectStatus('Project creation failed.', 'err');
  } finally {
    newProjectCreateBtn.textContent = originalButtonText;
    updateNewProjectCreateState();
  }
});

$('#close-new-issue').addEventListener('click', () => newIssueDlg.close());
newIssueDlg.addEventListener('close', () => { newIssueRepoUrl = ''; newIssueCreatedHook = null; });
newIssueTitleInput.addEventListener('input', updateNewIssueCreateState);
newIssueForm.addEventListener('submit', async (submitEvent) => {
  submitEvent.preventDefault();
  if (newIssueCreateBtn.disabled) return;
  const originalButtonText = newIssueCreateBtn.textContent;
  newIssueCreateBtn.disabled = true;
  newIssueCreateBtn.textContent = 'Creating\u2026';
  setNewIssueStatus('Creating issue\u2026');
  try {
    const trimmedBody = newIssueBodyInput.value.trim();
    const assignCopilot = newIssueAssignCopilotInput.checked;
    const response = await fetch('/api/system/new-issue', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: newIssueRepoUrl, title: newIssueTitleInput.value.trim(), assignCopilot, ...(trimmedBody ? { body: trimmedBody } : {}) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setNewIssueStatus(data.error || 'Failed to create issue. Please try again.', 'err'); return; }
    if (newIssueCreatedHook) await newIssueCreatedHook(data);
    if (assignCopilot && data && data.copilotAssigned === false) {
      newIssueForm.reset();
      setNewIssueStatus('Issue created, but Copilot assignment failed. Verify that the Copilot coding agent is enabled in your GitHub repository settings.', 'warn');
      updateNewIssueCreateState();
      return;
    }
    newIssueDlg.close();
  } catch (err) {
    console.error('[concilium] new issue creation failed:', err);
    setNewIssueStatus('Issue creation failed.', 'err');
  } finally {
    newIssueCreateBtn.textContent = originalButtonText;
    updateNewIssueCreateState();
  }
});

// --- theme ----------------------------------------------------------------

const THEME_ORDER = ['auto', 'light', 'dark'];
const THEME_LABEL = { auto: 'Auto', light: 'Light', dark: 'Dark' };
const THEME_ICON = {
  auto: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M2 2.5A1.5 1.5 0 0 0 .5 4v7A1.5 1.5 0 0 0 2 12.5h4.9l-.8 1.5H5a.5.5 0 0 0 0 1h6a.5.5 0 0 0 0-1H9.9l-.8-1.5H14A1.5 1.5 0 0 0 15.5 11V4A1.5 1.5 0 0 0 14 2.5H2Zm0 1h12a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-.5.5H2a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5Z"/></svg>',
  light: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="2.4" fill="currentColor" stroke="none"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4"/></svg>',
  dark: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M10.02 1.1a.6.6 0 0 1 .68.78A5.5 5.5 0 1 0 14.12 8a.6.6 0 0 1 .78.69A6.7 6.7 0 1 1 9.3 1.1a.6.6 0 0 1 .72 0Z"/></svg>',
};

function currentTheme() { return document.documentElement.dataset.theme || 'auto'; }
function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') { document.documentElement.dataset.theme = theme; localStorage.setItem('theme', theme); }
  else { delete document.documentElement.dataset.theme; localStorage.removeItem('theme'); }
  updateThemeButton();
  for (const card of cards) card.applyTermTheme();
  for (const card of termCards) card.applyTermTheme();
}
function updateThemeButton() {
  const theme = currentTheme();
  const themeButton = $('#theme-toggle');
  // THEME_ICON values are static code-defined SVG strings, not user input.
  themeButton.innerHTML = THEME_ICON[theme];
  themeButton.setAttribute('aria-label', `Theme: ${THEME_LABEL[theme]} (click to cycle)`);
  themeButton.title = `Theme: ${THEME_LABEL[theme]} (click to cycle)`;
}
$('#theme-toggle').addEventListener('click', () => {
  const currentIndex = THEME_ORDER.indexOf(currentTheme());
  applyTheme(THEME_ORDER[(currentIndex + 1) % THEME_ORDER.length]);
});
updateThemeButton();

$('#open-history').addEventListener('click', async () => {
  await refreshTaskHistory();
  historyDialog.showModal();
});
$('#close-history').addEventListener('click', () => historyDialog.close());
historyRefreshBtn.addEventListener('click', () => refreshTaskHistory());

const shortcutsButton = $('#open-shortcuts');
const primaryLabel = IS_MAC ? 'Cmd' : 'Ctrl';
shortcutsButton.title = `Keyboard shortcuts (${primaryLabel}+Alt+/)`;
shortcutsButton.setAttribute('aria-label', `Keyboard shortcuts (${primaryLabel}+Alt+/)`);
shortcutsButton.addEventListener('click', openShortcutsDialog);
$('#close-shortcuts').addEventListener('click', () => shortcutsDialog.close());
for (const shortcutCodeEl of shortcutsDialog.querySelectorAll('code')) {
  shortcutCodeEl.textContent = shortcutCodeEl.textContent.replace('Cmd/Ctrl', primaryLabel);
}

// --- git cheat sheet dialog ------------------------------------------------

const gitCheatsheetDialog = $('#git-cheatsheet-dialog');
$('#close-git-cheatsheet').addEventListener('click', () => gitCheatsheetDialog.close());
gitCheatsheetDialog.addEventListener('close', () => { clearGitCheatsheetTargetCard(); });
$('#git-cheatsheet-content').addEventListener('click', (clickEvent) => {
  const btn = clickEvent.target.closest('.git-cmd-btn');
  const targetCard = getGitCheatsheetTargetCard();
  if (!btn || !targetCard || !targetCard.el.isConnected) return;
  targetCard.sendRaw(btn.dataset.cmd);
  gitCheatsheetDialog.close();
});

// Re-theme terminals when the OS flips light/dark while we're on Auto.
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  if (currentTheme() === 'auto') {
    for (const card of cards) card.applyTermTheme();
    for (const card of termCards) card.applyTermTheme();
  }
});

// Reconnect any interrupted streams when the device wakes from sleep or the
// network comes back. This is a safety net for cases where the EventSource
// ends up permanently closed instead of auto-reconnecting (e.g. when the
// browser aggressively kills connections while the page is hidden).
function reconnectAllStreams() {
  for (const card of cards) card.reconnectStream();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') reconnectAllStreams();
});
window.addEventListener('online', reconnectAllStreams);
document.addEventListener('focusin', (focusEvent) => focusCardFromNode(focusEvent.target), true);
document.addEventListener('pointerdown', (pointerEvent) => focusCardFromNode(pointerEvent.target), true);
window.addEventListener('keydown', handleKeyboardShortcut, true);

// --- bootstrap -------------------------------------------------------------

(async () => {
  await loadHealth();
  await loadAgents();
  await loadPreferredEditorSettings();
  await restoreLayout();
  await maybeStartOnboarding();
  setInterval(loadHealth, HEALTH_POLL_INTERVAL_MS);
})();

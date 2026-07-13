// Shared mutable application state and state-dependent utilities.
// Function slots (saveLayout, addTerminalCard, etc.) are filled by app.js
// before any card is constructed.

import { isLoopbackOrigin } from './utils.js';

export const agentsById = new Map();
export const cards = new Set();
export const termCards = new Set();

// Mutable scalar state — use object properties so any module can update them.
export const appState = {
  draggingCardEl: null,
  activeCardEl: null,
  layoutReady: false,
  homeDir: '',
  publicServer: false,
  canUsePreferredEditor: isLoopbackOrigin(),
  preferredEditorConfigured: false,

  // Function slots — filled by app.js at startup, called at runtime.
  saveLayout: () => {},
  addCard: () => null,
  addTerminalCard: () => null,
  addGitHubCard: () => null,
  openNewIssueDialog: () => {},
  browseDirectory: async () => null,
};

export function fillAgentSelect(select, currentValue) {
  select.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '— select agent —';
  placeholder.disabled = true;
  placeholder.selected = !currentValue;
  select.appendChild(placeholder);
  for (const agent of agentsById.values()) {
    const option = document.createElement('option');
    option.value = agent.id;
    option.textContent = agent.name + (agent.interactive ? ' · interactive' : '');
    if (currentValue === agent.id) option.selected = true;
    select.appendChild(option);
  }
}

export function toTildePath(path) {
  const { homeDir } = appState;
  if (homeDir && (path === homeDir || path.startsWith(homeDir + '/'))) {
    return '~' + path.slice(homeDir.length);
  }
  return path;
}

export function clearActiveCardIfMatch(cardEl) {
  if (appState.activeCardEl === cardEl) appState.activeCardEl = null;
}

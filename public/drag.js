// Card drag-and-drop support.

import { appState } from './state.js';

export function enableCardDragging(cardEl, handleEl) {
  handleEl.draggable = true;

  handleEl.addEventListener('dragstart', (dragEvent) => {
    const rawTarget = dragEvent.target;
    const target = rawTarget instanceof Element ? rawTarget : rawTarget?.parentElement ?? null;
    if (!target) {
      dragEvent.preventDefault();
      return;
    }
    if (target.closest('button, select, input, a, .card-actions, .card-status')) {
      dragEvent.preventDefault();
      return;
    }
    if (cardEl.classList.contains('expanded')) {
      dragEvent.preventDefault();
      return;
    }
    appState.draggingCardEl = cardEl;
    cardEl.classList.add('dragging');
    if (dragEvent.dataTransfer) {
      dragEvent.dataTransfer.effectAllowed = 'move';
      dragEvent.dataTransfer.setData('text/plain', 'card');
    }
  });

  handleEl.addEventListener('dragend', () => {
    cardEl.classList.remove('dragging');
    if (appState.draggingCardEl === cardEl) appState.draggingCardEl = null;
    appState.saveLayout();
  });
}

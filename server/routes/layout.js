const express = require('express');
const store = require('../store');

const router = express.Router();

function isValidCardEntry(entry) {
  return entry !== null && typeof entry === 'object' && !Array.isArray(entry)
    && (entry.agentId === undefined || typeof entry.agentId === 'string')
    && (entry.cwd === undefined || typeof entry.cwd === 'string')
    && (entry.lastTaskId === undefined || entry.lastTaskId === null || typeof entry.lastTaskId === 'number');
}

function isValidBookmarkEntry(entry) {
  return entry !== null && typeof entry === 'object' && !Array.isArray(entry)
    && typeof entry.label === 'string'
    && typeof entry.agentId === 'string'
    && typeof entry.cwd === 'string';
}

router.get('/layout', (req, res) => {
  const raw = store.getLayout();
  if (!raw) return res.json([]);
  try {
    res.json(JSON.parse(raw));
  } catch (err) {
    console.error('[concilium] failed to parse stored layout:', err);
    res.json([]);
  }
});

router.post('/layout', (req, res) => {
  const body = req.body;
  const valid = Array.isArray(body)
    ? body.every(isValidCardEntry)
    : body !== null
      && typeof body === 'object'
      && !Array.isArray(body)
      && Array.isArray(body.cards)
      && body.cards.every(isValidCardEntry)
      && (body.bookmarks === undefined || (Array.isArray(body.bookmarks) && body.bookmarks.every(isValidBookmarkEntry)));
  if (!valid) return res.status(400).json({ error: 'invalid layout payload' });
  store.saveLayout(JSON.stringify(body));
  res.json({ ok: true });
});

module.exports = router;

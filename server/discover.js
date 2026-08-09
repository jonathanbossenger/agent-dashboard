const fs = require('fs');
const path = require('path');

// Known CLI agents we can suggest. `interactive: true` means we default to
// PTY mode (the tool runs an agentic/REPL session); `interactive: false`
// means piped stdin (true one-shot CLIs only).
const KNOWN = [
  { id: 'claude',  name: 'Claude Code',        command: 'claude',       interactive: true },
  { id: 'codex',   name: 'Codex CLI',          command: 'codex',        interactive: true },
  { id: 'goose',   name: 'Goose',              command: 'goose',        interactive: true },
  { id: 'aider',   name: 'Aider',              command: 'aider',        interactive: true },
  { id: 'gemini',  name: 'Gemini CLI',         command: 'gemini',       interactive: true },
  { id: 'copilot', name: 'GitHub Copilot CLI', command: 'copilot',      interactive: true },
  { id: 'ollama',  name: 'Ollama',             command: 'ollama',       interactive: true },
  { id: 'cursor',  name: 'Cursor CLI',         command: 'cursor-agent', interactive: true },
];

function which(cmd) {
  const paths = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const p of paths) {
    const candidate = path.join(p, cmd);
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile() && (stat.mode & 0o111)) return candidate;
    } catch (_) { /* missing — try next */ }
  }
  return null;
}

function discover() {
  const searchedPath = process.env.PATH || '';
  return KNOWN.map((a) => {
    const found = which(a.command);
    return found ? { ...a, found } : { ...a, found, searchedPath };
  });
}

module.exports = { discover, which, KNOWN };

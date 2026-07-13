const { getConfig } = require('./config');
const { SHUTDOWN_TIMEOUT_MS } = require('./constants');
const { createApp } = require('./app');

const app = createApp();
const cfg = getConfig();
const host = typeof cfg.host === 'string' && cfg.host.trim() ? cfg.host.trim() : '127.0.0.1';

const server = app.listen(cfg.port, host, () => {
  const url = `http://${host}:${cfg.port}`;
  // OSC 8 hyperlink — clickable in supporting terminals (iTerm2, Terminal.app,
  // VS Code, modern gnome-terminal); falls back to the visible URL elsewhere.
  const link = `\x1b]8;;${url}\x1b\\${url}\x1b]8;;\x1b\\`;
  console.log(`concilium listening — open ${link}`);
});

function shutdown(signal) {
  console.log(`received ${signal}, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

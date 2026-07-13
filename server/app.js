const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { ensureState, getConfig, saveConfig, LOG_DIR } = require('./config');
const { requireLoopbackRequest } = require('./loopback');
const { REQUEST_BODY_LIMIT } = require('./constants');
const {
  isLocalRequest,
  isLoopbackAddress,
  hasAdminCredentials,
  getSessionUser,
  generateSetupToken,
  hashSetupToken,
} = require('./auth');

const AUTH_BOOTSTRAP_PATHS = new Set([
  '/system/auth/state',
  '/system/auth/setup',
  '/system/auth/login',
  '/system/auth/logout',
]);

function isConfiguredHostNonLoopback(cfg) {
  const configuredHost = typeof cfg?.host === 'string' && cfg.host.trim() ? cfg.host.trim().toLowerCase() : '127.0.0.1';
  return !isLoopbackAddress(configuredHost) && configuredHost !== 'localhost';
}

function maybeIssueSetupToken(cfg, { rotateExisting = false } = {}) {
  if (!(cfg && cfg.publicServer === true) || hasAdminCredentials(cfg)) return false;
  if (!rotateExisting && typeof cfg.setupTokenHash === 'string' && cfg.setupTokenHash) return false;
  const setupToken = generateSetupToken();
  cfg.setupTokenHash = hashSetupToken(setupToken);
  const fingerprint = crypto.createHash('sha256').update(setupToken).digest('hex').slice(0, 12);
  // Format must stay in sync with bin/conciliumctl parseLatestSetupToken().
  console.log(`[concilium] Public-server setup token: ${setupToken} (fingerprint ${fingerprint})`);
  return true;
}

async function logsDirSize(logDir) {
  try {
    const entries = await fs.promises.readdir(logDir, { withFileTypes: true });
    let total = 0;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      try {
        const stat = await fs.promises.stat(path.join(logDir, entry.name));
        total += stat.size;
      } catch (_) {}
    }
    return total;
  } catch (_) {
    return 0;
  }
}

function createApp() {
  ensureState();
  const initialCfg = getConfig();
  let initialCfgChanged = false;
  const hostIsNonLoopback = isConfiguredHostNonLoopback(initialCfg);
  if (!initialCfg.publicServer && hostIsNonLoopback) {
    initialCfg.publicServer = true;
    initialCfgChanged = true;
  }
  if (maybeIssueSetupToken(initialCfg, { rotateExisting: true })) initialCfgChanged = true;
  if (initialCfgChanged) saveConfig(initialCfg);

  // Routes are required AFTER ensureState() so store.js can open the DB.
  const agentsRoute = require('./routes/agents');
  const tasksRoute = require('./routes/tasks');
  const streamRoute = require('./routes/stream');
  const githubRoute = require('./routes/github');
  const authRoute = require('./routes/auth');
  const directoriesRoute = require('./routes/directories');
  const layoutRoute = require('./routes/layout');
  const onboardingRoute = require('./routes/onboarding');
  const editorRoute = require('./routes/editor');
  const pickerRoute = require('./routes/picker');
  const manager = require('./manager');
  const store = require('./store');

  const app = express();
  if (initialCfg.trustProxy === true) app.set('trust proxy', true);
  app.use(express.json({ limit: REQUEST_BODY_LIMIT }));
  app.use((req, _res, next) => {
    const cfg = getConfig();
    const configuredHostIsNonLoopback = isConfiguredHostNonLoopback(cfg);
    if (!cfg.publicServer && configuredHostIsNonLoopback && !isLocalRequest(req, cfg)) {
      cfg.publicServer = true;
      maybeIssueSetupToken(cfg);
      saveConfig(cfg);
    }
    next();
  });

  app.use('/api', (req, res, next) => {
    const cfg = getConfig();
    if (!cfg.publicServer) return requireLoopbackRequest(req, res, next);
    if (AUTH_BOOTSTRAP_PATHS.has(req.path)) return next();

    if (!hasAdminCredentials(cfg)) {
      return res.status(403).json({ error: 'admin setup required' });
    }
    const sessionUser = getSessionUser(req, cfg);
    if (!sessionUser || sessionUser !== cfg.adminUser) {
      return res.status(401).json({ error: 'authentication required' });
    }
    return next();
  });

  app.get('/api/health', async (req, res) => {
    res.json({
      ok: true,
      pid: process.pid,
      uptime: process.uptime(),
      homeDir: os.homedir(),
      liveTasks: manager.liveCount(),
      totalEvents: store.countEvents(),
      logsDirBytes: await logsDirSize(LOG_DIR),
    });
  });

  app.use('/api/agents', agentsRoute);
  app.use('/api/tasks', tasksRoute);
  app.use('/api/stream', streamRoute);
  app.use('/api/system', authRoute);
  app.use('/api/system', directoriesRoute);
  app.use('/api/system', githubRoute);
  app.use('/api/system', layoutRoute);
  app.use('/api/system', onboardingRoute);
  app.use('/api/system', editorRoute);
  app.use('/api/system', pickerRoute);

  app.use('/vendor/xterm', express.static(path.join(__dirname, '..', 'node_modules', '@xterm', 'xterm')));
  app.use('/vendor/xterm-addon-fit', express.static(path.join(__dirname, '..', 'node_modules', '@xterm', 'addon-fit')));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  return app;
}

module.exports = { createApp };

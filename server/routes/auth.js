const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { getConfig, saveConfig } = require('../config');
const {
  hasAdminCredentials,
  hashPassword,
  verifyPassword,
  issueSessionToken,
  getSessionUser,
  buildSessionCookie,
  buildClearSessionCookie,
  verifySetupToken,
} = require('../auth');

const router = express.Router();
const ADMIN_USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,64}$/;
const MAX_AUTH_PASSWORD_LENGTH = 256;
const authRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: false,
  legacyHeaders: false,
  message: { error: 'too many authentication attempts; please retry in a moment' },
});

router.get('/auth/state', (req, res) => {
  const cfg = getConfig();
  const publicServer = cfg && cfg.publicServer === true;
  const setupRequired = publicServer && !hasAdminCredentials(cfg);
  const sessionUser = publicServer ? getSessionUser(req, cfg) : null;
  const authenticated = !publicServer || (!!sessionUser && sessionUser === cfg.adminUser);
  res.json({
    publicServer,
    setupRequired,
    setupTokenRequired: setupRequired,
    authenticated,
    adminUser: publicServer && !setupRequired ? cfg.adminUser : '',
  });
});

router.post('/auth/setup', authRateLimiter, (req, res) => {
  const cfg = getConfig();
  if (!(cfg && cfg.publicServer === true)) {
    return res.status(400).json({ error: 'setup is only available in public-server mode' });
  }
  if (hasAdminCredentials(cfg)) {
    return res.status(409).json({ error: 'admin user is already configured' });
  }

  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const confirmPassword = typeof req.body?.confirmPassword === 'string' ? req.body.confirmPassword : '';
  const setupToken = typeof req.body?.setupToken === 'string' ? req.body.setupToken : '';
  if (!ADMIN_USERNAME_PATTERN.test(username)) {
    return res.status(400).json({ error: 'username must be 3-64 characters and contain only letters, numbers, underscores, or dashes' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }
  if (password.length > MAX_AUTH_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `password must be ${MAX_AUTH_PASSWORD_LENGTH} characters or fewer` });
  }
  if (confirmPassword && confirmPassword !== password) {
    return res.status(400).json({ error: 'password confirmation does not match' });
  }
  if (!verifySetupToken(setupToken, cfg)) {
    return res.status(401).json({ error: 'invalid setup token' });
  }

  cfg.adminUser = username;
  cfg.adminPasswordSalt = crypto.randomBytes(16).toString('hex');
  cfg.adminPasswordHash = hashPassword(password, cfg.adminPasswordSalt);
  cfg.authSecret = crypto.randomBytes(32).toString('hex');
  cfg.setupTokenHash = '';
  saveConfig(cfg);

  const sessionToken = issueSessionToken(cfg, username);
  res.setHeader('Set-Cookie', buildSessionCookie(sessionToken, req, cfg));
  res.json({ ok: true });
});

router.post('/auth/login', authRateLimiter, (req, res) => {
  const cfg = getConfig();
  if (!(cfg && cfg.publicServer === true)) {
    return res.status(400).json({ error: 'login is only available in public-server mode' });
  }
  if (!hasAdminCredentials(cfg)) {
    return res.status(400).json({ error: 'admin setup required' });
  }

  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!username || !password) return res.status(400).json({ error: 'username and password are required' });
  if (password.length > MAX_AUTH_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `password must be ${MAX_AUTH_PASSWORD_LENGTH} characters or fewer` });
  }
  if (username !== cfg.adminUser || !verifyPassword(password, cfg)) {
    return res.status(401).json({ error: 'invalid username or password' });
  }

  const sessionToken = issueSessionToken(cfg, username);
  res.setHeader('Set-Cookie', buildSessionCookie(sessionToken, req, cfg));
  res.json({ ok: true });
});

router.post('/auth/logout', (_req, res) => {
  const cfg = getConfig();
  if (hasAdminCredentials(cfg)) {
    cfg.authSecret = crypto.randomBytes(32).toString('hex');
    saveConfig(cfg);
  }
  res.setHeader('Set-Cookie', buildClearSessionCookie());
  res.json({ ok: true });
});

module.exports = router;

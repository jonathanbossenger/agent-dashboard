const crypto = require('crypto');

const SESSION_COOKIE_NAME = 'concilium_auth';
const SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;
const MAX_SETUP_TOKEN_LENGTH = 256;

function normalizeHost(hostHeader) {
  const raw = typeof hostHeader === 'string' ? hostHeader.trim().toLowerCase() : '';
  if (!raw) return '';
  if (raw.startsWith('[')) {
    const closing = raw.indexOf(']');
    if (closing >= 1) return raw.slice(1, closing);
  }
  const colon = raw.lastIndexOf(':');
  if (colon > 0 && raw.indexOf(':') === colon) return raw.slice(0, colon);
  return raw;
}

function isLoopbackAddress(value) {
  const normalized = (value || '').toLowerCase();
  return normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '::ffff:127.0.0.1'
    || normalized === 'localhost';
}

function pickRemoteAddress(req, cfg) {
  if (cfg && cfg.trustProxy === true && req && typeof req.ip === 'string' && req.ip) {
    return req.ip;
  }
  return req && req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : '';
}

function pickRequestHost(req, cfg) {
  if (cfg && cfg.trustProxy === true) {
    const forwardedHost = req && req.headers && req.headers['x-forwarded-host'];
    if (typeof forwardedHost === 'string' && forwardedHost.trim()) {
      return forwardedHost.split(',')[0].trim();
    }
  }
  return req && req.headers ? req.headers.host : '';
}

function isLocalRequest(req, cfg) {
  const host = normalizeHost(pickRequestHost(req, cfg));
  const remoteAddress = String(pickRemoteAddress(req, cfg) || '').toLowerCase();
  return isLoopbackAddress(host) && isLoopbackAddress(remoteAddress);
}

function hasAdminCredentials(cfg) {
  return !!(cfg
    && typeof cfg.adminUser === 'string' && cfg.adminUser.trim()
    && typeof cfg.adminPasswordHash === 'string' && cfg.adminPasswordHash
    && typeof cfg.adminPasswordSalt === 'string' && cfg.adminPasswordSalt
    && typeof cfg.authSecret === 'string' && cfg.authSecret);
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password, cfg) {
  if (!hasAdminCredentials(cfg)) return false;
  const actual = hashPassword(password, cfg.adminPasswordSalt);
  const expected = cfg.adminPasswordHash;
  const actualBuffer = Buffer.from(actual, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function parseCookies(cookieHeader) {
  const cookies = {};
  const raw = typeof cookieHeader === 'string' ? cookieHeader : '';
  for (const part of raw.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = decodeURIComponent(trimmed.slice(0, eq));
    const value = decodeURIComponent(trimmed.slice(eq + 1));
    cookies[key] = value;
  }
  return cookies;
}

function base64UrlEncode(input) {
  return Buffer.from(input).toString('base64url');
}

function base64UrlDecode(input) {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function signValue(secret, value) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function issueSessionToken(cfg, username) {
  const payload = JSON.stringify({
    user: username,
    exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
  });
  const encoded = base64UrlEncode(payload);
  const signature = signValue(cfg.authSecret, encoded);
  return `${encoded}.${signature}`;
}

function verifySessionToken(token, cfg) {
  if (!token || typeof token !== 'string') return null;
  if (!cfg || typeof cfg.authSecret !== 'string' || !cfg.authSecret) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot >= token.length - 1) return null;
  const encoded = token.slice(0, dot);
  const providedSignature = token.slice(dot + 1);
  const expectedSignature = signValue(cfg.authSecret, encoded);
  const providedBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (providedBuffer.length !== expectedBuffer.length) return null;
  if (!crypto.timingSafeEqual(providedBuffer, expectedBuffer)) return null;
  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(encoded));
  } catch (_) {
    return null;
  }
  if (!payload || typeof payload.user !== 'string' || !payload.user) return null;
  if (typeof payload.exp !== 'number' || payload.exp <= Date.now()) return null;
  return { user: payload.user };
}

function getSessionUser(req, cfg) {
  const cookies = parseCookies(req && req.headers ? req.headers.cookie : '');
  const token = cookies[SESSION_COOKIE_NAME];
  const session = verifySessionToken(token, cfg);
  return session ? session.user : null;
}

function buildSessionCookie(token, req, cfg) {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ];
  const isTlsSocket = !!(req && req.socket && req.socket.encrypted);
  const forwardedProto = req && req.headers && typeof req.headers['x-forwarded-proto'] === 'string'
    ? req.headers['x-forwarded-proto'].split(',')[0].trim().toLowerCase()
    : '';
  const isForwardedTls = !!(cfg && cfg.trustProxy === true && forwardedProto === 'https');
  const forceSecureCookies = !!(cfg && cfg.forceSecureCookies === true);
  const isTls = isTlsSocket || isForwardedTls || forceSecureCookies;
  if (isTls) parts.push('Secure');
  return parts.join('; ');
}

function buildClearSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function generateSetupToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function hashSetupToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function verifySetupToken(token, cfg) {
  if (!cfg || typeof cfg.setupTokenHash !== 'string' || !cfg.setupTokenHash) return false;
  if (typeof token !== 'string') return false;
  const trimmed = token.trim();
  if (!trimmed || trimmed.length > MAX_SETUP_TOKEN_LENGTH) return false;
  const actual = hashSetupToken(trimmed);
  const actualBuffer = Buffer.from(actual, 'hex');
  const expectedBuffer = Buffer.from(cfg.setupTokenHash, 'hex');
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

module.exports = {
  isLocalRequest,
  isLoopbackAddress,
  hasAdminCredentials,
  hashPassword,
  verifyPassword,
  issueSessionToken,
  getSessionUser,
  buildSessionCookie,
  buildClearSessionCookie,
  generateSetupToken,
  hashSetupToken,
  verifySetupToken,
};

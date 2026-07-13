const fs = require('fs');
const path = require('path');
const os = require('os');
const yaml = require('js-yaml');

const STATE_DIR = path.join(os.homedir(), '.concilium');
const CONFIG_PATH = path.join(STATE_DIR, 'config.yaml');
const LOG_DIR = path.join(STATE_DIR, 'logs');

const DEFAULT_CONFIG = {
  host: '127.0.0.1',
  port: 7878,
  trustProxy: false,
  forceSecureCookies: false,
  publicServer: false,
  setupTokenHash: '',
  adminUser: '',
  adminPasswordHash: '',
  adminPasswordSalt: '',
  authSecret: '',
  githubToken: '',
  agents: [],
  onboardingCompleted: false,
};

function ensureState() {
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, yaml.dump(DEFAULT_CONFIG), { mode: 0o600 });
    fs.chmodSync(CONFIG_PATH, 0o600);
  }
}

let cached = null;
function cloneConfig(cfg) {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(cfg);
  }
  return JSON.parse(JSON.stringify(cfg));
}

function getConfig() {
  if (cached) return cached;
  cached = yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8'));
  return cached;
}

function getConfigForUpdate() {
  return cloneConfig(getConfig());
}

function reloadConfig() {
  cached = null;
  return getConfig();
}

function saveConfig(newCfg) {
  // Atomic write/rename prevents partial files, but this function does not
  // coordinate read-modify-write callers. If two callers clone cached config
  // and then both call saveConfig, the later write wins and overwrites the
  // earlier mutation. Keep config mutations serialized in route/service code
  // when concurrent updates are possible.
  const tmp = CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmp, yaml.dump(newCfg, { sortKeys: false }), { mode: 0o600 });
  fs.renameSync(tmp, CONFIG_PATH);
  fs.chmodSync(CONFIG_PATH, 0o600);
  cached = newCfg;
  return cached;
}

module.exports = {
  DEFAULT_CONFIG,
  ensureState,
  getConfig,
  getConfigForUpdate,
  reloadConfig,
  saveConfig,
  STATE_DIR,
  CONFIG_PATH,
  LOG_DIR,
};

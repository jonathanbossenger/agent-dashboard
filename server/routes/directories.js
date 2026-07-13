const fs = require('fs');
const path = require('path');
const os = require('os');
const express = require('express');
const rateLimit = require('express-rate-limit');

const router = express.Router();
const MAX_DIRECTORY_BROWSE_ENTRIES = 500;
const directoryBrowseRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: false,
  legacyHeaders: false,
  message: { error: 'too many directory browse requests; please retry in a moment' },
});

function isWithinBaseDirectory(baseDir, targetDir) {
  const relative = path.relative(baseDir, targetDir);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function sanitizeRelativeDirectoryPath(input) {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) return [];
  const normalized = raw.replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = normalized.split('/').filter(Boolean);
  for (const part of parts) {
    if (part === '.' || part === '..' || part.includes('\0')) return null;
  }
  return parts;
}

function resolvePathWithinHome(input, homeRealPath) {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw || raw === '~') return homeRealPath;
  let candidate = raw;
  if (candidate.startsWith('~/')) candidate = candidate.slice(2);
  else if (candidate === homeRealPath) candidate = '';
  else if (candidate.startsWith(homeRealPath + path.sep)) candidate = candidate.slice(homeRealPath.length + 1);
  const parts = sanitizeRelativeDirectoryPath(candidate);
  if (parts === null) return null;
  return path.join(homeRealPath, ...parts);
}

router.get('/directories', directoryBrowseRateLimiter, async (req, res) => {
  try {
    const homeDir = os.homedir();
    const homeRealPath = await fs.promises.realpath(homeDir);
    const requestedPathRaw = req.query && req.query.path;
    if (requestedPathRaw !== undefined && typeof requestedPathRaw !== 'string') {
      return res.status(400).json({ error: 'path must be a string' });
    }
    const requestedPath = resolvePathWithinHome(requestedPathRaw || '', homeRealPath);
    if (!requestedPath) {
      return res.status(403).json({ error: 'path must be within the server home directory' });
    }
    let stats;
    try {
      stats = await fs.promises.stat(requestedPath);
    } catch (err) {
      if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
        return res.status(404).json({ error: 'directory not found' });
      }
      throw err;
    }
    if (!stats.isDirectory()) return res.status(400).json({ error: 'path must be a directory' });
    const browsePath = await fs.promises.realpath(requestedPath);
    if (!isWithinBaseDirectory(homeRealPath, browsePath)) {
      return res.status(403).json({ error: 'path must be within the server home directory' });
    }
    let dirEntries = await fs.promises.readdir(browsePath, { withFileTypes: true });
    dirEntries = dirEntries
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, MAX_DIRECTORY_BROWSE_ENTRIES)
      .map((entry) => {
        const entryPath = path.join(browsePath, entry.name);
        const relativePath = path.relative(homeRealPath, entryPath).split(path.sep).join('/');
        return {
          name: entry.name,
          path: entryPath,
          relativePath,
        };
      });
    const parent = browsePath === homeRealPath ? null : path.dirname(browsePath);
    const parentRelativePath = parent ? path.relative(homeRealPath, parent).split(path.sep).join('/') : '';
    const relativePath = path.relative(homeRealPath, browsePath).split(path.sep).join('/');
    res.json({
      path: browsePath,
      homeDir: homeRealPath,
      parent,
      parentRelativePath,
      relativePath,
      entries: dirEntries,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || String(err) });
  }
});

module.exports = router;

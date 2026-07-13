const express = require('express');
const rateLimit = require('express-rate-limit');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getConfig } = require('../config');
const { expandTilde } = require('../util/path');
const { GITHUB_ITEMS_PER_PAGE } = require('../constants');

const router = express.Router();
const GITHUB_REPO_NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/;
const GIT_CLONE_TIMEOUT_MS = 120000;
const MAX_GITHUB_URL_LENGTH = 2048;
const MAX_ISSUE_TITLE_LENGTH = 256;
const MAX_ISSUE_BODY_BYTES = 65536;
const newProjectRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: false,
  legacyHeaders: false,
  message: { error: 'too many project creation requests; please retry in a moment' },
});
// REST issue-assignee login used by GitHub for Copilot assignment.
const COPILOT_ISSUE_ASSIGNEE = 'Copilot';
const COPILOT_ISSUE_ASSIGNEE_FALLBACK = 'copilot-swe-agent[bot]';
const COPILOT_ASSIGNEE_LOGINS = [COPILOT_ISSUE_ASSIGNEE, COPILOT_ISSUE_ASSIGNEE_FALLBACK];
const COPILOT_ASSIGNEE_LOGIN_SET = new Set(COPILOT_ASSIGNEE_LOGINS.map((login) => login.toLowerCase()));

function getGitHubToken(cfg) {
  if (cfg && typeof cfg.githubToken === 'string') return cfg.githubToken.trim();
  if (cfg && typeof cfg.GITHUB_TOKEN === 'string') return cfg.GITHUB_TOKEN.trim();
  return '';
}

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

function parseGitHubUrl(remoteUrl) {
  // SSH scp-style: git@github.com:owner/repo.git
  const sshMatch = remoteUrl.match(/^git@github\.com:([^/]+\/[^/]+?)\/?(?:\.git)?$/);
  if (sshMatch) return `https://github.com/${sshMatch[1]}`;
  // SSH url-style: ssh://git@github.com[:port]/owner/repo.git
  const sshUrlMatch = remoteUrl.match(/^ssh:\/\/git@github\.com(?::\d+)?\/([^/]+\/[^/]+?)\/?(?:\.git)?$/);
  if (sshUrlMatch) return `https://github.com/${sshUrlMatch[1]}`;
  // HTTPS: https://github.com/owner/repo.git  (optional user@, trailing slash, .git)
  const httpsMatch = remoteUrl.match(/^https?:\/\/(?:[^@]+@)?github\.com\/([^/]+\/[^/]+?)\/?(?:\.git)?$/);
  if (httpsMatch) return `https://github.com/${httpsMatch[1]}`;
  return null;
}

function parseGitHubRepo(url) {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(url || '');
  if (!match) return null;
  const owner = match[1];
  const repo = match[2];
  const ownerRepoPattern = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
  if (!ownerRepoPattern.test(owner) || !ownerRepoPattern.test(repo)) return null;
  return { owner, repo };
}

async function fetchGitHubJson(url) {
  const cfg = getConfig();
  const githubToken = getGitHubToken(cfg);
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'concilium',
  };
  if (githubToken) headers.authorization = `Bearer ${githubToken}`;
  const r = await fetch(url, {
    headers,
  });
  if (!r.ok) {
    const err = new Error(`GitHub API request failed with status ${r.status}`);
    err.status = r.status;
    const remainingHeader = r.headers.get('x-ratelimit-remaining');
    const remaining = remainingHeader === null ? null : Number.parseInt(remainingHeader, 10);
    err.rateLimited = Number.isFinite(remaining) && remaining === 0;
    throw err;
  }
  return r.json();
}

async function fetchGitHubGraphQL(query, variables, githubToken) {
  const r = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/vnd.github+json',
      'user-agent': 'concilium',
      authorization: `Bearer ${githubToken}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!r.ok) {
    const err = new Error(`GitHub GraphQL request failed with status ${r.status}`);
    err.status = r.status;
    const remainingHeader = r.headers.get('x-ratelimit-remaining');
    const remaining = remainingHeader === null ? null : Number.parseInt(remainingHeader, 10);
    err.rateLimited = Number.isFinite(remaining) && remaining === 0;
    throw err;
  }
  const data = await r.json();
  if (Array.isArray(data.errors) && data.errors.length) {
    const err = new Error(data.errors[0].message || 'GraphQL error');
    err.graphqlErrors = data.errors;
    throw err;
  }
  return data.data;
}

function classifyGitHubError(err) {
  if (err && err.status === 403 && err.rateLimited) {
    return { code: 'rate_limited', message: 'github rate limited (http 403)' };
  }
  if (err && err.status === 403) {
    return { code: 'forbidden', message: 'github access forbidden (http 403)' };
  }
  if (err && err.status === 404) {
    return { code: 'not_found', message: 'github repository not found (http 404)' };
  }
  if (err && typeof err.status === 'number' && err.status > 0) {
    return { code: 'http_error', message: `github request failed (http ${err.status})` };
  }
  return { code: 'fetch_failed', message: 'failed to fetch from github' };
}

function githubHeaders(githubToken) {
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'concilium',
  };
  if (githubToken) headers.authorization = `Bearer ${githubToken}`;
  return headers;
}

function sanitizeProjectName(input) {
  const name = typeof input === 'string' ? input.trim() : '';
  if (!name) return { name: '', error: 'project name is required' };
  if (!GITHUB_REPO_NAME_RE.test(name)) {
    return {
      name,
      error: 'project name must start/end with a letter or number, contain only letters, numbers, dots, underscores, or dashes, and be up to 100 characters long',
    };
  }
  return { name, error: null };
}

async function fetchGitHubUser(githubToken) {
  const r = await fetch('https://api.github.com/user', { headers: githubHeaders(githubToken) });
  if (!r.ok) {
    const err = new Error(`failed to fetch GitHub user (HTTP ${r.status}); verify your GitHub token and scopes`);
    err.status = r.status;
    throw err;
  }
  const data = await r.json().catch(() => ({}));
  const login = data && typeof data.login === 'string' ? data.login.trim() : '';
  if (!login) {
    const err = new Error('GitHub user login missing');
    err.status = 502;
    throw err;
  }
  return { login };
}

async function deleteGitHubRepo(githubToken, owner, repo) {
  const r = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
    method: 'DELETE',
    headers: githubHeaders(githubToken),
  });
  return r.status === 204;
}

function getAssigneeLogins(data) {
  if (!data || !Array.isArray(data.assignees)) return [];
  return data.assignees
    .map((assignee) => (assignee && typeof assignee.login === 'string' ? assignee.login : ''))
    .filter(Boolean);
}

async function assignIssueToCopilot(githubToken, owner, repo, issueNumber) {
  const encodedIssueNumber = encodeURIComponent(String(issueNumber));
  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${encodedIssueNumber}/assignees`;
  let lastHttpError = null;
  for (const assigneeLogin of COPILOT_ASSIGNEE_LOGINS) {
    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        ...githubHeaders(githubToken),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ assignees: [assigneeLogin] }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = data && typeof data.message === 'string' && data.message
        ? data.message
        : `GitHub action failed (HTTP ${resp.status})`;
      lastHttpError = { status: resp.status, message: msg };
      continue;
    }
    const assignedLogins = getAssigneeLogins(data);
    const assigned = assignedLogins.some((login) => COPILOT_ASSIGNEE_LOGIN_SET.has(login.toLowerCase()));
    if (assigned) {
      return {
        assigned: true,
        status: resp.status,
        message: '',
      };
    }
  }
  if (lastHttpError) {
    return {
      assigned: false,
      status: lastHttpError.status,
      message: lastHttpError.message,
    };
  }
  return {
    assigned: false,
    status: 409,
    message: `GitHub did not confirm Copilot as an assignee (tried: ${COPILOT_ASSIGNEE_LOGINS.join(', ')})`,
  };
}

function toGitHubItem(item) {
  return {
    number: item.number,
    title: item.title,
    url: item.html_url,
    state: item.state,
    assignees: getAssigneeLogins(item),
  };
}

function toGitHubPull(item) {
  return {
    ...toGitHubItem(item),
    branch: item.head && typeof item.head.ref === 'string' ? item.head.ref : '',
    headSha: item.head && typeof item.head.sha === 'string' ? item.head.sha : '',
    draft: !!item.draft,
    nodeId: typeof item.node_id === 'string' ? item.node_id : '',
  };
}

function githubItemsResponse(url, issues, pulls, warning = null) {
  return { url, issues, pulls, warning };
}

function execFileWithOutput(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout ? stdout.toString() : '';
        err.stderr = stderr ? stderr.toString() : '';
        return reject(err);
      }
      resolve({
        stdout: stdout ? stdout.toString() : '',
        stderr: stderr ? stderr.toString() : '',
      });
    });
  });
}

router.post('/github-url', (req, res) => {
  const rawDir = req.body && req.body.path;
  if (!rawDir || typeof rawDir !== 'string') {
    return res.status(400).json({ error: 'path required' });
  }
  const dir = expandTilde(rawDir);
  // Resolve to an absolute path and verify it is an existing directory before
  // running git, so we do not reveal information about arbitrary filesystem paths.
  const resolved = path.resolve(dir);
  fs.stat(resolved, (statErr, stats) => {
    if (statErr) {
      if (statErr.code !== 'ENOENT' && statErr.code !== 'ENOTDIR') {
        console.error('[concilium] github-url stat error:', statErr.message);
      }
      return res.json({ url: null });
    }
    if (!stats.isDirectory()) return res.json({ url: null });
    // Try 'origin' first, then fall back to 'upstream' (common in fork workflows).
    execFile('git', ['-C', resolved, 'remote', 'get-url', 'origin'], (err, stdout) => {
      const originUrl = err ? null : parseGitHubUrl(stdout.toString().trim());
      if (originUrl) return res.json({ url: originUrl });
      execFile('git', ['-C', resolved, 'remote', 'get-url', 'upstream'], (err2, stdout2) => {
        if (err2) return res.json({ url: null });
        const url = parseGitHubUrl(stdout2.toString().trim());
        res.json({ url });
      });
    });
  });
});

router.post('/github-items', async (req, res) => {
  try {
    const url = req.body && req.body.url;
    if (url && typeof url !== 'string') {
      return res.status(400).json({ error: 'url must be a string' });
    }
    if (!url) return res.json(githubItemsResponse(null, [], []));
    const repoData = parseGitHubRepo(url);
    if (!repoData) return res.json(githubItemsResponse(null, [], []));
    const apiBase = `https://api.github.com/repos/${encodeURIComponent(repoData.owner)}/${encodeURIComponent(repoData.repo)}`;
    try {
      const cfg = getConfig();
      const githubToken = getGitHubToken(cfg);
      let issues, pulls;
      let warning = null;
      if (githubToken) {
        // When a token is available, use the GraphQL API to fetch issues, PRs, and their
        // canonical closing-issue links (closingIssuesReferences) in a single round-trip.
        // This covers both body-keyword links and links set via the GitHub UI sidebar,
        // which REST + body parsing cannot detect.
        // Note: fetches up to 20 open PRs and issues (most-recently-updated).
        // closingIssuesReferences returns up to 10 linked issues per PR.
        // An issue closed by an older or already-merged PR may not appear in the
        // top-20 PR window, so linkedPulls on that issue will be absent.
        // closingIssuesReferences includes linked issues regardless of their state,
        // so a PR badge may reference an already-closed issue.
        const gqlQuery = `
          query($owner: String!, $repo: String!) {
            repository(owner: $owner, name: $repo) {
              pullRequests(states: [OPEN], first: ${GITHUB_ITEMS_PER_PAGE}, orderBy: {field: UPDATED_AT, direction: DESC}) {
                nodes {
                  number title url state isDraft headRefName headRefOid id
                  assignees(first: 10) { nodes { login } }
                  closingIssuesReferences(first: 10) { nodes { number } }
                }
              }
              issues(states: [OPEN], first: ${GITHUB_ITEMS_PER_PAGE}, orderBy: {field: UPDATED_AT, direction: DESC}) {
                nodes {
                  number title url state
                  assignees(first: 10) { nodes { login } }
                }
              }
            }
          }
        `;
        const gqlData = await fetchGitHubGraphQL(gqlQuery, { owner: repoData.owner, repo: repoData.repo }, githubToken);
        const rawPulls = gqlData?.repository?.pullRequests?.nodes || [];
        const rawIssues = gqlData?.repository?.issues?.nodes || [];

        // Build bidirectional maps from canonical closingIssuesReferences.
        const pullLinkedIssues = new Map(); // pullNumber → [issueNumber, ...]
        const issueLinkedPulls = new Map(); // issueNumber → [pullNumber, ...]
        for (const rawPull of rawPulls) {
          const linked = (rawPull.closingIssuesReferences?.nodes || []).filter(Boolean).map((n) => n.number);
          if (linked.length) {
            pullLinkedIssues.set(rawPull.number, linked);
            for (const issueNum of linked) {
              if (!issueLinkedPulls.has(issueNum)) issueLinkedPulls.set(issueNum, []);
              issueLinkedPulls.get(issueNum).push(rawPull.number);
            }
          }
        }

        issues = rawIssues.map((item) => ({
          number: item.number,
          title: item.title,
          url: item.url,
          state: (item.state || '').toLowerCase(),
          assignees: (item.assignees?.nodes || []).filter(Boolean).map((a) => a.login),
          ...(issueLinkedPulls.has(item.number) ? { linkedPulls: issueLinkedPulls.get(item.number) } : {}),
        }));
        pulls = rawPulls.map((item) => ({
          number: item.number,
          title: item.title,
          url: item.url,
          state: (item.state || '').toLowerCase(),
          assignees: (item.assignees?.nodes || []).filter(Boolean).map((a) => a.login),
          branch: typeof item.headRefName === 'string' ? item.headRefName : '',
          headSha: typeof item.headRefOid === 'string' ? item.headRefOid : '',
          draft: !!item.isDraft,
          nodeId: typeof item.id === 'string' ? item.id : '',
          ...(pullLinkedIssues.has(item.number) ? { linkedIssues: pullLinkedIssues.get(item.number) } : {}),
        }));
      } else {
        // No token: GitHub GraphQL requires authentication, so fall back to REST.
        // Issues and PRs are displayed without linked-ref badges in this mode.
        const [rawIssues, rawPulls] = await Promise.all([
          fetchGitHubJson(`${apiBase}/issues?state=open&per_page=${GITHUB_ITEMS_PER_PAGE}&sort=updated&direction=desc`),
          fetchGitHubJson(`${apiBase}/pulls?state=open&per_page=${GITHUB_ITEMS_PER_PAGE}&sort=updated&direction=desc`),
        ]);
        issues = Array.isArray(rawIssues)
          ? rawIssues.filter((item) => !item.pull_request).map(toGitHubItem)
          : [];
        pulls = Array.isArray(rawPulls)
          ? rawPulls.map(toGitHubPull)
          : [];
        warning = 'linked refs require a github token';
      }
      res.json(githubItemsResponse(url, issues, pulls, warning));
    } catch (err) {
      const detail = classifyGitHubError(err);
      console.error('[concilium] github-items fetch failed:', err.message);
      res.json({
        ...githubItemsResponse(url, [], []),
        error: detail.message,
        errorCode: detail.code,
      });
    }
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || String(err) });
  }
});

router.post('/github-pulls/action', async (req, res) => {
  try {
    const url = req.body && req.body.url;
    const pullNumber = req.body && req.body.pullNumber;
    const action = req.body && req.body.action;
    const sha = req.body && req.body.sha;
    const mergeMethod = req.body && req.body.mergeMethod;
    const nodeId = req.body && req.body.nodeId;
    if (typeof url !== 'string' || !url) {
      return res.status(400).json({ error: 'url is required' });
    }
    if (!Number.isSafeInteger(pullNumber) || pullNumber < 1) {
      return res.status(400).json({ error: 'pullNumber must be a positive integer' });
    }
    if (action !== 'merge' && action !== 'close' && action !== 'mark_ready') {
      return res.status(400).json({ error: 'action must be "merge", "close", or "mark_ready"' });
    }
    if (sha !== undefined && typeof sha !== 'string') {
      return res.status(400).json({ error: 'sha must be a string' });
    }
    if (mergeMethod !== undefined && mergeMethod !== 'merge' && mergeMethod !== 'squash' && mergeMethod !== 'rebase') {
      return res.status(400).json({ error: 'mergeMethod must be one of "merge", "squash", or "rebase"' });
    }
    if (action === 'mark_ready' && (typeof nodeId !== 'string' || !nodeId)) {
      return res.status(400).json({ error: 'nodeId is required to mark a pull request ready for review' });
    }
    const repoData = parseGitHubRepo(url);
    if (!repoData) return res.status(400).json({ error: 'invalid github repository url' });
    const owner = repoData.owner;
    const repo = repoData.repo;
    if (!GITHUB_REPO_NAME_RE.test(owner) || !GITHUB_REPO_NAME_RE.test(repo)) {
      return res.status(400).json({ error: 'invalid github repository url' });
    }

    const cfg = getConfig();
    const githubToken = getGitHubToken(cfg);
    if (!githubToken) {
      return res.status(400).json({ error: 'set a GitHub token in Settings first' });
    }

    if (action === 'mark_ready') {
      const mutation = 'mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){pullRequest{number isDraft}}}';
      const resp = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          ...githubHeaders(githubToken),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ query: mutation, variables: { id: nodeId } }),
      });
      const data = await resp.json().catch(() => ({}));
      const gqlError = Array.isArray(data && data.errors) && data.errors.length
        ? data.errors[0]
        : null;
      if (!resp.ok || gqlError) {
        const msg = (gqlError && typeof gqlError.message === 'string' && gqlError.message)
          || (data && typeof data.message === 'string' && data.message)
          || `GitHub action failed (HTTP ${resp.status})`;
        return res.status(resp.ok ? 422 : resp.status).json({ error: msg });
      }
      const pr = data && data.data && data.data.markPullRequestReadyForReview && data.data.markPullRequestReadyForReview.pullRequest;
      return res.json({
        ok: true,
        action,
        message: `pull request #${pullNumber} marked ready for review`,
        draft: pr ? !!pr.isDraft : false,
      });
    }

    const payload = {};
    if (action === 'merge') {
      if (sha && sha.trim()) payload.sha = sha.trim();
      if (mergeMethod) payload.merge_method = mergeMethod;
    } else {
      payload.state = 'closed';
    }
    const encodedPullNumber = encodeURIComponent(String(pullNumber));
    const apiUrl = action === 'close'
      ? `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${encodedPullNumber}`
      : `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${encodedPullNumber}/merge`;
    const resp = await fetch(apiUrl, {
      method: action === 'close' ? 'PATCH' : 'PUT',
      headers: {
        ...githubHeaders(githubToken),
        'content-type': 'application/json',
      },
      body: Object.keys(payload).length ? JSON.stringify(payload) : undefined,
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = data && typeof data.message === 'string' && data.message
        ? data.message
        : `GitHub action failed (HTTP ${resp.status})`;
      return res.status(resp.status).json({ error: msg });
    }
    res.json({
      ok: true,
      action,
      message: action === 'close' ? 'pull request closed' : 'pull request merged',
      merged: !!data.merged,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || String(err) });
  }
});

router.post('/github-issues/action', async (req, res) => {
  try {
    const url = req.body && req.body.url;
    const issueNumber = req.body && req.body.issueNumber;
    const action = req.body && req.body.action;
    if (typeof url !== 'string' || !url) {
      return res.status(400).json({ error: 'url is required' });
    }
    if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) {
      return res.status(400).json({ error: 'issueNumber must be a positive integer' });
    }
    if (action !== 'assign_copilot' && action !== 'close') {
      return res.status(400).json({ error: 'action must be "assign_copilot" or "close"' });
    }
    const repoData = parseGitHubRepo(url);
    if (!repoData) return res.status(400).json({ error: 'invalid github repository url' });
    const owner = repoData.owner;
    const repo = repoData.repo;
    if (!GITHUB_REPO_NAME_RE.test(owner) || !GITHUB_REPO_NAME_RE.test(repo)) {
      return res.status(400).json({ error: 'invalid github repository url' });
    }

    const cfg = getConfig();
    const githubToken = getGitHubToken(cfg);
    if (!githubToken) {
      return res.status(400).json({ error: 'set a GitHub token in Settings first' });
    }

    if (action === 'close') {
      const encodedIssueNumber = encodeURIComponent(String(issueNumber));
      const apiUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${encodedIssueNumber}`;
      const resp = await fetch(apiUrl, {
        method: 'PATCH',
        headers: {
          ...githubHeaders(githubToken),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ state: 'closed' }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = data && typeof data.message === 'string' && data.message
          ? data.message
          : `GitHub action failed (HTTP ${resp.status})`;
        return res.status(resp.status).json({ error: msg });
      }
      return res.json({
        ok: true,
        action,
        message: `issue #${issueNumber} closed`,
      });
    }

    const assignment = await assignIssueToCopilot(githubToken, owner, repo, issueNumber);
    if (!assignment.assigned) {
      return res.status(assignment.status || 409).json({ error: assignment.message || 'failed to assign Copilot to issue' });
    }
    return res.json({
      ok: true,
      action,
      message: `issue #${issueNumber} has Copilot assigned`,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || String(err) });
  }
});

router.post('/new-issue', async (req, res) => {
  try {
    const { url, title, body, assignCopilot } = req.body || {};
    if (typeof url !== 'string' || !url.trim()) return res.status(400).json({ error: 'url is required' });
    if (typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'title is required' });
    if (body !== undefined && typeof body !== 'string') return res.status(400).json({ error: 'body must be a string' });
    if (assignCopilot !== undefined && typeof assignCopilot !== 'boolean') {
      return res.status(400).json({ error: 'assignCopilot must be a boolean' });
    }

    const normalizedUrl = url.trim();
    if (normalizedUrl.length > MAX_GITHUB_URL_LENGTH) {
      return res.status(400).json({ error: `url must be ${MAX_GITHUB_URL_LENGTH} characters or fewer` });
    }
    const trimmedUrl = normalizedUrl.replace(/\/+$/, '');
    const repoData = parseGitHubRepo(trimmedUrl);
    if (!repoData) return res.status(400).json({ error: 'Invalid GitHub repository URL' });
    const trimmedTitle = title.trim();
    if (trimmedTitle.length > MAX_ISSUE_TITLE_LENGTH) {
      return res.status(400).json({ error: `title must be ${MAX_ISSUE_TITLE_LENGTH} characters or fewer` });
    }
    const trimmedBody = body ? body.trim() : '';
    if (trimmedBody && Buffer.byteLength(trimmedBody, 'utf8') > MAX_ISSUE_BODY_BYTES) {
      return res.status(400).json({ error: `body must be ${MAX_ISSUE_BODY_BYTES} bytes or fewer` });
    }

    const cfg = getConfig();
    const githubToken = getGitHubToken(cfg);
    if (!githubToken) return res.status(400).json({ error: 'set a GitHub token in Settings first' });

    const createResp = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(repoData.owner)}/${encodeURIComponent(repoData.repo)}/issues`,
      {
        method: 'POST',
        headers: {
          ...githubHeaders(githubToken),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          title: trimmedTitle,
          ...(trimmedBody ? { body: trimmedBody } : {}),
        }),
      },
    );
    const data = await createResp.json().catch(() => ({}));
    if (!createResp.ok) {
      const msg = data && typeof data.message === 'string'
        ? data.message
        : `Issue creation failed (HTTP ${createResp.status})`;
      const err = new Error(msg);
      err.status = createResp.status;
      const remainingHeader = createResp.headers.get('x-ratelimit-remaining');
      const remaining = remainingHeader === null ? null : Number.parseInt(remainingHeader, 10);
      err.rateLimited = Number.isFinite(remaining) && remaining === 0;
      throw err;
    }

    const shouldAssignCopilot = assignCopilot === true;
    let copilotAssigned = false;
    const issueNumber = data && Number.isInteger(data.number) ? data.number : null;
    if (shouldAssignCopilot && issueNumber !== null) {
      try {
        const assignment = await assignIssueToCopilot(githubToken, repoData.owner, repoData.repo, issueNumber);
        copilotAssigned = assignment.assigned;
        if (!copilotAssigned) {
          const detail = assignment.message ? ` (${assignment.message})` : '';
          console.warn(`[concilium] unable to assign issue #${issueNumber} to ${COPILOT_ISSUE_ASSIGNEE}${detail}`);
        }
      } catch (assignErr) {
        console.warn('[concilium] copilot issue assignment failed:', assignErr && assignErr.message ? assignErr.message : assignErr);
      }
    }

    res.json({
      ...toGitHubItem(data),
      copilotAssignmentRequested: shouldAssignCopilot,
      copilotAssigned,
    });
  } catch (err) {
    const detail = classifyGitHubError(err);
    res.status(err.status || 500).json({ error: detail.message });
  }
});

router.post('/new-project/check', async (req, res) => {
  try {
    const parsed = sanitizeProjectName(req.body && req.body.name);
    if (parsed.error) return res.json({ canCreate: false, reason: parsed.error });

    const cfg = getConfig();
    const githubToken = getGitHubToken(cfg);
    if (!githubToken) return res.json({ canCreate: false, reason: 'set a GitHub token in Settings first' });

    const { login } = await fetchGitHubUser(githubToken);
    const repoUrl = `https://api.github.com/repos/${encodeURIComponent(login)}/${encodeURIComponent(parsed.name)}`;
    const repoResp = await fetch(repoUrl, { headers: githubHeaders(githubToken) });
    if (repoResp.status === 404) return res.json({ canCreate: true, owner: login });
    if (repoResp.ok) return res.json({ canCreate: false, owner: login, reason: `repository ${login}/${parsed.name} already exists` });
    if (repoResp.status === 401) return res.json({ canCreate: false, reason: 'GitHub token is not authorized (HTTP 401)' });
    if (repoResp.status === 403) return res.json({ canCreate: false, reason: 'GitHub token cannot access repository checks (HTTP 403)' });
    return res.json({ canCreate: false, reason: `GitHub check failed (HTTP ${repoResp.status})` });
  } catch (err) {
    const detail = classifyGitHubError(err);
    if (detail.code === 'fetch_failed' || detail.code === 'http_error') {
      return res.status(502).json({ error: detail.message });
    }
    res.json({ canCreate: false, reason: detail.message });
  }
});

router.post('/new-project', newProjectRateLimiter, async (req, res) => {
  try {
    const parsed = sanitizeProjectName(req.body && req.body.name);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    if (typeof req.body?.private !== 'undefined' && typeof req.body.private !== 'boolean') {
      return res.status(400).json({ error: 'The private field must be a boolean value' });
    }
    const isPrivate = !!(req.body && req.body.private);

    const rawTarget = req.body && req.body.targetPath;
    if (!rawTarget || typeof rawTarget !== 'string') {
      return res.status(400).json({ error: 'targetPath is required' });
    }

    const cfg = getConfig();
    const githubToken = getGitHubToken(cfg);
    if (!githubToken) return res.status(400).json({ error: 'set a GitHub token in Settings first' });

    const homeRealPath = await fs.promises.realpath(os.homedir());
    const targetPath = cfg.publicServer === true
      ? resolvePathWithinHome(rawTarget, homeRealPath)
      : path.resolve(expandTilde(rawTarget.trim()));
    if (!targetPath) return res.status(400).json({ error: 'targetPath is required' });

    let stats;
    try {
      stats = await fs.promises.stat(targetPath);
    } catch (err) {
      if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
        return res.status(400).json({ error: 'target location does not exist' });
      }
      throw err;
    }
    if (!stats.isDirectory()) return res.status(400).json({ error: 'target location must be a directory' });
    try {
      await fs.promises.access(targetPath, fs.constants.W_OK);
    } catch (err) {
      if (err && err.code === 'EACCES') {
        return res.status(403).json({ error: 'target location is not writable' });
      }
      throw err;
    }

    const destination = path.join(targetPath, parsed.name);
    const destinationRelative = path.relative(targetPath, destination);
    if (destinationRelative.startsWith('..') || path.isAbsolute(destinationRelative)) {
      return res.status(400).json({ error: 'invalid target project directory' });
    }
    try {
      await fs.promises.stat(destination);
      return res.status(409).json({ error: 'target project directory already exists' });
    } catch (err) {
      if (!err || err.code !== 'ENOENT') throw err;
    }

    const { login } = await fetchGitHubUser(githubToken);
    const createResp = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: {
        ...githubHeaders(githubToken),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: parsed.name,
        auto_init: true,
        private: isPrivate,
      }),
    });
    const createData = await createResp.json().catch(() => ({}));
    if (!createResp.ok) {
      const msg = typeof createData.message === 'string' ? createData.message : `GitHub repo creation failed (HTTP ${createResp.status})`;
      const status = createResp.status >= 400 && createResp.status < 600 ? createResp.status : 502;
      return res.status(status).json({ error: msg });
    }

    const cloneUrl = typeof createData.clone_url === 'string' ? createData.clone_url : '';
    const createdOwner = createData && createData.owner && typeof createData.owner.login === 'string'
      ? createData.owner.login
      : login;
    const createdRepo = typeof createData.name === 'string' ? createData.name : parsed.name;
    const createdPrivate = createData && createData.private === true;
    const htmlUrl = typeof createData.html_url === 'string'
      ? createData.html_url
      : `https://github.com/${encodeURIComponent(createdOwner)}/${encodeURIComponent(createdRepo)}`;
    if (!cloneUrl) return res.status(502).json({ error: 'GitHub did not return a clone URL' });

    try {
      await execFileWithOutput('git', ['clone', '--', cloneUrl, destination], { timeout: GIT_CLONE_TIMEOUT_MS });
    } catch (err) {
      let cleanupSucceeded = false;
      let localCleanupSucceeded = false;
      try {
        cleanupSucceeded = await deleteGitHubRepo(githubToken, createdOwner, createdRepo);
      } catch (_cleanupErr) {
        console.error('[concilium] orphan repo cleanup failed:', _cleanupErr && _cleanupErr.message ? _cleanupErr.message : _cleanupErr);
      }
      try {
        await fs.promises.rm(destination, { recursive: true, force: true });
        localCleanupSucceeded = true;
      } catch (localCleanupErr) {
        console.error('[concilium] partial clone cleanup failed:', localCleanupErr && localCleanupErr.message ? localCleanupErr.message : localCleanupErr);
      }
      const stderr = err && typeof err.stderr === 'string' ? err.stderr.trim() : '';
      const message = stderr || err.message || 'git clone failed';
      const cleanupMessage = cleanupSucceeded
        ? 'Temporary repository cleanup succeeded.'
        : `Repository may still exist: ${htmlUrl}`;
      const localCleanupMessage = localCleanupSucceeded
        ? 'Partial local clone cleanup succeeded.'
        : 'Local directory may still exist.';
      return res.status(502).json({
        error: `repository created but clone failed: ${message}. ${cleanupMessage} ${localCleanupMessage}`,
        repoUrl: htmlUrl,
        cleanupSucceeded,
        localCleanupSucceeded,
      });
    }

    res.json({
      ok: true,
      cwd: destination,
      repoUrl: htmlUrl,
      private: createdPrivate,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || String(err) });
  }
});

module.exports = router;

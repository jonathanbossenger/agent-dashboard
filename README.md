[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/jonathanbossenger/concilium)

# Concilium

Concilium is a locally-installed dashboard for running multiple CLI AI coding
agents side-by-side — Claude Code, Codex, Goose, Aider, Gemini, Copilot, Ollama, or
anything else on your `$PATH`. Each agent runs in its own card with a real
[xterm.js](https://xtermjs.org/) terminal, so both one-shot tools and
interactive REPL-style agents work end-to-end: type, watch ANSI output render
natively, resize, kill, restart.

Pop open a plain shell terminal alongside any session for side-channel
commands. When a card's working directory is a GitHub repo, browse its open
PRs and issues from the same UI — merge, close, mark drafts ready, assign
issues to Copilot, or scaffold a brand-new repo end-to-end (create on GitHub,
clone locally, open a session pre-pointed at it). Sessions, working
directories, and task history persist in SQLite across restarts.

Local-first (`127.0.0.1` by default), no framework, no build step. When exposed
publicly, Concilium auto-switches to admin-auth mode on first external access.
Started, stopped, and installed as a user service Apache-style via
`conciliumctl`.

[Read the announcement post](https://jonathanbossenger.com/2026/05/introducing-concilium/)

[Watch the video](https://youtu.be/17Ykm0AtCYI?si=ugDNgYitcqzi5wOb)

Your council of agents — Concilium!

![Concilium dashboard screenshot](screenshots/dashboard.png)

<!-- When renaming a heading below, also update the matching link in this list. -->
## Table of contents

- [Features](#features)
- [Requirements](#requirements)
- [Quickstart](#quickstart)
- [Concilium user documentation](#concilium-user-documentation)
- [Install](#install)
- [Usage](#usage)
- [Configuration](#configuration)
- [API](#api)
- [Project layout](#project-layout)
- [License](#license)

## Features

- **Card-based session UI** — each card is an independent agent session with
  its own selector, working directory, prompt, output, and (for interactive
  agents) input line. Add cards with **+ New session**, close them when done.
  Card controls are compact icon buttons: 📂 opens the OS folder picker for
  the working directory, ▶ starts the task (turns red while a task is
  running, click to kill), **>_** opens a pop-out terminal card (see
  below), **`</>`** opens the current working directory in your configured
  editor on the local loopback UI, and **⤢** expands a single card to fill the main area with a
  smooth View Transitions animation between states. When the working
  directory resolves to a GitHub repo (via `git remote`), a GitHub
  (octocat) button appears in the card header: clicking it opens a GitHub
  browser card (see below) showing the repo's open pull requests and
  issues. When the cwd is set but the directory is not yet linked to a
  GitHub repo, the same button opens github.com/new to create one. A
  **⧉** clone button duplicates the card with the same agent and working
  directory, then starts the new session immediately. Paths under `$HOME`
  display as `~/...` shorthand in the cwd field; the server expands them
  at launch. Drag a card by its header to reorder it on the grid; the new
  order is persisted to the saved layout. Header controls (select, buttons,
  GitHub button) stay clickable; dragging is disabled while a card is
  expanded.
- **Pop-out terminal cards** — the **>_** button on any session card opens
  an independent shell terminal in a new card (using `$SHELL` on macOS/Linux
  and PowerShell on Windows, inserted right after the triggering card).
  Useful for running side commands —
  `git status`, `ls`, `tail` — in the same working directory as your agent
  without leaving the dashboard. Terminal cards expand and close like any
  other card; closing one ends the shell and drops its history.
- **GitHub browser cards** — clicking the GitHub (octocat) button on any
  session card (when the working directory is a GitHub repository) opens a
  GitHub browser card next to it. The card lists the repo's open pull
  requests and issues (up to 20 each, sorted by last update). Pull request
  rows show the branch name with a copy button, a merge-method selector
  (merge / squash / rebase), a merge button, and a close button; draft PRs
  instead show a "Mark ready for review" button. Issue rows show an "Assign
  to Copilot" button (replaced by a checkmark once assigned) and a close
  button. A **+** button in the GitHub card header opens a **New Issue**
  dialog where you can create an issue with an optional description and
  optionally assign it to the Copilot coding agent. All write actions
  (merge, close, assign, create issue) require a GitHub token configured in
  Settings.
- **Session restore** — the card layout (agent, working directory, last task)
  is persisted server-side in SQLite, so reloading the page or restarting
  the server brings your sessions back and automatically starts each saved
  session with its configured agent and working directory. Closing a card
  permanently removes it (and the tasks it launched) from the saved layout.
- **First-run onboarding wizard** — on a fresh install the dashboard walks
  you through adding your first agent, optionally registering more agents,
  and (optionally) saving a GitHub token before dropping you into the main
  UI. The wizard skips itself once at least one agent is configured and the
  flow has been marked complete.
- **Task history** — the clock button in the header opens a history dialog
  listing finished tasks (id, agent, working directory, started timestamp,
  status). Each row has a **replay** action that opens a new card pre-pointed
  at that task's working directory.
- **Two execution modes** — piped stdin for one-shot tools, PTY (via `node-pty`)
  for interactive REPL-style agents
- **Real terminal in the browser** — each card embeds an
  [xterm.js](https://xtermjs.org/) terminal. ANSI/colors/cursor moves render
  natively, keystrokes go straight to the agent's stdin, and a
  `ResizeObserver` + the fit addon drive a resize handshake to the PTY so
  TUIs reflow correctly when you expand a card or resize the window.
- **Live streaming** of stdout/stderr to the browser via Server-Sent Events,
  with automatic reconnect after laptop sleep / network drops so the stream
  resumes without a manual refresh.
- **Persistent history** in SQLite, plus per-task plain-text logs under
  `~/.concilium/logs/`. Closing a card kills any running task and
  deletes that session's tasks + logs.
- **Light / dark / auto theme** — defaults to your OS preference
  (`prefers-color-scheme`); the **Auto** button in the header cycles to
  Light or Dark and persists in `localStorage`.
- **Apache-style lifecycle** — `conciliumctl start | stop | restart | status`,
  with optional install as a launchd or systemd `--user` service
- **PATH-based agent discovery** — scans `$PATH` for known CLIs and lets you
  add them with one click
- **Vanilla web UI** — no framework, no build step, just HTML/CSS/JS
- **Public-server ready** — keep the default loopback-only local mode, or set
  `host: 0.0.0.0` for server deployments. In public-server mode, Concilium
  requires a one-time setup token from the server log to create the first admin
  user, then requires sign-in for API access.

## Requirements

- Node.js 18+ (tested on 24)
- macOS, Linux, or modern Windows with PowerShell
- A C toolchain only if `node-pty`'s prebuilt binaries aren't available for
  your platform; the current `node-pty` package ships prebuilds for macOS
  arm64/x64 and Windows x64/arm64, while some Linux installs may still build
  from source

External CLIs the server invokes (must be on `$PATH`):

- **`git`** — required. Used to read `origin` / `upstream` remotes when
  detecting the GitHub repo for a card's working directory.
- **`zenity`** — Linux only, optional. Powers the OS folder picker (📂) on
  GNU/Linux desktops. Without it, type or paste paths into the cwd field.
  On macOS the picker uses built-in `osascript`; on Windows it uses built-in
  `powershell`.

## Quickstart

If you just want to get going quickly:

1. Clone and install dependencies:
   ```bash
   git clone git@github.com:jonathanbossenger/concilium.git
   cd concilium
   npm install
   ```
2. Make `conciliumctl` available in your shell:
   ```bash
   npm link
   ```
3. Start Concilium:
   ```bash
   conciliumctl start
   ```
4. Open <http://127.0.0.1:7878>, complete the onboarding wizard, then create a
   session and run your first prompt.

For public-server deployments, follow
[docs/server-mode-setup.md](docs/server-mode-setup.md) instead of the local
loopback quickstart. That flow uses the server log's setup token to create the
first admin user, then requires sign-in before you reach the dashboard.

For full install, setup, and usage details, see the documentation section below.

## Concilium user documentation

### Install

For installation and first-run setup, see:

- [docs/install-and-first-time-setup.md](docs/install-and-first-time-setup.md)
- [docs/server-mode-setup.md](docs/server-mode-setup.md) for remote/server deployments (including Tailscale)
- [docs/README.md](docs/README.md) for the full user docs index

### Usage

For day-to-day use, see:

- [docs/using-concilium.md](docs/using-concilium.md)
- [docs/configuring-agents.md](docs/configuring-agents.md)
- [docs/github-token.md](docs/github-token.md)
- [docs/uninstalling.md](docs/uninstalling.md)

## Configuration

State lives entirely under `~/.concilium/`:

```
~/.concilium/
├── config.yaml      # port + agent list + optional githubToken + optional preferredEditor + onboardingCompleted flag
├── tasks.db         # SQLite history + saved card layout
├── logs/<id>.log    # per-task plain-text output log (rotates at 5MB, keeps 3 backups)
├── server.log       # the server's own stdout/stderr
└── run.pid          # standalone-mode PID file
```

A minimal `config.yaml`:

```yaml
host: 127.0.0.1
port: 7878
trustProxy: false
forceSecureCookies: false
publicServer: false
setupTokenHash: ""
adminUser: ""
adminPasswordHash: ""
adminPasswordSalt: ""
authSecret: ""
githubToken: ""
agents:
  - id: claude
    name: Claude Code
    command: claude
    interactive: false
  - id: aider
    name: Aider
    command: aider
    interactive: true
    args: ["--no-pretty"]
```

`interactive: false` → stdin is piped in, then closed (one-shot).
`interactive: true` → spawned under a PTY; stays alive for follow-up input.
`githubToken` is optional and used for authenticated GitHub API requests.
`preferredEditor` is optional and used by the **`</>`** card button on the local loopback UI.

Edits via the UI take effect immediately. Editing the YAML by hand requires
a restart (`conciliumctl restart`).
`config.yaml` may contain a secret token — keep it readable only by your user.
Task output events are retained for up to 30 days and capped at 20,000 rows per
task; startup/periodic maintenance prunes older rows and removes orphaned task
log files.

### Public-server hardening notes

- When `host` is non-loopback (for example `0.0.0.0`), Concilium enables
  `publicServer` at boot.
- First-time admin setup requires the setup token printed in the server logs.
  Complete setup over a trusted channel (for example SSH + loopback tunnel)
  before exposing the port broadly.
- Reverse proxy deployments should set `trustProxy: true` so client IP /
  forwarded proto are honored. If TLS is terminated upstream and you still want
  `Secure` cookies without proxy headers, set `forceSecureCookies: true`.
- To revert to local-only mode, edit `~/.concilium/config.yaml`, set
  `publicServer: false`, clear `adminUser`/`adminPasswordHash`/`adminPasswordSalt`/
  `authSecret`/`setupTokenHash`, set `host: 127.0.0.1`, then restart Concilium.

## API

All endpoints are JSON.

| Method | Path | Description |
|---|---|---|
| `GET`    | `/api/health` | server pid, uptime, live task count, total event count, log directory size |
| `GET`    | `/api/agents` | list configured agents |
| `GET`    | `/api/agents/:id` | get a single agent |
| `POST`   | `/api/agents` | create agent `{id, name, command, args?, interactive}` |
| `PATCH`  | `/api/agents/:id` | update fields |
| `DELETE` | `/api/agents/:id` | remove |
| `GET`    | `/api/agents/discover` | scan `$PATH` for known CLIs |
| `GET`    | `/api/tasks` | task history (newest first; `?limit=` capped at 500) |
| `POST`   | `/api/tasks` | start task `{agent_id, prompt?, cwd?, cols?, rows?}` → `{task_id}` (`cols`/`rows` size the PTY at spawn for interactive agents) |
| `POST`   | `/api/tasks/terminal` | start the default interactive shell PTY task (`$SHELL` on macOS/Linux, PowerShell/`ComSpec` on Windows) `{cwd?, cols?, rows?}` → `{task_id}` |
| `GET`    | `/api/tasks/:id` | task + all events |
| `DELETE` | `/api/tasks/:id` | remove task (kills first if live), drops events + log file |
| `POST`   | `/api/tasks/:id/kill` | SIGTERM the running task |
| `POST`   | `/api/tasks/:id/input` | send stdin to interactive task `{data}` |
| `POST`   | `/api/tasks/:id/resize` | resize the PTY `{cols, rows}` (PTY mode only) |
| `GET`    | `/api/stream/:id` | SSE: replays past events then streams live |
| `POST`   | `/api/system/pick-directory` | open the OS folder picker, returns `{path}` |
| `GET`    | `/api/system/directories` | list directories under the server user's home directory (`{path?, entries}`) |
| `GET`    | `/api/system/auth/state` | public-server auth mode + setup/login state |
| `POST`   | `/api/system/auth/setup` | create first admin user `{setupToken, username, password, confirmPassword}` (public-server mode only) |
| `POST`   | `/api/system/auth/login` | sign in `{username, password}` (public-server mode only) |
| `POST`   | `/api/system/auth/logout` | clear current auth session |
| `POST`   | `/api/system/github-url` | `{path}` → `{url}` if the directory's `origin`/`upstream` remote points at GitHub |
| `POST`   | `/api/system/github-items` | `{url}` → `{issues, pulls, warning?}` for open GitHub issues/pull requests (up to 20 of each, sorted by last update). With a token, items also carry `linkedIssues` / `linkedPulls` cross-references derived from GraphQL `closingIssuesReferences`; without a token the response includes `warning: "linked refs require a github token"` |
| `POST`   | `/api/system/github-pulls/action` | trigger a pull request action with `{url, pullNumber, action, sha?, mergeMethod?, nodeId?}`; `action` is `"merge"`, `"close"`, or `"mark_ready"` |
| `POST`   | `/api/system/github-issues/action` | trigger an issue action with `{url, issueNumber, action}` (`action: "assign_copilot"` assigns GitHub Copilot — tries the `Copilot` issue-assignee login first and falls back to `copilot-swe-agent[bot]`; `action: "close"` closes the issue) |
| `POST`   | `/api/system/new-issue` | create a GitHub issue `{url, title, body?, assignCopilot?}` → `{number, title, url, state, assignees, copilotAssignmentRequested, copilotAssigned}` |
| `GET`    | `/api/system/github-token` | returns whether `githubToken` is configured |
| `POST`   | `/api/system/github-token` | save/clear configured `githubToken` (submit empty to clear) |
| `POST`   | `/api/system/new-project/check` | check whether `{name}` can be used to create a repo with the saved GitHub token |
| `POST`   | `/api/system/new-project` | create repo + clone from `{name, targetPath, private?}` (defaults to public) → `{ok, cwd, repoUrl, private}` |
| `GET`    | `/api/system/onboarding` | onboarding state `{needsOnboarding, hasAgent, hasToken}` |
| `POST`   | `/api/system/onboarding/complete` | mark the onboarding wizard finished (requires at least one configured agent) |
| `GET`    | `/api/system/layout` | the saved card layout (array of `{agentId, cwd, lastTaskId}`) |
| `POST`   | `/api/system/layout` | replace the saved card layout |

## Project layout

```
concilium/
├── bin/conciliumctl                       # lifecycle CLI
├── install/                               # launchd & systemd templates
├── public/                                # vanilla HTML/CSS/JS UI (no framework, no bundler)
├── scripts/
│   ├── fix-pty-perms.js                   # postinstall fixup for node-pty's spawn-helper bit
│   └── capture-screenshots.js             # Playwright-driven screenshot helper
├── test/smoke.test.js                     # node:test smoke suite
└── server/
    ├── index.js                           # entry: listen + signal handlers
    ├── app.js                             # Express app factory + /api/health
    ├── config.js                          # YAML load/save (atomic), state dir
    ├── constants.js                       # shared numeric/string constants
    ├── discover.js                        # PATH scan for known agents
    ├── loopback.js                        # loopback-only request middleware
    ├── runner.js                          # spawn vs. PTY runner
    ├── manager.js                         # live task registry, log writer, batched events
    ├── store.js                           # SQLite (tasks + events + layout)
    ├── util/path.js                       # tilde expansion (~/foo → /home/me/foo)
    └── routes/
        ├── agents.js                      # CRUD + discover
        ├── tasks.js                       # task lifecycle, incl. /terminal pop-out shell
        ├── stream.js                      # SSE stream + reconnect resumption
        ├── github.js                      # GitHub URL detection, items, actions, new-project
        ├── editor.js                      # preferred-editor config + open-editor
        ├── layout.js                      # saved card layout
        ├── onboarding.js                  # onboarding state + github-token storage
        └── picker.js                      # native OS folder picker
```

Runtime dependencies: `express`, `express-rate-limit`, `better-sqlite3`,
`js-yaml`, `node-pty`, `@xterm/xterm`, `@xterm/addon-fit` (the latter two are
served straight from `node_modules` via static mounts at `/vendor/xterm` and
`/vendor/xterm-addon-fit` — no bundler).

## License

GPL-2.0-or-later. Free as in freedom, not just free beer. See `LICENSE`.

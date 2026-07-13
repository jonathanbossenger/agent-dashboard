# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

There is no build step and no linter. The frontend is hand-written HTML/CSS/JS (native ES modules) served as static files.

- `npm install` — installs the runtime deps (`express`, `better-sqlite3`, `js-yaml`, `node-pty`, `@xterm/xterm`, `@xterm/addon-fit`). Triggers `scripts/fix-pty-perms.js`, which restores the executable bit on `node-pty`'s `spawn-helper` (npm strips it; without this, PTY spawns fail with `posix_spawnp failed.`). The xterm packages are served straight from `node_modules` via two static mounts in `server/app.js` (`/vendor/xterm`, `/vendor/xterm-addon-fit`) — no bundler.
- `npm start` — runs `node server/index.js` in the foreground (useful when iterating; no daemonization).
- `npm test` — runs `node --test --test-concurrency=1` over `test/*.test.js`. The single smoke suite (`test/smoke.test.js`) drives the app through `supertest` against `createApp()` (see below) with `HOME` pointed at a fresh temp dir per test, and clears the `server/*` require cache between bootstraps to re-trigger module-load side effects (SQLite handle, config cache, crash recovery). `--test-concurrency=1` is required — tests share process-global state (`HOME`, the config cache, `global.fetch` stubs) and will clobber each other if run in parallel. Run one test with `node --test --test-name-pattern="<substring>"`.
- `npm run capture-screenshots` — Playwright script (dev dependency) that regenerates the images under `screenshots/`.
- `./bin/conciliumctl start | stop | restart | status | logs` — Apache-style lifecycle. `start` writes a PID file to `~/.concilium/run.pid` and logs to `~/.concilium/server.log`. After `conciliumctl install`, the same commands drive a launchd agent (macOS) or `systemd --user` unit (Linux) instead of the standalone PID-file path; `conciliumctl status` reports which mode is active.
- Restart after editing `~/.concilium/config.yaml` by hand — `getConfig()` is process-cached. Edits made through the web UI bypass the cache via `saveConfig()` and take effect immediately.

The server only listens on `127.0.0.1`. Port comes from `config.yaml` (default 7878).

## Architecture

### App factory vs. listener

`server/index.js` is a thin entrypoint: it calls `createApp()` from `server/app.js`, then `listen()`s on `127.0.0.1` and wires `SIGTERM`/`SIGINT` graceful shutdown. All Express wiring lives in `createApp()`. Keeping app construction separate from the network listener is what lets the smoke tests build an app in-process and drive it with `supertest` without binding a port.

### Module load order matters

`createApp()` (in `server/app.js`) calls `ensureState()` from `config.js` *before* `require`-ing any route module — the route requires sit inside the function body, not at file top. This is load-bearing: `store.js` opens the SQLite database at module-load time using `STATE_DIR` from `config.js`, so the state directory must exist first. If you add a new route module that pulls in `store.js` (directly or transitively), require it inside `createApp()` after `ensureState()` like the existing routes do — never at the top of `app.js`.

### Loopback-only API

`app.js` mounts `requireLoopbackRequest` (from `loopback.js`) on `/api` before any route. It parses the `Host`/`X-Forwarded-Host` header and returns `403 { code: 'loopback_only' }` unless the host resolves to `127.0.0.1`, `localhost`, or `::1`. This is a second line of defense behind the `127.0.0.1`-only bind — it blocks DNS-rebinding-style requests that arrive with a non-loopback `Host`. Tests must set `.set('host', 'localhost')` on every request (the `withLocalHost` helper) or they get 403s.

### Two execution modes per agent

`runner.js` dispatches on `agent.interactive`:

- `false` → `child_process.spawn`, prompt is written to stdin, stdin is then closed. One-shot.
- `true` → `node-pty` spawn, prompt is written but the PTY stays open for follow-up `write()` calls. Used for REPL-style agents.

`runner.js` exposes a uniform `EventEmitter` interface (`event`, `end`, `kill()`, `write()`, `resize(cols, rows)`) so `manager.js` doesn't branch on mode. `write` and `resize` are no-ops (return `false`) in piped mode — only the PTY emitter actually drives them. In PTY mode, stdout and stderr are merged by the kernel — everything is reported as `stream: 'stdout'`.

### Live tasks vs. historical tasks

`manager.js` keeps a `Map<task_id, { broadcast, runner, logStream }>` of currently-running tasks. Every event from the runner is fanned out to three places **synchronously in this order**: (1) SQLite via `store.appendEvent`, (2) the per-task plain-text log file under `~/.concilium/logs/<id>.log`, (3) the in-process `broadcast` EventEmitter that SSE subscribers listen on.

This ordering is the invariant that makes the SSE replay work without gaps or duplicates. See `server/routes/stream.js`: a new SSE client first attaches its listener to `broadcast`, *then* reads past events from the DB. Because step (1) (DB write) completes before step (3) (broadcast) for every event, the DB snapshot at subscribe-time covers exactly the events that fired before the subscription — no overlap with the live stream that follows. Don't reorder these emits.

When a task ends, `manager.js` deletes the entry from `live`. SSE subscribers that connect after that fall through to the "task already finished — replay from DB and close" path in `stream.js`.

### Boot-time crash recovery

`store.js` runs `UPDATE tasks SET status = 'crashed' WHERE status = 'running'` on every module load. This cleans up any tasks the previous server process left mid-run. If you add new terminal statuses, treat `running` as the only "still alive" sentinel.

### Card-based frontend

The frontend is native ES modules (`<script type="module" src="/app.js">` in `index.html`) — no React, no bundler, no transpilation. Edit files in `public/` and reload. `xterm.js` and its fit addon are the exception: they're loaded as classic scripts before `app.js` and referenced as globals (`Terminal`, `FitAddon`).

Module layout:
- `app.js` — orchestrator. Owns the global wiring: agent-list fetch, layout save/restore, health polling, drag-drop reflow, keyboard shortcuts, settings/onboarding dialogs. Fills the **function slots** in `state.js` (`addCard`, `addTerminalCard`, `addGitHubCard`, `saveLayout`, `openNewIssueDialog`) at startup.
- `state.js` — shared mutable state: the `cards`/`termCards` sets, `agentsById` map, and an `appState` object holding scalars plus the function slots. This is the seam that lets card modules call back into `app.js` without a circular import — modules import the slots from `state.js`; `app.js` populates them.
- `base-card.js` — `BaseCard`, the shared xterm terminal lifecycle (`initTerminal`, `fitAndResize`, theme application, status) inherited by `Card` and `TerminalCard`.
- `card.js` — `Card`, the primary agent card (agent select, cwd + directory browse, Start/Kill, embedded terminal). Can spawn child cards: a `TerminalCard` (plain shell) or a `GitHubCard`, passing `parentCard: this`.
- `terminal-card.js` — `TerminalCard`, a bare terminal card (no agent select).
- `github-card.js` — `GitHubCard`, lists issues/PRs for a repo; does **not** extend `BaseCard` (no terminal).
- `drag.js`, `utils.js`, `git-cheatsheet.js` — drag-and-drop, dependency-free helpers/constants/SVG icons, and the git command reference overlay.

Each card owns its own task lifecycle. `cards`/`termCards` are `Set`s so agent-list refreshes and theme changes can iterate all live instances. Closing a card calls `DELETE /api/tasks/:id` for every task it ever launched, which kills any still-running task and drops its events + log file. This delete cascade applies to tasks restored from a saved layout as well — closing a card permanently removes all history for those tasks.

`initTerminal()` (in `BaseCard`) must run **after** the card element is appended to the DOM so `FitAddon` can measure the container; the `add*Card()` helpers in `app.js` enforce this ordering. A `ResizeObserver` on the terminal container drives `fitAddon.fit()` and `POST /api/tasks/:id/resize` whenever the rendered cols/rows change (e.g. on expand/collapse or window resize).

The SSE handler in `attach()` deliberately **skips events with `stream === 'stdin'`** — the PTY echoes user input back as stdout, so rendering stdin would double-print every keystroke. The DB still records stdin events (for history fidelity); we just don't render them.

The terminal theme is sourced from CSS custom properties (`--term-bg`, `--term-fg`, `--term-cursor`, `--term-selection`) so it tracks the existing Auto/Light/Dark cycler and OS `prefers-color-scheme` flips. xterm.css hardcodes `#000` on `.xterm-viewport`; `style.css` overrides it to `var(--term-bg)` so light mode doesn't bleed black.

### Configuration & discovery

`config.js` owns `~/.concilium/` (state dir, config path, log dir constants). `discover.js` has a hardcoded `KNOWN` list of CLI agents and `which()`-style scans `$PATH` for them — used by the settings UI's "Discover" panel. The same list seeds defaults in `config.js`. When adding a known agent, update both `KNOWN` in `discover.js` and the default in `config.js` so the bundled defaults and discovery suggestions stay in sync.

### Routes beyond agents/tasks/stream

Routes are split by concern under `server/routes/` and mostly mounted under `/api/system`. Two carry non-obvious behavior:

- `github.js` — the `POST /api/system/github-items` endpoint has **two code paths keyed on whether a GitHub token is configured**. With a token it hits the GraphQL API and returns issues/PRs enriched with cross-references (`linkedIssues`/`linkedPulls`) and `warning: null`. Without a token it falls back to the REST API, cannot resolve linked refs, and returns `warning: 'linked refs require a github token'`. Both paths normalize into the same issue/PR shape — keep them in sync when changing either.
- `picker.js` / `editor.js` — shell out to the OS: `picker.js` opens a native directory picker (`osascript` on macOS), `editor.js` launches the user's preferred editor. Both guard on `isLoopbackRequest` for defense in depth since they spawn processes.

`onboarding.js` and `layout.js` persist the GitHub token and saved card layout respectively. Shared helpers live in `constants.js` (magic numbers) and `util/path.js` (`expandTilde`).

### Service install flow

`conciliumctl install` reads `install/com.user.concilium.plist.tmpl` (macOS) or `install/concilium.service.tmpl` (Linux) and substitutes `@NODE_BIN@`, `@PROJECT_ROOT@`, `@LOG_FILE@`, `@USER_PATH@`. Baking the user's current `$PATH` into the service definition is intentional — it lets the daemon find agents installed via Homebrew, nvm, etc. when launched by launchd/systemd outside an interactive shell.

# Using Concilium

## Quick start

1. Click **+ New session**.
2. Select an agent.
3. Set the working directory (📂 or type/paste a path).
4. Enter your prompt and click **▶** to start.

Use **>_** to open a side terminal in the same working directory. If you save a
preferred editor in Settings, use **`</>`** to open that directory in your editor
from the local loopback UI.

## Running Concilium

### Standalone

```bash
conciliumctl start         # daemonizes node, writes PID file
conciliumctl status
conciliumctl restart
conciliumctl stop
conciliumctl logs          # follow the server log
```

### As a user service (auto-start on login)

```bash
conciliumctl install       # writes launchd plist or systemd --user unit
conciliumctl status        # mode: service
conciliumctl uninstall
```

The install step bakes the absolute path to `node`, the project root, and your
current `$PATH` into the service definition, so the dashboard can find agents
installed via Homebrew, nvm, etc.

On Windows, `conciliumctl start|stop|restart|status|logs` work in standalone
mode from PowerShell, but `install`/`uninstall` are not supported yet.

## Web UI

Open <http://127.0.0.1:7878> after starting. The page boots with one empty
session card; click **+ New session** to add more, or **×** on a card to close
it (kills any running task in that card and deletes its history).

Each session card includes:

- **📂** — open the OS folder picker for the working directory.
- **▶** — start the task (or kill it while it is running).
- **>_** — open a side terminal card in the same working directory.
- **`</>`** — open the working directory in your configured preferred editor
  (local loopback UI only).
- **GitHub (octocat)** — open a GitHub browser card for the current repository,
  or jump to `github.com/new` when the directory is not linked to GitHub yet.
- **⧉** — duplicate the session card with the same agent and working directory,
  then start it immediately.
- **⤢** — expand the card to fill the main area; click again to collapse it.

Drag session cards by their headers to reorder them. Concilium saves the card
layout, working directories, and last tasks in SQLite so the layout is restored
after a reload or restart.

Header controls:

- **+ New session** — adds another card.
- **🕐 (clock)** — opens the **Task history** dialog listing finished tasks
  (id, agent, working directory, started timestamp, status). Each row has a
  **replay** button that opens a new card pre-pointed at that task's working
  directory.
- **⧉** — opens a **New Project** dialog. Concilium validates the project name
  against GitHub using your saved token, then creates a new repository (public
  by default, with an optional private toggle) with an initialized README,
  clones it into your selected target location, and opens a new session card
  with that directory pre-filled.
- **🖥 / ☀ / ☾** — cycles theme (auto/light/dark); defaults to your OS preference.
- **Gear (⚙)** — opens a settings dialog where you can:
  - Add, edit, or delete agents
  - Scan `$PATH` for known CLI agents and add the ones found
  - Configure a preferred code editor command for the **`</>`** card button on the local loopback UI
  - Set or clear an optional `githubToken` used for authenticated GitHub API calls
- **⌨** — opens the keyboard shortcuts help dialog.

On a fresh install (no agents configured, onboarding not yet marked complete)
the dashboard opens an onboarding wizard instead of the main UI. The wizard
walks through adding a first agent, optionally adding more, and optionally
saving a GitHub token, then drops you into the dashboard.

### Public server mode

When Concilium is running in public-server mode on a non-loopback host, remote
clients do not go straight into the local onboarding flow. Instead:

- if no admin user exists yet, the first screen is a setup form that requires
  the setup token printed by `conciliumctl start` / `conciliumctl logs`
- after the first admin is created, users must sign in before they can access
  the same dashboard, session cards, terminals, and GitHub browser cards

See [server-mode-setup.md](server-mode-setup.md) for the full remote-deployment
setup steps.

Terminal cards (opened with **>_** from a session card) include a small git
icon in the header that opens a **Git commands reference** dialog. Clicking
any command in the reference pastes it into the terminal.

## GitHub browser cards

When a session card's working directory points at a GitHub repository, click
the octocat button in the card header to open a GitHub browser card next to it.
The card lists open pull requests and issues for that repository.

- Pull request rows show the branch name, let you copy it, and expose actions
  to merge, close, or mark a draft ready for review.
- Issue rows let you assign the issue to the Copilot coding agent or close it.
- The **+** button in the GitHub card header opens a **New Issue** dialog.

GitHub write actions require a saved GitHub token. Without a token, Concilium
still shows open issues and pull requests, but linked issue/pull-request
cross-references are unavailable.

![Concilium settings dialog screenshot](../screenshots/settings.png)

## Keyboard shortcuts

Global shortcuts use **Cmd/Ctrl + Alt + key**. They are ignored while typing in
inputs, textareas, selects, contenteditable fields, or terminal input.

- **Cmd/Ctrl + Alt + N** — New session
- **Cmd/Ctrl + Alt + R** — Start/Kill active session
- **Cmd/Ctrl + Alt + `** — Open terminal for active session
- **Cmd/Ctrl + Alt + E** — Expand/collapse active card
- **Cmd/Ctrl + Alt + P** — New project
- **Cmd/Ctrl + Alt + S** — Open settings
- **Cmd/Ctrl + Alt + T** — Cycle theme
- **Cmd/Ctrl + Alt + /** — Show keyboard shortcuts

# Install and first-time setup

## Install

```bash
git clone git@github.com:jonathanbossenger/concilium.git
cd concilium
npm install
```

PowerShell works too:

```powershell
git clone https://github.com/jonathanbossenger/concilium.git
Set-Location concilium
npm install
```

The `postinstall` step restores the executable bit on `node-pty`'s
`spawn-helper` (npm strips it during install — without this, PTY spawns fail
with `posix_spawnp failed.`).

To get `conciliumctl` available in your terminal (`npm link` generates
cross-platform command shims, including PowerShell):

```bash
npm link
```

## First-time setup checklist

1. Start Concilium:
   ```bash
   conciliumctl start
   ```
2. Confirm it's running:
   ```bash
   conciliumctl status
   ```
3. Open <http://127.0.0.1:7878>.
4. Complete the onboarding wizard:
   - Add at least one agent (same fields as **Settings (⚙)**), with help from the
     [agent setup guide](configuring-agents.md).
   - Optionally add more agents.
   - Optionally add a GitHub token, with help from the
     [GitHub token guide](github-token.md).

If you want to access Concilium from another machine, use the separate
[server-mode setup guide](server-mode-setup.md) instead of this local-loopback
flow. Public-server mode uses a setup token from the server logs to create the
first admin user, then requires sign-in before the dashboard is available.

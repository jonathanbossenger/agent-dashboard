# Setting up Concilium in server mode

Use this guide when you want to access Concilium from another machine (for example over Tailscale or through a reverse proxy).

## 1) Install and start Concilium

Follow [install-and-first-time-setup.md](install-and-first-time-setup.md), then run:

```bash
conciliumctl start
```

On first run (when `~/.concilium/config.yaml` does not exist), `conciliumctl` prompts:

```text
First start: run in local loopback mode only? [Y/n]
```

Answer `n` to bootstrap server mode (`host: 0.0.0.0`) immediately.

If your config already exists, or if you answered the prompt differently, continue below.

## 2) Update `~/.concilium/config.yaml` (fallback/manual path)

If Concilium is already running, stop it before editing:

```bash
conciliumctl stop
```

Edit the config and set a non-loopback host:

```yaml
host: 0.0.0.0
port: 7878
```

Notes:

- `127.0.0.1` is local-only and will not accept remote connections.
- `0.0.0.0` listens on all IPv4 interfaces (including Tailscale).
- You can use `::` if you specifically want IPv6 binding.

If you run Concilium behind a reverse proxy, also set:

```yaml
trustProxy: true
```

If TLS is terminated upstream and you still want `Secure` cookies even without forwarded proto headers, set:

```yaml
forceSecureCookies: true
```

## 3) Start (or restart) Concilium and read the setup token

```bash
conciliumctl start
```

When server mode is enabled and no admin exists yet, `conciliumctl start` prints the current setup token in the terminal output.
You can still view it in logs with:

```bash
conciliumctl logs
```

Each restart issues a new setup token until admin setup is completed; always use the most recently printed token.

## 4) Open Concilium from a remote client

Use HTTP unless you have explicitly added TLS in front of Concilium:

```text
http://<server-ip-or-name>:7878
```

Examples:

- `http://100.x.y.z:7878` (Tailscale IP)
- `http://my-host.tailnet-name.ts.net:7878` (MagicDNS)

Complete the setup dialog with:

- setup token from the logs
- admin username
- admin password

## 5) Verify connectivity if remote access fails

1. Confirm `host` is **not** `127.0.0.1`.
2. Restart after config edits: `conciliumctl restart`.
3. Check status/logs:
   - `conciliumctl status`
   - `conciliumctl logs`
4. Ensure your network/firewall allows inbound traffic to port `7878`.

## 6) Revert to local-only mode

To disable server mode later, follow the revert steps in the root [README.md](../README.md#public-server-hardening-notes).

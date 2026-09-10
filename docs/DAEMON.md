# Daemon mode

Plain `strivo` runs the daemon and browser-served web UI together. For separate
processes, run `strivo daemon` in the foreground and `strivo serve` for the web
server. The application has no terminal UI. Unix uses a local socket; Windows
uses a named pipe.

## Lifecycle

```sh
strivo                 # daemon + web UI
strivo daemon          # foreground daemon only, for a supervisor
strivo serve           # web server for an existing daemon
strivo status          # report liveness, PID, IPC endpoint and auth state
strivo enable          # install/start background service (Linux or Windows)
strivo disable         # stop/remove the installed service
```

`strivo daemon` has no `start`, `stop`, `restart` or `install` subcommands.
Use the supervisor that launched it to stop or restart it.

For a Linux service installed by `strivo enable`:

```sh
systemctl --user restart strivo.service
strivo status
```

For a foreground instance, stop it with Ctrl+C in its terminal, wait for it to
exit, then run the same command again (including any `--config` argument).
For Docker, Windows Task Scheduler or another supervisor, restart the existing
instance through that supervisor. Restart the process running the daemon, not
only a separate `strivo serve` process.

Recording-directory and advanced format changes saved in Settings require a
daemon restart: recording workers retain their startup configuration. Finish or
stop active captures before restarting; restarting is not a seamless handoff
for an in-flight recording. Saving a different recording directory does not
move or delete existing files. After restoring a backup, restart the daemon to
load the restored configuration and database state.

## State and IPC

On Linux, the daemon socket and PID file are `strivo.sock` and `strivo.pid`
under `${XDG_STATE_HOME:-~/.local/state}/strivo`. Paths on other platforms use
`directories::ProjectDirs`; `strivo status` reports the current IPC endpoint.
Configuration, state and recordings are separate locations; see
[FIRST-RUN.md](FIRST-RUN.md).

IPC uses newline-delimited JSON defined in [`src/ipc.rs`](../src/ipc.rs), with
`ClientMessage` requests and `ServerMessage` responses. The `Hello` handshake
carries a protocol version; use matching daemon and web/CLI binaries.

## systemd integration

`strivo enable` installs and starts a `strivo.service` user unit. By default it
runs the combined daemon and web UI; `strivo enable --daemon-only` selects the
daemon-only process. The unit uses `Restart=always`, a five-second restart delay
and a 30-second stop timeout.

```sh
journalctl --user -u strivo.service -f
```

To keep a user service running after logout, enable lingering separately:

```sh
loginctl enable-linger "$USER"
```

## Health checks

`strivo status` exits 0 when the daemon is running and 3 when it is not.
The web UI's System page also exposes health and log information.

### Platform auth state

`strivo status` also prints one line per *configured* platform (Twitch,
YouTube, Patreon), sourced from the daemon's live IPC snapshot:

```
Twitch: authenticated
YouTube: NEEDS ATTENTION — Token has been expired or revoked (since 2026-09-07 09:12)
  next step: re-authenticate from Settings → Platforms (or `strivo setup`).
Patreon: not yet authenticated (daemon retries automatically)
```

A platform whose cookie jar (`strivo setup cookies`) has stopped working
gets its own line — a rejected cookie session and a rejected OAuth
refresh are different credentials with different fixes, so they're
reported and cleared independently:

```
YouTube cookies: NEEDS ATTENTION — cookies are no longer valid (since 2026-09-07 09:12)
  next step: strivo setup cookies youtube --browser <browser>
```

This is *deliberately advisory only*: `strivo status` still exits 0
whenever the daemon is running, auth state or not, because
`crates/strivo-web/e2e/real-server.sh` (and any other liveness probe)
uses it to mean "the process is up," not "everything is authenticated."

The same information, plus a snapshot fetch, backs
`GET /api/v1/health/checks`'s `"Platform Auth"` domain — each row is
`{domain, name, severity, message, fix}`, and a rejected credential is
`severity: "error"` with a `fix` pointing at Settings → Platforms or the
`strivo setup cookies` command. The web UI's header pill and System page
both read this endpoint and refresh live off the daemon's SSE stream
(`PlatformAuthenticationRequired` / `PlatformAuthenticated` /
`CookieSessionRejected` / `DeviceCodeRequired` events), so a credential
going bad shows up without a page reload.

Only a genuinely rejected refresh (RFC 6749 §5.2 `invalid_grant` /
`invalid_client`, or Twitch's equivalent 400 body) triggers this —
a rate limit or a network blip does not, and does not launch a
device-code login on its own.

## Troubleshooting

- **Address already in use:** check `strivo status` and the supervisor before
  starting another instance. Do not delete the socket of a running daemon.
- **Web UI cannot reach the daemon:** check that both processes use the same
  user and state-directory environment, then inspect the daemon logs.
- **Saved recording settings have not taken effect:** restart the daemon using
  the lifecycle instructions above. A browser reload alone does not replace
  the recording workers' startup configuration.

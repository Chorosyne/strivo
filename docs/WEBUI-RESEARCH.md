# StriVo Web UI — Research Report (comparable FOSS projects)

Compiled from three parallel research passes over **Sonarr/Radarr/Prowlarr (*arr)**,
**Jellyfin/Kodi**, and **Jellyseerr/Overseerr + modern FOSS web-app practice**.
Goal: borrow *abstract* architecture/UX/security philosophies — **not** clone their
look. Each finding maps to a StriVo takeaway. Drives item 8 (polish pass) and informs
items 2/4/6/7.

StriVo context: Rust + axum + vanilla-JS SPA + SSE; loopback/Tailscale auth
(X-Api-Key + HMAC session cookie); live-stream PVR for Twitch/YouTube/Patreon; TUI +
web share one daemon over IPC.

---

## A. Architecture & API (mostly *arr + Jellyseerr)

- **One REST API is the single source of truth; the UI is just another client.** No
  UI-only backdoor — TUI and SPA both consume the same endpoints. *StriVo already does
  this (api router + IPC); keep it inviolate.*
- **Versioned API namespace** (`/api/v3`, `/api/v1`) so the contract can break without
  breaking the TUI/3rd parties. *Keep `/api/v1`.*
- **REST for state, push channel for real-time.** *arr uses SignalR; Jellyfin a
  WebSocket; StriVo uses SSE — the right unidirectional choice (built-in reconnect via
  `retry:` + `Last-Event-ID` resume, plain HTTP, proxy-friendly). **Boot = GET full
  state, then apply SSE deltas; fall back to slow poll if EventSource keeps erroring.**
  SSE is an optimization over truthful REST state, never the source of truth.*
- **Command pattern as the universal job/queue.** Every background op (record,
  transcode, archive, scrape) is a uniform "command" object with status + timing +
  error + priority; one queue holds running/upcoming/recent. *Model StriVo jobs
  uniformly; expose over the API; progress = periodic updates on the job object over
  SSE.*
- **Scheduled vs on-demand duality:** every periodic task also has a manual "Run now"
  that enqueues the same command. *Channel polling, plugin runs, sweeps all get Run-now.*
- **One error envelope everywhere — RFC 9457 Problem Details** (`type,title,status,
  detail,instance`), enforced by a single axum `IntoResponse`. Don't mix shapes.
- **Resource-shaped REST:** plural nouns, verbs carry meaning, **mutations are never
  GET** (matters for SameSite=Lax CSRF coverage). Enum status fields single-sourced
  between API and SPA.
- **Reverse-proxy gotcha (famous):** SignalR/WebSocket/SSE silently die behind
  mis-configured proxies → UI goes stale with no signal. *Set `X-Accel-Buffering: no`,
  no response buffering; make a dropped SSE **visible** (a "reconnecting" badge), never
  silently stale.*

## B. Information Architecture & User Journey (*arr + Jellyfin + Jellyseerr)

- **Nav by domain nouns, not features:** Library/Channels, Calendar, Activity/Queue,
  Wanted, Plugins, System, Settings. Users always know where things happen.
- **Activity = Queue + History + Blocklist.** Queue = in-flight; History = durable
  audit trail of everything that finished/failed (never toast-and-forget); Blocklist =
  "don't grab/record this again" (feedback that changes future behavior). *StriVo: in-
  progress = Queue, completed/failed = durable History, plus skip-this-VOD/channel.*
- **"Wanted" splits Missing vs Cutoff-Unmet** — absent vs present-but-below-quality.
  *Distinguish "went live, not yet captured" from "captured below configured quality."*
- **Calendar/agenda of upcoming items** is first-class. *A calendar of known upcoming
  streams (scheduled Twitch/YT broadcasts, Patreon drops) is high-value for a PVR.*
- **Add-X = two-phase search-then-configure:** type name → live search → pick entity →
  *then* configure (profile, monitor, plugins). Defer config until the item is
  confirmed. *"Add Channel" should work this way.*
- **Named reusable policy objects** (Quality Profiles, indexers, connections, tags):
  define once, attach to many; an *ordered* allow-list + a **cutoff** ("good enough,
  stop upgrading"). Prevents per-item config sprawl. *Named capture profiles
  ("1080p60+transcript", "audio-only") attached to channels, with a cutoff so StriVo
  stops re-capturing once met.*
- **Per-item detail page is a hub:** primary info → secondary/technical → overview →
  tags/links → History → per-item actions, with **sections loading independently** so a
  slow fetch never blocks the rest. *Channel detail = live/preview hero + technical row
  + recordings + history + record-now + channel settings; load each section async.*
- **Switchable index density** (poster / overview / table) over the same dataset.
- **Bulk multi-select + a mass-edit action bar.** *Extend StriVo bulk controls to
  re-run plugins / delete / re-record across many.*
- **First-run is a linear wizard; no half-configured dashboard** (Jellyseerr forces
  connect → pick libraries → downstream services → defaults). *Gate the SPA behind a
  first-run wizard: connect Twitch/YT/Patreon → pick channels → recording defaults →
  storage path.*

## C. Live preview / playback embedding (Jellyfin — unblocks item 4)

Decision ladder: **Direct Play → Remux → Direct Stream (audio transcode) → Transcode**,
chosen by *client* codec capability. Only invoke FFmpeg as the bounded, **visible**
fallback; surface transcoder load.

**Card → detail preview pattern:** grid card shows a static, periodically-refreshed
thumbnail; on detail-open or scroll-into-view, upgrade to a live `<video>`; tear down
when off-screen.

**Path A — self-proxied HLS via hls.js (preferred for owned bytes / recordings):**
- `<video muted playsinline autoplay poster="…">` — `muted` is mandatory (autoplay-with-
  sound is blocked everywhere); `playsinline` stops iOS fullscreen; `poster` avoids a
  blank box.
- hls.js `autoStartLoad:false` + IntersectionObserver-gated `startLoad()` so many cards
  don't all pull segments; `stopLoad()`/`destroy()` off-screen.
- Live tuning: `lowLatencyMode`, `liveDurationInfinity:true`, small `liveSyncDuration`
  (set only one of `liveSyncDuration`/`liveSyncDurationCount`), bounded
  `liveMaxLatencyDuration` + `backBufferLength`.
- Gotcha: latency drifts up after stalls and **can't be lowered at runtime — recreate
  the player** periodically or seek to live edge.
- **CORS:** proxy the HLS through axum (same-origin) — sidesteps CORS/token/referrer and
  enables caching.
- Mobile cannot autoplay even muted without a gesture → fall back to tap-to-play
  thumbnail.

**Path B — platform iframe (Twitch/YT live you can't proxy):**
- Twitch: `player.twitch.tv/?channel=X&parent=<host>&autoplay=true&muted=true` —
  `parent` **must list every embedding domain** (incl. `127.0.0.1` / your `*.ts.net`);
  min 400×300; player must be visible.
- YouTube: `enablejsapi=1&autoplay=1&mute=1` + iframe `allow="autoplay"`.

**StriVo recommendation:** Path A self-proxied HLS for recordings + Twitch rewind
streams StriVo already resolves; Path B iframe for live Twitch/YT previews not proxied;
Patreon → thumbnail only. Always: static refreshing thumbnail → upgrade to muted/
playsinline/autoplay on open → teardown off-screen → tap-to-play on mobile.

## D. Feedback & micro-UX (vanilla-JS implementable — drives item 2)

- **Never strand a spinner.** Jellyfin's recurring bug class: a rejected promise removes
  nothing → infinite spinner. **Every async path needs timeout + error surface +
  guaranteed spinner teardown** (StriVo item 1's 15s VOD timeout is this lesson).
- **Toast singleton with exactly TWO pre-created ARIA live regions** (created at load,
  not per-toast): `aria-live="polite" role="status"` for success/info,
  `aria-live="assertive" role="alert"` for errors. Write text into the existing region.
  - Auto-dismiss tiers: success/info ≥5s; **errors sticky** (6–10s or until dismissed).
    Pause timer on hover/focus. Cap ~3–4 visible, queue rest. Always a close button.
    Respect `prefers-reduced-motion`; 4.5:1 contrast.
  - **Toasts stay non-interactive** (message + close only) — a "Retry" belongs in the
    item row or a focus-managed `alertdialog`, not the toast.
- **Button busy state:** prefer `aria-busy="true"` + label swap ("Save"→"Saving…") +
  inline spinner + debounce, over bare `disabled` (which drops the button from the focus
  tree). Debounce always, to kill double-submit.
- **Optimistic affordances, not optimistic data, for anything that can fail.** Flip a
  cheap toggle (Subscribe) instantly; for "Start recording" (can fail: offline / disk
  full) show *pending* and reconcile on the SSE event — don't assume success.
- **Skeletons for layout (grids/lists), spinners for short discrete actions.** Skeleton
  cards on the recordings grid; inline spinner on a single button.
- **Inline field-level validation + form summary:** validate on blur/submit, message
  adjacent to field, `aria-describedby` + `aria-invalid="true"`.
- **Empty states are actionable** — message + the real CTA wired to an endpoint
  ("No recordings yet. Add a channel").
- **Confirmation modals only for destructive/irreversible** actions; focus-trap, move
  focus in on open, restore on close, Esc to close.

## E. Settings & System/Health pages (drives item 7 — *arr is the gold standard)

- **Settings grouped into domain pages**, each with reusable referenced objects:
  General, Sources/Platforms (creds + **"Test connection"** with inline pass/fail),
  Storage/Capture, Profiles, Plugins, Notifications, UI. Avoid one giant page.
- **System page = "is it healthy & what is it doing":**
  - **Status:** Health (warnings list), Disk Space, About (version/build + links).
  - **Health-check registry (most copy-worthy pattern):** each check returns
    `{severity: warn|error, message, fix-link}`, grouped by domain (Storage, Platform
    Auth, Plugins, Network). **Warning vs Error are distinct states**, each
    **actionable** (cause + remediation) and **retestable** — or they become noise. A
    **global header health pill** (amber/red) links to the list.
  - **Tasks:** Scheduled (interval + Run-now; intervals should be editable; running
    tasks cancellable) + live Queue with durations.
  - **Logs:** in-UI viewer, selectable level, rolling/capped files (don't make users
    SSH).
  - **Updates** (recent changelog inline) and **Backup** (scheduled + on-demand config/
    DB backup with restore — high trust for irreplaceable config).
- **Severity tiers OK / Warning / Critical** so degraded-but-running (token expiring,
  disk 90%) is visible before outage.
- Expose a machine-readable **`/health` JSON** endpoint (recorder up, DB reachable, disk
  free) for CI/monitoring, separate from the UI panel.

## F. Auth & security (drives the security round-trip; validates StriVo's two-track)

- **Session cookie baseline:** `__Host-strivo_session; HttpOnly; Secure; SameSite=Lax;
  Path=/`. `HttpOnly` (XSS can't read it), `SameSite=Lax` (blocks cross-site sub-request
  CSRF, allows top-level nav), `__Host-` (browser-enforced Secure + host-scoped). Works
  on `*.ts.net` over HTTPS.
- **Short-lived HMAC session, rotate on activity;** expired/invalid HMAC = logged-out,
  not 500. *(StriVo already HMACs an expiry; add `__Host-`/`Secure`/`SameSite` + idle
  refresh.)*
- **Two auth tracks, by design:** `X-Api-Key` custom header is **CSRF-immune** (browsers
  can't auto-attach custom headers cross-site) — programmatic/CLI/plugin path needs no
  CSRF token. The **cookie/browser track DOES** need CSRF defense.
- **Cheapest correct CSRF for the same-origin cookie SPA:** require a custom header
  (e.g. `X-Strivo-CSRF` / `X-Requested-With`) on all cookie-authed mutations + strict
  `Origin`/`Host` allowlist (`127.0.0.1`, your `*.ts.net`). If stateless tokens are
  wanted, use **signed double-submit** (HMAC token bound to session, never a bare random
  cookie).
- **Separate trust models:** loopback-reachable ≠ authenticated. Never trust
  `X-Forwarded-*` unless from a configured trusted proxy.
- **All mutations POST/PUT/DELETE** (never GET) so SameSite=Lax + custom-header check
  actually cover them.
- Unit-test the HMAC/CSRF/Origin checks specifically — they're security-load-bearing.

## G. What users love / what frustrates (abstract lessons)

**Love:** set-and-forget reliability (optimize the unattended steady state); power +
depth *behind sensible defaults*; cross-app consistency (StriVo TUI ↔ SPA same nouns &
lifecycle so learning one teaches the other); real-time live UI; configurable/reorderable
home rails; hover/detail live preview as a signature; discoverable plugin catalog;
frictionless see→record→notified loop (make it work on a phone over Tailscale).

**Frustrations to avoid:** steep first-run / no guided defaults; pathological configs
(warn when a capture profile will perpetually re-record); **silent real-time breakage**;
noisy/non-actionable health warnings; uncancellable/uneditable tasks; **status semantics
that don't match the user's mental model** ("approved" ≠ "downloaded") and status that
**silently desyncs** from backend truth; **unhandled terminal/edge events** (no
notification when "already done"); brittle metadata matching with no manual override;
laggy poster-pop-in (StriVo's native stack is an advantage — keep payloads small, cache
thumbnails, skeletons + optimistic UI for perceived speed).

---

## Sources
- *arr: deepwiki.com/Sonarr/Sonarr, deepwiki.com/radarr/radarr, wiki.servarr.com/{sonarr,radarr}/{system,activity,wanted}, Sonarr Health-Checks wiki, issues #4319/#3813/#6417/#262/#5069/#4325/#1708, trash-guides.info.
- Jellyfin/Kodi: deepwiki.com/jellyfin/jellyfin-web (library/list views), jellyfin.org/docs (transcoding, codec-support, tasks, plugins, monitoring), hls.js issues #7443/#3077/#6662/#6350, Twitch embed docs (dev.twitch.tv), YouTube IFrame API, jellyfin-web issues #7438/#1396, jellyfin #12064.
- Jellyseerr/Overseerr + practice: docs.seerr.dev, Overseerr OpenAPI + settings/notifications docs, issues #3872/#3542/#4093/#4154; Sara Soueidan ARIA live-regions; OWASP CSRF + Session-Management cheat sheets; MDN cookies; RFC 7807/9457; germano.dev + rxdb.info SSE comparisons.

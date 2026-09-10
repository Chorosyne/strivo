# 0003. Ship native installers on all three platforms, bundling external tools

Status: Accepted
Date: 2026-09-10

## Context

Every distribution channel StriVo has today — `scripts/install.sh` (portable
source build), the AUR `PKGBUILD`, the Docker image, and `release.yml`'s
three platform build jobs — treats `ffmpeg`, `ffprobe`, `mpv`, `streamlink`,
and `yt-dlp` as host prerequisites the user must already have, or must
install themselves before `strivo doctor` will pass. `release.yml`'s own
artifacts are a raw `tar.gz` (Linux/macOS) or `.zip` (Windows) with a
checksum sidecar — there is no native installer format on any platform.

The operator asked for three consumer-facing install paths that remove both
gaps at once:

- **Linux**: a terminal-first installer in the style of SillyTavern's/
  oobabooga's `start.sh` (a colored menu script, no Rust toolchain required)
  plus an AppImage, both self-contained.
- **Windows**: a classic step-through wizard installer, in the spirit of
  InstallShield — license page, install-directory picker, component
  checkboxes, progress bar, finish page.
- **macOS**: a single-launch, no-install-step bundle (the closest analog to
  an AppImage macOS has), with first-run setup happening in the browser.

All three must bundle `ffmpeg`, `mpv`, `streamlink`, and `yt-dlp` rather than
require them pre-installed. This is the reason this needs a decision record:
bundling GPL/LGPL-licensed external tools into an MIT-licensed distribution
is a real licensing question, not just a build-engineering one, and the
answer determines what every platform's packaging pipeline is allowed to do.

### Licensing research (2026-09-10, sources cited)

- **ffmpeg** is LGPL-2.1+ by default; it becomes GPL-2+/3+ only when built
  with `--enable-gpl` (pulling in GPL-only components such as libx264) or
  `--enable-nonfree`. [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds)
  publishes separate `lgpl` and `gpl` static-build variants for **Windows and
  Linux only** — there is no equivalent official LGPL static macOS build;
  a macOS source needs separate verification before it's relied on.
  ([ffmpeg.org/legal.html](https://ffmpeg.org/legal.html))
- **mpv** is GPL-2.0-or-later by default. Its own
  [Copyright file](https://github.com/mpv-player/mpv/blob/master/Copyright)
  documents a `-Dgpl=false` LGPL build mode but states plainly that it
  disables major features (X11 output, hardware decode, etc.) and that
  building the **mpv CLI** player — the interface StriVo actually shells out
  to, not `libmpv` — in LGPL mode is not recommended. A bundled mpv CLI
  should therefore be treated as **GPL**, not LGPL.
- **streamlink** is BSD-2-Clause
  ([LICENSE](https://github.com/streamlink/streamlink/blob/master/LICENSE)).
  Its own [install docs](https://streamlink.github.io/install.html) already
  bundle ffmpeg into its Windows installer and publish Linux distribution via
  AppImage — direct precedent for this exact shape of bundling.
- **yt-dlp**'s source is Unlicense (public domain), but yt-dlp's own release
  process documents that its **PyInstaller-bundled standalone executables**
  (the `yt-dlp`, `yt-dlp.exe`, `yt-dlp_macos` single-file binaries this plan
  would vendor) embed GPLv3+ code, making those specific binary artifacts
  GPLv3+ regardless of the source license.
- **Mere aggregation**: per the
  [GPL v2 FAQ](https://www.gnu.org/licenses/old-licenses/gpl-2.0-faq.html),
  distributing separate programs together on the same medium — as opposed to
  combining their code into one program — does not bring them under the
  GPL. StriVo spawns every one of these tools as an independent subprocess;
  it never links against their code. Bundling their unmodified official
  binaries alongside the MIT-licensed `strivo` executable is aggregation,
  and StriVo's own license is unaffected.

This is not a substitute for legal sign-off if the operator wants one, but it
is a well-precedented, defensible position (Streamlink already does exactly
this) and is precise about which bundled binaries are GPL vs LGPL, which
matters for what the compliance bundle below must say correctly.

## Decision

**StriVo will bundle `ffmpeg`, `mpv`, `streamlink`, and `yt-dlp` as unmodified
official prebuilt binaries in every platform installer**, distributed
alongside — never linked into — the `strivo` executable, under the mere
aggregation model above. This applies to PVR edition only, matching every
other distribution channel (ADR 0002's boundary is unchanged: no Creator
artifact, ever, in any of these installers).

Concretely:

1. **A single pinned dependency manifest**, `packaging/vendored-deps.toml`,
   lists the exact upstream release URL and sha256 for each (tool, platform)
   pair. Every platform's build job reads from this one file, so a version
   bump is one reviewed change, not three separately-drifting CI scripts.
   Prefer ffmpeg's LGPL build variant on Windows and Linux (BtbN); macOS
   ffmpeg sourcing needs its own verified LGPL-capable source before this
   manifest is filled in, or falls back to the GPL build with accurate
   licensing (see below) if none is found.
2. **A license compliance bundle**, `packaging/THIRD-PARTY-LICENSES/`, ships
   inside every installer: each tool's unmodified license text, plus a
   `NOTICE` file recording exact version and upstream source URL per bundled
   binary. It must say GPL for mpv's CLI and for the yt-dlp standalone
   executables specifically (not "MIT-compatible" or unspecified), and LGPL
   or GPL for ffmpeg depending on which BtbN variant a given platform build
   actually used.
3. **Tool-discovery order changes**: wherever StriVo currently resolves
   these tools via `which::which()` (`strivo doctor`'s checks, and any other
   runtime lookup), check the directory the running executable lives in
   first (`<exe_dir>/bin/<tool>` or equivalent), before falling back to the
   system `PATH`. This is what makes bundling work identically on all three
   platforms without installer-side `PATH` mutation. On Linux, an AppImage's
   `AppRun` can also prepend `PATH` — redundant with this change, but free
   and standard for that format.
4. **`strivo enable`/`disable` gains macOS support** (a `launchd` LaunchAgent
   plist generator, mirroring the existing systemd `--user` unit generator),
   closing the current explicit "macOS unsupported" stub. Without this, the
   macOS package would be second-class next to Linux/Windows, which already
   get real background-service registration.
5. **No new privileged web API surface for install-time actions.** Doctor
   checks and service enablement run as CLI steps the installer/launcher
   invokes directly (`strivo doctor`, `strivo enable`) before ever opening a
   browser tab — not through a new authenticated HTTP endpoint. The browser
   then opens straight to the existing in-app first-run wizard
   (`renderFirstRun`, `012-pvr.js`), which already owns platform credentials,
   recording directory, and channel selection and is deliberately scoped to
   have no CLI/terminal references (`smoke.spec.ts` asserts this). This
   plan's installers hand off to that wizard rather than rebuild any part of
   it — the "setup-gui-wizard-in-webui" experience the operator asked for is
   satisfied by auto-opening the browser onto real, already-shipped UI, not
   by adding a second, install-time-only web wizard.

Per-platform packaging shape (implementation detail, tracked in
`docs/PACKAGING-PLAN.md`, not repeated here): a terminal installer script and
an AppImage for Linux; an Inno Setup wizard installer for Windows (the
closest free equivalent to an InstallShield-style step-through wizard); a
self-contained, unzip-and-run `.app` bundle for macOS, distributed in a
`.dmg`.

## Consequences

**What this buys:** all three platforms get a true "download and go"
install with zero separate dependency-hunting step, closing the exact gap
`strivo doctor` exists to detect today. The bundling approach is
license-compliant by well-established precedent (mere aggregation, matching
what Streamlink itself already does) without requiring StriVo to relicense
or avoid GPL tooling.

**What this costs:** installer artifacts get materially larger (ffmpeg + mpv
alone are the bulk of the existing Docker image's ~1.1GB footprint) — this
plan does not shrink that cost, it moves it from "the user must separately
install these" to "the installer must download/embed them." macOS
specifically also picks up a real quality gap: no Apple Developer ID
certificate is currently available, so the macOS `.app`/`.dmg` ships
**unsigned**, which triggers Gatekeeper's "unidentified developer" warning
on first launch. The operator accepted this trade-off explicitly (2026-09-10)
rather than block the macOS track on cert acquisition; the installer ships
documented workaround instructions (right-click → Open), and signing should
be revisited once a cert is available.

**What is explicitly out of scope:** this ADR does not cover Creator
Edition packaging (unaffected — ADR 0002's hold stands), does not change how
`scripts/install.sh`'s from-source, host-dependency path works (it remains
the dev/from-source path; the new installers are an additional consumer
path, not a replacement), and does not add any new web-facing API endpoint.

## Roads not taken

- **Statically linking ffmpeg/mpv into the `strivo` binary itself**, instead
  of shelling out to bundled subprocess binaries. Rejected: this would make
  StriVo a genuine derivative work under GPL/LGPL, not mere aggregation,
  forcing a license/architecture decision far bigger than "bundle some
  binaries alongside the executable" — and StriVo's existing architecture
  already shells out to these tools as external processes everywhere, so
  linking would be a large unrelated rewrite for no functional gain.
- **A new authenticated web API for install-time doctor/enable actions**,
  making the packaging-level setup step literally part of the webui rather
  than a CLI pre-step that opens the browser afterward. Rejected for now:
  it adds privileged-action surface to `crates/strivo-web` for a one-time,
  local-only, install-time concern that a CLI step already handles more
  simply and with a smaller attack surface. Revisit only if a literal
  browser-rendered dependency-check step turns out to be a hard requirement.
- **Requiring only LGPL builds everywhere and refusing to bundle mpv's CLI
  or yt-dlp's standalone binary at all** (since both are practically GPL).
  Rejected: mere aggregation makes this unnecessary — GPL and MIT coexist
  fine side by side in the same installer as long as licensing is disclosed
  correctly, which is what the compliance bundle in this decision does.

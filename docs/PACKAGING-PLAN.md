# Packaging plan: native installers with bundled dependencies

Implementation roadmap for [ADR 0003](adr/0003-installer-packaging-and-bundled-dependencies.md).
This is a plan document, not a decision record — update it freely as work
lands; the ADR stays frozen.

## Status

Proposed / not yet implemented. Three open items block starting real build
work (see **Open decisions** at the bottom) — this plan is written so each
platform's track can start independently once its own blockers clear.

## Shared groundwork (do first, all three platforms depend on it)

1. **`packaging/vendored-deps.toml`** — one file, `{tool, platform, url,
   sha256, version}` rows for ffmpeg/mpv/streamlink/yt-dlp × linux/windows/
   macos. Prefer BtbN's `lgpl` ffmpeg variant on Windows/Linux; macOS ffmpeg
   source needs verification (evermeet.cx and osxexperts.net were mentioned
   as community sources during research but are **unconfirmed** — verify
   licensing terms and build variant before pinning either).
2. **Tool-discovery order change** — find every `which::which(...)` call
   (starts in `crates/strivo-bin/src/main.rs`'s `handle_doctor`, search for
   other call sites) and add an "exe-relative `bin/` directory first" check
   ahead of the `PATH` fallback. Small, testable, platform-independent
   change; unblocks all three installer tracks.
3. **Icon generation** — `packaging/icons/`: generate a multi-resolution
   `.ico` (16/32/48/256) and `.icns` from
   `crates/strivo-web/assets/img/chorosyne-logo.png` (already earmarked in
   source comments for packaging use). One-time asset step; regenerate only
   if the source logo changes.
4. **`packaging/THIRD-PARTY-LICENSES/`** — per-tool license text + a
   `NOTICE` file with exact version/source URL per bundled binary,
   correctly distinguishing GPL (mpv CLI, yt-dlp standalone executables)
   from LGPL/GPL (ffmpeg, depending on which BtbN variant a given platform
   build used) per ADR 0003's licensing findings. Generate this from the
   same `vendored-deps.toml` so it can never drift from what's actually
   bundled.
5. **`strivo enable`/`disable` macOS support** — add a `launchd` LaunchAgent
   plist generator in `crates/strivo-bin/src/main.rs`, mirroring the
   existing systemd `--user` unit path, replacing the current
   `MACOS_ENABLE_UNSUPPORTED`/`MACOS_DISABLE_UNSUPPORTED` stub.
6. **Version single-source-of-truth** — today `Cargo.toml` (root),
   `crates/strivo-bin/Cargo.toml`, and `packaging/aur/PKGBUILD`/`.SRCINFO`
   all independently declare a version, and the AUR files are already stale
   (`0.3.0` vs. actual `0.6.0`). Adding three more version-bearing manifests
   (AppImage recipe, Inno Setup `.iss`, macOS `Info.plist`) without fixing
   this first guarantees drift. Add a small bump script/xtask that updates
   all of them atomically before the new manifests exist.

## Linux

**Terminal installer** — new `scripts/get-strivo.sh`, curl-pipeable,
distinct from the existing `scripts/install.sh` (which stays the from-source
/ host-dependency dev path). SillyTavern/oobabooga-style numbered menu:

```
1) Install / update StriVo
2) Launch
3) Enable background service (systemd --user)
4) Uninstall
```

Downloads the release AppImage (or a `tar.gz` of binary + vendored `bin/`
for non-FUSE environments) into `~/.local/share/strivo`, symlinks the
executable into `~/.local/bin`.

**AppImage** — `AppDir` layout: `usr/bin/strivo` + vendored
`usr/bin/{ffmpeg,mpv,yt-dlp,streamlink}` + `.desktop` + icon. Build via
`linuxdeploy`/`appimagetool` on the existing self-hosted `arch-linux` CI
runner. `AppRun` prepends the bundled `usr/bin` to `PATH` (belt-and-suspenders
alongside the shared exe-relative lookup change above — standard for this
format regardless). First launch from a terminal: run `doctor`/`enable`
inline; from a file manager: start the daemon and open the browser directly
to the existing first-run wizard.

## Windows — Inno Setup

Single `.iss` script producing the InstallShield-style step-through wizard:
license page → install-directory picker → component checkboxes ("Start with
Windows" wired to `strivo enable`'s Task Scheduler path, "Desktop shortcut")
→ progress bar → finish page with "Launch StriVo now".

- Vendored deps land in `<installdir>\bin\{ffmpeg,mpv,yt-dlp,streamlink}.exe`
  — discovered via the shared exe-relative lookup change, no global `PATH`
  mutation needed.
- Embed the generated `.ico` as both the installer icon and `strivo.exe`'s
  own resource (`winres`/`embed-resource` crate in `crates/strivo-bin`) —
  closes the "no version-info resource" gap found during research.
- Post-install (if checkbox set): run `strivo enable`, then `strivo doctor`
  silently, then open the default browser to `http://127.0.0.1:8181`,
  landing on the existing first-run wizard.
- Build on the existing self-hosted `win11-ci` runner.

## macOS — self-contained `.app`

`StriVo.app`: `Contents/MacOS/strivo`, `Contents/Resources/bin/
{ffmpeg,mpv,yt-dlp,streamlink}` (vendored), `Contents/Info.plist` (generated
`.icns`, `LSMinimumSystemVersion`). No installer step required — download,
double-click, run, matching the "AppImage feel" the operator asked for.
Distribute in a `.dmg` (app + `Applications` symlink for users who want the
traditional drag-install) while the `.app` itself also runs directly from
the mounted image or an unzipped folder for users who want zero install
step at all.

First launch: a thin wrapper (or `strivo` itself behind a `--first-launch`
arg the `.app`'s executable passes) runs `doctor` + `enable` (via the new
`launchd` generator) then opens the default browser — lands on the existing
first-run wizard.

**Blocked on**: an Apple Developer ID certificate for code signing +
notarization. Without it, Gatekeeper blocks the app as "from an
unidentified developer" on first launch — a materially worse experience
than Linux/Windows get. The existing self-hosted `macos-sonoma` CI runner
can run `codesign`/`notarytool` once a cert is available; this plan does
not resolve where that cert comes from (see Open decisions).

## CI wiring

Extend `release.yml`'s three existing platform jobs — do not build a new
pipeline. Each job downloads its platform's vendored deps per
`vendored-deps.toml`, produces the new artifact (AppImage / Inno Setup
`.exe` / signed `.dmg`) alongside or instead of today's raw `tar.gz`/`.zip`,
and `publish` attaches all of them to the GitHub Release with checksums, as
it already does today.

## Decisions resolved 2026-09-10

1. **Windows tool: Inno Setup.** Confirmed by the operator.
2. **macOS code signing: ship unsigned for now.** No Apple Developer ID
   certificate is currently available. The macOS `.app`/`.dmg` ships
   unsigned with documented Gatekeeper workaround instructions
   (right-click → Open, or `xattr -d com.apple.quarantine`); signing is
   revisited if/when a cert becomes available. Tracked as a known quality
   gap versus Linux/Windows, not silently accepted.

## Vendored dependency status (2026-09-10, `packaging/vendored-deps.toml`)

Every pin below was verified against the upstream release's own
GitHub-computed sha256 digest, not hand-computed.

| Tool | Linux | Windows | macOS |
|---|---|---|---|
| ffmpeg | ✅ BtbN LGPL, pinned | ✅ BtbN LGPL, pinned | ❌ unresolved |
| mpv | ❌ unresolved | ✅ shinchiro build (GPL), pinned | ❌ unresolved |
| streamlink | ✅ official AppImage (BSD-2), pinned | ✅ official installer (BSD-2), pinned | ❌ unresolved |
| yt-dlp | ✅ pinned | ✅ pinned | ✅ pinned |

## Open decisions (still need an answer)

1. **macOS bundling gap (ffmpeg, mpv, streamlink)**: none of the three have
   a verified official standalone/static binary for macOS — only
   Homebrew/MacPorts package-manager distribution, or unverified
   third-party community builds. Two real options, needs a call:
   - **Build from source on the `macos-sonoma` self-hosted CI runner**
     (this box already has all three as dev prerequisites) and publish the
     artifacts ourselves — more CI work, but no third-party supply-chain
     trust question and we control the license/build flags (e.g. ffmpeg
     `--enable-lgpl`).
   - **Accept Homebrew as a macOS-specific host dependency** for these
     three tools only, while Linux/Windows stay fully self-contained — less
     work, but breaks the "no install-time dependency hunting" goal on one
     platform.
2. **Linux mpv**: same shape of gap — no official static/portable Linux
   build exists (distros ship it via their package manager). Candidates
   found during research (`pkgforge-dev/mpv-AppImage`,
   `danrobi11/mpv-appimage`) are unofficial and unvetted. Likely resolved
   the same way as the macOS gap: build from source on the `arch-linux`
   runner rather than trust an unvetted third-party AppImage.
3. **`vendored-deps.toml` pin freshness**: several of these (BtbN's
   `autobuild-*` ffmpeg tag, shinchiro's dated mpv build) are rolling,
   frequently-updated projects with no stable release cadence. This plan
   pins a specific snapshot for reproducibility, but there is no automated
   bump process yet — needs a periodic re-pin task (manual for now, could
   become a scheduled CI job later) rather than being treated as "pin once
   and forget."

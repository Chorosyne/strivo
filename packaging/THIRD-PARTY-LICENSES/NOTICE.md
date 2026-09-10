# Third-party notices

StriVo bundles the following external tools as unmodified official prebuilt
binaries, distributed alongside — never linked into — the `strivo` executable
itself. This is mere aggregation, not a combined work: each tool keeps its own
license below, unaffected by StriVo's own MIT license. See
`docs/adr/0003-installer-packaging-and-bundled-dependencies.md` for the full
licensing rationale.

The exact pinned version, upstream download URL, and sha256 digest for every
bundled binary lives in `packaging/vendored-deps.toml` — this file is a
human-readable cross-reference to that manifest, not a second source of
truth. If the two ever disagree, `vendored-deps.toml` is correct; update this
file to match.

## ffmpeg / ffprobe

- License of the bundled binary: **LGPL-2.1-or-later**
  (`ffmpeg-LGPL-2.1.txt`)
- Source: [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds), LGPL
  static build variant
- Windows pin: see `[ffmpeg.windows_x86_64]` in `packaging/vendored-deps.toml`
- Linux pin: see `[ffmpeg.linux_x86_64]` in `packaging/vendored-deps.toml`
- Unmodified upstream build; StriVo does not patch or relink it.

## mpv

- License of the bundled binary: **GPL-2.0-or-later** (`mpv-GPL-2.0.txt`)
- The mpv project supports an LGPL build mode, but its own docs recommend
  against using that mode for the CLI player (as opposed to `libmpv`) that
  StriVo actually spawns as a subprocess — so the bundled `mpv` CLI binary is
  treated as GPL, not LGPL.
- Source: [shinchiro/mpv-winbuild-cmake](https://github.com/shinchiro/mpv-winbuild-cmake)
  (Windows)
- Windows pin: see `[mpv.windows_x86_64]` in `packaging/vendored-deps.toml`

## streamlink

- License of the bundled binary: **BSD-2-Clause** (`streamlink-BSD-2-Clause.txt`)
- Source: [streamlink/windows-builds](https://github.com/streamlink/windows-builds)
  (Windows)
- Windows pin: see `[streamlink.windows_x86_64]` in `packaging/vendored-deps.toml`

## yt-dlp

- License of the bundled binary: **GPL-3.0-or-later** (`yt-dlp-GPL-3.0.txt`)
- yt-dlp's own source is Unlicense (public domain), but yt-dlp's release
  process documents that its PyInstaller-bundled standalone executables (the
  `yt-dlp.exe` this manifest vendors) embed GPLv3+ code from bundled
  dependencies, making the specific binary artifact GPLv3+ regardless of the
  source license. StriVo bundles the standalone executable, so it ships the
  GPL-3.0 text here, not yt-dlp's own Unlicense `LICENSE` file.
- Source: [yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp) releases
- Windows pin: see `[yt-dlp.windows_x86_64]` in `packaging/vendored-deps.toml`

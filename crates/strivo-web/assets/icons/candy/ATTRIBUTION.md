# candy-icons (vendored subset)

The ten SVGs in this directory are extracted from
**[EliverLara/candy-icons](https://github.com/EliverLara/candy-icons)**
by Eliver Lara (`@EliverLara` on GitHub) — "🍭 Sweet gradient icons."

Upstream commit: `master` as of 2026-05-28.
Upstream license: **GNU GPL-3.0** (full text in `LICENSE` alongside these
files). The icons are unmodified — only renamed to match StriVo's
semantic slot names (e.g. `places/48/folder.svg` → `home.svg`).

## Source paths

| local file        | upstream path                                |
|-------------------|----------------------------------------------|
| `schedule.svg`    | `apps/scalable/office-calendar.svg`           |
| `pipelines.svg`   | `apps/scalable/system-software-update.svg`    |
| `plugins.svg`     | `apps/scalable/synaptic.svg`                  |
| `settings.svg`    | `apps/scalable/preferences-system.svg`        |
| `system.svg`      | `apps/scalable/utilities-system-monitor.svg`  |
| `logs.svg`        | `apps/scalable/utilities-log-viewer.svg`      |
| `logout.svg`      | `apps/scalable/system-log-out.svg`            |
| `watch.svg`       | `apps/scalable/gnome-mpv.svg`                 |
| `chat.svg`        | `apps/scalable/chatterino.svg`                |
| `history.svg`     | `apps/scalable/preferences-system-time.svg`   |

## License posture

These assets remain under GPL-3.0 even though StriVo's host code is MIT.
Redistributors must ship the `LICENSE` file alongside the SVGs and credit
Eliver Lara. The host project's MIT licensing is unaffected — only this
icon subset carries the copyleft.

## Correction — 2026-09-07

This file previously listed twelve SVGs and claimed all were unmodified
extracts of `candy-icons`. Two of them were not:

| file | claimed source | actual source |
|---|---|---|
| `home.svg` | `places/48/folder.svg` | **`EliverLara/Sweet-folders`**, `Sweet-Purple/Places/48/folder-home.svg` |
| `recordings.svg` | `places/48/folder-blue.svg` | **`EliverLara/Sweet-folders`**, `Sweet-Purple/Places/48/folder-videos.svg` |

Verified against upstream `candy-icons` `83512fb` (2026-03-06) and
`Sweet-folders` `40a5d36` (2025-02-14): both files were byte-identical to the
Sweet-folders originals and depicted different artwork from the candy-icons
paths named above (a house-folder and a video-folder, not plain gradient
folders). They were genuine Eliver Lara work filed under the wrong project.

Both were already vendored byte-identically in
`../sweet-folders/`, so the duplicates here were removed and the SPA now
references `../sweet-folders/folder-home.svg` and `folder-videos.svg`
directly. The artwork the UI shows is unchanged. The remaining ten files in
this directory were each confirmed byte-identical to the upstream path listed
above.

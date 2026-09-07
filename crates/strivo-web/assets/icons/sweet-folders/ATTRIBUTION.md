# Sweet-folders (Sweet-Purple subset)

Folder / category SVGs in this directory are extracted from
[EliverLara/Sweet-folders](https://github.com/EliverLara/Sweet-folders),
specifically the `Sweet-Purple/Places/48/` variant which colour-matches the
existing StriVo accent (`var(--accent, #b07cff)`).

Files included:

| File | StriVo usage |
|---|---|
| `folder-videos.svg` | Recordings · Watch · video plugins · top-bar Recordings nav |
| `folder-music.svg` | Loudness · Sidechain · Insert FX · Pitch — audio bus |
| `folder-pictures.svg` | Thumbnails · Branding |
| `folder-documents.svg` | Captions · Casebook · Crunchr · docs |
| `folder-download.svg` | Archiver · VOD download queue |
| `folder-templates.svg` | Scenes · Pipelines templates |
| `folder-publicshare.svg` | Multistream · Publish queue (Reuse) |
| `folder-home.svg` | Library · top-bar Home nav |
| `folder-remote-symbolic.svg` | Chat · network-facing surfaces |
| `folder.svg` | Generic plugin / unknown category fallback |

Licence: see `LICENSE` (GPL-3.0 — same family as the existing candy-icons
attribution under `assets/icons/candy/`).

Verified 2026-09-07 against upstream `EliverLara/Sweet-folders` `40a5d36`
(2025-02-14): all ten SVGs and the bundled `LICENSE` are byte-identical to
`Sweet-Purple/Places/48/`. `folder-home.svg` and `folder-videos.svg` also
serve the top-bar Home and Recordings nav, which previously loaded duplicate
copies misfiled under `../candy/` — see that directory's correction note.

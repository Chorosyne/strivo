# Design System — StriVo

## Product Context
- **What this is:** self-hosted live-stream PVR for Twitch, YouTube, and Patreon. Monitor channels, automatically record live streams, play them back — all from a browser-served web UI.
- **Who it's for:** streamers, archivists, and developers who want a set-it-and-forget-it DVR for live streams.
- **Space/industry:** Developer tools / media / streaming. Peers: OBS (GUI recording), Streamlink (CLI stream extraction), Sonarr/Radarr/Jellyfin (self-hosted *arr-style web UIs).
- **Project type:** Rust daemon with a SPA web UI, driven by the `strivo` CLI. There is no terminal UI: the ratatui TUI was deleted in 0.6.0 (see CHANGELOG.md "Removed").

## Aesthetic Direction
- **Direction:** Retro-Futuristic Neon — *arr-style web UI meets VCR nostalgia. The PVR concept is inherently retro; the execution is modern web-native.
- **Decoration level:** Intentional — subtle glow effects and faint scanline textures on the web UI.
- **Mood:** The warm hum of a recording light in a dark room. Precise, always-on, quietly powerful. Not flashy — confident.
- **Reference sites:** Ghostty (minimal dark branding), OBS (streaming tool marketing), Streamlink (functional docs)
- **Brand motifs:** REC dot (pulsing red circle), VCR-style timestamps, signal/stream metaphors. Use as subtle nods, not cosplay.

## Web UI Theme — JellySkin-derived (CANONICAL for the SPA)

The StriVo **web UI** follows the **JellySkin** Jellyfin theme
(`prayag17/JellySkin`): a deep-navy gradient, a purple→cyan accent gradient,
heavy frosted glass, and Montserrat. The `:root` block of the ordered CSS
modules in `crates/strivo-web/assets/spa-css/` is the source of truth (there
is no checked-in `spa.css` — `build.rs` concatenates the modules at build
time); the tokens below mirror it. This section governs the SPA, which is the
only rendered surface StriVo has.

> The SPA intentionally diverges from the StriVo brand cyan (`#00E5FF`, see
> §Color) — it adopts JellySkin's purple/cyan identity wholesale. Brand cyan
> stays the marketing accent.

### Tokens (mirror of the `:root` block in `assets/spa-css/`)
| Token | Value |
|-------|-------|
| Background | `--bg: hsl(208,89%,5%)`; lighter `hsl(208,89%,20%)` |
| Background gradient | `linear-gradient(45deg, hsl(208,89%,5%), hsl(208,89%,20%))` |
| Surface (glass) | `hsla(208,60%,13%,.5)`; overlay `hsla(208,50%,30%,.4)` |
| Accent (primary) | `hsl(285,46%,56%)` (purple); accent2 `hsl(195,100%,43%)` (cyan) |
| Primary gradient | `linear-gradient(130deg, hsl(285,46%,56%), hsl(195,100%,43%))` |
| Secondary | `#f5a623` (amber) |
| Text | `--fg: #eef3f8`; muted `hsl(208,22%,72%)`; dim `hsl(208,16%,55%)` |
| Borders | `hsla(0,0%,100%,.12)`; lighter `hsla(0,0%,100%,.18)` |
| Live / recording | `hsl(150,60%,50%)` / `hsl(0,70%,60%)` |
| Radii | lg `20px`, base `10px`, sm `8px` |
| Spacing | `--space-1:4px; --space-2:8px; --space-3:12px; --space-4:16px; --space-6:24px; --space-8:32px; --space-12:48px; --space-16:64px` |
| Control sizing | `--control-h:32px; --control-h-lg:40px; --icon-btn:36px; --hit-min:28px` |
| Type floor | `--text-micro:11px; --text-xs:12px; --text-caption:13px; --text-sm:14px` |
| Blur (glass) | `blur(25px) saturate(110%) brightness(50%) contrast(110%)` |
| Shadow | `0 8px 24px hsla(208,89%,3%,.55)` |
| Font | `"Montserrat", -apple-system, …` (see §Typography) |

### Component idioms
- **Cards / surfaces**: translucent navy glass over the gradient + the heavy
  `--blur`; rounded `--radius` (10px), soft `--shadow`.
- **Primary actions / icons**: the 130° purple→cyan `--gradient`.
- **Scrollbars**: thin, accent-purple thumb on transparent track.
- New SPA components should consume the `:root` tokens above rather than
  hardcode colors, so a future theme swap is a single-file change.

## Typography

### SPA web app (CANONICAL — JellySkin)
- **All UI text:** Montserrat (JellySkin's typeface). Weights: 300, 400, 500, 600, 700.
- **Data/Tables/Code:** system monospace stack (`--mono`) with JetBrains Mono preferred where installed.
- **Loading:** Bunny Fonts CDN (privacy-friendly Google Fonts mirror — avoids
  leaking client IP/referer to Google): `https://fonts.bunny.net/css?family=montserrat:300,400,500,600,700`

### Marketing / Docs (non-SPA)
- **Display/Hero:** Satoshi — Geometric, modern, confident. Weights: 400, 500, 700, 900.
- **Body / UI / Labels:** Instrument Sans — clean, readable. Weights: 400, 500, 600, 700.
- **Data/Code:** JetBrains Mono. Weights: 400, 500.
- **Loading:** Bunny Fonts: `https://fonts.bunny.net/css?family=satoshi:400,500,700,900|instrument-sans:400,500,600,700|jetbrains-mono:400,500`

### Scale
| Level | Size | Weight | Usage |
|-------|------|--------|-------|
| Display XL | 72px / 4.5rem | 900 | Hero headlines |
| Display | 48px / 3rem | 900 | Section headlines |
| Display SM | 28px / 1.75rem | 700 | Section titles |
| Heading | 24px / 1.5rem | 700 | Card/panel headings |
| Subheading | 18px / 1.125rem | 600 | Subtitles, lead text |
| Body | 16px / 1rem | 400 | Default paragraph text |
| Body SM | 14px / 0.875rem | 400 | Secondary text, descriptions |
| Caption | 13px / 0.8125rem | 500 | Labels, metadata |
| Mono | 14px / 0.875rem | 400 | Code, config, data |
| Micro | 11px / 0.6875rem | 500 | Badges, tags, system labels |

## Color

### Approach
Balanced — two meaningful accents (cyan = live signal, amber = recording warmth) plus semantic colors. The palette tells the product's story: streams flow in cyan, recordings glow amber, the REC dot pulses red.

### Core Accents
| Name | Hex | Role |
|------|-----|------|
| Primary / Cyan | `#00E5FF` | Live streams, active states, links, focused borders, primary actions |
| Secondary / Amber | `#FFB020` | Recording indicator, key hints, highlights, secondary actions |

### Semantic
| Name | Hex | Role |
|------|-----|------|
| Live | `#39FF7F` | Channel live status indicator |
| Recording | `#FF4444` | REC dot, active recording, destructive actions, errors |
| Warning | `#FFCC00` | Disk space warnings, non-critical alerts |
| Info | `#00B4D8` | Informational messages, progress indicators |

### Surfaces (Dark Mode — Default)
| Name | Hex | Usage |
|------|-----|-------|
| Background | `#1A1B26` | App/page background |
| Surface | `#24253A` | Cards, panels, elevated containers |
| Overlay | `#3B3D56` | Dialogs, dropdowns, status bars, tooltips |
| Border | `#3B3D56` | Borders, dividers (same as overlay) |
| Dim | `#565B7E` | Muted text, disabled states, offline indicators |
| Muted Text | `#A9AECF` | Secondary body text, descriptions |
| Foreground | `#E8E8E2` | Primary text (warm off-white) |

### Surfaces (Light Mode)
| Name | Hex | Usage |
|------|-----|-------|
| Background | `#F5F5F0` | App/page background |
| Surface | `#FFFFFF` | Cards, panels |
| Overlay | `#E8E8E2` | Elevated elements |
| Border | `#D0D0CC` | Borders, dividers |
| Dim | `#A9AECF` | Muted text |
| Muted Text | `#565B7E` | Secondary text |
| Foreground | `#1A1B26` | Primary text |

Light mode accents are desaturated 10-20% for comfortable contrast:
- Primary: `#0099B3` | Secondary: `#D4900A` | Live: `#1A9E4A` | Recording: `#D93636`

### Platform Colors (Fixed — Not Themeable)
| Platform | Hex | Notes |
|----------|-----|-------|
| Twitch | `#9146FF` | Official brand purple |
| YouTube | `#FF0000` | Official brand red |
| Patreon | `#FF424D` | Official brand coral |

Platform colors represent external brands and must not change with the user's theme.

### Alpha / Glow Variants
For backgrounds, glows, and subtle tints — use the accent color at reduced opacity:
- `--primary-dim: rgba(0, 229, 255, 0.15)` — subtle cyan tint for backgrounds
- `--primary-glow: rgba(0, 229, 255, 0.3)` — cyan glow for hover/focus states
- `--secondary-dim: rgba(255, 176, 32, 0.15)` — amber tint
- `--secondary-glow: rgba(255, 176, 32, 0.3)` — amber glow
- `--rec-dim: rgba(255, 68, 68, 0.15)` — recording red tint
- `--live-dim: rgba(57, 255, 127, 0.15)` — live green tint

## Theming — inert since 0.6.0

The Ghostty-style theme system (16 semantic slots including 8 ANSI colours,
13 built-in palettes, a `~/.config/strivo/themes/` rescan, and an in-app theme
picker) was built for the ratatui TUI. It went inert when the TUI was deleted
in 0.6.0, along with the `strivo theme` subcommand — see CHANGELOG.md
"Removed".

What survives is the config surface only: `theme`, `[theme.colors]` and
`[theme.ansi]` still parse (`src/config/mod.rs`), and `strivo config get/set
theme` still reads and writes the name. **Nothing consumes the value.** There
is no palette loader in the tree, no `themes/` directory, and the SPA's
colours are hardcoded in the `:root` block of the CSS modules.

Treat the JellySkin token table above as the only live palette. Reviving
theming for the web UI is unspecified work: the ANSI-based slot model
described terminal cells and does not map onto the SPA, so it would need a
new model rather than a port.

## Spacing
- **Base unit:** 8px
- **Density:** Comfortable
- **Scale:**

| Token | Value | Usage |
|-------|-------|-------|
| `2xs` | 4px | Inline gaps, icon padding |
| `xs` | 8px | Tight element spacing |
| `sm` | 12px | Input padding, compact gaps |
| `md` | 16px | Default element spacing |
| `lg` | 24px | Section internal padding |
| `xl` | 32px | Card padding, component gaps |
| `2xl` | 48px | Section spacing |
| `3xl` | 64px | Page section breaks |

## Layout
- **Approach:** Grid-disciplined — strict alignment, predictable structure. Data-dense layout conventions throughout.
- **Grid:** 12 columns on desktop (>1024px), 8 on tablet (768-1024px), 4 on mobile (<768px)
- **Max content width:** 1120px
- **Border radius:**

| Token | Value | Usage |
|-------|-------|-------|
| `sm` | 4px | Inputs, small elements |
| `md` | 8px | Cards, buttons, swatches |
| `lg` | 12px | Panels, modals, large containers |
| `full` | 9999px | Pills, status dots, toggles |

## Motion
- **Approach:** Intentional — meaningful state transitions, no choreography
- **Signature animations:**
  - REC dot: 2s ease-in-out pulse (opacity 1 → 0.4 → 1, with red glow)
  - LIVE indicator: subtle green glow (box-shadow pulse)
  - Focus states: cyan glow fade-in (150ms)
  - Hover: translateY(-1px) + shadow expansion (150ms)
- **Easing:**
  - Enter: `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out, spring-like)
  - Exit: `ease-in`
  - Move: `ease-in-out`
- **Duration:**

| Token | Value | Usage |
|-------|-------|-------|
| micro | 50-100ms | Toggles, checkboxes |
| short | 150ms | Hover, focus, small transitions |
| medium | 250ms | Panel transitions, content shifts |
| long | 400-700ms | Page transitions, complex animations |

## Logo / Brand Identity Direction
- **Wordmark:** "StriVo" with the "Vo" in primary cyan — the split emphasizes "Stri(eam)" + "Vo(ice/Video)" and creates a visual hook
- **Mark concept:** Stylized play/record symbol — a circle (record) with a triangular play arrow, rendered in cyan/amber
- **Web hero treatment:** Faint scanline overlay on the hero section, pulsing REC dot with timestamp, dark atmospheric background
- **Social cards / OG images:** Deep blue-black background, Satoshi 900 wordmark, cyan accent, REC dot motif

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-20 | Initial design system created | Created by /design-consultation based on product analysis and competitive research (Ghostty, OBS, Streamlink, lazygit) |
| 2026-03-20 | Cyan #00E5FF as primary over Dracula purple | Differentiation: Twitch owns purple, OBS owns blue. Cyan reads as "live signal" and is underused in the space |
| 2026-03-20 | Amber #FFB020 as secondary | VCR recording light callback — warm accent in a cold-neon palette. Complementary pair with cyan |
| 2026-03-20 | Ghostty-style theming with 16 semantic slots | User customization without losing semantic meaning. 13 built-in themes, individual slot overrides via TOML, plus user `.toml`/`.conf` files |
| 2026-03-20 | Platform colors fixed (not themeable) | Twitch/YouTube/Patreon colors are external brands — changing them would be confusing |
| 2026-03-20 | Tokyo Night-adjacent background #1A1B26 | Warmer than Dracula's gray (#282A36), more depth than pure black. Familiar to terminal users |
| 2026-09-07 | TUI sections removed from this document | The ratatui TUI was deleted in 0.6.0; this doc still described TUI fonts, a TUI accent, and a live theme system. Recorded rather than deleted: the theme config keys still parse but nothing renders from them |

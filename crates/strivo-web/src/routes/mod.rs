pub mod api;
pub mod assets;
// Twitch IRC chat's two server-side routes (list rooms, relay an outbound
// send) — core, every-edition functionality, not a Creator/Pro plugin. See
// the module doc for why it isn't folded into `plugins`.
pub mod chat;
pub mod events;
// Strivo Pro licence routes (status/activate/trial/refresh) — entitlement is
// a Creator Edition product concept (ADR 0002, closing CE06); the PVR
// edition has no notion of "Pro" at all, so this module and its router are
// Creator-only. Compiling it out of a PVR build (rather than leaving it
// mounted-but-inert) keeps licence/tier vocabulary out of the PVR surface
// entirely, matching the monorepo's invisibility bar.
#[cfg(feature = "creator")]
pub mod licence;
pub mod login;
// Multi-stream tile layout for the watch player. Core (single + multi view),
// not a Pro plugin — always compiled so the PVR build's player works.
pub mod multistream;
// First-party plugin routes (Crunchr/Archiver/Insights/Viewguard + the
// recording captions VTT endpoint) — Creator Edition only. The licence
// runtime gate still filters locked Pro plugins for non-entitled clients
// within the edition.
#[cfg(feature = "creator")]
pub mod plugins;
// Retained but unmounted: the sole recording file-serving path (download/
// play) plus the path-containment guard + tests from roadmap item 2. The
// legacy htmx page routers (channels/dashboard/logs/schedule/settings/
// system) were retired in item 10 — the SPA + /api/v1 supersede them.
pub mod recordings;
pub mod websub;

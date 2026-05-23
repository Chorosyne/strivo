//! Shared glyph constants and small frame-pickers for the animation layer.
//!
//! Centralises the strings that show up across widgets so new panes pick the
//! same alphabet without re-inventing it. Time-based pickers honor
//! [`super::reduce_motion`] and return a stable fallback when motion is off.

/// 10-frame braille spinner used while a stream URL is being resolved, a
/// recording is starting, or any other "background work in flight" state.
/// Cadence: one frame every 80 ms.
pub const SPINNER_FRAMES: [&str; 10] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/// Stable glyph used when reduce-motion is on instead of the braille cycle.
pub const SPINNER_STILL: &str = "⟳";

/// REC dot — filled circle. Pulsed via [`Theme::status_recording`] + alpha.
pub const REC_DOT: &str = "●";

/// LIVE dot — ringed circle. Distinct from REC at a glance.
pub const LIVE_DOT: &str = "◉";

/// Recording-stopping crossfade pair (`◼ ↔ ◻`).
pub const STOP_GLYPHS: (&str, &str) = ("◼", "◻");

/// Failed-state breathing glyph.
pub const FAILED_GLYPH: &str = "✗";

/// Frame-index lookup for the 80 ms braille spinner. Returns
/// [`SPINNER_STILL`] when reduce-motion is on.
pub fn spinner_frame(elapsed_secs: f32) -> &'static str {
    if super::reduce_motion() {
        return SPINNER_STILL;
    }
    let idx = ((elapsed_secs / 0.08) as usize) % SPINNER_FRAMES.len();
    SPINNER_FRAMES[idx]
}

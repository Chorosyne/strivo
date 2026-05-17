//! Animation primitives for the StriVo TUI.
//!
//! - [`clock::FrameClock`] drives time-based motion (dt per frame).
//! - [`tween::Tween`] interpolates a value over a duration with an easing curve.
//! - [`easing::Ease`] enumerates the available curves (DESIGN.md motion spec).
//!
//! Motion is globally gated by `reduce_motion()`, which honors the
//! `STRIVO_REDUCE_MOTION` env var (any non-empty, non-`0` value disables
//! animations — tweens snap instantly to their end state).

pub mod clock;
pub mod easing;
pub mod tween;

pub use clock::FrameClock;
pub use easing::Ease;
pub use tween::{pulse_phase, Lerp, Tween};

use std::sync::atomic::{AtomicU8, Ordering};

// 0 = uninitialized, 1 = motion on, 2 = motion off.
static REDUCE_MOTION: AtomicU8 = AtomicU8::new(0);

/// Returns `true` when animations should snap instead of tween.
/// Caches the env-var lookup on first call.
pub fn reduce_motion() -> bool {
    match REDUCE_MOTION.load(Ordering::Relaxed) {
        1 => false,
        2 => true,
        _ => {
            // STRIVO_REDUCE_MOTION (canonical) or NO_MOTION (M4.6, the
            // generic env alias). Either set to a non-empty, non-"0"
            // value disables animation. Caches the result on first
            // call so the env lookup is a one-shot.
            let strivo = std::env::var("STRIVO_REDUCE_MOTION")
                .map(|v| !v.is_empty() && v != "0")
                .unwrap_or(false);
            let generic = std::env::var("NO_MOTION")
                .map(|v| !v.is_empty() && v != "0")
                .unwrap_or(false);
            let reduce = strivo || generic;
            REDUCE_MOTION.store(if reduce { 2 } else { 1 }, Ordering::Relaxed);
            reduce
        }
    }
}

/// Force the reduce-motion flag. Primarily for tests and future config wiring.
pub fn set_reduce_motion(reduce: bool) {
    REDUCE_MOTION.store(if reduce { 2 } else { 1 }, Ordering::Relaxed);
}

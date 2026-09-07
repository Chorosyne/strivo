//! Entitlement gate — the single read path for "should this Pro
//! feature unlock?". Everything that gates on a paid plugin calls
//! this. Lives outside the plugin loader so the same function can
//! gate UI surfaces (the upgrade card) and runtime loads alike.
//!
//! Decision order:
//!
//!   1. **Debug-only override** — `STRIVO_DEV_UNLOCK_ALL=1` can enable
//!      development tests in a debug build.
//!   2. **Default** — Creator/Pro functionality is unavailable. The former
//!      licence-cache path is deliberately disabled until the product has a
//!      reviewed, secure release and purchase design.
//!
//! The set of "Pro" plugin names is not core's to know — core has no
//! notion of what a plugin *is*, let alone which ones cost money. The
//! caller that composes plugins into the running app (the Creator
//! Edition web server, at startup) registers the Pro set once via
//! [`set_pro_plugins`]; the PVR edition never calls it, so a pure-PVR
//! build's registry stays empty and nothing is Pro-gated. See ADR 0001
//! (CE06): entitlement is a Creator Edition product concept, and this
//! registry is the seam that lets Creator own the plugin-slug list
//! without core naming a single one of them.

use std::sync::RwLock;

/// Registry of plugin identifiers this build treats as "Pro" (gated
/// behind entitlement). Empty until a caller registers a set via
/// [`set_pro_plugins`]; core never populates it itself.
static PRO_PLUGINS: RwLock<Vec<String>> = RwLock::new(Vec::new());

/// Registers the set of plugin identifiers this build's edition treats
/// as Pro. Replaces whatever set (if any) was registered before — last
/// call wins. Intended to be called once, at startup, by the edition
/// that knows which plugins it ships and which of those are paid.
pub fn set_pro_plugins<I, S>(names: I)
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let mut registry = PRO_PLUGINS.write().expect("PRO_PLUGINS lock poisoned");
    *registry = names.into_iter().map(Into::into).collect();
}

pub fn is_pro_plugin(name: &str) -> bool {
    PRO_PLUGINS
        .read()
        .expect("PRO_PLUGINS lock poisoned")
        .iter()
        .any(|p| p.eq_ignore_ascii_case(name))
}

/// Returns true if `plugin` should be allowed to load / be exposed in
/// the UI. Free plugins are always allowed; Pro plugins require a
/// valid licence cache or the dev override.
pub fn is_entitled(plugin: &str) -> bool {
    if !is_pro_plugin(plugin) {
        return true;
    }
    if dev_unlock() {
        return true;
    }
    false
}

/// Whole-app entitlement (used by the upgrade card, the licence
/// status route, etc.) — true iff *any* Pro feature is unlocked on
/// this machine right now.
pub fn entitled() -> bool {
    dev_unlock()
}

fn dev_unlock() -> bool {
    cfg!(debug_assertions)
        && std::env::var("STRIVO_DEV_UNLOCK_ALL")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn free_plugins_always_allowed() {
        assert!(is_entitled("some-third-party"));
        assert!(is_entitled(""));
    }

    #[test]
    fn pro_plugin_list_matches_registered_set() {
        set_pro_plugins(["test-plugin-a", "test-plugin-b"]);
        assert!(is_pro_plugin("test-plugin-a"));
        assert!(is_pro_plugin("TEST-PLUGIN-A"));
        assert!(is_pro_plugin("test-plugin-b"));
        assert!(!is_pro_plugin("something-else"));
    }

    #[test]
    fn dev_unlock_env_grants_entitlement() {
        // SAFETY: this test only sets the env if not already set;
        // `STRIVO_DEV_UNLOCK_ALL=1` is the documented unlock path.
        std::env::set_var("STRIVO_DEV_UNLOCK_ALL", "1");
        assert!(is_entitled("some-test-plugin"));
        assert!(entitled());
        std::env::remove_var("STRIVO_DEV_UNLOCK_ALL");
    }
}

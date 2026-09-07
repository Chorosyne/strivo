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
//! notion of what a plugin *is*, let alone which ones cost money. Both
//! [`is_pro_plugin`] and [`is_entitled`] take that set as a parameter:
//! the caller that composes plugins into the running app (the Creator
//! Edition web server) supplies its own Pro plugin slugs; the PVR
//! edition passes an empty set (or never calls in on a code path it
//! doesn't compile), so nothing is Pro-gated there. See ADR 0001 (CE06):
//! entitlement is a Creator Edition product concept, and core's gate
//! stays generic over *which* plugins that means without naming any of
//! them.

pub fn is_pro_plugin(name: &str, pro_plugins: &[&str]) -> bool {
    pro_plugins.iter().any(|p| p.eq_ignore_ascii_case(name))
}

/// Returns true if `plugin` should be allowed to load / be exposed in
/// the UI. Free plugins (not in `pro_plugins`) are always allowed; Pro
/// plugins require a valid licence cache or the dev override.
pub fn is_entitled(plugin: &str, pro_plugins: &[&str]) -> bool {
    if !is_pro_plugin(plugin, pro_plugins) {
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

    const TEST_PRO_PLUGINS: &[&str] = &["test-plugin-a", "test-plugin-b"];

    #[test]
    fn free_plugins_always_allowed() {
        assert!(is_entitled("some-third-party", TEST_PRO_PLUGINS));
        assert!(is_entitled("", TEST_PRO_PLUGINS));
    }

    #[test]
    fn pro_plugin_list_matches_caller_supplied_set() {
        assert!(is_pro_plugin("test-plugin-a", TEST_PRO_PLUGINS));
        assert!(is_pro_plugin("TEST-PLUGIN-A", TEST_PRO_PLUGINS));
        assert!(is_pro_plugin("test-plugin-b", TEST_PRO_PLUGINS));
        assert!(!is_pro_plugin("something-else", TEST_PRO_PLUGINS));
        assert!(!is_pro_plugin("test-plugin-a", &[]));
    }

    #[test]
    fn dev_unlock_env_grants_entitlement() {
        // SAFETY: this test only sets the env if not already set;
        // `STRIVO_DEV_UNLOCK_ALL=1` is the documented unlock path.
        std::env::set_var("STRIVO_DEV_UNLOCK_ALL", "1");
        assert!(is_entitled("test-plugin-a", TEST_PRO_PLUGINS));
        assert!(entitled());
        std::env::remove_var("STRIVO_DEV_UNLOCK_ALL");
    }
}

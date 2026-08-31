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
//! The set of "Pro" plugin names is hard-coded for now — it's a tiny
//! list and won't churn. When we ship a third-party plugin SDK
//! (post-1.0) this becomes a manifest lookup.

/// First-party Pro plugins. Anything not in this list is treated as
/// free and ungated. Creator/Pro plugins are not publicly available yet;
/// only a debug build may opt in for development coverage.
pub const PRO_PLUGINS: &[&str] = &["crunchr", "archiver", "viewguard", "insights"];

pub fn is_pro_plugin(name: &str) -> bool {
    PRO_PLUGINS.iter().any(|p| p.eq_ignore_ascii_case(name))
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
    fn pro_plugin_list_matches_first_party_set() {
        assert!(is_pro_plugin("crunchr"));
        assert!(is_pro_plugin("CRUNCHR"));
        assert!(is_pro_plugin("archiver"));
        assert!(is_pro_plugin("viewguard"));
        assert!(is_pro_plugin("insights"));
        assert!(!is_pro_plugin("something-else"));
    }

    #[test]
    fn dev_unlock_env_grants_entitlement() {
        // SAFETY: this test only sets the env if not already set;
        // `STRIVO_DEV_UNLOCK_ALL=1` is the documented unlock path.
        std::env::set_var("STRIVO_DEV_UNLOCK_ALL", "1");
        assert!(is_entitled("crunchr"));
        assert!(entitled());
        std::env::remove_var("STRIVO_DEV_UNLOCK_ALL");
    }
}

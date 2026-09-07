//! Proves the untyped `extensions` table (the mechanism that replaced
//! core's old typed `AppConfig.crunchr`/`AppConfig.archiver` fields — see
//! ADR 0001 CE01) actually round-trips an existing user's `config.toml`:
//! a file with `[crunchr]`/`[archiver]` sections still parses, the values
//! are still reachable by the plugin that owns them, and saving writes
//! the same sections back unchanged. Core itself doesn't know these are
//! Crunchr/Archiver's sections — this test stands in for "the plugin"
//! with its own local structs, exactly as `strivo-plugins` does for real.
//!
//! Lives as an integration test (not a `src/config` unit test) so it
//! exercises `AppConfig` purely through its public surface, and so this
//! file's own local `Fake*Config` structs don't themselves become part
//! of core's Crunchr/Archiver footprint.

use serde::{Deserialize, Serialize};
use strivo_core::config::AppConfig;

/// Mirrors the shape of `strivo_plugins::crunchr::types::CrunchrConfig`
/// closely enough to prove the round-trip; this crate can't depend on
/// that type (it lives downstream), which is the point of the test.
#[derive(Debug, Default, Serialize, Deserialize, PartialEq)]
struct FakeCrunchrConfig {
    #[serde(default)]
    enabled: bool,
    #[serde(default)]
    tandem_channels: Vec<String>,
}

#[derive(Debug, Default, Serialize, Deserialize, PartialEq)]
struct FakeArchiverConfig {
    #[serde(default)]
    enabled: bool,
    #[serde(default)]
    archive_dir: String,
}

const EXISTING_CONFIG_TOML: &str = r#"
    recording_dir = "/home/user/Recordings"

    [crunchr]
    enabled = true
    tandem_channels = ["Twitch:123456"]

    [archiver]
    enabled = true
    archive_dir = "/home/user/Archives"
"#;

#[test]
fn existing_config_toml_with_plugin_sections_parses() {
    let cfg: AppConfig = toml::from_str(EXISTING_CONFIG_TOML).unwrap();
    assert!(cfg.extensions.contains_key("crunchr"));
    assert!(cfg.extensions.contains_key("archiver"));
}

#[test]
fn plugin_section_delivers_typed_values_to_the_owning_plugin() {
    let cfg: AppConfig = toml::from_str(EXISTING_CONFIG_TOML).unwrap();
    let crunchr: FakeCrunchrConfig = cfg.plugin_section("crunchr");
    assert!(crunchr.enabled);
    assert_eq!(crunchr.tandem_channels, vec!["Twitch:123456".to_string()]);

    let archiver: FakeArchiverConfig = cfg.plugin_section("archiver");
    assert!(archiver.enabled);
    assert_eq!(archiver.archive_dir, "/home/user/Archives");
}

#[test]
fn missing_section_defaults_instead_of_failing() {
    let cfg: AppConfig = toml::from_str(r#"recording_dir = "/tmp""#).unwrap();
    let crunchr: FakeCrunchrConfig = cfg.plugin_section("crunchr");
    assert_eq!(crunchr, FakeCrunchrConfig::default());
}

#[test]
fn save_and_reload_round_trips_plugin_sections_unchanged() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.toml");
    std::fs::write(&path, EXISTING_CONFIG_TOML).unwrap();

    let cfg = AppConfig::load(Some(&path)).unwrap();
    cfg.save(Some(&path)).unwrap();

    let reloaded = AppConfig::load(Some(&path)).unwrap();
    let crunchr: FakeCrunchrConfig = reloaded.plugin_section("crunchr");
    assert!(crunchr.enabled);
    assert_eq!(crunchr.tandem_channels, vec!["Twitch:123456".to_string()]);
    let archiver: FakeArchiverConfig = reloaded.plugin_section("archiver");
    assert!(archiver.enabled);
    assert_eq!(archiver.archive_dir, "/home/user/Archives");
}

#[test]
fn legacy_section_name_is_reachable_via_plugin_section_aliased() {
    // A config.toml saved before Crunchr's section was renamed from
    // "sloptube" to "crunchr" — must still deliver its values.
    let cfg: AppConfig = toml::from_str(
        r#"
        [sloptube]
        enabled = true
        "#,
    )
    .unwrap();
    let crunchr: FakeCrunchrConfig = cfg.plugin_section_aliased(&["crunchr", "sloptube"]);
    assert!(crunchr.enabled);
}

/// Stands in for `strivo_plugins::crunchr::POST_PULL_MARKER` — this crate
/// can't depend on that constant (it lives downstream), which is the
/// point of the test: core's `post_pull_markers` must work from a plain
/// `(section, marker)` registration, not from baked-in plugin knowledge.
const CRUNCHR_MARKER_REGISTRATION: (&str, &str) = ("crunchr", ".crunchr-auto");

#[test]
fn post_pull_markers_still_honours_crunchr_enabled_through_the_new_seam() {
    let cfg: AppConfig = toml::from_str(EXISTING_CONFIG_TOML).unwrap();
    assert_eq!(
        cfg.post_pull_markers(false, &[CRUNCHR_MARKER_REGISTRATION]),
        vec![".crunchr-auto".to_string()]
    );
    assert_eq!(
        cfg.post_pull_markers(true, &[CRUNCHR_MARKER_REGISTRATION]),
        Vec::<String>::new()
    );

    let disabled: AppConfig = toml::from_str(r#"recording_dir = "/tmp""#).unwrap();
    assert!(disabled
        .post_pull_markers(false, &[CRUNCHR_MARKER_REGISTRATION])
        .is_empty());
}

#[test]
fn post_pull_markers_is_empty_with_no_registrations() {
    // The pure-PVR build always calls with an empty registration list —
    // core itself names no plugin, so even an enabled `[crunchr]` section
    // produces nothing unless something registers it.
    let cfg: AppConfig = toml::from_str(EXISTING_CONFIG_TOML).unwrap();
    assert!(cfg.post_pull_markers(false, &[]).is_empty());
}

#[test]
fn archiver_enabled_produces_no_marker_even_though_it_also_has_an_enabled_flag() {
    // Regression guard for the exact behaviour-preservation risk called
    // out in ADR 0001 (CE01): `[archiver]` has always had its own
    // `enabled` flag but has never produced a marker file. Registering
    // only Crunchr's marker (as the real app does) must leave an enabled
    // `[archiver]` section producing nothing, even though both sections
    // are `enabled = true` in this fixture.
    let cfg: AppConfig = toml::from_str(EXISTING_CONFIG_TOML).unwrap();
    assert!(cfg.extensions["archiver"]["enabled"].as_bool().unwrap());
    assert_eq!(
        cfg.post_pull_markers(false, &[CRUNCHR_MARKER_REGISTRATION]),
        vec![".crunchr-auto".to_string()],
        "archiver's own enabled flag must not add a marker"
    );

    // Even if a caller *did* register archiver's section, only sections
    // actually registered can ever produce a marker — proving the
    // generic function is data-driven, not hardcoded around Crunchr.
    let archiver_only = cfg.post_pull_markers(false, &[("archiver", ".archiver-auto")]);
    assert_eq!(archiver_only, vec![".archiver-auto".to_string()]);
}

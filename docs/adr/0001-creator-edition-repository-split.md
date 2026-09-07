# 0001. Creator Edition repository split

Status: Superseded by [0002](0002-monorepo-boundary.md) — see the [ADR index](README.md)
Date: 2026-09-06

## Context

StriVo ships two editions from one repository. The default build (`cargo
build`, restricted by `default-members` to `.`, `crates/strivo-bin`,
`crates/strivo-web`) is a pure live-stream PVR. `--features creator` adds a
large analytics/creator toolkit: 35 additional crates under `crates/`,
mounted into the web UI's router and gated behind the `creator` Cargo
feature at every layer.

The long-term goal is to let Creator Edition live in its own repository,
developed and released independently of the PVR. This ADR is the record of
that decision for the load-bearing first pass: what moved, what couldn't
move yet, and why.

The Cargo-level seam was already sound going in and this pass preserves it
rather than changing it:

- All 35 Creator crates are `optional = true` dependencies of
  `crates/strivo-web/Cargo.toml`, reached only through the `creator` feature
  (`crates/strivo-web/Cargo.toml:13-56`, listing every `dep:strivo-*` crate).
- Root `Cargo.toml`'s `default-members` restricts a bare `cargo build` to
  the three PVR crates; the 35 Creator crates stay workspace members (so
  `--workspace` and `--features creator` builds still reach them) but are
  excluded from the default set.

So the split is a source-layout and distribution problem, not a
dependency-graph problem. This pass (CE01–CE06) worked the six concrete
items below.

## Decision

### CE01 — Remove Creator vocabulary from strivo-core (partially done)

**Done, verified:**

- `CatalogPullOptions.crunchr_auto: bool` (a `pub bool` field literally
  named after the Crunchr plugin, present even in pure-PVR builds) is
  replaced by `post_pull_markers: Vec<String>` — an opaque list of marker
  filenames core touches (empty-file writes) in the landed episode
  directory. Core has zero opinion on what the names mean; the caller
  supplies them. `AppConfig::post_pull_markers(&self, suppress: bool) ->
  Vec<String>` (new, in `src/config/mod.rs`) is the one place that still
  knows about `crunchr.enabled` and the `.crunchr-auto` filename, so
  `src/recording/bulk.rs` and `crates/strivo-bin/src/main.rs` no longer
  need to.
  - The field stays a plain, always-present type (not itself
    `cfg`-gated) deliberately: an earlier attempt to gate the field
    directly broke Cargo feature unification under `--workspace` (see the
    comment this replaces, formerly at `src/recording/catalog.rs:36-42`).
    strivo-plugins turns on `strivo-core/creator`; strivo-bin's own
    `creator` feature can stay off in the same build graph; if the field's
    *presence* depended on strivo-bin's local feature, a struct literal in
    strivo-bin would omit a field the compiled core structurally has. The
    fix generalizes the concept instead of re-hiding it: keep the field
    type feature-independent, and let only the *value* vary by the
    caller's own feature flag.
- `src/recording/persist.rs`'s `crunchr_queue` SQLite table,
  `CrunchrQueueEntry` struct, and its three CRUD methods
  (`upsert_crunchr_queue`, `load_crunchr_queue_pending`,
  `delete_crunchr_queue_entry`) are deleted outright. They were dead code —
  nothing in the workspace called them (verified by grep across the whole
  tree, not just `src/`) — so this is deletion of an orphan, not a rename
  into a fake generic abstraction.
- `src/tasks/mod.rs`'s `TaskKind::ArchiverPull` / `TaskKind::CrunchrAnalyze`
  variants are renamed to `CatalogPull` / `PostProcess` (only a unit test
  referenced the latter; both were otherwise unused).
- Comment-only Creator-plugin references reworded to generic language in
  `src/plugin/mod.rs`, `src/pipeline/stage.rs`, `src/pipeline/executor.rs`,
  `src/recording/chapters.rs`, `src/recording/mod.rs`,
  `src/recording/persist.rs`, `src/daemon.rs`, `src/edl/render.rs`,
  `src/edl/schema.rs`. None of these carried behavior tied to the wording.
- `src/edl/render.rs::pipeline_from_preset_stages` no longer hardcodes a
  `"crunchr::{preset_name}"` pipeline name; it uses `preset_name` verbatim
  (no test asserted the old prefix, so this is a safe, uncovered-behavior
  cleanup, not a silent break).

**Not done — genuinely blocked, stopped here:**

- `AppConfig.crunchr: CrunchrConfig` / `AppConfig.archiver: ArchiverConfig`
  (`src/config/mod.rs:52-56` and the ~150-line type definitions plus 17
  `cfg(feature = "creator")` sites) still live in core. The target state —
  core exposing an untyped extension table (`BTreeMap<String,
  serde_json::Value>`) instead of typed Creator config — is not reachable
  from this workstream: `crates/strivo-web/src/routes/api.rs` reads and
  writes `cfg.crunchr.*` / `cfg.archiver.*` by field name directly at 15+
  call sites (settings GET/PATCH handlers, tandem-channel toggles, quota
  checks). That file is out of scope (owned by a sibling workstream editing
  it concurrently) and forbidden to touch for this task. Retyping the field
  would not compile against it. This is the single largest remaining
  chunk of Creator vocabulary in core, and it's a hard dependency, not an
  oversight.
- `src/pipeline/templates.rs`'s `creator_intelligence` / `creator_publish`
  functions still dispatch to the plugin literally named `"crunchr"`
  (`StageDispatch::new("crunchr", "transcribe")`). This identifier is
  real, external API surface: `crates/strivo-web/src/routes/plugins.rs`
  calls `gate_pro("crunchr")` at 30+ sites and the plugin registry matches
  on `Plugin::name() == "crunchr"`; `crates/strivo-web/assets/spa.js`
  hardcodes the same string in its plugin catalog and dispatch calls.
  Renaming it would require touching all three forbidden/sibling-owned
  surfaces in lockstep. Left as-is with a comment pointing here.
- `src/licence/gate.rs::PRO_PLUGINS` (`&["crunchr", "archiver",
  "viewguard", "insights"]`) is a hardcoded list of Creator plugin slugs
  living in core's entitlement gate. Same blocker as above — 30+
  `gate_pro("crunchr")` call sites in the forbidden `routes/plugins.rs` —
  plus this overlaps CE06 below, which is a deliberate ownership decision,
  not something to resolve as a side effect of a naming cleanup.

**Verification of the acceptance bar:** `grep -ri "crunchr\|archiver"
src/` is *not* clean. Remaining hits are exactly the three clusters above
(`src/config/mod.rs`, `src/pipeline/templates.rs`,
`src/licence/gate.rs`, plus one comment in `src/recording/persist.rs` that
now correctly says "transcription plugin" instead of "Crunchr" — checked,
that one's fine). Every remaining hit is annotated in-place with why it's
there and what would need to move first. This is reported as a partial
result, not a completion.

### CE04 — Distribution mechanism (decision, no structural change)

**Recommendation: git dependency with pinned tags, not crates.io, not
vendoring — at least for the first cut.**

Reasoning:

- **crates.io** requires every one of the 35 crates (plus their inter-crate
  path deps) to independently satisfy crates.io's rules (no path deps,
  full metadata, semver discipline per-crate). `strivo-plugins/Cargo.toml`
  already sets `publish = false`, and un-publishing that decision while
  splitting into a second repo is a lot of simultaneous change for a
  "first, load-bearing stage." It also forces 35 independent version
  numbers into being immediately, before there's a release process to
  manage them. Revisit once Creator Edition has an external consumer base
  that needs discoverability — not needed for a single downstream
  (strivo-bin/strivo-web in the same org).
- **Vendoring** (copying the tree into the PVR repo, or vice versa)
  reintroduces exactly the coupling this split is trying to remove: a
  single commit history, no independent release cadence, and the
  Cargo-workspace member list this ADR is trying to shrink.
- **Git dependency** (`strivo-core = { git = "...", tag = "v0.6.0" }` from
  the Creator repo's `strivo-plugins`, or the reverse direction for a
  vendored core-facing shim) matches what this crate already *was*:
  `crates/strivo-plugins/Cargo.toml:29-32`'s comment records "Was a `git =
  ...` ref while strivo-plugins lived in its own repo; folded into the
  workspace, this is a path dep." This isn't a new mechanism, it's
  reverting a fold-in that was presumably done for cross-repo build/CI
  convenience. Reverting it is the smallest change that gets a working
  two-repo split, and it's a mechanism this codebase has already
  operated with once.
- **Versioning:** pin by tag (`vMAJOR.MINOR.PATCH`, per the SemVer 2.0.0
  policy recorded in ROADMAP.md), not by branch or commit
  SHA, so a Creator Edition release states an explicit, auditable
  dependency on a specific PVR core release. CI on both repos should
  matrix-build against at least the last N tags of the other, to catch
  drift before either side cuts a release.
- **CI implication:** the Creator repo's CI needs network access to fetch
  the git dependency (or an internal git mirror/cache) — a small,
  well-understood cost compared to crates.io publishing overhead.

No Cargo.toml changes were made for CE04 in this pass — the current
in-workspace `path = "../.."` dependencies are correct *for a
single-repo* state, and changing them now, before the second repo exists,
would just break the build. This is a decision for whoever performs the
actual repo split, to apply at that time.

### CE05 — Is `strivo-core`'s `creator` feature deletable?

**No — it must survive, and CE01's stopping point is exactly why.**

If CE01 had fully succeeded (typed `CrunchrConfig`/`ArchiverConfig` gone
from `AppConfig`, replaced by an untyped extension table), the `creator`
feature on `strivo-core` would indeed become deletable: nothing left in
core would need to conditionally compile.

But CE01 did *not* fully succeed — `AppConfig.crunchr` /
`AppConfig.archiver` are still `#[cfg(feature = "creator")]`-gated typed
fields in `src/config/mod.rs`, blocked by `routes/api.rs`'s direct field
access (see above). As long as those typed fields exist, `strivo-core`
needs a feature flag to gate their compilation in the pure-PVR build (a
PVR binary must not carry Creator-specific config sections). So
`strivo-core/creator` stays.

`crates/strivo-plugins/Cargo.toml:33`'s
`strivo-core = { path = "../..", features = ["creator"] }` is therefore
still a real, necessary dependency edge, not a leftover to prune. A
future repo split would need `strivo-core` (from the PVR repo) to keep
publishing/tagging a `creator` feature that the Creator repo's
`strivo-plugins` enables across the repo boundary — which is exactly the
git-dependency shape recommended in CE04.

### CE02 — Does `strivo-web` split too? (decision, no code change)

**Recommendation: `strivo-web` stays in the PVR repo and takes an
optional dependency on a `strivo-creator-web` crate contributed by the
Creator repo, merged at the router seam.**

`crates/strivo-web/src/server.rs:114-123` already merges an
optionally-compiled sub-router into the main one under
`#[cfg(feature = "creator")]` — that seam is the natural boundary. The
alternative (splitting `strivo-web` itself into PVR-web and Creator-web
crates) would force every shared piece — auth, CSRF, session handling,
telemetry, the settings page's non-Creator sections, `routes/api.rs`'s
non-Creator handlers — to be duplicated or extracted into a third shared
crate, for 29 `cfg(feature = "creator")` sites in `routes/api.rs` alone
plus the wholesale `routes/plugins.rs` mount. That's a much bigger,
riskier cut than the problem calls for. Keeping one web crate that
optionally depends on a Creator-contributed `Router` is the smaller,
reversible move: it mirrors the Cargo-level pattern already proven for
the 35 tool crates, just one level up (a `Router` instead of 35 tool
crates).

### CE03 — Two editions, one `spa.js` (decision, no code change)

**Recommendation: split `spa.js` into a PVR module and a Creator module,
built/served independently, matching the pattern `assets/research/`
already demonstrates.**

Today both editions come from one ~15,400-line `spa.js` with Creator
sections deleted at build time (line-range marker surgery) for PVR
builds. `assets/research/` shows the better pattern already in this repo:
`build.rs` removes that whole directory cleanly for PVR builds, no marker
surgery. Target state:

- `crates/strivo-web/assets/spa.js` keeps only PVR-surface JS (recordings,
  monitor, schedule, library, settings minus Creator sections).
- A new `crates/strivo-web/assets/creator/` (or a Creator-repo-contributed
  asset bundle, mirroring CE02's `strivo-creator-web` crate) holds
  everything currently deleted by line-range: the plugin catalog, the
  pipeline/marketplace UI, and the 86-route-registration surface's
  client-side counterpart.
- `build.rs` includes/excludes the whole `creator/` directory by feature,
  the same way it already does for `assets/research/` — no line markers,
  no per-line deletion, so a Creator repo can ship its own JS bundle
  without patching the PVR's `spa.js` at build time.
- A sibling workstream is actively fixing a defect in the current
  line-marker mechanism; this ADR intentionally describes the *target*
  shape rather than patching the current one, per this task's brief, to
  avoid colliding with that in-flight fix.

### CE06 — Who owns entitlement checking? (decision, no code change)

**Recommendation: entitlement checking moves to the Creator repo,
alongside the plugins it gates — but not in this pass; flagged, not
executed, exactly like CE01's `PRO_PLUGINS` finding.**

Today `src/licence/gate.rs` (core) hardcodes the Pro plugin slug list and
exposes `is_entitled`/`is_pro_plugin`; `crates/strivo-web/src/routes/
plugins.rs` calls `gate_pro(...)` (which wraps those) at 20+ sites, and
`routes/licence.rs` is merged into the shared router. Two considerations
point the same direction:

- The plugin identity list (`crunchr`, `archiver`, `viewguard`,
  `insights`) is Creator vocabulary — it shouldn't live in core any more
  than `CrunchrConfig` should (CE01).
- Entitlement is a Creator Edition *product* concept (Pro tier gating);
  the PVR edition has no notion of "Pro" at all. Keeping it in core makes
  the PVR build carry dead entitlement machinery it never needs.

The clean target: the Creator repo owns `is_entitled`/`is_pro_plugin` and
the plugin-slug list, calling into a small, generic capability core
exposes (e.g. "does this licence cache say entitled at all" —
`entitled()`'s cache/dev-unlock logic, which *is* generic and could stay
in core) rather than core owning the plugin-specific gate. This wasn't
executed in this pass because `routes/plugins.rs` and `routes/licence.rs`
are forbidden files owned by a sibling workstream actively editing them;
moving the gate function they call out from under them mid-edit is
exactly the kind of collision this task's scoping was designed to avoid.

## Consequences

- The pure-PVR build is unaffected: `cargo build` (default members),
  `cargo build --workspace`, and `cargo test --workspace` all pass with
  this pass's changes (see verification log in the delivery report).
- `strivo-core`'s public surface has one fewer Creator-named field
  (`CatalogPullOptions.crunchr_auto` → `post_pull_markers`) and one fewer
  dead persistence table (`crunchr_queue`), reducing the amount of
  Creator-specific rename/relocate work a future split has to do.
- `strivo-core`'s `creator` feature is confirmed necessary and NOT
  deletable at this time; anyone tempted to remove it later should first
  re-check whether CE01's `AppConfig.crunchr`/`archiver` blocker has been
  cleared (i.e., whether `routes/api.rs` still reads those fields by
  name).
- Three concrete pieces of remaining Creator vocabulary in `strivo-core`
  are now precisely located and each carries an in-source comment
  pointing back to this ADR: `src/config/mod.rs` (typed config fields),
  `src/pipeline/templates.rs` (the `"crunchr"` dispatch identifier),
  `src/licence/gate.rs` (the Pro plugin slug list). A future pass that
  *does* have write access to `crates/strivo-web/src/routes/{api,
  plugins, licence}.rs` can close all three in one coordinated change
  (they're linked: config fields, dispatch name, and entitlement gate all
  trace back to the same forbidden files).
- CE02/CE03/CE04/CE06 are written decisions only; no code changed for
  them in this pass. Executing CE02 (the `strivo-creator-web` split) and
  CE03 (the `spa.js` module split) both require coordinated changes to
  files this workstream was explicitly barred from touching, and should
  be scheduled as their own workstreams once the sibling agents currently
  editing `routes/*` and the SPA build finish.

## Roads not taken

- **Re-applying `cfg` to `CatalogPullOptions.crunchr_auto` directly.**
  Tried previously (per the comment this pass removed) and known to break
  `--workspace` builds via feature unification. Rejected again for the
  same reason; the fix generalizes the field instead.
- **Moving `CrunchrConfig`/`ArchiverConfig` to an untyped extension table
  now, forcing `routes/api.rs` to adapt.** Rejected: that file is
  out-of-scope and owned by a concurrently-active sibling workstream;
  editing it would violate this task's hard constraints and risks a
  merge collision with in-flight work neither agent can see.
- **Renaming the `"crunchr"` plugin identifier to something generic.**
  Rejected: it's real, external, cross-file API surface (route gates,
  the plugin registry, the SPA), not internal vocabulary; renaming it
  requires a coordinated multi-file change this pass isn't scoped for.
- **Splitting `strivo-web` into two crates (CE02) instead of merging an
  optional Creator router.** Rejected: far larger blast radius (auth,
  CSRF, telemetry, settings all currently shared) for a problem the
  existing `server.rs:114-123` router-merge seam already solves at a
  fraction of the risk.
- **Publishing all 35 Creator crates to crates.io (CE04).** Rejected for
  now: forces per-crate semver/publish discipline before there's a
  release process to justify it, and reverses `publish = false` for a
  single-consumer (in-org) dependency that a git tag already serves.
- **Vendoring one repo's tree into the other (CE04).** Rejected: recreates
  the single-history coupling this ADR exists to remove.

## Update — CE01 continued, CE05 superseded (2026-09-07)

A follow-up pass closed most of what CE01 above left blocked, once
`routes/plugins.rs`, `routes/api.rs`, and `routes/licence.rs` were back in
scope (the concurrently-active sibling workstream referenced above had
gone quiet by then — re-verify a file isn't mid-edit elsewhere before
repeating this):

- **`src/licence/gate.rs`'s `PRO_PLUGINS`** is gone from core.
  `is_pro_plugin`/`is_entitled` now take the Pro plugin set as a
  parameter; `routes/plugins.rs` supplies its own `PRO_PLUGINS` const at
  the single `gate_pro`/`pro_entitled` choke point, and `routes/chat.rs`
  passes that same const under `creator` or an empty slice under PVR.
  This is CE06's recommendation, done as a mechanical parameter change
  rather than a relocation of `is_entitled` itself.
- **`src/pipeline/templates.rs`** (`creator_intelligence`,
  `creator_publish`, the `"crunchr"` dispatch identifier) moved to
  `crates/strivo-plugins/src/pipeline_templates.rs` unchanged apart from
  import paths. Its two callers (`CrunchrPlugin` and `routes/api.rs`'s
  `pipeline_run`) were mechanical one-line redirects.
- **`AppConfig.crunchr`/`AppConfig.archiver`** are gone from core,
  replaced by `AppConfig.extensions: BTreeMap<String, toml::Value>`
  (`#[serde(flatten)]`) plus `plugin_section`/`plugin_section_aliased`/
  `set_plugin_section` accessors. `CrunchrConfig`/`CrunchrAnalysisConfig`/
  `ArchiverConfig` moved to `strivo-plugins` (`crunchr::types`,
  `archiver::types`). `routes/api.rs`'s ~15 direct `cfg.archiver.*` field
  accesses became `cfg.plugin_section("archiver")` /
  `cfg.set_plugin_section("archiver", &a)` pairs — mechanical, one call
  site at a time. An existing `config.toml`'s `[crunchr]`/`[archiver]`
  sections (and the legacy `[sloptube]` alias) still round-trip; see
  `tests/config_extensions_roundtrip.rs`.
- **`strivo-core`'s `creator` feature is deleted** (superseding CE05's
  "must survive" conclusion above, which was conditioned entirely on the
  typed config fields this update removed). `creator = []` is gone from
  the root `Cargo.toml`, and the `"strivo-core/creator"`
  feature-forwarding is gone from `strivo-bin`/`strivo-web`'s own
  `creator` features and from `strivo-plugins`' `strivo-core` path
  dependency. Both editions build and their full test suites pass.
- **One deliberate exception remains**, documented in place:
  `AppConfig::post_pull_markers` still reads
  `extensions["crunchr"]["enabled"]` and returns the literal
  `.crunchr-auto"` marker name, because the daemon's bulk-download path
  (`src/recording/bulk.rs`) calls it from inside core with no plugin
  loaded to ask what markers it wants. Generalizing further would either
  change observable behavior (any enabled extension section producing a
  marker file, when today only Crunchr's does) or require a marker
  registration callback threaded through daemon startup and the
  bulk-download command channel — a larger structural change than a
  config-refactor pass. `grep -ri "crunchr|archiver" src/` is down to 7
  hits, all inside this one function's implementation and doc comment.
- **Not touched in this update:** CE02 (`strivo-creator-web` split), CE03
  (`spa.js` module split), CE04 (distribution mechanism) — all remain
  decisions-only, unexecuted, exactly as originally recorded above.

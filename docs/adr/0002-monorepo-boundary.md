# 0002. Stay a monorepo; enforce the edition boundary in-tree

Status: Accepted
Date: 2026-09-07
Supersedes: [0001](0001-creator-edition-repository-split.md)

## Context

ADR 0001 proposed splitting Creator Edition into its own repository,
consuming `strivo-core` as a pinned git dependency, once the PVR repo's
Creator vocabulary was cleaned out of core (CE01) and CE02–CE06 executed
the split's mechanics (a `strivo-creator-web` router crate, a modular SPA
build, a distribution mechanism, and a relocated entitlement gate). Its
Status was `Proposed`, and CE02/CE04/CE06 — three of the four items whose
acceptance criteria assumed the split — never executed: each returned
`open` in the 2026-09-06 web-surface audit, correctly, because "record a
decision" is not "make the change."

Two things changed since:

1. **CE01 finished.** A follow-up pass (recorded as the "Update" section
   appended to ADR 0001) closed out the config-typing and pipeline-naming
   work CE01 left blocked: `AppConfig.crunchr`/`.archiver` are gone from
   core, replaced by an untyped `extensions: BTreeMap<String, toml::Value>`
   table; `PRO_PLUGINS` left `src/licence/gate.rs` for a caller-supplied
   parameter; `strivo-core`'s own `creator` Cargo feature was deleted
   outright, because nothing left in core needs to conditionally compile.
   `grep -ri "crunchr|archiver" src/` is clean except for one deliberately
   documented, data-driven exception in `AppConfig::post_pull_markers`.
   This is the load-bearing precondition ADR 0001 named for either path —
   split or stay — and it is now actually true, not just planned.

2. **The operator made the call.** Upstream separately put Creator
   Edition's release paths on an explicit hold (commit `90711f3`,
   "security: hold creator edition release paths"): no Creator binary,
   Docker image, licence service, activation, trial, or purchase path is
   available or supported, and the README's "Release boundary" section
   says so in plain language. Given that hold, and given the actual
   engineering cost a split would add (a second CI pipeline, a pinned
   cross-repo version contract per CE04, a contributed-router crate per
   CE02, duplicated auth/CSRF/telemetry/settings surface or a third shared
   crate to avoid duplicating it) against a product that isn't shipping a
   Creator release regardless, the operator decided: **StriVo stays a
   monorepo.** The condition attached is binding: Creator functionality
   must be cleanly divided, gated, and fully invisible in a PVR build,
   starting now — not after some future split.

This ADR records that decision, supersedes 0001, and states the trade-off
0001's own split rationale exists to answer.

## Decision

**StriVo remains a single repository and a single Cargo workspace.**
Creator Edition is not extracted. The Cargo-level seam ADR 0001 already
found sound — all Creator crates `optional = true`, reached only through
the `creator` feature, excluded from `default-members` — stays exactly as
is; there is no second repository, no git dependency, no pinned
cross-repo version contract.

The condition that makes this acceptable is binding, not aspirational:

- **Cleanly divided** — every Creator-only capability (routes, handlers,
  state, background tasks, config types, CLI text) has one unambiguous
  home behind the `creator` Cargo feature or an equivalent runtime gate,
  with no code path that silently serves both editions by accident.
- **Gated** — `#[cfg(feature = "creator")]` (or, for the one piece of
  entitlement plumbing that stays generic in core, an explicit runtime
  check with no compile-time Creator dependency) is the mechanism, and
  it must be *complete*: every route, handler, module, and CLI string
  that names a Creator concept is behind it, not just the ones an
  earlier audit happened to enumerate.
- **Fully invisible in a PVR build** — a PVR binary must not expose
  Creator routes, Creator CLI text, Creator config sections, or Creator
  background behavior to a user or operator who never opted into
  `--features creator`. "Invisible" here means unreachable and
  non-functioning by construction, not merely undocumented.

This reframes what CE02/CE04/CE06 mean under a monorepo. Their acceptance
criteria were written for a repository split and are re-scoped, closed,
or left open on their own record (see the 2026-09-07 revision of
`docs/audits/2026-09-06-web-surface/MANIFEST.json`):

- **CE04** (distribution mechanism) is superseded outright. "The Creator
  repo builds from a clean clone against a released PVR core at a pinned
  version" cannot happen and should not be attempted — there is no second
  repo to clone. The `path = "../…"` dependencies CE04 flagged as
  provisional are simply correct for a monorepo; no code changes as a
  result of this ADR.
- **CE02**'s acceptance inverts. "No `cfg(feature = "creator")` remains
  in the PVR repo's web crate" assumed the feature would disappear along
  with the crate that used it. Under a monorepo, `cfg` gating *is* the
  division mechanism — removing it would remove the boundary, not
  strengthen it. The acceptance bar becomes: the gating that exists is
  *complete and correct*, with nothing Creator-only reachable in a PVR
  build. That was checked empirically for this ADR (see Consequences)
  and is not something an ADR can assert on its own.
- **CE06** (entitlement) similarly inverts: `is_entitled`, `gate_pro`,
  the Pro plugin list, and `routes/licence.rs` may stay in-tree — the
  question is whether they are gated and inert in a PVR build, not
  whether they've moved to a different repository.

## Consequences

**What this buys:** one CI pipeline, one version number, one set of
shared infrastructure (auth, CSRF, session handling, telemetry) with no
duplication or third shared crate to invent, and no cross-repo version
skew to manage between a PVR core release and a Creator Edition that
consumes it. The engineering cost ADR 0001 priced for CE02/CE04 (a
contributed router crate, a pinned git dependency, matrix CI across
tagged releases) is avoided entirely.

**What this gives up, stated plainly:** in a monorepo, Creator Edition's
source stays readable in a public repository. Anyone who clones StriVo
can read every Creator plugin, the entitlement/licence machinery, and the
plugin catalog, whether or not they ever run `--features creator`. Gating
is a **build-time and runtime property**, not a **distribution property**
— the `creator` feature controls what a *compiled artifact* does, not
what a *reader of the source tree* can see. A repository split, had it
been executed, would have made Creator Edition's source itself
unavailable to a PVR-only clone; staying a monorepo forecloses that. If
"Creator source must not be publicly readable at all" is ever a hard
requirement, this decision does not satisfy it and would need to be
revisited (see Roads not taken).

**Verification performed for this ADR** (full commands and output are in
the delivery report and the manifest's closure evidence, not repeated
here): every `#[cfg(feature = "creator")]` site in `crates/strivo-web`
was enumerated; `routes/plugins.rs` is gated at the module level and
unreachable in a PVR build; `routes/licence.rs` — previously mounted
unconditionally — is now gated behind `creator` the same way, since
entitlement/Pro/tier is a Creator Edition concept the PVR edition has no
notion of; the release PVR binary was built and swept with `strings` for
`crunchr`, `viewguard`, `insights`, `archiver`, `licence`, `trial`,
`activate`; `strivo --help` and every subcommand's `--help` were checked
for Creator vocabulary, and `strivo doctor`'s tool-purpose text and the
`pull`/`chapter` CLI help text were found to leak "Crunchr" by name and
reworded generically; the daemon's 72h licence-refresh background task
was found to spawn unconditionally in every edition regardless of
whether a licence backend is configured, and was changed to spawn only
when `STRIVO_LICENCE_URL` is actually set, so a default install (PVR or
Creator) starts no background task and makes no network call.

**One gap was found and is explicitly NOT closed by this ADR**, because
it sits outside Rust and outside this workstream's editable surface
(`crates/strivo-web/assets/` is owned by the concurrent CE03 workstream):
the PVR-served SPA bundle's plugin catalog module
(`crates/strivo-web/assets/spa/020-pvr.js`) still defines every Creator
plugin's name, route, and marketing description, and `spa.css` still
ships all Creator styling unconditionally (CE03's own tracked remainder).
These entries are functionally inert — nothing in a PVR build ever
populates the `plugins` list they key off of — but they are not
*invisible*: a PVR user's browser downloads Creator plugin names and
descriptions in the served JS regardless. This is a real, measured
contradiction of this ADR's "fully invisible" condition, tracked under
CE03, not fixed here, and worth operator attention before the
invisibility condition can be called fully met end-to-end.

## Roads not taken

- **Executing the repository split (ADR 0001's original recommendation).**
  Rejected now that CE01 is done and the operator has decided: the
  engineering cost (CE02's contributed router crate, CE04's pinned git
  dependency and matrix CI, CE06's relocated entitlement gate) buys
  distribution-level source privacy StriVo does not currently need, at
  the price of duplicated shared infrastructure or a third crate to hold
  it. If "Creator source must not be publicly readable" ever becomes a
  hard requirement, this is the road to revisit — reopening it should
  start from CE01's now-clean core rather than from ADR 0001's original,
  partially-blocked state.
- **crates.io publishing for the 35 Creator crates (CE04).** Moot under a
  monorepo — there is nothing to publish to. Retained here only as a
  pointer to ADR 0001's original reasoning (forces per-crate semver
  discipline before a release process exists to justify it), which still
  applies if the split is ever revisited.
- **Vendoring instead of a git dependency (CE04).** Moot for the same
  reason; ADR 0001's objection (recreates the single-history coupling a
  split exists to remove) is now moot too, since there is deliberately
  one history.
- **Splitting `strivo-web` into PVR-web and Creator-web crates (CE02).**
  Still rejected, for the reason ADR 0001 gave: far larger blast radius
  (auth, CSRF, telemetry, settings all currently shared) than the
  existing router-merge seam at `server.rs` requires, and now doubly
  unnecessary since there is no second repository for a
  `strivo-creator-web` crate to live in.
- **Leaving `routes::licence` mounted unconditionally, relying only on
  the entitlement gate's fail-closed behavior for "inert enough."** This
  was the state going into this ADR: `routes/licence.rs` was merged into
  the shared router with no `cfg`, on the reasoning that `backend_url()`
  hardcoded to `None` and `gate::entitled()` gated to
  `cfg!(debug_assertions) && STRIVO_LICENCE_URL` made it harmless. A
  dedicated test (`s08_always_routes_require_auth`'s `ALWAYS_ROUTES`
  table) documented this as deliberate, "both editions mount these."
  Rejected as insufficient once "fully invisible" was made the explicit
  bar: *inert* is not *invisible* — the routes were still reachable and
  still returned tier/entitlement JSON to any authenticated PVR user.
  Moved behind `#[cfg(feature = "creator")]` instead, matching
  `routes::plugins`.
- **Leaving the daemon's licence-refresh task spawning unconditionally
  and relying on its internal per-tick check.** The task used to spawn on
  every daemon start in every edition, and only checked
  `STRIVO_LICENCE_URL` on each 72h tick before doing anything. Rejected
  once measured directly: a live-but-idle background task in every PVR
  daemon is not "fully invisible" even though it was already a no-op by
  default. `spawn_refresh_loop` now checks the same env var before
  spawning at all, so the default case is zero background task, not one
  that happens to never fire.
- **Reintroducing a `creator` feature to `strivo-core` to gate the
  licence-refresh spawn at compile time.** Considered as an alternative
  to the env-var-before-spawn fix above, since `src/daemon.rs`'s single
  `run_with_plugins_at` entrypoint is shared by both editions with no
  edition signal available inside core. Rejected: `strivo-core`'s
  `creator` feature was deliberately deleted by CE01 once nothing else
  needed it, re-adding it for one call site risks reopening the Cargo
  feature-unification trap CE01's own history warns about, and it would
  require a public API change to `run_with_plugins_at`'s signature
  (threading an edition flag from `strivo-bin` through core) that this
  pass did not have standing to make unilaterally. Flagged for a
  deliberate follow-up decision rather than fixed here.

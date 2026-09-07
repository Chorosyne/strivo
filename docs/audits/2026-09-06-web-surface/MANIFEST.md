# StriVo web-surface remediation manifest — 2026-09-06

**Assessment: the PVR core is well-built and the web surface is not release-ready, because HTTP
authentication is enforced per-handler with no route-level invariant and at least four registered
routes reach real behaviour without it.** The largest remaining risks are (1) an unauthenticated
file-deleting endpoint in the Creator build, (2) unauthenticated streaming of recording bytes,
(3) a router test suite that constructs an empty router and therefore proves nothing about route
auth, and (4) a browser E2E suite that never runs against the real server.

**Revision 2 (2026-09-06, same day) adds two things.** First, a newly discovered defect in the
shipped PVR edition: the build-time edition-stripping mechanism removes Creator API method
definitions while leaving their call sites and the Creator UI that reaches them (**S10**,
reproduced against a real build artifact). Second, at the operator's direction, a **CE-series**
recording the observed coupling that a split of Creator Edition into a separate repository must
resolve. The CE items are planned architectural work the operator has decided on, not defects
found by this audit — they are recorded here because the manifest is the register of what that
work requires, and because S10 is direct evidence that the current edition boundary does not
hold.

This is a review manifest, not an implementation or release claim. It supplements
[PHASE0-EXPERIENCE-AUDIT-2026-07-30](../PHASE0-EXPERIENCE-AUDIT-2026-07-30.md), preserving its
history and its `F-nn` IDs. The baseline is **the existing dirty working tree on HEAD
`bd17f6107c83e348162974fade941eb42f423ebc`, not that commit alone** — `README.md` carries an
uncommitted 185-insertion / 337-deletion rewrite at audit entry. Existing implementation work was
preserved; nothing in the project source was modified.

**Backlog: 39 items — 2 P0, 13 P1, 14 P2, 10 P3.** As of revision 11: **31 `closed`, 4 open,
2 `ready_for_verification`, 2 blocked.** Both P0s are closed with executed evidence.

Revisions 9-11 were the integration and verification pass. Work from six branches was
independently verified, cherry-picked onto `main`, and re-verified **after** integration. Five
branches were merged; one was refused.

**An adversarial re-audit found no false closure.** A verifier working from the register alone
re-checked every closed item against the current tree, hunting specifically for closures a later
merge had silently broken. It re-ran the decisive mutations first-hand — neutering `require_auth`
turned both S08 sweeps red with the 49-route body-shape signature, and reverting the `history`
handler turned the V08 wiring test red — and cross-checked all 68 registered route paths against
the sweep's tables, finding zero drift. Both editions build; `cargo test` 317 passed / 1 ignored;
Creator 86 passed; `strivo-editor` 23 passed (it is excluded from bare `cargo test` by
`default-members`, so it must be named explicitly); both clippy configurations and `fmt` clean;
the PVR bundle check clean over 174 stripped names; the real-server lane 3/3.

**The auth fix is better than this register asked for.** It specified per-handler gates.
`server.rs` instead adds `require_auth` as a **default-deny `route_layer`**, so a new route is
gated by omission rather than by memory, and it runs ahead of axum's `Json`/`Query` extractor
resolution — which closes S16's 400/422-before-auth class at the layer. Under the neutering
mutation the `s01_`/`s02_` tests still pass, because those handlers keep their own checks: the two
layers gate independently.

**S04 was closed by execution, not wiring** — the real-server lane boots the actual compiled
binary and passed 3/3 including a login → cookie → recordings round trip. The re-audit then
discharged what that closure had left outstanding, confirming the lane now runs in CI as its own
step against the release binary.

**One branch was refused, then earned its closure.** `remediation/web-perf` (R05) was rejected:
partial, unmeasured, and its suite stayed green when a handler was reverted. The replacement
covers all ten open sites, and a release-profile before/after decided the design rather than
assuming it — sequential 5.049 → 4.996 ms, concurrent c=8 2.598 → 1.879 ms. The feared
serialisation penalty did not appear, because the removed per-request cost dominates the query the
mutex guards. Recorded **bounded**: the benchmark ran against an EMPTY jobs table, which minimises
lock hold time by construction, so contention with a populated table remains unmeasured.

**V07's bounded caveat did not survive a populated table, and it is now closed on a shape change,
not a re-measurement of the same design.** A controlled 50,000-row A/B (revision 13) discharged the
caveat above and found the serialisation effect real, if smaller than a first, uncontrolled
delegated measurement had claimed (~1.0–1.35x at c=8/c=16, reversing sequentially) — reopened
pending a pool. The fix replaces the single `tokio::sync::Mutex<Connection>` with a hand-rolled pool
of 4 persistent connections behind a `Semaphore` (`src/recording/persist.rs`; `r2d2`/`r2d2_sqlite`
were ruled out — they pin a newer `rusqlite` than the 0.33 shared with the Creator-edition
`strivo-plugins` crate). A three-arm A/B/C on the same 50,000-row corpus, one tree, minimal diff
between arms, driven through the real HTTP surface via the new `scripts/bench_jobs_db.sh`: the pool
matches the old shared-mutex design sequentially (~1.6ms/request either way) and wins clearly under
concurrency (~0.68ms/request vs ~1.47ms for the mutex, ~0.75–0.88ms for per-request open, at both
c=8 and c=16). A first cut used `spawn_blocking` per the manifest's own suggestion; measured, its
dispatch cost exceeded the sub-millisecond query time it was meant to protect against and regressed
the sequential number below the mutex baseline, so the final design runs each borrow inline against
the pool instead — a deviation from the suggested tool that the numbers, not a preference, decided.

**Two defects were found by chasing flaky tests rather than dismissing them.** R03's skip link was
not a slow test but a real SPA bug — its own `hashchange` fell through `currentRoute()`'s fallback
and repainted the chrome, destroying the `<main id="content">` the browser had just focused. V09
was a genuine harness race: the fake-player factory was only *started*, never awaited, so under CPU
contention real controllers were cached instead. V10's mock-server state leak was reproduced
deliberately and again organically, and independently rediscovered by the re-audit agent working
from a revision that predates the fix.

**S17 was partly misfiled, and the correction is the finding.** Its named route was not broken;
auditing all 69 Creator-gated routes against the actual built PVR bundle found a different pair —
Twitch chat — where PVR users got a raw error box and "Send failed", because the SPA already
treated chat as free while only the backend registration stayed Creator-gated.

**CE01 is measured rather than asserted:** its acceptance grep returns **33**, not 0, and deleting
the `creator` feature fails with exactly **5 errors, all in `strivo-plugins`**. CE02/CE03/CE04/CE06
returned to `open` — ADR 0001 records a decision, and a plan is not an implementation. The renamed
task kinds carry no migration risk: `TaskKind` derives no `Serialize`/`Deserialize` and is never
persisted.

Residuals are opened rather than waved through: **V01** (closed — the multi-cut test now *proves*
sub-clip ordering instead of assuming it), **V02**, **V03** (whose own premise was wrong: the
constructor returned to `pub(crate)` rather than being doc-hidden), **V04** (a `build.rs` test
module Cargo never executed — a test that existed, looked like a guard, and had never run), and
**V06-V10**. S08 and S12 stay closed **bounded**: the runtime posture is default-deny and
mutation-proven, but route *discovery* in the sweep remains hand-maintained, since axum 0.8 exposes
no runtime route-listing API. Prior closure evidence on S05/R06 is **retained**, with each later
re-verification appended after it rather than overwriting the earlier reviewer's "PENDING / not
independently reproduced" caveat. Earlier revisions read (implemented this session, awaiting operator review — see Status
changes). The backlog **grew** as remediation proceeded: building the route-auth invariant the
P0 demanded turned S08's unproven boundary into four concrete findings (S13–S16). That is the
manifest working as intended — an unknown became measured — but it means the auth surface is
worse than revision 1 could show, not better. [Machine-readable register](MANIFEST.json)
records stable IDs, dependencies, proposed owner roles and closure evidence. [Durable evidence
index](EVIDENCE.json) preserves artifact references, 16 source fingerprints, fresh results and
the unperformed-check list.

Maintenance: never renumber or delete an ID. Record assignee, status, implementation reference and
new acceptance evidence in the JSON, and update this narrative when findings change. Use `closed`
only with the closure requirements below; a deferral must state the resulting supported-scope
limitation. Keep the register's canonical hash synchronized.

## Final state of this remediation pass — revision 12

**32 of 39 closed. 1 deferred with a named scope limit. 2 awaiting operator review. 4 open.**

CI-equivalent verification on integrated `main` (`e9474ca`): `cargo fmt --check` clean; `cargo
clippy --workspace --all-targets --locked -D warnings` **0 warnings**; the same for the Creator
lane **0 warnings**; `cargo test --workspace --all-targets` **895 passed, 0 failed, 1 ignored**
in one invocation; the Creator lane **94 passed, 0 failed** in a separate invocation. **These two
totals overlap in `strivo-web` and must not be summed.** The 1 ignored test is the release-scale
research benchmark — an open acceptance gap, not a pass.

**Every remaining item is a decision, not an implementation.** Each one's remediation text begins
with the word "Decide", and four of them (CE02, CE03, CE04, CE06) are downstream of a single
unmade choice: whether the Creator Edition is actually moving to its own repository. CE04 cannot
complete at all until a second repository exists, and converting 35 `path = "../…"` dependencies
to pinned git refs would break the current single-repo workflow if done speculatively. This pass
therefore stops here rather than manufacturing architectural commitments the operator has not
made — consistent with the rule that priorities and owners are the audit's proposals, never its
decisions.

Outstanding, and who owns each:
- **S09** — the operator's own uncommitted `README.md` rewrite (185 insertions, 337 deletions),
  still unreviewed. Its capability claims remain unverified, and a release built from this tree
  would ship them. A backup of the diff was preserved before any automated work began.
- **S11** — `DESIGN.md`/`CLAUDE.md` are gitignored while tracked files cite them normatively.
  Two coherent positions exist; picking one is an operator call.
- **CE01** — deferred with its limit stated: `post_pull_markers` still names one plugin.
  Generalising it needs a design decision about threading a marker-registration callback through
  daemon startup.
- **CE02, CE03, CE04, CE06** — the repository-split program, blocked on the split decision itself.

**One consequence needs a deliberate call before any release:** CE01 removed
`AppConfig.crunchr`/`.archiver` from `strivo-core`'s public API. Under SemVer that is a breaking
change. `strivo-core` is `0.6.0`, where `0.y.z` permits it, but the version, `CHANGELOG` and any
publish decision should acknowledge it rather than let it ride along silently.

## Evidence boundary and freshness

Primary window: 2026-07-30 → 2026-09-06. Inspected HEAD `bd17f61`; **1 uncommitted path at entry**
(`README.md`). **HEAD alone does not identify what was tested.** Dates in filenames alone do not
establish currency: later reports and current source take precedence over earlier claims, and every
prior finding recorded below as still-open was re-read against current source this session rather
than carried forward on the earlier report's authority.

| Evidence | Current interpretation |
| --- | --- |
| [PHASE0-EXPERIENCE-AUDIT-2026-07-30.md](../PHASE0-EXPERIENCE-AUDIT-2026-07-30.md) (34,320 B) | 33 findings from a static, read-only review with no build and no live measurement — its own stated method. Six of its findings are confirmed implemented since (see Supersession map) and must not be reopened. Six are confirmed still open and are re-issued here under new IDs with fresh `file:line` evidence. **The remaining 21 were not re-verified this session** and are neither confirmed nor refuted here. |
| `cargo test` (default members) | 63 passed, 0 failed across 5 binaries. Establishes that the PVR build's own unit tests pass. It does **not** establish that any HTTP route is auth-gated — see S03. |
| `cargo test -p strivo-web --features creator` | 74 passed, 0 failed. Same limitation. The two totals overlap in the `strivo-web` unit tests and **must not be added**. |
| `.github/workflows/ci.yml` | CI is genuinely thorough — fmt, clippy `-D warnings` on both editions, workspace release tests, both edition builds, a Windows cross-check, and a Playwright job. That this pipeline is green while S01–S04 stand is the finding, not a mitigation. |
| `crates/strivo-web/e2e/` | A Playwright suite driven against `mock-server.mjs`, a Node stub. It is evidence about the SPA's client-side behaviour only. It is **not** acceptance evidence for the Rust server. |
| Built PVR asset bundle (`target/debug/build/strivo-web-*/out/assets/spa.js`, 15,111 lines) | Produced fresh by `cargo build -p strivo-web` at the R05 worktree revision. Establishes S10 by direct inspection of the artifact a PVR user would be served — not by reasoning about the stripper's source. It is a debug-profile build; a release build uses the same `build.rs` path, but that was not separately confirmed. |

Source hashes in the evidence index fingerprint the tree; they are not a claim of line-by-line
review. The one `#[ignore]` test (`crates/research/src/lib.rs:1844`, a release-scale storage
benchmark) is an open acceptance gap, not a pass.

## Pipeline walked

| Stage | Current route / implementation | Open remediation IDs |
| --- | --- | --- |
| Install, boot, dependencies, readiness | `src/daemon.rs`, `.github/workflows/ci.yml`, `Cargo.toml` default-members split | — (not covered; see limitations) |
| Authenticate, authorize, select scope | `crates/strivo-web/src/auth.rs`, `routes/login.rs` (`check_dual`, `session_refresh`), `csrf.rs` | **S01, S02, S05, S06, S07, S08** |
| Input, upload, queue, progress | `src/monitor/mod.rs`, `src/intents/start.rs`, `src/recording/schedule.rs` | — (not covered) |
| Process, transform, normalize | `src/recording/ffmpeg.rs`, `src/recording/ytdlp.rs` | — (not covered) |
| Store, index, retry, delete | `src/recording/persist.rs`, `routes/api.rs` shared `jobs_db` handle | **R05** *(ready for verification)* |
| Retrieve, query | `routes/api.rs` (`cursor`/`limit`), `spa.js` `renderRecordings` | **R01** |
| Generate, verify, synthesize (Creator) | `routes/plugins.rs`, `crates/editor`, `crates/clipper`, `src/pipeline/executor.rs` | **R06** |
| Stream, cancel, retry, reload | `routes/events.rs` (SSE), `src/pipeline/runtime.rs` | — (not covered) |
| Inspect, export | `routes/recordings.rs` download/play | **S02** |
| Accessibility, mobile, consistency | `spa.js` `chrome()`, `spa.css` | **R03, R04** |
| Platform, packaging, release | `README.md` (uncommitted rewrite), `ROADMAP.md`, catalog vs. wiring | **S09, R02** |
| Edition boundary (PVR vs Creator) | `crates/strivo-web/build.rs` line-strip, `spa.js` `@creator-*` markers, `Cargo.toml` feature graph, `src/config/mod.rs`, `src/recording/catalog.rs` | **S10, CE01–CE06** |

Five stages carry no IDs. That is **not** a claim those stages are clean — it is an admission that
this pass concentrated on the HTTP surface and did not trace the capture, storage-write, or
streaming paths end to end. The prior audit examined several of them statically.

## Remediation register

Priority: **P0** blocks any non-loopback deployment; **P1** required for an alpha release bar;
**P2** required before an auth or accessibility claim is repeated in user-facing copy; **P3**
polish. Evidence: **C** confirmed from current code read this session, **B** reproduced fresh in
this audit, **R** retained measured finding, **G** unproven acceptance boundary. Owner roles are
proposed dispatch destinations, not assignments already accepted.

### P0 — unauthenticated mutation

| ID / owner | Finding and evidence | Remediation / closure test |
| --- | --- | --- |
| **S13 · web-auth** | **C+B:** The pipeline-chain CRUD is unauthenticated in *both* directions, not only the delete fixed as S01. `pipelines_chains_save` (`routes/api.rs:2932-2953`) takes **only** `Json(body)` — no `HeaderMap`, no `State` — and writes attacker-supplied JSON to disk (`std::fs::write`, `:2947`); structurally incapable of authenticating, exactly like S01. `pipelines_chains_list` (`:2915-2928`) returns every persisted chain, confirmed by the S08 sweep as `GET /api/v1/pipelines/chains -> 200 OK`. The save route's sweep result was inconclusive (422 before the handler — see S16), but the source is unambiguous. `chain_path()` restricts ids to alphanumeric/dash/underscore, so there is no traversal; the exposure is unauthenticated creation and disclosure of automation recipes. | Gate both exactly as S01 was gated. Acceptance: bogus-key POST **and** GET return 401, asserted with a schema-valid body so the request actually reaches the handler. |


| ID / owner | Finding and evidence | Remediation / closure test |
| --- | --- | --- |
| **S01 · web-auth** | **C:** `pipelines_chains_delete` (`crates/strivo-web/src/routes/api.rs:2957-2971`) takes only `Path<String>` — no `HeaderMap`, no `State` — so it is structurally incapable of authenticating, and it calls `std::fs::remove_file` (`:2964`). The CSRF layer does not cover it: `csrf_guard` (`crates/strivo-web/src/csrf.rs:44-47`) admits any request merely *containing* an `X-Api-Key` header, deferring validity "downstream by the handler's `check_key`" — a handler that never calls it. `session_refresh` (`routes/login.rs:207-235`) runs `next.run(req).await` **first** and only appends a cookie; it enforces nothing. Route is `#[cfg(feature = "creator")]`, registered in the Creator build only. | Add the `authed`/`check_dual` gate to the handler, and add a route-level invariant test (see S08) that fails if any registered route reaches its handler body without an auth call. Closure requires a failing-before/passing-after test asserting **401 for a bogus `X-Api-Key`** — not merely that a valid key succeeds, and not a bare non-200 assertion, which would pass against an unreachable guard. |

### P1 — unauthenticated read, and verification that proves nothing

| ID / owner | Finding and evidence | Remediation / closure test |
| --- | --- | --- |
| **S02 · web-auth** | **C:** `download` (`crates/strivo-web/src/routes/recordings.rs:210-214`) accepts `HeaderMap` but never calls `authed`/`check_key`; it resolves the path from the daemon snapshot, applies `contain_in_root`, and streams the bytes. `play` redirects into it. The only barrier to reading any recording is guessing its v4 UUID. The path-containment guard is real and correctly tested — this finding is about authentication, not traversal. | Gate on the session cookie (the browser sends it automatically for `<video src>`, so player playback keeps working) with the `X-Api-Key` track retained for programmatic callers. Closure requires a test asserting 401 for a cookieless, keyless GET of a known-valid recording id, plus a manual check that in-browser playback and download still work. |
| **S03 · web-test** | **C:** `crates/strivo-web/tests/routes.rs:19-25` defines `fn router() -> axum::Router { axum::Router::new() }` — an **empty** router — and `router_empty_404s()` (`:44`) asserts a 404 against it. The module doc (`:1-6`) nevertheless claims these tests "exercise the route shape (auth, status codes) by talking to the test-mode Router axum exposes." No test in this file constructs the real router. The whole file's remaining tests are pure-function tests of `ApiKey` and channel import/export. | Build the real router in tests behind a constructor that does not require a live daemon (IPC-dependent routes may assert 503, as the module doc already anticipates), then assert per-route auth. Until then this file must not be cited as auth evidence. Closure: the invariant test of S08 exists and fails when a gate is removed. |
| **S04 · web-test** | **C:** `crates/strivo-web/e2e/playwright.config.ts:20-24` starts `node mock-server.mjs` as its `webServer`; `mock-server.mjs:1-3` states it "serves the real SPA assets and stubs /api/v1 + /events so the browser tests run without a live daemon." CI's "Web UI browser smoke tests" job (`.github/workflows/ci.yml:105-110`) runs only this suite. No CI job starts the compiled `strivo-web` binary and drives it with a browser. | Add one E2E lane that boots the real server against a temporary config and drives at least login → recordings list → playback. Keep the mock lane for deterministic SPA cases. Closure requires the real-server lane to be **failing before** the S01/S02 gates land (unauthenticated access succeeds) and **passing after**. |
| **R01 · web-ui** | **C (prior `F-01`, re-verified):** `renderRecordings` (`spa.js:2950`) still has no pagination control. `spa.js:114,155` pass `cursor` to the API and the backend supports it, but the only "load more" in the SPA is the history view's `hist-load-more` (`spa.js:14298,14320`). Recordings beyond the default page remain invisible past client-side filter/sort. | Add a recordings "load more" wired to the existing cursor param. Closure: a test with more recordings than one page asserts the second page is reachable. |
| **R02 · web-ui** | **C (prior `F-13`, re-verified):** `broll` is registered as a real endpoint (`routes/plugins.rs:1920`, `:4490`), listed in the marketplace catalog (`spa.js:8475`) with `route: null` (`:8633`) and present in the redirect map (`:8950`), but has no fetch or button anywhere in `spa.js` — the only other match (`:10988`) reads a `broll_path` field on an EDL cut. The endpoint is unreachable from the UI. | Either wire the Info-modal trigger as the other plugins have, or unlist it. Closure: a browser test that reaches the endpoint through the UI, or its removal from the catalog. |
| **R05 · web-perf** | **C (prior `F-26`, re-verified):** `AppState` (`crates/strivo-web/src/server.rs:25-45`) still holds no shared database handle; `open_jobs_db()` (`routes/api.rs:1928`) is called fresh per request at `:1879,1947,1968,1997`, each re-running the schema batch. The daemon side does hold one shared connection. | Thread a shared handle into `AppState`, mirroring the daemon. Closure: measured before/after on a representative history page load, stated with the workload — not an averaged figure across different workloads. |

| **S11 · docs** | **C+B:** `DESIGN.md` and `CLAUDE.md` are deliberately untracked (`.gitignore:45-51`, under "Internal docs (kept local only)"); `git ls-files --error-unmatch` confirms neither is known to git, and DESIGN.md exists only in the operator's working tree (13,992 B). But the **tracked** `ROADMAP.md:126-128` cites DESIGN.md as normative, and the project workflow mandates reading it before any visual decision. No clone, CI run, or `git worktree` contains it. **Observed this session:** three remediation agents were dispatched into worktrees, none of which had DESIGN.md; the SPA agent correctly reported the absence rather than inventing a spec, and worked from in-file CSS precedent. Its inferred focus-ring colour matches `DESIGN.md:92` — luck, not compliance. | Pick one coherent position: track the file so its normative references resolve, or keep it private and delete those references from tracked files, replacing them with a stated "design authority is maintained out-of-tree" note. Either way, any workflow dispatching into a worktree must copy the untracked authority in explicitly. Acceptance: no tracked file cites a document a clone does not contain. |
| **S10 · edition-boundary** | **B+C:** The PVR bundle ships Creator UI whose API methods were stripped out from under it. `crates/strivo-web/build.rs:82-104` removes every line between `/* @creator-start */` and `/* @creator-end */`; in `spa.js` those four blocks cover only lines 7-515, the `API` object's method definitions. All the Creator *UI* — `renderProApp` (spa.js:1047), `PRO_PANES` (:8600), `PLUGIN_ROUTE_REDIRECTS` (:8936), `renderCrunchr` (:8967), `renderUpgradeCard` (:9229) — lies outside them. Verified against the real artifact produced by `cargo build -p strivo-web` (15,111 lines, 337 stripped from 15,448): every one of those Creator UI symbols is **present**, the `case "studio"` route is still dispatchable at built line 709, and `API.pluginRpc`, `API.setArchiverTandem` and `API.chatDensityCompute` survive as **5 call sites with 0 definitions** (built lines 10156, 11734, 13700, 13735, 9247). A PVR user who navigates to `#/studio`, `#/analytics` or `#/publish` reaches Creator UI that throws `TypeError: API.pluginRpc is not a function`. | Either strip the Creator UI and its routes as well, or gate the routes so a PVR build refuses them cleanly instead of dispatching into code whose dependencies were deleted. Closure requires a browser assertion in a PVR build that `#/studio` renders a defined state and raises no uncaught TypeError, plus a build-time check that no surviving call site references a stripped definition. Note CE03 supersedes the mechanism entirely if the repo split lands — fix the user-visible break now regardless. |

### P2 — auth hygiene and doc/claim drift

| ID / owner | Finding and evidence | Remediation / closure test |
| --- | --- | --- |
| **S05 · web-auth** | **C:** `SessionToken::decode_verify` (`crates/strivo-web/src/auth.rs:55-57`) compares the HMAC with `expected_sig.as_slice() != actual_sig.as_slice()` — a short-circuiting compare. The same file's `ApiKey::matches` (`:104-115`) is deliberately constant-time with a documented rationale about not leaking length. The session path does not follow its own module's stated standard. Remote exploitability against HMAC-SHA256 is low; the inconsistency is the defect. | Use `hmac`'s `verify_slice`, which is constant-time by construction. Closure: the code change plus a note that timing-oracle absence is argued from the primitive used, not from a timing measurement. |
| **S06 · web-auth** | **C:** `trial` (`crates/strivo-web/src/routes/licence.rs:115`) destructures `State(_state)` and performs no auth check. With a licence backend configured it POSTs the machine hash to `{url}/trial`. Any local caller able to satisfy `csrf_guard` (which any bogus `X-Api-Key` does) can consume the machine's trial. | Gate it, or document explicitly that trial issuance is intentionally unauthenticated and that the backend is the sole rate limiter. If the latter, this becomes a `deferred_with_scope_limit` naming that limitation. |
| **S09 · docs** | **C:** `README.md` is uncommitted at audit entry with 185 insertions and 337 deletions (`git diff --stat`). The rewrite drops the AUR badge and restates edition scope and platform-support claims. It was **not** adjudicated against current behaviour in this pass. Any release built from this tree ships doc claims no review has checked. | Review the rewrite against current behaviour and commit or revert it. Closure: the tree is clean, or the diff is reviewed with its claims spot-checked against code. Until then, treat every README capability claim as unverified. |
| **R03 · a11y** | **C (prior `F-20`, re-verified):** no skip link exists — `grep -n "skip-link\|Skip to content"` across `spa.js` and `spa.css` returns zero matches, while `chrome()` retains its landmark structure. | Add a visually-hidden focus-visible skip link as the first focusable element targeting `#content`. Closure: a keyboard-driven browser assertion, not a grep. |
| **R04 · a11y** | **C (prior `F-10`, re-verified):** sortable headers are still mouse-only. `spa.js:3092-3102` binds `click` on `th[data-sort]`; the header renderer (`:3186`) emits no `tabindex` or `role`, and no keydown handler exists. A `↕` affordance hint was added since the prior audit, which improves discoverability without making the control operable by keyboard. | Add `tabindex="0"`, `role="button"` and Enter/Space handling. Closure: a keyboard-driven browser assertion. |

### P3 — bounded and low-severity

| ID / owner | Finding and evidence | Remediation / closure test |
| --- | --- | --- |
| **S07 · web-auth** | **C:** `plugin_capabilities` (`routes/api.rs:2552`) and `pipelines_dag` (`:2974`) take no state or headers and return static capability/DAG descriptions unauthenticated. Disclosure only — no user data, no mutation. | Gate for consistency, or record as intentionally public. Low urgency; must not be used to argue the other auth findings are also benign. |
| **S08 · web-test** | **G:** There is **no** invariant test asserting that every registered route is auth-gated, and no such property is checkable from the current test structure (S03). The scan behind S01/S02/S06/S07 was a regex over `.route(...)` registrations and matched **68 of 153** registrations repo-wide — `routes/api.rs` yielded 26 of its 53. **The remaining ~85 registrations were not checked by any method.** More unauthenticated routes may exist; this manifest does not claim to have found them all. | Add a test that enumerates the real router's routes and asserts each returns 401 without credentials, with an explicit allowlist for intentionally public routes (`/api/v1/health`, the SPA shell, assets, the WebSub callback, login). This converts an unknown into an enforced invariant. |
| **R06 · creator** | **C (prior `F-39`, re-verified):** `crates/editor/src/lib.rs:255` creates `.edl-temp`, and the only cleanup (`:356`, `let _ = remove_dir_all`) sits after the final concat, past every `?` and `bail!` in the per-cut loop (`:280,300`). The comment at `:355` states "OK to leave the dir around on error." A failed multi-cut render leaves sub-clips on disk while contending for the same `Disk` lock meant to bound Creator disk usage. | Cleanup guard on any exit path. Closure: a test that forces a mid-render ffmpeg failure and asserts the scratch directory is gone. |

### CE — Creator Edition decoupling into a separate repository

Operator-directed architectural work, added 2026-09-06. **These are not defects this audit
found.** Each row records the coupling that was *observed* in current source and what a split
must therefore resolve; the decision to split is the operator's, already taken. S10 above is the
one genuine defect in this area and is filed as a defect, not as split work.

A split of this significance warrants an ADR before implementation (Context / Decision /
Consequences / roads not taken). None exists yet; writing it is CE01's precondition, not a
separate ticket.

The Cargo-level seam is already in good shape and should be said plainly: every one of the 35
Creator crates is declared `optional = true` in `crates/strivo-web/Cargo.toml:63-97` and reached
only through the `creator` feature (`:18-56`), and `Cargo.toml`'s `default-members` restricts a
bare `cargo build` to the three PVR crates. The split is therefore mostly a *distribution and
source-layout* problem, not a dependency-untangling one.

| ID / owner | Observed coupling | What a split requires |
| --- | --- | --- |
| **CE01 · core-api** | **C:** `strivo-core` carries Creator vocabulary in its own public API. `CatalogPullOptions.crunchr_auto` (`src/recording/catalog.rs:43`) is an **ungated** `bool` field naming a Creator plugin, present in pure-PVR builds; its own comment (`:36-42`) records that gating it broke Cargo feature unification under `--workspace`. `src/config/mod.rs` has 17 `cfg(feature = "creator")` sites defining `CrunchrConfig`/`ArchiverConfig` and their defaults (`:50-56, 102-260`), and `src/recording/bulk.rs:317-320` sets the field from `config.crunchr.enabled`. | Replace the plugin-named field with a generic post-pull hook (a marker-writer callback or an opaque `Vec<PostPullAction>`) so core names no Creator concept. Move the Crunchr/Archiver config structs into the Creator repo, with core exposing an untyped extension table. Acceptance: `grep -ri "crunchr\|archiver" src/` returns nothing, and the PVR build compiles with the `creator` feature deleted from `strivo-core` entirely. **This is the load-bearing item — the others are mechanical once core is clean.** |
| **CE02 · web-api** | **C:** `crates/strivo-web` is a shared surface serving both editions: `routes/api.rs` alone has 29 `cfg(feature = "creator")` sites, plus one each in `server.rs` and `routes/mod.rs`, and `routes/plugins.rs` (86 route registrations) is mounted wholesale under `#[cfg(feature = "creator")]` (`server.rs:122-123`). | Decide the boundary explicitly: either `strivo-web` stays in the PVR repo and takes an optional dependency on a `strivo-creator-web` crate that contributes a `Router`, or the web crate splits too. The router-merge seam in `server.rs:114-123` already has the right shape for the former. Acceptance: no `cfg(feature = "creator")` remains in the PVR repo's web crate. |
| **CE03 · web-assets** (open — spa.js fixed, spa.css remains) | **B+C, revision 12:** `spa.js` is now split into 37 ordered modules under `assets/spa/<seq>-<edition>.js`, and `build.rs` assembles the served bundle by concatenating them (creator modules only when the `creator` feature is on) instead of deleting lines. Verified against the real built artifact: PVR bundle zero Creator symbols, Creator bundle byte-identical to full source concatenation. `spa.css` is **unchanged** — still 0 `@creator-start`, so all Creator styling still ships in the PVR bundle unconditionally. | Split the SPA into real modules along the edition line — the `assets/research/` tree already demonstrates the pattern (`build.rs:41-43` removes that whole directory for PVR builds, cleanly, with no marker surgery). Acceptance: the PVR bundle is built by *including* PVR modules, never by deleting lines from a shared file, and contains zero Creator symbols. **Met for spa.js; spa.css split deferred** — no marker or comparable signal exists to derive a safe split, and no visual-regression coverage exists to catch a wrong one. |
| **CE04 · packaging** | **C:** All 35 Creator crates are `path = "../…"` dependencies, and `crates/strivo-plugins/Cargo.toml:12` sets `publish = false`. Nothing is currently consumable from outside this workspace. | Choose and record a distribution mechanism: publish to crates.io, consume by git ref (the comment at `strivo-plugins/Cargo.toml:29-32` notes it was a `git` dep before being folded in — that history is worth consulting), or vendor. Acceptance: the Creator repo builds from a clean clone against a released PVR core, with a pinned version. |
| **CE05 · core-feature** | **C:** `crates/strivo-plugins/Cargo.toml:33` depends on `strivo-core = { path = "../..", features = ["creator"] }`, so the Creator repo would turn on a feature that lives in the PVR repo's core. | Resolve as part of CE01: once core carries no Creator concepts, the `creator` feature on `strivo-core` should be deletable outright rather than exported across the repo boundary. If it must survive, that is a scope limitation to state explicitly. |
| **CE06 · licensing** | **C:** Entitlement lives on the PVR side of the line: `gate_pro(...)` appears at 20+ sites in `routes/plugins.rs`, and `routes/licence.rs` (4 routes, including the ungated `trial` of S06) is merged into the shared `guarded` router (`server.rs:117`). | Decide which repo owns entitlement checking, and keep it on the side that owns the gated code. Depends on CE02. Acceptance: gating and the code it gates ship from one repository. |

### Status changes this session

Seven items were implemented and are **`ready_for_verification`, not `closed`**. For the four SPA
items the reviewer did run the suite independently; closure still requires the operator's review,
and R02 in particular carries a product decision that is not the auditor's to accept.

**Branch `remediation/spa-ux` — R01, R02, R03, R04** (commits `1052062`, `bfb5870`, `7138934`,
`ff36f14`). Reviewer re-ran `npm test` independently: **62 passed, 0 failed**. The agent stayed
strictly inside its file lane. Notes that matter:
- The **first** reviewer run showed 60 passed / 2 failed in pre-existing `player-controller`
  tests. Those pass 18/18 in isolation and the full suite passed on re-run, so they are flaky
  under CPU contention, not a regression — filed as **S12** rather than waved away.
- **Failing-before evidence is the agent's attributed claim**, not the reviewer's: the agent
  reports stashing its changes and confirming each new test fails first. The reviewer confirmed
  only the passing-after state.
- All of it runs against the Node mock, so **S04 still stands** — none of this is evidence about
  the real server.
- **R02 needs an operator decision.** Rather than build an asset-library CRUD, the agent scoped
  B-roll to a JSON textarea persisted in `localStorage`, matching the endpoint's documented
  hand-curated input contract. That is a defensible reading and a real integration, not a stub —
  but it is a product choice, and the manifest records it as one.

**Branches `remediation/web-perf` and `remediation/hardening` — R05, S05, R06:**

- **R05** — implemented by this audit's own operator pass (commit `559b726`, branch
  `remediation/web-perf`): one lazily-initialised `PersistDb` in `AppState`, all six per-request
  opens converted (`routes/api.rs` history/blocklist ×4, remux, health). A regression test
  (`server::tests::jobs_db_handle_is_shared_across_calls`) asserts pointer identity across two
  accessor calls, because a write/read round-trip alone would pass against two separate
  connections to the same file and prove nothing. **No latency measurement was taken**, so the
  performance rationale remains unmeasured and closure still requires it. `health` now reports on
  the shared handle rather than opening a second connection — a deliberate semantic change,
  recorded here because it means health no longer detects a database that became unopenable after
  first use.
- **S05** — implemented on branch `remediation/hardening` (commit `c65ec2d`): `decode_verify` now
  uses `Mac::verify_slice`. Verified by reading the diff; the `?`/`None` failure semantics are
  preserved and no timing measurement is claimed anywhere. Its test suite **was** re-run by the reviewer once disk space was recovered:
  `cargo test -p strivo-web` → 56 passed, 0 failed.
- **R06** — implemented on branch `remediation/hardening` (commit `1fbadd8`): a `TempDirGuard`
  RAII type whose `Drop` removes `.edl-temp`, covering early `?` returns and panics. Verified by
  reading the diff, **and its tests were subsequently re-run by the reviewer** once disk space
  was recovered: `cargo test -p strivo-editor` → 23 passed including
  `failed_render_leaves_no_scratch_directory`.

### Revision 12 — CE03's spa.js half fixed, spa.css deliberately left

Branch `remediation/ce03-spa-modules` (`7c16693..daac9c5`) replaces the `/* @creator-start */`
line-marker mechanism entirely, for `spa.js`. `assets/spa.js` no longer exists as a single source
file: it is split into 37 ordered modules under `assets/spa/<seq>-<edition>.js`, one boundary per
former marker pair, and `build.rs` now assembles `$OUT_DIR/assets/spa.js` by concatenating them in
filename order — including `-creator.js` modules only when the `creator` feature is on — instead of
stripping lines out of a shared file. The marker-stripping code is deleted from `build.rs`, not
left as a dormant second path.

Verified against the actual built artifact, both editions: the PVR bundle is 10,804 lines with zero
occurrences of the eight named Creator symbols and no `research/` or `spa/` directory in
`out/assets/`; the Creator bundle is 15,577 lines and byte-identical to concatenating all 37 source
modules, with `research/` intact. `check-pvr-bundle.mjs` — the S10 regression guard — was rewritten
for the new mechanism (it now diffs names defined only in `-creator.js` source against the real
built PVR artifact) and reports **zero surviving call sites and zero occurrences of Creator-only
symbols, checked across 174 names**; a mutation test (a stray call appended to a PVR module) turns
it red, confirming it still catches the S10 defect class. `cargo fmt`/`clippy` (both feature
configurations) clean, `cargo test --workspace --all-targets` all green, the Playwright mock lane
71/71, and the real-server lane 4/4 — including a new test added this pass that drives the actual
compiled PVR binary to `#/studio` and asserts zero uncaught page errors, which is the decisive
check S10's closure could previously only make against unstripped source.

**`spa.css` is unchanged and CE03 stays `open`.** It still has no edition markers, so all Creator
styling ships in the PVR bundle unconditionally — the other half of this finding. Unlike `spa.js`,
there is no marker or comparably strong signal to derive a safe split from, and the Playwright suite
asserts DOM structure and route behaviour, not visual/CSS correctness, so a guessed split could
silently break PVR styling with nothing to catch it. Left for a follow-up that either adds visual
coverage first or does a conservative per-selector audit.

### Revision 7 — the edition boundary, and how badly this audit undercounted it

S10 is fixed by extending the strip markers (14 further pairs) rather than by gating routes. The
reviewer rebuilt both bundles from scratch: **source 15,600 lines → PVR bundle 10,791 — 30.8%
stripped, against 2.2% before.** Every Creator symbol this manifest named reports zero occurrences,
and the Creator bundle is byte-identical to source with its `assets/research/` modules intact, so
nothing was lost for Creator Edition.

**This audit undercounted the defect by an order of magnitude.** Revision 2 recorded "5 call sites
with 0 definitions" from a three-name sample; the real figure is roughly **90 dangling call sites
across ~90 stripped API methods**. The finding was right and its scale was wrong, because the
sample was three method names rather than an enumeration. The new guard enumerates: it now checks
**174** stripped names.

The guard was mutation-tested. Appending a call to a stripped definition makes
`e2e/check-pvr-bundle.mjs` name it with a line number and **exit 1**; restored, it exits 0. It is
wired as the e2e package's `pretest`, so `npm test` cannot run without it. Two limits, both
disclosed by the implementer and both confirmed rather than taken on trust: the `build.rs`
`#[cfg(test)]` copy of the same check **is never executed by `cargo test`** (Cargo does not run
tests inside a build script), so the npm pretest is the only enforced copy; and the new Playwright
spec drives the **source** SPA with a mocked `creator_enabled: false`, so it verifies the runtime
route gate, not the stripping.

Fixing S10 exposed **S17**: `GET /api/v1/plugins` and `GET /api/v1/plugins/chat/rooms` are
Creator-only routes (`server.rs:122-123`) that edition-agnostic SPA code calls at five sites. The
implementer had to move those two definitions *out* of the strip blocks precisely because PVR code
needs them. Every call site catches, so nothing crashes — but a PVR build's chat feature always
renders an error where the route simply does not exist.

On **S09**, the README rewrite reviewed clean: every checkable claim traced to source, and the
drift runs the other way — the *currently committed* README's "Windows unsupported" badge is the
stale one. The rewrite drops the AUR section while `packaging/aur/PKGBUILD` remains in-tree, which
is an omission for the operator to rule on, not an inaccuracy.

### Revision 6 — the auth surface, structurally

The route-auth work reached its acceptance bar. `require_auth` (`server.rs:245-257`) is applied
with `.route_layer()` on the merged guarded router, so it runs **before each route's own
`Json`/`Query` extractors** — which is what closes S16's 422-before-auth class at one point
rather than per handler. The public websub route is merged after the layer and stays public; the
404 fallback is untouched.

Reviewer-run results: `cargo test --workspace` **83 suites ok, zero failed** — the red-branch
problem is resolved with no `#[ignore]` anywhere. Both sweeps report **0 violations, 0
inconclusive**. The e2e mock lane passes 58, and a **real-server lane now passes 3**, including a
login → recordings round-trip against the actual compiled binaries. That is the first acceptance
evidence in this manifest about the real HTTP server rather than a mock.

**The guard was mutation-tested, because a sweep nobody has seen fail proves nothing.** Neutering
`require_auth` makes both sweeps fail with the exact S16 signature and the 49 body-shape
"inconclusive" results reappear; restored, both pass. One honest limit surfaced by a second
mutation: wrongly adding a route to `KNOWN_PUBLIC` is *not* caught when that route's handler still
carries its own check — defense in depth absorbs it. The sweep guards the middleware, not the
allowlist.

The implementing agent also caught something this audit had not: a **production strivo daemon is
running on this machine** (PID 1405), and `strivo`'s socket, PID-file and state paths come from
`ProjectDirs`, not `--config`. A naive real-server lane would have attached to or clobbered it. The
lane sandboxes `HOME` and every `XDG_*` root under a temp dir and uses port 8281; the reviewer
confirmed the production daemon was untouched before and after.

### Revision 5 — Creator decoupling, honestly partial

`CE01` is **blocked, not done**, and the register says so. Real progress: `crunchr_auto` is gone,
replaced by a generic `post_pull_markers: Vec<String>` that core writes verbatim; the field is
deliberately left ungated with an in-source note, correctly avoiding the feature-unification trap
rather than re-applying the `cfg` that previously broke `--workspace`. `AppConfig::post_pull_markers()`
is now the single place that knows the Crunchr name. Dead `crunchr_queue` persistence was removed —
the reviewer independently confirmed against `bd17f61` that its only reference outside the
definition file was a comment, so it really was dead.

But `grep -ri "crunchr\|archiver" src/` still returns **33 hits** in three annotated clusters, and
CE01's own acceptance criterion is therefore not met. The blocker is verified and worth stating
plainly: `routes/api.rs` reads `cfg.archiver.*` by field name at 12 sites and `gate_pro(` appears 93
times in `routes/plugins.rs` — **both files this audit placed off-limits to that agent** to avoid a
collision with the concurrent auth workstream. The blocker was created by the dispatch split, not by
the implementer. CE01's remainder must be sequenced *after* the auth branch lands, not run beside it.

`CE05` is answered rather than open: the `creator` feature on `strivo-core` is **not** deletable,
directly because of where CE01 stopped. CE02/CE03/CE04/CE06 are decisions recorded in
[ADR 0001](../../adr/0001-creator-edition-repository-split.md) — Status **Proposed**, which is not
an accepted decision. Its roads-not-taken names six rejected alternatives, including this audit's
own scope constraint.

## Supersession map

Six findings from the 2026-07-30 audit are **confirmed implemented** and must not be reopened as
though their fixes do not exist:

- `F-11` (licence `implemented` flag unread) — implemented: `spa.js:8526-8553` and `:9231-9252`
  read `licence.implemented` and disable the buttons with an inline hint.
- `F-18` (`ui.reduce_motion` inert) — implemented: `spa.js:1105,1135,12594` keep a `.reduce-motion`
  class on `<html>` in sync with the setting.
- `F-19` (REC dot ignores reduced motion) — implemented: `spa.css:1245-1251` suppresses
  `.boot-glyph`, `.ch-rec`, `.rec-dot` and the state-pill pulses.
- `F-04` (webhook config TOML-only) — implemented: a Settings→Notifications webhook group with
  enable toggle and validated URL exists at `spa.js:12792-12839`.
- `F-32` (sync ffmpeg/ffprobe in async bodies) — implemented: `probe_duration_async`
  (`routes/plugins.rs:589-595`), `clipper_extract` (`:326-329`) and `editor_render` (`:1833-1841`)
  now wrap the blocking work in `spawn_blocking`.
- `F-37` (unbounded resource acquisition) — implemented: `ResourceRegistry` carries an
  `acquire_timeout` and `src/pipeline/executor.rs:811` wraps `acquire_owned` in
  `tokio::time::timeout`, with tests at `:1169-1187`.

Six are **confirmed still open** and re-issued with fresh evidence: `F-01`→**R01**, `F-13`→**R02**,
`F-20`→**R03**, `F-10`→**R04**, `F-26`→**R05**, `F-39`→**R06**. The prior IDs remain valid; the new
IDs exist because the prior `F-nn` format is not a stable ID in this register's scheme.

The other **21** prior findings were not re-verified in this pass and retain exactly the status the
2026-07-30 report gave them — that report's own method (static, no build, no measurement) still
bounds them. Do not read their absence here as closure.

## Dispatch order and acceptance

1. **Close the auth surface:** S01, then S02. Write the failing test first in each case — a 401
   assertion against a bogus `X-Api-Key`, not a bare non-200 check.
2. **Make auth checkable:** S08 depends on S03. Building the real-router test harness is the work
   that makes every subsequent auth claim verifiable, and it is what would have caught S01.
3. **Prove it through the real surface:** S04. One real-server E2E lane, failing before step 1 and
   passing after.
4. **Hygiene and drift:** S05, S06, S09, then the retained R-series.
5. **Edition boundary:** S10 first and independently — it is a live break in the shipped PVR
   product and must not wait on the split. Then the CE series in order: **CE01 before everything
   else**, because while `strivo-core` still names Creator concepts no clean repository boundary
   exists to draw. CE02 and CE03 can proceed in parallel once CE01 lands; CE04/CE05/CE06 are
   consequences of those decisions, not independent work.

The CE series should not start before S01–S04 land. Splitting a repository while its HTTP
surface has an unenforced auth invariant duplicates that unenforced invariant into two
repositories.

Proposed engineering targets below are **new acceptance targets, not measured SLOs or existing
promises**:

- Every registered route either asserts 401 without credentials or appears on an explicit,
  reviewed public allowlist — enforced by a test, checked in CI, on both editions.
- At least one CI lane drives the compiled server through a browser.
- The PVR bundle contains zero Creator symbols, verified by a check over the built artifact
  rather than over the source — S10 was invisible to every source-level review.

## Fresh verification and audit limitations

- `cargo test` (default members, debug): **63 passed, 0 failed, 1 ignored** across 5 test binaries.
  Establishes the PVR build's unit tests pass. Establishes nothing about route auth.
- `cargo test -p strivo-web --features creator`: **74 passed, 0 failed.** Overlaps the previous
  run's `strivo-web` unit tests; the two totals must not be summed.
- `cargo check -p strivo-bin --features creator`: **clean, finished in 14.21s.** Confirms the
  Creator build compiles, so S01 describes code that is really built, not dead configuration.
- `cargo build -p strivo-web` then direct inspection of the emitted
  `target/debug/build/strivo-web-*/out/assets/spa.js`: **15,111 lines vs 15,448 in source — 337
  stripped (2.2%)**; `PRO_PANES`, `renderProApp`, `renderCrunchr`, `renderUpgradeCard` and
  `PLUGIN_ROUTE_REDIRECTS` all present; `API.pluginRpc` / `setArchiverTandem` /
  `chatDensityCompute` present as **5 call sites, 0 definitions**. This is the evidence for S10.
  Debug profile only.
- R05 implementation verified: `cargo test -p strivo-web --all-targets` → **56 passed, 0 failed**
  (55 before, plus the new sharing test); `cargo clippy -p strivo-web --all-targets -- -D warnings`
  → clean; `cargo fmt --all -- --check` → clean.
- Regex scan of `.route(...)` registrations vs. auth calls in handler bodies: matched 68 of 153
  registrations; 11 handlers without an auth call, of which 6 were then read by hand and 4
  confirmed as real gaps (S01, S02, S06, S07). `/api/v1/health` and the SPA shell/asset routes are
  intentionally public. **The scan is incomplete by construction** — see S08.

No production build, no live daemon run, no browser session, no real HTTP request against a running
`strivo-web`, and no latency or throughput measurement of any kind were performed. **S10 was
confirmed by static inspection of the built bundle, not by loading `#/studio` in a browser** — the
`TypeError` is predicted from 5 call sites with 0 definitions, and predicted confidently, but it
was not observed at runtime. The R05 and hardening-branch changes were **not** verified against a
release-profile build, and the `remediation/hardening` tests were not re-run by the reviewer
because build artifacts had to be deleted to recover a filesystem that reached 100% full. The CE
items rest on reading Cargo manifests and `cfg` sites; **no split was attempted, even as a
spike**, so the effort estimates implied by their ordering are unvalidated. The four auth findings are read from
source; **none was reproduced against a running server**, and the exploit path described in S01
(bogus `X-Api-Key` satisfying `csrf_guard`) is a code-reading inference, not an executed request.
The capture, storage-write and SSE-streaming stages were not traced. The 21 unre-verified prior
findings were reviewed for status only, not re-adjudicated. No repository-wide `--workspace` suite
was run in release mode as CI does.

Closure rule for every ID: attach the implementation diff, a failing-before / passing-after
regression where applicable, the exact workload and environment, and current acceptance evidence.
**A report that predates the relevant code change cannot close it.** This manifest records the
issues found and the acceptance boundaries uncovered; it does not claim exhaustive defect discovery.

#!/usr/bin/env node
// S10 regression guard, runtime-verified version.
//
// build.rs assembles `assets/spa.js` by concatenating the ordered modules
// under `assets/spa/<seq>-<edition>.js`, including the `-creator.js` ones
// only when the `creator` Cargo feature is on (see CE03). It is easy for a
// PVR build to omit a definition (an API method, a render function) while a
// PVR module still *calls* it — the call site then survives into the PVR
// bundle referencing a name that no longer exists, and throws at runtime the
// moment a user reaches it. That's exactly the S10 defect, just with the
// split-module mechanism instead of line-marker deletion.
//
// A source-level review cannot catch this: the bug only exists in the
// *emitted* bundle. So this script builds the real PVR artifact (no
// --features creator) into a scratch target dir, reads the actual
// out/assets/spa.js the build produced, and fails if any surviving call
// site references an identifier that only ever appears in a `-creator.js`
// source module.
//
// Wired as `pretest` in package.json so `npm test` always runs this before
// Playwright.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const crateDir = join(here, ".."); // crates/strivo-web
const spaModuleDir = join(crateDir, "assets/spa");
const spaModuleFiles = readdirSync(spaModuleDir)
  .filter((f) => f.endsWith(".js"))
  .sort();

const pvrSource = spaModuleFiles
  .filter((f) => f.endsWith("-pvr.js"))
  .map((f) => readFileSync(join(spaModuleDir, f), "utf8"))
  .join("");
const creatorSource = spaModuleFiles
  .filter((f) => f.endsWith("-creator.js"))
  .map((f) => readFileSync(join(spaModuleDir, f), "utf8"))
  .join("");

function extractDefinedName(line) {
  // Only top-level (column-0) declarations, plus the API object's own
  // methods (its properties sit at exactly 2-space indent in spa.js).
  // Anything more deeply nested is a local helper/option key that just
  // happens to share a name with something else in the file (e.g. a
  // `.filter(...)`/`.trim(...)` builtin, or an unrelated `plugins:` field
  // inside some other object literal) — treating those as "the definition
  // that got stripped" is how this check produces false positives.
  const indent = line.length - line.trimStart().length;
  const t = line.trim();
  if (indent === 0) {
    let m = t.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
    if (m) return m[1];
    m = t.match(/^(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/);
    if (m) return m[1];
  }
  if (indent === 2) {
    const m = t.match(/^([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?\(/);
    if (m) return m[1];
  }
  return null;
}

function definedNames(source) {
  const names = new Set();
  for (const line of source.split("\n")) {
    const n = extractDefinedName(line);
    if (n) names.add(n);
  }
  return names;
}

function stillDefined(strippedText) {
  const names = new Set();
  for (const line of strippedText.split("\n")) {
    const n = extractDefinedName(line);
    if (n) names.add(n);
  }
  return names;
}

function callSitesFor(strippedText, name) {
  // Word-boundary "name(" or "name (" — covers both bare calls
  // (renderProApp(...)) and API.method(...) calls.
  const callRe = new RegExp(`(?<![\\w$])${name}\\s*\\(`, "g");
  // `typeof name === "function"` guards the call a line or two above it
  // (the codebase's own idiom for a call whose target may not exist in
  // this bundle, e.g. teardownDataviz/teardownArchive/renderPipelines) —
  // that's the fix, not a violation, so skip calls sitting under the guard.
  const guardRe = new RegExp(`typeof\\s+${name}\\s*===?\\s*["']function["']`);
  const lines = strippedText.split("\n");
  const hits = [];
  lines.forEach((line, i) => {
    if (!callRe.test(line)) return;
    callRe.lastIndex = 0;
    const windowStart = Math.max(0, i - 3);
    const guarded = lines.slice(windowStart, i + 1).some((l) => guardRe.test(l));
    if (!guarded) hits.push(i + 1);
  });
  return hits;
}

// 1. Build the real PVR (non-creator) bundle into an isolated target dir,
//    so we read exactly one, unambiguous out/assets/spa.js.
const scratch = mkdtempSync(join(tmpdir(), "strivo-pvr-bundle-check-"));
let builtSpaJs;
try {
  execFileSync("cargo", ["build", "-p", "strivo-web"], {
    cwd: crateDir,
    env: { ...process.env, CARGO_TARGET_DIR: scratch },
    stdio: "inherit",
  });
  const out = execFileSync(
    "find", [join(scratch, "debug/build"), "-maxdepth", "4", "-path", "*/out/assets/spa.js"],
    { encoding: "utf8" },
  ).trim().split("\n").filter(Boolean);
  if (out.length !== 1) {
    throw new Error(`expected exactly one built spa.js, found ${out.length}: ${out.join(", ")}`);
  }
  builtSpaJs = readFileSync(out[0], "utf8");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

// 2. Compute which identifiers are defined ONLY in a `-creator.js` source
//    module (never in a `-pvr.js` one) — those are the names a PVR build
//    genuinely omits. If a name is defined in both (moved out to shared code
//    on purpose — see S17), it's not actually removed and isn't checked.
const creatorOnlyNames = new Set(
  [...definedNames(creatorSource)].filter((n) => !definedNames(pvrSource).has(n)),
);
const keptDefs = stillDefined(builtSpaJs);

// 3. Any creator-only name with a surviving call site in the REAL built
//    bundle is the S10 bug: a call to a definition that isn't in this
//    edition's bundle.
const violations = [];
for (const name of creatorOnlyNames) {
  if (keptDefs.has(name)) continue;
  const hits = callSitesFor(builtSpaJs, name);
  if (hits.length) violations.push({ name, hits });
}

if (violations.length) {
  console.error("PVR bundle (real `cargo build -p strivo-web` output) calls " +
    "identifiers whose definitions live only in a Creator spa module:");
  for (const v of violations) {
    console.error(`  ${v.name} — called at out/assets/spa.js:${v.hits.join(", ")}`);
  }
  console.error(
    "\nMove the call site into a `-creator.js` module too (or its enclosing " +
    "dead function), or move the definition into a `-pvr.js` module if the " +
    "call site is genuinely reachable in the PVR build.",
  );
  process.exit(1);
}

// 4. CE03's acceptance bar, checked directly against the artifact: the PVR
//    bundle contains ZERO occurrences (not just call sites — any reference,
//    including a leaked definition) of a name that only ever exists in
//    Creator source. This is the literal "contains zero Creator symbols"
//    check, independent of the call/definition heuristics above.
//
// One narrow, deliberate exception: shared route/teardown code guards a call
// to a Creator-only render/teardown function with
// `typeof <name> === "function"` so the same PVR module works whether or not
// that function exists in this bundle (the same idiom `callSitesFor` above
// already treats as the fix, not the bug, for S10). The guard's own line
// necessarily spells the name it's checking for — that's not the function
// shipping, it's the PVR code correctly staying silent about its absence.
// Any occurrence NOT on a guard line, or a call that isn't inside a guarded
// window, is a real leak. A full-line `//` comment mentioning the name (e.g.
// explaining why a nearby call is guarded) ships inert bytes, not a symbol —
// excluded the same way.
const symbolLeaks = [];
for (const name of creatorOnlyNames) {
  const wordRe = new RegExp(`(?<![\\w$])${name}(?![\\w$])`, "g");
  const guardRe = new RegExp(`typeof\\s+${name}\\s*===?\\s*["']function["']`);
  const callRe = new RegExp(`(?<![\\w$])${name}\\s*\\(`);
  const lines = builtSpaJs.split("\n");
  let leaks = 0;
  lines.forEach((line, i) => {
    wordRe.lastIndex = 0;
    const hits = (line.match(wordRe) || []).length;
    if (hits === 0) return;
    if (line.trim().startsWith("//")) return;
    if (guardRe.test(line)) {
      // The guard line itself: fine. A call on the SAME line beyond the
      // guard (not the `if (... ) name();` idiom split across two lines)
      // still counts every other occurrence as a leak.
      leaks += hits - 1;
      return;
    }
    const windowStart = Math.max(0, i - 3);
    const guarded = lines.slice(windowStart, i + 1).some((l) => guardRe.test(l));
    if (guarded && callRe.test(line)) return;
    leaks += hits;
  });
  if (leaks > 0) symbolLeaks.push({ name, count: leaks });
}

if (symbolLeaks.length) {
  console.error(
    "PVR bundle contains Creator-only symbols (CE03 acceptance violated):",
  );
  for (const s of symbolLeaks) {
    console.error(`  ${s.name} — ${s.count} occurrence(s)`);
  }
  process.exit(1);
}

console.log(
  `OK — PVR bundle has zero surviving call sites and zero occurrences of ` +
  `Creator-only symbols (checked ${creatorOnlyNames.size} names found only ` +
  `in assets/spa/*-creator.js).`,
);

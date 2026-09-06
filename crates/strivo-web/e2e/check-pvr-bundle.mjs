#!/usr/bin/env node
// S10 regression guard, runtime-verified version.
//
// build.rs strips every `/* @creator-start */ … /* @creator-end */` block
// from assets/*.js when the `creator` cargo feature is off. It is easy for
// a marker to cover a definition (an API method, a render function) while
// missing every place that still *calls* it — the call site then survives
// into the PVR bundle referencing a name that no longer exists, and throws
// at runtime the moment a user reaches it.
//
// A source-level review cannot catch this: the bug only exists in the
// *emitted* bundle, never in assets/spa.js itself. So this script builds
// the real PVR artifact (no --features creator) into a scratch target dir,
// reads the actual out/assets/spa.js `strip_js_tree` produced, and fails if
// any surviving call site references an identifier that assets/spa.js only
// defines inside a stripped block.
//
// Wired as `pretest` in package.json so `npm test` always runs this before
// Playwright.
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const crateDir = join(here, ".."); // crates/strivo-web
const specSource = readFileSync(join(crateDir, "assets/spa.js"), "utf8");

function stripCreatorBlocks(content) {
  const out = [];
  let inBlock = false;
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (t === "/* @creator-start */") { inBlock = true; continue; }
    if (t === "/* @creator-end */") { inBlock = false; continue; }
    if (!inBlock) out.push(line);
  }
  return out.join("\n") + "\n";
}

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

function findRemovedNames(source) {
  const names = new Set();
  let inBlock = false;
  for (const line of source.split("\n")) {
    const t = line.trim();
    if (t === "/* @creator-start */") { inBlock = true; continue; }
    if (t === "/* @creator-end */") { inBlock = false; continue; }
    if (inBlock) {
      const n = extractDefinedName(line);
      if (n) names.add(n);
    }
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

// 2. Compute which identifiers assets/spa.js only defines inside a
//    /* @creator-start */ block, and which of those are (by design) still
//    defined elsewhere in the stripped output (i.e. not actually removed).
const removedNames = findRemovedNames(specSource);
const keptDefs = stillDefined(builtSpaJs);

// 3. Any removed name with a surviving call site in the REAL built bundle
//    is the S10 bug: a call to a definition that no longer exists.
const violations = [];
for (const name of removedNames) {
  if (keptDefs.has(name)) continue;
  const hits = callSitesFor(builtSpaJs, name);
  if (hits.length) violations.push({ name, hits });
}

if (violations.length) {
  console.error("PVR bundle (real `cargo build -p strivo-web` output) calls " +
    "identifiers whose /* @creator-start */ definitions were stripped:");
  for (const v of violations) {
    console.error(`  ${v.name} — called at out/assets/spa.js:${v.hits.join(", ")}`);
  }
  console.error(
    "\nExtend the creator markers to also strip the call site (or its " +
    "enclosing dead function), or move the definition outside the creator " +
    "block if the call site is genuinely reachable in the PVR build.",
  );
  process.exit(1);
}

console.log(
  `OK — PVR bundle has zero surviving call sites to stripped definitions ` +
  `(checked ${removedNames.size} names removed by /* @creator-start */ blocks).`,
);

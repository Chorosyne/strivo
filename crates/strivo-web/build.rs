//! Build script for strivo-web.
//!
//! In PVR mode (no `creator` feature) the copied asset tree is reduced to the
//! PVR surface two ways:
//!
//!   1. `/* @creator-start */` … `/* @creator-end */` blocks are stripped from
//!      **every** `.js` file, not just `spa.js`.
//!   2. `assets/research/` is dropped wholesale — those modules are the
//!      Creator-only research UI and have no PVR content to keep.
//!
//! Both matter: the `spa.js` seam that imports the research modules lives in a
//! creator block (so PVR never imports them), and dropping the directory means
//! the code is not shipped even as dead bytes.
//!
//! Creator mode copies assets unchanged.
//!
//! `src/assets.rs` points `RustEmbed` at `$OUT_DIR/assets` so it always
//! picks up the (possibly-stripped) tree rather than the source tree.

use std::{env, fs, io, path::Path};

fn main() {
    // Watch the whole asset tree: naming individual files here meant a new
    // module could be edited without triggering a rebuild, so the binary would
    // silently keep serving the previous copy.
    println!("cargo:rerun-if-changed=assets");
    println!("cargo:rerun-if-env-changed=CARGO_FEATURE_CREATOR");

    let manifest_dir = env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR not set");
    let out_dir = env::var("OUT_DIR").expect("OUT_DIR not set");
    let creator_enabled = env::var("CARGO_FEATURE_CREATOR").is_ok();

    let src_assets = Path::new(&manifest_dir).join("assets");
    let dst_assets = Path::new(&out_dir).join("assets");

    copy_dir_all(&src_assets, &dst_assets).expect("failed to copy assets to OUT_DIR");
    // The old 1246px PNG is retained in source for packaging/brand exports,
    // but the SPA now uses the 220-byte SVG mark. Do not embed nearly 1 MiB
    // of unreachable raster data into every web binary.
    let _ = fs::remove_file(dst_assets.join("img/chorosyne-logo.png"));

    if !creator_enabled {
        // The research UI is Creator-only in its entirety; ship none of it.
        let _ = fs::remove_dir_all(dst_assets.join("research"));
        strip_js_tree(&dst_assets).expect("failed to strip creator blocks from assets");
    }
}

/// Strip creator blocks from every `.js` file in the copied asset tree.
fn strip_js_tree(dir: &Path) -> io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            strip_js_tree(&path)?;
        } else if path.extension().and_then(|e| e.to_str()) == Some("js") {
            let content = fs::read_to_string(&path)?;
            if content.contains("@creator-start") {
                fs::write(&path, strip_creator_blocks(&content))?;
            }
        }
    }
    Ok(())
}

/// Copy a directory tree from `src` to `dst`, creating `dst` if needed.
fn copy_dir_all(src: &Path, dst: &Path) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if path.is_dir() {
            copy_dir_all(&path, &dst_path)?;
        } else {
            fs::copy(&path, &dst_path)?;
        }
    }
    Ok(())
}

/// Remove every line from `/* @creator-start */` through `/* @creator-end */`
/// (inclusive).  The surrounding non-creator lines are kept verbatim.
///
/// The markers live inside a JS object literal where each removed block ends
/// with a comma on the last kept property, so stripping lines never leaves a
/// trailing-comma or missing-comma syntax error.
fn strip_creator_blocks(content: &str) -> String {
    let mut out: Vec<&str> = Vec::with_capacity(content.lines().count());
    let mut in_block = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed == "/* @creator-start */" {
            in_block = true;
            continue;
        }
        if trimmed == "/* @creator-end */" {
            in_block = false;
            continue;
        }
        if !in_block {
            out.push(line);
        }
    }
    let mut result = out.join("\n");
    result.push('\n');
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Best-effort extraction of the identifier a single source line
    /// *defines*, covering the three shapes used in `assets/spa.js`:
    ///   `function NAME(...) {`, `async function NAME(...) {`   (column 0)
    ///   `const NAME = ...` / `let NAME = ...`                  (column 0)
    ///   `NAME: (...) =>` / `NAME: async (...) =>`   (the `API` object's own
    ///   methods, which sit at exactly 2-space indent in this file)
    /// Returns `None` for anything else, and — deliberately — for a
    /// same-shaped line at any other indentation: a nested local helper or
    /// option key that happens to share a name with something else in the
    /// file (a `.filter(...)`/`.trim(...)` builtin, or an unrelated
    /// `plugins:` field inside some other object literal) is not the
    /// definition a `/* @creator-start */` block is naming, and treating it
    /// as one is how this check produced false positives during S10.
    fn extract_defined_name(line: &str) -> Option<String> {
        let indent = line.len() - line.trim_start().len();
        let t = line.trim();
        let is_ident_char = |c: char| c.is_alphanumeric() || c == '_' || c == '$';
        let take_ident = |s: &str| -> Option<String> {
            let ident: String = s.chars().take_while(|&c| is_ident_char(c)).collect();
            if ident.is_empty() || ident.chars().next().unwrap().is_ascii_digit() {
                None
            } else {
                Some(ident)
            }
        };
        if indent == 0 {
            for prefix in ["async function ", "function "] {
                if let Some(rest) = t.strip_prefix(prefix) {
                    if let Some(name) = take_ident(rest) {
                        return Some(name);
                    }
                }
            }
            for prefix in ["const ", "let "] {
                if let Some(rest) = t.strip_prefix(prefix) {
                    if let Some(name) = take_ident(rest) {
                        let after = rest[name.len()..].trim_start();
                        if after.starts_with('=') {
                            return Some(name);
                        }
                    }
                }
            }
        }
        if indent == 2 {
            // Object-literal method: `name: (` / `name: async (`.
            if let Some(colon) = t.find(':') {
                let (head, tail) = t.split_at(colon);
                if let Some(name) = take_ident(head) {
                    if name.len() == head.len() {
                        let after = tail[1..].trim_start();
                        if after.starts_with('(') || after.starts_with("async") {
                            return Some(name);
                        }
                    }
                }
            }
        }
        None
    }

    /// Does `haystack` contain `name` used as a call — `name(` or `name (` —
    /// at a word boundary (not as part of a longer identifier), and not
    /// under a `typeof name === "function"` guard within the previous few
    /// lines? A hit here is a real call site, never a definition:
    /// `function name(` and `name: (` are excluded by the caller filtering
    /// on `extract_defined_name` before this is reached. The `typeof`
    /// exception matches this codebase's own idiom for a call whose target
    /// may not exist in this bundle (see `teardownDataviz`/
    /// `teardownArchive`/the `PipelineUpdated` handler in `assets/spa.js`).
    fn contains_call_site(haystack: &str, name: &str) -> bool {
        let lines: Vec<&str> = haystack.lines().collect();
        let is_ident_byte = |b: u8| b.is_ascii_alphanumeric() || b == b'_' || b == b'$';
        let guard = format!("typeof {name} ===");
        let guard_alt = format!("typeof {name}==");
        for (i, line) in lines.iter().enumerate() {
            let bytes = line.as_bytes();
            let mut start = 0;
            while let Some(pos) = line[start..].find(name) {
                let idx = start + pos;
                let before_ok = idx == 0 || !is_ident_byte(bytes[idx - 1]);
                let after_idx = idx + name.len();
                if before_ok {
                    let mut j = after_idx;
                    while j < bytes.len() && (bytes[j] == b' ' || bytes[j] == b'\t') {
                        j += 1;
                    }
                    if j < bytes.len() && bytes[j] == b'(' {
                        let window_start = i.saturating_sub(3);
                        let guarded = lines[window_start..=i]
                            .iter()
                            .any(|l| l.contains(&guard) || l.contains(&guard_alt));
                        if !guarded {
                            return true;
                        }
                    }
                }
                start = idx + 1;
            }
        }
        false
    }

    /// S10 regression guard: every identifier a `/* @creator-start */`
    /// block deletes from the PVR bundle must have zero surviving call
    /// sites in that same bundle. A source-level review cannot catch
    /// "definition stripped, call site forgotten" — this reads the real
    /// stripped output the way `strip_js_tree` produces it and fails if any
    /// such call site survives.
    #[test]
    fn pvr_bundle_has_no_dangling_calls_to_stripped_definitions() {
        let manifest_dir = env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR not set");
        let path = Path::new(&manifest_dir).join("assets/spa.js");
        let source = fs::read_to_string(&path).expect("read assets/spa.js");
        let stripped = strip_creator_blocks(&source);

        // Names defined on a line that strip_creator_blocks removes.
        let mut removed_names = std::collections::HashSet::new();
        let mut in_block = false;
        for line in source.lines() {
            let trimmed = line.trim();
            if trimmed == "/* @creator-start */" {
                in_block = true;
                continue;
            }
            if trimmed == "/* @creator-end */" {
                in_block = false;
                continue;
            }
            if in_block {
                if let Some(name) = extract_defined_name(line) {
                    removed_names.insert(name);
                }
            }
        }

        // A name still defined somewhere in the stripped output isn't
        // actually gone (e.g. it's shared and was deliberately kept outside
        // the block).
        let still_defined: std::collections::HashSet<String> =
            stripped.lines().filter_map(extract_defined_name).collect();

        let mut dangling = Vec::new();
        for name in &removed_names {
            if still_defined.contains(name) {
                continue;
            }
            if contains_call_site(&stripped, name) {
                dangling.push(name.clone());
            }
        }
        dangling.sort();
        assert!(
            dangling.is_empty(),
            "PVR bundle (assets/spa.js after stripping) still calls these \
             identifiers whose /* @creator-start */ definitions were removed: \
             {dangling:?}. Extend the creator markers to also strip the call \
             site (or its enclosing dead function), or move the definition \
             outside the creator block if the call site is genuinely reachable \
             in the PVR build."
        );
    }

    #[test]
    fn strip_removes_blocks_and_preserves_rest() {
        let src = "a,\n  /* @creator-start */\n  b,\n  c,\n  /* @creator-end */\n  d,\n";
        let out = strip_creator_blocks(src);
        assert!(!out.contains("b,"), "creator line must be removed");
        assert!(!out.contains("c,"), "creator line must be removed");
        assert!(out.contains("a,"), "non-creator line must be kept");
        assert!(out.contains("d,"), "non-creator line must be kept");
        assert!(!out.contains("@creator-start"), "marker must be removed");
        assert!(!out.contains("@creator-end"), "marker must be removed");
    }

    #[test]
    fn strip_handles_multiple_blocks() {
        let src = "x,\n  /* @creator-start */\n  y,\n  /* @creator-end */\n  z,\n  /* @creator-start */\n  w,\n  /* @creator-end */\n  end,\n";
        let out = strip_creator_blocks(src);
        assert!(out.contains("x,"));
        assert!(out.contains("z,"));
        assert!(out.contains("end,"));
        assert!(!out.contains("y,"));
        assert!(!out.contains("w,"));
    }
}

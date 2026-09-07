//! Build script for strivo-web.
//!
//! `assets/spa.js` and `assets/spa.css` are each assembled at build time from
//! ordered module files (under `assets/spa/` and `assets/spa-css/`
//! respectively) rather than shipped as one file in source. Each module is
//! named `<seq>-<edition>.{js,css}` where `<edition>` is `pvr` (always
//! included) or `creator` (included only when the `creator` Cargo feature is
//! on); the assembler concatenates them in filename order into a single
//! `$OUT_DIR/assets/spa.{js,css}`, which is what `src/assets.rs`'s
//! `RustEmbed` actually serves.
//!
//! This mirrors the pattern `assets/research/` already used: a PVR build is
//! produced by *including* PVR sources, never by deleting lines out of a
//! shared file. `assets/research/` (the Creator-only research UI) is still
//! dropped wholesale for PVR builds, exactly as before — it has no PVR
//! content to keep.
//!
//! `src/assets.rs` points `RustEmbed` at `$OUT_DIR/assets` so it always picks
//! up the assembled tree rather than the source tree.

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

    assemble_modules(&dst_assets, "spa", "js", creator_enabled).expect("failed to assemble spa.js");
    assemble_modules(&dst_assets, "spa-css", "css", creator_enabled)
        .expect("failed to assemble spa.css");

    if !creator_enabled {
        // The research UI is Creator-only in its entirety; ship none of it.
        let _ = fs::remove_dir_all(dst_assets.join("research"));
    }
}

/// Build `$OUT_DIR/assets/spa.<ext>` by concatenating the ordered module
/// files under `assets/<module_dir>/`, in filename order, then delete the
/// source module directory from the embedded tree so it is never itself
/// served (a PVR build must not expose `assets/<module_dir>/*-creator.<ext>`
/// as a fetchable path).
///
/// Filtering happens by *including* the modules a build wants, not by
/// deleting lines from a shared file — a PVR build simply never reads the
/// `-creator.<ext>` files. Used for both `spa.js` (`assets/spa/`) and
/// `spa.css` (`assets/spa-css/`).
fn assemble_modules(
    dst_assets: &Path,
    module_dir: &str,
    ext: &str,
    creator_enabled: bool,
) -> io::Result<()> {
    let src_dir = dst_assets.join(module_dir);
    let mut modules: Vec<_> = fs::read_dir(&src_dir)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some(ext))
        .collect();
    modules.sort();

    let creator_suffix = format!("-creator.{ext}");
    let mut assembled = String::new();
    for module in &modules {
        let name = module.file_name().and_then(|n| n.to_str()).unwrap_or("");
        let is_creator = name.ends_with(&creator_suffix);
        if is_creator && !creator_enabled {
            continue;
        }
        assembled.push_str(&fs::read_to_string(module)?);
    }

    fs::write(dst_assets.join(format!("spa.{ext}")), assembled)?;
    fs::remove_dir_all(&src_dir)?;
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

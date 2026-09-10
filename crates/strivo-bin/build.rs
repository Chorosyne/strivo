// Embeds `strivo.exe`'s Windows version-info resource and icon.
//
// Closes the "no version-info resource" gap noted in
// docs/PACKAGING-PLAN.md: without this, Explorer's file properties dialog,
// the Inno Setup installer's Add/Remove Programs entry, and Windows itself
// show no icon and no version/product metadata for strivo.exe.
//
// Build scripts always compile and run on the HOST platform, never the
// crate's target -- so both the `embed-resource` build-dependency in
// Cargo.toml (`[target.'cfg(windows)'.build-dependencies]`) and the
// `#[cfg(windows)]` gate below key off the *host*, not `--target`. That
// means this is a real no-op on Linux/macOS hosts (the dependency isn't
// even compiled in), and it also means a Linux-hosted cross-check like
// `scripts/check-windows.sh` (which targets x86_64-pc-windows-gnu from a
// Linux host) cannot exercise this path -- only a build actually run on a
// Windows host (the win11-ci runner) does. That's an inherent limitation of
// build-script cross-compilation, not a gap in this file.
fn main() {
    #[cfg(windows)]
    embed_windows_resource();
}

#[cfg(windows)]
fn embed_windows_resource() {
    let icon_path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packaging/icons/strivo.ico"
    );
    println!("cargo:rerun-if-changed={icon_path}");

    let version = env!("CARGO_PKG_VERSION");
    let mut parts = version
        .split(|c: char| c == '.' || c == '-')
        .map(|p| p.parse::<u16>().unwrap_or(0));
    let major = parts.next().unwrap_or(0);
    let minor = parts.next().unwrap_or(0);
    let patch = parts.next().unwrap_or(0);

    // Copyright line kept in sync with LICENSE by hand -- see the note in
    // packaging/windows/strivo.iss about version single-sourcing.
    let rc = format!(
        r#"1 ICON "{icon_path}"

1 VERSIONINFO
FILEVERSION {major},{minor},{patch},0
PRODUCTVERSION {major},{minor},{patch},0
FILEFLAGSMASK 0x3fL
FILEFLAGS 0x0L
FILEOS 0x40004L
FILETYPE 0x1L
FILESUBTYPE 0x0L
BEGIN
    BLOCK "StringFileInfo"
    BEGIN
        BLOCK "040904b0"
        BEGIN
            VALUE "CompanyName", "revelri"
            VALUE "FileDescription", "StriVo -- self-hosted live-stream PVR"
            VALUE "FileVersion", "{version}"
            VALUE "InternalName", "strivo"
            VALUE "LegalCopyright", "Copyright (c) 2026 revelri"
            VALUE "OriginalFilename", "strivo.exe"
            VALUE "ProductName", "StriVo"
            VALUE "ProductVersion", "{version}"
        END
    END
    BLOCK "VarFileInfo"
    BEGIN
        VALUE "Translation", 0x409, 1200
    END
END
"#,
        icon_path = icon_path,
        major = major,
        minor = minor,
        patch = patch,
        version = version,
    );

    let out_dir = std::env::var("OUT_DIR").expect("OUT_DIR set by cargo");
    let rc_path = std::path::Path::new(&out_dir).join("strivo.rc");
    std::fs::write(&rc_path, rc).expect("write generated strivo.rc");

    embed_resource::compile(&rc_path, embed_resource::NONE)
        .manifest_optional()
        .expect("embed strivo.exe version-info resource");
}

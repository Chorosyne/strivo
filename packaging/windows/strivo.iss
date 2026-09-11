; StriVo Windows installer (Inno Setup).
;
; Produces the classic step-through wizard the operator asked for: license
; page -> install-directory picker -> "Select Additional Tasks" checkboxes
; -> progress bar -> finish page with a "Launch StriVo now" checkbox. See
; docs/adr/0003-installer-packaging-and-bundled-dependencies.md and
; docs/PACKAGING-PLAN.md's "Windows -- Inno Setup" section for the design
; this implements.
;
; This script does NOT download or extract anything itself. It is compiled
; by packaging/windows/build-installer.ps1 on the win11-ci self-hosted
; runner, which downloads and sha256-verifies each vendored tool per
; packaging/vendored-deps.toml, extracts the real executables, and invokes
; ISCC.exe with the /D<name>=<value> overrides documented in the "Build
; inputs" block below. Compiling this file directly (without those /D
; overrides) falls back to relative dev-checkout paths for a local test
; build, but produces an installer with whatever happens to be at those
; paths -- not a CI artifact.

#define MyAppName "StriVo"
#define MyAppPublisher "revelri"
#define MyAppURL "https://github.com/revoydotdev/strivo"
#define MyAppExeName "strivo.exe"

; Fixed per-app GUID (Add/Remove Programs identity + upgrade key). Generated
; once; never change it across releases or Windows will treat every version
; as a different, side-by-side-installable application. Deliberately set
; directly in [Setup] below rather than via #define: AppId's value is
; constant-expanded by Inno at compile time, so a literal GUID needs the
; doubled leading brace (`{{`) to produce a single literal `{` -- routing
; it through a #define first only invites getting that escaping wrong.

; Version comes from the workspace manifest: build-installer.ps1 reads
; `[workspace.package] version` out of the root Cargo.toml and passes it as
; /DMyAppVersion, so the installer, Programs-and-Features entry and the
; embedded strivo.exe version resource can never disagree. The fallback
; below only exists so a bare `ISCC strivo.iss` from a dev checkout still
; compiles; it is not a source of truth.
#ifndef MyAppVersion
  #define MyAppVersion "0.0.0-dev"
#endif

; ---------------------------------------------------------------------------
; Build inputs. Every one of these is overridable on the ISCC.exe command
; line with /D<name>=<value>; build-installer.ps1 does this for all eight
; after downloading, sha256-verifying, and extracting the real files, per
; packaging/vendored-deps.toml. The #ifndef defaults below are only for a
; manual/local test compile straight off a dev checkout (they assume a
; `cargo build --release` was already run, and that a Windows dev has
; separately populated target\vendored\ for a local test -- CI never
; touches these defaults, it passes every one explicitly). Keep the names
; below in sync with build-installer.ps1 -- that script's /D flags and the
; names declared here are one contract, not two independently-maintained
; lists.
;
;   StrivoExePath        -> the compiled release strivo.exe
;   ffmpeg_exe           -> extracted ffmpeg.exe  (BtbN win64-lgpl zip, "bin/" inside)
;   ffprobe_exe          -> extracted ffprobe.exe (same zip)
;   mpv_exe              -> extracted mpv.exe     (shinchiro .7z, top-level inside)
;   streamlink_exe       -> extracted streamlink.exe (windows-builds portable zip, "bin/" inside)
;   streamlink_python_dir -> that zip's "Python\" dir -- streamlink.exe is a
;                            launcher stub that needs this as a *sibling* of
;                            {app}\bin\, i.e. at {app}\Python\, not inside it
;   streamlink_pkgs_dir   -> that zip's "pkgs\" dir, same sibling-of-bin\ deal
;   yt_dlp_exe           -> yt-dlp.exe (already a standalone binary, no extraction)
; ---------------------------------------------------------------------------
#ifndef StrivoExePath
  #define StrivoExePath "..\..\target\release\strivo.exe"
#endif
#ifndef ffmpeg_exe
  #define ffmpeg_exe "..\..\target\vendored\ffmpeg.exe"
#endif
#ifndef ffprobe_exe
  #define ffprobe_exe "..\..\target\vendored\ffprobe.exe"
#endif
#ifndef mpv_exe
  #define mpv_exe "..\..\target\vendored\mpv.exe"
#endif
#ifndef streamlink_exe
  #define streamlink_exe "..\..\target\vendored\streamlink.exe"
#endif
#ifndef streamlink_python_dir
  #define streamlink_python_dir "..\..\target\vendored\Python"
#endif
#ifndef streamlink_pkgs_dir
  #define streamlink_pkgs_dir "..\..\target\vendored\pkgs"
#endif
#ifndef yt_dlp_exe
  #define yt_dlp_exe "..\..\target\vendored\yt-dlp.exe"
#endif

[Setup]
AppId={{C3DE9125-1B1B-4F39-A432-B8B4613A02F4}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
; PVR edition only -- Creator Edition is never packaged by this installer,
; matching ADR 0002's monorepo boundary and every other distribution channel.
VersionInfoDescription={#MyAppName} Setup
LicenseFile=..\..\LICENSE
OutputDir=..\..\dist\windows-installer
OutputBaseFilename=strivo-{#MyAppVersion}-setup
SetupIconFile=..\icons\strivo.ico
UninstallDisplayIcon={app}\strivo.ico
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; Bundled tools are all x86_64 builds (packaging/vendored-deps.toml has no
; arm64 rows yet), so this installer only targets x64 Windows.
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; Writing under Program Files (the {autopf} default dir) needs elevation;
; Task Scheduler registration itself (via `strivo enable`) does not, per
; the ADR, but the file copy does.
PrivilegesRequired=admin

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "startwithwindows"; Description: "Start StriVo with Windows (background service, no admin required to run)"; GroupDescription: "Additional options:"; Flags: unchecked
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"; Flags: unchecked

[Files]
Source: "{#StrivoExePath}"; DestDir: "{app}"; DestName: "strivo.exe"; Flags: ignoreversion
Source: "..\icons\strivo.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\THIRD-PARTY-LICENSES\*"; DestDir: "{app}\packaging\THIRD-PARTY-LICENSES"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "launch-and-open.ps1"; DestDir: "{app}"; Flags: ignoreversion
; Bundled tools. strivo_core::tools::resolve_tool checks <exe_dir>\bin\
; before falling back to PATH, so this is the only placement needed -- no
; installer-side PATH mutation, per ADR 0003 / src/tools.rs.
Source: "{#ffmpeg_exe}"; DestDir: "{app}\bin"; DestName: "ffmpeg.exe"; Flags: ignoreversion
Source: "{#ffprobe_exe}"; DestDir: "{app}\bin"; DestName: "ffprobe.exe"; Flags: ignoreversion
Source: "{#mpv_exe}"; DestDir: "{app}\bin"; DestName: "mpv.exe"; Flags: ignoreversion
Source: "{#streamlink_exe}"; DestDir: "{app}\bin"; DestName: "streamlink.exe"; Flags: ignoreversion
; streamlink.exe is a launcher stub, not self-contained -- it locates its
; interpreter at "..\Python\python.exe" relative to itself, i.e. one level
; up from {app}\bin\. These two directories MUST land at {app}\Python\ and
; {app}\pkgs\ (siblings of bin\, not inside it) or streamlink fails to
; launch. See packaging/vendored-deps.toml's streamlink.windows_x86_64 notes.
Source: "{#streamlink_python_dir}\*"; DestDir: "{app}\Python"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#streamlink_pkgs_dir}\*"; DestDir: "{app}\pkgs"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#yt_dlp_exe}"; DestDir: "{app}\bin"; DestName: "yt-dlp.exe"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\strivo.ico"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"; IconFilename: "{app}\strivo.ico"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\strivo.ico"; Tasks: desktopicon

[Run]
; "Start with Windows" task: shells out to `strivo enable`, which registers
; a Task Scheduler logon task itself on Windows (no admin rights needed for
; that step) -- this installer does not reimplement service registration,
; per the task brief. Runs silently, once, right after file copy.
Filename: "{app}\{#MyAppExeName}"; Parameters: "enable"; WorkingDir: "{app}"; Tasks: startwithwindows; Flags: runhidden

; Finish-page "Launch StriVo now" checkbox. A single Run entry rather than
; launching strivo.exe directly here, because "launch, then wait for the
; port, then open a browser" needs a short poll loop -- see
; launch-and-open.ps1. `nowait` so Setup's own process can exit immediately
; instead of waiting on the launched app.
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\launch-and-open.ps1"""; WorkingDir: "{app}"; Description: "Launch StriVo now"; Flags: postinstall skipifsilent nowait runhidden

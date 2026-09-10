#Requires -Version 5.1
<#
.SYNOPSIS
    Downloads, sha256-verifies, and extracts StriVo's vendored Windows tool
    binaries (ffmpeg/ffprobe, mpv, streamlink, yt-dlp) per
    packaging/vendored-deps.toml, then compiles packaging/windows/strivo.iss
    into the Inno Setup installer.

.DESCRIPTION
    Meant to run on the win11-ci self-hosted runner, invoked by
    .github/workflows/release.yml's build-windows job AFTER
    `cargo build --release --locked` has already produced
    target\release\strivo.exe. This script does not build strivo.exe itself.

    Every downloaded archive is verified against the sha256 pinned in
    packaging/vendored-deps.toml before anything is extracted from it --
    a mismatch fails the whole run loudly rather than silently shipping an
    unverified binary.

    See docs/adr/0003-installer-packaging-and-bundled-dependencies.md and
    docs/PACKAGING-PLAN.md for why each tool is bundled this way, and
    packaging/windows/strivo.iss's own header comment for the /D<name>
    contract this script and that script must agree on.

.PARAMETER RepoRoot
    Repository root. Defaults to two directories up from this script
    (packaging\windows\..\..).

.PARAMETER StrivoExePath
    Path to the already-built release strivo.exe. Defaults to
    target\release\strivo.exe under RepoRoot.

.PARAMETER IsccPath
    Path to Inno Setup's command-line compiler. Defaults to searching PATH
    and the two conventional Inno Setup 6 install locations.
#>
[CmdletBinding()]
param(
    [string]$RepoRoot = $null,
    [string]$StrivoExePath = $null,
    [string]$VendoredDepsPath = $null,
    [string]$WorkDir = $null,
    [string]$IsccPath = 'ISCC.exe'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Older Windows PowerShell 5.1 defaults can exclude TLS 1.2, which GitHub's
# download endpoints require -- force it rather than fail with an opaque
# connection error on a fresh runner image.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function Write-Step {
    param([string]$Message)
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Fail {
    param([string]$Message)
    Write-Error $Message
    exit 1
}

if (-not $RepoRoot) {
    $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}
if (-not $StrivoExePath) {
    $StrivoExePath = Join-Path $RepoRoot 'target\release\strivo.exe'
}
if (-not $VendoredDepsPath) {
    $VendoredDepsPath = Join-Path $RepoRoot 'packaging\vendored-deps.toml'
}
if (-not $WorkDir) {
    $WorkDir = Join-Path $RepoRoot 'target\windows-installer-build'
}

# ---------------------------------------------------------------------------
# Minimal vendored-deps.toml reader.
#
# Deliberately not a general TOML parser -- just enough to read this one
# file's shape: `[section.subsection]` headers and `key = "value"` scalar
# lines. Multi-line triple-quoted `notes = """..."""` blocks (used for
# `status = "unresolved"` rows) are skipped entirely since nothing here
# needs their contents; skipping them correctly (rather than misparsing
# their body text as keys) is the one thing this parser has to get right
# beyond the simple case.
# ---------------------------------------------------------------------------
function Read-VendoredDepsToml {
    param([string]$Path)

    if (-not (Test-Path $Path)) {
        Fail "vendored-deps.toml not found at $Path"
    }

    $sections = @{}
    $currentSection = $null
    $inTripleQuoted = $false

    foreach ($rawLine in Get-Content -Path $Path) {
        if ($inTripleQuoted) {
            if ($rawLine -match '"""') { $inTripleQuoted = $false }
            continue
        }

        $trimmed = $rawLine.Trim()
        if ($trimmed -eq '' -or $trimmed.StartsWith('#')) { continue }

        if ($trimmed -match '^\[([A-Za-z0-9_.\-]+)\]$') {
            $currentSection = $Matches[1]
            if (-not $sections.ContainsKey($currentSection)) {
                $sections[$currentSection] = @{}
            }
            continue
        }

        if (-not $currentSection) { continue }

        if ($trimmed -match '^([A-Za-z0-9_]+)\s*=\s*"""(.*)$') {
            $rest = $Matches[2]
            if ($rest -notmatch '"""') {
                # Opening line of a multi-line block; the closing `"""`
                # lands on a later line, handled by the branch above.
                $inTripleQuoted = $true
            }
            continue
        }

        if ($trimmed -match '^([A-Za-z0-9_]+)\s*=\s*"([^"]*)"\s*$') {
            $sections[$currentSection][$Matches[1]] = $Matches[2]
            continue
        }
    }

    return $sections
}

function Get-RequiredField {
    param($Sections, [string]$SectionKey, [string]$Field)
    if (-not $Sections.ContainsKey($SectionKey)) {
        Fail "vendored-deps.toml: missing section [$SectionKey]"
    }
    $section = $Sections[$SectionKey]
    if (-not $section.ContainsKey($Field)) {
        Fail "vendored-deps.toml: [$SectionKey] is missing '$Field'"
    }
    return $section[$Field]
}

function Assert-Resolved {
    param($Sections, [string]$SectionKey)
    $status = Get-RequiredField $Sections $SectionKey 'status'
    if ($status -ne 'resolved') {
        Fail "vendored-deps.toml: [$SectionKey] status is '$status', not 'resolved' -- refusing to build an installer with an unpinned/unverified dependency"
    }
}

function Get-VerifiedFile {
    param([string]$Url, [string]$Sha256, [string]$DestPath)

    if (Test-Path $DestPath) { Remove-Item -Path $DestPath -Force }

    Write-Step "Downloading $Url"
    Invoke-WebRequest -Uri $Url -OutFile $DestPath -UseBasicParsing

    $expected = $Sha256.ToLowerInvariant()
    $actual = (Get-FileHash -Path $DestPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) {
        Fail "sha256 mismatch for $Url`n  expected: $expected`n  actual:   $actual`nRefusing to use an unverified download -- re-check the pin in packaging/vendored-deps.toml."
    }
    Write-Host "    sha256 OK ($actual)"
}

function Get-SevenZipPath {
    $fromPath = Get-Command '7z.exe' -ErrorAction SilentlyContinue
    if ($fromPath) { return $fromPath.Source }

    $candidates = @(
        'C:\Program Files\7-Zip\7z.exe',
        'C:\Program Files (x86)\7-Zip\7z.exe'
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { return $c }
    }

    Fail "7-Zip (7z.exe) not found on PATH or in either conventional install location. Required to extract mpv's .7z build. Install it on win11-ci (e.g. 'winget install -e --id 7zip.7zip') or add it to PATH."
}

function Get-IsccExe {
    param([string]$Preferred)

    if ($Preferred -and $Preferred -ne 'ISCC.exe') {
        if (Test-Path $Preferred) { return $Preferred }
        Fail "ISCC.exe not found at explicitly requested path: $Preferred"
    }

    $fromPath = Get-Command 'ISCC.exe' -ErrorAction SilentlyContinue
    if ($fromPath) { return $fromPath.Source }

    $candidates = @(
        'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
        'C:\Program Files\Inno Setup 6\ISCC.exe'
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { return $c }
    }

    Fail "ISCC.exe (Inno Setup's command-line compiler) not found on PATH or in either conventional Inno Setup 6 install location. Install Inno Setup on win11-ci."
}

try {
    if (-not (Test-Path $StrivoExePath)) {
        Fail "strivo.exe not found at $StrivoExePath -- run 'cargo build --release --locked' first."
    }

    Write-Step "Reading $VendoredDepsPath"
    $deps = Read-VendoredDepsToml -Path $VendoredDepsPath

    $requiredSections = @(
        'ffmpeg.windows_x86_64',
        'mpv.windows_x86_64',
        'streamlink.windows_x86_64',
        'yt-dlp.windows_x86_64'
    )
    foreach ($key in $requiredSections) {
        Assert-Resolved $deps $key
    }

    New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
    $downloadDir = Join-Path $WorkDir 'downloads'
    $extractDir = Join-Path $WorkDir 'extracted'
    New-Item -ItemType Directory -Force -Path $downloadDir | Out-Null
    New-Item -ItemType Directory -Force -Path $extractDir | Out-Null

    $sevenZip = Get-SevenZipPath
    Write-Step "Using 7-Zip: $sevenZip"

    # --- ffmpeg + ffprobe (BtbN LGPL zip) ----------------------------------
    Write-Step 'ffmpeg / ffprobe'
    $ffmpegUrl = Get-RequiredField $deps 'ffmpeg.windows_x86_64' 'url'
    $ffmpegSha = Get-RequiredField $deps 'ffmpeg.windows_x86_64' 'sha256'
    $ffmpegZip = Join-Path $downloadDir 'ffmpeg-win64-lgpl.zip'
    Get-VerifiedFile -Url $ffmpegUrl -Sha256 $ffmpegSha -DestPath $ffmpegZip

    $ffmpegExtract = Join-Path $extractDir 'ffmpeg'
    Expand-Archive -Path $ffmpegZip -DestinationPath $ffmpegExtract -Force
    $ffmpegExe = Get-ChildItem -Path $ffmpegExtract -Recurse -Filter 'ffmpeg.exe' | Select-Object -First 1
    $ffprobeExe = Get-ChildItem -Path $ffmpegExtract -Recurse -Filter 'ffprobe.exe' | Select-Object -First 1
    if (-not $ffmpegExe) { Fail 'ffmpeg.exe not found inside the extracted BtbN zip' }
    if (-not $ffprobeExe) { Fail 'ffprobe.exe not found inside the extracted BtbN zip' }

    # --- mpv (shinchiro .7z) ------------------------------------------------
    Write-Step 'mpv'
    $mpvUrl = Get-RequiredField $deps 'mpv.windows_x86_64' 'url'
    $mpvSha = Get-RequiredField $deps 'mpv.windows_x86_64' 'sha256'
    $mpv7z = Join-Path $downloadDir 'mpv.7z'
    Get-VerifiedFile -Url $mpvUrl -Sha256 $mpvSha -DestPath $mpv7z

    $mpvExtract = Join-Path $extractDir 'mpv'
    New-Item -ItemType Directory -Force -Path $mpvExtract | Out-Null
    # .7z is not something Expand-Archive understands -- it only handles
    # .zip. 7-Zip is required for this one.
    & $sevenZip x $mpv7z "-o$mpvExtract" -y | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "7z extraction of mpv.7z failed (exit $LASTEXITCODE)" }
    $mpvExe = Get-ChildItem -Path $mpvExtract -Recurse -Filter 'mpv.exe' | Select-Object -First 1
    if (-not $mpvExe) { Fail 'mpv.exe not found inside the extracted 7z archive' }

    # --- streamlink (windows-builds portable zip) ---------------------------
    Write-Step 'streamlink'
    $streamlinkUrl = Get-RequiredField $deps 'streamlink.windows_x86_64' 'url'
    $streamlinkSha = Get-RequiredField $deps 'streamlink.windows_x86_64' 'sha256'
    $streamlinkZip = Join-Path $downloadDir 'streamlink-portable.zip'
    Get-VerifiedFile -Url $streamlinkUrl -Sha256 $streamlinkSha -DestPath $streamlinkZip

    $streamlinkExtract = Join-Path $extractDir 'streamlink'
    Expand-Archive -Path $streamlinkZip -DestinationPath $streamlinkExtract -Force

    # bin\streamlink.exe is NOT self-contained: it's a shebang-style stub
    # (verified via `strings streamlink.exe`: "#!<launcher_dir>\..\Python\
    # python.exe") that locates its interpreter one directory up from
    # itself. Extracting the .exe alone -- without its sibling Python\ and
    # pkgs\ directories from the same release layout -- produces a file
    # that looks fine and fails to launch. Take all three, preserving the
    # relative layout: strivo.iss lands streamlink.exe in {app}\bin\ and
    # Python\ + pkgs\ as siblings of {app}\bin\, i.e. at {app}\Python\ and
    # {app}\pkgs\, which is exactly the "..\Python\" the stub expects.
    #
    # The zip also bundles its own ffmpeg\ folder -- deliberately not taken:
    # StriVo vendors ffmpeg separately via BtbN (see this file's ffmpeg step
    # above), so there is exactly one ffmpeg build/license per install, not
    # two.
    $streamlinkRoot = Get-ChildItem -Path $streamlinkExtract -Directory | Select-Object -First 1
    if (-not $streamlinkRoot) { Fail 'streamlink zip extracted no top-level directory' }
    $streamlinkExe = Join-Path $streamlinkRoot.FullName 'bin\streamlink.exe'
    $streamlinkPythonDir = Join-Path $streamlinkRoot.FullName 'Python'
    $streamlinkPkgsDir = Join-Path $streamlinkRoot.FullName 'pkgs'
    foreach ($p in @($streamlinkExe, $streamlinkPythonDir, $streamlinkPkgsDir)) {
        if (-not (Test-Path $p)) { Fail "expected streamlink payload path missing: $p" }
    }

    # --- yt-dlp (already a standalone .exe) ---------------------------------
    Write-Step 'yt-dlp'
    $ytdlpUrl = Get-RequiredField $deps 'yt-dlp.windows_x86_64' 'url'
    $ytdlpSha = Get-RequiredField $deps 'yt-dlp.windows_x86_64' 'sha256'
    $ytdlpExe = Join-Path $extractDir 'yt-dlp.exe'
    Get-VerifiedFile -Url $ytdlpUrl -Sha256 $ytdlpSha -DestPath $ytdlpExe

    # --- Compile the installer ----------------------------------------------
    $iscc = Get-IsccExe -Preferred $IsccPath
    Write-Step "Using Inno Setup: $iscc"

    $issPath = Join-Path $RepoRoot 'packaging\windows\strivo.iss'
    if (-not (Test-Path $issPath)) { Fail "strivo.iss not found at $issPath" }

    # These /D<name> flags are the contract with strivo.iss's "Build inputs"
    # block -- the names must match exactly, or ISCC falls back to that
    # script's dev-checkout defaults instead of these verified paths.
    $defines = @(
        "/DStrivoExePath=$StrivoExePath",
        "/Dffmpeg_exe=$($ffmpegExe.FullName)",
        "/Dffprobe_exe=$($ffprobeExe.FullName)",
        "/Dmpv_exe=$($mpvExe.FullName)",
        "/Dstreamlink_exe=$streamlinkExe",
        "/Dstreamlink_python_dir=$streamlinkPythonDir",
        "/Dstreamlink_pkgs_dir=$streamlinkPkgsDir",
        "/Dyt_dlp_exe=$ytdlpExe"
    )

    Write-Step "Compiling: $iscc $($defines -join ' ') $issPath"
    & $iscc @defines $issPath
    if ($LASTEXITCODE -ne 0) { Fail "ISCC.exe failed (exit $LASTEXITCODE)" }

    $outputDir = Join-Path $RepoRoot 'dist\windows-installer'
    $installer = Get-ChildItem -Path $outputDir -Filter 'strivo-*-setup.exe' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $installer) {
        Fail "ISCC.exe reported success but no installer .exe was found under $outputDir"
    }

    $hash = (Get-FileHash -Path $installer.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    # Same "<hash>  <filename>" sha256sum-compatible sidecar format the
    # Linux/macOS/Windows-zip jobs in .github/workflows/release.yml already
    # use.
    "$hash  $($installer.Name)" | Out-File -FilePath "$($installer.FullName).sha256" -Encoding ascii

    Write-Step "Built $($installer.FullName)"
    Write-Step "sha256: $hash"
}
catch {
    Write-Error "build-installer.ps1 failed: $($_.Exception.Message)"
    Write-Error $_.ScriptStackTrace
    exit 1
}

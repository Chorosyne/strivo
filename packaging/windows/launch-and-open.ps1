# Invoked by strivo.iss's Finish-page "Launch StriVo now" checkbox (a single
# [Run] entry runs this rather than launching strivo.exe directly), so one
# checkbox both starts the daemon+webui and opens the browser once it is
# actually ready, instead of racing a fixed Start-Process + open-browser pair.
#
# `strivo.exe` with no subcommand is the "default webui" entry point: it
# spawns the daemon in-process and serves the SPA on 127.0.0.1:8181 (see
# crates/strivo-bin/src/main.rs's `run_default_webui`). That first-run page
# (`renderFirstRun`) is where credentials/recording-dir/channel setup
# happens -- this script's only job is "launch it, then open a browser to
# it once it's listening."
$ErrorActionPreference = 'SilentlyContinue'

$exeDir = $PSScriptRoot
$exe = Join-Path $exeDir 'strivo.exe'
$port = 8181
$url = "http://127.0.0.1:$port"

Start-Process -FilePath $exe -WorkingDirectory $exeDir

# Simple poll loop, not a real health check: give the daemon up to ~15s to
# bind its port (30 x 500ms) before giving up and opening the browser
# anyway. If it's merely slow rather than broken, the page just needs a
# manual reload; if it's actually broken, `strivo doctor` from a terminal
# is the real diagnostic, not this script.
$bound = $false
for ($i = 0; $i -lt 30; $i++) {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $client.Connect('127.0.0.1', $port)
        $client.Close()
        $bound = $true
        break
    } catch {
        Start-Sleep -Milliseconds 500
    }
}

Start-Process $url

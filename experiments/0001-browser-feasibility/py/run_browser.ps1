# One browser run of the spike page, with a throwaway profile and memory sampling.
#   run_browser.ps1 -Browser edge|chrome|firefox -Query "ep=wasm" -Tag edge-wasm [-Page index.html] [-Extra flag,...] [-Headed] [-TimeoutMin 45]
param([string]$Browser, [string]$Query, [string]$Tag, [string]$Page = 'index.html', [string[]]$Extra = @(),
      [int]$TimeoutMin = 45, [switch]$Headed)

$Spike = Split-Path -Parent $PSScriptRoot
$exe = @{ edge    = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
          chrome  = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
          firefox = 'C:\Program Files\Mozilla Firefox\firefox.exe' }[$Browser]
$prof = Join-Path $Spike "profiles\$Tag"
New-Item -ItemType Directory -Force $prof | Out-Null
$result = Join-Path $Spike "results\$Tag.json"
$memCsv = Join-Path $Spike "results\$Tag.mem.csv"
Remove-Item $result -ErrorAction SilentlyContinue
$url = "http://127.0.0.1:8765/$Page`?$Query&tag=$Tag"

if ($Browser -eq 'firefox') {
    $argList = @('-profile', $prof, '-no-remote', '-new-instance')
    if (-not $Headed) { $argList += '-headless' }
} else {
    $argList = @("--user-data-dir=$prof", '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync')
    if (-not $Headed) { $argList += '--headless=new' }
}
$argList += $Extra
$argList += $url

# This instance's processes: the ones started with our profile path, and their children
function Get-OurProcessIds {
    $all = Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe' OR Name='firefox.exe'"
    $rootIds = @($all | Where-Object { $_.CommandLine -like "*$prof*" } | ForEach-Object { $_.ProcessId })
    if ($rootIds.Count -eq 0) { return @() }
    return @($all | Where-Object { ($rootIds -contains $_.ProcessId) -or ($rootIds -contains $_.ParentProcessId) } | ForEach-Object { $_.ProcessId })
}

"time,processes,working_set_mb,private_mb" | Set-Content -Encoding utf8 $memCsv
Start-Process -FilePath $exe -ArgumentList $argList | Out-Null
$deadline = (Get-Date).AddMinutes($TimeoutMin)
while (-not (Test-Path $result) -and (Get-Date) -lt $deadline) {
    $ids = Get-OurProcessIds
    if ($ids.Count -gt 0) {
        $p = Get-Process -Id $ids -ErrorAction SilentlyContinue
        $ws = [int](($p | Measure-Object WorkingSet64 -Sum).Sum / 1MB)
        $pr = [int](($p | Measure-Object PrivateMemorySize64 -Sum).Sum / 1MB)
        "$(Get-Date -Format HH:mm:ss),$(@($p).Count),$ws,$pr" | Add-Content -Encoding utf8 $memCsv
    }
    Start-Sleep -Seconds 2
}

$ids = Get-OurProcessIds
if ($ids.Count -gt 0) { Stop-Process -Id $ids -Force -ErrorAction SilentlyContinue }
$mem = Import-Csv $memCsv
"peak working set MB: " + (($mem | ForEach-Object { [int]$_.working_set_mb } | Measure-Object -Maximum).Maximum)
"peak private MB:     " + (($mem | ForEach-Object { [int]$_.private_mb } | Measure-Object -Maximum).Maximum)
if (Test-Path $result) {
    $r = Get-Content $result -Raw | ConvertFrom-Json
    "isolated=$($r.isolated) threads=$($r.ortWasmThreads) load=$($r.modelLoadS)s first=$($r.firstRunS)s gpu=$($r.gpuAdapter | ConvertTo-Json -Compress)"
    if ($r.error) { "ERROR: $($r.error)" }
    if ($r.fixtureSummary) { "fixture: " + ($r.fixtureSummary | ConvertTo-Json -Compress) }
    if ($r.long) { "one hour: " + ($r.long | Select-Object windows, windowsNotebook, maxAbsWindowDiff, maxAbsDp, detectionsNotebook, detectionsDiffer, top10Differ, windowsPerS, wallS | ConvertTo-Json -Compress) }
} else { "TIMEOUT after $TimeoutMin min, no result" }

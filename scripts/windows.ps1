param([ValidateSet('install', 'configure', 'start', 'preview', 'sync', 'doctor', 'demo')][string]$Action)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $projectRoot '.local-browsers'
$configPath = Join-Path $projectRoot 'config.json'
try {
    if (-not (Test-Path -LiteralPath $configPath)) {
        Copy-Item -LiteralPath (Join-Path $projectRoot 'config.example.json') -Destination $configPath
    }
    if ($Action -eq 'configure') {
        Write-Host 'Edit qq.appId, qq.appSecret and bungie.apiKey. Keep this file private.'
        & notepad.exe $configPath
        exit 0
    }
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    $nodeExecutable = if ($nodeCommand) { $nodeCommand.Source } else { $null }
    $bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    if (-not $nodeExecutable -and (Test-Path -LiteralPath $bundledNode)) { $nodeExecutable = $bundledNode }
    if (-not $nodeExecutable) {
        throw 'Install Node.js 24 LTS (Windows) from https://nodejs.org/en/download, then run this script again.'
    }
    $version = (& $nodeExecutable -p 'process.versions.node.match(/^\d+/)[0]')
    if ($LASTEXITCODE -ne 0 -or [int]$version -lt 22) { throw 'Node.js 22 or newer is required. Node.js 24 LTS is recommended.' }
    if ($Action -eq 'install') {
        if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'npm.cmd is missing. Reinstall Node.js with npm included.' }
        Write-Host '[1/3] Installing locked dependencies...'
        & npm.cmd ci --ignore-scripts --no-audit --no-fund --cache (Join-Path $projectRoot '.npm-cache')
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Check your network and try again.' }
        Write-Host '[2/3] Installing the image rendering browser...'
        & $nodeExecutable node_modules/playwright/cli.js install chromium
        if ($LASTEXITCODE -ne 0) { throw 'Chromium download failed. Check your network and rerun 01-install.cmd.' }
        Write-Host '[3/3] Running local tests...'
        & $nodeExecutable --test
        if ($LASTEXITCODE -ne 0) { throw 'Tests failed. Keep the terminal output for troubleshooting.' }
        Write-Host 'Ready. Run 02-configure.cmd, then 05-sync-destiny.cmd and 03-start.cmd.'
        exit 0
    }
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules'))) { throw 'Run 01-install.cmd first.' }
    switch ($Action) {
        'start' { & $nodeExecutable src/main.js }
        'preview' { & $nodeExecutable scripts/preview.js }
        'sync' { & $nodeExecutable scripts/sync-manifest.js }
        'doctor' { & $nodeExecutable scripts/doctor.js }
        'demo' { & $nodeExecutable scripts/local-console.js }
    }
    if ($LASTEXITCODE -ne 0) { throw "The $Action command reported a problem. See the message above." }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}

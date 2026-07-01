# Assemble sdk/ for the extension: SDK build scripts only.
#
# Host tools (imagebld, xdvdfs, xbcp, xbox-launch, xboxdbg-bridge, xbwatson) are
# NOT bundled in the VSIX anymore — the extension downloads them per-platform at
# runtime via its host-tools prerequisite (src/hostTools.ts) into …/RXDK/tools.
# Headers/libs are cloned from RXDK-SDK on extension activate. The -CrossPlatformTools
# / -WindowsOnly switches are accepted for pipeline compatibility but no longer stage
# anything (tools are runtime-only). For a headless dev/CI setup that populates the
# staged tool + SDK roots, use scripts/setup.ps1.
param(
    [string]$ExtensionRoot = (Join-Path $PSScriptRoot '..'),
    [switch]$CrossPlatformTools,
    [switch]$WindowsOnly,
    [switch]$Force
)
$ErrorActionPreference = 'Stop'
$ExtensionRoot = [IO.Path]::GetFullPath($ExtensionRoot)
$sdkRoot = Join-Path $ExtensionRoot 'sdk'
$sdkScriptsSrc = Join-Path $PSScriptRoot 'sdk'

# Clean any previously-staged include/lib/tools (all runtime-provided now).
$scriptsDest = Join-Path $sdkRoot 'scripts'
foreach ($stale in @('include', 'lib', 'tools')) {
    $stalePath = Join-Path $sdkRoot $stale
    if (Test-Path -LiteralPath $stalePath) {
        Remove-Item -LiteralPath $stalePath -Recurse -Force
    }
}
if (Test-Path -LiteralPath $scriptsDest) {
    Remove-Item -LiteralPath $scriptsDest -Recurse -Force
}
if (-not (Test-Path -LiteralPath $sdkScriptsSrc)) {
    throw "Missing SDK build scripts at $sdkScriptsSrc"
}
Copy-Item -LiteralPath $sdkScriptsSrc -Destination $scriptsDest -Recurse -Force

@"
rxdk-sdk=cloned-on-activate
tools=runtime-prerequisite
staged=$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ss')
"@ | Set-Content -LiteralPath (Join-Path $sdkRoot 'VERSION.txt') -Encoding ASCII

Write-Host "OK: assembled sdk/ (build scripts only; tools via runtime prerequisite, include/lib from RXDK-SDK clone on activate)" -ForegroundColor Green

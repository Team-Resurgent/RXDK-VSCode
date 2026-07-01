# Populate sdk/ and compile extension into dist/. Host tools are downloaded from
# the Team-Resurgent/RXDK-Tools + xdvdfs GitHub releases (no submodule needed).
# Headers/libs are cloned from RXDK-SDK on extension activate (not bundled in the VSIX).
param(
    [string]$ExtensionRoot = (Join-Path $PSScriptRoot '..'),
    [switch]$Package,
    [switch]$CrossPlatformTools,
    [switch]$WindowsOnly,
    [switch]$InstallExtension
)
$ErrorActionPreference = 'Stop'
$ExtensionRoot = [IO.Path]::GetFullPath($ExtensionRoot)

function Test-StepExitCode {
    param(
        [Parameter(Mandatory)]
        [string]$StepName,
        [switch]$RobocopyAware
    )
    if ($RobocopyAware) {
        if ($LASTEXITCODE -ge 8) {
            throw "$StepName failed (exit $LASTEXITCODE)"
        }
        return
    }
    if ($LASTEXITCODE -ne 0) {
        throw "$StepName failed (exit $LASTEXITCODE)"
    }
}

Write-Host '=== RXDK-SDK ===' -ForegroundColor Cyan
Write-Host 'Headers/libs: cloned from https://github.com/Team-Resurgent/RXDK-SDK on extension activate' -ForegroundColor Green

Write-Host '=== Assemble sdk/ ===' -ForegroundColor Cyan
$assembleArgs = @{
    ExtensionRoot = $ExtensionRoot
}
if ($CrossPlatformTools) { $assembleArgs['CrossPlatformTools'] = $true }
if ($WindowsOnly) { $assembleArgs['WindowsOnly'] = $true }
& (Join-Path $ExtensionRoot 'scripts\assemble-sdk.ps1') @assembleArgs
Test-StepExitCode -StepName 'assemble-sdk.ps1'

Write-Host '=== npm install + compile ===' -ForegroundColor Cyan
Push-Location $ExtensionRoot
try {
    if (-not (Test-Path 'node_modules')) {
        npm install
        if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
    }
    npm run compile
    if ($LASTEXITCODE -ne 0) { throw 'npm run compile failed' }
} finally {
    Pop-Location
}

$version = Get-Content -LiteralPath (Join-Path $ExtensionRoot 'sdk\VERSION.txt') -ErrorAction SilentlyContinue
Write-Host @"

=== RXDK-VSCode ready ===
Extension: $ExtensionRoot
Host tools: downloaded per-platform at runtime (host-tools prerequisite)
Version: $($version -join ' | ')

Next: open RXDK-VSCode in VS Code, or run with -Package to build VSIX.
"@ -ForegroundColor Green

if ($Package) {
    $packageArgs = @{ ExtensionRoot = $ExtensionRoot }
    if ($CrossPlatformTools) { $packageArgs['CrossPlatformTools'] = $true }
    if ($WindowsOnly) { $packageArgs['WindowsOnly'] = $true }
    & (Join-Path $ExtensionRoot 'scripts\package.ps1') @packageArgs
}

if ($InstallExtension) {
    $vsix = Get-ChildItem -LiteralPath $ExtensionRoot -Filter 'rxdk-vscode-*.vsix' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $vsix) { throw 'No VSIX found; run with -Package first' }
    & (Join-Path $ExtensionRoot 'scripts\install-extension.ps1') -ExtensionRoot $ExtensionRoot -VsixPath $vsix.FullName -Target auto -Force
}

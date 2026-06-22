# Populate out/sdk and compile extension into out/. Requires external/RXDK-Tools submodule.
# Headers/libs are cloned from RXDK-SDK on extension activate (not bundled in the VSIX).
param(
    [string]$RxdkToolsRoot = (Join-Path $PSScriptRoot '..\external\RXDK-Tools'),
    [string]$ExtensionRoot = (Join-Path $PSScriptRoot '..'),
    [switch]$BuildTools,
    [switch]$Package,
    [switch]$CrossPlatformTools,
    [switch]$InstallExtension
)
$ErrorActionPreference = 'Stop'
$RxdkToolsRoot = [IO.Path]::GetFullPath($RxdkToolsRoot)
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

if (-not (Test-Path -LiteralPath $RxdkToolsRoot)) {
    throw "RXDK-Tools submodule not found at $RxdkToolsRoot. Run: git submodule update --init external/RXDK-Tools"
}

Write-Host '=== RXDK-SDK ===' -ForegroundColor Cyan
Write-Host 'Headers/libs: cloned from https://github.com/Team-Resurgent/RXDK-SDK on extension activate' -ForegroundColor Green

Write-Host '=== Assemble out/sdk ===' -ForegroundColor Cyan
$assembleArgs = @{
    RxdkToolsRoot = $RxdkToolsRoot
    ExtensionRoot = $ExtensionRoot
}
if ($BuildTools) { $assembleArgs['BuildTools'] = $true }
if ($CrossPlatformTools) { $assembleArgs['CrossPlatformTools'] = $true }
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

$toolCount = (Get-ChildItem -LiteralPath (Join-Path $ExtensionRoot 'out\sdk\tools') -Recurse -File -ErrorAction SilentlyContinue).Count
$version = Get-Content -LiteralPath (Join-Path $ExtensionRoot 'out\sdk\VERSION.txt') -ErrorAction SilentlyContinue
Write-Host @"

=== RXDK-VSCode ready ===
Extension: $ExtensionRoot
SDK tools: $toolCount files
Version: $($version -join ' | ')

Next: open RXDK-VSCode in VS Code, or run with -Package to build VSIX.
"@ -ForegroundColor Green

if ($Package) {
    $packageArgs = @{ ExtensionRoot = $ExtensionRoot; BuildTools = [bool]$BuildTools }
    if ($CrossPlatformTools) { $packageArgs['CrossPlatformTools'] = $true }
    & (Join-Path $ExtensionRoot 'scripts\package.ps1') @packageArgs
}

if ($InstallExtension) {
    $vsix = Get-ChildItem -LiteralPath $ExtensionRoot -Filter 'rxdk-vscode-*.vsix' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $vsix) { throw 'No VSIX found; run with -Package first' }
    & (Join-Path $ExtensionRoot 'scripts\install-extension.ps1') -ExtensionRoot $ExtensionRoot -VsixPath $vsix.FullName -Target auto
}

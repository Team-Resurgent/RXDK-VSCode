# Populate out/sdk and compile extension into out/. Requires external/ submodules. Templates live in templates/.
param(
    [string]$RxdkLibsRoot = (Join-Path $PSScriptRoot '..\external\RXDK-Libs'),
    [string]$RxdkToolsRoot = (Join-Path $PSScriptRoot '..\external\RXDK-Tools'),
    [string]$ExtensionRoot = (Join-Path $PSScriptRoot '..'),
    [switch]$Build,
    [switch]$BuildTools,
    [switch]$Package,
    [switch]$CrossPlatformTools,
    [switch]$InstallExtension
)
$ErrorActionPreference = 'Stop'
$RxdkLibsRoot = [IO.Path]::GetFullPath($RxdkLibsRoot)
$RxdkToolsRoot = [IO.Path]::GetFullPath($RxdkToolsRoot)
$ExtensionRoot = [IO.Path]::GetFullPath($ExtensionRoot)

function Test-StepExitCode {
    param(
        [Parameter(Mandatory)]
        [string]$StepName,
        [switch]$RobocopyAware
    )
    if ($RobocopyAware) {
        # robocopy uses 0-7 for success (files copied/extra dirs); only >= 8 is failure.
        if ($LASTEXITCODE -ge 8) {
            throw "$StepName failed (exit $LASTEXITCODE)"
        }
        return
    }
    if ($LASTEXITCODE -ne 0) {
        throw "$StepName failed (exit $LASTEXITCODE)"
    }
}

function Test-PrebuiltRxdkLibs {
    param([Parameter(Mandatory)][string]$Root)
    $required = @(
        (Join-Path $Root 'out\include\d3d8.h'),
        (Join-Path $Root 'out\lib\libcmt.lib'),
        (Join-Path $Root 'out\lib\libcpmt.lib')
    )
    $missing = @($required | Where-Object { -not (Test-Path -LiteralPath $_) })
    if ($missing.Count -eq 0) {
        return
    }
    throw @"
Missing prebuilt RXDK-Libs consumer output:
$($missing -join [Environment]::NewLine)

Build and commit libs in the RXDK-Libs submodule (out/include + out/lib), then bump the submodule pointer here.
Maintainer full rebuild from this repo: .\scripts\sync-all.ps1 -Build
"@
}

foreach ($sub in @(
        @{ Name = 'RXDK-Libs'; Path = $RxdkLibsRoot; Init = 'external/RXDK-Libs' }
        @{ Name = 'RXDK-Tools'; Path = $RxdkToolsRoot; Init = 'external/RXDK-Tools' }
    )) {
    if (-not (Test-Path -LiteralPath $sub.Path)) {
        throw "$($sub.Name) submodule not found at $($sub.Path). Run: git submodule update --init $($sub.Init)"
    }
}

Write-Host '=== RXDK-Libs ===' -ForegroundColor Cyan
if ($Build) {
    Write-Host '=== RXDK-Libs: sync-modern-stl ===' -ForegroundColor Cyan
    & (Join-Path $RxdkLibsRoot 'scripts\sync-modern-stl.ps1')
    Test-StepExitCode -StepName 'sync-modern-stl.ps1' -RobocopyAware
    $consumerArgs = @{ XdkLibsRoot = $RxdkLibsRoot; Build = $true }
    & (Join-Path $RxdkLibsRoot 'scripts\install-consumer-out.ps1') @consumerArgs
    Test-StepExitCode -StepName 'install-consumer-out.ps1'
} else {
    Test-PrebuiltRxdkLibs -Root $RxdkLibsRoot
    Write-Host 'Using prebuilt RXDK-Libs out/include + out/lib (committed in submodule)' -ForegroundColor Green
}

Write-Host '=== Assemble out/sdk ===' -ForegroundColor Cyan
$assembleArgs = @{
    RxdkLibsRoot  = $RxdkLibsRoot
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

$toolCount = (Get-ChildItem -LiteralPath (Join-Path $ExtensionRoot 'out\sdk\tools') -File -ErrorAction SilentlyContinue).Count
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

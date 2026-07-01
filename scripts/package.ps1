# Package VSIX (assembles sdk/ first).
param(
    [string]$ExtensionRoot = (Join-Path $PSScriptRoot '..'),
    [switch]$CrossPlatformTools,
    [switch]$WindowsOnly
)
$ErrorActionPreference = 'Stop'
$ExtensionRoot = [IO.Path]::GetFullPath($ExtensionRoot)
Push-Location $ExtensionRoot
try {
    $assembleArgs = @{ ExtensionRoot = $ExtensionRoot }
    if ($CrossPlatformTools) { $assembleArgs['CrossPlatformTools'] = $true }
    if ($WindowsOnly) { $assembleArgs['WindowsOnly'] = $true }
    & (Join-Path $PSScriptRoot 'assemble-sdk.ps1') @assembleArgs

    # Host tools are no longer bundled — the extension downloads them per-platform
    # at runtime (host-tools prerequisite), so there is no sdk/tools preflight.
    $required = @(
        'dist\extension\extension.js'
        'dist\debug\adapter.js'
        'sdk\scripts\Build-XboxProject.ps1'
    )
    foreach ($rel in $required) {
        $full = Join-Path $ExtensionRoot ($rel -replace '/', '\')
        if (-not (Test-Path -LiteralPath $full)) {
            throw "Missing required package file: $rel"
        }
    }

    # Stale release zips from a prior build must not be picked up by vsce (they contain the VSIX).
    Get-ChildItem -LiteralPath $ExtensionRoot -Filter 'rxdk-vscode-*.zip' -ErrorAction SilentlyContinue |
        Remove-Item -Force

    npm run package
    if ($LASTEXITCODE -ne 0) { throw "vsce package failed (exit $LASTEXITCODE)" }
    $vsix = Get-ChildItem -LiteralPath $ExtensionRoot -Filter 'rxdk-vscode-*.vsix' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $vsix) {
        throw 'vsce package did not produce rxdk-vscode-*.vsix'
    }
    Write-Host "OK: $($vsix.FullName)" -ForegroundColor Green

    & (Join-Path $PSScriptRoot 'stage-release-zip.ps1') -ExtensionRoot $ExtensionRoot -VsixPath $vsix.FullName
} finally {
    Pop-Location
}

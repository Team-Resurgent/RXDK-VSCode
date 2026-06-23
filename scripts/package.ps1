# Package VSIX (assembles sdk/ first).
param(
    [string]$ExtensionRoot = (Join-Path $PSScriptRoot '..'),
    [switch]$BuildTools,
    [switch]$CrossPlatformTools,
    [switch]$WindowsOnly
)
$ErrorActionPreference = 'Stop'
$ExtensionRoot = [IO.Path]::GetFullPath($ExtensionRoot)
Push-Location $ExtensionRoot
try {
    $assembleArgs = @{ ExtensionRoot = $ExtensionRoot }
    if ($BuildTools) { $assembleArgs['BuildTools'] = $true }
    if ($CrossPlatformTools) { $assembleArgs['CrossPlatformTools'] = $true }
    if ($WindowsOnly) { $assembleArgs['WindowsOnly'] = $true }
    & (Join-Path $PSScriptRoot 'assemble-sdk.ps1') @assembleArgs

    $requiredTools = Join-Path $PSScriptRoot 'required-tools.txt'
    $missing = @()
    Get-Content -LiteralPath $requiredTools | ForEach-Object {
        $rel = $_.Trim()
        if (-not $rel -or $rel.StartsWith('#')) { return }
        $full = Join-Path $ExtensionRoot "sdk\tools\$($rel -replace '/', '\')"
        if (-not (Test-Path -LiteralPath $full)) {
            $missing += $rel
        }
    }
    if ($missing.Count -gt 0) {
        throw "VSIX preflight failed; missing sdk/tools: $($missing -join ', ')"
    }

    $required = @(
        'dist\extension\extension.js'
        'dist\debug\adapter.js'
        'sdk\tools\xbcp.exe'
        'sdk\tools\xboxdbg-bridge.exe'
        'sdk\scripts\Build-XboxProject.ps1'
    )
    if ($CrossPlatformTools) {
        $required += @(
            'sdk\tools\win-x64\xbcp.exe'
            'sdk\tools\linux-x64\xbcp'
            'sdk\tools\linux-x64\xdvdfs'
            'sdk\tools\osx-x64\xdvdfs'
            'sdk\tools\osx-arm64\xdvdfs'
            'sdk\tools\osx-arm64\xboxdbg-bridge'
        )
    }
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

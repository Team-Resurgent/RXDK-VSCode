# Package VSIX (assembles out/sdk/ first).
param(
    [string]$ExtensionRoot = (Join-Path $PSScriptRoot '..'),
    [switch]$BuildTools,
    [switch]$CrossPlatformTools
)
$ErrorActionPreference = 'Stop'
$ExtensionRoot = [IO.Path]::GetFullPath($ExtensionRoot)
Push-Location $ExtensionRoot
try {
    $assembleArgs = @{ ExtensionRoot = $ExtensionRoot }
    if ($BuildTools) { $assembleArgs['BuildTools'] = $true }
    if ($CrossPlatformTools) { $assembleArgs['CrossPlatformTools'] = $true }
    & (Join-Path $PSScriptRoot 'assemble-sdk.ps1') @assembleArgs
    if ($LASTEXITCODE -ne 0) { throw 'assemble-sdk.ps1 failed' }

    # Xbox SDK HTML docs are committed under docs/xboxsdk/ and shipped as-is; we no longer
    # regenerate them from XboxSDK.chm at package time. Fail loudly if they are missing.
    $docsToc = Join-Path $ExtensionRoot 'docs\xboxsdk\toc.json'
    $docsWelcome = Join-Path $ExtensionRoot 'docs\xboxsdk\xbox_pk_welcome.htm'
    if (-not ((Test-Path -LiteralPath $docsToc) -and (Test-Path -LiteralPath $docsWelcome))) {
        throw 'docs/xboxsdk/ is missing toc.json or xbox_pk_welcome.htm. These are tracked in git; restore them (e.g. git checkout docs/xboxsdk).'
    }

    $requiredTools = Join-Path $PSScriptRoot 'required-tools.txt'
    $missing = @()
    Get-Content -LiteralPath $requiredTools | ForEach-Object {
        $rel = $_.Trim()
        if (-not $rel -or $rel.StartsWith('#')) { return }
        $full = Join-Path $ExtensionRoot "out\sdk\tools\$($rel -replace '/', '\')"
        if (-not (Test-Path -LiteralPath $full)) {
            $missing += $rel
        }
    }
    if ($missing.Count -gt 0) {
        throw "VSIX preflight failed; missing out/sdk/tools: $($missing -join ', ')"
    }

    $required = @(
        'out\extension\extension.js'
        'out\debug\adapter.js'
        'out\sdk\include\d3d8.h'
        'out\sdk\lib\libcmt.lib'
        'out\sdk\tools\xbcp.exe'
        'out\sdk\tools\xboxdbg-bridge.exe'
        'out\sdk\scripts\Build-XboxProject.ps1'
        'docs\xboxsdk\toc.json'
        'docs\xboxsdk\xbox_pk_welcome.htm'
    )
    if ($CrossPlatformTools) {
        $required += @(
            'out\sdk\tools\win-x64\xbcp.exe'
            'out\sdk\tools\linux-x64\xbcp'
            'out\sdk\tools\osx-arm64\xboxdbg-bridge'
        )
    }
    foreach ($rel in $required) {
        $full = Join-Path $ExtensionRoot ($rel -replace '/', '\')
        if (-not (Test-Path -LiteralPath $full)) {
            throw "Missing required package file: $rel"
        }
    }

    npm run package
    if ($LASTEXITCODE -ne 0) { throw "vsce package failed (exit $LASTEXITCODE)" }
    $vsix = Get-ChildItem -LiteralPath $ExtensionRoot -Filter 'rxdk-vscode-*.vsix' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($vsix) {
        Write-Host "OK: $($vsix.FullName)" -ForegroundColor Green
    }
} finally {
    Pop-Location
}

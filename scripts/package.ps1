# Package VSIX (assembles sdk/ first).
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

    # Xbox SDK HTML docs: source tree in git; VSIX ships docs/xboxsdk.tar.gz only.
    $docsToc = Join-Path $ExtensionRoot 'docs\xboxsdk\toc.json'
    $docsWelcome = Join-Path $ExtensionRoot 'docs\xboxsdk\xbox_pk_welcome.htm'
    if (-not ((Test-Path -LiteralPath $docsToc) -and (Test-Path -LiteralPath $docsWelcome))) {
        throw 'docs/xboxsdk/ is missing toc.json or xbox_pk_welcome.htm. These are tracked in git; restore them (e.g. git checkout docs/xboxsdk).'
    }
    & (Join-Path $PSScriptRoot 'bundle-xboxsdk-docs.ps1') -ExtensionRoot $ExtensionRoot
    if ($LASTEXITCODE -ne 0) { throw 'bundle-xboxsdk-docs.ps1 failed' }
    $docsArchive = Join-Path $ExtensionRoot 'docs\xboxsdk.tar.gz'
    if (-not (Test-Path -LiteralPath $docsArchive)) {
        throw 'docs/xboxsdk.tar.gz was not created'
    }

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
        'docs\xboxsdk.tar.gz'
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

    npm run package
    if ($LASTEXITCODE -ne 0) { throw "vsce package failed (exit $LASTEXITCODE)" }
    $vsix = Get-ChildItem -LiteralPath $ExtensionRoot -Filter 'rxdk-vscode-*.vsix' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($vsix) {
        Write-Host "OK: $($vsix.FullName)" -ForegroundColor Green
    }
} finally {
    Pop-Location
}

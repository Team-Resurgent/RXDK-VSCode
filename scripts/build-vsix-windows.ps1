# Build a Windows-only RXDK VSIX and install into VS Code / Cursor (local dev).
param(
    [string]$ExtensionRoot = (Join-Path $PSScriptRoot '..'),
    [switch]$SkipToolsBuild,
    [switch]$NoInstall
)
$ErrorActionPreference = 'Stop'
$bound = @{
    WindowsOnly = $true
}
if ($PSBoundParameters.ContainsKey('ExtensionRoot')) { $bound['ExtensionRoot'] = $ExtensionRoot }
if ($SkipToolsBuild) { $bound['SkipToolsBuild'] = $true }
if (-not $NoInstall) { $bound['Install'] = $true }
& (Join-Path $PSScriptRoot 'build-vsix.ps1') @bound

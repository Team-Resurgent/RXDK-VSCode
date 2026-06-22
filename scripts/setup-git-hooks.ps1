# Enable repo git hooks (.githooks/commit-msg blocks Cursor co-author trailers).
param(
    [switch]$Submodules
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

function Enable-Hooks([string]$RepoRoot) {
    if (-not (Test-Path (Join-Path $RepoRoot '.git'))) {
        Write-Warning "Skip (not a git repo): $RepoRoot"
        return
    }
    Push-Location $RepoRoot
    try {
        git config core.hooksPath .githooks
        Write-Host "OK: core.hooksPath=.githooks in $RepoRoot" -ForegroundColor Green
    } finally {
        Pop-Location
    }
}

Enable-Hooks $root
if ($Submodules) {
    Enable-Hooks (Join-Path $root 'external\RXDK-Tools')
}

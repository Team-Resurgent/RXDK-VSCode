# Strip 'Co-authored-by: Cursor <cursoragent@cursor.com>' from all commits (rewrites history).
# After running: force-push affected branches.
param(
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$stripScript = Join-Path $root '.githooks\strip-cursor-coauthor-msg.ps1'

function Test-HasCursorCoauthor([string]$RepoRoot) {
    Push-Location $RepoRoot
    try {
        git log --all --format='%B' | Select-String -Pattern 'cursoragent@cursor\.com' -Quiet
    } finally {
        Pop-Location
    }
}

Push-Location $root
try {
    if (-not (Test-Path $stripScript)) {
        throw "Missing $stripScript"
    }
    if (-not (Test-HasCursorCoauthor $root)) {
        Write-Host "No Cursor co-author trailers in $root" -ForegroundColor DarkGray
        exit 0
    }
    if ($DryRun) {
        Write-Host "[dry-run] Would rewrite history in $root" -ForegroundColor Yellow
        exit 0
    }
    Write-Host "Rewriting commit messages in $root ..." -ForegroundColor Cyan
    $env:FILTER_BRANCH_SQUELCH_WARNING = '1'
    git filter-branch -f --msg-filter "powershell -NoProfile -ExecutionPolicy Bypass -File `"$($stripScript -replace '\\','/')`"" -- --all
    if ($LASTEXITCODE -ne 0) {
        throw "filter-branch failed in $root (exit $LASTEXITCODE)"
    }
} finally {
    Pop-Location
}

Write-Host @"

Done. Verify with:
  git log -5 --format='%B'
  (no Co-authored-by: Cursor lines)

Then force-push rewritten branches:
  git push --force-with-lease origin master

Enable hooks so this does not recur:
  .\scripts\setup-git-hooks.ps1 -Submodules
"@ -ForegroundColor Green

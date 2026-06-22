# Strip 'Co-authored-by: Cursor <cursoragent@cursor.com>' from all commits (rewrites history).
# After running: force-push each affected branch (coordinate RXDK-Libs before RXDK-VSCode).
param(
    [switch]$RxdkLibsOnly,
    [switch]$RxdkVsCodeOnly,
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$libsRoot = Join-Path $root 'external\RXDK-Libs'
$stripScript = Join-Path $root '.githooks\strip-cursor-coauthor-msg.ps1'

function Test-HasCursorCoauthor([string]$RepoRoot) {
    Push-Location $RepoRoot
    try {
        git log --all --format='%B' | Select-String -Pattern 'cursoragent@cursor\.com' -Quiet
    } finally {
        Pop-Location
    }
}

function Invoke-StripCoauthorHistory([string]$RepoRoot) {
    if (-not (Test-Path $stripScript)) {
        throw "Missing $stripScript"
    }
    Push-Location $RepoRoot
    try {
        if (-not (Test-HasCursorCoauthor $RepoRoot)) {
            Write-Host "No Cursor co-author trailers in $RepoRoot" -ForegroundColor DarkGray
            return $null
        }
        if ($DryRun) {
            Write-Host "[dry-run] Would rewrite history in $RepoRoot" -ForegroundColor Yellow
            return $null
        }
        Write-Host "Rewriting commit messages in $RepoRoot ..." -ForegroundColor Cyan
        $env:FILTER_BRANCH_SQUELCH_WARNING = '1'
        git filter-branch -f --msg-filter "powershell -NoProfile -ExecutionPolicy Bypass -File `"$($stripScript -replace '\\','/')`"" -- --all
        if ($LASTEXITCODE -ne 0) {
            throw "filter-branch failed in $RepoRoot (exit $LASTEXITCODE)"
        }
        $original = 'refs/original/refs/heads/main'
        if (-not (git rev-parse --verify $original 2>$null)) {
            $original = 'refs/original/refs/heads/master'
        }
        if (-not (git rev-parse --verify $original 2>$null)) {
            Write-Warning "Could not find refs/original for main/master in $RepoRoot"
            return $null
        }
        $oldShas = @(git rev-list --reverse $original)
        $branch = if (git rev-parse --verify refs/heads/main 2>$null) { 'main' } else { 'master' }
        $newShas = @(git rev-list --reverse "refs/heads/$branch")
        if ($oldShas.Count -ne $newShas.Count) {
            Write-Warning "SHA count mismatch after rewrite ($($oldShas.Count) vs $($newShas.Count)); submodule map may be incomplete"
        }
        $map = @{}
        for ($i = 0; $i -lt [Math]::Min($oldShas.Count, $newShas.Count); $i++) {
            $map[$oldShas[$i]] = $newShas[$i]
        }
        return $map
    } finally {
        Pop-Location
    }
}

function Invoke-RewriteSubmoduleGitlinks {
    param(
        [string]$RepoRoot,
        [hashtable]$ShaMap
    )
    if (-not $ShaMap -or $ShaMap.Count -eq 0) { return }
    Push-Location $RepoRoot
    try {
        Write-Host "Updating external/RXDK-Libs gitlinks in $RepoRoot ..." -ForegroundColor Cyan
        $mapJson = ($ShaMap.GetEnumerator() | ForEach-Object { @($_.Key, $_.Value) }) -join "`n"
        $mapFile = Join-Path $RepoRoot '.git\rxdk-libs-sha-map.txt'
        $lines = @()
        foreach ($k in $ShaMap.Keys) {
            $lines += "$k $($ShaMap[$k])"
        }
        Set-Content -LiteralPath $mapFile -Value $lines -Encoding ASCII

        $indexFilter = @"
powershell -NoProfile -ExecutionPolicy Bypass -Command "& {
  `$map = @{}
  Get-Content '$mapFile' | ForEach-Object {
    `$p = `$_ -split ' ', 2
    if (`$p.Count -eq 2) { `$map[`$p[0]] = `$p[1] }
  }
  `$line = git ls-files -s external/RXDK-Libs 2>`$null
  if (-not `$line) { exit 0 }
  `$old = (`$line -split '\s+')[1]
  if (`$map.ContainsKey(`$old)) {
    git update-index --cacheinfo 160000,`$(`$map[`$old]),external/RXDK-Libs
  }
}"
"@
        git filter-branch -f --index-filter $indexFilter -- --all
        if ($LASTEXITCODE -ne 0) {
            throw "submodule index filter-branch failed (exit $LASTEXITCODE)"
        }
        Remove-Item -LiteralPath $mapFile -Force -ErrorAction SilentlyContinue
    } finally {
        Pop-Location
    }
}

$libsMap = $null
if (-not $RxdkVsCodeOnly) {
    $libsMap = Invoke-StripCoauthorHistory $libsRoot
}

if (-not $RxdkLibsOnly) {
    Invoke-StripCoauthorHistory $root | Out-Null
    if ($libsMap) {
        Invoke-RewriteSubmoduleGitlinks -RepoRoot $root -ShaMap $libsMap
    }
}

Write-Host @"

Done. Verify with:
  git log -5 --format='%B'
  (no Co-authored-by: Cursor lines)

Then force-push rewritten branches (libs first, then parent):
  cd external/RXDK-Libs && git push --force-with-lease origin main
  cd ../.. && git push --force-with-lease origin master

Enable hooks so this does not recur:
  .\scripts\setup-git-hooks.ps1 -Submodules
"@ -ForegroundColor Green

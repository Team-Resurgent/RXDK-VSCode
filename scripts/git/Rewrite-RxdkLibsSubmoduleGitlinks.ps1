# Point RXDK-VSCode external/RXDK-Libs gitlinks at post-rewrite RXDK-Libs SHAs (same tree).
param(
    [string]$VsCodeRoot = (Join-Path $PSScriptRoot '..\..'),
    [string]$LibsRoot = (Join-Path $PSScriptRoot '..\..\external\RXDK-Libs')
)
$ErrorActionPreference = 'Stop'
$VsCodeRoot = [IO.Path]::GetFullPath($VsCodeRoot)
$LibsRoot = [IO.Path]::GetFullPath($LibsRoot)
$rewriteScript = Join-Path $VsCodeRoot '.githooks\rewrite-submodule-gitlink.ps1'

Push-Location $LibsRoot
try {
    $treeToSha = @{}
    git log main --format='%H' | ForEach-Object {
        $sha = $_
        $tree = git rev-parse "${sha}^{tree}"
        $treeToSha[$tree] = $sha
    }
} finally {
    Pop-Location
}

$mapFile = Join-Path $VsCodeRoot '.git\rxdk-libs-tree-map.txt'
$lines = @()
foreach ($entry in $treeToSha.GetEnumerator()) {
    $lines += "$($entry.Key) $($entry.Value)"
}
Set-Content -LiteralPath $mapFile -Value $lines -Encoding ASCII

Push-Location $VsCodeRoot
try {
    Write-Host "Rewriting external/RXDK-Libs gitlinks in RXDK-VSCode ..." -ForegroundColor Cyan
    $env:FILTER_BRANCH_SQUELCH_WARNING = '1'
    $filter = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$($rewriteScript -replace '\\','/')`" -MapFile `"$($mapFile -replace '\\','/')`" -LibsRoot `"$($LibsRoot -replace '\\','/')`""
    git filter-branch -f --index-filter $filter -- --all
    if ($LASTEXITCODE -ne 0) {
        throw "index filter-branch failed (exit $LASTEXITCODE)"
    }
    git for-each-ref refs/original --format='%(refname)' | ForEach-Object { git update-ref -d $_ }
} finally {
    Pop-Location
    Remove-Item -LiteralPath $mapFile -Force -ErrorAction SilentlyContinue
}

Write-Host "OK: submodule gitlinks updated" -ForegroundColor Green
git ls-tree HEAD external/RXDK-Libs

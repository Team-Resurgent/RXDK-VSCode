param(
    [Parameter(Mandatory)][string]$MapFile,
    [Parameter(Mandatory)][string]$LibsRoot
)
$ErrorActionPreference = 'Continue'
$line = git ls-files -s external/RXDK-Libs 2>$null
if (-not $line) { exit 0 }
$old = ($line -split '\s+', 3)[1]
if (-not $old) { exit 0 }

$treeToSha = @{}
Get-Content -LiteralPath $MapFile | ForEach-Object {
    $p = $_ -split ' ', 2
    if ($p.Count -eq 2) { $treeToSha[$p[0]] = $p[1] }
}

Push-Location $LibsRoot
try {
    $tree = (git rev-parse "${old}^{tree}" 2>$null | Out-String).Trim()
    if (-not $tree -or $LASTEXITCODE -ne 0) { exit 0 }
} finally {
    Pop-Location
}
if ($treeToSha.ContainsKey($tree)) {
    git update-index --cacheinfo 160000,$($treeToSha[$tree]),external/RXDK-Libs
}
exit 0

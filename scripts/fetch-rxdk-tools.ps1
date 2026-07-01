# Download prebuilt managed host tools from Team-Resurgent/RXDK-Tools GitHub
# Releases (latest by default, or pinned via scripts/rxdk-tools-release.txt) and
# stage them under vendor/rxdk-tools/publish/<rid>/. Replaces building the tools
# from the (now removed) external/RXDK-Tools submodule.
#
# Each release ships one rxdk-managed-<rid>.zip per RID, laid out as
#   dist/rxdk-managed-<rid>/tools/<tool>[.exe]
# The framework-dependent single-file tools rely on the .NET runtime the
# extension installs as a prerequisite (see dotnetRuntime.ts).
param(
    [string]$ExtensionRoot = (Join-Path $PSScriptRoot '..'),
    [string]$PublishRoot = '',
    [string]$Repo = 'Team-Resurgent/RXDK-Tools',
    [string]$Tag = '',
    [switch]$Force,
    [switch]$WindowsOnly
)
$ErrorActionPreference = 'Stop'
$ExtensionRoot = [IO.Path]::GetFullPath($ExtensionRoot)
if (-not $PublishRoot) {
    $PublishRoot = Join-Path $ExtensionRoot 'vendor\rxdk-tools\publish'
}
$PublishRoot = [IO.Path]::GetFullPath($PublishRoot)

$PinnedTagFile = Join-Path $PSScriptRoot 'rxdk-tools-release.txt'
if (-not $Tag) {
    if (Test-Path -LiteralPath $PinnedTagFile) {
        $Tag = (Get-Content -LiteralPath $PinnedTagFile -Raw).Trim()
    }
    if (-not $Tag) {
        $Tag = 'latest'
    }
}

# The managed tools shipped in each rxdk-managed-<rid>.zip (extension-less on the
# non-Windows RIDs). Extra tools in the zip (xbmkdir/xbdir/...) are staged too;
# assemble-sdk.ps1 picks the ones listed in required-tools.txt.
$AllRids = @('win-x64', 'linux-x64', 'osx-x64', 'osx-arm64')
$Rids = if ($WindowsOnly) { @('win-x64') } else { $AllRids }

function Get-GitHubApiHeaders {
    $headers = @{
        Accept                 = 'application/vnd.github+json'
        'X-GitHub-Api-Version' = '2022-11-28'
    }
    $token = $env:GITHUB_TOKEN
    if (-not $token) { $token = $env:GH_TOKEN }
    if ($token) { $headers['Authorization'] = "Bearer $token" }
    return $headers
}

function Get-ReleaseJson {
    param([string]$Repository, [string]$ReleaseTag)
    $headers = Get-GitHubApiHeaders
    $uri = if ($ReleaseTag -eq 'latest') {
        "https://api.github.com/repos/$Repository/releases/latest"
    } else {
        "https://api.github.com/repos/$Repository/releases/tags/$ReleaseTag"
    }
    Write-Host "Fetching release metadata: $uri" -ForegroundColor DarkGray
    if (-not $headers.ContainsKey('Authorization')) {
        Write-Host 'Unauthenticated GitHub API (60 requests/hour per IP). Set GITHUB_TOKEN or GH_TOKEN in CI.' -ForegroundColor DarkYellow
    }
    try {
        return Invoke-RestMethod -Uri $uri -Headers $headers
    } catch {
        if ($_.Exception.Message -match 'rate limit|403') {
            throw @"
GitHub API rate limit exceeded fetching RXDK-Tools release metadata.
Use a GITHUB_TOKEN (GitHub Actions sets this automatically) or pin scripts/rxdk-tools-release.txt and retry later.
"@
        }
        throw
    }
}

function Find-ReleaseAsset {
    param([object]$Release, [string]$Rid)
    $name = "rxdk-managed-$Rid.zip"
    $asset = @($Release.assets | Where-Object { $_.name -eq $name }) | Select-Object -First 1
    if (-not $asset) {
        throw "No release asset '$name' in $($Release.tag_name)"
    }
    return $asset
}

function Fetch-RidTools {
    param([object]$Release, [string]$Rid)
    $destDir = Join-Path $PublishRoot $Rid
    $marker = Join-Path $destDir 'xbcp.exe'
    $markerNix = Join-Path $destDir 'xbcp'
    if (((Test-Path -LiteralPath $marker) -or (Test-Path -LiteralPath $markerNix)) -and -not $Force) {
        Write-Host "OK: using existing $destDir" -ForegroundColor DarkGray
        return
    }

    $asset = Find-ReleaseAsset -Release $Release -Rid $Rid
    $zipPath = Join-Path ([IO.Path]::GetTempPath()) $asset.name
    $extractDir = Join-Path ([IO.Path]::GetTempPath()) "rxdk-tools-$Rid-$([Guid]::NewGuid().ToString('n'))"
    try {
        Write-Host "Downloading $($asset.name)..." -ForegroundColor Cyan
        Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath -UseBasicParsing
        Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir -Force

        # Locate the tools/ folder inside dist/rxdk-managed-<rid>/tools.
        $toolsDir = Get-ChildItem -LiteralPath $extractDir -Recurse -Directory |
            Where-Object { $_.Name -eq 'tools' } | Select-Object -First 1
        if (-not $toolsDir) {
            throw "No tools/ folder inside $($asset.name)"
        }
        if (Test-Path -LiteralPath $destDir) {
            Remove-Item -LiteralPath $destDir -Recurse -Force
        }
        New-Item -ItemType Directory -Force -Path $destDir | Out-Null
        Copy-Item -Path (Join-Path $toolsDir.FullName '*') -Destination $destDir -Recurse -Force
        Write-Host "OK: $destDir <= $($Release.tag_name)/$($asset.name)" -ForegroundColor Green
    } finally {
        foreach ($p in @($zipPath, $extractDir)) {
            if (Test-Path -LiteralPath $p) {
                Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue | Out-Null
            }
        }
    }
}

Write-Host '=== rxdk-tools (Team-Resurgent/RXDK-Tools releases) ===' -ForegroundColor Cyan
if ($WindowsOnly) { Write-Host 'Windows-only: fetching win-x64 tools only' -ForegroundColor DarkGray }
New-Item -ItemType Directory -Force -Path $PublishRoot | Out-Null

$release = Get-ReleaseJson -Repository $Repo -ReleaseTag $Tag
Write-Host "Release: $($release.tag_name)" -ForegroundColor Cyan

foreach ($rid in $Rids) {
    Fetch-RidTools -Release $release -Rid $rid
}

Write-Host "OK: rxdk-tools staged under $PublishRoot ($($release.tag_name))" -ForegroundColor Green
exit 0

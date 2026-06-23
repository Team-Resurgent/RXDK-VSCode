# Download xdvdfs CLI binaries from Team-Resurgent/xdvdfs GitHub Releases (latest by default).
param(
    [string]$ExtensionRoot = (Join-Path $PSScriptRoot '..'),
    [string]$PublishRoot = '',
    [string]$Repo = 'Team-Resurgent/xdvdfs',
    [string]$Tag = '',
    [switch]$Force,
    [switch]$WindowsOnly
)
$ErrorActionPreference = 'Stop'
$ExtensionRoot = [IO.Path]::GetFullPath($ExtensionRoot)
if (-not $PublishRoot) {
    $PublishRoot = Join-Path $ExtensionRoot 'vendor\xdvdfs\publish'
}
$PublishRoot = [IO.Path]::GetFullPath($PublishRoot)

$PinnedTagFile = Join-Path $PSScriptRoot 'xdvdfs-release.txt'
if (-not $Tag) {
    if (Test-Path -LiteralPath $PinnedTagFile) {
        $Tag = (Get-Content -LiteralPath $PinnedTagFile -Raw).Trim()
    }
    if (-not $Tag) {
        $Tag = 'latest'
    }
}

$AllRidSpecs = @(
    @{ Rid = 'win-x64';   AssetPrefix = 'xdvdfs-windows-';     Ext = '.exe' }
    @{ Rid = 'linux-x64'; AssetPrefix = 'xdvdfs-linux-';      Ext = '' }
    @{ Rid = 'osx-x64';   AssetPrefix = 'xdvdfs-macos-x64-';  Ext = '' }
    @{ Rid = 'osx-arm64'; AssetPrefix = 'xdvdfs-macos-arm64-'; Ext = '' }
)
$RidSpecs = if ($WindowsOnly) {
    @($AllRidSpecs | Where-Object { $_.Rid -eq 'win-x64' })
} else {
    $AllRidSpecs
}

function Get-GitHubApiHeaders {
    $headers = @{
        Accept               = 'application/vnd.github+json'
        'X-GitHub-Api-Version' = '2022-11-28'
    }
    $token = $env:GITHUB_TOKEN
    if (-not $token) {
        $token = $env:GH_TOKEN
    }
    if ($token) {
        $headers['Authorization'] = "Bearer $token"
    }
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
    if ($headers.ContainsKey('Authorization')) {
        Write-Host 'Using authenticated GitHub API request (GITHUB_TOKEN/GH_TOKEN).' -ForegroundColor DarkGray
    } else {
        Write-Host 'Unauthenticated GitHub API (60 requests/hour per IP). Set GITHUB_TOKEN or GH_TOKEN in CI.' -ForegroundColor DarkYellow
    }
    try {
        return Invoke-RestMethod -Uri $uri -Headers $headers
    } catch {
        $message = $_.Exception.Message
        if ($message -match 'rate limit|403') {
            throw @"
GitHub API rate limit exceeded fetching xdvdfs release metadata.
Use a GITHUB_TOKEN (GitHub Actions sets this automatically) or pin scripts/xdvdfs-release.txt and retry later.
Docs: https://docs.github.com/rest/overview/resources-in-the-rest-api#rate-limiting
"@
        }
        throw
    }
}

function Find-ReleaseAsset {
    param(
        [object]$Release,
        [string]$Prefix
    )
    $assets = @($Release.assets | Where-Object {
        $_.name -like "$Prefix*.zip" -and $_.name -notlike 'xdvdfs-fsd-*'
    })
    if ($assets.Count -eq 0) {
        throw "No release asset matching ${Prefix}*.zip in $($Release.tag_name)"
    }
    if ($assets.Count -gt 1) {
        $assets = @($assets | Sort-Object name -Descending | Select-Object -First 1)
    }
    return $assets[0]
}

function Expand-ReleaseZip {
    param(
        [string]$ZipPath,
        [string]$BinaryName,
        [string]$DestPath
    )
    $extractDir = Join-Path ([IO.Path]::GetTempPath()) "rxdk-xdvdfs-$([Guid]::NewGuid().ToString('n'))"
    New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
    try {
        Expand-Archive -LiteralPath $ZipPath -DestinationPath $extractDir -Force
        $binary = Get-ChildItem -LiteralPath $extractDir -Recurse -File |
            Where-Object { $_.Name -eq $BinaryName } |
            Select-Object -First 1
        if (-not $binary) {
            throw "Expected $BinaryName inside $ZipPath"
        }
        $destDir = Split-Path -Parent $DestPath
        New-Item -ItemType Directory -Force -Path $destDir | Out-Null
        Copy-Item -LiteralPath $binary.FullName -Destination $DestPath -Force
    } finally {
        if (Test-Path -LiteralPath $extractDir) {
            Remove-Item -LiteralPath $extractDir -Recurse -Force -ErrorAction SilentlyContinue | Out-Null
        }
    }
}

function Fetch-XdvdfsRid {
    param(
        [object]$Release,
        [hashtable]$Spec
    )
    $dest = Join-Path (Join-Path $PublishRoot $Spec.Rid) "xdvdfs$($Spec.Ext)"
    if ((Test-Path -LiteralPath $dest) -and -not $Force) {
        Write-Host "OK: using existing $dest" -ForegroundColor DarkGray
        return
    }

    $asset = Find-ReleaseAsset -Release $Release -Prefix $Spec.AssetPrefix
    $binaryName = "xdvdfs$($Spec.Ext)"
    $zipPath = Join-Path ([IO.Path]::GetTempPath()) $asset.name
    try {
        Write-Host "Downloading $($asset.name) for $($Spec.Rid)..." -ForegroundColor Cyan
        Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath -UseBasicParsing
        Expand-ReleaseZip -ZipPath $zipPath -BinaryName $binaryName -DestPath $dest
        Write-Host "OK: $dest <= $($Release.tag_name)/$($asset.name)" -ForegroundColor Green
    } finally {
        if (Test-Path -LiteralPath $zipPath) {
            Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue | Out-Null
        }
    }
}

Write-Host '=== xdvdfs (Team-Resurgent/xdvdfs releases) ===' -ForegroundColor Cyan
if ($WindowsOnly) {
    Write-Host 'Windows-only: fetching win-x64 xdvdfs only' -ForegroundColor DarkGray
}
New-Item -ItemType Directory -Force -Path $PublishRoot | Out-Null

$release = Get-ReleaseJson -Repository $Repo -ReleaseTag $Tag
Write-Host "Release: $($release.tag_name)" -ForegroundColor Cyan

foreach ($spec in $RidSpecs) {
    Fetch-XdvdfsRid -Release $release -Spec $spec
}

foreach ($spec in $RidSpecs) {
    $dest = Join-Path (Join-Path $PublishRoot $spec.Rid) "xdvdfs$($spec.Ext)"
    if (-not (Test-Path -LiteralPath $dest)) {
        throw "xdvdfs missing for $($spec.Rid): $dest"
    }
}

Write-Host "OK: xdvdfs staged under $PublishRoot ($($release.tag_name))" -ForegroundColor Green
exit 0

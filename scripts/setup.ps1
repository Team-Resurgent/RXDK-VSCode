# One-shot dev bootstrap for building/running the RXDK VS Code extension from
# source. Idempotent — only downloads what's missing (pass -Force to refresh).
#
# End users do NOT need this: the extension downloads the same prerequisites via
# its in-editor setup panel. This is a headless convenience for contributors and
# CI, and it populates the SAME persistent locations the extension uses, so there
# is no separate dev-only tools fallback.
#
# What it ensures:
#   1. npm dependencies + a TypeScript compile (dist/)
#   2. Host tools (imagebld, xdvdfs, xbcp, xbox-launch, xboxdbg-bridge, xbwatson)
#      for THIS platform, downloaded latest into the staged tools root
#   3. RXDK-SDK headers/libs cloned into the staged SDK root
#   4. A status check for Zig and the .NET runtime (installed by the extension
#      prerequisites panel, or provided on PATH)
param(
    [string]$ExtensionRoot = (Join-Path $PSScriptRoot '..'),
    [switch]$Force
)
$ErrorActionPreference = 'Stop'
$ExtensionRoot = [IO.Path]::GetFullPath($ExtensionRoot)

function Test-IsWindows { return ($IsWindows -or $env:OS -eq 'Windows_NT') }

function Get-Rid {
    if (Test-IsWindows) { return 'win-x64' }
    if ($IsMacOS) {
        $arm = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq `
            [System.Runtime.InteropServices.Architecture]::Arm64
        return $(if ($arm) { 'osx-arm64' } else { 'osx-x64' })
    }
    return 'linux-x64'
}

# Mirrors src/hostTools.ts (getDefaultStagedToolsRoot) and src/sdkStaging.ts.
function Get-DefaultStaged([string]$Leaf) {
    if (Test-IsWindows) {
        $pd = if ($env:ProgramData) { $env:ProgramData } else { 'C:\ProgramData' }
        return Join-Path $pd "RXDK\$Leaf"
    }
    if ($IsMacOS) { return Join-Path $HOME "Library/Application Support/RXDK/$Leaf" }
    $xdg = if ($env:XDG_DATA_HOME) { $env:XDG_DATA_HOME } else { Join-Path $HOME '.local/share' }
    return (Join-Path $xdg "rxdk/$Leaf")
}

function Get-Release([string]$Repo) {
    $headers = @{ Accept = 'application/vnd.github+json'; 'User-Agent' = 'RXDK-VSCode' }
    $token = if ($env:GITHUB_TOKEN) { $env:GITHUB_TOKEN } elseif ($env:GH_TOKEN) { $env:GH_TOKEN } else { $null }
    if ($token) { $headers.Authorization = "Bearer $token" }
    try {
        return Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers $headers
    } catch {
        throw "GitHub API failed for $Repo ($($_.Exception.Message)). Set GITHUB_TOKEN if rate-limited."
    }
}

# Download a release .zip and copy the entries matching $Pick (an archive-relative,
# forward-slash path predicate) flat into $Dest.
function Expand-Into($Asset, [string]$Dest, [scriptblock]$Pick) {
    $zip = Join-Path ([IO.Path]::GetTempPath()) $Asset.name
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ("rxdk-setup-" + [Guid]::NewGuid().ToString('n'))
    try {
        Invoke-WebRequest -Uri $Asset.browser_download_url -OutFile $zip -UseBasicParsing
        Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
        $count = 0
        Get-ChildItem -LiteralPath $tmp -Recurse -File | ForEach-Object {
            $rel = ($_.FullName.Substring($tmp.Length).TrimStart('\', '/')) -replace '\\', '/'
            if (& $Pick $rel) {
                $target = Join-Path $Dest $_.Name
                Copy-Item -LiteralPath $_.FullName -Destination $target -Force
                if (-not (Test-IsWindows)) { chmod +x $target 2>$null }
                $count++
            }
        }
        if ($count -eq 0) { throw "No matching files inside $($Asset.name)" }
        return $count
    } finally {
        foreach ($p in @($zip, $tmp)) {
            if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue }
        }
    }
}

$rid = Get-Rid
$toolsRoot = if ($env:RXDK_STAGED_TOOLS) { $env:RXDK_STAGED_TOOLS } else { Get-DefaultStaged 'tools' }
$sdkRoot = if ($env:RXDK_STAGED_SDK) { $env:RXDK_STAGED_SDK } else { Get-DefaultStaged 'sdk' }
$ext = if ($rid -eq 'win-x64') { '.exe' } else { '' }

Write-Host "=== RXDK dev setup ($rid) ===" -ForegroundColor Cyan
Write-Host "  tools -> $toolsRoot"
Write-Host "  sdk   -> $sdkRoot"

# --- 1. npm deps + compile -------------------------------------------------
Write-Host "`n[1/4] npm dependencies + compile" -ForegroundColor Cyan
Push-Location $ExtensionRoot
try {
    if ($Force -or -not (Test-Path 'node_modules')) {
        npm install
        if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
    }
    npm run compile
    if ($LASTEXITCODE -ne 0) { throw 'npm run compile failed' }
} finally {
    Pop-Location
}

# --- 2. host tools ---------------------------------------------------------
Write-Host "`n[2/4] host tools" -ForegroundColor Cyan
$required = @('imagebld', 'xbcp', 'xbox-launch', 'xboxdbg-bridge', 'xbwatson', 'xdvdfs')
$missing = @($required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $toolsRoot "$_$ext")) })
if ($Force -or $missing.Count -gt 0) {
    New-Item -ItemType Directory -Force -Path $toolsRoot | Out-Null

    $toolsRel = Get-Release 'Team-Resurgent/RXDK-Tools'
    $toolsAsset = $toolsRel.assets | Where-Object { $_.name -eq "rxdk-managed-$rid.zip" } | Select-Object -First 1
    if (-not $toolsAsset) { throw "RXDK-Tools $($toolsRel.tag_name): no asset rxdk-managed-$rid.zip" }
    $n = Expand-Into $toolsAsset $toolsRoot { param($p) $p -match '(^|/)tools/[^/]+$' }
    Write-Host "  RXDK-Tools $($toolsRel.tag_name): $n tool(s)" -ForegroundColor Green

    $prefix = switch ($rid) {
        'linux-x64' { 'xdvdfs-linux-' }
        'osx-x64' { 'xdvdfs-macos-x64-' }
        'osx-arm64' { 'xdvdfs-macos-arm64-' }
        default { 'xdvdfs-windows-' }
    }
    $xdvdfsRel = Get-Release 'Team-Resurgent/xdvdfs'
    $xdvdfsAsset = $xdvdfsRel.assets |
        Where-Object { $_.name -like "$prefix*.zip" -and $_.name -notlike 'xdvdfs-fsd-*' } |
        Sort-Object name -Descending | Select-Object -First 1
    if (-not $xdvdfsAsset) { throw "xdvdfs $($xdvdfsRel.tag_name): no asset $prefix*.zip" }
    [void](Expand-Into $xdvdfsAsset $toolsRoot { param($p) [IO.Path]::GetFileName($p) -eq "xdvdfs$ext" })
    Write-Host "  xdvdfs $($xdvdfsRel.tag_name): xdvdfs$ext" -ForegroundColor Green
} else {
    Write-Host "  OK: all host tools present" -ForegroundColor DarkGray
}

# --- 3. RXDK-SDK headers/libs ---------------------------------------------
Write-Host "`n[3/4] RXDK-SDK (headers + libraries)" -ForegroundColor Cyan
if ($Force -and (Test-Path -LiteralPath (Join-Path $sdkRoot '.git'))) {
    git -C $sdkRoot pull --ff-only
} elseif (-not (Test-Path -LiteralPath (Join-Path $sdkRoot 'include/d3d8.h'))) {
    New-Item -ItemType Directory -Force -Path (Split-Path $sdkRoot -Parent) | Out-Null
    git clone --depth 1 https://github.com/Team-Resurgent/RXDK-SDK.git $sdkRoot
    if ($LASTEXITCODE -ne 0) { throw 'RXDK-SDK clone failed (is git installed?)' }
} else {
    Write-Host "  OK: SDK present" -ForegroundColor DarkGray
}

# --- 4. Zig + .NET status (installed by the extension prereq panel or PATH) --
Write-Host "`n[4/4] toolchain status" -ForegroundColor Cyan
$zig = Get-Command zig -ErrorAction SilentlyContinue
Write-Host ("  Zig:  {0}" -f $(if ($zig) { 'on PATH' } else { 'not on PATH (installed by the RXDK prerequisites panel)' }))
$dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
Write-Host ("  .NET: {0}" -f $(if ($dotnet) { 'on PATH' } else { 'not on PATH (installed by the RXDK prerequisites panel)' }))

Write-Host "`nOK: dev setup complete." -ForegroundColor Green

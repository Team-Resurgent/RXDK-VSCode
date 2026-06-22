# Assemble sdk/ for the extension: scripts from scripts/sdk, tools from RXDK-Tools + xdvdfs release.
# Headers/libs are cloned from RXDK-SDK on extension activate (not bundled in the VSIX).
param(
    [string]$RxdkToolsRoot = (Join-Path $PSScriptRoot '..\external\RXDK-Tools'),
    [string]$ExtensionRoot = (Join-Path $PSScriptRoot '..'),
    [switch]$BuildTools,
    [switch]$CrossPlatformTools
)
$ErrorActionPreference = 'Stop'
$RxdkToolsRoot = [IO.Path]::GetFullPath($RxdkToolsRoot)
$ExtensionRoot = [IO.Path]::GetFullPath($ExtensionRoot)
$sdkRoot = Join-Path $ExtensionRoot 'sdk'
$sdkScriptsSrc = Join-Path $PSScriptRoot 'sdk'
$requiredToolsFile = Join-Path $PSScriptRoot 'required-tools.txt'

$ManagedTools = @(
    @{ Project = 'src\Rxdk.XbCp\Rxdk.XbCp.csproj'; Name = 'xbcp' }
    @{ Project = 'src\Rxdk.ImageBld\Rxdk.ImageBld.csproj'; Name = 'imagebld' }
    @{ Project = 'src\Rxdk.XboxLaunch.Cli\Rxdk.XboxLaunch.Cli.csproj'; Name = 'xbox-launch' }
    @{ Project = 'src\Rxdk.XboxDbgBridge.Cli\Rxdk.XboxDbgBridge.Cli.csproj'; Name = 'xboxdbg-bridge' }
    @{ Project = 'src\Rxdk.XbWatson\Rxdk.XbWatson.csproj'; Name = 'xbwatson' }
)

function Get-RequiredToolNames {
    Get-Content -LiteralPath $requiredToolsFile | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith('#')) { return }
        $line
    }
}

function Test-RequiredTools([string]$ToolsRoot) {
    $missing = @()
    Get-RequiredToolNames | ForEach-Object {
        $full = Join-Path $ToolsRoot $_
        if (-not (Test-Path -LiteralPath $full)) {
            $missing += $_
        }
    }
    if ($missing.Count -gt 0) {
        throw "Missing required tools under ${ToolsRoot}: $($missing -join ', ')"
    }
}

function Stage-Tree([string]$Src, [string]$Dest) {
    if (Test-Path -LiteralPath $Dest) {
        Remove-Item -LiteralPath $Dest -Recurse -Force
    }
    Copy-Item -LiteralPath $Src -Destination $Dest -Recurse -Force
}

function Get-RxdkToolsPublishDir([string]$Root) {
    Join-Path $Root 'out\publish\rxdk-vscode-win-x64'
}

function Find-ManagedTool([string]$Root, [string]$Name) {
    $file = "$Name.exe"
    @(
        (Join-Path (Get-RxdkToolsPublishDir $Root) $file)
        (Join-Path $Root "out\publish\managed-cli-tools-win-x64\$file")
        (Join-Path $Root "out\publish\managed\win-x64\tools\$file")
        (Join-Path $Root "out\bin\x64\Release\$file")
    ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}

function Publish-ManagedTool([string]$Root, [hashtable]$Tool) {
    $project = Join-Path $Root $Tool.Project
    if (-not (Test-Path -LiteralPath $project)) {
        throw "Project not found: $project"
    }
    $outDir = Get-RxdkToolsPublishDir $Root
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    dotnet publish $project -c Release -r win-x64 -o $outDir | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "dotnet publish failed for $($Tool.Name)"
    }
    $built = Join-Path $outDir "$($Tool.Name).exe"
    if (-not (Test-Path -LiteralPath $built)) {
        throw "Expected publish output missing: $built"
    }
    return $built
}

function Resolve-ToolSource {
    param(
        [string]$Name,
        [string]$RxdkToolsRoot,
        [string]$ExtensionRoot
    )
    if ($Name -eq 'xdvdfs') {
        $candidate = Join-Path $ExtensionRoot 'vendor\xdvdfs\publish\win-x64\xdvdfs.exe'
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
        throw "Missing xdvdfs.exe - run scripts/fetch-xdvdfs.ps1"
    }
    $managed = $ManagedTools | Where-Object { $_.Name -eq $Name } | Select-Object -First 1
    if (-not $managed) {
        throw "No source mapping for tool: $Name"
    }
    if ($BuildTools) {
        Write-Host "Publishing $Name from RXDK-Tools..." -ForegroundColor Cyan
        return Publish-ManagedTool $RxdkToolsRoot $managed
    }
    $source = Find-ManagedTool $RxdkToolsRoot $Name
    if (-not $source) {
        throw "$Name.exe not found under $RxdkToolsRoot (run with -BuildTools)"
    }
    return $source
}

if (-not (Test-Path -LiteralPath $requiredToolsFile)) {
    throw "Missing $requiredToolsFile"
}
if (-not (Test-Path -LiteralPath $RxdkToolsRoot)) {
    throw @"
RXDK-Tools submodule not found at $RxdkToolsRoot
Run: git submodule update --init external/RXDK-Tools
"@
}

Write-Host '=== xdvdfs ===' -ForegroundColor Cyan
$fetchArgs = @{ ExtensionRoot = $ExtensionRoot }
if ($BuildTools) { $fetchArgs['Force'] = $true }
& (Join-Path $PSScriptRoot 'fetch-xdvdfs.ps1') @fetchArgs

$scriptsDest = Join-Path $sdkRoot 'scripts'
foreach ($stale in @('include', 'lib')) {
    $stalePath = Join-Path $sdkRoot $stale
    if (Test-Path -LiteralPath $stalePath) {
        Remove-Item -LiteralPath $stalePath -Recurse -Force
    }
}
if (Test-Path -LiteralPath $scriptsDest) {
    Remove-Item -LiteralPath $scriptsDest -Recurse -Force
}
if (-not (Test-Path -LiteralPath $sdkScriptsSrc)) {
    throw "Missing SDK build scripts at $sdkScriptsSrc"
}
Copy-Item -LiteralPath $sdkScriptsSrc -Destination $scriptsDest -Recurse -Force

$toolsDest = Join-Path $sdkRoot 'tools'
if (Test-Path -LiteralPath $toolsDest) {
    Remove-Item -LiteralPath $toolsDest -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $toolsDest | Out-Null

if ($CrossPlatformTools) {
    $crossArgs = @{
        RxdkToolsRoot  = $RxdkToolsRoot
        ToolsDest      = $toolsDest
        ExtensionRoot  = $ExtensionRoot
    }
    if ($BuildTools) { $crossArgs['BuildTools'] = $true }
    & (Join-Path $PSScriptRoot 'stage-cross-platform-tools.ps1') @crossArgs
    Test-RequiredTools $toolsDest
} else {
$tempTools = Join-Path ([IO.Path]::GetTempPath()) "rxdk-vscode-tools-$([Guid]::NewGuid().ToString('n'))"
New-Item -ItemType Directory -Force -Path $tempTools | Out-Null
try {
    Get-RequiredToolNames | ForEach-Object {
        $base = [IO.Path]::GetFileNameWithoutExtension($_)
        $source = Resolve-ToolSource -Name $base -RxdkToolsRoot $RxdkToolsRoot -ExtensionRoot $ExtensionRoot
        Copy-Item -LiteralPath $source -Destination (Join-Path $tempTools $_) -Force
        Write-Host "OK: $($_) <= $source" -ForegroundColor Green
    }
    Get-ChildItem -LiteralPath $tempTools -File | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $toolsDest $_.Name) -Force
    }
    Test-RequiredTools $toolsDest
}
finally {
    if (Test-Path -LiteralPath $tempTools) {
        Remove-Item -LiteralPath $tempTools -Recurse -Force -ErrorAction SilentlyContinue
    }
}
}

$libsSha = 'n/a'
$toolsSha = 'unknown'
$xdvdfsTag = 'unknown'
try { $toolsSha = (git -C $RxdkToolsRoot rev-parse --short HEAD 2>$null) } catch { }
$xdvdfsTagFile = Join-Path $PSScriptRoot 'xdvdfs-release.txt'
if (Test-Path -LiteralPath $xdvdfsTagFile) {
    $xdvdfsTag = (Get-Content -LiteralPath $xdvdfsTagFile -Raw).Trim()
}
@"
rxdk-sdk=cloned-on-activate
rxdk-tools=$toolsSha
xdvdfs=$xdvdfsTag
staged=$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ss')
"@ | Set-Content -LiteralPath (Join-Path $sdkRoot 'VERSION.txt') -Encoding ASCII

Write-Host "OK: assembled sdk/ (scripts + tools; include/lib from RXDK-SDK git clone on activate)" -ForegroundColor Green

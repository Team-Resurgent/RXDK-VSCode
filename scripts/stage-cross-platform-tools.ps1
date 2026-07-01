# Stage managed host tools for every VSIX-supported RID into sdk/tools/<rid>/,
# sourced from the downloaded release sets (vendor/rxdk-tools/publish/<rid> for
# the managed tools, vendor/xdvdfs/publish/<rid> for xdvdfs). Run
# scripts/fetch-rxdk-tools.ps1 and scripts/fetch-xdvdfs.ps1 first.
param(
    [Parameter(Mandatory)]
    [string]$ToolsDest,
    [Parameter(Mandatory)]
    [string]$ExtensionRoot
)
$ErrorActionPreference = 'Stop'
$ToolsDest = [IO.Path]::GetFullPath($ToolsDest)
$ExtensionRoot = [IO.Path]::GetFullPath($ExtensionRoot)

$ManagedTools = @('xbcp', 'imagebld', 'xbox-launch', 'xboxdbg-bridge', 'xbwatson')
$WindowsOnlyTools = @('xdvdfs')
$Rids = @('win-x64', 'linux-x64', 'osx-x64', 'osx-arm64')

$rxdkToolsPublish = Join-Path $ExtensionRoot 'vendor\rxdk-tools\publish'
$xdvdfsPublish = Join-Path $ExtensionRoot 'vendor\xdvdfs\publish'

function Get-ToolExtension([string]$Rid) {
    if ($Rid -eq 'win-x64') { return '.exe' }
    return ''
}

function Copy-RidTool([string]$SourceRoot, [string]$Rid, [string]$Name, [string]$OutDir) {
    $ext = Get-ToolExtension $Rid
    $file = "$Name$ext"
    $source = Join-Path (Join-Path $SourceRoot $Rid) $file
    if (-not (Test-Path -LiteralPath $source)) {
        throw "$file not found for ${Rid}: $source (run the matching fetch-*.ps1)"
    }
    Copy-Item -LiteralPath $source -Destination (Join-Path $OutDir $file) -Force
    Write-Host "OK: $Rid/$file" -ForegroundColor Green
}

New-Item -ItemType Directory -Force -Path $ToolsDest | Out-Null

foreach ($rid in $Rids) {
    $ridDir = Join-Path $ToolsDest $rid
    if (Test-Path -LiteralPath $ridDir) {
        Remove-Item -LiteralPath $ridDir -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $ridDir | Out-Null
    foreach ($name in $ManagedTools) {
        Copy-RidTool -SourceRoot $rxdkToolsPublish -Rid $rid -Name $name -OutDir $ridDir
    }
    foreach ($name in $WindowsOnlyTools) {
        Copy-RidTool -SourceRoot $xdvdfsPublish -Rid $rid -Name $name -OutDir $ridDir
    }
}

# Legacy flat layout for Windows PowerShell scripts and older configs.
$winFlat = Join-Path $ToolsDest 'win-x64'
foreach ($name in $ManagedTools + $WindowsOnlyTools) {
    $src = Join-Path $winFlat "$name.exe"
    if (Test-Path -LiteralPath $src) {
        Copy-Item -LiteralPath $src -Destination (Join-Path $ToolsDest "$name.exe") -Force
    }
}

Write-Host "OK: staged cross-platform tools under $ToolsDest" -ForegroundColor Green

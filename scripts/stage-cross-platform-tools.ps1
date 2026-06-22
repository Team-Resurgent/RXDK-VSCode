# Publish managed host tools for every VSIX-supported RID into sdk/tools/<rid>/.
param(
    [Parameter(Mandatory)]
    [string]$RxdkToolsRoot,
    [Parameter(Mandatory)]
    [string]$ToolsDest,
    [Parameter(Mandatory)]
    [string]$ExtensionRoot,
    [switch]$BuildTools
)
$ErrorActionPreference = 'Stop'
$RxdkToolsRoot = [IO.Path]::GetFullPath($RxdkToolsRoot)
$ToolsDest = [IO.Path]::GetFullPath($ToolsDest)
$ExtensionRoot = [IO.Path]::GetFullPath($ExtensionRoot)

$ManagedTools = @('xbcp', 'imagebld', 'xbox-launch', 'xboxdbg-bridge')
$WindowsOnlyTools = @('xdvdfs')
$Rids = @('win-x64', 'linux-x64', 'osx-x64', 'osx-arm64')

function Get-XdvdfsPublishDir {
    param([Parameter(Mandatory)][string]$ExtensionRoot)
    Join-Path $ExtensionRoot 'external\xdvdfs\out\publish'
}

function Find-XdvdfsTool {
    param(
        [Parameter(Mandatory)][string]$ExtensionRoot,
        [Parameter(Mandatory)][string]$Rid
    )
    $ext = if ($Rid -eq 'win-x64') { '.exe' } else { '' }
    $publish = Get-XdvdfsPublishDir $ExtensionRoot
    $candidate = Join-Path (Join-Path $publish $Rid) "xdvdfs$ext"
    if (Test-Path -LiteralPath $candidate) {
        return $candidate
    }
    return $null
}

function Get-ToolExtension([string]$Rid) {
    if ($Rid -eq 'win-x64') { return '.exe' }
    return ''
}

function Find-PublishedTool([string]$Root, [string]$Rid, [string]$Name) {
    $ext = Get-ToolExtension $Rid
    $file = "$Name$ext"
    @(
        (Join-Path $Root "out\publish\managed\$Rid\tools\$file")
        (Join-Path $Root "out\publish\managed-cli-tools-$Rid\$file")
        (Join-Path $Root "out\publish\rxdk-vscode-$Rid\$file")
    ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}

function Publish-RidTools([string]$Root, [string]$Rid, [string]$OutDir) {
    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
    if ($BuildTools) {
        Write-Host "Publishing managed tools for $Rid..." -ForegroundColor Cyan
        & (Join-Path $Root 'scripts\publish-managed-cli-tools.ps1') -Runtime $Rid -OutputDir $OutDir | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "dotnet publish failed for RID $Rid"
        }
    }
    foreach ($name in $ManagedTools) {
        $ext = Get-ToolExtension $Rid
        $dest = Join-Path $OutDir "$name$ext"
        if (Test-Path -LiteralPath $dest) {
            Write-Host "OK: $Rid/$name$ext" -ForegroundColor Green
            continue
        }
        $source = Find-PublishedTool $Root $Rid $name
        if (-not $source) {
            throw "$name$ext not found for $Rid under $Root (run with -BuildTools)"
        }
        Copy-Item -LiteralPath $source -Destination $dest -Force
        Write-Host "OK: $Rid/$name$ext <= $source" -ForegroundColor Green
    }
    $xdvdfsExt = Get-ToolExtension $Rid
    $xdvdfsDest = Join-Path $OutDir "xdvdfs$xdvdfsExt"
    if (Test-Path -LiteralPath $xdvdfsDest) {
        Write-Host "OK: $Rid/xdvdfs$xdvdfsExt" -ForegroundColor Green
    } else {
        $xdvdfsSource = Find-XdvdfsTool -ExtensionRoot $ExtensionRoot -Rid $Rid
        if (-not $xdvdfsSource) {
            throw "xdvdfs$xdvdfsExt not found for $Rid (run scripts/build-xdvdfs.ps1)"
        }
        Copy-Item -LiteralPath $xdvdfsSource -Destination $xdvdfsDest -Force
        Write-Host "OK: $Rid/xdvdfs$xdvdfsExt <= $xdvdfsSource" -ForegroundColor Green
    }
}

New-Item -ItemType Directory -Force -Path $ToolsDest | Out-Null
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) "rxdk-cross-tools-$([Guid]::NewGuid().ToString('n'))"
New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
try {
    foreach ($rid in $Rids) {
        $ridDir = Join-Path $ToolsDest $rid
        if (Test-Path -LiteralPath $ridDir) {
            Remove-Item -LiteralPath $ridDir -Recurse -Force
        }
        $stage = Join-Path $tempRoot $rid
        Publish-RidTools -Root $RxdkToolsRoot -Rid $rid -OutDir $stage
        Copy-Item -LiteralPath $stage -Destination $ridDir -Recurse -Force
    }

    # Legacy flat layout for Windows PowerShell scripts and older configs.
    $winFlat = Join-Path $ToolsDest 'win-x64'
    foreach ($name in $ManagedTools + $WindowsOnlyTools) {
        $src = Join-Path $winFlat "$name.exe"
        if (Test-Path -LiteralPath $src) {
            Copy-Item -LiteralPath $src -Destination (Join-Path $ToolsDest "$name.exe") -Force
        }
    }
}
finally {
    if (Test-Path -LiteralPath $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "OK: staged cross-platform tools under $ToolsDest" -ForegroundColor Green

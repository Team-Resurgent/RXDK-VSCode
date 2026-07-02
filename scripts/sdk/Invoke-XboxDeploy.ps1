# Deploy local build artifacts to an Xbox devkit via xbcp.
param(
    [Parameter(Mandatory)]
    [string]$SdkRoot,
    [string]$ProjectRoot,
    [string]$ProjectName,
    [string]$LocalDir,
    [string]$RemoteDir,
    [string]$ConsoleName,
    [string[]]$Files,
    [switch]$Quiet,
    [string]$XbePath,
    [string]$PdbPath,
    [string]$MapPath,
    [string]$RemoteName
)
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($ConsoleName)) { $ConsoleName = $null }
. (Join-Path $PSScriptRoot 'Get-XboxSdkPaths.ps1')
. (Join-Path $PSScriptRoot 'Get-XboxConsole.ps1')

$paths = Get-XboxSdkPaths -SdkRoot $SdkRoot

if ($XbePath) {
    # Manifest-less deploy of an explicit prebuilt XBE (+ optional PDB/MAP).
    $XbePath = [IO.Path]::GetFullPath($XbePath)
    if (-not (Test-Path -LiteralPath $XbePath)) {
        throw "XBE not found: $XbePath"
    }
    if (-not $RemoteName) {
        $RemoteName = [IO.Path]::GetFileNameWithoutExtension($XbePath)
    }
    $RemoteDir = "xe:\$RemoteName".TrimEnd('\')

    $xbcp = Get-HostToolPath -ToolsRoot $paths.Tools -Name 'xbcp'

    $console = Get-XboxConsole -SdkRoot $paths.SdkRoot -ConsoleName $ConsoleName
    $xbArgs = @('/y', '/t', '/q')
    if ($console) {
        $xbArgs += @('/x', $console)
        Write-Host "Deploying to Xbox '$console' -> $RemoteDir"
    } else {
        Write-Host "Deploying to default Xbox -> $RemoteDir"
    }

    $toCopy = @($XbePath)
    if ($PdbPath) { $toCopy += [IO.Path]::GetFullPath($PdbPath) }
    if ($MapPath) { $toCopy += [IO.Path]::GetFullPath($MapPath) }

    $sent = @()
    foreach ($file in $toCopy) {
        if (-not (Test-Path -LiteralPath $file)) {
            Write-Warning "skip missing file: $file"
            continue
        }
        $name = Split-Path $file -Leaf
        $dest = "$RemoteDir\$name"
        if (-not $Quiet) {
            Write-Host "$xbcp $($xbArgs -join ' ') $name -> $dest"
        }
        & $xbcp @xbArgs $file $dest
        if ($LASTEXITCODE -ne 0) {
            throw "xbcp failed copying $name (exit $LASTEXITCODE)"
        }
        $sent += $name
    }
    if (-not $sent) {
        throw "No files deployed for $XbePath"
    }
    Write-Host "Deployed: $($sent -join ', ') -> $RemoteDir"
    return
}

if (-not $ProjectRoot) {
    throw "ProjectRoot is required (or pass -XbePath for a prebuilt deploy)"
}
$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
$manifest = Get-XboxProjectManifest -ProjectRoot $ProjectRoot
if (-not $ProjectName) { $ProjectName = $manifest.name }

if (-not $LocalDir) {
    $LocalDir = Get-XboxProjectOutDir -ProjectRoot $ProjectRoot -Manifest $manifest
}
$LocalDir = [IO.Path]::GetFullPath($LocalDir)
if (-not (Test-Path -LiteralPath $LocalDir)) {
    throw "Deploy source directory not found: $LocalDir"
}

if (-not $RemoteDir) { $RemoteDir = "xe:\$ProjectName" }
if ($RemoteDir -notmatch '^x[eEdDcC]:\\') {
    $RemoteDir = "xe:\$RemoteDir".TrimEnd('\')
}

$xbcp = Get-HostToolPath -ToolsRoot $paths.Tools -Name 'xbcp'

if (-not $Files) {
    $Files = @('*.xbe', '*.pdb', '*.map')
}

$console = Get-XboxConsole -SdkRoot $paths.SdkRoot -ConsoleName $ConsoleName
$xbArgs = @('/y', '/t', '/q')
if ($console) {
    $xbArgs += @('/x', $console)
    Write-Host "Deploying to Xbox '$console' -> $RemoteDir"
} else {
    Write-Host "Deploying to default Xbox -> $RemoteDir"
}

$sent = @()
foreach ($pattern in $Files) {
    $matches = Get-ChildItem -LiteralPath $LocalDir -Filter $pattern -File -ErrorAction SilentlyContinue
    foreach ($item in $matches) {
        $dest = "$RemoteDir\$($item.Name)"
        if (-not $Quiet) {
            Write-Host "$xbcp $($xbArgs -join ' ') $($item.Name) -> $dest"
        }
        & $xbcp @xbArgs $item.FullName $dest
        if ($LASTEXITCODE -ne 0) {
            throw "xbcp failed copying $($item.Name) (exit $LASTEXITCODE)"
        }
        $sent += $item.Name
    }
}

if (-not $sent) {
    throw "No files matched in $LocalDir (patterns: $($Files -join ', '))"
}

$deployCopied = 0
$deploySummary = @()
if ($manifest.deployPaths) {
    foreach ($relPath in $manifest.deployPaths) {
        if ([string]::IsNullOrWhiteSpace($relPath)) { continue }
        $localPath = Join-Path $ProjectRoot (($relPath -replace '/', '\').TrimEnd('\'))
        if (-not (Test-Path -LiteralPath $localPath)) {
            Write-Warning "deployPaths: not found $localPath"
            continue
        }
        # NOTE: this local var is deliberately NOT named $files/$file -- PowerShell
        # variables are case-insensitive, so $files would alias the script's own
        # [string[]]$Files parameter above and silently coerce every FileInfo here
        # into a bare string (via ToString(), i.e. just .Name) on assignment, making
        # .FullName below resolve to $null. Cost real debugging time once already.
        $deployFiles = @(Get-ChildItem -LiteralPath $localPath -Recurse -File -ErrorAction SilentlyContinue)
        if ($deployFiles.Count -eq 0) {
            Write-Warning "deployPaths: no files under $localPath"
            continue
        }
        $leaf = Split-Path $localPath -Leaf
        # xbcp's directory/wildcard recursive-copy paths (XbCopyService.
        # CopySourceToDirectory / CopyFileOrDirectory / ChildPath in
        # Rxdk.XbFile) have edge cases that don't behave as documented for a
        # plain local folder source (recursion silently no-ops in one code
        # path; ChildPath embeds a literal "*" in the rebuilt path in
        # another). Sidestepping all of that: copy each file individually
        # with a plain single-file xbcp call and an explicit destination path
        # -- the same well-tested pattern already used above for the XBE/PDB
        # -- reconstructing the relative path so nested subfolders under
        # deployPaths are preserved.
        $deployArgs = @('/y', '/t', '/q')
        if ($console) { $deployArgs += @('/x', $console) }
        foreach ($deployFile in $deployFiles) {
            $relFile = $deployFile.FullName.Substring($localPath.Length).TrimStart('\')
            $dest = "$RemoteDir\$leaf\$relFile"
            if (-not $Quiet) {
                Write-Host "$xbcp $($deployArgs -join ' ') $($deployFile.FullName) -> $dest"
            }
            & $xbcp @deployArgs $deployFile.FullName $dest
            if ($LASTEXITCODE -ne 0) {
                throw "xbcp failed copying $($deployFile.FullName) (exit $LASTEXITCODE)"
            }
        }
        $deployCopied += $deployFiles.Count
        $deploySummary += "$leaf -> $RemoteDir\$leaf ($($deployFiles.Count) file(s))"
    }
}

$summary = "Deployed: $($sent -join ', ') -> $RemoteDir"
if ($deployCopied -gt 0) {
    $summary += "; deployPaths: $deployCopied file(s) ($($deploySummary -join '; '))"
}
Write-Host $summary

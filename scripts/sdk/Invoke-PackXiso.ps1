function Invoke-PackXiso {
    param(
        [Parameter(Mandatory)]
        [string]$InputXbe,
        [Parameter(Mandatory)]
        [string]$ProjectName,
        [string]$OutDir,
        [string]$OutputIso,
        [string[]]$StageFile,
        [string]$ToolPath
    )
    $xbeFull = [IO.Path]::GetFullPath($InputXbe)
    if (-not (Test-Path -LiteralPath $xbeFull)) {
        throw "xdvdfs: input XBE not found: $xbeFull"
    }
    if (-not $OutDir) { $OutDir = Split-Path $xbeFull -Parent }
    $OutDir = [IO.Path]::GetFullPath($OutDir)
    if (-not $ToolPath) { throw 'xdvdfs: ToolPath required' }

    $packDir = Join-Path $OutDir "Build\$ProjectName"
    $defaultXbe = Join-Path $packDir 'default.xbe'
    if (-not $OutputIso) { $OutputIso = Join-Path $OutDir "XISO\$ProjectName.iso" }
    $OutputIso = [IO.Path]::GetFullPath($OutputIso)

    New-Item -ItemType Directory -Force -Path $packDir | Out-Null
    New-Item -ItemType Directory -Force -Path (Split-Path $OutputIso -Parent) | Out-Null
    Copy-Item -LiteralPath $xbeFull -Destination $defaultXbe -Force

    foreach ($entry in ($StageFile | Where-Object { $_ })) {
        $parts = $entry -split ',', 2
        if ($parts.Count -lt 2) { throw "StageFile entry must be source,relativeDest: $entry" }
        $src = [IO.Path]::GetFullPath($parts[0].Trim())
        if (-not (Test-Path -LiteralPath $src)) { throw "StageFile source not found: $src" }
        $dest = Join-Path $packDir ($parts[1].Trim().Replace('/', '\'))
        $destDir = Split-Path $dest -Parent
        if ($destDir) { New-Item -ItemType Directory -Force -Path $destDir | Out-Null }
        Copy-Item -LiteralPath $src -Destination $dest -Force
    }

    Write-Host "$ToolPath pack $packDir $OutputIso"
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $log = @( & $ToolPath pack $packDir $OutputIso 2>&1 )
    $ErrorActionPreference = $prevEap
    $log | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) {
        throw "xdvdfs pack failed (exit $LASTEXITCODE)"
    }
    return $OutputIso
}

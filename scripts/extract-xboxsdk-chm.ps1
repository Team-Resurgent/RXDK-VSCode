# DEPRECATED: one-off importer only. Docs are maintained in RXDK-Docs (https://github.com/Team-Resurgent/RXDK-Docs).
# Run this manually only if you intentionally want to re-import from a CHM into an RXDK-Docs checkout.
#
# Decompile XboxSDK.chm to HTML and build toc.json for the in-extension doc viewer.
param(
    [string]$ChmPath = $env:RXDK_XBOXSDK_CHM,
    [string]$ExtensionRoot = (Join-Path $PSScriptRoot '..'),
    [string]$OutputDir = ''
)
$ErrorActionPreference = 'Stop'
$ExtensionRoot = [IO.Path]::GetFullPath($ExtensionRoot)

if (-not $ChmPath) {
    $candidates = @(
        'D:\Git\RXDK\POC\XDKSetup5849.17\XDK\doc\XboxSDK.chm'
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft Xbox 360 SDK\doc\XboxSDK.chm')
        (Join-Path $env:ProgramFiles 'Microsoft Xbox 360 SDK\doc\XboxSDK.chm')
    )
    $ChmPath = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
}
if (-not $ChmPath -or -not (Test-Path -LiteralPath $ChmPath)) {
    throw @"
XboxSDK.chm not found. Pass -ChmPath or set RXDK_XBOXSDK_CHM.
Example: .\scripts\extract-xboxsdk-chm.ps1 -ChmPath 'D:\Git\RXDK\POC\XDKSetup5849.17\XDK\doc\XboxSDK.chm'
"@
}
if (-not $OutputDir) {
    $OutputDir = Join-Path (Split-Path $ExtensionRoot -Parent) 'RXDK-Docs\xboxsdk'
}
$OutputDir = [IO.Path]::GetFullPath($OutputDir)
$ChmPath = [IO.Path]::GetFullPath($ChmPath)

$hh = Join-Path $env:SystemRoot 'hh.exe'
if (-not (Test-Path -LiteralPath $hh)) {
    throw "hh.exe not found at $hh (required to decompile CHM)"
}

function ConvertFrom-XboxSdkHhc {
    param([string]$Path)
    $lines = Get-Content -LiteralPath $Path
    $root = [System.Collections.Generic.List[object]]::new()
    $stack = [System.Collections.Generic.List[object]]::new()
    $stack.Add($root)
    $current = $null

    foreach ($line in $lines) {
        $trim = $line.Trim()
        if ($trim -eq '<UL>') {
            if ($null -eq $current) { continue }
            $children = [System.Collections.Generic.List[object]]::new()
            $current.children = $children
            $stack.Add($children)
            continue
        }
        if ($trim -eq '</UL>') {
            if ($stack.Count -gt 1) { [void]$stack.RemoveAt($stack.Count - 1) }
            $current = $null
            continue
        }
        if ($trim -eq '</LI>') {
            $current = $null
            continue
        }
        if ($trim -match '<LI><OBJECT') {
            $current = [ordered]@{ name = ''; page = ''; children = $null }
            $stack[$stack.Count - 1].Add($current)
            continue
        }
        if ($null -eq $current) { continue }
        if ($trim -match 'param name="Name" value="([^"]*)"') {
            $current.name = $Matches[1]
        }
        if ($trim -match 'param name="Local" value="([^"]*)"') {
            $current.page = $Matches[1]
        }
    }

    function Normalize-Node($node) {
        if ($node.children) {
            $node.children = @($node.children | ForEach-Object { Normalize-Node $_ })
        } else {
            $node.children = @()
        }
        if (-not $node.page) { $node.page = '' }
        return $node
    }

    return @($root | ForEach-Object { Normalize-Node $_ })
}

$temp = Join-Path ([IO.Path]::GetTempPath()) "rxdk-xboxsdk-chm-$([Guid]::NewGuid().ToString('n'))"
New-Item -ItemType Directory -Force -Path $temp | Out-Null
try {
    Write-Host "Decompiling $ChmPath ..." -ForegroundColor Cyan
    Start-Process -FilePath $hh -ArgumentList '-decompile', $temp, $ChmPath -Wait -NoNewWindow | Out-Null
    Start-Sleep -Seconds 2
    if (-not (Get-ChildItem -LiteralPath $temp -Recurse -File -ErrorAction SilentlyContinue)) {
        throw "CHM decompile produced no files under $temp"
    }

    $hhc = Get-ChildItem -LiteralPath $temp -Filter '*.hhc' -Recurse | Select-Object -First 1
    if (-not $hhc) {
        throw "Missing .hhc table of contents in decompiled output"
    }

    $hhcPath = $hhc.FullName
    if (Test-Path -LiteralPath $OutputDir) {
        Remove-Item -LiteralPath $OutputDir -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
    Copy-Item -Path (Join-Path $temp '*') -Destination $OutputDir -Recurse -Force

    $toc = ConvertFrom-XboxSdkHhc -Path $hhcPath
    $tocPayload = @{
        title       = 'Xbox SDK Documentation'
        sourceChm   = $ChmPath
        generated   = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss')
        defaultPage = 'xbox_pk_welcome.htm'
        toc         = $toc
    }
    # Write UTF-8 *without* BOM; Set-Content -Encoding UTF8 (PS 5.1) emits a BOM that JSON.parse rejects.
    $tocJson = $tocPayload | ConvertTo-Json -Depth 32
    [System.IO.File]::WriteAllText((Join-Path $OutputDir 'toc.json'), $tocJson, (New-Object System.Text.UTF8Encoding($false)))

    $fileCount = (Get-ChildItem -LiteralPath $OutputDir -Recurse -File).Count
    Write-Host "OK: Xbox SDK HTML docs at $OutputDir ($fileCount files)" -ForegroundColor Green
}
finally {
    if (Test-Path -LiteralPath $temp) {
        Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

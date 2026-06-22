# Bundle docs/xboxsdk/ into docs/xboxsdk.tar.gz for faster VSIX packaging.
param(
    [string]$ExtensionRoot = (Join-Path $PSScriptRoot '..')
)
$ErrorActionPreference = 'Stop'
$ExtensionRoot = [IO.Path]::GetFullPath($ExtensionRoot)
$docsSrc = Join-Path $ExtensionRoot 'docs\xboxsdk'
$archive = Join-Path $ExtensionRoot 'docs\xboxsdk.tar.gz'

foreach ($required in @(
        (Join-Path $docsSrc 'toc.json')
        (Join-Path $docsSrc 'xbox_pk_welcome.htm')
    )) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "Missing $required - restore docs/xboxsdk/ in git before bundling."
    }
}

$docsDir = Join-Path $ExtensionRoot 'docs'
Push-Location $docsDir
try {
    if (Test-Path -LiteralPath 'xboxsdk.tar.gz') {
        Remove-Item -LiteralPath 'xboxsdk.tar.gz' -Force
    }
    & tar -czf xboxsdk.tar.gz xboxsdk
    if ($LASTEXITCODE -ne 0) {
        throw 'tar failed creating docs/xboxsdk.tar.gz'
    }
} finally {
    Pop-Location
}

$sizeMb = [math]::Round((Get-Item -LiteralPath $archive).Length / 1MB, 2)
$fileCount = (Get-ChildItem -LiteralPath $docsSrc -Recurse -File).Count
Write-Host "OK: docs/xboxsdk.tar.gz ($sizeMb MB, $fileCount source files)" -ForegroundColor Green

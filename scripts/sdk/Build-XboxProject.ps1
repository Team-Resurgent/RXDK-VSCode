# Generic Xbox title build from rxdk.project.json using bundled SDK.
param(
    [Parameter(Mandatory)]
    [string]$SdkRoot,
    [Parameter(Mandatory)]
    [string]$ProjectRoot,
    [string]$MsvcVersion,
    [switch]$CompileOnly
)
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'Get-XboxSdkPaths.ps1')
. (Join-Path $PSScriptRoot 'Get-XdkLinkAliases.ps1')
. (Join-Path $PSScriptRoot 'Get-XdkLinkIgnores.ps1')
. (Join-Path $PSScriptRoot 'Invoke-ImageBuild.ps1')
. (Join-Path $PSScriptRoot 'Invoke-PackXiso.ps1')

function Get-MsvcToolsetVersion {
    param(
        [Parameter(Mandatory)]
        [string]$VsInstall,
        [string]$Override
    )
    if ($Override) { return $Override.Trim() }
    if ($env:RXDK_MSVC_VERSION) { return $env:RXDK_MSVC_VERSION.Trim() }
    $msvcRoot = Join-Path $VsInstall 'VC\Tools\MSVC'
    if (-not (Test-Path -LiteralPath $msvcRoot)) {
        throw "MSVC toolsets not found under $msvcRoot"
    }
    $latest = Get-ChildItem -LiteralPath $msvcRoot -Directory | Sort-Object Name -Descending | Select-Object -First 1
    if (-not $latest) {
        throw "No MSVC toolset found under $msvcRoot"
    }
    return $latest.Name
}

$paths = Get-XboxSdkPaths -SdkRoot $SdkRoot
$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
$manifest = Get-XboxProjectManifest -ProjectRoot $ProjectRoot
$projectName = $manifest.name
$outDir = Get-XboxProjectOutDir -ProjectRoot $ProjectRoot -Manifest $manifest
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

if (-not (Test-Path -LiteralPath $paths.Include)) {
    throw "Missing sdk/include - run scripts/sync-all.ps1"
}

$vs = & "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" -latest -property installationPath
if (-not $vs) {
    throw @"
Visual Studio 2022 not found. Install VS2022 with Desktop development with C++ (x86 build tools).
"@
}
$msvcVer = Get-MsvcToolsetVersion -VsInstall $vs -Override $MsvcVersion
$cl = Join-Path $vs "VC\Tools\MSVC\$msvcVer\bin\Hostx86\x86\cl.exe"
$link = Join-Path $vs "VC\Tools\MSVC\$msvcVer\bin\Hostx86\x86\link.exe"
if (-not (Test-Path $cl)) { throw "cl.exe not found: $cl" }

function Resolve-Lib([string]$Name) {
    $candidates = @(
        (Join-Path $paths.Lib $Name)
    )
    $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}

$krnlLib = Resolve-Lib 'xboxkrnl.lib'
if (-not $krnlLib -and -not $CompileOnly) {
    throw "Missing xboxkrnl.lib under sdk/lib - run sync-all.ps1"
}

$warnOff = @(
    '/wd4005', '/wd4996', '/wd4018', '/wd4244', '/wd4267', '/wd4311', '/wd4312',
    '/wd4326', '/wd4508', '/wd4701', '/wd4702', '/wd4710', '/wd4711', '/wd4800', '/wd5287',
    '/wd4094', '/wd4335', '/wd4346'
)

function Get-ProjectIncludeArgs {
    param(
        [string]$ProjectRoot,
        [string]$SdkInclude,
        [object]$Manifest
    )
    $includeArgs = @("/I$SdkInclude")
    if ($Manifest.includePaths) {
        foreach ($relPath in $Manifest.includePaths) {
            if ([string]::IsNullOrWhiteSpace($relPath)) { continue }
            $dir = Join-Path $ProjectRoot (($relPath -replace '/', '\').TrimEnd('\'))
            if (-not (Test-Path -LiteralPath $dir)) {
                throw "includePaths: not found $dir"
            }
            $includeArgs += "/I$([IO.Path]::GetFullPath($dir))"
        }
    }
    return $includeArgs
}

function Get-ProjectDefineArgs {
    param([object]$Manifest)
    $defineArgs = @()
    if ($Manifest.defines) {
        foreach ($define in $Manifest.defines) {
            if ([string]::IsNullOrWhiteSpace($define)) { continue }
            $defineArgs += "/D$define"
        }
    }
    return $defineArgs
}

$projectIncludeArgs = Get-ProjectIncludeArgs -ProjectRoot $ProjectRoot -SdkInclude $paths.Include -Manifest $manifest
$projectDefineArgs = Get-ProjectDefineArgs -Manifest $manifest

$objs = @()
$useCpp = $false

foreach ($relSrc in $manifest.sources) {
    $src = Join-Path $ProjectRoot ($relSrc -replace '/', '\')
    if (-not (Test-Path -LiteralPath $src)) {
        throw "Source not found: $src"
    }
    $base = [IO.Path]::GetFileNameWithoutExtension($src)
    $obj = Join-Path $outDir "$base.obj"
    $ext = [IO.Path]::GetExtension($src).ToLowerInvariant()

    if ($ext -eq '.cpp' -or $ext -eq '.cxx') {
        $useCpp = $true
        $fiModern = Join-Path $paths.Include 'xdk_modern_stl.h'
        $fiHeap = Join-Path $paths.Include 'xdk_crt_heap.h'
        if (-not (Test-Path $fiModern)) {
            throw "Missing $fiModern - sync sdk/include"
        }
        $clArgs = @(
            '/nologo', '/W3', '/EHsc', '/GR', '/GS-', '/std:c++20', '/permissive-', '/Zc:__cplusplus',
            '/Zi', '/Oy-', '/arch:IA32',
            '/D_WIN32', '/D_WINNT', '/D_XBOX', '/D_X86_', '/DNT_UP=1', '/D_CRTBLD', '/D_MT', '/D_STATIC_CPPLIB',
            '/D_MBCS', '/D_MB_MAP_DIRECT', '/D_KANJI', '/D_HAS_CXX20=1', '/DNDEBUG',
            "/FI$fiModern", "/FI$fiHeap"
        ) + $projectIncludeArgs + $projectDefineArgs + $warnOff + @('/c', "/Fo:$obj", $src)
    } else {
        $clArgs = @(
            '/nologo', '/W3', '/EHsc-', '/GR-', '/GS-', '/TC',
            '/Zi', '/Oy-',
            '/D_WIN32', '/D_WINNT', '/D_XBOX', '/D_X86_', '/DNT_UP=1', '/DNDEBUG',
            '/DNOD3D', '/DNODSOUND'
        ) + $projectIncludeArgs + $projectDefineArgs + $warnOff + @('/c', "/Fo:$obj", $src)
    }

    Write-Host "$cl $($clArgs -join ' ')"
    $log = @( & $cl @clArgs 2>&1 )
    $warnLines = $log | Where-Object { $_ -match ': warning C' }
    if ($warnLines -and $useCpp) {
        $warnLines | ForEach-Object { Write-Warning $_ }
        throw "Compile reported $($warnLines.Count) warning(s) in $relSrc"
    }
    if ($LASTEXITCODE -ne 0) {
        $log | ForEach-Object { Write-Host $_ }
        throw "cl.exe failed on $relSrc (exit $LASTEXITCODE)"
    }
    Write-Host "Compiled $obj"
    $objs += $obj
}

if ($CompileOnly) {
    Write-Host "Compile OK (-CompileOnly)."
    exit 0
}

if (-not (Test-Path $link)) { throw "link.exe not found: $link" }

$libPaths = @("/LIBPATH:$($paths.Lib)")
$linkLibs = @()
foreach ($libName in $manifest.libraries) {
    $resolved = Resolve-Lib "$libName.lib"
    if (-not $resolved) {
        throw "Missing library: $libName.lib under sdk/lib"
    }
    $linkLibs += $resolved
}
$linkLibs += (Split-Path $krnlLib -Leaf)

$linkAliases = @(Get-XdkLinkAliases)
$linkIgnoreArgs = @(Get-XdkLinkIgnoreArg -StrictLink)
$exe = [IO.Path]::GetFullPath((Join-Path $outDir "$projectName.exe"))
$mapFile = Join-Path $outDir "$projectName.map"

$linkArgs = @(
    '/nologo',
    '/SUBSYSTEM:CONSOLE', '/MACHINE:IX86', "/OUT:$exe",
    "/MAP:$mapFile",
    '/DEBUG:FULL', '/PDBALTPATH:%_PDB%',
    '/NODEFAULTLIB'
)
if (-not $useCpp) {
    $linkArgs += '/ENTRY:mainCRTStartup'
}
$linkArgs += $libPaths + $objs
$linkArgs += $linkIgnoreArgs + $linkAliases + $linkLibs

Write-Host "$link $($linkArgs -join ' ')"
$linkLog = @( & $link @linkArgs 2>&1 )
$linkLog | Write-Host
$ignoredLinkWarn = Get-XdkLinkIgnorePattern -StrictLink
$linkWarn = $linkLog | Where-Object { $_ -match ': warning LNK' -and $_ -notmatch "LNK($ignoredLinkWarn)\b" }
if ($linkWarn) {
    $linkWarn | ForEach-Object { Write-Warning $_ }
    throw "Link reported $($linkWarn.Count) warning(s)"
}
if ($LASTEXITCODE -ne 0) {
    if ($linkLog -match 'LNK1201') {
        throw @"
link.exe failed (LNK1201): PDB locked. Stop the Xbox debug session (Shift+F5) and rebuild.
"@
    }
    throw "link.exe failed (exit $LASTEXITCODE)"
}
Write-Host "Linked $exe"

$imageBld = Get-HostToolPath -ToolsRoot $paths.Tools -Name 'imagebld'
$xdvdfs = Get-HostToolPath -ToolsRoot $paths.Tools -Name 'xdvdfs'
if (-not (Test-Path $imageBld)) { throw "Missing $imageBld" }
if (-not (Test-Path $xdvdfs)) { throw "Missing $xdvdfs" }

$insertFiles = @()
if ($manifest.embed) {
    foreach ($item in $manifest.embed) {
        if (-not $item.path -or -not $item.name) { continue }
        $embedPath = Join-Path $ProjectRoot ($item.path -replace '/', '\')
        if (Test-Path -LiteralPath $embedPath) {
            $insertFiles += "$([IO.Path]::GetFullPath($embedPath)),$($item.name),R"
            Write-Host "Embedding $($item.name) from $embedPath"
        } else {
            Write-Warning "embed path not found: $embedPath"
        }
    }
}

$xbe = Invoke-ImageBuild -InputExe $exe -ToolPath $imageBld -ImageBuild $manifest.imageBuild -InsertFile $insertFiles
Write-Host "Built $xbe"
try {
    $iso = Invoke-PackXiso -InputXbe $xbe -ProjectName $projectName -OutDir $outDir -ToolPath $xdvdfs
    Write-Host "Packed $iso"
} catch {
    Write-Host "Note: ISO pack skipped ($($_.Exception.Message))"
}
Write-Host "OK: $projectName build complete -> $outDir"

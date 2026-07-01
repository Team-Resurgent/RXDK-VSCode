# Generic Xbox title build from rxdk.project.json using staged SDK + Zig toolchain.
param(
    [Parameter(Mandatory)]
    [string]$SdkRoot,
    [Parameter(Mandatory)]
    [string]$ProjectRoot,
    [string]$IncludeDir,
    [string]$LibDir,
    [string]$ZigExecutable,
    [switch]$CompileOnly
)
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'Get-XboxSdkPaths.ps1')
. (Join-Path $PSScriptRoot 'Get-ZigExecutable.ps1')
. (Join-Path $PSScriptRoot 'Invoke-XdkLink.ps1')
. (Join-Path $PSScriptRoot 'Invoke-ImageBuild.ps1')
. (Join-Path $PSScriptRoot 'Invoke-PackXiso.ps1')

function Get-XdkClangWarnings {
    return @(
        '-Wno-macro-redefined',
        '-Wno-deprecated-declarations',
        '-Wno-sign-compare',
        '-Wno-sign-conversion',
        '-Wno-implicit-int-conversion',
        '-Wno-shorten-64-to-32',
        '-Wno-pointer-to-int-cast',
        '-Wno-int-to-pointer-cast',
        '-Wno-unused-parameter',
        '-Wno-unused-variable',
        '-Wno-unused-function',
        '-Wno-missing-field-initializers',
        '-Wno-switch',
        '-Wno-ignored-qualifiers',
        '-Wno-invalid-source-encoding',
        '-Wno-pragma-pack',
        '-Wno-nonportable-include-path',
        '-Wno-main-return-type',
        '-Wno-missing-prototype-for-cc',
        '-Wno-ignored-pragma-intrinsic',
        '-Wno-multichar',
        '-Wno-comment',
        '-Wno-extra-tokens',
        '-Wno-unused-command-line-argument'
    )
}

function Get-ProjectIncludeArgs {
    param(
        [string]$ProjectRoot,
        [string]$SdkInclude,
        [object]$Manifest
    )
    # -I (not -isystem): the SDK's clean-room windef.h/etc. must win over zig's
    # bundled MinGW any-windows-any headers, which -isystem would let shadow them.
    $includeArgs = @('-I', $SdkInclude)
    if ($Manifest.includePaths) {
        foreach ($relPath in $Manifest.includePaths) {
            if ([string]::IsNullOrWhiteSpace($relPath)) { continue }
            $dir = Join-Path $ProjectRoot (($relPath -replace '/', '\').TrimEnd('\'))
            if (-not (Test-Path -LiteralPath $dir)) {
                throw "includePaths: not found $dir"
            }
            $includeArgs += "-I$([IO.Path]::GetFullPath($dir))"
        }
    }
    return ,@($includeArgs)
}

function Get-ProjectDefineArgs {
    param([object]$Manifest)
    $defineArgs = @()
    if ($Manifest.defines) {
        foreach ($define in $Manifest.defines) {
            if ([string]::IsNullOrWhiteSpace($define)) { continue }
            $defineArgs += "-D$define"
        }
    }
    return ,@($defineArgs)
}

function Invoke-ZigCompile {
    param(
        [Parameter(Mandatory)]
        [string]$Zig,
        [Parameter(Mandatory)]
        [string]$Source,
        [Parameter(Mandatory)]
        [string]$Object,
        [string[]]$IncludeArgs = @(),
        [string[]]$DefineArgs = @(),
        [string[]]$ExtraArgs = @(),
        [switch]$IsCpp
    )
    # Matches the RXDK SDK's own title compile recipe (build/xbox_target.zig):
    # x86-windows-gnu + -nostdinc + force-included picolibc.h, so the staged SDK
    # headers (<xtl.h> and friends) are the only ones on the path. -march=pentium3
    # is the Xbox CPU.
    $warnOff = @(Get-XdkClangWarnings)
    $common = @(
        '-target', 'x86-windows-gnu',
        '-O0', '-g', '-fno-sanitize=undefined',
        '-ffreestanding',
        '-fno-stack-protector',
        '-fms-extensions', '-fms-compatibility',
        '-nostdinc',
        '-include', 'picolibc.h',
        '-march=pentium3'
    ) + $IncludeArgs + $DefineArgs + $ExtraArgs + $warnOff + @('-c', $Source, "-o$Object")

    if ($IsCpp) {
        $toolArgs = @(
            'c++',
            '-std=c++20',
            '-nostdinc++',
            '-fno-exceptions',
            '-frtti'
        ) + $common
    } else {
        $toolArgs = @('cc', '-std=c17') + $common
    }

    Write-Host "$Zig $($toolArgs -join ' ')"
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $log = @( & $Zig @toolArgs 2>&1 )
    $ErrorActionPreference = $prevEap
    $warnLines = $log | Where-Object {
        $_ -match ': warning:' -and $_ -match ([regex]::Escape([IO.Path]::GetFullPath($Source)))
    }
    if ($warnLines -and $IsCpp) {
        $warnLines | ForEach-Object { Write-Warning $_ }
        throw "Compile reported $($warnLines.Count) warning(s) in $Source"
    }
    if ($LASTEXITCODE -ne 0) {
        $log | ForEach-Object { Write-Host $_ }
        throw "Zig compile failed on $Source (exit $LASTEXITCODE)"
    }
    Write-Host "Compiled $Object"
}

$paths = Get-XboxSdkPaths -SdkRoot $SdkRoot -IncludeDir $IncludeDir -LibDir $LibDir
$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
$manifest = Get-XboxProjectManifest -ProjectRoot $ProjectRoot
$projectName = $manifest.name
$outDir = Get-XboxProjectOutDir -ProjectRoot $ProjectRoot -Manifest $manifest
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

if (-not (Test-Path -LiteralPath $paths.Include)) {
    throw "Missing sdk/include - run RXDK prerequisites (SDK install)"
}

$zig = Resolve-ZigExecutable -Override $ZigExecutable

function Resolve-Lib([string]$Name) {
    $candidate = Join-Path $paths.Lib $Name
    if (Test-Path -LiteralPath $candidate) { return $candidate }
    return $null
}

$krnlLib = Resolve-Lib 'libkernel.lib'
if (-not $krnlLib) { $krnlLib = Resolve-Lib 'xboxkrnl.lib' }  # pre-rename SDKs
if (-not $krnlLib -and -not $CompileOnly) {
    throw "Missing libkernel.lib under sdk/lib - run RXDK SDK install"
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
    $isCpp = ($ext -eq '.cpp' -or $ext -eq '.cxx')
    if ($isCpp) { $useCpp = $true }

    Invoke-ZigCompile -Zig $zig -Source $src -Object $obj -IncludeArgs $projectIncludeArgs `
        -DefineArgs $projectDefineArgs -IsCpp:$isCpp
    $objs += $obj
}

if ($CompileOnly) {
    Write-Host "Compile OK (-CompileOnly)."
    exit 0
}

# Any title that links libxapi gets the XAPI + CRT + TLS bring-up before main
# (entry XapiTitleStartup); a bare libc title enters at 'start'.
$usesXapi = @($manifest.libraries | Where-Object { $_ -eq 'libxapi' }).Count -gt 0
$entry = if ($usesXapi) { 'XapiTitleStartup' } else { 'start' }

$linkLibs = @()
foreach ($libName in $manifest.libraries) {
    $resolved = Resolve-Lib "$libName.lib"
    if (-not $resolved) {
        throw "Missing library: $libName.lib under sdk/lib"
    }
    $linkLibs += $resolved
}
$linkLibs += $krnlLib

# The title startup object (XapiTitleStartup), prebuilt title-side by the SDK and
# shipped in sdk/lib. It must be compiled with the title recipe (never as an
# internal libxapi source), which the SDK dist build guarantees.
if ($usesXapi) {
    $startupObj = Resolve-Lib 'xapi_start.obj'
    if (-not $startupObj) {
        throw "Missing xapi_start.obj under sdk/lib - reinstall the RXDK SDK"
    }
    $objs += $startupObj
}

# xboxkrnl_xbld.obj supplies kernel build/descriptor data every title needs.
$xbldObj = Resolve-Lib 'xboxkrnl_xbld.obj'
if (-not $xbldObj) {
    throw "Missing xboxkrnl_xbld.obj under sdk/lib - reinstall the RXDK SDK"
}

# Single-pass link. imagebld (build-78+) zero-fills the emitted .data so the XBE
# loader copies the zeroed .bss tail -- uninitialized globals boot as zero with no
# runtime fixup, so no per-title image_init bootstrap is needed.
$exe = [IO.Path]::GetFullPath((Join-Path $outDir "$projectName.exe"))

$linkResult = Invoke-XdkLink -Zig $zig -Objs $objs -Libs $linkLibs -OutExe $exe -XbldObj $xbldObj -Entry $entry
if ($linkResult.ExitCode -ne 0) {
    throw "Link failed (exit $($linkResult.ExitCode))"
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

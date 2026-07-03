import * as fs from 'fs';
import * as path from 'path';
import { OutputLike, runStreamed } from './processRunner';
import { RxdkProjectManifest } from './projectTypes';
import { getXboxProjectOutDir } from './sdkPath';
import { readProjectManifestAt } from './xboxSdkPaths';
import { resolveZigExecutable } from './zigRuntime';
import { resolveHostTool } from './hostTools';
import { linkXdk } from './xdkLink';
import { buildXbe } from './imageBuild';
import { packXiso } from './packXiso';

export type BuildProjectResult = { ok: true; outDir: string } | { ok: false; error: string };

// Matches the RXDK SDK's own title compile recipe (build/xbox_target.zig):
// x86-windows-gnu + -nostdinc + force-included picolibc.h, so the staged SDK
// headers (<xtl.h> and friends) are the only ones on the path. -march=pentium3
// is the Xbox CPU. -I (not -isystem) everywhere: the SDK's clean-room
// windef.h/etc. must win over zig's bundled MinGW any-windows-any headers,
// which -isystem would let shadow them.
const XDK_CLANG_WARNINGS = [
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
    '-Wno-unused-command-line-argument',
];

function projectDefineArgs(manifest: RxdkProjectManifest): string[] {
    return (manifest.defines ?? []).filter((d) => d?.trim()).map((d) => `-D${d}`);
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface ZigCompileOptions {
    zig: string;
    source: string;
    object: string;
    includeArgs: string[];
    defineArgs: string[];
    isCpp: boolean;
    output?: OutputLike;
}

async function zigCompile(opts: ZigCompileOptions): Promise<void> {
    const common = [
        '-target', 'x86-windows-gnu',
        '-O0', '-g', '-fno-sanitize=undefined',
        '-ffreestanding',
        '-fno-stack-protector',
        '-fms-extensions', '-fms-compatibility',
        '-nostdinc',
        '-include', 'picolibc.h',
        '-march=pentium3',
        // Without this, Clang is free to recognize a memmove/memcpy/RtlMoveMemory-
        // shaped call site as a known builtin and inline-expand it directly at the
        // call site, bypassing the SDK's own (correctly -fno-builtin-compiled)
        // picolibc implementation entirely. Matches every flag set in RXDK-Libs'
        // own build.zig (build/xbox_target.zig, libs/*/build.zig) - every title's
        // own source needs the same guarantee, not just the SDK libraries.
        '-fno-builtin',
        ...opts.includeArgs,
        ...opts.defineArgs,
        ...XDK_CLANG_WARNINGS,
        '-c', opts.source, `-o${opts.object}`,
    ];
    const toolArgs = opts.isCpp
        ? ['c++', '-std=c++20', '-nostdinc++', '-fno-exceptions', '-frtti', ...common]
        : ['cc', '-std=c17', ...common];

    const result = await runStreamed(opts.zig, toolArgs, { output: opts.output });
    const combined = (result.stdout + result.stderr).split(/\r?\n/);
    const sourcePattern = new RegExp(escapeRegExp(path.resolve(opts.source)));
    const warnLines = combined.filter((line) => line.includes(': warning:') && sourcePattern.test(line));
    if (warnLines.length > 0 && opts.isCpp) {
        throw new Error(`Compile reported ${warnLines.length} warning(s) in ${opts.source}`);
    }
    if (result.exitCode !== 0) {
        throw new Error(`Zig compile failed on ${opts.source} (exit ${result.exitCode})`);
    }
}

// --- Multi-project (library reference) support --------------------------------

function getProjectReferences(projectRoot: string, manifest: RxdkProjectManifest): string[] {
    const refs: string[] = [];
    for (const rel of manifest.projectReferences ?? []) {
        if (!rel?.trim()) {
            continue;
        }
        const dir = path.resolve(projectRoot, rel);
        if (!fs.existsSync(path.join(dir, 'rxdk.project.json'))) {
            throw new Error(`projectReferences: no rxdk.project.json in ${dir}`);
        }
        refs.push(dir);
    }
    return refs;
}

function addDependencyOrder(dir: string, ordered: string[], state: Map<string, 'visiting' | 'done'>): void {
    const key = dir.toLowerCase();
    if (state.get(key) === 'done') {
        return;
    }
    if (state.get(key) === 'visiting') {
        throw new Error(`Cyclic projectReferences involving ${dir}`);
    }
    state.set(key, 'visiting');
    const manifest = readProjectManifestAt(dir);
    for (const ref of getProjectReferences(dir, manifest)) {
        addDependencyOrder(ref, ordered, state);
    }
    state.set(key, 'done');
    ordered.push(dir);
}

/** Transitive library dependencies of a project, in build (deps-first) order. */
function getDependencyOrder(projectRoot: string, manifest: RxdkProjectManifest): string[] {
    const ordered: string[] = [];
    const state = new Map<string, 'visiting' | 'done'>();
    for (const ref of getProjectReferences(projectRoot, manifest)) {
        addDependencyOrder(ref, ordered, state);
    }
    return ordered;
}

function resolveIncludeArgs(projectRoot: string, values: string[] | undefined, label: string): string[] {
    const out: string[] = [];
    for (const rel of values ?? []) {
        if (!rel?.trim()) {
            continue;
        }
        const dir = path.resolve(projectRoot, rel);
        if (!fs.existsSync(dir)) {
            throw new Error(`${label}: not found ${dir}`);
        }
        out.push(`-I${dir}`);
    }
    return out;
}

/** Public includes exported by every transitive library dependency (deduped -I args). */
function getTransitivePublicIncludeArgs(projectRoot: string, manifest: RxdkProjectManifest): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const dep of getDependencyOrder(projectRoot, manifest)) {
        const depManifest = readProjectManifestAt(dep);
        for (const arg of resolveIncludeArgs(dep, depManifest.publicIncludePaths, 'publicIncludePaths')) {
            if (!seen.has(arg)) {
                seen.add(arg);
                out.push(arg);
            }
        }
    }
    return out;
}

interface CompiledSources { objs: string[]; usesCpp: boolean }

/** Compile every source in a project to outDir. */
async function compileProjectSources(
    projectRoot: string,
    manifest: RxdkProjectManifest,
    zig: string,
    outDir: string,
    includeArgs: string[],
    defineArgs: string[],
    output?: OutputLike
): Promise<CompiledSources> {
    const objs: string[] = [];
    let usesCpp = false;
    for (const relSrc of manifest.sources ?? []) {
        const src = path.join(projectRoot, relSrc.replace(/\//g, path.sep));
        if (!fs.existsSync(src)) {
            throw new Error(`Source not found: ${src}`);
        }
        const obj = path.join(outDir, `${path.basename(src, path.extname(src))}.obj`);
        const ext = path.extname(src).toLowerCase();
        const isCpp = ext === '.cpp' || ext === '.cxx';
        if (isCpp) {
            usesCpp = true;
        }
        await zigCompile({ zig, source: src, object: obj, includeArgs, defineArgs, isCpp, output });
        output?.appendLine(`Compiled ${obj}`);
        objs.push(obj);
    }
    return { objs, usesCpp };
}

/** Build one library project to a static .lib and return its path. */
async function buildXboxLibrary(
    libRoot: string,
    zig: string,
    sdkInclude: string,
    output?: OutputLike
): Promise<string> {
    const manifest = readProjectManifestAt(libRoot);
    if (manifest.type !== 'library') {
        throw new Error(`projectReferences must point to type:library projects - ${manifest.name} is not one`);
    }
    const outDir = getXboxProjectOutDir(libRoot, manifest);
    fs.mkdirSync(outDir, { recursive: true });

    const includeArgs = [
        '-I', sdkInclude,
        ...resolveIncludeArgs(libRoot, manifest.includePaths, 'includePaths'),
        ...resolveIncludeArgs(libRoot, manifest.publicIncludePaths, 'publicIncludePaths'),
        ...getTransitivePublicIncludeArgs(libRoot, manifest),
    ];
    const defineArgs = projectDefineArgs(manifest);

    output?.appendLine(`== Building library ${manifest.name} ==`);
    const compiled = await compileProjectSources(libRoot, manifest, zig, outDir, includeArgs, defineArgs, output);
    if (compiled.objs.length === 0) {
        throw new Error(`Library ${manifest.name} has no sources to archive`);
    }

    const lib = path.join(outDir, `${manifest.name}.lib`);
    if (fs.existsSync(lib)) {
        fs.rmSync(lib, { force: true });
    }
    const arResult = await runStreamed(zig, ['ar', 'rcs', lib, ...compiled.objs], { output });
    if (arResult.exitCode !== 0) {
        throw new Error(`Archiving ${lib} failed (exit ${arResult.exitCode})`);
    }
    output?.appendLine(`Archived ${lib}`);
    return lib;
}

// --- Main ----------------------------------------------------------------

export interface BuildXboxProjectOptions {
    projectRoot: string;
    sdkInclude: string;
    sdkLib: string;
    zigExecutable?: string;
    compileOnly?: boolean;
    output?: OutputLike;
}

export async function buildXboxProject(opts: BuildXboxProjectOptions): Promise<BuildProjectResult> {
    try {
        const projectRoot = path.resolve(opts.projectRoot);
        const manifest = readProjectManifestAt(projectRoot);
        const projectName = manifest.name;
        const outDir = getXboxProjectOutDir(projectRoot, manifest);
        fs.mkdirSync(outDir, { recursive: true });

        if (!fs.existsSync(opts.sdkInclude)) {
            throw new Error('Missing sdk/include - run RXDK prerequisites (SDK install)');
        }
        const zig = await resolveZigExecutable(opts.zigExecutable);
        if (!zig) {
            throw new Error('Zig not found. Install Zig from the RXDK prerequisites panel, or add zig to PATH.');
        }

        const resolveLib = (name: string): string | undefined => {
            const candidate = path.join(opts.sdkLib, name);
            return fs.existsSync(candidate) ? candidate : undefined;
        };

        // Build referenced library projects first, in dependency order, collecting their .libs.
        const depOrder = getDependencyOrder(projectRoot, manifest);
        const userLibs: string[] = [];
        for (const dep of depOrder) {
            userLibs.push(await buildXboxLibrary(dep, zig, opts.sdkInclude, opts.output));
        }

        // A library root builds to a .lib and stops (no link / imagebld / deploy).
        if (manifest.type === 'library') {
            const lib = await buildXboxLibrary(projectRoot, zig, opts.sdkInclude, opts.output);
            opts.output?.appendLine(`OK: library ${projectName} build complete -> ${lib}`);
            return { ok: true, outDir };
        }

        // Compile this executable's own sources: SDK include + its own include paths +
        // every referenced library's exported publicIncludePaths.
        const projectIncludeArgs = [
            '-I', opts.sdkInclude,
            ...resolveIncludeArgs(projectRoot, manifest.includePaths, 'includePaths'),
            ...resolveIncludeArgs(projectRoot, manifest.publicIncludePaths, 'publicIncludePaths'),
            ...getTransitivePublicIncludeArgs(projectRoot, manifest),
        ];
        const projectDefines = projectDefineArgs(manifest);

        opts.output?.appendLine(`== Building executable ${projectName} ==`);
        const compiled = await compileProjectSources(
            projectRoot, manifest, zig, outDir, projectIncludeArgs, projectDefines, opts.output
        );
        const objs = compiled.objs;

        if (opts.compileOnly) {
            opts.output?.appendLine('Compile OK (-CompileOnly).');
            return { ok: true, outDir };
        }

        // SDK libraries to link: the executable's own plus every referenced library's,
        // deduped in first-seen order, with libkernel forced last so libxapi and the other
        // archives resolve their kernel imports from it (old SDKs shipped it as xboxkrnl.lib).
        const libNames: string[] = [];
        const addLibName = (n: string): void => {
            if (n?.trim() && !libNames.includes(n)) {
                libNames.push(n);
            }
        };
        for (const n of manifest.libraries ?? []) { addLibName(n); }
        for (const dep of depOrder) {
            const depManifest = readProjectManifestAt(dep);
            for (const n of depManifest.libraries ?? []) { addLibName(n); }
        }
        if (libNames.includes('libkernel')) {
            libNames.splice(libNames.indexOf('libkernel'), 1);
            libNames.push('libkernel');
        }

        // Any title that links libxapi gets the XAPI + CRT + TLS bring-up before main
        // (entry XapiTitleStartup); a bare libc title enters at 'start'.
        const entry = libNames.includes('libxapi') ? 'XapiTitleStartup' : 'start';

        const linkLibs: string[] = [];
        // Referenced library .libs go in a group so their inter-library (and back-)
        // references resolve regardless of link order.
        if (userLibs.length > 0) {
            linkLibs.push('-Wl,--start-group', ...userLibs, '-Wl,--end-group');
        }
        for (const libName of libNames) {
            const resolved = resolveLib(`${libName}.lib`) ?? (libName === 'libkernel' ? resolveLib('xboxkrnl.lib') : undefined);
            if (!resolved) {
                throw new Error(`Missing library: ${libName}.lib under sdk/lib - run RXDK SDK install`);
            }
            linkLibs.push(resolved);
        }

        // Single-pass link. imagebld (build-78+) zero-fills the emitted .data so the XBE
        // loader copies the zeroed .bss tail -- uninitialized globals boot as zero with no
        // runtime fixup, so no per-title image_init bootstrap is needed.
        const exe = path.resolve(path.join(outDir, `${projectName}.exe`));
        const linkResult = await linkXdk({
            zig, objs, libs: linkLibs, outExe: exe, entry, libDir: opts.sdkLib, output: opts.output,
        });
        if (linkResult.exitCode !== 0) {
            throw new Error(`Link failed (exit ${linkResult.exitCode})`);
        }
        opts.output?.appendLine(`Linked ${exe}`);

        const imageBldPath = resolveHostTool('imagebld');
        const xdvdfsPath = resolveHostTool('xdvdfs');
        if (!fs.existsSync(imageBldPath)) {
            throw new Error(`Missing ${imageBldPath}`);
        }
        if (!fs.existsSync(xdvdfsPath)) {
            throw new Error(`Missing ${xdvdfsPath}`);
        }

        const insertFiles: string[] = [];
        for (const item of manifest.embed ?? []) {
            if (!item.path || !item.name) {
                continue;
            }
            const embedPath = path.join(projectRoot, item.path.replace(/\//g, path.sep));
            if (fs.existsSync(embedPath)) {
                insertFiles.push(`${path.resolve(embedPath)},${item.name},R`);
                opts.output?.appendLine(`Embedding ${item.name} from ${embedPath}`);
            } else {
                opts.output?.appendLine(`Warning: embed path not found: ${embedPath}`);
            }
        }

        const xbe = await buildXbe({
            inputExe: exe,
            toolPath: imageBldPath,
            imageBuild: manifest.imageBuild,
            insertFiles,
            output: opts.output,
        });
        opts.output?.appendLine(`Built ${xbe}`);
        try {
            const iso = await packXiso({
                inputXbe: xbe, projectName, outDir, toolPath: xdvdfsPath, output: opts.output,
            });
            opts.output?.appendLine(`Packed ${iso}`);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            opts.output?.appendLine(`Note: ISO pack skipped (${message})`);
        }
        opts.output?.appendLine(`OK: ${projectName} build complete -> ${outDir}`);
        return { ok: true, outDir };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

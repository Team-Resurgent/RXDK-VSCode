import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
    isDxtManifest,
    manifestNeedsIntelliSense,
    manifestUsesCpp,
    resolveConfiguration,
    RxdkProjectManifest,
} from './projectTypes';
import { getSdkIncludeDir } from './sdkPath';
import { stripBom } from './xboxSdkPaths';
import { getSelectedConfig } from './configSelection';
import { setActiveConfiguration } from './activeConfig';

// Settings-file marker recording which configuration the generated .vscode folder was built for,
// so switching configuration is detected as "stale" and the IntelliSense config is regenerated.
const ACTIVE_CONFIG_KEY = 'rxdk.activeConfiguration';

const EXTENSION_ID = 'TeamResurgent.rxdk-vscode';
const EXTENSION_ROOT = `\${extensionInstallFolder:${EXTENSION_ID}}`;
const SDK_ROOT = `${EXTENSION_ROOT}/sdk`;
// The generated tasks.json uses `type: "rxdk"` custom-execution tasks (see
// rxdkTaskProvider.ts): build/deploy/run execute in the extension host itself, with
// no external process. This deliberately avoids the old `${execPath}` +
// ELECTRON_RUN_AS_NODE approach, which newer VS Code broke by stripping that env var
// from task environments (silently failing the build and, with it, F5's
// preLaunchTask). The cli.js entry point (src/cli.ts) remains for headless/CI use.

function normalizeConfigPath(value: string): string {
    return path.normalize(value).replace(/\\/g, '/').toLowerCase();
}

function vscodeConfigIsStale(projectRoot: string, projectName = '', configName = ''): boolean {
    const tasksPath = path.join(projectRoot, '.vscode', 'tasks.json');
    if (!fs.existsSync(tasksPath)) {
        return true;
    }
    // Launch entry names carry the active build config, e.g. "Debug Foo [Debug]"; if a multi-config
    // project's launch.json still has the un-suffixed name (or the wrong config), regenerate so the
    // Run and Debug dropdown tracks the selected configuration on reload -- not only after a switch.
    if (configName && projectName) {
        const launchPath = path.join(projectRoot, '.vscode', 'launch.json');
        if (fs.existsSync(launchPath)) {
            try {
                const launchContent = fs.readFileSync(launchPath, 'utf8');
                if (launchContent.includes(`"Debug ${projectName}"`) || !launchContent.includes(`[${configName}]`)) {
                    return true;
                }
            } catch {
                return true;
            }
        }
    }
    const content = fs.readFileSync(tasksPath, 'utf8');
    return (
        content.includes('.vscode/extensions/TeamResurgent.rxdk-vscode-') ||
        content.includes('.cursor/extensions/TeamResurgent.rxdk-vscode-') ||
        !content.includes('extensionInstallFolder:TeamResurgent.rxdk-vscode') ||
        content.includes('rxdk-vscode}/out/sdk') ||
        (content.includes('rxdk-vscode}/sdk') && !content.includes('extensionInstallFolder:TeamResurgent.rxdk-vscode')) ||
        // Pre-CLI-migration tasks.json shelled out to PowerShell scripts directly.
        content.includes('"command": "powershell"') ||
        content.includes('.ps1') ||
        // Older CLI tasks.json ran bare `node`, which isn't on PATH for snap VS
        // Code on Linux; regenerate to run ${execPath} with ELECTRON_RUN_AS_NODE.
        content.includes('"command": "node"')
    );
}

interface IntelliSenseConfig {
    includePath: string[];
    defines: string[];
    usesCpp: boolean;
    forcedInclude: string[];
}

// Transitive publicIncludePaths of a manifest's projectReferences (absolute, forward-slash),
// so referenced libraries' headers resolve in the editor exactly as they do at build time.
function collectReferencedPublicIncludes(
    projectRoot: string,
    manifest: RxdkProjectManifest,
    seen: Set<string> = new Set()
): string[] {
    const out: string[] = [];
    for (const rel of manifest.projectReferences ?? []) {
        if (!rel.trim()) {
            continue;
        }
        const depRoot = path.resolve(projectRoot, rel);
        const key = depRoot.toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        let depManifest: RxdkProjectManifest;
        try {
            depManifest = JSON.parse(
                stripBom(fs.readFileSync(path.join(depRoot, 'rxdk.project.json'), 'utf8'))
            ) as RxdkProjectManifest;
        } catch {
            continue;
        }
        for (const inc of depManifest.publicIncludePaths ?? []) {
            if (inc.trim()) {
                out.push(path.join(depRoot, inc).replace(/\\/g, '/'));
            }
        }
        out.push(...collectReferencedPublicIncludes(depRoot, depManifest, seen));
    }
    return out;
}

function buildIntelliSenseConfig(
    context: vscode.ExtensionContext,
    projectRoot: string,
    manifest: RxdkProjectManifest
): IntelliSenseConfig {
    const includeDir = getSdkIncludeDir(context).replace(/\\/g, '/');
    // IntelliSense-only shim headers (sibling of the SDK include dir) that let the MSVC IntelliSense
    // front-end parse the clang-built SDK headers; the rxdk_intellisense.h prelude + picolibc.h are
    // force-included ahead of the SDK headers (see forcedInclude below).
    const intelliSenseDir = path.join(path.dirname(includeDir), 'intellisense').replace(/\\/g, '/');
    const forcedInclude = [`${intelliSenseDir}/rxdk_intellisense.h`, `${includeDir}/picolibc.h`];
    const includePath = [includeDir, intelliSenseDir, '${workspaceFolder}/**'];
    const pushDir = (root: string, rel: string): void => {
        if (rel.trim()) {
            const dir = path.join(root, rel).replace(/\\/g, '/');
            if (!includePath.includes(dir)) {
                includePath.push(dir);
            }
        }
    };
    // The project's own include dirs (a library's publicIncludePaths are visible to itself), then
    // every referenced library's exported public includes (transitively).
    for (const rel of manifest.includePaths ?? []) {
        pushDir(projectRoot, rel);
    }
    for (const rel of manifest.publicIncludePaths ?? []) {
        pushDir(projectRoot, rel);
    }
    for (const dir of collectReferencedPublicIncludes(projectRoot, manifest)) {
        if (!includePath.includes(dir)) {
            includePath.push(dir);
        }
    }
    const defines = ['_XBOX', '_WIN32', '_WINNT', '_X86_', ...(manifest.defines ?? [])];
    return { includePath, defines, usesCpp: manifestUsesCpp(manifest), forcedInclude };
}

function applyIntelliSenseSettings(settings: Record<string, unknown>, config: IntelliSenseConfig): void {
    settings['C_Cpp.default.includePath'] = config.includePath;
    settings['C_Cpp.default.defines'] = config.defines;
    settings['C_Cpp.default.forcedInclude'] = config.forcedInclude;
    settings['C_Cpp.default.intelliSenseMode'] = 'windows-msvc-x86';
    settings['C_Cpp.default.compilerPath'] = '';
    settings['C_Cpp.default.cStandard'] = 'c23';
    if (config.usesCpp) {
        settings['C_Cpp.default.cppStandard'] = 'c++23';
    }
}

function writeCppProperties(vscodeDir: string, config: IntelliSenseConfig, configName = ''): void {
    const cppProperties = {
        configurations: [
            {
                name: configName ? `Xbox (${configName})` : 'Xbox',
                includePath: config.includePath,
                defines: config.defines,
                forcedInclude: config.forcedInclude,
                windowsSdkVersion: '',
                compilerPath: '',
                cStandard: 'c23',
                cppStandard: 'c++23',
                intelliSenseMode: 'windows-msvc-x86',
            },
        ],
        version: 4,
    };
    fs.writeFileSync(
        path.join(vscodeDir, 'c_cpp_properties.json'),
        JSON.stringify(cppProperties, null, 4) + '\n',
        'utf8'
    );
}

function intelliSenseConfigIsStale(
    projectRoot: string,
    context: vscode.ExtensionContext,
    manifest: RxdkProjectManifest,
    configName = ''
): boolean {
    if (!manifestNeedsIntelliSense(manifest)) {
        return false;
    }

    // A switch to a different configuration means the generated IntelliSense (include paths, defines)
    // may no longer match -- treat it as stale so it regenerates for the newly selected configuration.
    const settingsMarkerPath = path.join(projectRoot, '.vscode', 'settings.json');
    if (configName && fs.existsSync(settingsMarkerPath)) {
        try {
            const s = JSON.parse(fs.readFileSync(settingsMarkerPath, 'utf8')) as Record<string, unknown>;
            if (s[ACTIVE_CONFIG_KEY] !== configName) {
                return true;
            }
        } catch {
            return true;
        }
    }

    const expectedInclude = normalizeConfigPath(getSdkIncludeDir(context));
    const xtlHeader = path.join(getSdkIncludeDir(context), 'xtl.h');
    if (!fs.existsSync(xtlHeader)) {
        return false;
    }

    const cppPropsPath = path.join(projectRoot, '.vscode', 'c_cpp_properties.json');
    if (!fs.existsSync(cppPropsPath)) {
        return true;
    }

    try {
        const props = JSON.parse(fs.readFileSync(cppPropsPath, 'utf8')) as {
            configurations?: Array<{ includePath?: string[]; forcedInclude?: string[] }>;
        };
        const includes = props.configurations?.[0]?.includePath ?? [];
        if (!includes.some((entry) => normalizeConfigPath(entry) === expectedInclude)) {
            return true;
        }
        // Regenerate configs written before the IntelliSense shim/prelude forcedInclude existed,
        // otherwise the MSVC front-end can't parse the SDK headers (macro hover = "symbol not found").
        const forced = props.configurations?.[0]?.forcedInclude ?? [];
        if (!forced.some((entry) => /rxdk_intellisense\.h$/i.test(entry))) {
            return true;
        }
    } catch {
        return true;
    }

    const settingsPath = path.join(projectRoot, '.vscode', 'settings.json');
    if (!fs.existsSync(settingsPath)) {
        return true;
    }

    try {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
        const includePath = settings['C_Cpp.default.includePath'];
        if (!Array.isArray(includePath) || includePath.length === 0) {
            return true;
        }
        return !includePath.some(
            (entry) => typeof entry === 'string' && normalizeConfigPath(entry) === expectedInclude
        );
    } catch {
        return true;
    }
}

export async function generateVscodeFolder(
    context: vscode.ExtensionContext,
    projectRoot: string,
    projectName: string,
    manifest: RxdkProjectManifest,
    configName = ''
): Promise<void> {
    if (isDxtManifest(manifest)) {
        await generateDxtVscodeFolder(context, projectRoot, projectName, manifest, configName);
        return;
    }

    const vscodeDir = path.join(projectRoot, '.vscode');
    fs.mkdirSync(vscodeDir, { recursive: true });

    const bridgePath = `${SDK_ROOT}/tools/xboxdbg-bridge.exe`;
    // Point the debugger at the resolved configuration's output directory (e.g. out/Debug) so F5
    // finds the .exe/.pdb the active configuration actually builds -- not a hardcoded out/.
    const outRel = (manifest.outputDir || 'out').replace(/\\/g, '/');

    const tasks = {
        version: '2.0.0',
        tasks: [
            {
                label: 'rxdk: build',
                type: 'rxdk',
                action: 'build',
                group: { kind: 'build', isDefault: true },
                problemMatcher: ['$gcc'],
            },
            { label: 'rxdk: deploy', type: 'rxdk', action: 'deploy', problemMatcher: [] },
            { label: 'rxdk: build+deploy', type: 'rxdk', action: 'buildDeploy', problemMatcher: [] },
            { label: 'rxdk: run', type: 'rxdk', action: 'run', problemMatcher: [] },
        ],
    };

    // Reflect the active build configuration in the launch entry names, e.g. "Debug AlphaFog [Debug]",
    // so the Run and Debug dropdown shows which config F5 will build. Regenerated on config switch.
    const configSuffix = configName ? ` [${configName}]` : '';
    const launch = {
        version: '0.2.0',
        configurations: [
            {
                type: 'xbox',
                request: 'launch',
                name: `Debug ${projectName}${configSuffix}`,
                preLaunchTask: 'rxdk: build+deploy',
                program: `\${workspaceFolder}/${outRel}/${projectName}.exe`,
                pdb: `\${workspaceFolder}/${outRel}/${projectName}.pdb`,
                xbePath: `xe:\\${projectName}\\${projectName}.xbe`,
                bridgePath,
                consoleName: '${config:rxdk.defaultConsole}',
                reboot: false,
            },
            {
                type: 'xbox',
                request: 'launch',
                name: `Build ${projectName}${configSuffix}`,
                preLaunchTask: 'rxdk: build',
                buildOnly: true,
                xbePath: `xe:\\${projectName}\\${projectName}.xbe`,
            },
        ],
    };

    const settings: Record<string, unknown> = {
        'rxdk.defaultConsole': '',
        'files.associations': {
            '*.xbe': 'binary',
        },
    };
    if (configName) {
        settings[ACTIVE_CONFIG_KEY] = configName;
    }

    if (manifestNeedsIntelliSense(manifest)) {
        const intelliSense = buildIntelliSenseConfig(context, projectRoot, manifest);
        applyIntelliSenseSettings(settings, intelliSense);
        writeCppProperties(vscodeDir, intelliSense, configName);
    }

    fs.writeFileSync(path.join(vscodeDir, 'tasks.json'), JSON.stringify(tasks, null, 4) + '\n', 'utf8');
    fs.writeFileSync(path.join(vscodeDir, 'launch.json'), JSON.stringify(launch, null, 4) + '\n', 'utf8');
    fs.writeFileSync(path.join(vscodeDir, 'settings.json'), JSON.stringify(settings, null, 4) + '\n', 'utf8');
}

// A DXT (debug-monitor extension) builds a flat .dxt, deploys to E:\dxt, and
// loads on a warm reboot. There's no title to launch and it can't be attached
// to (it runs inside the debug monitor), so there's no launch.json / DAP config;
// the primary action is "deploy & reboot".
async function generateDxtVscodeFolder(
    context: vscode.ExtensionContext,
    projectRoot: string,
    projectName: string,
    manifest: RxdkProjectManifest,
    configName = ''
): Promise<void> {
    const vscodeDir = path.join(projectRoot, '.vscode');
    fs.mkdirSync(vscodeDir, { recursive: true });

    const tasks = {
        version: '2.0.0',
        tasks: [
            {
                label: 'rxdk: build',
                type: 'rxdk',
                action: 'build',
                group: { kind: 'build', isDefault: true },
                problemMatcher: ['$gcc'],
            },
            { label: 'rxdk: deploy', type: 'rxdk', action: 'deploy', problemMatcher: [] },
            { label: 'rxdk: reboot', type: 'rxdk', action: 'reboot', problemMatcher: [] },
            {
                // The main action: build the .dxt, copy it to E:\dxt, then warm
                // reboot so xbdm loads it at debug-monitor init.
                label: 'rxdk: deploy & reboot',
                type: 'rxdk',
                action: 'deployReboot',
                problemMatcher: [],
            },
        ],
    };

    const settings: Record<string, unknown> = {
        'rxdk.defaultConsole': '',
        'files.associations': {
            '*.dxt': 'binary',
        },
    };
    if (configName) {
        settings[ACTIVE_CONFIG_KEY] = configName;
    }

    if (manifestNeedsIntelliSense(manifest)) {
        const intelliSense = buildIntelliSenseConfig(context, projectRoot, manifest);
        applyIntelliSenseSettings(settings, intelliSense);
        writeCppProperties(vscodeDir, intelliSense, configName);
    }

    fs.writeFileSync(path.join(vscodeDir, 'tasks.json'), JSON.stringify(tasks, null, 4) + '\n', 'utf8');
    fs.writeFileSync(path.join(vscodeDir, 'settings.json'), JSON.stringify(settings, null, 4) + '\n', 'utf8');
}

export async function ensureVscodeForWorkspace(
    context: vscode.ExtensionContext,
    force = false
): Promise<void> {
    const found = await import('./projectManager').then((m) => m.findProjectManifest());
    if (!found) {
        return;
    }
    const projectRoot = found.folder.uri.fsPath;
    // Collapse a multi-config manifest to the selected configuration (Debug/Release/…) and make the
    // low-level loader resolve the same one, so generated IntelliSense matches what a build produces.
    const selectedConfig = getSelectedConfig(context, found.manifestPath, found.manifest);
    setActiveConfiguration(selectedConfig || undefined);
    const manifest = resolveConfiguration(found.manifest, selectedConfig);
    const needsRefresh =
        force ||
        vscodeConfigIsStale(projectRoot, manifest.name, selectedConfig) ||
        intelliSenseConfigIsStale(projectRoot, context, manifest, selectedConfig);
    if (!needsRefresh) {
        return;
    }
    await generateVscodeFolder(context, projectRoot, manifest.name, manifest, selectedConfig);
}

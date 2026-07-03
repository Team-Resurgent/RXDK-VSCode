import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
    isPrebuiltManifest,
    manifestNeedsIntelliSense,
    manifestUsesCpp,
    RxdkProjectManifest,
} from './projectTypes';
import { getSdkIncludeDir, getSdkLibDir } from './sdkPath';
import { stripBom } from './xboxSdkPaths';

const EXTENSION_ID = 'rxdk-libs.rxdk-vscode';
const EXTENSION_ROOT = `\${extensionInstallFolder:${EXTENSION_ID}}`;
const SDK_ROOT = `${EXTENSION_ROOT}/sdk`;
// The generated tasks.json shells out to this CLI (compiled alongside the rest of
// the extension) instead of a PowerShell script, so build/deploy/run tasks -- and
// therefore F5 debugging, which depends on the "rxdk: build+deploy" preLaunchTask
// -- work on macOS/Linux with no pwsh prerequisite. See src/cli.ts.
const CLI_PATH = `${EXTENSION_ROOT}/dist/extension/cli.js`;

function normalizeConfigPath(value: string): string {
    return path.normalize(value).replace(/\\/g, '/').toLowerCase();
}

function vscodeConfigIsStale(projectRoot: string): boolean {
    const tasksPath = path.join(projectRoot, '.vscode', 'tasks.json');
    if (!fs.existsSync(tasksPath)) {
        return true;
    }
    const content = fs.readFileSync(tasksPath, 'utf8');
    return (
        content.includes('.vscode/extensions/rxdk-libs.rxdk-vscode-') ||
        content.includes('.cursor/extensions/rxdk-libs.rxdk-vscode-') ||
        !content.includes('extensionInstallFolder:rxdk-libs.rxdk-vscode') ||
        content.includes('rxdk-vscode}/out/sdk') ||
        (content.includes('rxdk-vscode}/sdk') && !content.includes('extensionInstallFolder:rxdk-libs.rxdk-vscode')) ||
        // Pre-CLI-migration tasks.json shelled out to PowerShell scripts directly.
        content.includes('"command": "powershell"') ||
        content.includes('.ps1')
    );
}

interface IntelliSenseConfig {
    includePath: string[];
    defines: string[];
    usesCpp: boolean;
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
    const includePath = [includeDir, '${workspaceFolder}/**'];
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
    return { includePath, defines, usesCpp: manifestUsesCpp(manifest) };
}

function applyIntelliSenseSettings(settings: Record<string, unknown>, config: IntelliSenseConfig): void {
    settings['C_Cpp.default.includePath'] = config.includePath;
    settings['C_Cpp.default.defines'] = config.defines;
    settings['C_Cpp.default.intelliSenseMode'] = 'windows-msvc-x86';
    settings['C_Cpp.default.compilerPath'] = '';
    settings['C_Cpp.default.cStandard'] = 'c17';
    if (config.usesCpp) {
        settings['C_Cpp.default.cppStandard'] = 'c++20';
    }
}

function writeCppProperties(vscodeDir: string, config: IntelliSenseConfig): void {
    const cppProperties = {
        configurations: [
            {
                name: 'Xbox',
                includePath: config.includePath,
                defines: config.defines,
                windowsSdkVersion: '',
                compilerPath: '',
                cStandard: 'c17',
                cppStandard: 'c++20',
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
    manifest: RxdkProjectManifest
): boolean {
    if (!manifestNeedsIntelliSense(manifest)) {
        return false;
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
            configurations?: Array<{ includePath?: string[] }>;
        };
        const includes = props.configurations?.[0]?.includePath ?? [];
        if (!includes.some((entry) => normalizeConfigPath(entry) === expectedInclude)) {
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
    manifest: RxdkProjectManifest
): Promise<void> {
    if (isPrebuiltManifest(manifest)) {
        await generatePrebuiltVscodeFolder(projectRoot, projectName, manifest);
        return;
    }

    const vscodeDir = path.join(projectRoot, '.vscode');
    fs.mkdirSync(vscodeDir, { recursive: true });

    const includeDir = getSdkIncludeDir(context).replace(/\\/g, '/');
    const libDir = getSdkLibDir(context).replace(/\\/g, '/');
    const bridgePath = `${SDK_ROOT}/tools/xboxdbg-bridge.exe`;

    const tasks = {
        version: '2.0.0',
        tasks: [
            {
                label: 'rxdk: build',
                type: 'shell',
                command: 'node',
                args: [
                    CLI_PATH,
                    'build',
                    '--project-root',
                    '${workspaceFolder}',
                    '--sdk-include',
                    includeDir,
                    '--sdk-lib',
                    libDir,
                    '--optimize',
                    '${config:rxdk.optimize}',
                ],
                group: { kind: 'build', isDefault: true },
                problemMatcher: ['$gcc'],
            },
            {
                label: 'rxdk: deploy',
                type: 'shell',
                command: 'node',
                args: [
                    CLI_PATH,
                    'deploy',
                    '--project-root',
                    '${workspaceFolder}',
                    '--project-name',
                    projectName,
                ],
                problemMatcher: [],
            },
            {
                label: 'rxdk: build+deploy',
                dependsOrder: 'sequence',
                dependsOn: ['rxdk: build', 'rxdk: deploy'],
                problemMatcher: [],
            },
            {
                label: 'rxdk: run',
                type: 'shell',
                command: 'node',
                args: [CLI_PATH, 'run', '--project-name', projectName],
                problemMatcher: [],
            },
        ],
    };

    const launch = {
        version: '0.2.0',
        configurations: [
            {
                type: 'xbox',
                request: 'launch',
                name: `Debug ${projectName}`,
                preLaunchTask: 'rxdk: build+deploy',
                program: `\${workspaceFolder}/out/${projectName}.exe`,
                pdb: `\${workspaceFolder}/out/${projectName}.pdb`,
                xbePath: `xe:\\${projectName}\\${projectName}.xbe`,
                bridgePath,
                consoleName: '${config:rxdk.defaultConsole}',
                reboot: false,
            },
            {
                type: 'xbox',
                request: 'launch',
                name: `Build ${projectName}`,
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

    if (manifestNeedsIntelliSense(manifest)) {
        const intelliSense = buildIntelliSenseConfig(context, projectRoot, manifest);
        applyIntelliSenseSettings(settings, intelliSense);
        writeCppProperties(vscodeDir, intelliSense);
    }

    fs.writeFileSync(path.join(vscodeDir, 'tasks.json'), JSON.stringify(tasks, null, 4) + '\n', 'utf8');
    fs.writeFileSync(path.join(vscodeDir, 'launch.json'), JSON.stringify(launch, null, 4) + '\n', 'utf8');
    fs.writeFileSync(path.join(vscodeDir, 'settings.json'), JSON.stringify(settings, null, 4) + '\n', 'utf8');
}

async function generatePrebuiltVscodeFolder(
    projectRoot: string,
    projectName: string,
    manifest: RxdkProjectManifest
): Promise<void> {
    const vscodeDir = path.join(projectRoot, '.vscode');
    fs.mkdirSync(vscodeDir, { recursive: true });

    const bridgePath = `${SDK_ROOT}/tools/xboxdbg-bridge.exe`;
    const p = manifest.prebuilt!;
    const xbeLeaf = path.basename(p.xbe);

    const deployArgs = [CLI_PATH, 'deploy-prebuilt', '--xbe-path', p.xbe, '--remote-name', p.remoteName];
    if (p.pdb) {
        deployArgs.push('--pdb-path', p.pdb);
    }
    if (p.map) {
        deployArgs.push('--map-path', p.map);
    }

    const tasks = {
        version: '2.0.0',
        tasks: [
            {
                label: 'rxdk: deploy',
                type: 'shell',
                command: 'node',
                args: deployArgs,
                group: { kind: 'build', isDefault: true },
                problemMatcher: [],
            },
        ],
    };

    const launchConfig: Record<string, unknown> = {
        type: 'xbox',
        request: 'launch',
        name: `Debug ${projectName}`,
        preLaunchTask: 'rxdk: deploy',
        xbe: p.xbe,
        xbePath: `xe:\\${p.remoteName}\\${xbeLeaf}`,
        bridgePath,
        consoleName: '${config:rxdk.defaultConsole}',
        reboot: true,
    };
    if (p.exe) {
        launchConfig.program = p.exe;
    }
    if (p.pdb) {
        launchConfig.pdb = p.pdb;
    }
    if (p.map) {
        launchConfig.map = p.map;
    }
    if (p.srcRoot) {
        launchConfig.srcRoot = p.srcRoot;
    }

    const launch = {
        version: '0.2.0',
        configurations: [launchConfig],
    };

    const settings: Record<string, unknown> = {
        'rxdk.defaultConsole': '',
        'files.associations': {
            '*.xbe': 'binary',
        },
    };

    fs.writeFileSync(path.join(vscodeDir, 'tasks.json'), JSON.stringify(tasks, null, 4) + '\n', 'utf8');
    fs.writeFileSync(path.join(vscodeDir, 'launch.json'), JSON.stringify(launch, null, 4) + '\n', 'utf8');
    fs.writeFileSync(path.join(vscodeDir, 'settings.json'), JSON.stringify(settings, null, 4) + '\n', 'utf8');
}

export async function ensureVscodeForWorkspace(context: vscode.ExtensionContext): Promise<void> {
    const found = await import('./projectManager').then((m) => m.findProjectManifest());
    if (!found) {
        return;
    }
    const projectRoot = found.folder.uri.fsPath;
    const needsRefresh =
        vscodeConfigIsStale(projectRoot) ||
        intelliSenseConfigIsStale(projectRoot, context, found.manifest);
    if (!needsRefresh) {
        return;
    }
    await generateVscodeFolder(context, projectRoot, found.manifest.name, found.manifest);
}

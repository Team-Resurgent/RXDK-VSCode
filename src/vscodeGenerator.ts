import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { isPrebuiltManifest, manifestUsesCpp, RxdkProjectManifest } from './projectTypes';
import { getBundledSdkRoot, getSdkIncludeDir, getSdkLibDir } from './sdkPath';

const EXTENSION_ID = 'rxdk-libs.rxdk-vscode';
const EXTENSION_ROOT = `\${extensionInstallFolder:${EXTENSION_ID}}`;
const SDK_ROOT = `${EXTENSION_ROOT}/sdk`;

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
        (content.includes('rxdk-vscode}/sdk') && !content.includes('extensionInstallFolder:rxdk-libs.rxdk-vscode'))
    );
}

export async function generateVscodeFolder(
    _context: vscode.ExtensionContext,
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

    const sdkRoot = SDK_ROOT;
    const bundledRoot = getBundledSdkRoot(_context);
    const includeDir = getSdkIncludeDir(_context).replace(/\\/g, '/');
    const libDir = getSdkLibDir(_context).replace(/\\/g, '/');
    const buildScript = `${SDK_ROOT}/scripts/Build-XboxProject.ps1`;
    const deployScript = `${SDK_ROOT}/scripts/Invoke-XboxDeploy.ps1`;
    const launchScript = `${SDK_ROOT}/scripts/Invoke-XboxLaunch.ps1`;
    const bridgePath = `${SDK_ROOT}/tools/xboxdbg-bridge.exe`;

    const buildTaskArgs = [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        buildScript,
        '-SdkRoot',
        sdkRoot,
        '-ProjectRoot',
        '${workspaceFolder}',
    ];
    if (includeDir !== path.join(bundledRoot, 'include').replace(/\\/g, '/')) {
        buildTaskArgs.push('-IncludeDir', includeDir);
    }
    if (libDir !== path.join(bundledRoot, 'lib').replace(/\\/g, '/')) {
        buildTaskArgs.push('-LibDir', libDir);
    }

    const tasks = {
        version: '2.0.0',
        tasks: [
            {
                label: 'rxdk: build',
                type: 'shell',
                command: 'powershell',
                args: buildTaskArgs,
                group: { kind: 'build', isDefault: true },
                problemMatcher: ['$msCompile'],
            },
            {
                label: 'rxdk: deploy',
                type: 'shell',
                command: 'powershell',
                args: [
                    '-NoProfile',
                    '-ExecutionPolicy',
                    'Bypass',
                    '-File',
                    deployScript,
                    '-SdkRoot',
                    sdkRoot,
                    '-ProjectRoot',
                    '${workspaceFolder}',
                    '-ProjectName',
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
                command: 'powershell',
                args: [
                    '-NoProfile',
                    '-ExecutionPolicy',
                    'Bypass',
                    '-File',
                    launchScript,
                    '-SdkRoot',
                    sdkRoot,
                    '-ProjectName',
                    projectName,
                ],
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
        ],
    };

    const settings: Record<string, unknown> = {
        'rxdk.defaultConsole': '',
        'files.associations': {
            '*.xbe': 'binary',
        },
    };

    if (manifestUsesCpp(manifest)) {
        const includePath = [includeDir];
        for (const rel of manifest.includePaths ?? []) {
            if (!rel.trim()) {
                continue;
            }
            includePath.push(path.join(projectRoot, rel).replace(/\\/g, '/'));
        }
        const defines = ['_XBOX', '_WIN32', '_WINNT', '_X86_', ...(manifest.defines ?? [])];
        settings['C_Cpp.default.includePath'] = includePath;
        settings['C_Cpp.default.defines'] = defines;
        settings['C_Cpp.default.cppStandard'] = 'c++20';
        settings['C_Cpp.default.compilerPath'] = '';
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

    const sdkRoot = SDK_ROOT;
    const deployScript = `${SDK_ROOT}/scripts/Invoke-XboxDeploy.ps1`;
    const bridgePath = `${SDK_ROOT}/tools/xboxdbg-bridge.exe`;
    const p = manifest.prebuilt!;
    const xbeLeaf = path.basename(p.xbe);

    const deployArgs = [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        deployScript,
        '-SdkRoot',
        sdkRoot,
        '-XbePath',
        p.xbe,
        '-RemoteName',
        p.remoteName,
    ];
    if (p.pdb) {
        deployArgs.push('-PdbPath', p.pdb);
    }
    if (p.map) {
        deployArgs.push('-MapPath', p.map);
    }

    const tasks = {
        version: '2.0.0',
        tasks: [
            {
                label: 'rxdk: deploy',
                type: 'shell',
                command: 'powershell',
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
    if (!vscodeConfigIsStale(projectRoot)) {
        return;
    }
    await generateVscodeFolder(context, projectRoot, found.manifest.name, found.manifest);
}

import * as vscode from 'vscode';
import * as path from 'path';
import { getSdkRoot, getSdkScriptsDir, getSdkIncludeDir, getSdkLibDir, getSdkToolsDir } from './sdkPath';
import { isStagedSdkPresent, getStagedSdkRoot } from './sdkStaging';
import { isDotNetRuntimeInstalled, ensureDotNetRuntime } from './dotnetRuntime';
import { findProjectManifest } from './projectManager';
import { isPrebuiltManifest, isLibraryManifest, RxdkProjectManifest } from './projectTypes';
import { resolveZigExecutable } from './zigRuntime';
import { deployProject, deployPrebuilt, DeployResult } from './xboxDeploy';
import { launchProject, LaunchResult } from './xboxLaunch';

export type RxdkTaskKind = 'build' | 'deploy' | 'run' | 'build+deploy';

export async function runRxdkTask(
    context: vscode.ExtensionContext,
    kind: RxdkTaskKind,
    output: vscode.OutputChannel
): Promise<boolean> {
    const found = await findProjectManifest();
    if (!found) {
        vscode.window.showErrorMessage('No rxdk.project.json found in workspace.');
        return false;
    }

    if (!isPrebuiltManifest(found.manifest) && !isStagedSdkPresent(context)) {
        const sdkPath = getStagedSdkRoot(context);
        vscode.window.showErrorMessage(
            `RXDK SDK not installed. Reload the window to trigger clone, or: git clone --depth 1 https://github.com/Team-Resurgent/RXDK-SDK.git "${sdkPath}"`
        );
        return false;
    }

    if (kind !== 'build' && !(await isDotNetRuntimeInstalled())) {
        const ok = await ensureDotNetRuntime(context, output);
        if (!ok) {
            return false;
        }
    }

    const scripts = getSdkScriptsDir(context);
    const sdkRoot = getSdkRoot(context);
    const sdkPathArgs = buildSdkPathArgs(context);
    const projectRoot = found.folder.uri.fsPath;
    const name = found.manifest.name;

    if (isPrebuiltManifest(found.manifest)) {
        return runPrebuiltTask(found.manifest, kind, output);
    }

    // A library project produces a .lib linked by executables that reference it — build only.
    if (isLibraryManifest(found.manifest)) {
        if (kind === 'deploy' || kind === 'run') {
            vscode.window.showInformationMessage(
                `Library project "${name}" builds a .lib and is not deployed/run — reference it from an executable via projectReferences.`
            );
            return true;
        }
        return runPowerShell(
            path.join(scripts, 'Build-XboxProject.ps1'),
            ['-SdkRoot', sdkRoot, '-ProjectRoot', projectRoot, ...sdkPathArgs, ...(await zigArgsFromConfig())],
            output,
            'RXDK Build (library)'
        );
    }

    if (kind === 'deploy') {
        return reportDeployResult(await deployProject({ projectRoot, projectName: name, output }), output);
    }
    if (kind === 'run') {
        return reportLaunchResult(await launchProject({ projectName: name, output }), output);
    }
    if (kind === 'build+deploy') {
        const buildOk = await runPowerShell(
            path.join(scripts, 'Build-XboxProject.ps1'),
            ['-SdkRoot', sdkRoot, '-ProjectRoot', projectRoot, ...sdkPathArgs, ...(await zigArgsFromConfig())],
            output,
            'RXDK Build'
        );
        if (!buildOk) {
            return false;
        }
        return reportDeployResult(await deployProject({ projectRoot, projectName: name, output }), output);
    }

    // kind === 'build'
    return runPowerShell(
        path.join(scripts, 'Build-XboxProject.ps1'),
        ['-SdkRoot', sdkRoot, '-ProjectRoot', projectRoot, ...sdkPathArgs, ...(await zigArgsFromConfig())],
        output,
        'RXDK Build'
    );
}

function reportDeployResult(result: DeployResult, output: vscode.OutputChannel): boolean {
    if (result.ok) {
        return true;
    }
    output.appendLine(`RXDK Deploy failed: ${result.error}`);
    vscode.window.showErrorMessage(`RXDK Deploy failed: ${result.error}`);
    return false;
}

function reportLaunchResult(result: LaunchResult, output: vscode.OutputChannel): boolean {
    if (result.ok) {
        return true;
    }
    if ('noConsoleConfigured' in result) {
        vscode.window.showWarningMessage(
            'No Xbox console configured (set rxdk.defaultConsole or Xbox Neighborhood).'
        );
        return true;
    }
    output.appendLine(`RXDK Run failed: ${result.error}`);
    vscode.window.showErrorMessage(`RXDK Run failed: ${result.error}`);
    return false;
}

async function runPrebuiltTask(
    manifest: RxdkProjectManifest,
    kind: RxdkTaskKind,
    output: vscode.OutputChannel
): Promise<boolean> {
    if (kind === 'build') {
        vscode.window.showInformationMessage('Prebuilt-XBE project: nothing to build (deploy and debug only).');
        return true;
    }
    const p = manifest.prebuilt!;
    // 'deploy', 'run', and 'build+deploy' all reduce to a deploy for prebuilt projects;
    // launching is handled by the debugger (F5) via the generated launch config.
    const result = await deployPrebuilt({
        xbePath: p.xbe,
        pdbPath: p.pdb,
        mapPath: p.map,
        remoteName: p.remoteName,
        output,
    });
    return reportDeployResult(result, output);
}

async function zigArgsFromConfig(): Promise<string[]> {
    const args: string[] = [];
    const configured = vscode.workspace.getConfiguration('rxdk').get<string>('zigPath')?.trim();
    if (configured) {
        args.push('-ZigExecutable', configured);
    } else {
        const resolved = await resolveZigExecutable();
        if (resolved && resolved !== 'zig') {
            args.push('-ZigExecutable', resolved);
        }
    }
    return args;
}

function buildSdkPathArgs(context: vscode.ExtensionContext): string[] {
    const bundled = path.join(context.extensionPath, 'sdk');
    const includeDir = getSdkIncludeDir(context);
    const libDir = getSdkLibDir(context);
    const args: string[] = [];
    if (includeDir !== path.join(bundled, 'include')) {
        args.push('-IncludeDir', includeDir);
    }
    if (libDir !== path.join(bundled, 'lib')) {
        args.push('-LibDir', libDir);
    }
    // Host tools are downloaded to a persistent root by the host-tools prerequisite,
    // not bundled in the VSIX — always point the build at it.
    args.push('-ToolsDir', getSdkToolsDir(context));
    return args;
}

function runPowerShell(
    script: string,
    args: string[],
    output: vscode.OutputChannel,
    title: string
): Promise<boolean> {
    return new Promise((resolve) => {
        const quoted = args.map((a) => (a.includes(' ') ? `'${a.replace(/'/g, "''")}'` : a));
        const cmd = `& '${script.replace(/'/g, "''")}' ${quoted.join(' ')}`;
        const term = vscode.window.createTerminal({ name: title, hideFromUser: false });
        output.appendLine(`$ ${cmd}`);
        term.show();
        term.sendText(cmd, true);
        vscode.window.showInformationMessage(`${title} started in terminal.`);
        resolve(true);
    });
}

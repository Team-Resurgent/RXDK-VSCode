import * as vscode from 'vscode';
import * as path from 'path';
import { getSdkRoot, getSdkScriptsDir, getSdkIncludeDir, getSdkLibDir, getSdkToolsDir } from './sdkPath';
import { isStagedSdkPresent, getStagedSdkRoot } from './sdkStaging';
import { isDotNetRuntimeInstalled, ensureDotNetRuntime } from './dotnetRuntime';
import { findProjectManifest } from './projectManager';
import { getActiveXboxAddress } from './xboxConsole';
import { isPrebuiltManifest } from './projectTypes';
import { resolveZigExecutable } from './zigRuntime';

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
        return runPrebuiltTask(scripts, sdkRoot, found.manifest, kind, output);
    }

    const scriptMap: Record<RxdkTaskKind, string> = {
        build: 'Build-XboxProject.ps1',
        deploy: 'Invoke-XboxDeploy.ps1',
        run: 'Invoke-XboxLaunch.ps1',
        'build+deploy': '',
    };
    const consoleArgs = await deployConsoleArgs();

    if (kind === 'build+deploy') {
        const buildOk = await runPowerShell(
            path.join(scripts, scriptMap.build),
            ['-SdkRoot', sdkRoot, '-ProjectRoot', projectRoot, ...sdkPathArgs, ...(await zigArgsFromConfig())],
            output,
            'RXDK Build'
        );
        if (!buildOk) {
            return false;
        }
        return runPowerShell(
            path.join(scripts, scriptMap.deploy),
            ['-SdkRoot', sdkRoot, '-ProjectRoot', projectRoot, '-ProjectName', name, ...consoleArgs],
            output,
            'RXDK Deploy'
        );
    }

    const script = path.join(scripts, scriptMap[kind]);
    const args =
        kind === 'build'
            ? ['-SdkRoot', sdkRoot, '-ProjectRoot', projectRoot, ...sdkPathArgs, ...(await zigArgsFromConfig())]
            : ['-SdkRoot', sdkRoot, '-ProjectRoot', projectRoot, '-ProjectName', name, ...consoleArgs];

    return runPowerShell(script, args, output, `RXDK ${kind}`);
}

async function runPrebuiltTask(
    scripts: string,
    sdkRoot: string,
    manifest: import('./projectTypes').RxdkProjectManifest,
    kind: RxdkTaskKind,
    output: vscode.OutputChannel
): Promise<boolean> {
    if (kind === 'build') {
        vscode.window.showInformationMessage('Prebuilt-XBE project: nothing to build (deploy and debug only).');
        return true;
    }
    const p = manifest.prebuilt!;
    const consoleArgs = await deployConsoleArgs();
    const args = [
        '-SdkRoot',
        sdkRoot,
        '-XbePath',
        p.xbe,
        '-RemoteName',
        p.remoteName,
        ...(p.pdb ? ['-PdbPath', p.pdb] : []),
        ...(p.map ? ['-MapPath', p.map] : []),
        ...consoleArgs,
    ];
    // 'deploy', 'run', and 'build+deploy' all reduce to a deploy for prebuilt projects;
    // launching is handled by the debugger (F5) via the generated launch config.
    return runPowerShell(path.join(scripts, 'Invoke-XboxDeploy.ps1'), args, output, 'RXDK Deploy (prebuilt)');
}

async function deployConsoleArgs(): Promise<string[]> {
    const console = await getActiveXboxAddress();
    return console ? ['-ConsoleName', console] : [];
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

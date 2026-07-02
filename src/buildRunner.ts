import * as vscode from 'vscode';
import { getSdkIncludeDir, getSdkLibDir } from './sdkPath';
import { isStagedSdkPresent, getStagedSdkRoot } from './sdkStaging';
import { isDotNetRuntimeInstalled, ensureDotNetRuntime } from './dotnetRuntime';
import { findProjectManifest } from './projectManager';
import { isPrebuiltManifest, RxdkProjectManifest } from './projectTypes';
import { deployProject, deployPrebuilt, DeployResult } from './xboxDeploy';
import { launchProject, LaunchResult } from './xboxLaunch';
import { buildXboxProject, BuildProjectResult } from './xboxBuild';

function configuredZigOverride(): string | undefined {
    return vscode.workspace.getConfiguration('rxdk').get<string>('zigPath')?.trim() || undefined;
}

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

    const projectRoot = found.folder.uri.fsPath;
    const name = found.manifest.name;

    if (isPrebuiltManifest(found.manifest)) {
        return runPrebuiltTask(found.manifest, kind, output);
    }

    // isLibraryManifest projects are handled inside buildXboxProject itself (compiles + archives,
    // then returns without linking/deploying) -- but deploy/run on one is a user-facing no-op here,
    // since a library isn't something to deploy or launch on its own.
    if (kind === 'deploy' || kind === 'run') {
        if (found.manifest.type === 'library') {
            vscode.window.showInformationMessage(
                `Library project "${name}" builds a .lib and is not deployed/run — reference it from an executable via projectReferences.`
            );
            return true;
        }
    }

    if (kind === 'deploy') {
        return reportDeployResult(await deployProject({ projectRoot, projectName: name, output }), output);
    }
    if (kind === 'run') {
        return reportLaunchResult(await launchProject({ projectName: name, output }), output);
    }
    if (kind === 'build+deploy') {
        const buildResult = await runBuild(context, projectRoot, output);
        if (!reportBuildResult(buildResult, output)) {
            return false;
        }
        return reportDeployResult(await deployProject({ projectRoot, projectName: name, output }), output);
    }

    // kind === 'build'
    return reportBuildResult(await runBuild(context, projectRoot, output), output);
}

function runBuild(
    context: vscode.ExtensionContext,
    projectRoot: string,
    output: vscode.OutputChannel
): Promise<BuildProjectResult> {
    return buildXboxProject({
        projectRoot,
        sdkInclude: getSdkIncludeDir(context),
        sdkLib: getSdkLibDir(context),
        zigExecutable: configuredZigOverride(),
        output,
    });
}

function reportBuildResult(result: BuildProjectResult, output: vscode.OutputChannel): boolean {
    if (result.ok) {
        return true;
    }
    output.appendLine(`RXDK Build failed: ${result.error}`);
    vscode.window.showErrorMessage(`RXDK Build failed: ${result.error}`);
    return false;
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

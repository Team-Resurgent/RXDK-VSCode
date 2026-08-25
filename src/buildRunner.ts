import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getXboxProjectOutDir } from './sdkPath';
import { launchXemu } from './xemuLaunch';
import { isStagedSdkPresent, getStagedSdkRoot } from './sdkStaging';
import { isDotNetRuntimeInstalled, ensureDotNetRuntime } from './dotnetRuntime';
import { findProjectManifest } from './projectManager';
import { resolveConfiguration } from './projectTypes';
import { getSelectedConfig } from './configSelection';
import { setActiveConfiguration } from './activeConfig';
import { deployProject, removeDxt, DeployResult } from './xboxDeploy';
import { launchProject, rebootConsole, LaunchResult } from './xboxLaunch';
import { getStagedToolsRoot, resolveHostTool } from './hostTools';
import { runStreamed, OutputLike } from './processRunner';
import { readProjectManifestAt } from './xboxSdkPaths';

// The build/link/image pipeline is the shared C# engine (Rxdk.Cli), delivered in the RXDK-Tools
// host-tools bundle -- the same engine VS20XX uses -- rather than a parallel TypeScript
// reimplementation. This keeps both IDEs byte-for-byte identical.
export type BuildProjectResult = { ok: true; outDir: string } | { ok: false; error: string };

function configuredZigOverride(): string | undefined {
    return vscode.workspace.getConfiguration('rxdk').get<string>('zigPath')?.trim() || undefined;
}

export type RxdkTaskKind = 'build' | 'deploy' | 'run' | 'build+deploy' | 'remove-dxt' | 'launch-xemu';

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

    // Collapse a multi-config manifest to the selected configuration for this whole operation:
    // `manifest` drives the top-level checks here, and setActiveConfiguration makes the low-level
    // readProjectManifestAt (used by the build + projectReferences) resolve the same configuration.
    const selectedConfig = getSelectedConfig(context, found.manifestPath, found.manifest);
    setActiveConfiguration(selectedConfig || undefined);
    const manifest = resolveConfiguration(found.manifest, selectedConfig);

    if (!isStagedSdkPresent(context)) {
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
    const name = manifest.name;

    // isLibraryManifest projects are handled inside buildXboxProject itself (compiles + archives,
    // then returns without linking/deploying) -- but deploy/run on one is a user-facing no-op here,
    // since a library isn't something to deploy or launch on its own.
    if (kind === 'deploy' || kind === 'run' || kind === 'launch-xemu') {
        if (manifest.type === 'library') {
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
        // A DXT isn't launched as a title -- it loads at boot from E:\dxt, so
        // "run" warm-reboots the console to (re)load it.
        if (manifest.type === 'dxt') {
            return reportLaunchResult(await rebootConsole({ output }), output);
        }
        return reportLaunchResult(await launchProject({ projectName: name, output }), output);
    }
    if (kind === 'build+deploy') {
        const buildResult = await runBuild(context, projectRoot, output);
        if (!reportBuildResult(buildResult, output)) {
            return false;
        }
        return reportDeployResult(await deployProject({ projectRoot, projectName: name, output }), output);
    }
    if (kind === 'remove-dxt') {
        // Delete the DXT from E:\dxt, then warm reboot so xbdm no longer loads it.
        const removed = await removeDxt({ projectRoot, projectName: name, output });
        if (!reportDeployResult(removed, output)) {
            return false;
        }
        return reportLaunchResult(await rebootConsole({ output }), output);
    }

    if (kind === 'launch-xemu') {
        // Build a fresh ISO, then boot it in xemu (no debugging). xemu streams its console
        // output back to the panel; it runs until the user closes the emulator window.
        const buildResult = await runBuild(context, projectRoot, output);
        if (!reportBuildResult(buildResult, output)) {
            return false;
        }
        const isoPath = path.join(getXboxProjectOutDir(projectRoot, manifest), 'XISO', `${name}.iso`);
        return reportLaunchResult(await launchXemu({ isoPath, output }), output);
    }

    // kind === 'build'
    return reportBuildResult(await runBuild(context, projectRoot, output), output);
}

/**
 * Build a project via the shared C# engine (Rxdk.Cli), delivered in the RXDK-Tools host-tools
 * bundle. Self-contained (resolves the selected configuration + optimize mode itself) so every
 * build entry point -- the command runner, the `rxdk:` task provider, and the node CLI -- shares
 * exactly one code path and stays identical to VS20XX.
 */
export async function runBuild(
    context: vscode.ExtensionContext,
    projectRoot: string,
    output: OutputLike
): Promise<BuildProjectResult> {
    const cli = resolveHostTool('Rxdk.Cli');
    if (!fs.existsSync(cli)) {
        return {
            ok: false,
            error: `Build engine not found: ${cli}. Update the RXDK host tools (Complete Setup / Update All).`,
        };
    }
    let selectedConfig: string | undefined;
    try {
        const manifest = readProjectManifestAt(projectRoot);
        selectedConfig = getSelectedConfig(context, path.join(projectRoot, 'rxdk.project.json'), manifest) || undefined;
    } catch {
        /* single-config or unreadable manifest -- the engine uses the manifest's default config. */
    }
    // We pass only the configuration to select -- NOT --optimize. The engine derives the optimize
    // level from that config's debug/release flag (`configuration`), the single source of truth shared
    // with VS20XX, so the compiler opt level and the linked SDK lib variant always agree.
    const args = ['build', '--project-root', projectRoot];
    if (selectedConfig) {
        args.push('--configuration', selectedConfig);
    }
    // Point the engine at the extension's staged SDK/tools (per-platform), overriding its own
    // %ProgramData% defaults; a configured zigPath overrides the engine's Zig resolution.
    const env: NodeJS.ProcessEnv = {
        RXDK_STAGED_SDK: getStagedSdkRoot(context),
        RXDK_STAGED_TOOLS: getStagedToolsRoot(),
    };
    const zig = configuredZigOverride();
    if (zig) {
        env.RXDK_ZIG = zig;
    }
    const result = await runStreamed(cli, args, { output, env });
    if (result.exitCode !== 0) {
        return { ok: false, error: `Build failed (exit code ${result.exitCode}).` };
    }
    const match = (result.stdout + result.stderr).match(/build OK -> (.+)/);
    const outDir = match ? match[1].trim() : path.join(projectRoot, 'out');
    return { ok: true, outDir };
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

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { RxdkSidebarProvider } from './sidebarProvider';
import { createProject } from './projectManager';
import { runRxdkTask } from './buildRunner';
import { getBridgePath } from './sdkPath';
import { openStagedSdkFolder, fetchLatestSdk } from './sdkStaging';
import { ensureDotNetRuntime, isDotNetRuntimeInstalled } from './dotnetRuntime';
import { ensureSdkDocsStaging } from './sdkDocsStaging';
import { ensureVscodeForWorkspace } from './vscodeGenerator';
import { getActiveXboxAddress, promptSetXboxIp } from './xboxConsole';
import { openSdkDocs } from './sdkDocs';
import { openPrebuiltProjectSetup } from './prebuiltDebug';
import { refreshPrebuiltSourceFolder } from './prebuiltWorkspace';
import { launchXbwatson } from './xbwatsonLauncher';
import {
    isPrerequisitesReadySync,
    refreshPrerequisitesContext,
} from './prerequisites';
import { openPrerequisitesSetup } from './prerequisitesSetup';
let titleOutputChannel: vscode.OutputChannel | undefined;
const titleLogWatchers = new Map<string, NodeJS.Timeout>();
let rxdkOutput: vscode.OutputChannel;
let sidebarProvider: RxdkSidebarProvider;
let extensionContext: vscode.ExtensionContext;

function guardPrerequisites<T extends unknown[]>(
    action: (...args: T) => unknown
): (...args: T) => unknown {
    return (...args: T) => {
        if (!isPrerequisitesReadySync()) {
            void openPrerequisitesSetup(extensionContext, rxdkOutput);
            return;
        }
        return action(...args);
    };
}

export function activate(context: vscode.ExtensionContext): void {
    extensionContext = context;
    rxdkOutput = vscode.window.createOutputChannel('RXDK');
    context.subscriptions.push(rxdkOutput);

    void vscode.commands.executeCommand('setContext', 'rxdk.prerequisitesReady', false);

    sidebarProvider = new RxdkSidebarProvider(context);
    void ensureSdkDocsStaging(context, rxdkOutput).then(() => sidebarProvider.refresh());
    void bootstrapPrerequisites(context);
    const treeView = vscode.window.createTreeView('rxdk.explorer', {
        treeDataProvider: sidebarProvider,
        showCollapseAll: false,
    });
    context.subscriptions.push(treeView);
    treeView.onDidChangeVisibility((e) => {
        if (e.visible) {
            sidebarProvider.refresh();
        }
    });
    void sidebarProvider.refresh();

    const hasProject = async (): Promise<boolean> => {
        const folders = vscode.workspace.workspaceFolders ?? [];
        return folders.some((f) => fs.existsSync(path.join(f.uri.fsPath, 'rxdk.project.json')));
    };

    void hasProject().then((v) => {
        vscode.commands.executeCommand('setContext', 'rxdk.hasProject', v);
    });
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            void hasProject().then((v) => vscode.commands.executeCommand('setContext', 'rxdk.hasProject', v));
            sidebarProvider.refresh();
        }),
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('rxdk.defaultConsole') || e.affectsConfiguration('xbox.defaultConsole')) {
                sidebarProvider.refresh();
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('rxdk.setupPrerequisites', () =>
            openPrerequisitesSetup(context, rxdkOutput)
        ),
        vscode.commands.registerCommand('rxdk.newProject', guardPrerequisites(() => createProject(context))),
        vscode.commands.registerCommand('rxdk.build', guardPrerequisites(() => runRxdkTask(context, 'build', rxdkOutput))),
        vscode.commands.registerCommand('rxdk.deploy', guardPrerequisites(() => runRxdkTask(context, 'deploy', rxdkOutput))),
        vscode.commands.registerCommand('rxdk.run', guardPrerequisites(async () => {
            await runRxdkTask(context, 'build+deploy', rxdkOutput);
            await runRxdkTask(context, 'run', rxdkOutput);
        })),
        vscode.commands.registerCommand('rxdk.debug', guardPrerequisites(() => vscode.commands.executeCommand('workbench.action.debug.start'))),
        vscode.commands.registerCommand('rxdk.debugPrebuiltXbe', guardPrerequisites(() => openPrebuiltProjectSetup(context))),
        vscode.commands.registerCommand('rxdk.refreshPrebuiltSource', guardPrerequisites(() =>
            refreshPrebuiltSourceFolder(context).then(() => sidebarProvider.refresh())
        )),
        vscode.commands.registerCommand('rxdk.setXboxIp', guardPrerequisites(() => promptSetXboxIp().then(() => sidebarProvider.refresh()))),
        vscode.commands.registerCommand('rxdk.showSidebar', () =>
            vscode.commands.executeCommand('workbench.view.extension.rxdk-sidebar')
        ),
        vscode.commands.registerCommand('rxdk.refreshSidebar', () => sidebarProvider.refresh()),
        vscode.commands.registerCommand('rxdk.openSdkDocs', guardPrerequisites(() => openSdkDocs(context))),
        vscode.commands.registerCommand('rxdk.openSdkFolder', guardPrerequisites(() => openStagedSdkFolder(context))),
        vscode.commands.registerCommand('rxdk.fetchLatestSdk', guardPrerequisites(async () => {
            const ok = await fetchLatestSdk(context, rxdkOutput);
            if (ok) {
                sidebarProvider.refresh();
            }
        })),
        vscode.commands.registerCommand('rxdk.installDotNetRuntime', async () => {
            if (await isDotNetRuntimeInstalled()) {
                vscode.window.showInformationMessage('RXDK: .NET 8 runtime is already installed.');
                return;
            }
            await ensureDotNetRuntime(context, rxdkOutput);
            await refreshPrerequisitesContext(context);
            sidebarProvider.refresh();
        }),
        vscode.commands.registerCommand('rxdk.launchXbwatson', guardPrerequisites(() => launchXbwatson(context, rxdkOutput))),
        vscode.commands.registerCommand('xbox.pickConsole', guardPrerequisites(() => promptSetXboxIp()))
    );

    void ensureVscodeForWorkspace(context);

    registerDebugIntegration(context);
}

async function bootstrapPrerequisites(context: vscode.ExtensionContext): Promise<void> {
    const ready = await refreshPrerequisitesContext(context);
    sidebarProvider.refresh();
    if (ready) {
        await ensureVscodeForWorkspace(context);
    } else {
        await openPrerequisitesSetup(context, rxdkOutput);
    }
}

async function resolveXboxLaunchConfig(
    context: vscode.ExtensionContext,
    folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration
): Promise<vscode.DebugConfiguration> {
    if (folder) {
        config.__workspaceFolder = folder.uri.fsPath;
        if (!config.cwd) {
            config.cwd = folder.uri.fsPath;
        }
        const logPath = titleLogPath(folder.uri.fsPath);
        try {
            fs.mkdirSync(path.dirname(logPath), { recursive: true });
            fs.writeFileSync(logPath, '', 'utf8');
        } catch {
            /* ignore */
        }
        config.__titleOutputFile = logPath;
    }

    const consoleName = String(config.consoleName ?? '').trim();
    if (!consoleName) {
        const active = await getActiveXboxAddress();
        if (active) {
            config.consoleName = active;
        }
    }

    const bridge = String(config.bridgePath ?? '').trim();
    if (
        !bridge ||
        bridge.includes('.vscode/extensions/rxdk-libs.') ||
        bridge.includes('.cursor/extensions/rxdk-libs.') ||
        bridge.includes('/out/sdk/tools/') ||
        (bridge.includes('/sdk/tools/') && !bridge.includes('extensionInstallFolder'))
    ) {
        config.bridgePath =
            vscode.workspace.getConfiguration('xbox').get<string>('bridgePath') || getBridgePath(context);
    }
    if (config.reboot === undefined) {
        config.reboot = false;
    }
    config.__extensionPath = context.extensionPath;
    return config;
}

function registerDebugIntegration(context: vscode.ExtensionContext): void {
    const titleOutput = getTitleOutputChannel();
    context.subscriptions.push(titleOutput);

    context.subscriptions.push(
        vscode.debug.registerDebugConfigurationProvider('xbox', {
            resolveDebugConfigurationWithSubstitutedVariables: async (folder, config) => {
                return resolveXboxLaunchConfig(context, folder, config);
            },
        })
    );

    context.subscriptions.push(
        vscode.debug.onDidStartDebugSession((session) => {
            if (session.type !== 'xbox') {
                return;
            }
            const logPath = session.configuration.__titleOutputFile as string | undefined;
            if (logPath) {
                titleOutput.clear();
                titleOutput.appendLine('---');
                startTitleLogWatcher(logPath, titleOutput, session.id);
            }
        })
    );

    context.subscriptions.push(
        vscode.debug.onDidTerminateDebugSession((session) => {
            if (session?.type === 'xbox') {
                stopTitleLogWatcher(session.id);
            }
        })
    );
}

function getTitleOutputChannel(): vscode.OutputChannel {
    if (!titleOutputChannel) {
        titleOutputChannel = vscode.window.createOutputChannel('Xbox Title');
    }
    return titleOutputChannel;
}

function titleLogPath(folder: string): string {
    return path.join(folder, '.vscode', 'xbox-title-output.log');
}

function startTitleLogWatcher(logPath: string, channel: vscode.OutputChannel, sessionId: string): void {
    for (const id of titleLogWatchers.keys()) {
        stopTitleLogWatcher(id);
    }
    let offset = 0;
    let revealed = false;
    const poll = () => {
        try {
            if (!fs.existsSync(logPath)) {
                return;
            }
            const stat = fs.statSync(logPath);
            if (stat.size <= offset) {
                return;
            }
            const fd = fs.openSync(logPath, 'r');
            const len = stat.size - offset;
            const buf = Buffer.alloc(len);
            fs.readSync(fd, buf, 0, len, offset);
            fs.closeSync(fd);
            offset = stat.size;
            const text = buf.toString('utf8');
            if (!text) {
                return;
            }
            channel.append(text);
            if (
                !revealed &&
                vscode.workspace.getConfiguration('xbox').get<boolean>('showTitleOutput', true)
            ) {
                revealed = true;
                channel.show(true);
            }
        } catch {
            /* ignore */
        }
    };
    titleLogWatchers.set(sessionId, setInterval(poll, 100));
    poll();
}

function stopTitleLogWatcher(sessionId: string): void {
    const timer = titleLogWatchers.get(sessionId);
    if (timer) {
        clearInterval(timer);
        titleLogWatchers.delete(sessionId);
    }
}

export function deactivate(): void {
    for (const sessionId of titleLogWatchers.keys()) {
        stopTitleLogWatcher(sessionId);
    }
}

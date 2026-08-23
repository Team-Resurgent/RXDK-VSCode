import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { RxdkProjectManifest, configurationNames } from './projectTypes';
import { stripBom } from './xboxSdkPaths';

const KEY_PREFIX = 'rxdk.selectedConfig:';

function readRawManifest(manifestPath: string): RxdkProjectManifest | undefined {
    try {
        return JSON.parse(stripBom(fs.readFileSync(manifestPath, 'utf8'))) as RxdkProjectManifest;
    } catch {
        return undefined;
    }
}

/**
 * The user-selected configuration for a project (persisted in workspaceState), defaulting to the
 * manifest's defaultConfiguration or the first config. Returns '' for a flat single-config manifest.
 */
export function getSelectedConfig(
    context: vscode.ExtensionContext,
    manifestPath: string,
    rawManifest?: RxdkProjectManifest
): string {
    const raw = rawManifest ?? readRawManifest(manifestPath);
    const names = raw ? configurationNames(raw) : [];
    if (names.length === 0) {
        return '';
    }
    const match = (want?: string) =>
        want ? names.find((n) => n.toLowerCase() === want.toLowerCase()) : undefined;
    const stored = context.workspaceState.get<string>(KEY_PREFIX + manifestPath);
    return match(stored) ?? match(raw?.defaultConfiguration) ?? names[0];
}

export async function setSelectedConfig(
    context: vscode.ExtensionContext,
    manifestPath: string,
    name: string
): Promise<void> {
    await context.workspaceState.update(KEY_PREFIX + manifestPath, name);
}

let statusItem: vscode.StatusBarItem | undefined;

/** Find the active project's manifest path (first workspace folder with rxdk.project.json). */
function activeManifestPath(): string | undefined {
    for (const ws of vscode.workspace.workspaceFolders ?? []) {
        const p = path.join(ws.uri.fsPath, 'rxdk.project.json');
        if (fs.existsSync(p)) {
            return p;
        }
    }
    return undefined;
}

/** Refresh the status-bar item to show the current project's selected configuration. */
export function updateConfigStatusBar(context: vscode.ExtensionContext): void {
    if (!statusItem) {
        return;
    }
    const mp = activeManifestPath();
    const raw = mp ? readRawManifest(mp) : undefined;
    const names = raw ? configurationNames(raw) : [];
    if (!mp || names.length === 0) {
        statusItem.hide();
        return;
    }
    statusItem.text = `$(gear) Xbox: ${getSelectedConfig(context, mp, raw)}`;
    statusItem.tooltip = 'RXDK build configuration — click to change';
    statusItem.show();
}

/**
 * Wire up configuration selection: a status-bar item + the rxdk.selectConfiguration command.
 * Selecting a config persists it, refreshes the status bar, and regenerates the IntelliSense
 * config (via the supplied callback) so squiggles match the chosen configuration.
 */
export function initConfigSelection(
    context: vscode.ExtensionContext,
    onConfigChanged: (manifestPath: string) => void | Promise<void>
): void {
    statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);
    statusItem.command = 'rxdk.selectConfiguration';
    context.subscriptions.push(statusItem);

    context.subscriptions.push(
        vscode.commands.registerCommand('rxdk.selectConfiguration', async () => {
            const mp = activeManifestPath();
            const raw = mp ? readRawManifest(mp) : undefined;
            const names = raw ? configurationNames(raw) : [];
            if (!mp || names.length === 0) {
                vscode.window.showInformationMessage(
                    'This project has a single configuration (no configurations to choose from).'
                );
                return;
            }
            const current = getSelectedConfig(context, mp, raw);
            const pick = await vscode.window.showQuickPick(
                names.map((n) => ({ label: n, description: n === current ? 'current' : undefined })),
                { title: 'Select RXDK build configuration' }
            );
            if (!pick || pick.label === current) {
                return;
            }
            await setSelectedConfig(context, mp, pick.label);
            updateConfigStatusBar(context);
            await onConfigChanged(mp);
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => updateConfigStatusBar(context))
    );
    updateConfigStatusBar(context);
}

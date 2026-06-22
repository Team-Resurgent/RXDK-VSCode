import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { findProjectManifest } from './projectManager';
import { generateVscodeFolder } from './vscodeGenerator';
import { isPrebuiltManifest, RxdkProjectManifest } from './projectTypes';

const SOURCE_FOLDER_NAME = 'Source';

export function prebuiltWorkspaceFilePath(projectRoot: string, projectName: string): string {
    return path.join(projectRoot, `${projectName}.code-workspace`);
}

export function writePrebuiltWorkspaceFile(
    projectRoot: string,
    projectName: string,
    srcRoot?: string
): string {
    const workspacePath = prebuiltWorkspaceFilePath(projectRoot, projectName);
    const folders: Array<{ name: string; path: string }> = [{ name: projectName, path: '.' }];
    const src = srcRoot?.trim();
    if (src) {
        folders.push({ name: SOURCE_FOLDER_NAME, path: src });
    }
    fs.writeFileSync(
        workspacePath,
        JSON.stringify({ folders, settings: {} }, null, 4) + '\n',
        'utf8'
    );
    return workspacePath;
}

export async function openPrebuiltWorkspace(workspacePath: string): Promise<void> {
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(workspacePath), {
        forceNewWindow: false,
    });
}

function normPath(p: string): string {
    return path.normalize(p).replace(/\\/g, '/').toLowerCase();
}

function folderIndexByPath(folders: readonly vscode.WorkspaceFolder[], target: string): number {
    const needle = normPath(target);
    return folders.findIndex((f) => normPath(f.uri.fsPath) === needle);
}

export async function syncPrebuiltWorkspaceFolders(
    projectRoot: string,
    srcRoot: string | undefined,
    previousSrcRoot?: string
): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
        return;
    }

    const src = srcRoot?.trim();
    const prev = previousSrcRoot?.trim();

    if (prev && prev !== src) {
        const prevIdx = folderIndexByPath(folders, prev);
        if (prevIdx >= 0) {
            const ok = vscode.workspace.updateWorkspaceFolders(prevIdx, 1);
            if (!ok) {
                /* best effort */
            }
        }
    }

    const current = vscode.workspace.workspaceFolders ?? [];
    if (folderIndexByPath(current, projectRoot) < 0) {
        vscode.workspace.updateWorkspaceFolders(current.length, 0, { uri: vscode.Uri.file(projectRoot) });
    }

    if (src && fs.existsSync(src)) {
        const live = vscode.workspace.workspaceFolders ?? [];
        if (folderIndexByPath(live, src) < 0) {
            vscode.workspace.updateWorkspaceFolders(live.length, 0, {
                uri: vscode.Uri.file(src),
                name: SOURCE_FOLDER_NAME,
            });
        }
    }
}

async function pickSourceFolder(seed: string): Promise<string | undefined> {
    const defaultUri =
        seed && fs.existsSync(seed) ? vscode.Uri.file(seed) : vscode.workspace.workspaceFolders?.[0]?.uri;
    const picked = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        defaultUri,
        openLabel: 'Select source folder',
        title: 'Select source folder for breakpoints',
    });
    return picked?.[0]?.fsPath;
}

function saveManifest(manifestPath: string, manifest: RxdkProjectManifest): void {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

export async function refreshPrebuiltSourceFolder(context: vscode.ExtensionContext): Promise<void> {
    const found = await findProjectManifest();
    if (!found || !isPrebuiltManifest(found.manifest)) {
        vscode.window.showErrorMessage('Open a prebuilt-XBE project (rxdk.project.json with prebuilt config).');
        return;
    }

    const projectRoot = found.folder.uri.fsPath;
    const previousSrc = found.manifest.prebuilt?.srcRoot?.trim() ?? '';
    let srcRoot = previousSrc;

    if (!srcRoot || !fs.existsSync(srcRoot)) {
        const picked = await pickSourceFolder(srcRoot);
        if (!picked) {
            return;
        }
        srcRoot = picked;
    } else {
        const choice = await vscode.window.showQuickPick(
            [
                { label: 'Refresh from manifest', description: srcRoot, id: 'use' },
                { label: 'Choose a different folder…', id: 'pick' },
            ],
            { placeHolder: 'Refresh source folder in workspace' }
        );
        if (!choice) {
            return;
        }
        if (choice.id === 'pick') {
            const picked = await pickSourceFolder(srcRoot);
            if (!picked) {
                return;
            }
            srcRoot = picked;
        }
    }

    if (!fs.existsSync(srcRoot)) {
        vscode.window.showErrorMessage(`Source folder not found: ${srcRoot}`);
        return;
    }

    found.manifest.prebuilt!.srcRoot = srcRoot;
    saveManifest(found.manifestPath, found.manifest);
    await generateVscodeFolder(context, projectRoot, found.manifest.name, found.manifest);

    const workspacePath = writePrebuiltWorkspaceFile(projectRoot, found.manifest.name, srcRoot);
    await syncPrebuiltWorkspaceFolders(projectRoot, srcRoot, previousSrc);

    vscode.window.showInformationMessage(
        `Source folder set to ${srcRoot}. Workspace saved to ${path.basename(workspacePath)}.`
    );
}

export async function scaffoldPrebuiltWorkspaceArtifacts(
    context: vscode.ExtensionContext,
    projectRoot: string,
    manifest: RxdkProjectManifest
): Promise<string> {
    const srcRoot = manifest.prebuilt?.srcRoot?.trim();
    const workspacePath = writePrebuiltWorkspaceFile(projectRoot, manifest.name, srcRoot);
    await generateVscodeFolder(context, projectRoot, manifest.name, manifest);
    return workspacePath;
}

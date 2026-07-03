import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { RxdkProjectManifest, RxdkTemplateId, TEMPLATE_LABELS } from './projectTypes';
import { generateVscodeFolder } from './vscodeGenerator';
import { getExtensionRoot } from './sdkPath';
import { stripBom } from './xboxSdkPaths';
import { openPrebuiltWorkspace, writePrebuiltWorkspaceFile } from './prebuiltWorkspace';
import { openNewProjectWizard } from './newProjectWizard';

export async function findProjectManifest(
    folder?: vscode.WorkspaceFolder
): Promise<{ folder: vscode.WorkspaceFolder; manifest: RxdkProjectManifest; manifestPath: string } | undefined> {
    const folders = folder ? [folder] : vscode.workspace.workspaceFolders ?? [];
    for (const ws of folders) {
        const manifestPath = path.join(ws.uri.fsPath, 'rxdk.project.json');
        if (!fs.existsSync(manifestPath)) {
            continue;
        }
        const raw = stripBom(fs.readFileSync(manifestPath, 'utf8'));
        const manifest = JSON.parse(raw) as RxdkProjectManifest;
        return { folder: ws, manifest, manifestPath };
    }
    return undefined;
}

export function validateProjectName(name: string): string | undefined {
    if (!name) {
        return 'Enter a project name.';
    }
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)) {
        return 'Use letters, digits, underscore, hyphen; must start with a letter.';
    }
    return undefined;
}

export function suggestProjectName(template: RxdkTemplateId): string {
    switch (template) {
        case 'spinning-triangle':
            return 'my-triangle';
        case 'spinning-cube':
            return 'my-cube';
        case 'music-visualizer':
            return 'my-music';
        case 'controller-input':
            return 'my-controller';
        case 'video-player':
            return 'my-player';
        case 'font-scroller':
            return 'my-scroller';
        case 'network-server':
            return 'my-server';
        case 'dxt':
            return 'my-dxt';
        case 'library':
            return 'my-library';
        default:
            return 'my-game';
    }
}

export type ScaffoldProjectResult = { ok: true } | { ok: false; error: string };

export async function scaffoldProjectFromTemplate(
    context: vscode.ExtensionContext,
    template: RxdkTemplateId,
    parentDir: string,
    name: string
): Promise<ScaffoldProjectResult> {
    const nameError = validateProjectName(name);
    if (nameError) {
        return { ok: false, error: nameError };
    }
    if (!parentDir || !fs.existsSync(parentDir)) {
        return { ok: false, error: 'Parent folder not found.' };
    }

    const projectRoot = path.join(parentDir, name);
    if (fs.existsSync(projectRoot)) {
        return { ok: false, error: `Folder already exists: ${projectRoot}` };
    }

    const templateDir = path.join(getExtensionRoot(context), 'templates', template);
    if (!fs.existsSync(templateDir)) {
        return {
            ok: false,
            error: `Template not found: ${templateDir}. Reinstall the RXDK extension.`,
        };
    }

    try {
        copyTree(templateDir, projectRoot);
        patchManifest(projectRoot, name);
        const manifest = JSON.parse(
            stripBom(fs.readFileSync(path.join(projectRoot, 'rxdk.project.json'), 'utf8'))
        ) as RxdkProjectManifest;

        await generateVscodeFolder(context, projectRoot, name, manifest);
        const workspacePath = writePrebuiltWorkspaceFile(projectRoot, name);
        await openPrebuiltWorkspace(workspacePath);
        await vscode.commands.executeCommand('setContext', 'rxdk.hasProject', true);
        vscode.window.showInformationMessage(
            `Created Xbox project "${name}" (${TEMPLATE_LABELS[template]}).`
        );
        return { ok: true };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message };
    }
}

export async function createProject(
    context: vscode.ExtensionContext,
    templateId?: RxdkTemplateId
): Promise<void> {
    await openNewProjectWizard(context, templateId);
}

function copyTree(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const from = path.join(src, entry.name);
        const to = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyTree(from, to);
        } else {
            fs.copyFileSync(from, to);
        }
    }
}

function patchManifest(projectRoot: string, name: string): void {
    const manifestPath = path.join(projectRoot, 'rxdk.project.json');
    const manifest = JSON.parse(stripBom(fs.readFileSync(manifestPath, 'utf8'))) as RxdkProjectManifest;
    manifest.name = name;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

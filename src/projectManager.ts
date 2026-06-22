import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { RxdkProjectManifest, RxdkTemplateId, TEMPLATE_LABELS } from './projectTypes';
import { generateVscodeFolder } from './vscodeGenerator';
import { getExtensionRoot } from './sdkPath';

export async function findProjectManifest(
    folder?: vscode.WorkspaceFolder
): Promise<{ folder: vscode.WorkspaceFolder; manifest: RxdkProjectManifest; manifestPath: string } | undefined> {
    const folders = folder ? [folder] : vscode.workspace.workspaceFolders ?? [];
    for (const ws of folders) {
        const manifestPath = path.join(ws.uri.fsPath, 'rxdk.project.json');
        if (!fs.existsSync(manifestPath)) {
            continue;
        }
        const raw = fs.readFileSync(manifestPath, 'utf8');
        const manifest = JSON.parse(raw) as RxdkProjectManifest;
        return { folder: ws, manifest, manifestPath };
    }
    return undefined;
}

export async function pickTemplate(): Promise<RxdkTemplateId | undefined> {
    const items = (Object.keys(TEMPLATE_LABELS) as RxdkTemplateId[]).map((id) => ({
        label: TEMPLATE_LABELS[id],
        description: id,
        id,
    }));
    const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Choose Xbox project template' });
    return pick?.id;
}

export async function createProject(
    context: vscode.ExtensionContext,
    templateId?: RxdkTemplateId
): Promise<void> {
    const template = templateId ?? (await pickTemplate());
    if (!template) {
        return;
    }

    const name = await vscode.window.showInputBox({
        prompt: 'Project name (folder and executable name)',
        value: suggestName(template),
        validateInput: (v) => (/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(v) ? null : 'Use letters, digits, underscore, hyphen'),
    });
    if (!name) {
        return;
    }

    const dest = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Create project here',
        title: 'Choose parent folder for the new Xbox project',
    });
    if (!dest?.length) {
        return;
    }

    const projectRoot = path.join(dest[0].fsPath, name);
    if (fs.existsSync(projectRoot)) {
        vscode.window.showErrorMessage(`Folder already exists: ${projectRoot}`);
        return;
    }

    const templateDir = path.join(getExtensionRoot(context), 'templates', template);
    if (!fs.existsSync(templateDir)) {
        vscode.window.showErrorMessage(`Template not found: ${templateDir}. Run scripts/sync-all.ps1 first.`);
        return;
    }

    copyTree(templateDir, projectRoot);
    patchManifest(projectRoot, name);
    const manifest = JSON.parse(
        fs.readFileSync(path.join(projectRoot, 'rxdk.project.json'), 'utf8')
    ) as RxdkProjectManifest;

    const uri = vscode.Uri.file(projectRoot);
    await generateVscodeFolder(context, projectRoot, name, manifest);
    const add = await vscode.window.showInformationMessage(
        `Created Xbox project "${name}" (${TEMPLATE_LABELS[template]})`,
        'Open Folder'
    );
    if (add) {
        await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: false });
    }
}

function suggestName(template: RxdkTemplateId): string {
    switch (template) {
        case 'd3d8-triangle':
            return 'my-triangle';
        case 'dsound-tone':
            return 'my-tone';
        case 'xinput-gamepad':
            return 'my-pad';
        case 'xmv-play':
            return 'my-xmv';
        default:
            return 'my-game';
    }
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
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as RxdkProjectManifest;
    manifest.name = name;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

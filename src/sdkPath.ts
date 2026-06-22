import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { bridgeExecutableName, resolveBundledBridgePath } from './bridgePath';

export function getExtensionRoot(context: vscode.ExtensionContext): string {
    return context.extensionPath;
}

export function getSdkRoot(context: vscode.ExtensionContext): string {
    const override = vscode.workspace.getConfiguration('rxdk').get<string>('sdkPath');
    if (override && fs.existsSync(override)) {
        return path.normalize(override);
    }
    return path.join(context.extensionPath, 'out', 'sdk');
}

export function getSdkScriptsDir(context: vscode.ExtensionContext): string {
    return path.join(getSdkRoot(context), 'scripts');
}

export function getSdkToolsDir(context: vscode.ExtensionContext): string {
    return path.join(getSdkRoot(context), 'tools');
}

export function getBridgePath(context: vscode.ExtensionContext): string {
    const configured = vscode.workspace.getConfiguration('xbox').get<string>('bridgePath');
    if (configured && fs.existsSync(configured)) {
        return configured;
    }
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return resolveBundledBridgePath(context.extensionPath, workspaceRoot);
}

export function readSdkVersion(context: vscode.ExtensionContext): string {
    const versionFile = path.join(getSdkRoot(context), 'VERSION.txt');
    try {
        return fs.readFileSync(versionFile, 'utf8').trim();
    } catch {
        return 'not staged';
    }
}

export function getBridgeExecutableName(): string {
    return bridgeExecutableName();
}

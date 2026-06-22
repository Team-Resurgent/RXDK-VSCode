import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { bridgeExecutableName, resolveBundledBridgePath } from './bridgePath';
import { getStagedSdkRoot, isStagedSdkPresent } from './sdkStaging';

export function getExtensionRoot(context: vscode.ExtensionContext): string {
    return context.extensionPath;
}

export function getBundledSdkRoot(context: vscode.ExtensionContext): string {
    return path.join(context.extensionPath, 'out', 'sdk');
}

function sdkPathOverride(context: vscode.ExtensionContext): string | undefined {
    const override = vscode.workspace.getConfiguration('rxdk').get<string>('sdkPath')?.trim();
    if (override && fs.existsSync(override)) {
        return path.normalize(override);
    }
    return undefined;
}

/** SdkRoot for scripts/tools (full override, else bundled extension SDK). */
export function getSdkRoot(context: vscode.ExtensionContext): string {
    return sdkPathOverride(context) ?? getBundledSdkRoot(context);
}

export function getSdkScriptsDir(context: vscode.ExtensionContext): string {
    return path.join(getSdkRoot(context), 'scripts');
}

export function getSdkToolsDir(context: vscode.ExtensionContext): string {
    return path.join(getSdkRoot(context), 'tools');
}

/** Headers for builds and IntelliSense (cloned RXDK-SDK, override, or bundled fallback). */
export function getSdkIncludeDir(context: vscode.ExtensionContext): string {
    const override = sdkPathOverride(context);
    if (override) {
        return path.join(override, 'include');
    }
    if (isStagedSdkPresent(context)) {
        return path.join(getStagedSdkRoot(context), 'include');
    }
    return path.join(getBundledSdkRoot(context), 'include');
}

/** Libraries for linking (cloned RXDK-SDK, override, or bundled fallback). */
export function getSdkLibDir(context: vscode.ExtensionContext): string {
    const override = sdkPathOverride(context);
    if (override) {
        return path.join(override, 'lib');
    }
    if (isStagedSdkPresent(context)) {
        return path.join(getStagedSdkRoot(context), 'lib');
    }
    return path.join(getBundledSdkRoot(context), 'lib');
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
    const override = sdkPathOverride(context);
    if (override) {
        return readVersionFromRoot(override);
    }
    const staged = getStagedSdkRoot(context);
    if (isStagedSdkPresent(context)) {
        return readVersionFromRoot(staged);
    }
    return readVersionFromRoot(getBundledSdkRoot(context));
}

function readVersionFromRoot(root: string): string {
    for (const name of ['VERSION', 'VERSION.txt']) {
        const versionFile = path.join(root, name);
        try {
            return fs.readFileSync(versionFile, 'utf8').trim();
        } catch {
            /* try next */
        }
    }
    return 'not installed';
}

export function getBridgeExecutableName(): string {
    return bridgeExecutableName();
}

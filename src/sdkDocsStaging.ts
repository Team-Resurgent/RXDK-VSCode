import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { getStagedSdkRoot } from './sdkStaging';

const execFileAsync = promisify(execFile);

export function getRxdkDataRoot(context?: vscode.ExtensionContext): string {
    return path.dirname(getStagedSdkRoot(context));
}

/** Persistent extracted Xbox SDK HTML docs (ProgramData/RXDK/docs/xboxsdk). */
export function getStagedDocsRoot(context?: vscode.ExtensionContext): string {
    return path.join(getRxdkDataRoot(context), 'docs', 'xboxsdk');
}

function bundledDocsTree(context: vscode.ExtensionContext): string {
    return path.join(context.extensionPath, 'docs', 'xboxsdk');
}

function bundledDocsArchive(context: vscode.ExtensionContext): string {
    return path.join(context.extensionPath, 'docs', 'xboxsdk.tar.gz');
}

export function isSdkDocsPresent(context: vscode.ExtensionContext): boolean {
    const toc = 'toc.json';
    const staged = getStagedDocsRoot(context);
    if (fs.existsSync(path.join(staged, toc))) {
        return true;
    }
    const devTree = bundledDocsTree(context);
    return fs.existsSync(path.join(devTree, toc));
}

/**
 * Extract bundled docs/xboxsdk.tar.gz once into the RXDK data directory.
 * Existing docs folders are never overwritten.
 */
export async function ensureSdkDocsStaging(
    context: vscode.ExtensionContext,
    output?: vscode.OutputChannel
): Promise<void> {
    const staged = getStagedDocsRoot(context);
    if (fs.existsSync(path.join(staged, 'toc.json'))) {
        output?.appendLine(`RXDK: Xbox SDK docs present at ${staged}`);
        return;
    }

    const devTree = bundledDocsTree(context);
    if (fs.existsSync(path.join(devTree, 'toc.json'))) {
        output?.appendLine(`RXDK: using dev docs tree at ${devTree}`);
        return;
    }

    const archive = bundledDocsArchive(context);
    if (!fs.existsSync(archive)) {
        output?.appendLine('RXDK: Xbox SDK docs archive missing from extension bundle');
        return;
    }

    if (fs.existsSync(staged)) {
        output?.appendLine(`RXDK: docs folder exists but toc.json missing — not overwriting: ${staged}`);
        return;
    }

    const destParent = path.dirname(staged);
    fs.mkdirSync(destParent, { recursive: true });
    output?.appendLine(`RXDK: extracting Xbox SDK docs to ${destParent}`);

    try {
        await execFileAsync('tar', ['-xzf', archive, '-C', destParent], {
            timeout: 300_000,
            windowsHide: true,
        });
        output?.appendLine(`RXDK: Xbox SDK docs ready at ${staged}`);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        output?.appendLine(`RXDK: docs extract failed: ${message}`);
    }
}

/** Resolved docs root for the in-editor viewer (staged, dev tree, or expected staged path). */
export function resolveSdkDocsRoot(context: vscode.ExtensionContext): string {
    const staged = getStagedDocsRoot(context);
    if (fs.existsSync(path.join(staged, 'toc.json'))) {
        return staged;
    }
    const devTree = bundledDocsTree(context);
    if (fs.existsSync(path.join(devTree, 'toc.json'))) {
        return devTree;
    }
    return staged;
}

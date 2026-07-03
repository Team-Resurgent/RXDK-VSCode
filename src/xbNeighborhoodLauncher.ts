import * as fs from 'fs';
import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { ensureDotNetRuntime } from './dotnetRuntime';
import { resolveHostTool } from './hostTools';

export async function launchXbNeighborhood(
    context: vscode.ExtensionContext,
    output?: vscode.OutputChannel
): Promise<boolean> {
    if (!(await ensureDotNetRuntime(context, output))) {
        return false;
    }

    const toolPath = resolveHostTool('xbneighborhood');
    if (!fs.existsSync(toolPath)) {
        vscode.window.showErrorMessage(
            `xbneighborhood not found at ${toolPath}. Update the RXDK host tools (Components → Check for updates…).`
        );
        return false;
    }

    try {
        const child = spawn(toolPath, [], {
            detached: true,
            stdio: 'ignore',
            windowsHide: false,
        });
        child.unref();
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        output?.appendLine(`RXDK: failed to launch xbneighborhood: ${message}`);
        vscode.window.showErrorMessage(`Failed to launch xbNeighborhood: ${message}`);
        return false;
    }

    output?.appendLine('RXDK: launched xbneighborhood');
    vscode.window.showInformationMessage('xbNeighborhood launched.');
    return true;
}

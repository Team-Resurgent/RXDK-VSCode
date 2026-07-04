import * as fs from 'fs';
import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { ensureDotNetRuntime } from './dotnetRuntime';
import { getXbwatsonPath } from './sdkPath';
import { getActiveXboxAddress } from './xboxConsole';

export async function launchXbwatson(
    context: vscode.ExtensionContext,
    output?: vscode.OutputChannel
): Promise<boolean> {
    if (!(await ensureDotNetRuntime(context, output))) {
        return false;
    }

    const toolPath = getXbwatsonPath(context);
    if (!fs.existsSync(toolPath)) {
        vscode.window.showErrorMessage(
            `xbwatson not found at ${toolPath}. Rebuild or reinstall the RXDK extension.`
        );
        return false;
    }

    const consoleName = await getActiveXboxAddress();
    const args = consoleName ? ['-x', consoleName] : [];

    try {
        const child = spawn(toolPath, args, {
            detached: true,
            stdio: 'ignore',
            windowsHide: false,
        });
        child.unref();
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        output?.appendLine(`RXDK: failed to launch xbwatson: ${message}`);
        vscode.window.showErrorMessage(`Failed to launch xbWatson: ${message}`);
        return false;
    }

    const target = consoleName ? ` (${consoleName})` : '';
    output?.appendLine(`RXDK: launched xbwatson${target}`);
    vscode.window.showInformationMessage(`xbWatson launched${target}.`);
    return true;
}

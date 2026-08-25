import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { resolveHostTool, getStagedToolsRoot } from './hostTools';
import { getStagedSdkRoot } from './sdkStaging';
import { runStreamed } from './processRunner';

/**
 * Import a Visual Studio .NET 2003 XDK project (.vcproj) or solution (.sln) into an RXDK project,
 * via the shared C# engine (Rxdk.Cli import-vcproj / import-sln -- the same importer VS20XX uses).
 * The engine emits an rxdk.project.json (which VS Code loads) alongside the .vcxproj, so the imported
 * project opens in either IDE. Prompts for the source and a destination folder, then offers to open it.
 */
export async function importVs2003Project(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel
): Promise<void> {
    const cli = resolveHostTool('Rxdk.Cli');
    if (!fs.existsSync(cli)) {
        vscode.window.showErrorMessage(
            `Build engine not found: ${cli}. Update the RXDK host tools (Complete Setup / Update All).`
        );
        return;
    }

    const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: 'Select',
        filters: { 'VS2003 project or solution': ['vcproj', 'sln'] },
        title: 'Import a VS2003 (.vcproj) or solution (.sln)',
    });
    if (!picked || picked.length === 0) {
        return;
    }
    const input = picked[0].fsPath;
    const isSln = input.toLowerCase().endsWith('.sln');

    const destPick = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Import here',
        title: 'Choose the destination folder for the imported RXDK project',
    });
    if (!destPick || destPick.length === 0) {
        return;
    }
    const dest = destPick[0].fsPath;

    const env: NodeJS.ProcessEnv = {
        RXDK_STAGED_TOOLS: getStagedToolsRoot(),
        RXDK_STAGED_SDK: getStagedSdkRoot(context),
    };
    output.show(true);
    output.appendLine(`RXDK: importing ${input} -> ${dest}`);
    const result = await runStreamed(
        cli,
        [isSln ? 'import-sln' : 'import-vcproj', '--in', input, '--out', dest],
        { output, env }
    );
    if (result.exitCode !== 0) {
        vscode.window.showErrorMessage(`RXDK import failed (exit code ${result.exitCode}). See the RXDK output.`);
        return;
    }

    // A single .vcproj writes rxdk.project.json directly into dest; a .sln writes one per project
    // into subfolders (open the dest folder to browse them).
    const choice = await vscode.window.showInformationMessage(
        `Imported ${path.basename(input)} into ${dest}.`,
        'Open in New Window',
        'Open Here'
    );
    if (!choice) {
        return;
    }
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(dest), {
        forceNewWindow: choice === 'Open in New Window',
    });
}

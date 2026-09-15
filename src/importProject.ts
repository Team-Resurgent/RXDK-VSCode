import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { resolveHostTool, getStagedToolsRoot } from './hostTools';
import { getStagedSdkRoot } from './sdkStaging';
import { runStreamed } from './processRunner';

// Problems-panel entries for the importer's per-file hazard diagnostics (inline asm, legacy
// for-scope, ...). Parsed from the CLI's gcc-style `path:line:col: warning: msg` output — the same
// format VS20XX's Error List consumes — so they're clickable and jump to the flagged line.
let importDiagnostics: vscode.DiagnosticCollection | undefined;
function getImportDiagnostics(context: vscode.ExtensionContext): vscode.DiagnosticCollection {
    if (!importDiagnostics) {
        importDiagnostics = vscode.languages.createDiagnosticCollection('rxdk-import');
        context.subscriptions.push(importDiagnostics);
    }
    return importDiagnostics;
}

const GCC_DIAG = /^(?<file>(?:[A-Za-z]:)?[^:]*):(?<line>\d+):(?<col>\d+):\s*(?<sev>error|warning|note):\s*(?<msg>.*)$/i;

/** Parse the importer's gcc-style diagnostic lines from stdout into the Problems panel. */
function publishImportDiagnostics(context: vscode.ExtensionContext, stdout: string): number {
    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const raw of stdout.split(/\r?\n/)) {
        const m = GCC_DIAG.exec(raw.trim());
        if (!m || !m.groups) {
            continue;
        }
        const line = Math.max(0, parseInt(m.groups.line, 10) - 1);
        const col = Math.max(0, parseInt(m.groups.col, 10) - 1);
        const sev = m.groups.sev.toLowerCase();
        const severity =
            sev === 'error' ? vscode.DiagnosticSeverity.Error :
            sev === 'note' ? vscode.DiagnosticSeverity.Information :
            vscode.DiagnosticSeverity.Warning;
        const diag = new vscode.Diagnostic(new vscode.Range(line, col, line, col + 1), m.groups.msg, severity);
        diag.source = 'RXDK import';
        const list = byFile.get(m.groups.file) ?? [];
        list.push(diag);
        byFile.set(m.groups.file, list);
    }
    const collection = getImportDiagnostics(context);
    collection.clear();
    let total = 0;
    for (const [file, diags] of byFile) {
        try {
            collection.set(vscode.Uri.file(file), diags);
            total += diags.length;
        } catch {
            /* not a real file path — skip */
        }
    }
    return total;
}

/**
 * Import a Visual Studio .NET 2003 XDK project (.vcproj) or solution (.sln) into an RXDK project,
 * via the shared C# engine (Rxdk.Cli import-vcproj / import-sln -- the same importer VS20XX uses).
 * The engine emits an rxdk.project.json (which VS Code loads) alongside the .vcxproj, so the imported
 * project opens in either IDE. Prompts for a Project root + the .vcproj/.sln, imports into a child
 * folder of the root named after the project, then offers to open it.
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

    // 1. The project root: the parent folder the imported project is created UNDER.
    const rootPick = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Use as project root',
        title: 'Step 1 of 2: choose the project root (the imported project is created inside it)',
    });
    if (!rootPick || rootPick.length === 0) {
        return;
    }
    const projectRoot = rootPick[0].fsPath;

    // 2. The VS2003 .vcproj / .sln to import.
    const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: 'Import',
        filters: { 'VS2003 project or solution': ['vcproj', 'sln'] },
        title: 'Step 2 of 2: select the VS2003 (.vcproj) or solution (.sln) to import',
    });
    if (!picked || picked.length === 0) {
        return;
    }
    const input = picked[0].fsPath;
    const isSln = input.toLowerCase().endsWith('.sln');
    const sourceDir = path.dirname(input);

    // The import lands in <project root>/<project name> -- a child of the chosen root. Sources are
    // copied in unless that child folder IS the project's own folder (then it's an in-place import and
    // paths reference the originals). Either way manifest source paths stay relative.
    const projectName = path.basename(input, path.extname(input));
    const dest = path.join(projectRoot, projectName);
    const copySources = path.resolve(dest) !== path.resolve(sourceDir);

    if (copySources && fs.existsSync(dest) && fs.readdirSync(dest).length > 0) {
        const overwrite = await vscode.window.showWarningMessage(
            `"${dest}" already exists and isn't empty. Import into it anyway (existing files may be overwritten)?`,
            { modal: true },
            'Import Here'
        );
        if (overwrite !== 'Import Here') {
            return;
        }
    }

    const env: NodeJS.ProcessEnv = {
        RXDK_STAGED_TOOLS: getStagedToolsRoot(),
        RXDK_STAGED_SDK: getStagedSdkRoot(context),
    };
    const args = [isSln ? 'import-sln' : 'import-vcproj', '--in', input, '--out', dest];
    if (copySources) {
        args.push('--copy-sources');
    }
    output.show(true);
    output.appendLine(`RXDK: importing ${input} -> ${dest}${copySources ? ' (copying sources)' : ' (in place)'}`);
    const result = await runStreamed(cli, args, { output, env });
    if (result.exitCode !== 0) {
        vscode.window.showErrorMessage(`RXDK import failed (exit code ${result.exitCode}). See the RXDK output.`);
        return;
    }

    // Surface the importer's per-file hazard diagnostics (inline asm, legacy for-scope, ...) in the
    // Problems panel so they're clickable, not just buried in the output channel.
    const warnCount = publishImportDiagnostics(context, result.stdout);
    const warnSuffix = warnCount > 0 ? ` (${warnCount} warning(s) — see Problems)` : '';

    // A single .vcproj writes rxdk.project.json directly into dest; a .sln writes one per project
    // into subfolders (open the dest folder to browse them).
    const choice = await vscode.window.showInformationMessage(
        `Imported ${path.basename(input)} into ${dest}.${warnSuffix}`,
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

/**
 * Locate MSBuild.exe for the newest installed Visual Studio via vswhere. Windows-only --
 * RxdkGenerateProjectJson is an MSBuild target defined in RXDK-VS20XX's Xbox platform
 * (Platform.targets), so generating rxdk.project.json from a .vcxproj needs a real MSBuild,
 * the same thing the VS20XX "Import VS20XX Project" command shells out to.
 */
async function findMsBuildExe(): Promise<string | undefined> {
    if (process.platform !== 'win32') {
        return undefined;
    }
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const vswhere = path.join(pf86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
    if (!fs.existsSync(vswhere)) {
        return undefined;
    }
    const installPath = await new Promise<string>((resolve) => {
        execFile(
            vswhere,
            ['-latest', '-prerelease', '-requires', 'Microsoft.Component.MSBuild', '-property', 'installationPath'],
            (err, stdout) => resolve(err ? '' : stdout.trim())
        );
    });
    if (!installPath) {
        return undefined;
    }
    const msbuild = path.join(installPath, 'MSBuild', 'Current', 'Bin', 'MSBuild.exe');
    return fs.existsSync(msbuild) ? msbuild : undefined;
}

/**
 * Cheap textual check: does the .vcxproj declare at least one ProjectConfiguration whose Platform
 * is "Xbox"? Only the RXDK "Xbox" platform (installed by RXDK for Visual Studio) uses that name, so
 * this is a reliable signal that doesn't require MSBuild or the platform to be installed just to
 * check -- mirrors VcxprojDeclaresXboxPlatform in RxdkVs.Package/Commands/RxdkCommands.cs.
 */
function vcxprojDeclaresXboxPlatform(vcxprojText: string): boolean {
    const group = /<ItemGroup[^>]*Label="ProjectConfigurations"[^>]*>[\s\S]*?<\/ItemGroup>/i.exec(vcxprojText);
    const scope = group ? group[0] : vcxprojText;
    return /<Platform>\s*Xbox\s*<\/Platform>/i.test(scope);
}

/**
 * Generate (or regenerate) rxdk.project.json from an existing RXDK VS20XX project's .vcxproj --
 * e.g. one freshly cloned from git that has never been built in Visual Studio, so it has no
 * manifest yet. VS Code's Open Folder flow reads rxdk.project.json directly and has no MSBuild of
 * its own, so this runs the same RxdkGenerateProjectJson target VS20XX's build (and its own
 * "Import VS20XX Project" command) use, via MSBuild.exe.
 */
export async function importVs20xxProject(output: vscode.OutputChannel): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: 'Import',
        filters: { 'Visual C++ project': ['vcxproj'] },
        title: 'Select the RXDK VS20XX project (.vcxproj)',
    });
    if (!picked || picked.length === 0) {
        return;
    }
    const vcxprojPath = picked[0].fsPath;
    const projectRoot = path.dirname(vcxprojPath);
    const projectName = path.basename(vcxprojPath, path.extname(vcxprojPath));

    let vcxprojText: string;
    try {
        vcxprojText = fs.readFileSync(vcxprojPath, 'utf8');
    } catch (err) {
        vscode.window.showErrorMessage(`Could not read ${vcxprojPath}: ${err instanceof Error ? err.message : err}`);
        return;
    }
    if (!vcxprojDeclaresXboxPlatform(vcxprojText)) {
        vscode.window.showErrorMessage(
            `${path.basename(vcxprojPath)} doesn't look like an RXDK VS20XX project (no Debug|Xbox / ` +
                `Release|Xbox configuration found). RXDK Xbox projects declare that platform in ` +
                `Configuration Manager -- if this is meant to be one, re-add it from an RXDK project template.`
        );
        return;
    }

    const manifestPath = path.join(projectRoot, 'rxdk.project.json');
    if (fs.existsSync(manifestPath)) {
        const regen = await vscode.window.showWarningMessage(
            `rxdk.project.json already exists for ${projectName}. Regenerate it from the .vcxproj now? ` +
                `This overwrites the existing file with the current build settings (any hand edits to it will be lost).`,
            { modal: true },
            'Regenerate'
        );
        if (regen !== 'Regenerate') {
            return;
        }
    }

    const msbuild = await findMsBuildExe();
    if (!msbuild) {
        vscode.window.showErrorMessage(
            'Could not find MSBuild.exe (checked via vswhere). This import needs a Visual Studio ' +
                'install with MSBuild -- or use RXDK for Visual Studio\'s "Import VS20XX Project" instead.'
        );
        return;
    }

    output.show(true);
    output.appendLine(`RXDK: generating rxdk.project.json for ${projectName} from ${vcxprojPath}`);
    const result = await runStreamed(
        msbuild,
        [vcxprojPath, '/t:RxdkGenerateProjectJson', '/p:Platform=Xbox', '/p:Configuration=Release', '/nologo', '/v:minimal'],
        { output, cwd: projectRoot }
    );
    if (result.exitCode !== 0 || !fs.existsSync(manifestPath)) {
        vscode.window.showErrorMessage(
            `Could not generate rxdk.project.json for ${projectName} (MSBuild exit ${result.exitCode}). ` +
                `If the "Xbox" platform isn't installed, install RXDK for Visual Studio and run its ` +
                `Install Xbox Platform command first, then retry. See the RXDK output for details.`
        );
        return;
    }

    const doc = await vscode.workspace.openTextDocument(manifestPath);
    await vscode.window.showTextDocument(doc);

    const currentFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (currentFolder && path.resolve(currentFolder) === path.resolve(projectRoot)) {
        vscode.window.showInformationMessage(`Generated rxdk.project.json for ${projectName}.`);
        return;
    }
    const choice = await vscode.window.showInformationMessage(
        `Generated rxdk.project.json for ${projectName}.`,
        'Open in New Window',
        'Open Here'
    );
    if (!choice) {
        return;
    }
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(projectRoot), {
        forceNewWindow: choice === 'Open in New Window',
    });
}

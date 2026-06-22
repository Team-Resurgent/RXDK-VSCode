import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';

const execFileAsync = promisify(execFile);

export const DOTNET_MAJOR_VERSION = '8';
const RUNTIME_FRAMEWORK = 'Microsoft.NETCore.App';
const DOTNET_INSTALL_URL =
    process.platform === 'win32'
        ? 'https://dot.net/v1/dotnet-install.ps1'
        : 'https://dot.net/v1/dotnet-install.sh';

export function getDotNetInstallDir(): string {
    return path.join(os.homedir(), '.dotnet');
}

function dotnetExecutableCandidates(): string[] {
    const installDir = getDotNetInstallDir();
    const names =
        process.platform === 'win32' ? ['dotnet.exe'] : ['dotnet'];
    const candidates = names.map((name) => path.join(installDir, name));
    if (process.platform === 'win32') {
        const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
        candidates.push(path.join(programFiles, 'dotnet', 'dotnet.exe'));
    }
    return candidates;
}

async function resolveDotnetExecutable(): Promise<string | undefined> {
    try {
        await execFileAsync('dotnet', ['--version'], { windowsHide: true });
        return 'dotnet';
    } catch {
        /* fall through */
    }
    for (const candidate of dotnetExecutableCandidates()) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return undefined;
}

function hasDotNet8InRuntimeLines(lines: string[]): boolean {
    const prefix = `${RUNTIME_FRAMEWORK} ${DOTNET_MAJOR_VERSION}.`;
    return lines.some((line) => line.startsWith(prefix));
}

function hasDotNet8OnDisk(): boolean {
    const sharedRoots: string[] = [];
    const installDir = getDotNetInstallDir();
    sharedRoots.push(path.join(installDir, 'shared', RUNTIME_FRAMEWORK));

    if (process.platform === 'win32') {
        const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
        sharedRoots.push(path.join(programFiles, 'dotnet', 'shared', RUNTIME_FRAMEWORK));
    }

    for (const sharedRoot of sharedRoots) {
        if (!fs.existsSync(sharedRoot)) {
            continue;
        }
        for (const entry of fs.readdirSync(sharedRoot, { withFileTypes: true })) {
            if (entry.isDirectory() && entry.name.startsWith(`${DOTNET_MAJOR_VERSION}.`)) {
                return true;
            }
        }
    }
    return false;
}

export async function isDotNetRuntimeInstalled(): Promise<boolean> {
    const dotnet = await resolveDotnetExecutable();
    if (dotnet) {
        try {
            const { stdout } = await execFileAsync(dotnet, ['--list-runtimes'], {
                windowsHide: true,
            });
            if (hasDotNet8InRuntimeLines(stdout.split(/\r?\n/).filter(Boolean))) {
                return true;
            }
        } catch {
            /* fall through to disk check */
        }
    }
    return hasDotNet8OnDisk();
}

async function downloadFile(url: string, dest: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Download failed (${response.status}): ${url}`);
    }
    const data = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(dest, data);
}

async function ensureUserPathContains(dir: string): Promise<void> {
    if (process.platform === 'win32') {
        const escaped = dir.replace(/'/g, "''");
        await execFileAsync(
            'powershell',
            [
                '-NoProfile',
                '-Command',
                `$d='${escaped}';` +
                    '$p=[Environment]::GetEnvironmentVariable(' +
                    "'Path','User');" +
                    'if ($p -notlike "*$d*") {' +
                    "[Environment]::SetEnvironmentVariable('Path',\"$p;$d\",'User')" +
                    '}',
            ],
            { windowsHide: true }
        );
        return;
    }

    const profilePath = path.join(os.homedir(), '.profile');
    const marker = '# Added by RXDK VS Code extension';
    let profile = '';
    try {
        profile = fs.readFileSync(profilePath, 'utf8');
    } catch {
        /* new profile */
    }
    if (profile.includes(marker)) {
        return;
    }
    const block = [
        '',
        marker,
        `export DOTNET_ROOT="${dir}"`,
        'export PATH="$DOTNET_ROOT:$PATH"',
        '',
    ].join('\n');
    fs.appendFileSync(profilePath, block, 'utf8');
}

async function runDotNetInstallScript(scriptPath: string, installDir: string): Promise<void> {
    if (process.platform === 'win32') {
        await execFileAsync(
            'powershell',
            [
                '-NoProfile',
                '-ExecutionPolicy',
                'Bypass',
                '-File',
                scriptPath,
                '-Runtime',
                'dotnet',
                '-Channel',
                DOTNET_MAJOR_VERSION,
                '-InstallDir',
                installDir,
                '-Quality',
                'GA',
            ],
            { timeout: 600_000, windowsHide: true }
        );
        return;
    }

    fs.chmodSync(scriptPath, 0o755);
    await execFileAsync(
        scriptPath,
        [
            '--runtime',
            'dotnet',
            '--channel',
            DOTNET_MAJOR_VERSION,
            '--install-dir',
            installDir,
            '--quality',
            'GA',
        ],
        { timeout: 600_000 }
    );
}

export async function installDotNetRuntime(output?: vscode.OutputChannel): Promise<boolean> {
    const installDir = getDotNetInstallDir();
    const scriptName = process.platform === 'win32' ? 'dotnet-install.ps1' : 'dotnet-install.sh';
    const scriptPath = path.join(os.tmpdir(), `rxdk-${scriptName}`);

    output?.appendLine(`RXDK: downloading ${DOTNET_INSTALL_URL}`);
    await downloadFile(DOTNET_INSTALL_URL, scriptPath);

    output?.appendLine(`RXDK: installing .NET ${DOTNET_MAJOR_VERSION} runtime to ${installDir}`);
    await runDotNetInstallScript(scriptPath, installDir);
    await ensureUserPathContains(installDir);

    try {
        fs.unlinkSync(scriptPath);
    } catch {
        /* ignore */
    }

    if (!(await isDotNetRuntimeInstalled())) {
        throw new Error(
            `.NET ${DOTNET_MAJOR_VERSION} runtime was not detected after installation. Reload the window and try again.`
        );
    }

    output?.appendLine(`RXDK: .NET ${DOTNET_MAJOR_VERSION} runtime ready`);
    return true;
}

function autoInstallEnabled(context?: vscode.ExtensionContext): boolean {
    try {
        return vscode.workspace.getConfiguration('rxdk', null).get<boolean>('autoInstallDotNetRuntime', true);
    } catch {
        return true;
    }
}

async function runWithProgress<T>(message: string, task: () => Promise<T>): Promise<T> {
    return vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'RXDK',
            cancellable: false,
        },
        async (progress) => {
            progress.report({ message });
            return task();
        }
    );
}

/** Ensure .NET 8 runtime is present for managed host tools (xbcp, bridge, etc.). */
export async function ensureDotNetRuntime(
    context: vscode.ExtensionContext,
    output?: vscode.OutputChannel
): Promise<boolean> {
    if (await isDotNetRuntimeInstalled()) {
        output?.appendLine(`RXDK: .NET ${DOTNET_MAJOR_VERSION} runtime present`);
        return true;
    }

    output?.appendLine(`RXDK: .NET ${DOTNET_MAJOR_VERSION} runtime not found`);

    if (!autoInstallEnabled(context)) {
        const pick = await vscode.window.showWarningMessage(
            `RXDK host tools require the .NET ${DOTNET_MAJOR_VERSION} runtime.`,
            'Install now',
            'Open download page'
        );
        if (pick === 'Install now') {
            return installDotNetRuntimeWithUi(output);
        }
        if (pick === 'Open download page') {
            await vscode.env.openExternal(
                vscode.Uri.parse('https://dotnet.microsoft.com/download/dotnet/8.0')
            );
        }
        return false;
    }

    return installDotNetRuntimeWithUi(output);
}

async function installDotNetRuntimeWithUi(output?: vscode.OutputChannel): Promise<boolean> {
    try {
        await runWithProgress(`Installing .NET ${DOTNET_MAJOR_VERSION} runtime...`, () =>
            installDotNetRuntime(output)
        );
        vscode.window.showInformationMessage(
            `RXDK: .NET ${DOTNET_MAJOR_VERSION} runtime installed. Reload the window if deploy or debug tools still fail.`
        );
        return true;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        output?.appendLine(`RXDK: .NET runtime install failed: ${message}`);
        const pick = await vscode.window.showErrorMessage(
            `RXDK .NET ${DOTNET_MAJOR_VERSION} runtime install failed: ${message}`,
            'Open download page'
        );
        if (pick === 'Open download page') {
            await vscode.env.openExternal(
                vscode.Uri.parse('https://dotnet.microsoft.com/download/dotnet/8.0')
            );
        }
        return false;
    }
}

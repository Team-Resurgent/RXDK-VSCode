import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { downloadFileToPath, formatBytes, formatDownloadProgress, getDirectorySize } from './downloadFile';

const execFileAsync = promisify(execFile);

export const ZIG_VERSION = '0.16.0';
export const ZIG_DOWNLOAD_PAGE = 'https://ziglang.org/download/';

export function getZigInstallRoot(): string {
    if (process.platform === 'win32') {
        const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
        return path.join(localAppData, 'RXDK', 'zig');
    }
    if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'RXDK', 'zig');
    }
    const xdg = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
    return path.join(xdg, 'rxdk', 'zig');
}

function zigExecutableName(): string {
    return process.platform === 'win32' ? 'zig.exe' : 'zig';
}

function zigArchiveBaseName(): string | undefined {
    if (process.platform === 'win32') {
        return `zig-windows-x86_64-${ZIG_VERSION}`;
    }
    if (process.platform === 'linux') {
        return `zig-linux-x86_64-${ZIG_VERSION}`;
    }
    if (process.platform === 'darwin') {
        return process.arch === 'arm64'
            ? `zig-macos-aarch64-${ZIG_VERSION}`
            : `zig-macos-x86_64-${ZIG_VERSION}`;
    }
    return undefined;
}

function zigArchiveFileName(): string | undefined {
    const base = zigArchiveBaseName();
    if (!base) {
        return undefined;
    }
    return process.platform === 'win32' ? `${base}.zip` : `${base}.tar.xz`;
}

function installedZigCandidates(): string[] {
    const candidates: string[] = [];
    const root = getZigInstallRoot();
    const base = zigArchiveBaseName();
    if (base) {
        candidates.push(path.join(root, ZIG_VERSION, base, zigExecutableName()));
        candidates.push(path.join(root, ZIG_VERSION, zigExecutableName()));
    }
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return [candidate];
        }
    }
    return candidates;
}

/**
 * Resolve the Zig executable to use for a title build. Resolution order:
 *   1. explicit `override` (e.g. the `rxdk.zigPath` setting)
 *   2. `RXDK_ZIG` env (must point to an existing file)
 *   3. the RXDK-managed pinned install (ZIG_VERSION, downloaded by the prereq)
 *   4. `zig` on PATH (fallback only when the managed install is absent)
 *
 * The managed install is preferred over PATH deliberately: the SDK libraries are
 * built and tested against exactly ZIG_VERSION, and a different Zig on the user's
 * PATH ships a different Clang whose codegen/predefined macros can diverge (e.g.
 * predefining _DEBUG, which pulls in debug-only SDK symbols that the retail libs
 * don't export). A user who genuinely wants a different toolchain still has the
 * explicit rxdk.zigPath / RXDK_ZIG overrides above.
 */
export async function resolveZigExecutable(override?: string): Promise<string | undefined> {
    if (override) {
        const resolved = path.resolve(override);
        if (!fs.existsSync(resolved)) {
            throw new Error(`Zig not found: ${resolved}`);
        }
        return resolved;
    }
    const envOverride = process.env.RXDK_ZIG?.trim();
    if (envOverride) {
        const resolved = path.resolve(envOverride);
        if (!fs.existsSync(resolved)) {
            throw new Error(`RXDK_ZIG points to missing file: ${resolved}`);
        }
        return resolved;
    }
    for (const candidate of installedZigCandidates()) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    try {
        await execFileAsync('zig', ['version'], { windowsHide: true });
        return 'zig';
    } catch {
        /* no managed install and no PATH zig */
    }
    return undefined;
}

export async function isZigInstalled(): Promise<boolean> {
    return (await resolveZigExecutable()) !== undefined;
}

export async function getZigVersionLine(): Promise<string | undefined> {
    const zig = await resolveZigExecutable();
    if (!zig) {
        return undefined;
    }
    try {
        const { stdout } = await execFileAsync(zig, ['version'], { windowsHide: true });
        return stdout.trim().split(/\r?\n/)[0];
    } catch {
        return undefined;
    }
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
    const marker = '# Added by RXDK VS Code extension (Zig)';
    let profile = '';
    try {
        profile = fs.readFileSync(profilePath, 'utf8');
    } catch {
        /* new profile */
    }
    if (profile.includes(marker)) {
        return;
    }
    const block = ['', marker, `export PATH="${dir}:$PATH"`, ''].join('\n');
    fs.appendFileSync(profilePath, block, 'utf8');
}

export type ZigInstallProgress = (update: { message: string; percent?: number }) => void;

async function extractArchive(
    archivePath: string,
    destDir: string,
    onProgress?: ZigInstallProgress
): Promise<void> {
    fs.mkdirSync(destDir, { recursive: true });
    const archiveBytes = fs.statSync(archivePath).size;
    const expectedExpandedBytes = Math.round(archiveBytes * 2.5);
    const started = Date.now();
    let finished = false;

    const reportExtractProgress = (): void => {
        if (finished) {
            return;
        }
        const elapsedSec = Math.round((Date.now() - started) / 1000);
        void getDirectorySize(destDir).then((bytes) => {
            if (finished) {
                return;
            }
            const sizePct =
                expectedExpandedBytes > 0
                    ? Math.min(100, Math.round((bytes / expectedExpandedBytes) * 100))
                    : undefined;
            const percent =
                sizePct !== undefined ? 86 + Math.min(10, Math.round(sizePct * 0.1)) : 88;
            const sizeHint = bytes > 0 ? ` ${formatBytes(bytes)} extracted` : '';
            const timingHint =
                elapsedSec >= 30
                    ? ' — large archive; can take 1–3 minutes'
                    : elapsedSec >= 10
                      ? ' — still working'
                      : '';
            onProgress?.({
                message: `Extracting Zig archive…${sizeHint} (${elapsedSec}s${timingHint})`,
                percent,
            });
        });
    };

    const progressTimer = setInterval(reportExtractProgress, 1000);
    reportExtractProgress();

    try {
        await execFileAsync('tar', ['-xf', archivePath, '-C', destDir], {
            timeout: 600_000,
            windowsHide: true,
        });
    } finally {
        finished = true;
        clearInterval(progressTimer);
    }
}

export async function installZig(
    output?: vscode.OutputChannel,
    onProgress?: ZigInstallProgress
): Promise<boolean> {
    const archiveName = zigArchiveFileName();
    const archiveBase = zigArchiveBaseName();
    if (!archiveName || !archiveBase) {
        throw new Error(`Automatic Zig install is not supported on ${process.platform}/${process.arch}.`);
    }

    const url = `${ZIG_DOWNLOAD_PAGE}${ZIG_VERSION}/${archiveName}`;
    const installRoot = path.join(getZigInstallRoot(), ZIG_VERSION);
    const extractDir = path.join(installRoot, 'extract');
    const archivePath = path.join(os.tmpdir(), `rxdk-${archiveName}`);

    fs.mkdirSync(installRoot, { recursive: true });
    if (fs.existsSync(extractDir)) {
        fs.rmSync(extractDir, { recursive: true, force: true });
    }

    output?.appendLine(`RXDK: downloading Zig ${ZIG_VERSION} from ${url}`);
    onProgress?.({ message: `Downloading Zig ${ZIG_VERSION}…`, percent: 0 });

    let lastLoggedPercent = -1;
    await downloadFileToPath(url, archivePath, (progress) => {
        const message = formatDownloadProgress(progress.bytesReceived, progress.totalBytes);
        const percent =
            progress.percent !== undefined ? Math.min(85, Math.round(progress.percent * 0.85)) : undefined;
        onProgress?.({ message, percent });
        if (
            progress.percent !== undefined &&
            (progress.percent === 0 ||
                progress.percent >= lastLoggedPercent + 5 ||
                progress.percent === 100)
        ) {
            lastLoggedPercent = progress.percent;
            output?.appendLine(`RXDK: ${message}`);
        }
    });

    output?.appendLine(`RXDK: extracting Zig to ${installRoot}`);
    await extractArchive(archivePath, extractDir, onProgress);

    const nestedExe = path.join(extractDir, archiveBase, zigExecutableName());
    const flatExe = path.join(installRoot, zigExecutableName());
    const binDir = path.join(installRoot, archiveBase);
    if (fs.existsSync(nestedExe)) {
        if (fs.existsSync(binDir)) {
            fs.rmSync(binDir, { recursive: true, force: true });
        }
        fs.renameSync(path.join(extractDir, archiveBase), binDir);
    } else if (fs.existsSync(path.join(extractDir, zigExecutableName()))) {
        fs.copyFileSync(path.join(extractDir, zigExecutableName()), flatExe);
    } else {
        throw new Error('Zig archive did not contain the expected executable layout.');
    }

    fs.rmSync(extractDir, { recursive: true, force: true });
    try {
        fs.unlinkSync(archivePath);
    } catch {
        /* ignore */
    }

    const pathDir = fs.existsSync(binDir) ? binDir : path.dirname(flatExe);
    onProgress?.({ message: 'Updating PATH…', percent: 97 });
    await ensureUserPathContains(pathDir);

    if (!(await isZigInstalled())) {
        throw new Error(
            `Zig ${ZIG_VERSION} was not detected after installation. Reload the window and try again.`
        );
    }

    output?.appendLine(`RXDK: Zig ${ZIG_VERSION} ready`);
    onProgress?.({ message: `Zig ${ZIG_VERSION} ready`, percent: 100 });
    return true;
}

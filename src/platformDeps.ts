import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * True if `cmd` is on PATH. Uses `which` (present on Linux/macOS); on Windows we
 * never gate on this (the runtime installers there don't need curl/xz), so it
 * returns true.
 */
export async function commandExists(cmd: string): Promise<boolean> {
    if (process.platform === 'win32') {
        return true;
    }
    try {
        await execFileAsync('which', [cmd], { windowsHide: true });
        return true;
    } catch {
        return false;
    }
}

/**
 * Throw a clear, actionable error if none of `cmds` is installed. `purpose`
 * explains what needs it; `aptPackages` is the suggested install line.
 */
export async function requireOneOf(
    cmds: string[],
    purpose: string,
    aptPackages: string
): Promise<void> {
    for (const cmd of cmds) {
        if (await commandExists(cmd)) {
            return;
        }
    }
    const list = cmds.join(' or ');
    throw new Error(
        `${purpose} needs ${list}, which ${cmds.length > 1 ? 'are' : 'is'} not installed. ` +
            `Install it and retry, e.g. \`sudo apt install -y ${aptPackages}\` (or your distro's equivalent).`
    );
}

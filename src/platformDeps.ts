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
 * Package names for a missing dependency, per package manager. `apt` is the
 * Debian/Ubuntu package; `brew` is the Homebrew formula (defaults to `apt` when
 * the two share a name, e.g. `curl`).
 */
export interface DepPackages {
    apt: string;
    brew?: string;
}

/**
 * Throw a clear, actionable error if none of `cmds` is installed. `purpose`
 * explains what needs it; `packages` supplies the install hint tailored to the
 * current platform (Homebrew on macOS, apt on Linux).
 */
export async function requireOneOf(
    cmds: string[],
    purpose: string,
    packages: DepPackages
): Promise<void> {
    for (const cmd of cmds) {
        if (await commandExists(cmd)) {
            return;
        }
    }
    const list = cmds.join(' or ');
    const installHint =
        process.platform === 'darwin'
            ? `\`brew install ${packages.brew ?? packages.apt}\``
            : `\`sudo apt install -y ${packages.apt}\` (or your distro's equivalent)`;
    throw new Error(
        `${purpose} needs ${list}, which ${cmds.length > 1 ? 'are' : 'is'} not installed. ` +
            `Install it and retry, e.g. ${installHint}.`
    );
}

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { runStreamed } from './processRunner';
import { LaunchResult } from './xboxLaunch';

/** Default xemu launch parameters. `-serial stdio` on the lpc47m157 super-I/O routes the
 *  Xbox debug serial to xemu's stdout, which we stream as the title's console output. */
export const DEFAULT_XEMU_PARAMS = '-device lpc47m157 -serial stdio';

/** Split a parameter string into argv, honoring simple double-quoted groups. */
function splitParams(s: string): string[] {
    const out: string[] = [];
    const re = /"([^"]*)"|(\S+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) {
        out.push(m[1] !== undefined ? m[1] : m[2]);
    }
    return out;
}

/** True when rxdk.xemuPath points at an existing file — gates the launch UI. */
export function isXemuConfigured(): boolean {
    const p = vscode.workspace.getConfiguration('rxdk').get<string>('xemuPath')?.trim();
    return !!p && fs.existsSync(p);
}

export interface LaunchXemuOptions {
    isoPath: string;
    output: vscode.OutputChannel;
}

/**
 * Launch the compiled ISO in xemu (no debugging). xemu runs until the user closes it; its
 * stdout/stderr stream to the output channel, so with the default params the title's serial
 * console output shows up live in the RXDK output panel.
 */
export async function launchXemu(opts: LaunchXemuOptions): Promise<LaunchResult> {
    const cfg = vscode.workspace.getConfiguration('rxdk');

    const xemuPath = cfg.get<string>('xemuPath')?.trim();
    if (!xemuPath) {
        return { ok: false, error: 'No xemu path set — configure "rxdk.xemuPath" in Settings.' };
    }
    if (!fs.existsSync(xemuPath)) {
        return { ok: false, error: `xemu not found at: ${xemuPath}` };
    }
    if (!fs.existsSync(opts.isoPath)) {
        return { ok: false, error: `Built ISO not found: ${opts.isoPath} — build the project first.` };
    }

    const paramsStr = (cfg.get<string>('xemuParams') ?? '').trim() || DEFAULT_XEMU_PARAMS;
    const args = [...splitParams(paramsStr), '-dvd_path', opts.isoPath];

    opts.output.show(true);
    opts.output.appendLine(`Launching xemu: ${path.basename(opts.isoPath)}`);
    const result = await runStreamed(xemuPath, args, { output: opts.output });
    if (result.exitCode === 0) {
        return { ok: true };
    }
    return { ok: false, error: `xemu exited with code ${result.exitCode}` };
}

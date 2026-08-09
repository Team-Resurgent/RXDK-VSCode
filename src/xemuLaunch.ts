import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { LaunchResult } from './xboxLaunch';

/** Default xemu launch parameters. `-serial stdio` on the lpc47m157 super-I/O routes the
 *  Xbox debug serial to xemu's stdout, which shows up in the terminal the title runs in. */
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
 * Launch the compiled ISO in xemu (no debugging) inside an integrated terminal.
 *
 * xemu.exe is a GUI-subsystem binary: spawned with piped stdio it never wires its
 * stdout/stderr to the pipe, so "-serial stdio" (and xemu's own startup log) produced
 * nothing in a plain OutputChannel. Running it as the terminal's shell gives it a pty —
 * a real console — so the title's serial console and xemu's diagnostics appear live in
 * the terminal and stay readable after it exits.
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

    const name = `xemu: ${path.basename(opts.isoPath)}`;
    // Reuse an existing xemu terminal of the same name (dispose it so the log is cleared).
    vscode.window.terminals.filter(t => t.name === name).forEach(t => t.dispose());
    const terminal = vscode.window.createTerminal({
        name,
        shellPath: xemuPath,
        shellArgs: args,
        cwd: path.dirname(xemuPath),
    });
    terminal.show(true);
    opts.output.appendLine(`Launched xemu in terminal "${name}" — serial console + log appear there.`);
    return { ok: true };
}

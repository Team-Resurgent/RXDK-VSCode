import { spawn } from 'child_process';
import { withManagedDotnet } from './dotnetEnv';

/**
 * The subset of vscode.OutputChannel every pipeline module actually uses. Kept
 * structural (not `vscode.OutputChannel` itself) so `src/cli.ts` -- a plain Node
 * process with no `vscode` module available -- can pass a simple
 * console.log-backed object instead. A real OutputChannel already satisfies this.
 */
export interface OutputLike {
    appendLine(value: string): void;
}

export interface RunResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

export interface RunStreamedOptions {
    cwd?: string;
    output?: OutputLike;
}

/**
 * Spawn a process, streaming stdout/stderr to `output` line-by-line as it arrives
 * while also buffering the full text for the caller. Resolves (never rejects) with
 * the exit code on close -- interpreting the code is the caller's job, since some
 * of the tools this drives use non-zero exit codes for non-fatal conditions (e.g.
 * xbox-launch.exe returns 2 for "no console configured", not a real failure).
 * Rejects only if the process itself could not be spawned (e.g. ENOENT).
 */
export function runStreamed(
    command: string,
    args: string[],
    opts: RunStreamedOptions = {}
): Promise<RunResult> {
    return new Promise((resolve, reject) => {
        if (opts.output) {
            const shown = args.map((a) => (a.includes(' ') ? `"${a}"` : a));
            opts.output.appendLine(`$ ${command} ${shown.join(' ')}`);
        }

        // Host tools (imagebld, xbcp, …) are framework-dependent .NET apps; inject
        // DOTNET_ROOT/PATH so their apphost finds the extension-managed runtime.
        const proc = spawn(command, args, {
            cwd: opts.cwd,
            windowsHide: true,
            env: withManagedDotnet(process.env),
        });
        let stdout = '';
        let stderr = '';

        const pump = (chunk: Buffer, target: 'stdout' | 'stderr') => {
            const text = chunk.toString();
            if (target === 'stdout') {
                stdout += text;
            } else {
                stderr += text;
            }
            if (opts.output) {
                for (const line of text.split(/\r?\n/)) {
                    if (line.length > 0) {
                        opts.output.appendLine(line);
                    }
                }
            }
        };

        proc.stdout?.on('data', (chunk: Buffer) => pump(chunk, 'stdout'));
        proc.stderr?.on('data', (chunk: Buffer) => pump(chunk, 'stderr'));
        proc.on('error', reject);
        proc.on('close', (code) => {
            resolve({ exitCode: code ?? -1, stdout, stderr });
        });
    });
}

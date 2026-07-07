import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';
import * as readline from 'readline';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// Mirror of src/dotnetEnv.ts (this debug adapter compiles as an isolated tsc
// project with its own rootDir, so it can't import from src/). The bridge is a
// framework-dependent .NET app; without DOTNET_ROOT its apphost can't find the
// runtime the extension installs into ~/.dotnet, so F5 debug fails on macOS/Linux.
function withManagedDotnet(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const root = path.join(os.homedir(), '.dotnet');
    if (!fs.existsSync(path.join(root, 'shared', 'Microsoft.NETCore.App'))) {
        return base;
    }
    const env: NodeJS.ProcessEnv = { ...base };
    if (!env.DOTNET_ROOT) {
        env.DOTNET_ROOT = root;
    }
    return env;
}

export interface BridgeEvent {
    type: 'event' | 'result';
    event?: string;
    id?: number;
    success?: boolean;
    [key: string]: unknown;
}

function formatBridgeError(line: string, msg: BridgeEvent): string {
    const err = typeof msg.error === 'string' ? msg.error : '';
    const hints: Record<string, string> = {
        launchTimeout:
            'Timed out waiting for the title to stop at entry. The kit may be offline, the title may have crashed, or reboot took too long.',
        titleRebooted:
            'The title loaded but exited or rebooted to the dashboard before the debugger could stop at entry. Check DM_EXCEPTION/DM_DEBUGSTR in the bridge log.',
        pendingExec:
            'Could not reboot the devkit into pending-exec state (required for initial breakpoint).',
        initialBreakpoint:
            'DmSetInitialBreakpoint failed. The console must be in pending-exec before launch.',
        connectDebugger:
            'DmConnectDebugger failed. The title may not be debuggable (wrong module stopped, or crash).',
        memberNotFound:
            'Struct member not found in PDB. Expand the struct under Locals, or use a simple name like d3pp.SwapEffect.',
        symbolNotFound:
            'Symbol not found. Use exact PDB names (e.g. g_pD3D, d3pp.SwapEffect).',
        readFailed: 'Could not read Xbox memory at the resolved address.',
        installBreakpoint:
            'Line resolved but the devkit rejected the breakpoint (address not executable).',
        badAddress:
            'Breakpoint address is outside the loaded title image. Wait for launch to finish or set the BP again after the module loads.',
        hwBpFull:
            'Rare hardware-breakpoint fallback failed (Xbox allows 4 HW execute slots). Soft INT3 breakpoints should be used normally.',
        resolveLine: 'No PDB code mapping for that source line. Use a line with a statement.',
        stepTimeout:
            'Single-step did not complete in time. The bridge issued STOP to resync — press Step Over again.',
        go: 'Target is already running (prior step may have timed out). Use Stop, then Continue or Step again.',
        stillStopped:
            'Thread still stopped on the devkit. For launch: check bridge logs for stop reason. For Continue: try Stop, then Continue again.',
        continueThread: 'Could not CONTINUE the stopped thread on the devkit.',
    };
    const hint = hints[err];
    return hint ? `${hint} (${err})` : `bridge command failed: ${line}`;
}

export class BridgeClient extends EventEmitter {
    private proc: ChildProcessWithoutNullStreams | undefined;
    private nextId = 1;
    private pending = new Map<
        number,
        {
            resolve: (v: BridgeEvent) => void;
            reject: (e: Error) => void;
            timer: NodeJS.Timeout;
        }
    >();

    constructor(private readonly bridgePath: string) {
        super();
    }

    start(): void {
        if (this.proc) {
            return;
        }
        const bridgeDir = path.dirname(this.bridgePath);
        const sdkToolsDir = path.resolve(bridgeDir, '..');
        const pathSep = process.platform === 'win32' ? ';' : ':';
        const pathEnv = `${sdkToolsDir}${pathSep}${bridgeDir}${pathSep}${process.env.PATH || ''}`;
        this.proc = spawn(this.bridgePath, [], {
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
            cwd: bridgeDir,
            env: { ...withManagedDotnet(process.env), PATH: pathEnv },
        });
        const rl = readline.createInterface({ input: this.proc.stdout });
        rl.on('line', (line) => this.onLine(line));
        this.proc.stderr.on('data', (chunk: Buffer) => {
            this.emit('log', chunk.toString());
        });
        this.proc.on('exit', (code) => {
            this.emit('exit', code);
            this.proc = undefined;
        });
    }

    async shutdown(rebootDashboard = true): Promise<void> {
        if (!this.proc) {
            return;
        }
        try {
            await this.request('shutdown', { rebootDashboard }, 30000);
        } catch (e) {
            this.emit('log', `shutdown: ${(e as Error).message}\n`);
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
        this.proc?.kill();
        this.proc = undefined;
    }

    request(cmd: string, args: Record<string, unknown> = {}, timeoutMs = 180000): Promise<BridgeEvent> {
        if (!this.proc?.stdin) {
            return Promise.reject(new Error('bridge not started'));
        }
        const id = this.nextId++;
        const payload = JSON.stringify({ cmd, id, ...args });
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                if (this.pending.delete(id)) {
                    reject(new Error(`bridge command timed out: ${cmd}`));
                }
            }, timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            this.proc!.stdin!.write(payload + '\n');
        });
    }

    private settlePending(id: number, fn: (entry: { resolve: (v: BridgeEvent) => void; reject: (e: Error) => void }) => void): void {
        const entry = this.pending.get(id);
        if (!entry) {
            return;
        }
        clearTimeout(entry.timer);
        this.pending.delete(id);
        fn(entry);
    }

    private onLine(line: string): void {
        let msg: BridgeEvent;
        try {
            msg = JSON.parse(line) as BridgeEvent;
        } catch {
            this.emit('log', `bridge parse error: ${line}\n`);
            const idMatch = /"id"\s*:\s*(\d+)/.exec(line);
            if (idMatch) {
                const id = Number(idMatch[1]);
                this.settlePending(id, (p) =>
                    p.reject(new Error(`bridge returned invalid JSON for command id ${id}`))
                );
            }
            return;
        }
        if (msg.type === 'event') {
            this.emit('bridge-event', msg);
            return;
        }
        if (msg.type === 'result' && msg.id !== undefined) {
            this.settlePending(msg.id, (p) => {
                if (msg.success) {
                    p.resolve(msg);
                } else {
                    p.reject(new Error(formatBridgeError(line, msg)));
                }
            });
        }
    }
}

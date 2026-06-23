import { createWriteStream } from 'fs';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';

export interface DownloadProgress {
    bytesReceived: number;
    totalBytes?: number;
    percent?: number;
}

export function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    if (bytes < 1024 * 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDownloadProgress(bytesReceived: number, totalBytes?: number): string {
    if (totalBytes && totalBytes > 0) {
        const pct = Math.min(100, Math.round((bytesReceived / totalBytes) * 100));
        return `Downloading ${formatBytes(bytesReceived)} / ${formatBytes(totalBytes)} (${pct}%)`;
    }
    return `Downloading ${formatBytes(bytesReceived)}…`;
}

export async function downloadFileToPath(
    url: string,
    dest: string,
    onProgress?: (progress: DownloadProgress) => void
): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Download failed (${response.status}): ${url}`);
    }
    if (!response.body) {
        throw new Error(`Download failed: empty response body (${url})`);
    }

    const headerLength = Number(response.headers.get('content-length') ?? 0);
    const totalBytes = headerLength > 0 ? headerLength : undefined;
    let bytesReceived = 0;
    let lastReportedPercent = -1;
    let lastReportTime = 0;

    const report = (): void => {
        const now = Date.now();
        const percent =
            totalBytes && totalBytes > 0
                ? Math.min(100, Math.round((bytesReceived / totalBytes) * 100))
                : undefined;
        if (percent !== undefined) {
            if (percent === lastReportedPercent) {
                return;
            }
            lastReportedPercent = percent;
        } else if (now - lastReportTime < 250) {
            return;
        }
        lastReportTime = now;
        onProgress?.({ bytesReceived, totalBytes, percent });
    };

    const progressTransform = new Transform({
        transform(chunk, _encoding, callback) {
            bytesReceived += chunk.length;
            report();
            callback(null, chunk);
        },
    });

    await pipeline(Readable.fromWeb(response.body), progressTransform, createWriteStream(dest));
    onProgress?.({
        bytesReceived,
        totalBytes: totalBytes ?? bytesReceived,
        percent: 100,
    });
}

export async function getDirectorySize(dir: string): Promise<number> {
    if (!fs.existsSync(dir)) {
        return 0;
    }
    let total = 0;
    const stack = [dir];
    while (stack.length > 0) {
        const current = stack.pop()!;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(full);
            } else if (entry.isFile()) {
                try {
                    total += fs.statSync(full).size;
                } catch {
                    /* ignore */
                }
            }
        }
    }
    return total;
}

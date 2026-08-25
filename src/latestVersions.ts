import * as https from 'https';

// Best-effort "what's the newest published version" lookups, used only to show an "up to date" /
// "update available" hint in the prerequisites panel. Every call is bounded by a short timeout and
// resolves to undefined on any failure (offline, rate-limited, 404), so the panel never blocks or
// errors on them -- it just falls back to showing the installed version with no comparison.

const ORG = 'Team-Resurgent';

function fetchText(url: string, timeoutMs = 4000): Promise<string | undefined> {
    return new Promise((resolve) => {
        let settled = false;
        const done = (v?: string) => {
            if (!settled) {
                settled = true;
                resolve(v);
            }
        };
        const req = https.get(url, { headers: { 'User-Agent': 'rxdk-vscode' } }, (res) => {
            if (!res.statusCode || res.statusCode >= 300) {
                res.resume();
                done(undefined);
                return;
            }
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                data += chunk;
                if (data.length > 4096) {
                    req.destroy();
                    done(data);
                }
            });
            res.on('end', () => done(data));
        });
        req.on('error', () => done(undefined));
        req.setTimeout(timeoutMs, () => {
            req.destroy();
            done(undefined);
        });
    });
}

/**
 * Newest published version of a Team-Resurgent repo, read from its committed VERSION file on the
 * default branch (what a fresh clone / release would carry). Undefined if it can't be determined.
 */
export async function fetchLatestRepoVersion(repo: string): Promise<string | undefined> {
    for (const branch of ['main', 'master']) {
        const raw = await fetchText(`https://raw.githubusercontent.com/${ORG}/${repo}/${branch}/VERSION`);
        const v = raw?.split(/\r?\n/)[0]?.trim();
        if (v) {
            return v;
        }
    }
    return undefined;
}

/** Equal after trimming and stripping a leading 'v' (so "v1.0.7" == "1.0.7"). */
export function versionsMatch(a?: string, b?: string): boolean {
    if (!a || !b) {
        return false;
    }
    const norm = (s: string) => s.trim().replace(/^v/i, '');
    return norm(a) === norm(b);
}

/** Parse a dotted-numeric version (tolerating a leading 'v' and a -prerelease/+build tail). */
function parseVersion(s?: string): number[] | undefined {
    if (!s) {
        return undefined;
    }
    const core = s.trim().replace(/^v/i, '').match(/^\d+(?:\.\d+)*/)?.[0];
    if (!core) {
        return undefined;
    }
    return core.split('.').map((n) => parseInt(n, 10));
}

/**
 * True only when both parse and `a` is strictly newer than `b`. Fails safe: an unparseable input
 * never reads as newer, so a garbled version can't wrongly gate a component update.
 */
export function isVersionNewer(a?: string, b?: string): boolean {
    const va = parseVersion(a);
    const vb = parseVersion(b);
    if (!va || !vb) {
        return false;
    }
    const len = Math.max(va.length, vb.length);
    for (let i = 0; i < len; i++) {
        const d = (va[i] ?? 0) - (vb[i] ?? 0);
        if (d !== 0) {
            return d > 0;
        }
    }
    return false;
}

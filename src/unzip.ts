import * as zlib from 'zlib';

export interface ZipEntry {
    /** Path within the archive, forward-slash separated. */
    name: string;
    /** Uncompressed file contents. */
    data: Buffer;
}

const EOCD_SIG = 0x06054b50; // End Of Central Directory
const CDH_SIG = 0x02014b50; // Central Directory Header

/**
 * Minimal, dependency-free ZIP reader for the small tool archives shipped by the
 * RXDK-Tools / xdvdfs GitHub releases. Supports STORE (0) and DEFLATE (8), which
 * is all those archives use; no ZIP64. Deliberately spawns no external process
 * (no tar/unzip/PowerShell) so it works identically on Windows, macOS, and Linux.
 *
 * Sizes and the compression method are read from the central directory; the local
 * file header is used only to locate the compressed data (its own name/extra field
 * lengths), which is robust even when a data descriptor zeroes the local sizes.
 */
export function readZipEntries(zip: Buffer): ZipEntry[] {
    const eocd = findEocd(zip);
    const count = zip.readUInt16LE(eocd + 10);
    let ptr = zip.readUInt32LE(eocd + 16); // offset of first central directory record

    const entries: ZipEntry[] = [];
    for (let i = 0; i < count; i++) {
        if (zip.readUInt32LE(ptr) !== CDH_SIG) {
            throw new Error('Corrupt zip: bad central directory signature');
        }
        const method = zip.readUInt16LE(ptr + 10);
        const compSize = zip.readUInt32LE(ptr + 20);
        const nameLen = zip.readUInt16LE(ptr + 28);
        const extraLen = zip.readUInt16LE(ptr + 30);
        const commentLen = zip.readUInt16LE(ptr + 32);
        const localOffset = zip.readUInt32LE(ptr + 42);
        const name = zip.toString('utf8', ptr + 46, ptr + 46 + nameLen);
        ptr += 46 + nameLen + extraLen + commentLen;

        if (name.endsWith('/')) {
            continue; // directory entry
        }

        // Data starts after the LOCAL header, whose name/extra lengths may differ
        // from the central directory's.
        const localNameLen = zip.readUInt16LE(localOffset + 26);
        const localExtraLen = zip.readUInt16LE(localOffset + 28);
        const dataStart = localOffset + 30 + localNameLen + localExtraLen;
        const compData = zip.subarray(dataStart, dataStart + compSize);

        let data: Buffer;
        if (method === 0) {
            data = Buffer.from(compData);
        } else if (method === 8) {
            data = zlib.inflateRawSync(compData);
        } else {
            throw new Error(`Unsupported zip compression method ${method} for "${name}"`);
        }
        entries.push({ name: name.replace(/\\/g, '/'), data });
    }
    return entries;
}

function findEocd(zip: Buffer): number {
    // The EOCD sits at the end, optionally followed by a comment (max 0xFFFF).
    const minPos = Math.max(0, zip.length - (0xffff + 22));
    for (let i = zip.length - 22; i >= minPos; i--) {
        if (zip.readUInt32LE(i) === EOCD_SIG) {
            return i;
        }
    }
    throw new Error('Not a zip file (no End Of Central Directory record found)');
}

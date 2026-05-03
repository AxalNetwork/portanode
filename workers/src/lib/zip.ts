// Minimal ZIP encoder for Cloudflare Workers.
//
// We need to ship a ZIP of CSV files for the admin export bundle, but
// pulling jszip / @zip.js / fflate into the Worker bundle pushes us past
// budget — and the file count is small (≤ 10 entries, all under a few MB).
// This implementation writes a STORED (no compression) zip with CRC32 per
// entry, end-of-central-directory record, and proper local + central
// headers. It's a strict subset of PKZIP appnote.txt rev 6.3, sufficient
// for any reader that handles uncompressed archives (macOS Archive Utility,
// Finder, Windows Explorer, `unzip`, Excel CSV import via "open archive").
//
// Limitations: no compression, no zip64 (entries must be < 4 GB), no
// encryption, no multi-disk. Filenames must be ASCII (no UTF-8 flag set).

const enc = new TextEncoder();

// Pre-compute CRC32 table once per module load.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

interface PreparedEntry {
  nameBytes: Uint8Array;
  data: Uint8Array;
  crc: number;
  localHeaderOffset: number;
  // DOS-format date / time. We use a fixed 1980-01-01 timestamp because the
  // `uploaded` metadata on the R2 object is the source of truth for "when".
  modTime: number;
  modDate: number;
}

export interface ZipEntry {
  name: string;
  body: string | Uint8Array;
}

/** Build an in-memory ZIP archive from the given entries. Returns the
 *  complete archive bytes plus the total size for content-length. */
export function buildZip(entries: ZipEntry[]): Uint8Array {
  // Phase 1: prepare per-entry data with CRC + local header offsets.
  const prepared: PreparedEntry[] = [];
  let cursor = 0;
  for (const e of entries) {
    const data = typeof e.body === 'string' ? enc.encode(e.body) : e.body;
    const nameBytes = enc.encode(e.name);
    if (nameBytes.length > 0xffff) throw new Error('zip: filename too long');
    const crc = crc32(data);
    prepared.push({
      nameBytes,
      data,
      crc,
      localHeaderOffset: cursor,
      modTime: 0, // 00:00:00
      modDate: (1 << 5) | 1, // 1980-01-01 — fixed; R2 'uploaded' is the canonical timestamp
    });
    // Local file header is fixed 30 bytes + filename + (no extra) + data.
    cursor += 30 + nameBytes.length + data.length;
  }

  // Phase 2: write local file headers + data.
  const centralRecords: Uint8Array[] = [];
  const localChunks: Uint8Array[] = [];
  for (const p of prepared) {
    const local = new Uint8Array(30 + p.nameBytes.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true); // local file header signature
    dv.setUint16(4, 20, true); // version needed (2.0)
    dv.setUint16(6, 0, true); // flags
    dv.setUint16(8, 0, true); // method: 0 = stored
    dv.setUint16(10, p.modTime, true);
    dv.setUint16(12, p.modDate, true);
    dv.setUint32(14, p.crc, true);
    dv.setUint32(18, p.data.length, true); // compressed size = uncompressed
    dv.setUint32(22, p.data.length, true);
    dv.setUint16(26, p.nameBytes.length, true);
    dv.setUint16(28, 0, true); // extra field length
    local.set(p.nameBytes, 30);
    localChunks.push(local, p.data);

    // Matching central directory entry.
    const central = new Uint8Array(46 + p.nameBytes.length);
    const cdv = new DataView(central.buffer);
    cdv.setUint32(0, 0x02014b50, true); // central dir signature
    cdv.setUint16(4, 20, true); // version made by
    cdv.setUint16(6, 20, true); // version needed
    cdv.setUint16(8, 0, true);
    cdv.setUint16(10, 0, true); // method
    cdv.setUint16(12, p.modTime, true);
    cdv.setUint16(14, p.modDate, true);
    cdv.setUint32(16, p.crc, true);
    cdv.setUint32(20, p.data.length, true);
    cdv.setUint32(24, p.data.length, true);
    cdv.setUint16(28, p.nameBytes.length, true);
    cdv.setUint16(30, 0, true); // extra
    cdv.setUint16(32, 0, true); // comment
    cdv.setUint16(34, 0, true); // disk number start
    cdv.setUint16(36, 0, true); // internal attrs
    cdv.setUint32(38, 0, true); // external attrs
    cdv.setUint32(42, p.localHeaderOffset, true);
    central.set(p.nameBytes, 46);
    centralRecords.push(central);
  }

  // Phase 3: write central directory and end-of-central-directory record.
  const centralOffset = cursor;
  let centralSize = 0;
  for (const r of centralRecords) centralSize += r.length;

  const eocd = new Uint8Array(22);
  const edv = new DataView(eocd.buffer);
  edv.setUint32(0, 0x06054b50, true);
  edv.setUint16(4, 0, true);
  edv.setUint16(6, 0, true);
  edv.setUint16(8, prepared.length, true);
  edv.setUint16(10, prepared.length, true);
  edv.setUint32(12, centralSize, true);
  edv.setUint32(16, centralOffset, true);
  edv.setUint16(20, 0, true); // comment length

  // Phase 4: concatenate everything.
  const total = cursor + centralSize + 22;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of localChunks) {
    out.set(c, off);
    off += c.length;
  }
  for (const r of centralRecords) {
    out.set(r, off);
    off += r.length;
  }
  out.set(eocd, off);
  return out;
}

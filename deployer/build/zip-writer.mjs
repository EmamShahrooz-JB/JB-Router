/**
 * Store-only (uncompressed) zip writer — fallback for environments without the `zip` binary.
 * Only used by `make-bundle.mjs` when `zip` is not installed; the produced archive is bigger
 * (about 10 MB instead of 7 MB) but byte-for-byte valid for the browser-side reader.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

function crc32(bytes) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

export function zipSync(rootDir, relativePaths) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const rel of relativePaths) {
    const name = rel.split(path.sep).join("/");
    const data = new Uint8Array(readFileSync(path.join(rootDir, rel)));
    const nameBytes = encoder.encode(name);
    const crc = crc32(data);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);          // version needed
    lv.setUint16(6, 0, true);           // flags
    lv.setUint16(8, 0, true);           // method: stored
    lv.setUint16(10, 0, true);          // time
    lv.setUint16(12, 0x2821, true);     // date (2000-01-01)
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, data);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x2821, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);

    offset += localHeader.length + data.length;
  }

  const centralSize = centralParts.reduce((n, p) => n + p.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centralParts.length, true);
  ev.setUint16(10, centralParts.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  return Buffer.concat([...localParts, ...centralParts, end].map((p) => Buffer.from(p)));
}

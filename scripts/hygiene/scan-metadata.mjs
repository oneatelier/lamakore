#!/usr/bin/env node
/*
 * Metadata-hygiene scanner: rejects EXIF/XMP GPS, Author, Software, and
 * CreatorTool tags in committed images, and Author/Creator metadata in
 * PDFs. Video containers (mp4/mov/mkv/avi/webm) carry provider-specific
 * metadata this scanner cannot verify, so they fail closed as
 * unverifiable-video. Pure-JS TIFF/IFD + PNG/WebP chunk + PDF dictionary
 * parsing; CRCs are intentionally not validated.
 * Usage: scan-metadata.mjs [--root DIR] [--staged]
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileList } from './lib-files.mjs';

const HINT_STRIP = 'hint: strip metadata (e.g. exiftool -all= --icc_profile:all) and recommit';

function u16(buf, off, le) {
  return le ? buf.readUInt16LE(off) : buf.readUInt16BE(off);
}
function u32(buf, off, le) {
  return le ? buf.readUInt32LE(off) : buf.readUInt32BE(off);
}

function asciiAt(buf, valOff, le, off, count) {
  if (count <= 4) {
    const b = Buffer.alloc(4);
    if (le) b.writeUInt32LE(valOff, 0);
    else b.writeUInt32BE(valOff, 0);
    return b.subarray(0, count).toString('latin1').replace(/\0.*$/, '');
  }
  return buf.subarray(off, off + count).toString('latin1').replace(/\0.*$/, '');
}

/* Returns {artist, software, gps} found in a TIFF structure at base. */
function walkTiff(buf, base, out) {
  if (base + 8 > buf.length) return;
  const le = buf[base] === 0x49 && buf[base + 1] === 0x49;
  const be = buf[base] === 0x4d && buf[base + 1] === 0x4d;
  if (!le && !be) return;
  const little = le;
  if (u16(buf, base + 2, little) !== 42) return;
  let ifd = base + u32(buf, base + 4, little);
  if (ifd + 2 > buf.length) return;
  const n = u16(buf, ifd, little);
  for (let i = 0; i < n; i += 1) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > buf.length) break;
    const tag = u16(buf, e, little);
    const type = u16(buf, e + 2, little);
    const count = u32(buf, e + 4, little);
    const val = u32(buf, e + 8, little);
    if (tag === 0x013b && type === 2) out.artist = asciiAt(buf, val, little, base + val, count);
    if (tag === 0x0131 && type === 2) out.software = asciiAt(buf, val, little, base + val, count);
    if (tag === 0x8825) out.gps = true;
  }
}

function xmpFlags(text, out) {
  if (/GPSLatitude|GPSLongitude|exif:GPS/i.test(text)) out.gps = true;
  if (/xmp:CreatorTool|tiff:Software|dc:creator/i.test(text)) out.software = true;
}

function checkJpeg(buf, out) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return false;
  let pos = 2;
  while (pos + 4 <= buf.length) {
    if (buf[pos] !== 0xff) break;
    const marker = buf[pos + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const len = buf.readUInt16BE(pos + 2);
    if (len < 2 || pos + 2 + len > buf.length) break;
    const data = buf.subarray(pos + 4, pos + 2 + len);
    if (marker === 0xe1) {
      if (data.length > 6 && data.subarray(0, 6).toString('latin1') === 'Exif\0\0') {
        walkTiff(data, 6, out);
      } else if (data.toString('latin1').startsWith('http://ns.adobe.com/xap/1.0/')) {
        xmpFlags(data.toString('latin1'), out);
      }
    }
    pos += 2 + len;
  }
  return true;
}

function checkPng(buf, out) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(sig)) return false;
  let pos = 8;
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.subarray(pos + 4, pos + 8).toString('latin1');
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      const nul = data.indexOf(0);
      const keyword = (nul >= 0 ? data.subarray(0, nul) : data).toString('latin1').toLowerCase();
      if (/^(author|creator|software|creation time|gps|gpslatitude)/.test(keyword)) {
        if (/gps/.test(keyword)) out.gps = true;
        else if (/software/.test(keyword)) out.software = true;
        else out.artist = keyword;
      }
      if (type === 'iTXt' && data.toString('latin1').includes('XML:com.adobe.xmp')) {
        xmpFlags(data.toString('latin1'), out);
      }
    }
    if (type === 'IEND') break;
    pos += 12 + len;
  }
  return true;
}

function checkWebp(buf, out) {
  if (buf.length < 12 || buf.subarray(0, 4).toString() !== 'RIFF' || buf.subarray(8, 12).toString() !== 'WEBP') return false;
  let pos = 12;
  while (pos + 8 <= buf.length) {
    const fourcc = buf.subarray(pos, pos + 4).toString('latin1');
    const size = buf.readUInt32LE(pos + 4);
    const data = buf.subarray(pos + 8, pos + 8 + size);
    if (fourcc === 'EXIF') walkTiff(data, 0, out);
    if (fourcc === 'XMP ') xmpFlags(data.toString('latin1'), out);
    pos += 8 + size + (size % 2);
  }
  return true;
}

function checkPdf(text, out) {
  if (/\/(Author)\s*\(/.test(text)) out.artist = 'pdf-author';
  if (/\/(Creator)\s*\(/.test(text)) out.software = 'pdf-creator';
}

const VIDEO = new Set(['.mp4', '.mov', '.mkv', '.avi', '.webm']);

function main() {
  const args = process.argv.slice(2);
  const get = (f) => {
    const i = args.indexOf(f);
    return i >= 0 ? args[i + 1] : null;
  };
  const root = get('--root') ? path.resolve(get('--root')) : process.cwd();
  const staged = args.includes('--staged');
  let bad = 0;
  for (const rel of fileList(root, staged)) {
    const ext = path.extname(rel).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.webp', '.pdf', ...VIDEO].includes(ext)) continue;
    const abs = path.join(root, rel);
    if (VIDEO.has(ext)) {
      console.log(`${rel}:0 [unverifiable-video] container metadata cannot be verified; ${HINT_STRIP}`);
      bad += 1;
      continue;
    }
    let buf;
    try {
      buf = readFileSync(abs);
    } catch {
      continue;
    }
    const out = {};
    if (ext === '.pdf') checkPdf(buf.toString('latin1'), out);
    else if (ext === '.png') checkPng(buf, out);
    else if (ext === '.webp') checkWebp(buf, out);
    else checkJpeg(buf, out);
    if (out.gps) {
      console.log(`${rel}:0 [exif-gps] GPS metadata present; ${HINT_STRIP}`);
      bad += 1;
    }
    if (out.artist) {
      console.log(`${rel}:0 [exif-author] author tag present (${String(out.artist).slice(0, 40)}); ${HINT_STRIP}`);
      bad += 1;
    }
    if (out.software) {
      console.log(`${rel}:0 [exif-software] software/creator tag present; ${HINT_STRIP}`);
      bad += 1;
    }
  }
  if (bad > 0) {
    console.error(`metadata: ${bad} violation(s)`);
    process.exitCode = 1;
  } else {
    console.log('metadata: clean');
  }
}

main();

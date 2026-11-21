#!/usr/bin/env node
/*
 * Font-license gate: every font file under assets/fonts must be listed in
 * assets/fonts/fonts.json with a matching SHA256, live under a family dir
 * carrying the SIL OFL text, and use an approved extension. Anything else —
 * including Fontshare/ITF/FFL families, which are forbidden in the app and
 * forbidden self-hosted (app embedding needs a paid license) — fails.
 * Usage: check-fonts.mjs [--root DIR]
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const FONT_EXTS = new Set(['.ttf', '.otf', '.woff', '.woff2']);
const FORBIDDEN_RES = [/fontshare/i, /\bitf\b/i, /\bffl\b/i, /fontspring/i, /myfonts/i];

function sha256(abs) {
  return createHash('sha256').update(readFileSync(abs)).digest('hex');
}

function walkFonts(dir, base) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const abs = path.join(dir, entry);
    if (statSync(abs).isDirectory()) out.push(...walkFonts(abs, base));
    else if (FONT_EXTS.has(path.extname(entry).toLowerCase())) out.push(path.relative(base, abs).split(path.sep).join('/'));
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const get = (f) => {
    const i = args.indexOf(f);
    return i >= 0 ? args[i + 1] : null;
  };
  const root = get('--root') ? path.resolve(get('--root')) : process.cwd();
  const fontsDir = path.join(root, 'assets', 'fonts');
  const manifestPath = path.join(fontsDir, 'fonts.json');
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    console.error(`fonts: manifest missing at assets/fonts/fonts.json; hint: register every bundled font with its SHA256`);
    process.exitCode = 1;
    return;
  }
  let bad = 0;
  const listed = new Map();
  for (const fam of manifest.families || []) {
    if (fam.license !== 'OFL-1.1') {
      console.log(`fonts.json [license] family ${fam.name}: only OFL-1.1 may be bundled, got ${fam.license}`);
      bad += 1;
    }
    let oft = null;
    try {
      oft = readFileSync(path.join(fontsDir, fam.dir, 'OFL.txt'), 'utf8');
    } catch {
      oft = null;
    }
    if (!oft || !oft.includes('SIL OPEN FONT LICENSE')) {
      console.log(`${fam.dir}/OFL.txt [ofl-missing] OFL license text not bundled; hint: commit OFL.txt per family (ADR-005: ONLY OFL fonts may be bundled)`);
      bad += 1;
    }
    for (const f of fam.files || []) {
      listed.set(f.path, f.sha256);
      for (const re of FORBIDDEN_RES) {
        if (re.test(f.path) || re.test(fam.name)) {
          console.log(`${f.path} [forbidden-source] Fontshare/ITF/FFL families are forbidden; hint: use OFL families only`);
          bad += 1;
        }
      }
      let actual = null;
      try {
        actual = sha256(path.join(fontsDir, f.path));
      } catch {
        actual = null;
      }
      if (!actual || actual.toLowerCase() !== (f.sha256 || '').toLowerCase()) {
        console.log(`${f.path} [hash-mismatch] manifest SHA does not match disk; hint: re-run the manifest step, never hand-edit a hash`);
        bad += 1;
      }
    }
  }
  for (const found of walkFonts(fontsDir, fontsDir)) {
    if (!listed.has(found)) {
      console.log(`${found} [unlisted-font] font file not in fonts.json; hint: register it (with OFL proof) or delete it`);
      bad += 1;
    }
  }
  if (bad > 0) {
    console.error(`fonts: ${bad} violation(s)`);
    process.exitCode = 1;
  } else {
    console.log(`fonts: clean (${listed.size} files, ${(manifest.families || []).length} OFL families)`);
  }
}

main();

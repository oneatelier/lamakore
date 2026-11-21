#!/usr/bin/env node
/*
 * No-raw-hex lint: raw hex colors are banned in components — every color
 * comes from generated CSS custom properties or the frozen token object.
 * Generated token outputs are exempt by path (they carry hex by design).
 * Usage: no-raw-hex.mjs [--root DIR]
 * Exit 0 = clean, exit 1 = violations as file:line.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileList } from '../hygiene/lib-files.mjs';

const ROOTS = ['packages/ui/src', 'apps/desktop/src'];
const EXEMPT_RES = [/\/tokens\/generated\.(css|ts)$/];
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/;
const HINT = 'hint: use var(--token-name) or the generated token object instead of raw hex';

function main() {
  const args = process.argv.slice(2);
  const get = (f) => {
    const i = args.indexOf(f);
    return i >= 0 ? args[i + 1] : null;
  };
  const root = get('--root') ? path.resolve(get('--root')) : process.cwd();
  let bad = 0;
  for (const rel of fileList(root, false)) {
    const posix = rel.split(path.sep).join('/');
    if (!ROOTS.some((r) => posix === r || posix.startsWith(`${r}/`))) continue;
    if (EXEMPT_RES.some((re) => re.test(posix))) continue;
    if (!/\.(tsx?|jsx?|css|scss)$/.test(posix)) continue;
    let text;
    try {
      text = readFileSync(path.join(root, rel), 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\0')) continue;
    text.split('\n').forEach((line, i) => {
      const m = line.match(HEX_RE);
      if (m) {
        console.log(`${rel}:${i + 1} [raw-hex] ${m[0]}; ${HINT}`);
        bad += 1;
      }
    });
  }
  if (bad > 0) {
    console.error(`raw-hex: ${bad} violation(s)`);
    process.exitCode = 1;
  } else {
    console.log('raw-hex: clean');
  }
}

main();

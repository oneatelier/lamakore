#!/usr/bin/env node
/*
 * Placeholder / stub detector (P006): fails closed on unfinished-surface
 * markers in tracked text — TODO, FIXME, lorem, "coming soon", the p-word
 * for unfinished filler, `any` in TS (via the TS compiler API, so comments
 * and strings do not count), and unstyled default components in tsx/jsx.
 * deferred:#NNN markers pass only with a resolvable open issue.
 * History (docs/reports, docs/adr, CHANGELOG) and this script itself are
 * out of scope: history is immutable, and the rule must not flag its own
 * definition. No network is required; issue resolution uses a local
 * registry (artifacts/issues.json) or `gh` when present, and fails closed.
 * Usage: detect-placeholders.mjs [--root DIR]
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileList } from './hygiene/lib-files.mjs';

const HISTORY_RES = [/^docs\/reports\//, /^docs\/adr\//, /^CHANGELOG\.md$/];
const SELF = 'scripts/detect-placeholders.mjs';
const WORD_RES = [
  [/\bTODO\b/, 'todo-marker'],
  [/\bFIXME\b/, 'fixme-marker'],
  [/\blorem\b/i, 'lorem-filler'],
  [/coming soon/i, 'coming-soon-filler'],
  [/placeholder/i, 'unfinished-filler'],
];
const TS_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const JSX_EXTS = new Set(['.tsx', '.jsx']);
const COMPONENT_RE = /<(div|span|button|input|a|p|h1|h2|h3|h4|ul|li)\b(?![^>]*(className|style|class)=)[^>]*>/;
const DEFERRED_RE = /deferred:#(\d+)/g;
const HINT = 'hint: finish the surface, or convert to a tracked issue reference the validator can resolve';

const require = createRequire(import.meta.url);

function anyLinesViaScanner(abs, text) {
  // Token-stream analysis via the TS 7 scanner API: comments are trivia and
  // strings are string tokens, so neither can produce an AnyKeyword match.
  let ast;
  try {
    ast = require('typescript/unstable/ast');
  } catch {
    return { skipped: true, lines: [] };
  }
  const { createScanner, ScriptTarget, SyntaxKind } = ast;
  if (typeof createScanner !== 'function' || SyntaxKind.AnyKeyword === undefined) {
    return { skipped: true, lines: [] };
  }
  const scanner = createScanner(ScriptTarget.Latest, true);
  scanner.setText(text);
  const lines = [];
  let lastEnd = -1;
  for (let guard = 0; guard < text.length + 16; guard += 1) {
    const tok = scanner.scan();
    let end = -1;
    try {
      end = scanner.getTokenEnd();
    } catch {
      break;
    }
    if (tok === SyntaxKind.EndOfFileToken || end <= lastEnd) break;
    lastEnd = end;
    if (tok === SyntaxKind.AnyKeyword) {
      let pos = end;
      try {
        pos = typeof scanner.getStartPos === 'function' ? scanner.getStartPos() : end;
      } catch {
        pos = end;
      }
      lines.push(text.slice(0, pos).split('\n').length);
    }
  }
  return { skipped: false, lines };
}

function resolveIssue(num) {
  try {
    const reg = JSON.parse(readFileSync(path.join(process.cwd(), 'artifacts', 'issues.json'), 'utf8'));
    const hit = (reg.issues || []).find((i) => String(i.number) === String(num));
    if (hit && hit.state === 'open') return true;
    return false;
  } catch {
    /* no local registry; try gh */
  }
  try {
    const state = execSync(`gh issue view ${num} --json state -q .state`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000,
    }).trim();
    return state === 'OPEN';
  } catch {
    return false;
  }
}

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
    if (posix === SELF) continue;
    if (HISTORY_RES.some((re) => re.test(posix))) continue;
    let text;
    try {
      text = readFileSync(path.join(root, rel), 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\0')) continue;
    const ext = path.extname(rel).toLowerCase();
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      for (const [re, label] of WORD_RES) {
        if (re.test(line)) {
          console.log(`${rel}:${i + 1} [${label}] ${line.trim().slice(0, 100)}; ${HINT}`);
          bad += 1;
          break;
        }
      }
      if (JSX_EXTS.has(ext) && COMPONENT_RE.test(line)) {
        console.log(`${rel}:${i + 1} [unstyled-component] ${line.trim().slice(0, 100)}; ${HINT}`);
        bad += 1;
      }
      for (const m of line.matchAll(DEFERRED_RE)) {
        if (!resolveIssue(m[1])) {
          console.log(`${rel}:${i + 1} [deferred-unresolved] deferred:#${m[1]} has no resolvable open issue; ${HINT}`);
          bad += 1;
        }
      }
    });
    if (TS_EXTS.has(ext)) {
      const { skipped, lines: anyHits } = anyLinesViaScanner(rel, text);
      if (skipped) {
        console.log(`${rel}:0 [ts-unavailable] typescript compiler not installed; cannot scan \`any\`; hint: pnpm add -D typescript`);
        bad += 1;
      } else {
        for (const ln of anyHits) {
          console.log(`${rel}:${ln} [explicit-any] explicit \`any\` type; hint: type it or use unknown`);
          bad += 1;
        }
      }
    }
  }
  if (bad > 0) {
    console.error(`placeholders: ${bad} violation(s)`);
    process.exitCode = 1;
  } else {
    console.log('placeholders: clean');
  }
}

main();

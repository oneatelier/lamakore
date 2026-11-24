#!/usr/bin/env node
/*
 * Placeholder / stub detector (P006): fails closed on unfinished-surface
 * markers in tracked text — TODO, FIXME, lorem, "coming soon", the p-word
 * for unfinished filler, `any` in TS (via the TypeScript 5 compiler AST,
 * so comments and strings do not count), and unstyled default components
 * in tsx/jsx. deferred:#NNN markers pass only with a resolvable open issue.
 * History (docs/reports, docs/adr, CHANGELOG) and this script itself are
 * out of scope: history is immutable, and the rule must not flag its own
 * definition. No network is required; issue resolution uses a local
 * registry (artifacts/issues.json) or `gh` when present, and fails closed.
 * Usage: detect-placeholders.mjs [--root DIR] [--staged] [--any-only]
 * (--any-only runs just the explicit-`any` AST rule; that is the blocking
 * CI step in ci.yml, while the word rules stay advisory until their known
 * false positives on genuine `placeholder=` input attributes are resolved).
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileList } from './hygiene/lib-files.mjs';

const HISTORY_RES = [/^docs\/reports\//, /^docs\/adr\//, /^CHANGELOG\.md$/];
const SELF = 'scripts/detect-placeholders.mjs';
// A linter must not flag its own name: lines naming this script (its CI
// invocation, docs pointers) trip the naive p-word rule by construction
// and cannot be reworded away — the path is functional. Word rules skip
// such lines; the AST rule, deferred validation, and unstyled-component
// checks still apply to them. (The P025 spec directory was renamed to
// tests/explicit-any/ instead — rewording wins wherever the name is
// prose rather than functional.)
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

function anyLinesViaAst(rel, text) {
  // Real AST detector (D1 fix, P025): walk the TypeScript 5 compiler AST
  // for AnyKeyword nodes. Comments are trivia and strings are literal
  // tokens — neither can produce an AnyKeyword node, so both are ignored
  // by construction. Every type position is covered because the walk is
  // structural: annotations, generics, unions/intersections, arrays,
  // tuples, `as`/`satisfies`, angle assertions, return types, aliases,
  // conditional/infer fallbacks.
  //
  // Why the typescript5 alias instead of the installed typescript@7:
  // TS 7 no longer ships a stable parser entry — `require('typescript')`
  // exposes only { version, versionMajorMinor }; parsing lives behind
  // `typescript/unstable/*`, which exposes a scanner but no
  // createSourceFile (verified 2026-11-24). The old token-stream check was
  // built on that unstable surface. typescript5@npm:typescript@5.9.3 is
  // the last stable compiler API with createSourceFile/forEachChild, and
  // typescript-eslint 8.74 (tried first) hard-requires TS <6.1 as a peer
  // and crashes on TS 7 (`ts.Extension` undefined). The alias is pinned
  // exact in devDependencies and used ONLY by this scanner — the build
  // still compiles with TS 7 (tsc --strict stays the implicit-any backstop;
  // this rule is the explicit-any gate).
  let ts;
  try {
    ts = require('typescript5');
  } catch {
    return { skipped: true, lines: [] };
  }
  const kind = rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  let sf;
  try {
    sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, kind);
  } catch {
    return { skipped: false, parseError: true, lines: [] };
  }
  if ((sf.parseDiagnostics || []).length > 0) {
    return { skipped: false, parseError: true, lines: [] };
  }
  const lines = [];
  (function walk(node) {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      lines.push(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1);
    }
    ts.forEachChild(node, walk);
  })(sf);
  return { skipped: false, lines };
}

function resolveIssue(num, root) {
  try {
    const reg = JSON.parse(readFileSync(path.join(root, 'artifacts', 'issues.json'), 'utf8'));
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
      cwd: root,
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
  const staged = args.includes('--staged');
  const anyOnly = args.includes('--any-only');
  let bad = 0;

  function checkAny(rel, text) {
    const { skipped, parseError, lines: anyHits } = anyLinesViaAst(rel, text);
    if (skipped) {
      console.log(`${rel}:0 [ts-unavailable] typescript5 parser not installed; cannot scan \`any\`; hint: pnpm install`);
      bad += 1;
    } else if (parseError) {
      console.log(`${rel}:0 [ts-parse-error] could not parse TypeScript; failing closed; hint: run pnpm typecheck for the syntax error`);
      bad += 1;
    } else {
      const lines = text.split('\n');
      for (const ln of anyHits) {
        // Only exemption: a deferred:#NNN marker on the SAME line that
        // resolves to an open issue (fail closed otherwise — the
        // deferred-unresolved rule fires separately in full mode).
        const lineText = lines[ln - 1] || '';
        const markers = [...lineText.matchAll(DEFERRED_RE)].map((m) => m[1]);
        if (markers.length > 0 && markers.every((n) => resolveIssue(n, root))) continue;
        console.log(`${rel}:${ln} [explicit-any] explicit \`any\` type; hint: type it or use unknown`);
        bad += 1;
      }
    }
  }

  for (const rel of fileList(root, staged)) {
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
    if (anyOnly) {
      if (TS_EXTS.has(ext)) checkAny(rel, text);
      continue;
    }
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      const namesSelf = line.includes('detect-placeholders.mjs');
      for (const [re, label] of WORD_RES) {
        if (!namesSelf && re.test(line)) {
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
        if (!resolveIssue(m[1], root)) {
          console.log(`${rel}:${i + 1} [deferred-unresolved] deferred:#${m[1]} has no resolvable open issue; ${HINT}`);
          bad += 1;
        }
      }
    });
    if (TS_EXTS.has(ext)) {
      checkAny(rel, text);
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

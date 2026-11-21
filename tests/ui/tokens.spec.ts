// Token sync gate: generated CSS and TS must match design-tokens.json exactly,
// and the no-raw-hex lint must fail on a planted fixture while passing here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DURATIONS, EASINGS, RADII, SPACING, THEMES } from '../../packages/ui/src/tokens/generated.ts';

const SPEC_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SPEC_DIR, '..', '..');
const NODE = process.execPath;

function runCli(script: string, args: string[]): { exit: number; output: string } {
  try {
    const out = execFileSync(NODE, [script, ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { exit: 0, output: String(out) };
  } catch (e) {
    const err = e as { status?: number; stdout?: unknown; stderr?: unknown };
    return { exit: err.status ?? 1, output: `${String(err.stdout ?? '')}\n${String(err.stderr ?? '')}` };
  }
}

test('generated CSS carries every JSON color under the right theme', () => {
  const json = JSON.parse(readFileSync(path.join(ROOT, 'artifacts', 'design-tokens.json'), 'utf8'));
  const css = readFileSync(path.join(ROOT, 'packages', 'ui', 'src', 'tokens', 'generated.css'), 'utf8');
  for (const [theme, def] of Object.entries(json.themes) as Array<[string, { colors: Record<string, { hex: string }> } ]>) {
    const block = css.split(`[data-theme="${theme}"]`)[1];
    assert.ok(block !== undefined, `missing theme block for ${theme}`);
    const scoped = theme === 'brass-void' ? css : block.split('[data-theme=')[0];
    for (const [key, val] of Object.entries(def.colors)) {
      assert.ok(scoped.includes(`--${key}: ${val.hex};`), `CSS missing ${theme} --${key}: ${val.hex}`);
    }
  }
});

test('generated TS matches the JSON source', () => {
  const json = JSON.parse(readFileSync(path.join(ROOT, 'artifacts', 'design-tokens.json'), 'utf8'));
  for (const [theme, def] of Object.entries(json.themes) as Array<[string, { kind: string; label: string; colors: Record<string, { hex: string }> } ]>) {
    const gen = (THEMES as Record<string, { kind: string; label: string; colors: Record<string, string> }>)[theme];
    assert.ok(gen, `TS missing theme ${theme}`);
    assert.equal(gen.kind, def.kind);
    assert.equal(gen.label, def.label);
    for (const [key, val] of Object.entries(def.colors)) {
      assert.equal(gen.colors[key], val.hex, `TS mismatch ${theme}.${key}`);
    }
  }
  assert.deepEqual({ ...RADII }, json.radii);
  assert.deepEqual({ ...SPACING }, json.spacing);
  assert.deepEqual({ ...DURATIONS }, json.motion.durations);
  assert.deepEqual({ ...EASINGS }, json.motion.easings);
  assert.ok(Object.isFrozen(THEMES), 'THEMES must be frozen');
});

test('no-raw-hex fails on a planted fixture and passes here', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'token-hex-'));
  mkdirSync(path.join(dir, 'packages', 'ui', 'src'), { recursive: true });
  writeFileSync(path.join(dir, 'packages', 'ui', 'src', 'widget.css'), '.a { color:#ff0000; }\n');
  const bad = runCli(path.join(ROOT, 'scripts', 'lint', 'no-raw-hex.mjs'), ['--root', dir]);
  assert.notEqual(bad.exit, 0, 'lint should fail on planted raw hex');
  assert.match(bad.output, /raw-hex/);
  const good = runCli(path.join(ROOT, 'scripts', 'lint', 'no-raw-hex.mjs'), ['--root', ROOT]);
  assert.equal(good.exit, 0, `lint should pass on the real tree:\n${good.output}`);
});

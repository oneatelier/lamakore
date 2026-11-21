#!/usr/bin/env node
/*
 * Artifact registry validator (P006): schema + cross-reference checks over
 * artifacts/. Fails non-zero with the offending file:line. Also prints the
 * true priority counts and DAG stats for the report — counts are computed
 * from the rows, never copied from prose.
 * Usage: validate-artifacts.mjs [--root DIR]
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

let failures = 0;
function fail(msg) {
  console.log(`FAIL: ${msg}`);
  failures += 1;
}
function ok(msg) {
  console.log(`ok: ${msg}`);
}

function parseCsv(rel, text) {
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const header = lines[0].split(',');
  const rows = [];
  lines.slice(1).forEach((line, i) => {
    if (line.trim() === '') return;
    const cols = line.split(',');
    if (cols.length !== header.length) {
      fail(`${rel}:${i + 2} field count ${cols.length} != header ${header.length}`);
      return;
    }
    const row = {};
    header.forEach((h, j) => {
      row[h] = cols[j];
    });
    rows.push(row);
  });
  return { header, rows };
}

function main() {
  const args = process.argv.slice(2);
  const get = (f) => {
    const i = args.indexOf(f);
    return i >= 0 ? args[i + 1] : null;
  };
  const root = get('--root') ? path.resolve(get('--root')) : process.cwd();
  const art = (f) => readFileSync(path.join(root, 'artifacts', f), 'utf8');

  // ---- features.csv ----
  const feat = parseCsv('features.csv', art('features.csv'));
  const domains = {};
  const pris = { P0: 0, P1: 0, P2: 0 };
  const owners = new Set();
  feat.rows.forEach((r, i) => {
    const ln = `features.csv:${i + 2}`;
    domains[r.domain] = (domains[r.domain] || 0) + 1;
    if (!['P0', 'P1', 'P2'].includes(r.priority)) fail(`${ln} bad priority ${r.priority}`);
    else pris[r.priority] += 1;
    if (!['XS', 'S', 'M', 'L', 'XL'].includes(r.effort)) fail(`${ln} bad effort ${r.effort}`);
    if (!['foundation', 'build', 'polish'].includes(r.phase)) fail(`${ln} bad phase ${r.phase}`);
    if (!['native', 'adapter'].includes(r.native_or_adapter)) fail(`${ln} bad native_or_adapter ${r.native_or_adapter}`);
    if (!/^P\d{3}$/.test(r.owner_prompt)) fail(`${ln} bad owner_prompt ${r.owner_prompt}`);
    owners.add(r.owner_prompt);
  });
  const wantDomains = { code: 9, browse: 9, os: 6, orchestration: 9, memory: 7, models: 8, platform: 11, enterprise: 6 };
  for (const [d, n] of Object.entries(wantDomains)) {
    if ((domains[d] || 0) !== n) fail(`features.csv domain ${d}: got ${domains[d] || 0}, want ${n}`);
  }
  if (feat.rows.length !== 65) fail(`features.csv: got ${feat.rows.length} rows, want 65`);
  else ok(`features.csv: 65 rows, domains exact`);
  console.log(`counts: P0=${pris.P0} P1=${pris.P1} P2=${pris.P2} (recounted from rows)`);

  // ---- prompt-seed.json ----
  const seed = JSON.parse(art('prompt-seed.json'));
  const ids = new Set(seed.map((p) => p.id));
  if (seed.length !== 130) fail(`prompt-seed.json: got ${seed.length} entries, want 130`);
  for (let i = 0; i <= 129; i += 1) {
    if (!ids.has(`P${String(i).padStart(3, '0')}`)) fail(`prompt-seed.json: missing P${String(i).padStart(3, '0')}`);
  }
  const dependents = new Map();
  for (const p of seed) {
    for (const d of p.deps || []) {
      if (!ids.has(d)) fail(`prompt-seed.json: ${p.id} depends on missing ${d}`);
      if (!dependents.has(d)) dependents.set(d, []);
      dependents.get(d).push(p.id);
    }
    if (!/^(feat|fix|chore|docs|ci|refactor|test|revert)\(P\d{3}\): .+/.test(p.commit_message)) {
      fail(`prompt-seed.json: ${p.id} bad commit_message ${p.commit_message}`);
    }
  }
  // Acyclicity via Kahn's algorithm.
  const indeg = new Map(seed.map((p) => [p.id, 0]));
  const adj = new Map(seed.map((p) => [p.id, []]));
  for (const p of seed) {
    for (const d of p.deps || []) {
      adj.get(d).push(p.id);
      indeg.set(p.id, indeg.get(p.id) + 1);
    }
  }
  const queue = [...indeg.entries()].filter(([, n]) => n === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length > 0) {
    const cur = queue.pop();
    visited += 1;
    for (const nx of adj.get(cur)) {
      indeg.set(nx, indeg.get(nx) - 1);
      if (indeg.get(nx) === 0) queue.push(nx);
    }
  }
  if (visited !== seed.length) fail('prompt-seed.json: dependency cycle detected');
  else ok('prompt-seed.json: 130 entries, DAG acyclic');
  const forks = seed.filter((p) => (p.deps || []).length >= 2).length;
  const joins = [...dependents.values()].filter((xs) => xs.length >= 2).length;
  if (forks === 0 || joins === 0) fail(`prompt-seed.json: linear chain (forks=${forks}, joins=${joins})`);
  else ok(`prompt-seed.json: real DAG (multi-dep prompts=${forks}, multi-dependent prompts=${joins})`);

  // Every prompt owns >=1 capability or is infrastructure-labelled.
  const infra = new Set(['chore', 'ci', 'docs']);
  for (const p of seed) {
    const type = p.commit_message.split('(')[0];
    if (!owners.has(p.id) && !infra.has(type)) {
      fail(`prompt-seed.json: ${p.id} (${type}) owns no feature and is not infrastructure-labelled`);
    }
  }
  ok('prompt-seed.json: every prompt owns a capability or is infrastructure');

  // ---- risk-register.csv ----
  const risk = parseCsv('risk-register.csv', art('risk-register.csv'));
  if (risk.rows.length !== 42) fail(`risk-register.csv: got ${risk.rows.length} rows, want 42`);
  risk.rows.forEach((r, i) => {
    const ln = `risk-register.csv:${i + 2}`;
    const l = Number(r.likelihood);
    const im = Number(r.impact);
    const s = Number(r.severity);
    if (![1, 2, 3, 4, 5].includes(l) || ![1, 2, 3, 4, 5].includes(im)) fail(`${ln} likelihood/impact out of 1..5`);
    if (s !== l * im) fail(`${ln} severity ${r.severity} != likelihood*impact (${l}*${im})`);
  });
  if (risk.rows.length === 42) ok('risk-register.csv: 42 rows, all severity == likelihood*impact');

  // ---- vision-rubric.json ----
  const rubric = JSON.parse(art('vision-rubric.json'));
  const weights = Object.values(rubric.pillars || {}).map((p) => p.weight);
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum !== 100) fail(`vision-rubric.json: weights sum to ${sum}, want exactly 100`);
  else ok('vision-rubric.json: weights sum to exactly 100');
  const wantPillars = ['capability_superset', 'visual_excellence', 'engineering_integrity', 'security_posture', 'performance', 'openness_trust', 'anonymity_hygiene'];
  for (const pl of wantPillars) {
    const p = (rubric.pillars || {})[pl];
    if (!p) {
      fail(`vision-rubric.json: missing pillar ${pl}`);
      continue;
    }
    for (const a of ['0', '50', '75', '100']) {
      if (!p.anchors || !p.anchors[a] || !p.anchors[a].evidence) {
        fail(`vision-rubric.json: pillar ${pl} anchor ${a} missing required evidence`);
      }
    }
  }
  if (!rubric.hard_rules || rubric.hard_rules.length < 2) fail('vision-rubric.json: hard rules missing');
  else ok('vision-rubric.json: 7 pillars anchored with evidence + hard rules');

  // ---- competitors / naming / pricing / roadmap ----
  const comp = JSON.parse(art('competitors.json'));
  if (!Array.isArray(comp) || comp.length !== 10) fail(`competitors.json: got ${Array.isArray(comp) ? comp.length : 'non-array'}, want 10`);
  else ok('competitors.json: 10 canonical entries');
  const roadmap = JSON.parse(art('roadmap.json'));
  const rc = roadmap.priority_counts || {};
  if (rc.P0 !== pris.P0 || rc.P1 !== pris.P1 || rc.P2 !== pris.P2) {
    fail(`roadmap.json counts P0=${rc.P0}/P1=${rc.P1}/P2=${rc.P2} != recounted P0=${pris.P0}/P1=${pris.P1}/P2=${pris.P2}`);
  } else ok('roadmap.json: priority counts match the recount');
  const pricing = JSON.parse(art('pricing.json'));
  if (!pricing.open || !pricing.commercial) fail('pricing.json: needs open + commercial sections');
  else ok('pricing.json: open + commercial sections present');
  const naming = parseCsv('naming-matrix.csv', art('naming-matrix.csv'));
  if (naming.rows.length === 0) fail('naming-matrix.csv: empty');
  naming.rows.forEach((r, i) => {
    if (!r.candidate || !r.verdict || !r.reason || !r.evidence) fail(`naming-matrix.csv:${i + 2} incomplete row`);
  });
  if (failures === 0) ok('naming-matrix.csv: all rows complete');

  console.log(failures === 0 ? 'artifacts: ALL CHECKS PASSED' : `artifacts: ${failures} FAILURE(S)`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main();

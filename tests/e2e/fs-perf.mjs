// fs tool perf: cold start (spawn -> ready), cored idle RSS, and
// fs.list / fs.read round-trip p50/p95/mean over one warm connection.
// Usage: node tests/e2e/fs-perf.mjs
// Prints a markdown table (captured verbatim into the report) and writes
// artifacts/perf-fs-<platform>.json.
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SPEC_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SPEC_DIR, '..', '..');
const IS_WIN = process.platform === 'win32';

function daemonCandidates() {
  const exe = IS_WIN ? 'cored.exe' : 'cored';
  return [
    path.join('D:', 't', 'x86_64-pc-windows-gnu', 'debug', exe),
    path.join(ROOT, 'target', 'x86_64-pc-windows-gnu', 'debug', exe),
    path.join(ROOT, 'target', 'debug', exe),
  ];
}

function daemonPath() {
  for (const c of daemonCandidates()) if (existsSync(c)) return c;
  throw new Error('cored binary missing: build first (see fs-tools.spec.ts)');
}

function frame(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length, 0);
  return Buffer.concat([head, body]);
}

function rssKb(pid) {
  try {
    if (IS_WIN) {
      const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
      const m = out.match(/","([\d,]+) K"/);
      return m ? Number(m[1].replace(/,/g, '')) : null;
    }
    const out = execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' });
    const n = Number(out.trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, i)];
}

function mean(xs) {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

async function main() {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'fs-perf-home-'));
  const extraEnv = IS_WIN ? { APPDATA: homeDir } : { HOME: homeDir, XDG_DATA_HOME: homeDir };
  const token = randomBytes(16).toString('hex');
  const sock = IS_WIN
    ? `\\\\.\\pipe\\wire-fs-perf-${randomBytes(4).toString('hex')}`
    : path.join(tmpdir(), `wire-fs-perf-${randomBytes(4).toString('hex')}.sock`);

  const t0 = Date.now();
  const proc = spawn(daemonPath(), ['--socket', sock], {
    env: { ...process.env, PONE_WIRE_TOKEN: token, ...extraEnv },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const readyLine = await new Promise((resolve, reject) => {
    let out = '';
    const t = setTimeout(() => reject(new Error('daemon never became ready')), 60000);
    proc.stdout.on('data', (d) => {
      out += d.toString('utf8');
      const line = out.split('\n').find((l) => l.startsWith('ready '));
      if (line) {
        clearTimeout(t);
        resolve(line.trim());
      }
    });
    proc.on('error', reject);
    proc.on('exit', (c) => reject(new Error(`daemon exited during startup (${c})`)));
  });
  const coldMs = Date.now() - t0;
  const build = (readyLine.match(/build=(\S+)/) || [])[1];
  if (!build) throw new Error(`no build in ready line: ${readyLine}`);

  const sockConn = net.createConnection(sock);
  await new Promise((res, rej) => {
    sockConn.once('connect', res);
    sockConn.once('error', rej);
  });
  let buf = Buffer.alloc(0);
  const queue = [];
  const waiters = [];
  sockConn.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 4) {
      const len = buf.readUInt32BE(0);
      if (buf.length < 4 + len) break;
      const v = JSON.parse(buf.subarray(4, 4 + len).toString('utf8'));
      buf = buf.subarray(4 + len);
      const w = waiters.shift();
      if (w) w(v);
      else queue.push(v);
    }
  });
  const next = (ms = 30000) =>
    queue.length > 0
      ? Promise.resolve(queue.shift())
      : new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error('frame timeout')), ms);
          waiters.push((v) => {
            clearTimeout(t);
            res(v);
          });
        });
  let nextId = 1;
  const call = async (method, params) => {
    const id = nextId++;
    sockConn.write(frame({ jsonrpc: '2.0', id, method, params }));
    return next();
  };

  sockConn.write(frame({ protocol: 'wire/1', version: 1, build, token }));
  const hello = await next();
  if (!hello.ok) throw new Error(`handshake refused: ${hello.error}`);
  await next(); // daemon.ready

  // Fixture with a little texture: text, nested, binary, 200 files.
  const scope = mkdtempSync(path.join(tmpdir(), 'fs-perf-scope-'));
  writeFileSync(path.join(scope, 'note-01.txt'), 'hello perf\n');
  mkdirSync(path.join(scope, 'sub'), { recursive: true });
  writeFileSync(path.join(scope, 'sub', 'deep.txt'), 'x'.repeat(4096));
  writeFileSync(path.join(scope, 'blob.bin'), Buffer.from([0, 1, 2, 3, 250, 251]));
  for (let i = 0; i < 200; i++) writeFileSync(path.join(scope, `f-${String(i).padStart(3, '0')}.txt`), 'x');

  const grant = async (tool) => {
    const filed = await call('approval.request', { tool, scope, reason: 'perf', ttl_secs: 600 });
    const rid = filed.result.request_id;
    const ok = await call('approval.decide', { request_id: rid, decision: 'approve', decided_by: 'perf' });
    return ok.result.token;
  };
  const listTok = await grant('fs.list');
  const readTok = await grant('fs.read');

  // Warm up once (first spawn pays helper + sandbox setup).
  await call('fs.list', { scope, path: '.', capability: listTok });
  await call('fs.read', { scope, path: 'note-01.txt', capability: readTok });

  // Idle RSS after warm-up.
  await new Promise((r) => setTimeout(r, 5000));
  const idleRssKb = rssKb(proc.pid);
  const idleRssMb = idleRssKb === null ? null : Math.round((idleRssKb / 1024) * 10) / 10;

  const N = 50;
  const listMs = [];
  for (let i = 0; i < N; i++) {
    const t = Date.now();
    const r = await call('fs.list', { scope, path: '.', capability: listTok });
    if (r.error) throw new Error(`list round-trip failed: ${JSON.stringify(r.error)}`);
    listMs.push(Date.now() - t);
  }
  const readMs = [];
  for (let i = 0; i < N; i++) {
    const t = Date.now();
    const r = await call('fs.read', { scope, path: 'sub/deep.txt', capability: readTok });
    if (r.error) throw new Error(`read round-trip failed: ${JSON.stringify(r.error)}`);
    readMs.push(Date.now() - t);
  }
  listMs.sort((a, b) => a - b);
  readMs.sort((a, b) => a - b);

  const rows = [
    ['metric', 'value'],
    ['cold start: spawn → ready', `${coldMs} ms (budget 2500 ms) — ${coldMs <= 2500 ? 'PASS' : 'FAIL'}`],
    ['cored idle RSS (5 s after warm-up)', idleRssMb === null ? 'n/a (no OS reading)' : `${idleRssMb} MB`],
    ['fs.list round-trip p50 / p95 / mean', `${percentile(listMs, 50)} / ${percentile(listMs, 95)} / ${mean(listMs).toFixed(1)} ms (n=50)`],
    ['fs.read round-trip p50 / p95 / mean', `${percentile(readMs, 50)} / ${percentile(readMs, 95)} / ${mean(readMs).toFixed(1)} ms (n=50)`],
    ['fs.list max observed', `${Math.max(...listMs)} ms`],
    ['fs.read max observed', `${Math.max(...readMs)} ms`],
  ];
  const widths = [Math.max(...rows.map((r) => r[0].length)), Math.max(...rows.map((r) => String(r[1]).length))];
  const line = (a, b) => `| ${a.padEnd(widths[0])} | ${String(b).padEnd(widths[1])} |`;
  console.log([line(rows[0][0], rows[0][1]), `| ${'-'.repeat(widths[0])} | ${'-'.repeat(widths[1])} |`, ...rows.slice(1).map((r) => line(r[0], r[1]))].join('\n'));

  const out = {
    platform: process.platform,
    arch: process.arch,
    cold_start_ms: coldMs,
    cold_start_budget_ms: 2500,
    cored_idle_rss_mb: idleRssMb,
    fs_list_ms: { n: N, p50: percentile(listMs, 50), p95: percentile(listMs, 95), mean: mean(listMs), max: Math.max(...listMs) },
    fs_read_ms: { n: N, p50: percentile(readMs, 50), p95: percentile(readMs, 95), mean: mean(readMs), max: Math.max(...readMs) },
  };
  writeFileSync(path.join(ROOT, 'artifacts', `perf-fs-${process.platform}.json`), `${JSON.stringify(out, null, 2)}\n`);

  sockConn.destroy();
  proc.kill();
  await new Promise((r) => proc.on('exit', r));
  rmSync(scope, { recursive: true, force: true });
  rmSync(homeDir, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

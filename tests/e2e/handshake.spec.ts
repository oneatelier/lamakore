// P008 end-to-end gate: real daemon binary over named pipes, real Electron
// app boot, kill-and-recover, no-TCP proof, cold start, clippy hygiene.
// Run with: node --test tests/e2e/handshake.spec.ts
// (Rust builds use --target x86_64-pc-windows-gnu; see .cargo/config.toml.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execSync, execFileSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SPEC_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SPEC_DIR, '..', '..');
const DAEMON_CANDIDATES = [
  path.join(ROOT, 'target', 'x86_64-pc-windows-gnu', 'debug', 'cored.exe'),
  path.join(ROOT, 'target', 'debug', 'cored.exe'),
];
const APP_DIR = path.join(ROOT, 'apps', 'desktop');
const DIST_BUNDLE = path.join(APP_DIR, 'dist', 'renderer', 'bundle.js');
const COLD_START_BUDGET_MS = 2500;
const UNREACHABLE_BUDGET_MS = 6000;

function cleanCargoEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.RUSTFLAGS;
  delete env.CARGO_ENCODED_RUSTFLAGS;
  delete env.CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER;
  delete env.CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS;
  // Local Windows builds use the pinned GNU toolchain (no MSVC on this
  // host; see report-P008). CI uses default msvc and is unaffected.
  env.RUSTUP_TOOLCHAIN = '1.100.0-x86_64-pc-windows-gnu';
  return env;
}

function daemonPath(): string {
  for (const c of DAEMON_CANDIDATES) if (existsSync(c)) return c;
  execSync('cargo build --target x86_64-pc-windows-gnu -p cored', {
    cwd: ROOT,
    env: cleanCargoEnv(),
    stdio: 'pipe',
    timeout: 600000,
  });
  for (const c of DAEMON_CANDIDATES) if (existsSync(c)) return c;
  throw new Error('cored binary missing even after cargo build');
}

function pipeName(): string {
  return `\\\\.\\pipe\\wire-e2e-${randomBytes(8).toString('hex')}`;
}

function frame(obj: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length, 0);
  return Buffer.concat([head, body]);
}

class Client {
  sock: net.Socket;
  buf = Buffer.alloc(0);
  queue: unknown[] = [];
  waiters: Array<(v: unknown) => void> = [];
  constructor(sock: net.Socket) {
    this.sock = sock;
    sock.on('data', (d: Buffer) => {
      this.buf = Buffer.concat([this.buf, d]);
      while (this.buf.length >= 4) {
        const len = this.buf.readUInt32BE(0);
        if (this.buf.length < 4 + len) return;
        const text = this.buf.subarray(4, 4 + len).toString('utf8');
        this.buf = this.buf.subarray(4 + len);
        const v: unknown = JSON.parse(text);
        const w = this.waiters.shift();
        if (w) w(v);
        else this.queue.push(v);
      }
    });
  }
  send(obj: unknown) {
    this.sock.write(frame(obj));
  }
  next(timeoutMs = 10000): Promise<unknown> {
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('frame timeout')), timeoutMs);
      this.waiters.push((v) => {
        clearTimeout(t);
        resolve(v);
      });
    });
  }
  close() {
    this.sock.destroy();
  }
}

function spawnDaemon(token: string, pipe: string): { proc: ChildProcess; ready: Promise<string> } {
  const proc = spawn(daemonPath(), ['--socket', pipe], {
    env: { ...process.env, PONE_WIRE_TOKEN: token },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const ready = new Promise<string>((resolve, reject) => {
    let out = '';
    const t = setTimeout(() => reject(new Error('daemon never became ready')), 30000);
    proc.stdout?.on('data', (d: Buffer) => {
      out += d.toString('utf8');
      const line = out.split('\n').find((l) => l.startsWith('ready '));
      if (line) {
        clearTimeout(t);
        resolve(line.trim());
      }
    });
    proc.on('error', reject);
    proc.on('exit', (c) => reject(new Error(`daemon exited during startup (code ${c ?? '?'})`)));
  });
  return { proc, ready };
}

async function connectClient(pipe: string): Promise<Client> {
  const sock = net.createConnection(pipe);
  await new Promise<void>((resolve, reject) => {
    sock.once('connect', () => resolve());
    sock.once('error', reject);
  });
  return new Client(sock);
}

async function handshake(
  client: Client,
  hello: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string; build?: string }> {
  client.send(hello);
  const resp = (await client.next()) as { ok: boolean; error?: string; build?: string };
  return resp;
}

function buildOf(readyLine: string): string {
  const m = readyLine.match(/build=(\S+)/);
  if (!m) throw new Error(`no build in ready line: ${readyLine}`);
  return m[1];
}

test('wire/1 handshake succeeds; health and info answer', async () => {
  const token = randomBytes(16).toString('hex');
  const pipe = pipeName();
  const { proc, ready } = spawnDaemon(token, pipe);
  try {
    const readyLine = await ready;
    const build = buildOf(readyLine);
    const client = await connectClient(pipe);
    try {
      const h = await handshake(client, { protocol: 'wire/1', version: 1, build, token });
      assert.equal(h.ok, true, `handshake refused: ${h.error}`);
      const ready1 = (await client.next()) as { method?: string; params?: { topic?: string } };
      assert.equal(ready1.method, 'event');
      assert.equal(ready1.params?.topic, 'daemon.ready');
      client.send({ jsonrpc: '2.0', id: 1, method: 'system.health', params: {} });
      const health = (await client.next()) as { result?: { ok?: boolean } };
      assert.equal(health.result?.ok, true);
      client.send({ jsonrpc: '2.0', id: 2, method: 'system.info', params: {} });
      const info = (await client.next()) as { result?: Record<string, unknown> };
      assert.ok(info.result && typeof info.result['product'] === 'string', 'info must carry brand product');
      assert.ok(info.result && typeof info.result['daemon'] === 'string', 'info must carry daemon binary');
      client.send({ jsonrpc: '2.0', method: 'bogus.method', id: 3 });
      const bad = (await client.next()) as { error?: { code?: number } };
      assert.equal(bad.error?.code, -32601);
      client.close();
    } finally {
      client.close();
    }
  } finally {
    proc.kill();
    await new Promise((r) => proc.on('exit', r));
  }
});

test('handshake refuses version, build, and token mismatches', async () => {
  const token = randomBytes(16).toString('hex');
  const pipe = pipeName();
  const { proc, ready } = spawnDaemon(token, pipe);
  try {
    const build = buildOf(await ready);
    const good = { protocol: 'wire/1', version: 1, build, token };
    for (const [name, hello] of [
      ['version', { ...good, version: 999 }],
      ['build', { ...good, build: 'wrong-build' }],
      ['token', { ...good, token: 'wrong-token' }],
      ['protocol', { ...good, protocol: 'wire/2' }],
    ] as Array<[string, Record<string, unknown>]>) {
      const client = await connectClient(pipe);
      const h = await handshake(client, hello);
      assert.equal(h.ok, false, `${name} mismatch should be refused`);
      assert.ok(h.error, `${name} refusal must carry a reason`);
      client.close();
    }
  } finally {
    proc.kill();
    await new Promise((r) => proc.on('exit', r));
  }
});

function ensureBuiltApp(): void {
  if (!existsSync(DIST_BUNDLE)) {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-desktop.mjs')], { cwd: ROOT, stdio: 'pipe', timeout: 300000 });
  }
  if (!existsSync(DIST_BUNDLE)) throw new Error('desktop bundle missing even after build');
}

test('app boots, handshakes, and reports cold start within budget', async () => {
  ensureBuiltApp();
  const electronBin = path.join(ROOT, 'node_modules', 'electron', 'cli.js');
  const t0 = Date.now();
  const proc = spawn(process.execPath, [electronBin, '.'], {
    cwd: APP_DIR,
    env: { ...process.env, E2E_SMOKE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let out = '';
  proc.stdout?.on('data', (d: Buffer) => {
    out += d.toString('utf8');
  });
  proc.stderr?.on('data', (d: Buffer) => {
    out += d.toString('utf8');
  });
  const code: number | null = await new Promise((resolve) => {
    const t = setTimeout(() => {
      proc.kill();
      resolve(null);
    }, 90000);
    proc.on('exit', (c) => {
      clearTimeout(t);
      resolve(c);
    });
  });
  assert.equal(code, 0, `app smoke exited ${code}; output:\n${out.slice(-2000)}`);
  assert.match(out, /smoke: handshake ok/);
  const m = out.match(/ready in (\d+)ms/);
  assert.ok(m, `no cold-start measurement in output:\n${out.slice(-2000)}`);
  const ms = Number(m[1]);
  assert.ok(ms <= COLD_START_BUDGET_MS, `cold start ${ms}ms exceeds ${COLD_START_BUDGET_MS}ms budget`);
});

const shared: { electronPid?: number; daemonPid?: number; netstat?: string } = {};

test('kill daemon mid-session: unreachable within 6s, recover, no orphans', async () => {
  ensureBuiltApp();
  const electronBin = path.join(ROOT, 'node_modules', 'electron', 'cli.js');
  const proc = spawn(process.execPath, [electronBin, '.'], {
    cwd: APP_DIR,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  shared.electronPid = proc.pid;
  let out = '';
  const lines: Array<{ t: number; text: string }> = [];
  const note = (d: Buffer) => {
    out += d.toString('utf8');
    for (const l of d.toString('utf8').split('\n')) {
      if (l.includes('wire-state:') || l.includes('daemon: spawned pid=')) lines.push({ t: Date.now(), text: l.trim() });
    }
  };
  proc.stdout?.on('data', note);
  proc.stderr?.on('data', note);
  const waitFor = async (pred: (l: { t: number; text: string }) => boolean, timeoutMs: number, what: string, since = 0): Promise<number> => {
    const t0 = Date.now();
    for (;;) {
      const hit = lines.find((l) => l.t >= since && pred(l));
      if (hit) return hit.t - t0;
      if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}; log tail:\n${lines.slice(-12).map((l) => l.text).join('\n')}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  };
  try {
    await waitFor((l) => l.text.includes('wire-state: connected'), 60000, 'initial connect');
    const spawnLine = [...lines].reverse().find((l) => l.text.includes('daemon: spawned pid='));
    const pid = Number(spawnLine?.text.match(/pid=(\d+)/)?.[1]);
    assert.ok(pid > 0, 'no daemon pid observed');
    shared.daemonPid = pid;
    const tKill = Date.now();
    process.kill(pid);
    await waitFor((l) => l.text.includes('wire-state: unreachable'), 30000, 'unreachable state', tKill);
    const unreachLine = [...lines].reverse().find((l) => l.text.includes('wire-state: unreachable') && l.t >= tKill);
    assert.ok(unreachLine, 'no unreachable line observed after kill');
    const dtUnreachable = unreachLine.t - tKill;
    assert.ok(
      dtUnreachable <= UNREACHABLE_BUDGET_MS,
      `unreachable surfaced after ${dtUnreachable}ms (budget ${UNREACHABLE_BUDGET_MS}ms)`,
    );
    await waitFor((l) => l.text.includes('wire-state: connected'), 60000, 'reconnect', tKill);
    const spawn2 = [...lines].reverse().find((l) => l.text.includes('daemon: spawned pid='));
    const pid2 = Number(spawn2?.text.match(/pid=(\d+)/)?.[1]);
    assert.ok(pid2 > 0 && pid2 !== pid, 'daemon did not restart with a new pid');
    shared.daemonPid = pid2;
    assert.equal(proc.exitCode, null, 'app died during the kill drill');
    shared.netstat = await new Promise<string>((resolve, reject) => {
      const p = spawn('netstat', ['-ano', '-p', 'TCP'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let s = '';
      p.stdout?.on('data', (d: Buffer) => {
        s += d.toString('utf8');
      });
      p.on('error', reject);
      p.on('exit', () => resolve(s));
    });
  } finally {
    proc.kill();
    await new Promise((r) => {
      const t = setTimeout(r, 10000);
      proc.on('exit', () => {
        clearTimeout(t);
        r(null);
      });
    });
  }
  const csv: string = await new Promise((resolve) => {
    const p = spawn('tasklist', ['/FI', 'IMAGENAME eq cored.exe', '/FO', 'CSV', '/NH'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let s = '';
    p.stdout?.on('data', (d: Buffer) => {
      s += d.toString('utf8');
    });
    p.on('exit', () => resolve(s));
  });
  const leftovers = csv.split('\n').filter((l) => l.includes('cored.exe'));
  assert.equal(leftovers.length, 0, `orphan cored processes remain: ${leftovers.join('; ')}`);
});

test('no TCP listeners are owned by the app or daemon', async () => {
  assert.ok(shared.electronPid, 'kill drill must run first (electron pid unknown)');
  assert.ok(shared.netstat !== undefined, 'kill drill must run first (netstat snapshot missing)');
  const out = shared.netstat as string;
  const owned = out.split('\n').filter((l) => /LISTENING/i.test(l) && shared.electronPid !== undefined && l.trim().endsWith(String(shared.electronPid)));
  assert.deepEqual(owned, [], `TCP LISTENING sockets owned by the app:\n${owned.join('\n')}`);
  const daemonOwned = out.split('\n').filter((l) => /LISTENING/i.test(l) && shared.daemonPid !== undefined && l.trim().endsWith(String(shared.daemonPid)));
  assert.deepEqual(daemonOwned, [], `TCP LISTENING sockets owned by the daemon:\n${daemonOwned.join('\n')}`);
});

test('clippy is clean with warnings denied', async () => {
  execSync('cargo clippy --workspace --target x86_64-pc-windows-gnu -- -D warnings', {
    cwd: ROOT,
    env: cleanCargoEnv(),
    stdio: 'pipe',
    timeout: 600000,
  });
});

test('zero unwrap/expect outside tests (deny lint is the enforcer)', () => {
  let out = '';
  try {
    out = execSync('git grep -n "unwrap()|expect(" -- crates/', { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    out = ((e as { stdout?: unknown }).stdout as string | undefined) ?? '';
  }
  const hits = out.split('\n').filter((l) => l.trim() !== '');
  const files: Record<string, { cfgLine: number; hits: number[] }> = {};
  for (const h of hits) {
    const m = h.match(/^([^:]+):(\d+):/);
    if (!m) continue;
    const [, file, ln] = m;
    files[file] = files[file] || { cfgLine: -1, hits: [] };
    files[file].hits.push(Number(ln));
  }
  const offenders: string[] = [];
  for (const [file, info] of Object.entries(files)) {
    const text = readFileSync(path.join(ROOT, file), 'utf8');
    const lines = text.split('\n');
    const cfgIdx = lines.findIndex((l) => l.includes('#[cfg(test)]'));
    if (cfgIdx === -1) {
      offenders.push(`${file}: no #[cfg(test)] guard`);
      continue;
    }
    for (const ln of info.hits) {
      if (ln <= cfgIdx + 1) offenders.push(`${file}:${ln} before #[cfg(test)]`);
    }
  }
  assert.deepEqual(offenders, [], `unwrap/expect outside tests:\n${offenders.join('\n')}`);
});

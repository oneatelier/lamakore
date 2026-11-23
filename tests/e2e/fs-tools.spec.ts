// fs.list / fs.read end-to-end: real daemon binary over a local-only
// transport (named pipe on Windows, Unix socket elsewhere), real Tier-1
// sandbox spawn, approval card on first grant over the wire, audit chain,
// and NOT_IMPLEMENTED honesty on platforms without a sandbox primitive.
// Run with: node --test tests/e2e/fs-tools.spec.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SPEC_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SPEC_DIR, '..', '..');
const IS_WIN = process.platform === 'win32';

type JsonObj = Record<string, unknown>;
type WireReply = { result?: JsonObj; error?: { code?: number; message?: string } };

function cargoEnv(): NodeJS.ProcessEnv {
  // Local Windows builds ride the pinned GNU toolchain (no MSVC on this
  // host; see report-P008) with a user-local C toolchain and a short
  // target dir (link-line budget). CI uses default toolchains and is
  // unaffected. Paths derive from env so no username is ever committed.
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.RUSTFLAGS;
  delete env.CARGO_ENCODED_RUSTFLAGS;
  delete env.CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER;
  delete env.CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS;
  env.RUSTUP_TOOLCHAIN = '1.100.0-x86_64-pc-windows-gnu';
  try {
    const binDir = path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'project-one', 'bin');
    const cc = path.join(binDir, 'ccwrap.exe');
    const ar = path.join(binDir, 'zig.exe');
    if (existsSync(cc) && existsSync(ar)) {
      env.CC_x86_64_pc_windows_gnu = cc;
      env.AR_x86_64_pc_windows_gnu = `${ar} ar`;
      env.CARGO_TARGET_DIR = 'D:\\t';
      env.CARGO_PROFILE_DEV_CODEGEN_UNITS = '1';
    }
  } catch {
    /* fall back to the ambient toolchain */
  }
  return env;
}

function daemonCandidates(): string[] {
  const exe = IS_WIN ? 'cored.exe' : 'cored';
  return [
    // Local dev target dir (short path defeats the Windows link-line
    // limit; see report-P008). Absent everywhere else; skipped there.
    path.join('D:', 't', 'x86_64-pc-windows-gnu', 'debug', exe),
    path.join(ROOT, 'target', 'x86_64-pc-windows-gnu', 'debug', exe),
    path.join(ROOT, 'target', 'debug', exe),
  ];
}

function daemonPath(): string {
  for (const c of daemonCandidates()) if (existsSync(c)) return c;
  if (IS_WIN) {
    execSync('cargo build --target x86_64-pc-windows-gnu -p cored', {
      cwd: ROOT,
      env: cargoEnv(),
      stdio: 'pipe',
      timeout: 600000,
    });
  } else {
    execSync('cargo build -p cored', { cwd: ROOT, env: { ...process.env }, stdio: 'pipe', timeout: 600000 });
  }
  for (const c of daemonCandidates()) if (existsSync(c)) return c;
  throw new Error('cored binary missing even after cargo build');
}

function socketPath(): string {
  const rand = randomBytes(8).toString('hex');
  return IS_WIN ? `\\\\.\\pipe\\wire-fs-e2e-${rand}` : path.join(tmpdir(), `wire-fs-e2e-${rand}.sock`);
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
  next(timeoutMs = 60000): Promise<unknown> {
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

function spawnDaemon(token: string, sock: string, extraEnv: NodeJS.ProcessEnv): { proc: ChildProcess; ready: Promise<string> } {
  const proc = spawn(daemonPath(), ['--socket', sock], {
    env: { ...process.env, PONE_WIRE_TOKEN: token, ...extraEnv },
    // stdin must stay open (not 'ignore'): the daemon treats stdin EOF as
    // parent death and shuts down, which would race the first connect.
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const ready = new Promise<string>((resolve, reject) => {
    let out = '';
    const t = setTimeout(() => reject(new Error('daemon never became ready')), 60000);
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

function buildOf(readyLine: string): string {
  const m = readyLine.match(/build=(\S+)/);
  if (!m) throw new Error(`no build in ready line: ${readyLine}`);
  return m[1];
}

interface WireCtx {
  client: Client;
  proc: ChildProcess;
  homeDir: string;
  nextId: number;
  call(method: string, params: unknown): Promise<WireReply>;
}

async function connectWire(): Promise<WireCtx> {
  const token = randomBytes(16).toString('hex');
  const sock = socketPath();
  // Isolated user-data dir per connection: the daemon resolves its store
  // from APPDATA/HOME, so each test gets a fresh chain with no grant rows
  // leaking across tests (and no writes to the real user store).
  const homeDir = mkdtempSync(path.join(tmpdir(), 'fs-e2e-home-'));
  const extraEnv: NodeJS.ProcessEnv = IS_WIN
    ? { APPDATA: homeDir }
    : { HOME: homeDir, XDG_DATA_HOME: homeDir };
  const { proc, ready } = spawnDaemon(token, sock, extraEnv);
  const readyLine = await ready;
  const build = buildOf(readyLine);
  const sockConn = net.createConnection(sock);
  await new Promise<void>((resolve, reject) => {
    sockConn.once('connect', () => resolve());
    sockConn.once('error', reject);
  });
  const client = new Client(sockConn);
  client.send({ protocol: 'wire/1', version: 1, build, token });
  const hello = (await client.next()) as { ok?: boolean; error?: string };
  if (!hello.ok) {
    client.close();
    proc.kill();
    throw new Error(`handshake refused: ${hello.error}`);
  }
  // Consume daemon.ready.
  await client.next();
  const ctx: WireCtx = {
    client,
    proc,
    homeDir,
    nextId: 1,
    async call(method, params) {
      const id = ctx.nextId++;
      client.send({ jsonrpc: '2.0', id, method, params });
      const raw = (await client.next()) as { result?: unknown; error?: { code?: number; message?: string } };
      return {
        result: raw.result as JsonObj | undefined,
        error: raw.error,
      };
    },
  };
  return ctx;
}

async function closeWire(ctx: WireCtx): Promise<void> {
  ctx.client.close();
  ctx.proc.kill();
  await new Promise<void>((r) => {
    const t = setTimeout(r, 10000);
    ctx.proc.on('exit', () => {
      clearTimeout(t);
      r();
    });
  });
  rmrf(ctx.homeDir);
}

/** Deterministic fixture: synthetic names only, no PII anywhere. */
function makeFixture(tag: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `fs-e2e-${tag}-`));
  writeFileSync(path.join(dir, 'note-01.txt'), 'hello fs\n');
  mkdirSync(path.join(dir, 'sub'), { recursive: true });
  writeFileSync(path.join(dir, 'sub', 'note-02.txt'), 'second file\n');
  writeFileSync(path.join(dir, 'blob.bin'), Buffer.from([0, 1, 2, 3, 255, 254]));
  // >1 MiB file for the read cap (exact size asserted below).
  writeFileSync(path.join(dir, 'big.bin'), Buffer.alloc(1048576 + 12345, 0x78));
  mkdirSync(path.join(dir, 'bigdir'), { recursive: true });
  for (let i = 0; i < 10005; i++) {
    writeFileSync(path.join(dir, 'bigdir', `f-${String(i).padStart(5, '0')}.txt`), 'x');
  }
  return dir;
}

function rmrf(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

function str(v: unknown): string {
  assert.equal(typeof v, 'string');
  return v as string;
}

function num(v: unknown): number {
  assert.equal(typeof v, 'number');
  return v as number;
}

async function approveFor(ctx: WireCtx, tool: string, scope: string, reason: string): Promise<string> {
  const filed = await ctx.call('approval.request', { tool, scope, reason, ttl_secs: 120 });
  assert.ok(!filed.error, `approval.request failed: ${JSON.stringify(filed.error)}`);
  const rid = str(filed.result?.request_id);
  assert.ok(rid.startsWith('apr-'));
  const ok = await ctx.call('approval.decide', { request_id: rid, decision: 'approve', decided_by: 'e2e' });
  assert.equal((ok.result as JsonObj)?.approved, true);
  return str((ok.result as JsonObj)?.token);
}

async function auditHas(ctx: WireCtx, action: string, match: (payload: JsonObj) => boolean): Promise<boolean> {
  const exp = await ctx.call('audit.export', { limit: 10000 });
  assert.ok(!exp.error, `audit.export failed: ${JSON.stringify(exp.error)}`);
  const lines = String((exp.result as JsonObj)?.jsonl ?? '').split('\n').filter((l) => l.length > 0);
  return lines.some((l) => {
    try {
      const v = JSON.parse(l) as JsonObj;
      return v['event'] === action && match((v['payload'] ?? {}) as JsonObj);
    } catch {
      return false;
    }
  });
}

test('fs.list without capability is denied and audited (gate first)', async () => {
  const ctx = await connectWire();
  const dir = makeFixture('deny');
  try {
    const r = await ctx.call('fs.list', { scope: dir });
    assert.ok(r.error, 'unauthenticated fs.list must fail');
    assert.equal(r.error?.code, -32001);
    assert.match(r.error?.message ?? '', /missing/);
    const denied = await auditHas(ctx, 'capability.denied', (p) => p['method'] === 'fs.list');
    assert.ok(denied, 'denial must be audited as capability.denied for fs.list');
  } finally {
    rmrf(dir);
    await closeWire(ctx);
  }
});

test('approval card on first grant: request, deny, then approve and list', async () => {
  const ctx = await connectWire();
  const dir = makeFixture('approve');
  try {
    // Deny path first: a denied card must not grant anything.
    const filed = await ctx.call('approval.request', {
      tool: 'fs.list',
      scope: dir,
      reason: 'e2e deny probe',
      ttl_secs: 120,
    });
    assert.ok(!filed.error, `approval.request failed: ${JSON.stringify(filed.error)}`);
    const rid = str((filed.result as JsonObj)?.request_id);
    assert.ok(rid.startsWith('apr-'));
    const status = await ctx.call('approval.status', { request_id: rid });
    assert.equal((status.result as JsonObj)?.status, 'pending');
    const denied = await ctx.call('approval.decide', { request_id: rid, decision: 'deny', decided_by: 'e2e' });
    assert.equal((denied.result as JsonObj)?.decision, 'denied');
    const stillDenied = await ctx.call('fs.list', { scope: dir, capability: 'bogus' });
    assert.equal(stillDenied.error?.code, -32001);

    // Approve path: the card grants a token that authorizes the tool.
    const token = await approveFor(ctx, 'fs.list', dir, 'e2e approve probe');
    assert.ok(token.length > 16);
    const listed = await ctx.call('fs.list', { scope: dir, capability: token });
    assert.ok(!listed.error, `approved fs.list failed: ${JSON.stringify(listed.error)}`);
    const names = ((listed.result as JsonObj)?.entries as JsonObj[]).map((e) => e['name'] as string).sort();
    assert.ok(names.includes('note-01.txt'));
    assert.ok(names.includes('sub'));
  } finally {
    rmrf(dir);
    await closeWire(ctx);
  }
});

test('wrong-scope token cannot list (gate enforced per call)', async () => {
  const ctx = await connectWire();
  const dir = makeFixture('scope');
  try {
    const token = await approveFor(ctx, 'fs.list', '/elsewhere', 'e2e');
    const r = await ctx.call('fs.list', { scope: dir, capability: token });
    assert.equal(r.error?.code, -32001, 'out-of-scope token must be denied');
  } finally {
    rmrf(dir);
    await closeWire(ctx);
  }
});

test('fs.read with an fs.list token is denied (wrong tool)', async () => {
  const ctx = await connectWire();
  const dir = makeFixture('wrongtool');
  try {
    const token = await approveFor(ctx, 'fs.list', dir, 'e2e');
    const r = await ctx.call('fs.read', { scope: dir, path: 'note-01.txt', capability: token });
    assert.equal(r.error?.code, -32001, 'cross-tool token must be denied');
    assert.match(r.error?.message ?? '', /wrong-tool/);
  } finally {
    rmrf(dir);
    await closeWire(ctx);
  }
});

test('fs.list caps at 10000 entries with an honest flag', async () => {
  const ctx = await connectWire();
  const dir = makeFixture('cap');
  try {
    const token = await approveFor(ctx, 'fs.list', path.join(dir, 'bigdir'), 'e2e');
    const r = await ctx.call('fs.list', { scope: path.join(dir, 'bigdir'), capability: token });
    assert.ok(!r.error, `capped list failed: ${JSON.stringify(r.error)}`);
    assert.equal(((r.result as JsonObj)?.entries as unknown[]).length, 10000);
    assert.equal((r.result as JsonObj)?.truncated, true);
  } finally {
    rmrf(dir);
    await closeWire(ctx);
  }
});

test('fs.read returns exact utf8 bytes; binaries arrive base64', async () => {
  const ctx = await connectWire();
  const dir = makeFixture('read');
  try {
    const token = await approveFor(ctx, 'fs.read', dir, 'e2e');
    const text = await ctx.call('fs.read', { scope: dir, path: 'note-01.txt', capability: token });
    assert.ok(!text.error, `utf8 read failed: ${JSON.stringify(text.error)}`);
    assert.equal((text.result as JsonObj)?.encoding, 'utf8');
    assert.equal((text.result as JsonObj)?.content, 'hello fs\n');
    assert.equal((text.result as JsonObj)?.truncated, false);
    const bin = await ctx.call('fs.read', { scope: dir, path: 'blob.bin', capability: token });
    assert.ok(!bin.error, `binary read failed: ${JSON.stringify(bin.error)}`);
    assert.equal((bin.result as JsonObj)?.encoding, 'base64');
    const raw = Buffer.from(String((bin.result as JsonObj)?.content ?? ''), 'base64');
    assert.deepEqual(raw, Buffer.from([0, 1, 2, 3, 255, 254]));
  } finally {
    rmrf(dir);
    await closeWire(ctx);
  }
});

test('fs.read caps at 1 MiB with an honest flag', async () => {
  const ctx = await connectWire();
  const dir = makeFixture('big');
  try {
    const token = await approveFor(ctx, 'fs.read', dir, 'e2e');
    const r = await ctx.call('fs.read', { scope: dir, path: 'big.bin', capability: token });
    assert.ok(!r.error, `capped read failed: ${JSON.stringify(r.error)}`);
    assert.equal((r.result as JsonObj)?.size, 1048576 + 12345);
    assert.equal((r.result as JsonObj)?.truncated, true);
    assert.equal(Buffer.byteLength(String((r.result as JsonObj)?.content ?? ''), 'utf8'), 1048576);
  } finally {
    rmrf(dir);
    await closeWire(ctx);
  }
});

test('escape attempts deny without spawning and audit honestly', async () => {
  const ctx = await connectWire();
  const dir = makeFixture('escape');
  try {
    const token = await approveFor(ctx, 'fs.read', dir, 'e2e');
    for (const evil of ['../x', '/etc/passwd', '..']) {
      const r = await ctx.call('fs.read', { scope: dir, path: evil, capability: token });
      assert.ok(r.error, `escape path ${evil} must fail`);
      assert.ok(r.error?.code === -32602 || r.error?.code === -32001, `unexpected code for ${evil}: ${r.error?.code}`);
    }
    if (!IS_WIN) {
      const outside = path.join(tmpdir(), `fs-e2e-outside-${process.pid}.txt`);
      writeFileSync(outside, 'outside\n');
      try {
        symlinkSync(outside, path.join(dir, 'link-out'));
        const r = await ctx.call('fs.read', { scope: dir, path: 'link-out', capability: token });
        assert.equal(r.error?.code, -32001, 'symlink escape must be a capability denial');
        assert.match(r.error?.message ?? '', /scope-violation/);
        const audited = await auditHas(ctx, 'tool.exec', (p) => p['method'] === 'fs.read' && p['reason'] === 'scope-violation');
        assert.ok(audited, 'scope violation must be audited');
      } finally {
        try {
          rmSync(outside, { force: true });
        } catch {
          /* best effort */
        }
      }
    }
  } finally {
    rmrf(dir);
    await closeWire(ctx);
  }
});

test('sandbox runs confined or refuses honestly with audit (all paths gated)', async () => {
  const ctx = await connectWire();
  const dir = makeFixture('confined');
  try {
    const token = await approveFor(ctx, 'fs.list', dir, 'e2e');
    const r = await ctx.call('fs.list', { scope: dir, capability: token });
    if (r.error) {
      // Sandbox unavailable here: must be NOT_IMPLEMENTED with an audit row.
      assert.equal(r.error.code, -32002, `unexpected refusal: ${JSON.stringify(r.error)}`);
      const audited = await auditHas(ctx, 'tool.exec', (p) => p['method'] === 'fs.list' && p['reason'] === 'not-implemented');
      assert.ok(audited, 'NOT_IMPLEMENTED refusal must be audited');
    } else {
      // Sandbox ran: entries prove execution, audit proves the gate ran first.
      assert.ok(Array.isArray((r.result as JsonObj)?.entries));
      const audited = await auditHas(ctx, 'tool.exec', (p) => p['method'] === 'fs.list' && p['reason'] === 'ok');
      assert.ok(audited, 'successful execution must be audited');
    }
    // No stray result files may remain in the user scope.
    const strays = readdirSync(dir).filter((n) => n.startsWith('.pone-fs-result-'));
    assert.deepEqual(strays, []);
  } finally {
    rmrf(dir);
    await closeWire(ctx);
  }
});

test('audit chain verifies and exports the fs trail', async () => {
  const ctx = await connectWire();
  const dir = makeFixture('audit');
  try {
    const token = await approveFor(ctx, 'fs.list', dir, 'e2e');
    await ctx.call('fs.list', { scope: dir, capability: token });
    const verify = await ctx.call('audit.verify', {});
    assert.equal((verify.result as JsonObj)?.ok, true);
    assert.ok(num((verify.result as JsonObj)?.events) >= 3);
    const exp = await ctx.call('audit.export', { limit: 10000 });
    const lines = String((exp.result as JsonObj)?.jsonl ?? '').split('\n').filter((l) => l.length > 0);
    assert.ok(lines.length >= 3);
    for (const line of lines) {
      const v = JSON.parse(line) as JsonObj;
      assert.deepEqual(Object.keys(v).sort(), ['actor', 'event', 'hash', 'payload', 'payload_hash', 'prev_hash', 'seq', 'ts']);
    }
    assert.ok(lines.some((l) => (JSON.parse(l) as JsonObj).event === 'tool.exec'), 'tool.exec rows must be exported');
  } finally {
    rmrf(dir);
    await closeWire(ctx);
  }
});

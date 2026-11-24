// DaemonManager: spawn, health-ping, bounded restart, shutdown.
// Speaks wire/1 over a local-only socket (named pipe / Unix socket).
// Emits 'state' on every transition and logs `wire-state: <state>` for tests.
//
// Restart policy: certain death (child exit) surfaces 'unreachable'
// immediately while background restarts proceed; ambiguous loss (socket
// close, ping failure) retries quietly as 'connecting'. Both paths stop
// after MAX_RESTARTS consecutive failures — never silent infinite respawn.
// Manual retry (UI button) resets the budget and reconnects now.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import cfg from '../../../../branding.config.json';

const BRIDGE: string = cfg.cliBinary;
const ALLOWED = new Set(['system.health', 'system.info', 'audit.verify', 'audit.export', 'fs.list', 'fs.read', 'approval.request', 'approval.decide', 'secret.set', 'secret.list', 'secret.delete', 'secret.ref', 'secret.test']);
const PING_MS = 5000;
const BACKOFF_MS = [1000, 2000, 4000];
const MAX_RESTARTS = 3;
const HEALTH_TIMEOUT_MS = 10000;
const DEGRADED_RTT_MS = 2000;

export type ConnState = 'connecting' | 'connected' | 'unreachable' | 'degraded';

/** Ledger verification outcome, from `audit.verify`. Null means unknown
 * (not yet fetched, or the bridge refused it) — never a banner. */
export interface LedgerStatus {
  ok: boolean;
  events: number;
  badSeq: number | null;
  head: string | null;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class DaemonManager extends EventEmitter {
  private child: ChildProcess | null = null;
  private socket: net.Socket | null = null;
  private buf = Buffer.alloc(0);
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private subs = new Map<string, Set<(data: unknown) => void>>();
  private maxAck = 0;
  private timer: NodeJS.Timeout | null = null;
  private attempts = 0;
  private wantShutdown = false;
  private recovery: Promise<void> | null = null;
  readonly token: string = randomBytes(16).toString('hex');
  readonly socketPath: string;
  state: ConnState = 'connecting';

  constructor(
    readonly coredPath: string,
    readonly workDir: string,
  ) {
    super();
    const rand = randomBytes(8).toString('hex');
    this.socketPath =
      os.platform() === 'win32' ? `\\\\.\\pipe\\wire-${rand}` : path.join(os.tmpdir(), `wire-${rand}.sock`);
  }

  setState(s: ConnState) {
    if (this.state !== s) {
      this.state = s;
      console.log(`wire-state: ${s}`);
      this.emit('state', s);
    }
  }

  private frame(obj: unknown) {
    const text = JSON.stringify(obj);
    const body = Buffer.from(text, 'utf8');
    const head = Buffer.alloc(4);
    head.writeUInt32BE(body.length, 0);
    this.socket?.write(Buffer.concat([head, body]));
  }

  private onData = (chunk: Buffer) => {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.buf.length >= 4) {
      const len = this.buf.readUInt32BE(0);
      if (len > 8 * 1024 * 1024) {
        this.onSocketFault(new Error('frame too large'));
        return;
      }
      if (this.buf.length < 4 + len) return;
      const text = this.buf.subarray(4, 4 + len).toString('utf8');
      this.buf = this.buf.subarray(4 + len);
      this.onFrame(text);
    }
  };

  private onFrame(text: string) {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return;
    }
    if (msg['method'] === 'event' && msg['id'] === undefined) {
      const params = msg['params'] as { seq?: number; topic?: string; data?: unknown };
      if (typeof params?.seq === 'number' && params.seq > this.maxAck) {
        this.maxAck = params.seq;
        this.frame({ jsonrpc: '2.0', method: 'ack', params: { seq: this.maxAck } });
      }
      if (typeof params?.topic === 'string') {
        for (const cb of this.subs.get(params.topic) ?? []) {
          try {
            cb(params.data);
          } catch {
            /* subscriber errors must not break the wire loop */
          }
        }
      }
      return;
    }
    if (typeof msg['id'] === 'number') {
      const p = this.pending.get(msg['id']);
      if (!p) return;
      this.pending.delete(msg['id']);
      clearTimeout(p.timer);
      if (msg['error'] !== undefined && msg['error'] !== null) {
        const e = msg['error'] as { code?: number; message?: string };
        p.reject(new Error(`daemon error ${e.code ?? '?'}: ${e.message ?? 'unknown'}`));
      } else {
        p.resolve(msg['result']);
      }
    }
  }

  private onSocketFault = (err: Error) => {
    if (this.wantShutdown) return;
    console.log(`daemon: socket fault (${err.message}); retrying quietly`);
    this.setState('connecting');
    this.teardownSocket();
    this.ensureRecovery();
  };

  async start(): Promise<void> {
    this.wantShutdown = false;
    this.attempts = 0;
    this.setState('connecting');
    await this.spawnOnce();
  }

  private spawnOnce(): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.coredPath, ['--socket', this.socketPath], {
        env: { ...process.env, PONE_WIRE_TOKEN: this.token },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      this.child = child;
      console.log(`daemon: spawned pid=${child.pid ?? '?'}`);
      let settled = false;
      const onStdout = (d: Buffer) => {
        const line = d.toString('utf8').split('\n').find((l) => l.startsWith('ready '));
        if (line && !settled) {
          settled = true;
          cleanup();
          const build = line.split('build=')[1]?.trim() ?? '';
          void this.handshake(build).then(
            () => resolve(),
            (e: Error) => reject(e),
          );
        }
      };
      const onExit = (code: number | null) => {
        if (settled || this.wantShutdown) return;
        settled = true;
        cleanup();
        reject(new Error(`daemon exited during startup (code ${code ?? '?'})`));
      };
      const cleanup = () => {
        child.stdout?.off('data', onStdout);
        child.off('exit', onExit);
      };
      child.stdout?.on('data', onStdout);
      child.on('exit', onExit);
      child.on('error', (e) => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(e);
        }
      });
      child.stderr?.on('data', (d) => console.log(`daemon: ${String(d).trim().slice(0, 200)}`));
      // Certain death: surface it immediately, recover in the background.
      child.on('exit', (code) => {
        if (this.wantShutdown || this.child !== child) return;
        console.log(`daemon: unexpected exit (code ${code ?? '?'})`);
        this.setState('unreachable');
        this.teardownSocket();
        this.ensureRecovery();
      });
    });
  }

  private handshake(build: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection(this.socketPath);
      const fail = (e: Error) => {
        sock.destroy();
        reject(e);
      };
      const timer = setTimeout(() => fail(new Error('handshake timeout')), HEALTH_TIMEOUT_MS);
      sock.once('error', fail);
      sock.once('connect', () => {
        this.socket = sock;
        this.buf = Buffer.alloc(0);
        sock.on('data', this.onData);
        sock.on('error', this.onSocketFault);
        sock.on('close', () => {
          if (!this.wantShutdown && this.child) {
            // Child alive but pipe closed: ambiguous loss, retry quietly.
            this.setState('connecting');
            this.teardownSocket();
            this.ensureRecovery();
          }
        });
        const payload = JSON.stringify({ protocol: 'wire/1', version: 1, build, token: this.token });
        const body = Buffer.from(payload, 'utf8');
        const head = Buffer.alloc(4);
        head.writeUInt32BE(body.length, 0);
        sock.write(Buffer.concat([head, body]));
        const onReply = (chunk: Buffer) => {
          this.buf = Buffer.concat([this.buf, chunk]);
          if (this.buf.length < 4) return;
          const len = this.buf.readUInt32BE(0);
          if (len > 8 * 1024 * 1024) {
            this.buf = Buffer.alloc(0);
            return;
          }
          if (this.buf.length < 4 + len) return;
          const text = this.buf.subarray(4, 4 + len).toString('utf8');
          this.buf = this.buf.subarray(4 + len);
          sock.off('data', onReply);
          sock.on('data', this.onData);
          clearTimeout(timer);
          let resp: { ok?: boolean; error?: string };
          try {
            resp = JSON.parse(text) as { ok?: boolean; error?: string };
          } catch {
            fail(new Error('handshake: bad response'));
            return;
          }
          if (!resp.ok) {
            fail(new Error(`handshake refused: ${resp.error ?? 'unknown'}`));
            return;
          }
          this.attempts = 0;
          this.setState('connected');
          this.startPing();
          resolve();
        };
        sock.off('data', this.onData);
        sock.on('data', onReply);
      });
    });
  }

  private startPing() {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      void this.ping();
    }, PING_MS);
    if (typeof this.timer === 'object' && 'unref' in this.timer) this.timer.unref();
  }

  private async ping() {
    const t0 = Date.now();
    try {
      const h = (await this.invoke('system.health', {})) as {
        pending?: number;
        spilled?: number;
      };
      const rtt = Date.now() - t0;
      if (rtt > DEGRADED_RTT_MS || (h.pending ?? 0) > 100 || (h.spilled ?? 0) > 0) {
        if (this.state === 'connected') this.setState('degraded');
      } else if (this.state === 'degraded') {
        this.setState('connected');
      }
    } catch {
      this.setState('connecting');
      this.teardownSocket();
      this.ensureRecovery();
    }
  }

  /** Background restart loop: capped, never overlapping, never infinite. */
  private ensureRecovery(): void {
    if (this.recovery || this.wantShutdown) return;
    this.recovery = (async () => {
      try {
        while (
          !this.wantShutdown &&
          this.state !== 'connected' &&
          this.state !== 'degraded' &&
          this.attempts < MAX_RESTARTS
        ) {
          const delay = BACKOFF_MS[Math.min(this.attempts, BACKOFF_MS.length - 1)];
          console.log(`daemon: restart attempt ${this.attempts + 1}/${MAX_RESTARTS} in ${delay}ms`);
          await sleep(delay);
          if (this.wantShutdown) return;
          this.teardownSocket();
          this.killChild();
          try {
            await this.spawnOnce();
            return;
          } catch (e) {
            this.attempts += 1;
            console.log(`daemon: restart failed (${(e as Error).message})`);
          }
        }
        if (!this.wantShutdown && this.state !== 'connected' && this.state !== 'degraded') {
          this.setState('unreachable');
          console.log(`daemon: giving up after ${MAX_RESTARTS} attempts; use Retry to recover`);
        }
      } finally {
        this.recovery = null;
      }
    })();
  }

  /** Manual recovery (Retry button): reset the budget and reconnect now. */
  async recover(): Promise<void> {
    this.attempts = 0;
    this.teardownSocket();
    this.killChild();
    this.setState('connecting');
    try {
      await this.spawnOnce();
    } catch (e) {
      this.setState('unreachable');
      throw e;
    }
  }

  private teardownSocket() {
    try {
      this.socket?.destroy();
    } catch {
      /* already gone */
    }
    this.socket = null;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('connection lost'));
    }
    this.pending.clear();
  }

  private killChild() {
    const c = this.child;
    this.child = null;
    if (!c || c.exitCode !== null) return;
    try {
      c.kill();
    } catch {
      /* already gone */
    }
  }

  async invoke(method: string, params: unknown = {}): Promise<unknown> {
    if (!ALLOWED.has(method) || !/^[a-z]+\.[a-z]+$/.test(method)) {
      throw new Error(`blocked method: ${method}`);
    }
    if (this.state === 'unreachable') {
      // Recovery path: a user action re-arms the restart budget.
      await this.recover();
    } else if (this.state !== 'connected' && this.state !== 'degraded') {
      this.ensureRecovery();
    }
    if (!this.socket || (this.state !== 'connected' && this.state !== 'degraded')) {
      throw new Error('daemon unreachable');
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('daemon call timed out'));
      }, HEALTH_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.frame({ jsonrpc: '2.0', id, method, params });
    });
  }

  onTopic(topic: string, cb: (data: unknown) => void) {
    if (!this.subs.has(topic)) this.subs.set(topic, new Set());
    this.subs.get(topic)?.add(cb);
  }

  async shutdown() {
    this.wantShutdown = true;
    if (this.timer) clearInterval(this.timer);
    this.teardownSocket();
    this.killChild();
  }
}

export const BRIDGE_NAME: string = BRIDGE;

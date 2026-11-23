// Typed allowlisted bridge. The channel prefix is the configured binary name
// read from branding.config.json at bundle time — never a literal here.
import { contextBridge, ipcRenderer } from 'electron';
import cfg from '../../../../branding.config.json';

const BRIDGE: string = cfg.cliBinary;
const ALLOWED = new Set(['system.health', 'system.info', 'audit.verify', 'audit.export', 'fs.list', 'fs.read', 'approval.request', 'approval.decide']);
const TOPIC_RE = /^[a-z0-9.-]+$/i;

function validMethod(m: unknown): m is string {
  return typeof m === 'string' && /^[a-z]+\.[a-z]+$/.test(m) && ALLOWED.has(m);
}

export interface PoneBridge {
  invoke: (method: string, params?: unknown) => Promise<unknown>;
  subscribe: (topic: string, cb: (data: unknown) => void) => number;
  unsubscribe: (id: number) => void;
}

let nextId = 0;
const subs = new Map<number, { topic: string; fn: (e: unknown, data: unknown) => void }>();

const api: PoneBridge = {
  invoke: async (method: string, params: unknown = {}) => {
    if (!validMethod(method)) throw new Error(`blocked method: ${String(method)}`);
    return ipcRenderer.invoke(`${BRIDGE}:invoke`, { method, params });
  },
  subscribe: (topic: string, cb: (data: unknown) => void) => {
    if (typeof topic !== 'string' || !TOPIC_RE.test(topic)) throw new Error('blocked topic');
    nextId += 1;
    const id = nextId;
    const fn = (_e: unknown, data: unknown) => cb(data);
    subs.set(id, { topic, fn });
    ipcRenderer.on(`${BRIDGE}:event:${topic}`, fn);
    return id;
  },
  unsubscribe: (id: number) => {
    const s = subs.get(id);
    if (s) {
      subs.delete(id);
      ipcRenderer.removeListener(`${BRIDGE}:event:${s.topic}`, s.fn);
    }
  },
};

contextBridge.exposeInMainWorld(BRIDGE, api);

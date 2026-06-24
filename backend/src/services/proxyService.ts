import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import type { Agent } from 'http';
import { ProxyAgent, type Dispatcher } from 'undici';
import nodeFetch from 'node-fetch';
import { config } from '../config';
import { getSetting, setSetting } from '../db';

export interface FetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<any>;
  arrayBuffer(): Promise<ArrayBuffer>;
  body: any;
}

// 本地 fetch 函数类型（避免依赖 DOM lib）
export type FetchFn = (input: any, init?: any) => Promise<any>;

// 引用全局 fetch（Node 18+ 内置 undici）；tsconfig.lib 未含 DOM，故用 as any 桥接
const nativeFetch: FetchFn = (globalThis as any).fetch;

// --- 缓存 ---
let cachedAgent: Agent | undefined;            // 给 SOCKS 路径 / 测试连接 / curl 用
let cachedDispatcher: Dispatcher | undefined;  // 给 HTTP(S) 代理 + native fetch 用
let cachedUrl = '';

function isSocks(url: string): boolean {
  return /^socks[45h]?:\/\//i.test(url);
}

function resetCache(): void {
  cachedAgent = undefined;
  cachedDispatcher = undefined;
  cachedUrl = '';
}

// --- 设置 ---
export function isProxyEnabled(): boolean {
  const val = getSetting('proxy_enabled');
  if (val !== undefined) return val === '1';
  return !!config.proxyUrl;
}

export function setProxyEnabled(enabled: boolean): void {
  setSetting('proxy_enabled', enabled ? '1' : '0');
  resetCache();
}

export function getProxyUrl(): string {
  const dbVal = getSetting('proxy_url');
  if (dbVal !== undefined) return dbVal;
  return config.proxyUrl;
}

export function setProxyUrl(url: string): void {
  setSetting('proxy_url', url);
  resetCache();
}

/**
 * 返回 http(s).Agent 形式的代理 agent。
 * 仅供 SOCKS 路径下的 node-fetch / curl 调试 / 测试连接使用。
 * 注意：HTTP(S) 代理已切换到 undici dispatcher，不再通过此函数注入到 Cloudflare SDK。
 */
export function getHttpAgent(): Agent | undefined {
  if (!isProxyEnabled()) return undefined;
  const url = getProxyUrl();
  if (!url) return undefined;
  if (url === cachedUrl && cachedAgent) return cachedAgent;

  cachedAgent = isSocks(url)
    ? new SocksProxyAgent(url, { timeout: 30000 })
    : new HttpsProxyAgent(url, { timeout: 30000 });
  cachedUrl = url;
  return cachedAgent;
}

/**
 * 返回 undici Dispatcher（仅 HTTP(S) 代理使用）。
 * 这是给 native fetch 用的代理接入方式，替代 node-fetch + http.Agent 组合。
 */
function getDispatcher(): Dispatcher | undefined {
  if (!isProxyEnabled()) return undefined;
  const url = getProxyUrl();
  if (!url || isSocks(url)) return undefined;
  if (url === cachedUrl && cachedDispatcher) return cachedDispatcher;

  cachedDispatcher = new ProxyAgent({ uri: url, connectTimeout: 30000 });
  cachedUrl = url;
  return cachedDispatcher;
}

/**
 * 返回供 Cloudflare SDK 注入用的 fetch 函数。
 * - 无代理 / HTTP(S) 代理 → 原生 fetch（Node 18+ 内置 undici），HTTP(S) 代理走 dispatcher
 * - SOCKS 代理 → node-fetch + SocksProxyAgent（undici 不支持 socks）
 * 这样能彻底绕开 SDK 内嵌 node-fetch@2 在 Node 22/24 下的 "Premature close" 问题。
 */
export function getSdkFetch(): FetchFn {
  const url = isProxyEnabled() ? getProxyUrl() : '';

  if (url && isSocks(url)) {
    const agent = getHttpAgent();
    return (input: any, init?: any) => (nodeFetch as any)(input, { ...init, agent });
  }

  if (url) {
    const dispatcher = getDispatcher();
    return (input: any, init?: any) => nativeFetch(input, { ...init, dispatcher });
  }

  return nativeFetch;
}

/**
 * 统一的出站请求入口。
 * - 无代理：原生 fetch
 * - HTTP(S) 代理：原生 fetch + undici dispatcher
 * - SOCKS 代理：node-fetch + SocksProxyAgent（含 ECONNRESET / EPIPE 单次重建重试）
 */
export async function proxyFetch(input: string | URL, init?: any): Promise<FetchResponse> {
  const url = isProxyEnabled() ? getProxyUrl() : '';

  // 无代理：直接走原生 fetch
  if (!url) {
    return (await nativeFetch(input as any, init)) as unknown as FetchResponse;
  }

  // SOCKS 代理：仍走 node-fetch + agent
  if (isSocks(url)) {
    const agent = getHttpAgent();
    const doFetch = () => nodeFetch(input.toString(), { ...init, agent });
    try {
      return (await doFetch()) as unknown as FetchResponse;
    } catch (err: any) {
      if (err && (err.code === 'ECONNRESET' || err.code === 'EPIPE')) {
        resetCache();
        const newAgent = getHttpAgent();
        return (await nodeFetch(input.toString(), { ...init, agent: newAgent })) as unknown as FetchResponse;
      }
      throw err;
    }
  }

  // HTTP(S) 代理：原生 fetch + undici dispatcher
  const dispatcher = getDispatcher();
  const resp = await nativeFetch(input as any, { ...init, dispatcher });
  return resp as unknown as FetchResponse;
}

export function buildCurlCommand(url: string, init?: any): string {
  const proxyUrl = getProxyUrl();
  const parts = ['curl -s'];
  if (proxyUrl) parts.push(`-x '${proxyUrl}'`);
  if (init?.method && init.method !== 'GET') parts.push(`-X ${init.method}`);
  if (init?.headers) {
    for (const [k, v] of Object.entries(init.headers)) {
      const val = k.toLowerCase() === 'authorization' ? (v as string).replace(/^(Bearer\s+).+/, '$1***') : v;
      parts.push(`-H '${k}: ${val}'`);
    }
  }
  if (init?.body) {
    const body = typeof init.body === 'string' ? init.body : JSON.stringify(init.body);
    const truncated = body.length > 500 ? body.substring(0, 500) + '...' : body;
    parts.push(`-d '${truncated.replace(/'/g, "'\\''")}'`);
  }
  parts.push(`'${url}'`);
  return parts.join(' \\\n  ');
}

export async function testProxyConnection(proxyUrl: string): Promise<{ latency_ms: number; status: number }> {
  const target = 'https://api.cloudflare.com/client/v4/ips';
  const start = Date.now();

  if (isSocks(proxyUrl)) {
    const agent = new SocksProxyAgent(proxyUrl);
    const resp = await nodeFetch(target, { agent, timeout: 10000 });
    const latency = Date.now() - start;
    if (!resp.ok) throw new Error(`Upstream returned HTTP ${resp.status}`);
    return { latency_ms: latency, status: resp.status };
  }

  const dispatcher = new ProxyAgent({ uri: proxyUrl, connectTimeout: 10000 });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const resp = await nativeFetch(target, { dispatcher, signal: controller.signal });
    const latency = Date.now() - start;
    if (!resp.ok) throw new Error(`Upstream returned HTTP ${resp.status}`);
    return { latency_ms: latency, status: resp.status };
  } finally {
    clearTimeout(timer);
  }
}

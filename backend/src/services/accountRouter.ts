import NodeCache from 'node-cache';
import { getActiveAccounts, getActiveAccountsByFeature, Account, AccountFeature, hasFeature } from '../models/account';
import { getCfClient } from './cfFactory';
import { ResourceType } from './quotaTracker';
import { getQuotaByAccount } from '../models/quotaUsage';
import { appLogger } from './logger';

const ZONES_CACHE_TTL = 300; // 5 minutes
const QUOTA_CACHE_TTL = 60;  // 1 minute

interface Zone {
  id: string;
  name: string;
  status: string;
  account: { id: string; name: string };
}

const zonesCache = new NodeCache({ stdTTL: ZONES_CACHE_TTL });
const quotaCache = new NodeCache({ stdTTL: QUOTA_CACHE_TTL });

export async function getAllZones(): Promise<Array<Zone & { cfAccountId: number; accountName: string }>> {
  const cacheKey = 'all_zones';
  const cached = zonesCache.get<Array<Zone & { cfAccountId: number; accountName: string }>>(cacheKey);
  if (cached) return cached;

  const accounts = getActiveAccountsByFeature('dns');

  const results = await Promise.all(accounts.map(async (account) => {
    try {
      const cf = getCfClient(account);
      const zones: Zone[] = [];
      for await (const zone of cf.zones.list({ per_page: 100 })) {
        zones.push(zone as any);
      }
      return zones.map(zone => ({ ...zone, cfAccountId: account.id, accountName: account.name }));
    } catch (err) {
      appLogger.error(`Failed to fetch zones for account ${account.name}: ${err}`);
      return [];
    }
  }));
  const allZones = results.flat();

  zonesCache.set(cacheKey, allZones);
  return allZones;
}

export async function findAccountByDomain(domain: string): Promise<{ account: Account; zoneId: string }> {
  const zones = await getAllZones();
  const zone = zones.find(z => z.name === domain);
  if (!zone) {
    throw Object.assign(new Error(`Domain ${domain} not found in any account`), { statusCode: 404, code: 'DOMAIN_NOT_FOUND' });
  }
  const account = getActiveAccounts().find(a => a.id === zone.cfAccountId);
  if (!account) {
    throw Object.assign(new Error('Account not found'), { statusCode: 500, code: 'ACCOUNT_NOT_FOUND' });
  }
  return { account, zoneId: zone.id };
}

const AI_NEURON_LIMIT = 10000;

// round-robin 计数器：避免请求集中打同一个账号，触发 300 req/min 限制
let rrCounter = 0;

const RESOURCE_FEATURE_MAP: Record<ResourceType, AccountFeature> = {
  ai_neurons: 'ai',
  workers_requests: 'workers',
  browser_render_seconds: 'browser_render',
};

export async function selectBestAccount(resource: ResourceType): Promise<Account> {
  const cacheKey = `best_account_${resource}`;
  const cached = quotaCache.get<{ account: Account }>(cacheKey);
  if (cached) return cached.account;

  const feature = RESOURCE_FEATURE_MAP[resource];
  const accounts = feature ? getActiveAccountsByFeature(feature) : getActiveAccounts();
  if (accounts.length === 0) {
    throw Object.assign(new Error('No active accounts'), { statusCode: 400, code: 'NO_ACCOUNTS' });
  }

  // 过滤掉 4006 硬标记的账号
  const available = filterExhausted(accounts, resource);
  if (available.length === 0) {
    throw Object.assign(new Error('All accounts exhausted'), { statusCode: 400, code: 'NO_ACCOUNTS' });
  }

  // 返回第一个可用账号（selectBestAccount 用于列表查询等非推理场景，不需要轮转）
  const best = available[0];
  quotaCache.set(cacheKey, { account: best });
  return best;
}

// 本地额度上限映射（与 quotaTracker.LIMITS 保持一致；这里独立写一份避免循环依赖）
const RESOURCE_LIMIT_MAP: Record<ResourceType, number> = {
  ai_neurons: AI_NEURON_LIMIT,
  workers_requests: 100000,
  browser_render_seconds: 600,
};

// 过滤掉本地已标记耗尽的账号（4006 之后 setQuota(LIMIT) 写下的硬标记，今日内不再轮询）
function filterExhausted(accounts: Account[], resource: ResourceType): Account[] {
  const today = new Date().toISOString().split('T')[0];
  const limit = RESOURCE_LIMIT_MAP[resource];
  return accounts.filter(account => {
    const usage = getQuotaByAccount(account.id, resource, today);
    return !usage || usage.count < limit;
  });
}

export async function getAccountsByPriority(resource: ResourceType): Promise<Account[]> {
  const feature = RESOURCE_FEATURE_MAP[resource];
  const allAccounts = feature ? getActiveAccountsByFeature(feature) : getActiveAccounts();
  if (allAccounts.length === 0) return [];

  // 过滤掉 4006 硬标记的账号（本地 SQLite 查询，毫秒级）
  const accounts = filterExhausted(allAccounts, resource);
  if (accounts.length === 0) {
    appLogger.warn(`[Router] All ${allAccounts.length} accounts marked exhausted for ${resource} today`);
    return [];
  }

  // round-robin: 旋转数组起点，均匀分散请求到各账号，避免集中触发 300 req/min 限制
  // 不再每次请求查 Cloudflare GraphQL 额度，额度数据由仪表盘 /api/quota 按需刷新
  if (accounts.length > 1) {
    const offset = rrCounter % accounts.length;
    rrCounter = (rrCounter + 1) % accounts.length;
    if (offset > 0) {
      return [...accounts.slice(offset), ...accounts.slice(0, offset)];
    }
  }

  return accounts;
}

export function clearCache(): void {
  zonesCache.flushAll();
  quotaCache.flushAll();
}

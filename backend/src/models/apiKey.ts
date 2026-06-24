import crypto from 'crypto';
import { getDb } from '../db';

export interface ApiKey {
  id: number;
  name: string;
  key_prefix: string;
  key_hash: string;
  default_model: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

export interface ApiKeyInput {
  name: string;
  default_model?: string | null;
  is_active?: number;
}

const KEY_PREFIX_LITERAL = 'sk-cf-';

export function hashKey(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export function generateApiKey(): { raw: string; prefix: string; hash: string } {
  // 24 字节 -> base64url ≈ 32 字符，加前缀总长 ~38 字符
  const random = crypto.randomBytes(24).toString('base64url');
  const raw = KEY_PREFIX_LITERAL + random;
  // 展示用：sk-cf-xxxxxx...xxxx
  const prefix = raw.slice(0, 10) + '...' + raw.slice(-4);
  return { raw, prefix, hash: hashKey(raw) };
}

export function listApiKeys(): ApiKey[] {
  return getDb().prepare('SELECT * FROM api_keys ORDER BY created_at DESC').all() as ApiKey[];
}

export function getApiKeyById(id: number): ApiKey | undefined {
  return getDb().prepare('SELECT * FROM api_keys WHERE id = ?').get(id) as ApiKey | undefined;
}

export function findApiKeyByRaw(raw: string): ApiKey | undefined {
  const hash = hashKey(raw);
  return getDb()
    .prepare('SELECT * FROM api_keys WHERE key_hash = ? AND is_active = 1')
    .get(hash) as ApiKey | undefined;
}

export function createApiKey(input: ApiKeyInput): { id: number; raw: string; prefix: string } {
  const { raw, prefix, hash } = generateApiKey();
  const stmt = getDb().prepare(
    'INSERT INTO api_keys (name, key_prefix, key_hash, default_model, is_active) VALUES (?, ?, ?, ?, ?)'
  );
  const result = stmt.run(
    input.name,
    prefix,
    hash,
    input.default_model || null,
    input.is_active ?? 1
  );
  return { id: result.lastInsertRowid as number, raw, prefix };
}

export function updateApiKey(id: number, input: Partial<ApiKeyInput>): void {
  const fields: string[] = [];
  const values: any[] = [];
  if (input.name !== undefined) { fields.push('name = ?'); values.push(input.name); }
  if (input.default_model !== undefined) { fields.push('default_model = ?'); values.push(input.default_model); }
  if (input.is_active !== undefined) { fields.push('is_active = ?'); values.push(input.is_active); }
  if (!fields.length) return;
  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);
  getDb().prepare(`UPDATE api_keys SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function deleteApiKey(id: number): void {
  getDb().prepare('DELETE FROM api_keys WHERE id = ?').run(id);
}

export function touchLastUsed(id: number): void {
  getDb().prepare('UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
}

export function incrementApiKeyUsage(
  apiKeyId: number,
  accountId: number,
  model: string,
  tokens: number,
  requests: number = 1
): void {
  const today = new Date().toISOString().split('T')[0];
  getDb()
    .prepare(
      `INSERT INTO api_key_usage (api_key_id, date, account_id, model, requests, total_tokens)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(api_key_id, date, account_id, model) DO UPDATE SET
         requests = requests + ?,
         total_tokens = total_tokens + ?`
    )
    .run(apiKeyId, today, accountId, model, requests, tokens, requests, tokens);
}

export interface ApiKeyUsageRow {
  api_key_id: number;
  date: string;
  account_id: number | null;
  account_name: string | null;
  model: string;
  requests: number;
  total_tokens: number;
}

export function getApiKeyUsage(apiKeyId: number, date?: string): ApiKeyUsageRow[] {
  if (date) {
    return getDb()
      .prepare(
        `SELECT u.*, acc.name AS account_name
         FROM api_key_usage u LEFT JOIN accounts acc ON u.account_id = acc.id
         WHERE u.api_key_id = ? AND u.date = ?
         ORDER BY u.total_tokens DESC`
      )
      .all(apiKeyId, date) as ApiKeyUsageRow[];
  }
  return getDb()
    .prepare(
      `SELECT u.*, acc.name AS account_name
       FROM api_key_usage u LEFT JOIN accounts acc ON u.account_id = acc.id
       WHERE u.api_key_id = ?
       ORDER BY u.date DESC, u.total_tokens DESC`
    )
    .all(apiKeyId) as ApiKeyUsageRow[];
}

export interface ApiKeyStatRow {
  api_key_id: number;
  today_requests: number;
  today_tokens: number;
  total_requests: number;
  total_tokens: number;
}

export function getApiKeyStats(): Map<number, ApiKeyStatRow> {
  const today = new Date().toISOString().split('T')[0];
  const rows = getDb()
    .prepare(
      `SELECT 
         api_key_id,
         SUM(CASE WHEN date = ? THEN requests ELSE 0 END) AS today_requests,
         SUM(CASE WHEN date = ? THEN total_tokens ELSE 0 END) AS today_tokens,
         SUM(requests) AS total_requests,
         SUM(total_tokens) AS total_tokens
       FROM api_key_usage
       GROUP BY api_key_id`
    )
    .all(today, today) as ApiKeyStatRow[];
  const map = new Map<number, ApiKeyStatRow>();
  for (const r of rows) map.set(r.api_key_id, r);
  return map;
}

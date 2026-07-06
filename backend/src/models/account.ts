import { getDb } from '../db';

export type AccountFeature = 'ai' | 'workers' | 'browser_render' | 'dns' | 'storage';

export const ALL_FEATURES: AccountFeature[] = ['ai', 'workers', 'browser_render', 'dns', 'storage'];

export interface Account {
  id: number;
  name: string;
  auth_type: 'token' | 'global_key';
  api_token: string | null;
  api_key: string | null;
  email: string | null;
  account_id: string | null;
  is_active: number;
  enabled_features: string;
  source: 'manual' | 'imported';
  created_at: string;
  updated_at: string;
}

export interface AccountInput {
  name: string;
  auth_type: 'token' | 'global_key';
  api_token?: string;
  api_key?: string;
  email?: string;
  account_id?: string;
  enabled_features?: string;
  source?: 'manual' | 'imported';
}

export function hasFeature(account: Account, feature: AccountFeature): boolean {
  const features = (account.enabled_features || ALL_FEATURES.join(',')).split(',');
  return features.includes(feature);
}

export function getActiveAccountsByFeature(feature: AccountFeature): Account[] {
  return getActiveAccounts().filter(a => hasFeature(a, feature));
}

export function getAllAccounts(): Account[] {
  return getDb().prepare('SELECT * FROM accounts ORDER BY created_at DESC').all() as Account[];
}

export function getActiveAccounts(): Account[] {
  return getDb().prepare('SELECT * FROM accounts WHERE is_active = 1 ORDER BY created_at DESC').all() as Account[];
}

export function getAccountById(id: number): Account | undefined {
  return getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(id) as Account | undefined;
}

export function createAccount(input: AccountInput): number {
  const features = input.enabled_features || ALL_FEATURES.join(',');
  const source = input.source || 'manual';
  const stmt = getDb().prepare(
    'INSERT INTO accounts (name, auth_type, api_token, api_key, email, account_id, enabled_features, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const result = stmt.run(
    input.name,
    input.auth_type,
    input.api_token || null,
    input.api_key || null,
    input.email || null,
    input.account_id || null,
    features,
    source
  );
  return result.lastInsertRowid as number;
}

export function getAccountByAccountId(accountId: string): Account | undefined {
  return getDb().prepare('SELECT * FROM accounts WHERE account_id = ?').get(accountId) as Account | undefined;
}

export function updateAccountFeatures(id: number, features: string): void {
  getDb().prepare('UPDATE accounts SET enabled_features = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(features, id);
}

export function deleteAccount(id: number): void {
  getDb().prepare('DELETE FROM accounts WHERE id = ?').run(id);
}

export function updateAccountStatus(id: number, isActive: boolean): void {
  getDb().prepare('UPDATE accounts SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(isActive ? 1 : 0, id);
}

export function updateAccountId(id: number, accountId: string): void {
  getDb().prepare('UPDATE accounts SET account_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(accountId, id);
}

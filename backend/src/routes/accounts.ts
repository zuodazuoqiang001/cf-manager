import { Router, Request, Response, NextFunction } from 'express';
import { getAllAccounts, createAccount, deleteAccount, getAccountById, getAccountByAccountId, updateAccountStatus, updateAccountId, updateAccountFeatures, AccountInput } from '../models/account';
import { encrypt } from '../services/encryptionService';
import { getCfClient } from '../services/cfFactory';
import { getQuotaSummary } from '../services/quotaTracker';
import { clearCache } from '../services/accountRouter';
import { appLogger } from '../services/logger';
import { createAuditLog } from '../models/auditLog';

const router = Router();

router.get('/', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const accounts = getAllAccounts().map(a => ({
      ...a,
      api_token: a.api_token ? '***encrypted***' : null,
      api_key: a.api_key ? '***encrypted***' : null,
    }));
    const quota = getQuotaSummary();
    res.json({ accounts, quota });
  } catch (err) { next(err); }
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, auth_type, account_id, api_token, api_key, email } = req.body;
    if (!name || !auth_type) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'name and auth_type are required' } });
      return;
    }
    if (auth_type !== 'token' && auth_type !== 'global_key') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'auth_type must be "token" or "global_key"' } });
      return;
    }
    if (auth_type === 'token' && !api_token) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'api_token is required for token auth' } });
      return;
    }
    if (auth_type === 'global_key' && (!api_key || !email)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'api_key and email are required for global_key auth' } });
      return;
    }

    const input: AccountInput = { name, auth_type, account_id, enabled_features: req.body.enabled_features };
    if (auth_type === 'token') {
      input.api_token = encrypt(api_token);
    } else {
      input.api_key = encrypt(api_key);
      input.email = email;
    }
    const id = createAccount(input);

    // 创建后自动获取并存储 Cloudflare Account ID
    if (!account_id) {
      try {
        const saved = getAccountById(id);
        if (saved) {
          const cf = getCfClient(saved);
          await cf.user.get(); // 验证凭证有效性
          const accts: any[] = [];
          for await (const acct of cf.accounts.list()) {
            accts.push(acct as any);
          }
          if (accts.length > 0) {
            updateAccountId(id, accts[0].id);
            appLogger.info(`[Account] Auto-fetched account_id=${accts[0].id} for "${name}"`);
          }
          updateAccountStatus(id, true);
        }
      } catch (e) {
        appLogger.warn(`[Account] Failed to auto-fetch account_id for "${name}": ${e}`);
      }
    }

    createAuditLog(id, 'create_account', name, `auth_type=${auth_type}`, 'success');
    res.status(201).json({ id, ...input, api_token: '***', api_key: '***' });
  } catch (err) { next(err); }
});

router.post('/import', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { accounts } = req.body;
    if (!Array.isArray(accounts)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'accounts array is required' } });
      return;
    }

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const item of accounts) {
      // 只导入 COMPLETED 状态的账号
      if (item.status !== 'COMPLETED') {
        skipped++;
        continue;
      }
      // 必须有 apiKey、accountId 和 email
      if (!item.apiKey || !item.accountId || !item.email) {
        skipped++;
        continue;
      }
      // 跳过重复（按 accountId 判断）
      const existing = getAccountByAccountId(item.accountId);
      if (existing) {
        skipped++;
        continue;
      }

      try {
        // cfk_ 前缀是 Cloudflare Global API Key，使用 global_key 认证方式
        const id = createAccount({
          name: item.email,
          auth_type: 'global_key',
          api_key: encrypt(item.apiKey),
          email: item.email,
          account_id: item.accountId,
          enabled_features: 'ai',
          source: 'imported',
        });
        // 导入的账号直接标记为活跃
        updateAccountStatus(id, true);
        createAuditLog(id, 'import_account', item.email || item.accountId, 'batch import', 'success');
        imported++;
      } catch (e: any) {
        errors.push(`${item.email || item.accountId}: ${e.message}`);
      }
    }

    if (imported > 0) clearCache();
    appLogger.info(`[Import] Batch import: ${imported} imported, ${skipped} skipped, ${errors.length} errors`);
    res.status(201).json({ imported, skipped, errors });
  } catch (err) { next(err); }
});

router.patch('/:id/features', (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const account = getAccountById(id);
    if (!account) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Account not found' } }); return; }
    const { enabled_features } = req.body;
    if (typeof enabled_features !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'enabled_features is required' } });
      return;
    }
    updateAccountFeatures(id, enabled_features);
    clearCache();
    createAuditLog(id, 'update_features', account.name, enabled_features, 'success');
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.delete('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const account = getAccountById(id);
    if (!account) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Account not found' } }); return; }
    createAuditLog(id, 'delete_account', account.name, null, 'success');
    deleteAccount(id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.post('/:id/test', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const accountId = parseInt(req.params.id as string, 10);
    const account = getAccountById(accountId);
    if (!account) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Account not found' } }); return; }
    const cf = getCfClient(account);
    const user = await cf.user.get();

    // 自动获取并存储 Cloudflare Account ID
    if (!account.account_id) {
      try {
        const accounts: any[] = [];
        for await (const acct of cf.accounts.list()) {
          accounts.push(acct as any);
        }
        if (accounts.length > 0) {
          updateAccountId(accountId, accounts[0].id);
        }
      } catch (e) {
        // 获取账号列表失败不是致命错误，继续返回测试结果
        appLogger.warn(`Failed to fetch account list: ${e}`);
      }
    }

    // 测试成功，更新状态为活跃
    updateAccountStatus(accountId, true);
    res.json({ success: true, user });
  } catch (err) { next(err); }
});

export default router;

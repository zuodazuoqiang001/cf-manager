import { Router } from 'express';
import {
  listApiKeys,
  getApiKeyById,
  createApiKey,
  updateApiKey,
  deleteApiKey,
  getApiKeyStats,
  getApiKeyUsage,
} from '../models/apiKey';

const router = Router();

// 列表：返回 key 元信息 + 用量汇总（不返回 key_hash）
router.get('/', (_req, res, next) => {
  try {
    const keys = listApiKeys();
    const stats = getApiKeyStats();
    res.json(keys.map(k => {
      const { key_hash, ...rest } = k;
      return {
        ...rest,
        stats: stats.get(k.id) || {
          today_requests: 0,
          today_tokens: 0,
          total_requests: 0,
          total_tokens: 0,
        },
      };
    }));
  } catch (err) { next(err); }
});

// 新增：仅在此处返回原始 key，调用方必须保存
router.post('/', (req, res, next) => {
  try {
    const { name, default_model } = req.body;
    if (!name || typeof name !== 'string') {
      throw Object.assign(new Error('name is required'), { statusCode: 400 });
    }
    const result = createApiKey({
      name: name.trim(),
      default_model: default_model || null,
    });
    res.json(result);
  } catch (err) { next(err); }
});

router.put('/:id', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!getApiKeyById(id)) {
      throw Object.assign(new Error('API Key not found'), { statusCode: 404 });
    }
    const { name, default_model, is_active } = req.body;
    updateApiKey(id, {
      name,
      default_model,
      is_active: typeof is_active === 'boolean' ? (is_active ? 1 : 0) : is_active,
    });
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.delete('/:id', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    deleteApiKey(id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.get('/:id/usage', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const date = req.query.date as string | undefined;
    res.json(getApiKeyUsage(id, date));
  } catch (err) { next(err); }
});

export default router;

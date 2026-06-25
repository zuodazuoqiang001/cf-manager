import { Router, Request, Response, NextFunction } from 'express';
import { selectBestAccount, getAccountsByPriority, clearCache } from '../services/accountRouter';
import { getAvailableModels } from '../services/aiService';
import { getAuthHeaders } from '../services/cfFactory';
import { createAuditLog } from '../models/auditLog';
import { setQuota } from '../models/quotaUsage';
import { incrementApiKeyUsage } from '../models/apiKey';
import { v1AuthMiddleware } from '../middleware/v1Auth';
import { proxyFetch } from '../services/proxyService';
import { appLogger } from '../services/logger';
import { convertResponsesRequest, convertChatCompletionToResponse, convertStreamToResponsesSSE } from '../services/responsesAdapter';

const router = Router();

// 强制 API Key 鉴权：/v1/* 下的所有路由都走这里
router.use(v1AuthMiddleware);

function isNeuronLimitError(text: string): boolean {
  return text.includes('4006') || text.includes('daily free allocation') || text.includes('neuron limit');
}

router.get('/models', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const account = await selectBestAccount('ai_neurons');
    const models = await getAvailableModels(account);
    const data = models.map((m: any) => ({
      id: m.name || m.id,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'cloudflare',
    }));
    res.json({ object: 'list', data });
  } catch (err) { next(err); }
});

router.post('/chat/completions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const apiKey = req.apiKey; // 由 v1AuthMiddleware 注入

    // default_model 兜底：客户端未传 model 时使用
    if (!req.body.model && apiKey?.default_model) {
      req.body.model = apiKey.default_model;
    }
    if (!req.body.model) {
      res.status(400).json({
        error: {
          message: 'model is required (and no default_model is set on this API key)',
          type: 'invalid_request_error',
          code: 'MODEL_REQUIRED',
        },
      });
      return;
    }
    const model: string = req.body.model;

    const accounts = await getAccountsByPriority('ai_neurons');
    if (accounts.length === 0) {
      res.status(503).json({
        error: { message: 'No active accounts available (all may be exhausted today)', type: 'service_error', code: 'NO_ACCOUNTS' },
      });
      return;
    }

    const isStream = req.body.stream === true;
    let lastError = '';

    for (const account of accounts) {
      if (!account.account_id) continue;

      const cfUrl = `https://api.cloudflare.com/client/v4/accounts/${account.account_id}/ai/v1/chat/completions`;
      const headers = { 'Content-Type': 'application/json', ...getAuthHeaders(account) };

      const cfResp = await proxyFetch(cfUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(req.body),
      });

      if (!cfResp.ok) {
        const errorText = await cfResp.text();

        if (isNeuronLimitError(errorText)) {
          appLogger.warn(`[AI] Account ${account.name} neuron limit hit (4006)`);
          setQuota(account.id, 'ai_neurons', 10000);
          clearCache();
          createAuditLog(account.id, 'ai_inference', model, '4006 neuron limit, switching', 'error');
          if (accounts.indexOf(account) < accounts.length - 1) {
            lastError = errorText;
            continue;
          }
        }

        res.status(cfResp.status).json({
          error: { message: errorText, type: 'upstream_error', code: cfResp.status },
        });
        return;
      }

      if (isStream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        if (cfResp.body) {
          const body = cfResp.body as any;
          try {
            if (typeof body.getReader === 'function') {
              const reader = body.getReader();
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(Buffer.from(value));
              }
            } else if (typeof body.pipe === 'function') {
              await new Promise<void>((resolve, reject) => {
                body.pipe(res, { end: false });
                body.on('end', resolve);
                body.on('error', reject);
              });
            }
          } catch { /* client disconnected */ }
        }
        res.end();
        createAuditLog(account.id, 'ai_inference', model, 'stream via /v1', 'success');
        // 流式拿不到 token 统计，只计 1 次请求
        if (apiKey) incrementApiKeyUsage(apiKey.id, account.id, model, 0, 1);
      } else {
        const data = await cfResp.json() as any;
        res.json(data);
        const tokens = data?.usage?.total_tokens || 0;
        createAuditLog(account.id, 'ai_inference', model, `tokens: ${tokens || '?'}`, 'success');
        if (apiKey) incrementApiKeyUsage(apiKey.id, account.id, model, tokens, 1);
      }
      return;
    }

    res.status(429).json({
      error: {
        message: lastError || 'All accounts have reached daily neuron limit',
        type: 'quota_exceeded',
        code: 'ALL_ACCOUNTS_EXHAUSTED',
      },
    });
  } catch (err) { next(err); }
});

/**
 * POST /v1/responses — OpenAI Responses API 兼容端点
 *
 * Codex CLI 强制使用 wire_api="responses"，此处将 Responses 请求
 * 转为 Chat Completions 发给 Cloudflare，响应再转回 Responses 格式。
 */
router.post('/responses', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const apiKey = req.apiKey;

    // default_model 兜底
    if (!req.body.model && apiKey?.default_model) {
      req.body.model = apiKey.default_model;
    }
    if (!req.body.model) {
      res.status(400).json({
        error: {
          message: 'model is required (and no default_model is set on this API key)',
          type: 'invalid_request_error',
          code: 'MODEL_REQUIRED',
        },
      });
      return;
    }
    const model: string = req.body.model;

    // 转换 Responses 请求 → Chat Completions 请求
    const chatBody = convertResponsesRequest(req.body);
    const isStream = chatBody.stream === true;

    const accounts = await getAccountsByPriority('ai_neurons');
    if (accounts.length === 0) {
      res.status(503).json({
        error: { message: 'No active accounts available (all may be exhausted today)', type: 'server_error', code: 'NO_ACCOUNTS' },
      });
      return;
    }

    let lastError = '';

    for (const account of accounts) {
      if (!account.account_id) continue;

      const cfUrl = `https://api.cloudflare.com/client/v4/accounts/${account.account_id}/ai/v1/chat/completions`;
      const headers = { 'Content-Type': 'application/json', ...getAuthHeaders(account) };

      const cfResp = await proxyFetch(cfUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(chatBody),
      });

      if (!cfResp.ok) {
        const errorText = await cfResp.text();

        if (isNeuronLimitError(errorText)) {
          appLogger.warn(`[AI] Account ${account.name} neuron limit hit (4006)`);
          setQuota(account.id, 'ai_neurons', 10000);
          clearCache();
          createAuditLog(account.id, 'ai_inference', model, '4006 neuron limit, switching', 'error');
          if (accounts.indexOf(account) < accounts.length - 1) {
            lastError = errorText;
            continue;
          }
        }

        res.status(cfResp.status).json({
          error: { message: errorText, type: 'server_error', code: cfResp.status },
        });
        return;
      }

      if (isStream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        try {
          for await (const sseLine of convertStreamToResponsesSSE(cfResp, model)) {
            res.write(sseLine);
          }
        } catch { /* client disconnected */ }
        res.end();
        createAuditLog(account.id, 'ai_inference', model, 'stream via /v1/responses', 'success');
        if (apiKey) incrementApiKeyUsage(apiKey.id, account.id, model, 0, 1);
      } else {
        const data = await cfResp.json() as any;
        const responsesData = convertChatCompletionToResponse(data, model);
        res.json(responsesData);
        const tokens = data?.usage?.total_tokens || 0;
        createAuditLog(account.id, 'ai_inference', model, `tokens: ${tokens || '?'}`, 'success');
        if (apiKey) incrementApiKeyUsage(apiKey.id, account.id, model, tokens, 1);
      }
      return;
    }

    res.status(429).json({
      error: {
        message: lastError || 'All accounts have reached daily neuron limit',
        type: 'rate_limit_error',
        code: 'ALL_ACCOUNTS_EXHAUSTED',
      },
    });
  } catch (err) { next(err); }
});

export default router;

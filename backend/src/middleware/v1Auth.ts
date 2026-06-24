import { Request, Response, NextFunction } from 'express';
import { findApiKeyByRaw, touchLastUsed, ApiKey } from '../models/apiKey';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      apiKey?: ApiKey;
    }
  }
}

function unauthorized(res: Response, message: string, code: string): void {
  res.status(401).json({
    error: { message, type: 'auth_error', code },
  });
}

export function v1AuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    unauthorized(res, 'Missing Authorization header. Use: Authorization: Bearer sk-cf-...', 'UNAUTHORIZED');
    return;
  }
  const token = authHeader.substring(7).trim();
  if (!token) {
    unauthorized(res, 'Empty bearer token', 'UNAUTHORIZED');
    return;
  }
  const apiKey = findApiKeyByRaw(token);
  if (!apiKey) {
    unauthorized(res, 'Invalid API key', 'INVALID_API_KEY');
    return;
  }
  req.apiKey = apiKey;
  // 异步更新 last_used，不阻塞请求；better-sqlite3 是同步的，这里直接调即可
  try { touchLastUsed(apiKey.id); } catch { /* ignore */ }
  next();
}

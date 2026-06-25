import { Router, Request, Response, NextFunction } from 'express';
import { getCallLogs, cleanCallLogs, getCallLogStats } from '../models/aiCallLog';

const router = Router();

/** GET /api/ai-call-logs — 分页列表，支持 ?limit=&offset=&api_key_id=&status= */
router.get('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '20'), 10) || 20, 1), 200);
    const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);
    const apiKeyIdRaw = req.query.api_key_id;
    const status = req.query.status as string | undefined;

    let apiKeyId: number | undefined;
    if (apiKeyIdRaw !== undefined && apiKeyIdRaw !== '' && apiKeyIdRaw !== 'null') {
      const n = parseInt(String(apiKeyIdRaw), 10);
      if (!isNaN(n)) apiKeyId = n;
    }

    const result = getCallLogs({ limit, offset, apiKeyId, status });
    res.json(result);
  } catch (err) { next(err); }
});

/** GET /api/ai-call-logs/stats — 统计概览 */
router.get('/stats', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = getCallLogStats();
    res.json(stats);
  } catch (err) { next(err); }
});

/** DELETE /api/ai-call-logs — 清理日志，?before_date=2025-01-01 只删该日期之前 */
router.delete('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const beforeDate = req.query.before_date as string | undefined;
    const deleted = cleanCallLogs(beforeDate);
    res.json({ deleted });
  } catch (err) { next(err); }
});

export default router;

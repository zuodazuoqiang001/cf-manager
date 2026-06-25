import { getDb } from '../db';
import { appLogger } from '../services/logger';

export interface AiCallLog {
  id: number;
  api_key_id: number | null;
  api_key_name: string | null;
  account_id: number | null;
  account_name: string | null;
  endpoint: string;
  model: string;
  request_summary: string | null;
  response_summary: string | null;
  status: string;
  error_message: string | null;
  input_tokens: number;
  output_tokens: number;
  duration_ms: number;
  created_at: string;
}

export interface AiCallLogQuery {
  limit: number;
  offset: number;
  apiKeyId?: number;
  status?: string;
}

export interface AiCallLogResult {
  data: AiCallLog[];
  total: number;
}

/** 截取摘要（前 500 字符） */
function summarize(text: string | null | undefined, maxLen = 500): string | null {
  if (!text) return null;
  const s = typeof text === 'string' ? text : JSON.stringify(text);
  return s.length > maxLen ? s.slice(0, maxLen) + '...' : s;
}

/**
 * 异步写入调用日志（fire-and-forget，不阻塞请求）
 */
export function logAiCall(params: {
  apiKeyId?: number | null;
  apiKeyName?: string | null;
  accountId?: number | null;
  accountName?: string | null;
  endpoint: string;
  model: string;
  requestBody?: any;
  responseBody?: any;
  status: 'success' | 'error';
  errorMessage?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
}): void {
  // fire-and-forget：用 setImmediate 异步执行，不阻塞当前请求
  setImmediate(() => {
    try {
      getDb()
        .prepare(
          `INSERT INTO ai_call_logs
            (api_key_id, api_key_name, account_id, account_name, endpoint, model,
             request_summary, response_summary, status, error_message,
             input_tokens, output_tokens, duration_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          params.apiKeyId ?? null,
          params.apiKeyName ?? null,
          params.accountId ?? null,
          params.accountName ?? null,
          params.endpoint,
          params.model,
          summarize(params.requestBody ? JSON.stringify(params.requestBody) : null),
          summarize(params.responseBody ? JSON.stringify(params.responseBody) : null),
          params.status,
          params.errorMessage ?? null,
          params.inputTokens ?? 0,
          params.outputTokens ?? 0,
          params.durationMs ?? 0
        );
    } catch (err) {
      appLogger.error(`[AiCallLog] Failed to log call: ${err}`);
    }
  });
}

/** 分页查询调用日志 */
export function getCallLogs(query: AiCallLogQuery): AiCallLogResult {
  const { limit, offset, apiKeyId, status } = query;
  let where = '';
  const params: any[] = [];

  if (apiKeyId !== undefined && status !== undefined) {
    where = 'WHERE api_key_id = ? AND status = ?';
    params.push(apiKeyId, status);
  } else if (apiKeyId !== undefined) {
    where = 'WHERE api_key_id = ?';
    params.push(apiKeyId);
  } else if (status !== undefined) {
    where = 'WHERE status = ?';
    params.push(status);
  }

  const data = getDb()
    .prepare(
      `SELECT * FROM ai_call_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as AiCallLog[];

  const row = getDb()
    .prepare(`SELECT COUNT(*) AS c FROM ai_call_logs ${where}`)
    .get(...params) as { c: number };

  return { data, total: row.c };
}

/** 清理指定日期之前的日志 */
export function cleanCallLogs(beforeDate?: string): number {
  if (beforeDate) {
    const result = getDb()
      .prepare('DELETE FROM ai_call_logs WHERE created_at < ?')
      .run(beforeDate);
    return result.changes;
  }
  // 不传日期：清空全部
  const result = getDb().prepare('DELETE FROM ai_call_logs').run();
  return result.changes;
}

/** 获取统计数据 */
export function getCallLogStats(): {
  total: number;
  today: number;
  success: number;
  error: number;
  totalInputTokens: number;
  totalOutputTokens: number;
} {
  const row = getDb()
    .prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN date(created_at) = date('now') THEN 1 ELSE 0 END) AS today,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error,
        SUM(input_tokens) AS totalInputTokens,
        SUM(output_tokens) AS totalOutputTokens
       FROM ai_call_logs`
    )
    .get() as any;

  return {
    total: row?.total || 0,
    today: row?.today || 0,
    success: row?.success || 0,
    error: row?.error || 0,
    totalInputTokens: row?.totalInputTokens || 0,
    totalOutputTokens: row?.totalOutputTokens || 0,
  };
}

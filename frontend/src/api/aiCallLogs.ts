import apiClient from './client';

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

export interface AiCallLogResult {
  data: AiCallLog[];
  total: number;
}

export interface AiCallLogStats {
  total: number;
  today: number;
  success: number;
  error: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export const aiCallLogsApi = {
  list(params?: { limit?: number; offset?: number; api_key_id?: number; status?: string }) {
    return apiClient.get<AiCallLogResult>('/api/ai-call-logs', { params });
  },
  stats() {
    return apiClient.get<AiCallLogStats>('/api/ai-call-logs/stats');
  },
  clean(beforeDate?: string) {
    return apiClient.delete<{ deleted: number }>('/api/ai-call-logs', { params: beforeDate ? { before_date: beforeDate } : {} });
  },
};

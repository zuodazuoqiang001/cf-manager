import apiClient from './client';

export interface ApiKeyItem {
  id: number;
  name: string;
  key_prefix: string;
  default_model: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  stats: {
    today_requests: number;
    today_tokens: number;
    total_requests: number;
    total_tokens: number;
  };
}

export const apiKeysApi = {
  list: () => apiClient.get<ApiKeyItem[]>('/api-keys'),
  create: (data: { name: string; default_model?: string | null }) =>
    apiClient.post<{ id: number; raw: string; prefix: string }>('/api-keys', data),
  update: (id: number, data: { name?: string; default_model?: string | null; is_active?: number | boolean }) =>
    apiClient.put(`/api-keys/${id}`, data),
  remove: (id: number) => apiClient.delete(`/api-keys/${id}`),
  getUsage: (id: number, date?: string) =>
    apiClient.get(`/api-keys/${id}/usage`, { params: date ? { date } : {} }),
};

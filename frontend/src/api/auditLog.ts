import apiClient from './client';

export interface AuditLogItem {
  id: number;
  account_id: number | null;
  account_name: string | null;
  action: string;
  target: string | null;
  detail: string | null;
  status: 'success' | 'error';
  created_at: string;
}

export interface AuditLogPage {
  data: AuditLogItem[];
  total: number;
  limit: number;
  offset: number;
}

export const auditLogApi = {
  // 分页查询
  list: (params: { limit?: number; offset?: number; account_id?: number | null }) =>
    apiClient.get<AuditLogPage>('/audit-log', { params }),
};

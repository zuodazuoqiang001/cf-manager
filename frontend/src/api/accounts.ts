import apiClient from './client';

export const accountsApi = {
  getAll: () => apiClient.get('/accounts'),
  create: (data: any) => apiClient.post('/accounts', data),
  batchImport: (accounts: any[]) => apiClient.post('/accounts/import', { accounts }),
  delete: (id: number) => apiClient.delete(`/accounts/${id}`),
  test: (id: number) => apiClient.post(`/accounts/${id}/test`),
  updateFeatures: (id: number, enabled_features: string) =>
    apiClient.patch(`/accounts/${id}/features`, { enabled_features }),
};

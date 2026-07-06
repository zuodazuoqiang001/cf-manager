import { defineStore } from 'pinia';
import { ref } from 'vue';
import apiClient from '../api/client';

const CACHE_KEY = 'cf-manager-quota-cache';

function loadCache(): { data: any[]; ts: number } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.data || !parsed?.ts) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveCache(data: any[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    // ignore quota errors
  }
}

export const useQuotaStore = defineStore('quota', () => {
  const cached = loadCache();
  const quota = ref<any[]>(cached?.data ?? []);
  const lastUpdated = ref<number | null>(cached?.ts ?? null);
  const loading = ref(false);

  async function fetchQuota() {
    loading.value = true;
    try {
      const { data } = await apiClient.get('/quota');
      quota.value = data;
      lastUpdated.value = Date.now();
      saveCache(data);
    } catch {
      // 保留已有缓存数据，不清空
    } finally {
      loading.value = false;
    }
  }

  return { quota, loading, lastUpdated, fetchQuota };
});

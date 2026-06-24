<template>
  <div>
    <n-space align="center">
      <n-h2 style="margin: 0">仪表盘</n-h2>
      <n-tag size="small" type="info">今日额度</n-tag>
      <n-button size="small" tertiary @click="quotaStore.fetchQuota()">刷新</n-button>
    </n-space>

    <n-spin :show="quotaStore.loading" style="margin-top: 16px">
      <!-- 顶部汇总卡：按资源聚合 -->
      <n-grid :cols="3" :x-gap="12" :y-gap="12" responsive="screen" item-responsive>
        <n-gi v-for="r in summary" :key="r.resource" span="3 s:3 m:1">
          <n-card size="small">
            <n-space vertical :size="8">
              <n-space align="center" justify="space-between">
                <n-text strong>{{ resourceLabel(r.resource) }}</n-text>
                <n-tag size="small" :type="percentTagType(r.percentage)">{{ r.percentage }}%</n-tag>
              </n-space>
              <n-text depth="3" style="font-size: 13px">{{ formatValue(r) }}</n-text>
              <n-progress
                type="line"
                :percentage="r.percentage"
                :height="12"
                :show-indicator="false"
                :status="percentStatus(r.percentage)"
              />
              <n-text depth="3" style="font-size: 12px">覆盖 {{ r.accountCount }} 个账号</n-text>
            </n-space>
          </n-card>
        </n-gi>
      </n-grid>

      <!-- 中部账号列表 -->
      <n-h3 style="margin-top: 24px">账号额度列表</n-h3>
      <n-data-table
        :columns="columns"
        :data="quotaWithResources"
        :loading="quotaStore.loading"
        :row-key="(row: any) => row.accountId"
        :row-props="rowProps"
        size="small"
        :bordered="false"
        :scroll-x="900"
      />
      <n-empty
        v-if="!quotaStore.loading && quotaWithResources.length === 0"
        description="暂无账户数据"
        style="margin-top: 16px"
      />
    </n-spin>

    <!-- 右侧抽屉：单账号详情 -->
    <n-drawer v-model:show="drawerVisible" :width="drawerWidth" placement="right">
      <n-drawer-content :title="currentAccount?.accountName || '账号详情'" closable>
        <div v-if="currentAccount">
          <n-text depth="3" style="font-size: 12px">账号 ID: {{ currentAccount.accountId }}</n-text>
          <n-divider style="margin: 12px 0" />
          <div v-for="r in currentAccount.resources" :key="r.resource" style="margin-bottom: 18px">
            <n-space align="center" justify="space-between" style="margin-bottom: 6px">
              <n-text strong>{{ resourceLabel(r.resource) }}</n-text>
              <n-tag size="small" :type="percentTagType(calcPercentage(r))">{{ calcPercentage(r) }}%</n-tag>
            </n-space>
            <n-progress
              type="line"
              :percentage="calcPercentage(r)"
              :height="14"
              :status="percentStatus(calcPercentage(r))"
            />
            <n-text depth="3" style="font-size: 12px; display: block; margin-top: 4px">
              已用 {{ formatNumber(r.resource, r.count) }} / 上限 {{ formatNumber(r.resource, r.limit) }}
              （剩余 {{ formatNumber(r.resource, r.remaining ?? r.limit - r.count) }}）
            </n-text>
          </div>
          <n-empty v-if="!currentAccount.resources?.length" description="暂无额度数据" />
        </div>
      </n-drawer-content>
    </n-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, h } from 'vue';
import { useQuotaStore } from '../stores/quotaStore';
import { NProgress, NText, NSpace } from 'naive-ui';
import type { DataTableColumns } from 'naive-ui';

const quotaStore = useQuotaStore();

const resourceLabels: Record<string, string> = {
  workers_requests: 'Workers 请求',
  ai_neurons: 'AI 神经元',
  browser_render_seconds: '浏览器渲染',
};
const resourceOrder = ['workers_requests', 'ai_neurons', 'browser_render_seconds'];

const quotaWithResources = computed(() =>
  quotaStore.quota.filter((acct: any) => acct.resources && acct.resources.length > 0)
);

// 按资源维度聚合所有账号
const summary = computed(() => {
  return resourceOrder.map((resource) => {
    let count = 0;
    let limit = 0;
    let accountCount = 0;
    for (const acct of quotaWithResources.value) {
      const r = acct.resources.find((x: any) => x.resource === resource);
      if (r) {
        count += r.count || 0;
        limit += r.limit || 0;
        accountCount += 1;
      }
    }
    const percentage = limit > 0 ? Math.min(100, Math.round((count / limit) * 100)) : 0;
    return { resource, count, limit, accountCount, percentage };
  });
});

function resourceLabel(resource: string) {
  return resourceLabels[resource] || resource;
}

function formatNumber(resource: string, value: number) {
  if (resource === 'browser_render_seconds') {
    const v = Math.round(value || 0);
    const m = Math.floor(v / 60);
    const s = v % 60;
    return m > 0 ? `${m}分${s}秒` : `${s}秒`;
  }
  return (value || 0).toLocaleString();
}

function formatValue(r: any) {
  return `${formatNumber(r.resource, r.count)} / ${formatNumber(r.resource, r.limit)}`;
}

function calcPercentage(r: any) {
  if (!r.limit) return 0;
  return Math.min(100, Math.round(((r.count || 0) / r.limit) * 100));
}

function percentStatus(p: number): 'success' | 'warning' | 'error' {
  if (p > 90) return 'error';
  if (p > 70) return 'warning';
  return 'success';
}
function percentTagType(p: number): 'success' | 'warning' | 'error' {
  return percentStatus(p);
}

// 列：账号名 + 各资源
const columns = computed<DataTableColumns<any>>(() => {
  const base: DataTableColumns<any> = [
    {
      title: '账号',
      key: 'accountName',
      width: 180,
      fixed: 'left',
      render: (row: any) => row.accountName || '-',
    },
  ];
  for (const resource of resourceOrder) {
    base.push({
      title: resourceLabel(resource),
      key: resource,
      minWidth: 220,
      render: (row: any) => {
        const r = row.resources?.find((x: any) => x.resource === resource);
        if (!r) {
          return h(NText, { depth: 3, style: 'font-size: 12px' }, { default: () => '-' });
        }
        const p = calcPercentage(r);
        return h(NSpace, { vertical: true, size: 4 }, {
          default: () => [
            h(NText, { depth: 3, style: 'font-size: 12px' }, { default: () => formatValue(r) }),
            h(NProgress, {
              type: 'line',
              percentage: p,
              height: 8,
              showIndicator: false,
              status: percentStatus(p),
            }),
          ],
        });
      },
    });
  }
  return base;
});

// 行点击 → 抽屉
const drawerVisible = ref(false);
const currentAccount = ref<any>(null);
const drawerWidth = computed(() => {
  if (typeof window === 'undefined') return 480;
  return Math.min(520, Math.max(360, window.innerWidth - 80));
});

function rowProps(row: any) {
  return {
    style: 'cursor: pointer',
    onClick: () => {
      currentAccount.value = row;
      drawerVisible.value = true;
    },
  };
}

onMounted(() => {
  quotaStore.fetchQuota();
});
</script>

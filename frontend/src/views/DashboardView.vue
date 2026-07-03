<template>
  <div>
    <n-space align="center">
      <n-h2 style="margin: 0">仪表盘</n-h2>
      <n-tag size="small" type="info">今日额度</n-tag>
      <n-button size="small" tertiary @click="quotaStore.fetchQuota()">刷新</n-button>
    </n-space>

    <n-spin :show="quotaStore.loading" style="margin-top: 16px">
      <!-- 顶部汇总卡：AI神经元 -->
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

      <!-- 账号额度列表：3列卡片 -->
      <n-h3 style="margin-top: 24px">账号额度列表</n-h3>
      <n-grid :cols="3" :x-gap="12" :y-gap="12" responsive="screen" item-responsive>
        <n-gi v-for="acct in aiAccounts" :key="acct.accountId" span="3 s:3 m:1">
          <n-card size="small" hoverable style="cursor: pointer" @click="openDrawer(acct)">
            <n-space vertical :size="8">
              <n-space align="center" justify="space-between">
                <n-text strong>{{ acct.accountName }}</n-text>
                <n-tag size="small" :type="percentTagType(getAiPercentage(acct))">{{ getAiPercentage(acct) }}%</n-tag>
              </n-space>
              <n-progress
                type="line"
                :percentage="getAiPercentage(acct)"
                :height="12"
                :show-indicator="false"
                :status="percentStatus(getAiPercentage(acct))"
              />
              <n-text depth="3" style="font-size: 12px">{{ getAiUsageText(acct) }}</n-text>
            </n-space>
          </n-card>
        </n-gi>
      </n-grid>
      <n-empty
        v-if="!quotaStore.loading && aiAccounts.length === 0"
        description="暂无数据，点击「刷新」获取额度"
        style="margin-top: 16px"
      />
    </n-spin>

    <!-- 右侧抽屉：单账号详情 -->
    <n-drawer v-model:show="drawerVisible" :width="drawerWidth" placement="right">
      <n-drawer-content :title="currentAccount?.accountName || '账号详情'" closable>
        <div v-if="currentAccount">
          <n-text depth="3" style="font-size: 12px">账号 ID: {{ currentAccount.accountId }}</n-text>
          <n-divider style="margin: 12px 0" />
          <div v-for="r in currentAccountAiResources" :key="r.resource" style="margin-bottom: 18px">
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
              已用 {{ formatNumber(r.count) }} / 上限 {{ formatNumber(r.limit) }}
              （剩余 {{ formatNumber(r.remaining ?? r.limit - r.count) }}）
            </n-text>
          </div>
          <n-empty v-if="!currentAccountAiResources?.length" description="暂无额度数据" />
        </div>
      </n-drawer-content>
    </n-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useQuotaStore } from '../stores/quotaStore';

const quotaStore = useQuotaStore();

const resourceLabels: Record<string, string> = {
  ai_neurons: 'AI 神经元',
};
const resourceOrder = ['ai_neurons'];

// 只保留有 AI 神经元资源的账号
const aiAccounts = computed(() =>
  quotaStore.quota.filter((acct: any) =>
    acct.resources?.some((r: any) => r.resource === 'ai_neurons')
  )
);

// 按资源维度聚合所有账号
const summary = computed(() => {
  return resourceOrder.map((resource) => {
    let count = 0;
    let limit = 0;
    let accountCount = 0;
    for (const acct of aiAccounts.value) {
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

function formatNumber(value: number) {
  return (value || 0).toLocaleString();
}

function formatValue(r: any) {
  return `${formatNumber(r.count)} / ${formatNumber(r.limit)}`;
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

// 获取账号的 AI 神经元资源
function getAiResource(acct: any) {
  return acct.resources?.find((r: any) => r.resource === 'ai_neurons');
}

function getAiPercentage(acct: any) {
  const r = getAiResource(acct);
  return r ? calcPercentage(r) : 0;
}

function getAiUsageText(acct: any) {
  const r = getAiResource(acct);
  if (!r) return '-';
  const remaining = r.remaining ?? (r.limit - r.count);
  return `已用 ${formatNumber(r.count)} / 上限 ${formatNumber(r.limit)}（剩余 ${formatNumber(remaining)}）`;
}

// 抽屉
const drawerVisible = ref(false);
const currentAccount = ref<any>(null);
const drawerWidth = computed(() => {
  if (typeof window === 'undefined') return 480;
  return Math.min(520, Math.max(360, window.innerWidth - 80));
});

const currentAccountAiResources = computed(() => {
  if (!currentAccount.value) return [];
  return currentAccount.value.resources?.filter((r: any) => r.resource === 'ai_neurons') || [];
});

function openDrawer(acct: any) {
  currentAccount.value = acct;
  drawerVisible.value = true;
}
</script>

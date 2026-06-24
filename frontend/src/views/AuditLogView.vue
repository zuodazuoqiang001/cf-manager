<template>
  <div>
    <n-space align="center" justify="space-between" style="margin-bottom: 16px">
      <n-h2 style="margin: 0">操作日志</n-h2>
      <n-button size="small" @click="reload">
        <template #icon>
          <n-icon><RefreshOutline /></n-icon>
        </template>
        刷新
      </n-button>
    </n-space>

    <n-card size="small" style="margin-bottom: 12px">
      <n-space align="center" :wrap="true">
        <n-text depth="3">筛选账号：</n-text>
        <n-select
          v-model:value="accountFilter"
          :options="accountOptions"
          placeholder="全部账号"
          clearable
          style="width: 240px"
          @update:value="onFilterChange"
        />
        <n-text depth="3">每页：</n-text>
        <n-select
          v-model:value="pageSize"
          :options="pageSizeOptions"
          style="width: 110px"
          @update:value="onPageSizeChange"
        />
        <n-text depth="3">共 {{ total }} 条</n-text>
      </n-space>
    </n-card>

    <n-data-table
      :columns="columns"
      :data="logs"
      :loading="loading"
      size="small"
      :bordered="false"
      :scroll-x="900"
    />

    <div style="display: flex; justify-content: flex-end; margin-top: 12px">
      <n-pagination
        v-model:page="page"
        :page-count="pageCount"
        :page-size="pageSize"
        :item-count="total"
        show-quick-jumper
        @update:page="onPageChange"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import type { DataTableColumns, SelectOption } from 'naive-ui';
import { NTag, NIcon } from 'naive-ui';
import { RefreshOutline } from '@vicons/ionicons5';
import { h } from 'vue';
import { auditLogApi, type AuditLogItem } from '../api/auditLog';
import { useAccountStore } from '../stores/accountStore';
import { formatCN } from '../utils/dateFormat';

const accountStore = useAccountStore();

const logs = ref<AuditLogItem[]>([]);
const loading = ref(false);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const accountFilter = ref<number | null>(null);

const pageSizeOptions = [
  { label: '10 条', value: 10 },
  { label: '20 条', value: 20 },
  { label: '50 条', value: 50 },
  { label: '100 条', value: 100 },
];

const accountOptions = computed<SelectOption[]>(() =>
  accountStore.accounts.map((a: any) => ({ label: a.name, value: a.id }))
);

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));

const columns: DataTableColumns<AuditLogItem> = [
  { title: '时间', key: 'created_at', width: 180, render: (row) => formatCN(row.created_at) },
  { title: '账号', key: 'account_name', width: 140, render: (row) => row.account_name || '-' },
  { title: '操作', key: 'action', width: 160 },
  { title: '目标', key: 'target', width: 180, render: (row) => row.target || '-' },
  { title: '详情', key: 'detail', ellipsis: { tooltip: true }, render: (row) => row.detail || '-' },
  {
    title: '状态',
    key: 'status',
    width: 90,
    render: (row) =>
      h(
        NTag,
        { type: row.status === 'success' ? 'success' : 'error', size: 'small', bordered: false },
        { default: () => (row.status === 'success' ? '成功' : '失败') }
      ),
  },
];

async function loadLogs() {
  loading.value = true;
  try {
    const offset = (page.value - 1) * pageSize.value;
    const { data } = await auditLogApi.list({
      limit: pageSize.value,
      offset,
      account_id: accountFilter.value,
    });
    logs.value = data.data;
    total.value = data.total;
  } catch {
    logs.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

function onPageChange(p: number) {
  page.value = p;
  loadLogs();
}

function onPageSizeChange() {
  page.value = 1;
  loadLogs();
}

function onFilterChange() {
  page.value = 1;
  loadLogs();
}

function reload() {
  loadLogs();
}

onMounted(async () => {
  if (accountStore.accounts.length === 0) {
    await accountStore.fetchAccounts();
  }
  await loadLogs();
});
</script>

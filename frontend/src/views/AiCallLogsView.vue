<script setup lang="ts">
import { ref, h, onMounted } from 'vue';
import { NDataTable, NButton, NTag, NDrawer, NDrawerContent, NSpace, NSelect, NStatistic, NCard, NPopconfirm, NDescriptions, NDescriptionsItem, useMessage } from 'naive-ui';
import type { DataTableColumns } from 'naive-ui';
import { aiCallLogsApi, type AiCallLog, type AiCallLogStats } from '../api/aiCallLogs';

const message = useMessage();
const loading = ref(false);
const data = ref<AiCallLog[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const stats = ref<AiCallLogStats | null>(null);
const statusFilter = ref<string | null>(null);
const drawerData = ref<AiCallLog | null>(null);
const drawerVisible = ref(false);

const statusOptions = [
  { label: '全部', value: '' },
  { label: '成功', value: 'success' },
  { label: '失败', value: 'error' },
];

async function loadData() {
  loading.value = true;
  try {
    const params: any = { limit: pageSize.value, offset: (page.value - 1) * pageSize.value };
    if (statusFilter.value) params.status = statusFilter.value;
    const { data: result } = await aiCallLogsApi.list(params);
    data.value = result.data;
    total.value = result.total;
  } catch (e: any) {
    message.error(e?.message || '加载失败');
  } finally {
    loading.value = false;
  }
}

async function loadStats() {
  try {
    const { data } = await aiCallLogsApi.stats();
    stats.value = data;
  } catch {}
}

async function handleClean() {
  try {
    const { data } = await aiCallLogsApi.clean();
    message.success(`已清理 ${data.deleted} 条日志`);
    loadData();
    loadStats();
  } catch (e: any) {
    message.error(e?.message || '清理失败');
  }
}

function showDetail(row: AiCallLog) {
  drawerData.value = row;
  drawerVisible.value = true;
}

function handlePageChange(p: number) {
  page.value = p;
  loadData();
}

function handleStatusFilter() {
  page.value = 1;
  loadData();
}

const columns: DataTableColumns<AiCallLog> = [
  { title: '时间', key: 'created_at', width: 180, render: (row) => row.created_at?.replace('T', ' ').slice(0, 19) },
  { title: 'API Key', key: 'api_key_name', width: 120, render: (row) => row.api_key_name || '-' },
  { title: '账号', key: 'account_name', width: 120, render: (row) => row.account_name || '-' },
  { title: '端点', key: 'endpoint', width: 160 },
  { title: '模型', key: 'model', width: 200, ellipsis: { tooltip: true } },
  {
    title: '状态', key: 'status', width: 80,
    render: (row) => h(NTag, { type: row.status === 'success' ? 'success' : 'error', size: 'small' }, { default: () => row.status === 'success' ? '成功' : '失败' }),
  },
  { title: 'Input', key: 'input_tokens', width: 80 },
  { title: 'Output', key: 'output_tokens', width: 80 },
  { title: '耗时', key: 'duration_ms', width: 80, render: (row) => `${row.duration_ms}ms` },
  {
    title: '操作', key: 'actions', width: 80,
    render: (row) => h(NButton, { size: 'small', text: true, type: 'primary', onClick: () => showDetail(row) }, { default: () => '详情' }),
  },
];

onMounted(() => {
  loadData();
  loadStats();
});
</script>

<template>
  <div style="padding: 16px;">
    <!-- 统计卡片 -->
    <n-card v-if="stats" style="margin-bottom: 16px;" size="small">
      <n-space>
        <n-statistic label="总调用" :value="stats.total" />
        <n-statistic label="今日" :value="stats.today" />
        <n-statistic label="成功" :value="stats.success" />
        <n-statistic label="失败" :value="stats.error" />
        <n-statistic label="总输入 Tokens" :value="stats.totalInputTokens" />
        <n-statistic label="总输出 Tokens" :value="stats.totalOutputTokens" />
      </n-space>
    </n-card>

    <!-- 工具栏 -->
    <n-space justify="space-between" style="margin-bottom: 16px;" align="center">
      <n-space align="center">
        <n-select
          v-model:value="statusFilter"
          :options="statusOptions"
          placeholder="状态筛选"
          style="width: 120px;"
          clearable
          @update:value="handleStatusFilter"
        />
      </n-space>
      <n-popconfirm @positive-click="handleClean">
        <template #trigger>
          <n-button type="error" ghost size="small">清空全部日志</n-button>
        </template>
        确认清空所有调用日志？此操作不可撤销。
      </n-popconfirm>
    </n-space>

    <!-- 数据表 -->
    <n-data-table
      :columns="columns"
      :data="data"
      :loading="loading"
      :pagination="{
        page: page,
        pageSize: pageSize,
        itemCount: total,
        showSizePicker: false,
        onChange: handlePageChange,
      }"
      :bordered="false"
      size="small"
      :scroll-x="1100"
    />

    <!-- 详情抽屉 -->
    <n-drawer v-model:show="drawerVisible" :width="600">
      <n-drawer-content :title="`调用详情 #${drawerData?.id}`" closable>
        <template v-if="drawerData">
          <n-descriptions label-placement="top" bordered :column="2" size="small">
            <n-descriptions-item label="时间">{{ drawerData.created_at?.replace('T', ' ').slice(0, 19) }}</n-descriptions-item>
            <n-descriptions-item label="状态">
              <n-tag :type="drawerData.status === 'success' ? 'success' : 'error'" size="small">
                {{ drawerData.status === 'success' ? '成功' : '失败' }}
              </n-tag>
            </n-descriptions-item>
            <n-descriptions-item label="API Key">{{ drawerData.api_key_name || '-' }}</n-descriptions-item>
            <n-descriptions-item label="账号">{{ drawerData.account_name || '-' }}</n-descriptions-item>
            <n-descriptions-item label="端点">{{ drawerData.endpoint }}</n-descriptions-item>
            <n-descriptions-item label="模型">{{ drawerData.model }}</n-descriptions-item>
            <n-descriptions-item label="Input Tokens">{{ drawerData.input_tokens }}</n-descriptions-item>
            <n-descriptions-item label="Output Tokens">{{ drawerData.output_tokens }}</n-descriptions-item>
            <n-descriptions-item label="耗时">{{ drawerData.duration_ms }}ms</n-descriptions-item>
            <n-descriptions-item label="错误信息" v-if="drawerData.error_message">{{ drawerData.error_message }}</n-descriptions-item>
          </n-descriptions>

          <div v-if="drawerData.request_summary" style="margin-top: 16px;">
            <div style="font-weight: 600; margin-bottom: 8px;">请求摘要</div>
            <pre style="background: #f5f5f5; padding: 12px; border-radius: 6px; font-size: 12px; overflow: auto; max-height: 300px; white-space: pre-wrap; word-break: break-all;">{{ drawerData.request_summary }}</pre>
          </div>

          <div v-if="drawerData.response_summary" style="margin-top: 16px;">
            <div style="font-weight: 600; margin-bottom: 8px;">响应摘要</div>
            <pre style="background: #f5f5f5; padding: 12px; border-radius: 6px; font-size: 12px; overflow: auto; max-height: 300px; white-space: pre-wrap; word-break: break-all;">{{ drawerData.response_summary }}</pre>
          </div>
        </template>
      </n-drawer-content>
    </n-drawer>
  </div>
</template>

<template>
  <div>
    <n-space justify="space-between" align="center" style="margin-bottom: 16px">
      <n-h2 style="margin: 0">API Key 管理</n-h2>
      <n-button type="primary" @click="openAdd">新增 API Key</n-button>
    </n-space>

    <n-alert type="info" style="margin-bottom: 16px" closable>
      <template #header>使用说明</template>
      调用 <code>POST /v1/chat/completions</code> 时在 <code>Authorization: Bearer sk-cf-...</code> 头里带本页生成的 Key。
      系统会按多账号当日剩余 Neurons 自动轮询；某账号触发 4006（额度耗尽）后，今日不再轮询该账号。
    </n-alert>

    <n-data-table
      :columns="columns"
      :data="keys"
      :loading="loading"
      :bordered="false"
      :scroll-x="1100"
    />

    <!-- 新增 -->
    <n-modal v-model:show="showAdd" preset="dialog" title="新增 API Key" style="width: 500px; max-width: 95vw">
      <n-form label-placement="left" label-width="100">
        <n-form-item label="名称">
          <n-input v-model:value="form.name" placeholder="标识用途，例如：Cursor / NextChat" />
        </n-form-item>
        <n-form-item label="默认模型">
          <n-select
            v-model:value="form.default_model"
            :options="modelOptions"
            :loading="modelsLoading"
            filterable
            clearable
            placeholder="(可选) 客户端未传 model 时使用"
          />
        </n-form-item>
      </n-form>
      <template #action>
        <n-button @click="showAdd = false">取消</n-button>
        <n-button type="primary" :loading="submitting" @click="handleAdd">提交</n-button>
      </template>
    </n-modal>

    <!-- 编辑 -->
    <n-modal v-model:show="showEdit" preset="dialog" title="编辑 API Key" style="width: 500px; max-width: 95vw">
      <n-form label-placement="left" label-width="100">
        <n-form-item label="名称">
          <n-input v-model:value="editForm.name" />
        </n-form-item>
        <n-form-item label="默认模型">
          <n-select
            v-model:value="editForm.default_model"
            :options="modelOptions"
            :loading="modelsLoading"
            filterable
            clearable
          />
        </n-form-item>
        <n-form-item label="启用">
          <n-switch v-model:value="editForm.is_active" />
        </n-form-item>
      </n-form>
      <template #action>
        <n-button @click="showEdit = false">取消</n-button>
        <n-button type="primary" :loading="submitting" @click="handleSaveEdit">保存</n-button>
      </template>
    </n-modal>

    <!-- 创建后一次性展示 key -->
    <n-modal v-model:show="showCreated" preset="dialog" title="🔑 已创建 API Key" :mask-closable="false" :closable="false">
      <n-alert type="warning" style="margin-bottom: 12px">
        请妥善保管。关闭本对话框后将无法再查看完整 key，只能重新生成。
      </n-alert>
      <n-input :value="createdKey" type="text" readonly style="font-family: monospace" />
      <template #action>
        <n-button type="primary" @click="copyKey">复制</n-button>
        <n-button @click="showCreated = false">我已保存</n-button>
      </template>
    </n-modal>

    <!-- 用量详情抽屉 -->
    <n-drawer v-model:show="showUsage" :width="640">
      <n-drawer-content :title="usageTitle" closable>
        <n-data-table :columns="usageColumns" :data="usageData" :loading="usageLoading" :bordered="false" />
      </n-drawer-content>
    </n-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, h, onMounted } from 'vue';
import { NButton, NSpace, NTag, useMessage, useDialog } from 'naive-ui';
import type { DataTableColumns } from 'naive-ui';
import { apiKeysApi, type ApiKeyItem } from '../api/apiKeys';
import { aiApi } from '../api/ai';

const message = useMessage();
const dialog = useDialog();

const keys = ref<ApiKeyItem[]>([]);
const loading = ref(false);
const submitting = ref(false);

const modelOptions = ref<{ label: string; value: string }[]>([]);
const modelsLoading = ref(false);

const showAdd = ref(false);
const showEdit = ref(false);
const showCreated = ref(false);
const showUsage = ref(false);

const createdKey = ref('');
const currentRow = ref<ApiKeyItem | null>(null);
const usageData = ref<any[]>([]);
const usageLoading = ref(false);

const form = ref<{ name: string; default_model: string | null }>({
  name: '',
  default_model: null,
});
const editForm = ref<{ id: number; name: string; default_model: string | null; is_active: boolean }>({
  id: 0,
  name: '',
  default_model: null,
  is_active: true,
});

const usageTitle = computed(() => `用量明细 - ${currentRow.value?.name || ''}`);

async function fetchKeys() {
  loading.value = true;
  try {
    const { data } = await apiKeysApi.list();
    keys.value = (data as any) || [];
  } catch {
    keys.value = [];
  } finally {
    loading.value = false;
  }
}

async function fetchModels() {
  modelsLoading.value = true;
  try {
    const { data } = await aiApi.getModels({ task: 'Text Generation' });
    const list = (data as any).models || data || [];
    modelOptions.value = list.map((m: any) => {
      const fullName = typeof m === 'string' ? m : (m.name || m.id);
      const shortName = fullName.replace(/^@cf\//, '');
      return { label: shortName, value: fullName };
    });
  } catch {
    modelOptions.value = [];
  } finally {
    modelsLoading.value = false;
  }
}

function openAdd() {
  form.value = { name: '', default_model: null };
  showAdd.value = true;
}

async function handleAdd() {
  if (!form.value.name.trim()) {
    message.warning('请输入名称');
    return;
  }
  submitting.value = true;
  try {
    const { data } = await apiKeysApi.create(form.value);
    createdKey.value = (data as any).raw;
    showAdd.value = false;
    showCreated.value = true;
    fetchKeys();
  } finally {
    submitting.value = false;
  }
}

function openEdit(row: ApiKeyItem) {
  editForm.value = {
    id: row.id,
    name: row.name,
    default_model: row.default_model,
    is_active: row.is_active === 1,
  };
  showEdit.value = true;
}

async function handleSaveEdit() {
  submitting.value = true;
  try {
    await apiKeysApi.update(editForm.value.id, {
      name: editForm.value.name,
      default_model: editForm.value.default_model,
      is_active: editForm.value.is_active ? 1 : 0,
    });
    message.success('已保存');
    showEdit.value = false;
    fetchKeys();
  } finally {
    submitting.value = false;
  }
}

function handleDelete(row: ApiKeyItem) {
  dialog.warning({
    title: '删除确认',
    content: `确认删除 "${row.name}"？该 Key 将立即失效，对应的用量历史会一并清除。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      await apiKeysApi.remove(row.id);
      message.success('已删除');
      fetchKeys();
    },
  });
}

async function openUsage(row: ApiKeyItem) {
  currentRow.value = row;
  showUsage.value = true;
  usageLoading.value = true;
  try {
    const { data } = await apiKeysApi.getUsage(row.id);
    usageData.value = (data as any) || [];
  } catch {
    usageData.value = [];
  } finally {
    usageLoading.value = false;
  }
}

function copyKey() {
  navigator.clipboard.writeText(createdKey.value)
    .then(() => message.success('已复制到剪贴板'))
    .catch(() => message.error('复制失败，请手动选中复制'));
}

const columns = computed<DataTableColumns<ApiKeyItem>>(() => [
  { title: 'ID', key: 'id', width: 60 },
  { title: '名称', key: 'name', width: 150, ellipsis: { tooltip: true } },
  {
    title: 'Key',
    key: 'key_prefix',
    width: 200,
    render: (row) => h('code', { style: 'font-size: 12px; background: rgba(128,128,128,0.1); padding: 2px 6px; border-radius: 4px' }, row.key_prefix),
  },
  {
    title: '默认模型',
    key: 'default_model',
    minWidth: 180,
    ellipsis: { tooltip: true },
    render: (row) => row.default_model
      ? row.default_model.replace(/^@cf\//, '')
      : h(NTag, { size: 'small' }, { default: () => '未设置' }),
  },
  {
    title: '状态',
    key: 'is_active',
    width: 80,
    render: (row) => h(
      NTag,
      { size: 'small', type: row.is_active ? 'success' : 'default' },
      { default: () => (row.is_active ? '启用' : '禁用') }
    ),
  },
  {
    title: '今日请求',
    key: 'today_requests',
    width: 100,
    render: (row) => row.stats?.today_requests || 0,
  },
  {
    title: '今日 Tokens',
    key: 'today_tokens',
    width: 120,
    render: (row) => (row.stats?.today_tokens || 0).toLocaleString(),
  },
  {
    title: '累计请求',
    key: 'total_requests',
    width: 100,
    render: (row) => row.stats?.total_requests || 0,
  },
  {
    title: '操作',
    key: 'actions',
    width: 220,
    fixed: 'right',
    render: (row) => h(NSpace, { size: 4 }, {
      default: () => [
        h(NButton, { size: 'small', onClick: () => openUsage(row) }, { default: () => '用量' }),
        h(NButton, { size: 'small', onClick: () => openEdit(row) }, { default: () => '编辑' }),
        h(NButton, { size: 'small', type: 'error', onClick: () => handleDelete(row) }, { default: () => '删除' }),
      ],
    }),
  },
]);

const usageColumns: DataTableColumns<any> = [
  { title: '日期', key: 'date', width: 110 },
  {
    title: '账号',
    key: 'account_name',
    width: 140,
    render: (row) => row.account_name || h(NTag, { size: 'small' }, { default: () => '已删除' }),
  },
  {
    title: '模型',
    key: 'model',
    minWidth: 220,
    ellipsis: { tooltip: true },
    render: (row) => row.model.replace(/^@cf\//, ''),
  },
  { title: '请求数', key: 'requests', width: 90 },
  {
    title: 'Tokens',
    key: 'total_tokens',
    width: 120,
    render: (row) => (row.total_tokens || 0).toLocaleString(),
  },
];

onMounted(() => {
  fetchKeys();
  fetchModels();
});
</script>

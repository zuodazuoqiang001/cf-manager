/**
 * OpenAI Responses API ↔ Chat Completions API 双向格式转换器
 *
 * Codex CLI 强制使用 wire_api = "responses"，但 Cloudflare Workers AI
 * 大部分模型仅支持 /v1/chat/completions，所以需要在网关层做格式转换。
 */

// ─── 类型定义 ──────────────────────────────────────────────

interface ResponsesInputItem {
  type?: string;
  role?: string;
  content?: any;
  name?: string;
  call_id?: string;
  arguments?: string;
  output?: string;
  id?: string;
}

interface ChatMessage {
  role: string;
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
}

interface ChatCompletionResponse {
  id: string;
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: string;
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  model?: string;
}

// ─── 请求转换: Responses → Chat Completions ────────────────

export function convertResponsesRequest(body: any): Record<string, any> {
  const messages: ChatMessage[] = [];

  // instructions → system message
  if (body.instructions) {
    messages.push({ role: 'system', content: body.instructions });
  }

  // input items → messages
  // Responses API 的 input 可以是字符串或数组
  if (typeof body.input === 'string') {
    messages.push({ role: 'user', content: body.input });
  }
  const input: ResponsesInputItem[] = Array.isArray(body.input) ? body.input : [];
  for (const item of input) {
    const itemType = item.type || 'message';

    if (itemType === 'message' || (item.role && !item.type)) {
      // 标准消息项
      const role = item.role || 'user';
      const content = extractTextContent(item.content);
      messages.push({ role, content });
    } else if (itemType === 'function_call') {
      // 工具调用（assistant 发起的）
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: item.call_id || item.id || `call_${Date.now()}`,
          type: 'function',
          function: { name: item.name || '', arguments: item.arguments || '{}' },
        }],
      });
    } else if (itemType === 'function_call_output') {
      // 工具调用结果
      messages.push({
        role: 'tool',
        content: item.output || '',
        tool_call_id: item.call_id || '',
      });
    } else if (itemType === 'reasoning') {
      // 推理项 → 跳过（chat completions 不支持）
      continue;
    } else if (item.role) {
      // 兜底：有 role 的当消息处理
      messages.push({ role: item.role, content: extractTextContent(item.content) });
    }
  }

  const chatBody: Record<string, any> = {
    model: body.model,
    messages,
    stream: body.stream === true,
  };

  // 字段映射
  if (body.temperature !== undefined) chatBody.temperature = body.temperature;
  if (body.top_p !== undefined) chatBody.top_p = body.top_p;
  if (body.max_output_tokens !== undefined) chatBody.max_tokens = body.max_output_tokens;
  if (body.presence_penalty !== undefined) chatBody.presence_penalty = body.presence_penalty;
  if (body.frequency_penalty !== undefined) chatBody.frequency_penalty = body.frequency_penalty;
  if (body.stop) chatBody.stop = body.stop;

  // tools 转换: Responses 格式 → Chat Completions 格式
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    chatBody.tools = body.tools.map((t: any) => {
      if (t.type === 'function') {
        return {
          type: 'function',
          function: {
            name: t.name,
            description: t.description || '',
            parameters: t.parameters || { type: 'object', properties: {} },
          },
        };
      }
      return t; // 透传其他类型
    });
  }

  // tool_choice 透传
  if (body.tool_choice !== undefined) {
    chatBody.tool_choice = body.tool_choice;
  }

  return chatBody;
}

/** 从 Responses content（可能是 string 或 array）中提取纯文本 */
function extractTextContent(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c: any) => {
        if (typeof c === 'string') return c;
        if (c?.text) return c.text;
        return '';
      })
      .join('');
  }
  return '';
}

// ─── 响应转换: Chat Completions → Responses (非流式) ────────

export function convertChatCompletionToResponse(
  data: ChatCompletionResponse,
  model: string,
): any {
  const choice = data.choices?.[0];
  const msg = choice?.message;

  const output: any[] = [];

  // 处理文本内容
  if (msg?.content) {
    output.push({
      type: 'message',
      id: `msg_${generateId()}`,
      role: 'assistant',
      status: 'completed',
      content: [{
        type: 'output_text',
        text: msg.content,
        annotations: [],
      }],
    });
  }

  // 处理工具调用
  if (msg?.tool_calls) {
    for (const tc of msg.tool_calls) {
      output.push({
        type: 'function_call',
        id: `fc_${generateId()}`,
        call_id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
        status: 'completed',
      });
    }
  }

  const usage = data.usage || {};
  return {
    id: `resp_${generateId()}`,
    object: 'response',
    status: 'completed',
    model,
    output,
    usage: {
      input_tokens: usage.prompt_tokens || 0,
      output_tokens: usage.completion_tokens || 0,
      total_tokens: usage.total_tokens || 0,
    },
  };
}

// ─── 流式转换: Chat Completions SSE → Responses SSE ─────────

/**
 * 将 Chat Completions 流式响应转换为 Responses API SSE 事件流。
 * 返回一个异步生成器，yield 出完整的 SSE 行（含 "event:" 和 "data:" 前缀）。
 */
export async function* convertStreamToResponsesSSE(
  cfResp: { body: any },
  model: string,
): AsyncGenerator<string> {
  const respId = `resp_${generateId()}`;
  const msgId = `msg_${generateId()}`;
  let seq = 0;
  let fullText = '';
  let outputIndex = 0;
  let contentPartAdded = false;
  let itemAdded = false;

  // 工具调用相关状态
  const toolCallStates: Map<number, { id: string; name: string; args: string; itemId: string }> = new Map();
  const toolCallOutputs: any[] = [];

  // 1. response.created
  yield sseEvent('response.created', {
    type: 'response.created',
    sequence_number: seq++,
    response: { id: respId, object: 'response', status: 'in_progress', model, output: [] },
  });

  // 2. response.in_progress
  yield sseEvent('response.in_progress', {
    type: 'response.in_progress',
    sequence_number: seq++,
    response: { id: respId, object: 'response', status: 'in_progress', model, output: [] },
  });

  const body = cfResp.body as any;
  if (!body) {
    yield 'data: [DONE]\n\n';
    return;
  }

  const reader = typeof body.getReader === 'function'
    ? body.getReader()
    : null;

  if (!reader) {
    yield 'data: [DONE]\n\n';
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        const jsonStr = trimmed.slice(6);
        if (jsonStr === '[DONE]') continue;

        let chunk: any;
        try {
          chunk = JSON.parse(jsonStr);
        } catch {
          continue;
        }

        const delta = chunk.choices?.[0]?.delta;
        const finishReason = chunk.choices?.[0]?.finish_reason;

        // 处理文本内容
        if (delta?.content) {
          if (!itemAdded) {
            yield sseEvent('response.output_item.added', {
              type: 'response.output_item.added',
              sequence_number: seq++,
              output_index: outputIndex,
              item: { id: msgId, type: 'message', role: 'assistant', status: 'in_progress', content: [] },
            });
            itemAdded = true;
          }

          if (!contentPartAdded) {
            yield sseEvent('response.content_part.added', {
              type: 'response.content_part.added',
              sequence_number: seq++,
              output_index: outputIndex,
              content_index: 0,
              item_id: msgId,
              part: { type: 'output_text', text: '', annotations: [] },
            });
            contentPartAdded = true;
          }

          fullText += delta.content;
          yield sseEvent('response.output_text.delta', {
            type: 'response.output_text.delta',
            sequence_number: seq++,
            output_index: outputIndex,
            content_index: 0,
            item_id: msgId,
            delta: delta.content,
          });
        }

        // 处理工具调用
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;

            if (!toolCallStates.has(idx)) {
              // 新工具调用
              const itemId = `fc_${generateId()}`;
              toolCallStates.set(idx, {
                id: tc.id || `call_${generateId()}`,
                name: tc.function?.name || '',
                args: '',
                itemId,
              });

              // 如果之前有文本输出，先关闭它
              if (contentPartAdded) {
                yield sseEvent('response.output_text.done', {
                  type: 'response.output_text.done',
                  sequence_number: seq++,
                  output_index: outputIndex,
                  content_index: 0,
                  item_id: msgId,
                  text: fullText,
                });
                yield sseEvent('response.content_part.done', {
                  type: 'response.content_part.done',
                  sequence_number: seq++,
                  output_index: outputIndex,
                  content_index: 0,
                  item_id: msgId,
                  part: { type: 'output_text', text: fullText, annotations: [] },
                });
                yield sseEvent('response.output_item.done', {
                  type: 'response.output_item.done',
                  sequence_number: seq++,
                  output_index: outputIndex,
                  item: { id: msgId, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: fullText, annotations: [] }] },
                });
                outputIndex++;
                itemAdded = false;
                contentPartAdded = false;
              }

              const state = toolCallStates.get(idx)!;
              yield sseEvent('response.output_item.added', {
                type: 'response.output_item.added',
                sequence_number: seq++,
                output_index: outputIndex + idx,
                item: { id: itemId, type: 'function_call', name: state.name, call_id: state.id, arguments: '', status: 'in_progress' },
              });
            }

            const state = toolCallStates.get(idx)!;
            if (tc.function?.arguments) {
              state.args += tc.function.arguments;
              yield sseEvent('response.function_call_arguments.delta', {
                type: 'response.function_call_arguments.delta',
                sequence_number: seq++,
                output_index: outputIndex + idx,
                item_id: state.itemId,
                delta: tc.function.arguments,
              });
            }
          }
        }

        // 处理完成
        if (finishReason) {
          // 关闭文本内容
          if (contentPartAdded) {
            yield sseEvent('response.output_text.done', {
              type: 'response.output_text.done',
              sequence_number: seq++,
              output_index: outputIndex,
              content_index: 0,
              item_id: msgId,
              text: fullText,
            });
            yield sseEvent('response.content_part.done', {
              type: 'response.content_part.done',
              sequence_number: seq++,
              output_index: outputIndex,
              content_index: 0,
              item_id: msgId,
              part: { type: 'output_text', text: fullText, annotations: [] },
            });
            yield sseEvent('response.output_item.done', {
              type: 'response.output_item.done',
              sequence_number: seq++,
              output_index: outputIndex,
              item: { id: msgId, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: fullText, annotations: [] }] },
            });
          }

          // 关闭工具调用
          for (const [idx, state] of toolCallStates) {
            yield sseEvent('response.function_call_arguments.done', {
              type: 'response.function_call_arguments.done',
              sequence_number: seq++,
              output_index: outputIndex + idx,
              item_id: state.itemId,
              arguments: state.args,
            });
            yield sseEvent('response.output_item.done', {
              type: 'response.output_item.done',
              sequence_number: seq++,
              output_index: outputIndex + idx,
              item: { id: state.itemId, type: 'function_call', name: state.name, call_id: state.id, arguments: state.args, status: 'completed' },
            });
            toolCallOutputs.push({
              type: 'function_call',
              id: state.itemId,
              call_id: state.id,
              name: state.name,
              arguments: state.args,
              status: 'completed',
            });
          }
        }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }

  // 收集所有输出
  const allOutput: any[] = [];
  if (fullText) {
    allOutput.push({
      type: 'message',
      id: msgId,
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: fullText, annotations: [] }],
    });
  }
  allOutput.push(...toolCallOutputs);

  // response.completed
  yield sseEvent('response.completed', {
    type: 'response.completed',
    sequence_number: seq++,
    response: { id: respId, object: 'response', status: 'completed', model, output: allOutput },
  });

  yield 'data: [DONE]\n\n';
}

// ─── 工具函数 ──────────────────────────────────────────────

function sseEvent(event: string, data: any): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

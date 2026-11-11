/**
 * 阿里云百炼（DashScope）OpenAI 兼容接口封装。
 *
 * grade 与 evaluate 两个接口原本各自内联了一份 fetch，
 * 端点地址、超时、错误处理都不一致（一个走标准域名，一个走自定义 MAAS 域名）。
 * 这里抽成统一模块：
 * - 端点与模型可用环境变量覆盖，默认走标准兼容模式地址
 * - 统一超时控制（上游默认 60s 不够跑多模态识别）
 * - 统一错误信息，把上游返回体里的真实原因带出来
 * - 统一重试策略：只对可重试的错误（网络抖动、429、5xx）重试
 */

/** 默认走标准 OpenAI 兼容地址；两个域名实测返回的模型列表一致 */
const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

export const DASHSCOPE_BASE_URL = (
  process.env.DASHSCOPE_BASE_URL || DEFAULT_BASE_URL
).replace(/\/+$/, '');

export const GRADE_MODEL = process.env.DASHSCOPE_GRADE_MODEL || 'qwen3.7-plus';
export const EVALUATE_MODEL = process.env.DASHSCOPE_EVALUATE_MODEL || 'qwen3.7-plus';

/** 多模态识别比较慢，给足时间；超过 120s 视为失败 */
const DEFAULT_TIMEOUT_MS = Number(process.env.DASHSCOPE_TIMEOUT_MS || 120_000);

/** 可重试的状态码 */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/** 从上游错误响应体里提取可读信息 */
async function extractUpstreamError(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return `HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(text);
      const detail =
        parsed?.error?.message || parsed?.message || parsed?.error?.code || '';
      if (detail) return `${res.status} ${detail}`;
    } catch {
      // 不是 JSON，直接截取正文
    }
    return `${res.status} ${text.slice(0, 200)}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/** 判断是否值得重试 */
function isRetryable(status: number): boolean {
  return RETRYABLE_STATUS.has(status);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

/**
 * 调用上游 chat/completions（非流式）。
 *
 * @param messages 消息体
 * @param model 模型名
 * @param timeoutMs 超时时间
 * @param retries 失败重试次数（不含首次）
 */
export async function chatCompletion(
  messages: ChatMessage[],
  model: string = GRADE_MODEL,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  retries: number = 1
): Promise<string> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    throw new Error('未配置 API Key（环境变量 DASHSCOPE_API_KEY）');
  }

  const url = `${DASHSCOPE_BASE_URL}/chat/completions`;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, messages }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await extractUpstreamError(response);
        const error = new Error(`上游接口错误：${detail}`);
        (error as Error & { status?: number }).status = response.status;
        // 不可重试的错误直接抛出
        if (!isRetryable(response.status) || attempt === retries) throw error;
        lastError = error;
      } else {
        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content ?? '';
        if (!content) {
          throw new Error('上游返回内容为空');
        }
        return content;
      }
    } catch (e) {
      lastError = e;
      // AbortError 是超时，值得重试
      const isAbort = e instanceof Error && e.name === 'AbortError';
      const status = (e as Error & { status?: number })?.status;
      const retryable = isAbort || (status !== undefined && isRetryable(status));
      if (!retryable || attempt === retries) {
        if (isAbort) {
          throw new Error(`上游接口请求超时（${Math.round(timeoutMs / 1000)}s）`);
        }
        throw e;
      }
    } finally {
      clearTimeout(timer);
    }

    // 指数退避后重试
    await sleep(600 * Math.pow(2, attempt));
  }

  throw lastError instanceof Error ? lastError : new Error('上游接口请求失败');
}

/**
 * 调用上游 chat/completions（流式），返回原始 SSE 响应体。
 *
 * 调用方负责消费流并转发给客户端。
 */
export async function chatCompletionStream(
  messages: ChatMessage[],
  model: string = EVALUATE_MODEL,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<ReadableStream<Uint8Array>> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    throw new Error('未配置 API Key（环境变量 DASHSCOPE_API_KEY）');
  }

  const url = `${DASHSCOPE_BASE_URL}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, messages, stream: true }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await extractUpstreamError(response);
      throw new Error(`上游接口错误：${detail}`);
    }
    if (!response.body) {
      throw new Error('上游未返回数据流');
    }

    // 流已经开始，不能再由外层 abort 控制；
    // 这里把 controller 交给调用方，通过超时信号中断读取
    return response.body;
  } catch (e) {
    clearTimeout(timer);
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(`上游接口请求超时（${Math.round(timeoutMs / 1000)}s）`);
    }
    throw e;
  }
}

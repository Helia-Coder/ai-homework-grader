import type { BigQuestionData, StepItem, SubQuestion } from './types';

/**
 * 模型输出的 JSON 解析与规范化。
 *
 * 模型经常不严格遵守「只输出纯净 JSON」的指令，实际会返回：
 * - 带 ```json 代码块包裹
 * - 前后带解释性文字
 * - LaTeX 反斜杠没转义（`\frac` 而不是 `\\frac`）
 * - 夹杂控制字符
 * - 单个大题对象而不是数组
 *
 * 这里做集中兜底，保证下游拿到的结构始终一致。
 */

/** 去掉 markdown 代码块包裹 */
function stripCodeFence(text: string): string {
  return text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();
}

/**
 * 修复未转义的反斜杠。
 *
 * JSON 字符串里 `\` 必须转义成 `\\`，否则 `\f` `\t` `\n` 会被
 * JSON.parse 解释成控制字符，导致 LaTeX 公式损坏。
 * 用负向前后查找判断是否为「孤立反斜杠」。
 */
function escapeLoneBackslashes(text: string): string {
  return text.replace(/(?<!\\)\\(?!\\)/g, '\\\\');
}

/** 移除 JSON 不允许的控制字符 */
function stripControlChars(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x1F]/g, '');
}

/** 从混杂文本里截取最外层的 JSON 数组或对象 */
function extractJsonSlice(text: string): string {
  const start = text.search(/[[{]/);
  if (start === -1) return text;

  const opening = text[start];
  const closing = opening === '[' ? ']' : '}';

  // 从后往前找配对的结束符，跳过字符串内部的括号
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === opening) {
      depth++;
    } else if (ch === closing) {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  // 没找到配对结束符，退回全文
  return text.slice(start);
}

/** 把任意字符串解析成 JSON */
function safeJsonParse(text: string): unknown {
  const candidates = [
    text,
    stripCodeFence(text),
    escapeLoneBackslashes(stripCodeFence(text)),
    stripControlChars(escapeLoneBackslashes(stripCodeFence(text))),
    extractJsonSlice(stripControlChars(escapeLoneBackslashes(stripCodeFence(text)))),
  ];

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // 换下一个候选策略
    }
  }

  throw new Error('模型输出不是合法的 JSON');
}

/** 数值安全转换 */
function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** 把分数规整到「保留两位小数」的形式，去掉 5.00 这种冗余 */
function normalizeScore(value: unknown): string {
  const n = toNumber(value, 0);
  const rounded = Math.round(n * 100) / 100;
  return String(rounded);
}

/** 规范化单条步骤明细 */
function normalizeStep(raw: unknown, index: number): StepItem {
  const step = (raw ?? {}) as Record<string, unknown>;
  const max = toNumber(step['该步骤满分'], 0);
  const score = toNumber(step['实际得分'], 0);

  return {
    步骤序号: toNumber(step['步骤序号'], index + 1),
    该步骤满分: normalizeScore(max),
    // 得分不能超过该步骤满分
    实际得分: normalizeScore(Math.min(Math.max(score, 0), max)),
    判定: String(step['判定'] ?? '').trim(),
    说明: String(step['说明'] ?? '').trim(),
  };
}

/** 规范化小问 */
function normalizeSubQuestion(raw: unknown, index: number): SubQuestion {
  const sub = (raw ?? {}) as Record<string, unknown>;
  const stepsRaw = Array.isArray(sub['步骤明细']) ? sub['步骤明细'] : [];

  return {
    小问编号: String(sub['小问编号'] ?? `(${index + 1})`),
    小问题干: String(sub['小问题干'] ?? ''),
    选项内容: String(sub['选项内容'] ?? ''),
    学生作答: String(sub['学生作答'] ?? ''),
    本小问满分: normalizeScore(sub['本小问满分']),
    本小问学生得分: normalizeScore(sub['本小问学生得分']),
    评分细则: String(sub['评分细则'] ?? ''),
    步骤明细: stepsRaw.map(normalizeStep),
    错因归因: String(sub['错因归因'] ?? ''),
    讲评建议: String(sub['讲评建议'] ?? ''),
  };
}

/**
 * 规范化大题，并校验分数自洽性。
 *
 * 校验内容：
 * - 大题实得分 = 各小问得分之和，且不超过大题总分
 * - 有步骤明细时，小问得分 = 步骤得分之和，且不超过小问满分
 * - 各小问满分之和应等于大题总分（不等时以小问之和为准修正大题总分）
 */
function normalizeBigQuestion(raw: unknown, index: number): BigQuestionData {
  const big = (raw ?? {}) as Record<string, unknown>;
  const subsRaw = Array.isArray(big['小问列表']) ? big['小问列表'] : [];
  const 小问列表 = subsRaw.map(normalizeSubQuestion);

  // 以小问满分之和为准确定大题总分
  const sumSubMax = 小问列表.reduce((s, sq) => s + toNumber(sq.本小问满分), 0);
  const declaredTotal = toNumber(big['大题总分'], 0);
  const 大题总分 = normalizeScore(
    sumSubMax > 0 ? sumSubMax : declaredTotal > 0 ? declaredTotal : 10
  );

  // 小问得分重新求和（钳制在 0 ~ 小问满分之间）
  小问列表.forEach((sq) => {
    const subMax = toNumber(sq.本小问满分);
    let score = toNumber(sq.本小问学生得分);

    // 有步骤明细时，以步骤得分之和为准
    if (sq.步骤明细.length > 0) {
      const sumStepScore = sq.步骤明细.reduce((s, st) => s + toNumber(st.实际得分), 0);
      score = sumStepScore;
    }

    sq.本小问学生得分 = normalizeScore(Math.min(Math.max(score, 0), subMax));
  });

  const sumScore = 小问列表.reduce((s, sq) => s + toNumber(sq.本小问学生得分), 0);

  return {
    大题题号: String(big['大题题号'] ?? String(index + 1)),
    大题题干: String(big['大题题干'] ?? ''),
    大题总分,
    大题实得分: normalizeScore(Math.min(sumScore, toNumber(大题总分))),
    识别置信度: String(big['识别置信度'] ?? '中'),
    hasManualEdit: false,
    小问列表,
  };
}

/**
 * 解析模型输出，返回规范化后的大题数组。
 *
 * 兼容两种返回形态：数组（多道大题）与单个对象（单道大题）。
 *
 * @throws 模型输出无法解析为 JSON 时抛出
 */
export function parseGradingResult(content: string): BigQuestionData[] {
  const parsed = safeJsonParse(content);
  const list = Array.isArray(parsed) ? parsed : [parsed];

  return list
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => normalizeBigQuestion(item, index));
}

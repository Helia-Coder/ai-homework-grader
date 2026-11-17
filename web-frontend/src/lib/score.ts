import type { BigQuestionData, StepItem, SubQuestion } from './types';

/**
 * 分数计算与联动规则。
 *
 * 这些规则原先散落在 page.tsx 的多个事件处理函数里，
 * 存在三个实际缺陷：
 * 1. 小问没有步骤明细时，重算会把得分归零（步骤和为 0）
 * 2. 步骤「实际得分」没有上限钳制，能填出「得分 8 / 满分 5」
 * 3. 只改文字（错因、讲评）也会被标记为「已人工调整」，
 *    导致后续改大题总分时不再按比例缩放，人工干预被误伤
 *
 * 这里把规则收敛成纯函数，便于复用与测试。
 */

/** 数值安全转换 */
export function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** 分数规整，保留两位小数并去掉多余尾零 */
export function normalizeScore(value: unknown): string {
  const n = toNumber(value, 0);
  return String(Math.round(n * 100) / 100);
}

/** 把数值钳制到 [min, max] 区间 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 小问所有步骤的满分之和 */
export function sumStepMax(sub: SubQuestion): number {
  return sub.步骤明细.reduce((s, st) => s + toNumber(st.该步骤满分), 0);
}

/** 小问所有步骤的得分之和 */
export function sumStepScore(sub: SubQuestion): number {
  return sub.步骤明细.reduce((s, st) => s + toNumber(st.实际得分), 0);
}

/**
 * 重算小问得分。
 *
 * 规则：
 * - 有步骤明细时：得分 = 步骤得分之和（并钳制在 0 ~ 小问满分）
 * - **没有步骤明细时**：保持原有得分不变
 *   （原先会被归零，导致教师仅修改文字就把学生分数清掉）
 */
export function recomputeSubScore(sub: SubQuestion): void {
  const subMax = toNumber(sub.本小问满分);

  if (sub.步骤明细.length > 0) {
    const stepTotal = sumStepScore(sub);
    sub.本小问学生得分 = normalizeScore(clamp(stepTotal, 0, subMax));
  } else {
    // 无步骤明细：只做边界钳制，不改变分数来源
    sub.本小问学生得分 = normalizeScore(
      clamp(toNumber(sub.本小问学生得分), 0, subMax)
    );
  }
}

/** 重算大题实得分 = 各小问得分之和，封顶不超过大题总分 */
export function recomputeBigScore(big: BigQuestionData): void {
  const total = big.小问列表.reduce(
    (s, sq) => s + toNumber(sq.本小问学生得分),
    0
  );
  big.大题实得分 = normalizeScore(
    clamp(total, 0, toNumber(big.大题总分))
  );
}

/**
 * 修改步骤明细后，重算所属小问与大题。
 *
 * @param big 所属大题
 * @param sub 所属小问
 */
export function refreshSubAndBigScore(big: BigQuestionData, sub: SubQuestion): void {
  // 步骤得分先做上限钳制，避免出现「得分超过该步满分」
  sub.步骤明细 = sub.步骤明细.map((step) => {
    const max = toNumber(step.该步骤满分);
    return {
      ...step,
      实际得分: normalizeScore(clamp(toNumber(step.实际得分), 0, max)),
    };
  });

  recomputeSubScore(sub);
  recomputeBigScore(big);
}

/**
 * 修改小问学生得分。
 *
 * 只影响分数，不重置步骤明细。
 */
export function applySubStudentScore(
  sub: SubQuestion,
  value: string
): void {
  const subMax = toNumber(sub.本小问满分);
  sub.本小问学生得分 = normalizeScore(
    clamp(toNumber(value), 0, subMax)
  );
}

/**
 * 修改小问标准满分。
 *
 * 得分超过新满分时同步下调。
 */
export function applySubStandardScore(
  sub: SubQuestion,
  value: string
): void {
  const newMax = Math.max(0, toNumber(value));
  sub.本小问满分 = normalizeScore(newMax);

  const stuScore = toNumber(sub.本小问学生得分);
  if (stuScore > newMax) {
    sub.本小问学生得分 = normalizeScore(newMax);
  }
}

/**
 * 修改大题标准总分（满分）—— 始终联动所有小问。
 *
 * - 无论该大题是否被人工改过分，都按比例缩放其下所有小问的满分与得分，
 *   并同步缩放步骤明细，保证「步骤满分之和 == 小问满分 == 大题总分」自洽。
 * - hasManualEdit 现在仅作为学生端「教师修正」标记展示，不再阻止缩放。
 * - 缩放基准取「当前各小问满分之和」而非旧的大题总字段：
 *   两者可能因 AI 计算或人工改动而不一致，用小问之和做基准可保证
 *   缩放后 Σ小问满分 == 新大题总分。
 */
export function applyBigStandardScore(
  big: BigQuestionData,
  value: string
): void {
  const newTotal = Math.max(0, toNumber(value));
  big.大题总分 = normalizeScore(newTotal);

  const subs = big.小问列表 || [];
  const oldSubMaxSum = subs.reduce(
    (s, sq) => s + toNumber(sq.本小问满分),
    0
  );

  if (oldSubMaxSum > 0) {
    const scale = newTotal / oldSubMaxSum;
    subs.forEach((sq) => {
      sq.本小问满分 = normalizeScore(toNumber(sq.本小问满分) * scale);
      sq.本小问学生得分 = normalizeScore(toNumber(sq.本小问学生得分) * scale);
      // 步骤明细必须同步缩放，否则会出现「小问满分变了、步骤满分还是旧的」，
      // 触发前端分数不一致告警，保存后数据也自相矛盾。
      sq.步骤明细 = (sq.步骤明细 || []).map((st) => ({
        ...st,
        该步骤满分: normalizeScore(toNumber(st.该步骤满分) * scale),
        实际得分: normalizeScore(toNumber(st.实际得分) * scale),
      }));
    });
  } else if (subs.length > 0 && newTotal > 0) {
    // 兜底：原各小问满分全为 0 时无法按比例缩放，改为平均分配满分。
    const avg = normalizeScore(newTotal / subs.length);
    subs.forEach((sq) => {
      sq.本小问满分 = avg;
      sq.本小问学生得分 = '0';
      sq.步骤明细 = (sq.步骤明细 || []).map((st) => ({
        ...st,
        该步骤满分: '0',
        实际得分: '0',
      }));
    });
  }

  recomputeBigScore(big);
}

/** 深拷贝一条提交记录，避免直接改动 state 引用 */
export function cloneRecord<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 判断步骤明细是否与所在小问的满分自洽 */
export function isStepConsistent(sub: SubQuestion): boolean {
  if (!sub.步骤明细.length) return true;
  return Math.abs(sumStepMax(sub) - toNumber(sub.本小问满分)) < 0.001;
}

/** 判断步骤得分之和与步骤满分之和是否一致 */
export function isStepScoreConsistent(sub: SubQuestion): boolean {
  if (!sub.步骤明细.length) return true;
  return Math.abs(sumStepScore(sub) - sumStepMax(sub)) < 0.001;
}

/** 生成一条空步骤，供新增步骤使用 */
export function createEmptyStep(index: number): StepItem {
  return {
    步骤序号: index + 1,
    该步骤满分: '0',
    实际得分: '0',
    判定: '正确',
    说明: '',
  };
}

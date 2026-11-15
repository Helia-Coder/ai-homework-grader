// web-frontend/src/lib/mathTool.ts

/**
 * 这是一个原生的数学算分校验工具。
 * 用于拦截大模型返回的步骤分与总分不匹配的“幻觉”。
 * 概念上等同于 Agent 的 Function Calling（工具调用）。
 */
export function validateAndFixScores(data: any) {
  if (!data || !data.小问列表) return data;

  data.小问列表.forEach((subQ: any) => {
    if (subQ.步骤明细 && subQ.步骤明细.length > 0) {
      let stepSum = 0;
      subQ.步骤明细.forEach((step: any) => {
        stepSum += parseFloat(step.该步骤满分) || 0;
      });

      const maxScore = parseFloat(subQ.本小问满分) || 0;

      // 触发工具校准逻辑
      if (Math.abs(stepSum - maxScore) > 0.1 && maxScore > 0) {
        const ratio = maxScore / stepSum;
        subQ.步骤明细.forEach((step: any) => {
          step.该步骤满分 = (parseFloat(step.该步骤满分) * ratio).toFixed(1);
        });

        // 打上系统工具拦截的标记
        subQ.错因归因 = `【系统工具拦截】检测到大模型拆分步骤异常，已调用算分工具强制校准。` + (subQ.错因归因 || "");
      }
    }
  });

  return data;
}
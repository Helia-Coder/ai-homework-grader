/**
 * LaTeX 文本归一化：把模型/学生作答里各种「公式分隔符」统一成
 * remark-math 能识别的 `$...$` / `$$...$$`。
 *
 * 背景（实测）：remark-math 默认只认 `$...$` 与 `$$...$$`。当大模型输出
 * LaTeX 标准分隔符 `\(...\)`（行内）或 `\[...\]`（块级）时，公式不会渲染，
 * 而且 markdown 还会吞掉反斜杠，最终显示成裸文本 `(x^2)`。
 * 模型不同批次会混用这两种写法，表现就是「有时候渲染、有时候不渲染」。
 */
export function normalizeLatexDelimiters(input: string): string {
  if (!input) return '';

  let text = input;

  // 1) 先把块级 \[ ... \] 归一化为 $$ ... $$
  //    允许跨行（[\s\S]），非贪婪匹配；\[ 与 \] 周围可有空白
  text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_m, body: string) => {
    return `\n$$\n${body}\n$$\n`;
  });

  // 2) 再把行内 \( ... \) 归一化为 $ ... $
  //    单行内非贪婪匹配
  text = text.replace(/\\\(([\s\S]*?)\\\)/g, (_m, body: string) => {
    return `$${body}$`;
  });

  return text;
}

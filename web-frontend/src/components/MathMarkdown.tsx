"use client";

import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { normalizeLatexDelimiters } from '@/lib/mathText';

interface MathMarkdownProps {
  children?: string | null;
}

/**
 * 统一的 Markdown + KaTeX 渲染组件。
 *
 * 在渲染前把 \(...\) / \[...\] 归一化成 remark-math 识别的 $...$ / $$...$$，
 * 解决「学生作答 / AI 讲评里的公式有时不渲染」的问题。
 * 直接返回 ReactMarkdown，不额外增加 DOM 层级，保持与原有布局一致。
 */
export default function MathMarkdown({ children }: MathMarkdownProps) {
  const source = normalizeLatexDelimiters(children ?? '');
  return (
    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
      {source}
    </ReactMarkdown>
  );
}

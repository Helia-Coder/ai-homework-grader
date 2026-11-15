import { NextResponse } from 'next/server';
import { chatCompletionStream, EVALUATE_MODEL } from '@/lib/dashscope';
import rules from '@/lib/rules.json';

export const maxDuration = 120;

function buildPrompt(question: string, answer: string): string {
  // 1. 极简 RAG 检索：根据题目特征匹配规则
  let rulePrompt = (rules as any)["通用"] || "【评分细则】按步骤踩点给分，逻辑跳跃酌情扣分。";

  if (question.includes("方程") || question.includes("=") || question.includes("x")) {
    rulePrompt = (rules as any)["方程"];
  } else if (question.includes("证明") || question.includes("三角") || question.includes("形")) {
    rulePrompt = (rules as any)["几何"];
  } else if (question.includes("函数") || question.includes("f(x)")) {
    rulePrompt = (rules as any)["函数"];
  }

  // 2. 将检索到的规则拼接到 Prompt 中
  return `你是经验丰富的初中数理化任课老师。

${rulePrompt}  <--- 这是检索到的专属评分标准，请严格遵循！

现在给到你的是包含多个小问的大题（包含大题干+所有小问的题干和学生作答）。
请对**整道大题所有小问统一深度讲评**：
1. 逐个分析，分步拆解解题思路；
2. 标注每一处对错：✅正确，❌错误，⚠️易错提醒；
3. 指出共性错误、思维漏洞；
4. 给出标准解题步骤、同类题技巧；
5. 输出使用 markdown 格式，排版清晰。

题目与作答信息：
${question}

学生作答：
${answer}
`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const question = typeof body?.question === 'string' ? body.question : '';
    const answer = typeof body?.answer === 'string' ? body.answer : '';

    if (!question.trim()) {
      return NextResponse.json({ error: '缺少题目内容' }, { status: 400 });
    }

    const upstreamBody = await chatCompletionStream(
      [{ role: 'user', content: buildPrompt(question, answer || '（未提供学生作答）') }],
      EVALUATE_MODEL
    );

    const encoder = new TextEncoder();

    const readableStream = new ReadableStream({
      async start(controller) {
        const reader = upstreamBody.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const forward = (line: string) => {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) return;
          if (trimmed === 'data: [DONE]') return;
          controller.enqueue(encoder.encode(trimmed + '\n\n'));
        };

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              forward(line);
            }
          }

          if (buffer.trim()) {
            forward(buffer);
          }

          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        } catch (err) {
          const message = err instanceof Error ? err.message : '上游流式接口中断';
          console.error('[evaluate] 流式转发异常：', message);
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`)
            );
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          } catch {
            // 已关闭
          }
        } finally {
          try {
            controller.close();
          } catch {
            // 已关闭
          }
        }
      },
    });

    return new NextResponse(readableStream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
        Connection: 'keep-alive',
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : '未知错误';
    console.error('[evaluate] 异常：', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
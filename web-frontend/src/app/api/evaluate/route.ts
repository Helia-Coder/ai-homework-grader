// src/app/api/evaluate/route.ts
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { question, answer } = await request.json();

    // 以后队友要加评分细则（RAG），就在这里去读 rules.json，然后塞进 prompt 里
    const apiKey = process.env.DASHSCOPE_API_KEY;

    const prompt = `
你是一个严格的高考/中考数理化批改老师。
题目：${question}
学生作答：${answer}

请评估这个作答（假设满分10分），并严格按以下 JSON 格式输出，不要输出任何其他废话，不要用 markdown 包裹：
{
  "得分": 8,
  "满分": 10,
  "错因归因": "指出学生具体哪一步算错了或逻辑不对",
  "讲评建议": "给出一句话的教师建议"
}
`;

    // 这里使用公共文本模型（用专属空间的模型也可以，这里为了演示方便走公共）
    // 注意：队友接手后，可以把这里换成更复杂的 Agent 逻辑
    const response = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: "qwen-plus", // 用文本模型批改即可
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!response.ok) throw new Error("大模型调用失败");

    const data = await response.json();
    return NextResponse.json({ result: data.choices[0].message.content });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
// 文件位置: web-frontend/src/app/api/grade/route.ts
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { img_b64 } = body; // 前端传过来的 Base64 图片

    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: '未配置 API Key' }, { status: 500 });
    }

    const url = "https://ws-450xn3noh85vtypq.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions";

    // 就是咱们在 Python 里用的那个 Prompt
    const prompt = `
你是一个专业的数理化作业批改助手。
请识别这张图片中的多道题目，并严格按以下 JSON 数组格式输出，不要输出任何其他废话，不要用 markdown 代码块包裹：
[
  {
    "题号": "1",
    "题目": "提取题干内容，公式用 LaTeX 格式",
    "学生作答": "提取学生手写的内容，公式用 LaTeX 格式",
    "识别置信度": "高/中/低"
  },
  {
    "题号": "2",
    "题目": "...",
    "学生作答": "...",
    "识别置信度": "..."
  }
]
`;

    const data = {
      model: "qwen3.7-plus",
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: img_b64 } },
            { type: "text", text: prompt }
          ]
        }
      ]
    };

    // 用原生 fetch 发送请求
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    const content = result.choices[0].message.content;

    return NextResponse.json({ result: content });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
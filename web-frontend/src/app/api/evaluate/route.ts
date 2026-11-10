// web-frontend/src/app/api/evaluate/route.ts
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  try {
    const { question, answer } = await req.json()
    const apiKey = process.env.DASHSCOPE_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: "缺少APIKEY" }, { status: 500 })
    }

    const prompt = `你是经验丰富的初中数理化任课老师。
现在给到你的是一道包含多个小问的大题（包含大题题干 + 全部小问的题干和学生作答）。
请对**整道大题所有小问统一深度讲评**：
1. 逐个小问分析，分步拆解解题思路；
2. 标注每一处对错：✅正确，❌错误，⚠️易错提醒；
3. 指出学生的共性错误、思维漏洞；
4. 给出标准解题步骤、同类题解题技巧；
5. 输出使用markdown格式，排版清晰，适合学生阅读。

题目与作答信息：
${question}
`

    const url = "https://ws-450xn3noh85vtypq.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions"
    const upstreamRes = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "qwen3.7-plus",
        stream: true,
        messages: [{ role: "user", content: prompt }]
      })
    })

    if (!upstreamRes.ok || !upstreamRes.body) {
      throw new Error("上游流式接口请求失败")
    }

    const encoder = new TextEncoder()
    const readableStream = new ReadableStream({
      async start(controller) {
        const reader = upstreamRes.body!.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split("\n")
          buffer = lines.pop() || ""
          for (const line of lines) {
            const trimLine = line.trim()
            if (trimLine.startsWith("data: ")) {
              controller.enqueue(encoder.encode(trimLine + "\n"))
            }
          }
        }
        controller.close()
      }
    })

    return new NextResponse(readableStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive"
      }
    })
  } catch (e: any) {
    console.error('evaluate后端捕获异常：', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
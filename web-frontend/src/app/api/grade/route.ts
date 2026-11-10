// web-frontend/src/app/api/grade/route.ts
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    console.log("【grade】收到POST请求");
    const body = await request.json();
    console.log("【grade】收到图片base64（省略长串内容）");
    const { img_b64 } = body;

    if (!img_b64) {
      console.log("【grade】缺少img_b64");
      return NextResponse.json({ error: '没有收到图片base64' }, { status: 400 });
    }

    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      console.log("【grade】DASHSCOPE_API_KEY环境变量为空");
      return NextResponse.json({ error: '未配置 API Key' }, { status: 500 });
    }
    console.log("【grade】apiKey已读取");

    const url = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
    console.log("【grade】请求上游地址：", url);

    const prompt = `你是一个专业的数理化作业批改助手。
请仔细查看整张图片，找到图片内所有大题，识别大题以及大题下面的各个小问，全部识别出来，一个小问都不能漏掉，采用分步给分制阅卷。
【计分规则（严格遵守）】
1. 优先识别大题的总分：
   - 如果大题标注了总分（例如大题一共15分、14分），以这个数字作为大题总分池；
   - 如果大题本身没有标注总分，则该大题整体默认总分固定为10分。
2. 大题内部小问分值分配：
   - 若部分小问单独标注分值：未标注分值的小问分值 = 大题总分 − 所有已经标注分值的小问分数之和；
   - 若大题有总分，但所有小问都没有单独标注分值：你根据每个小问的难度、步骤权重，在大题总分范围内酌情分配各小问分值，**所有小问分值相加必须等于大题总分**。
3. 【强制校验规则，必须核对】
输出完成前自行验算：同一个大题下全部小问的本小问满分之和必须等于该大题总分；每个小问内全部步骤分值之和必须等于该小问满分；并且把所有步骤【实际得分】相加，得到【大题实得分】。
⚠️重要规则：输出JSON里所有LaTeX公式的反斜杠必须写双反斜杠\\\\，禁止单独的\；不要换行、不要多余注释、不要markdown代码块，只输出纯净JSON数组。
严格按以下JSON数组格式输出：
[
  {
    "大题题号": "17",
    "大题题干": "大题总题干内容，公式用 LaTeX 格式",
    "大题总分": "15",
    "大题实得分": "12",
    "识别置信度": "高/中/低",
    "小问列表": [
      {
        "小问编号": "(1)",
        "小问题干": "提取(1)的题干内容，公式用 LaTeX 格式",
        "学生作答": "提取学生本小问手写内容，公式用 LaTeX 格式",
        "本小问满分": "8",
        "评分细则": "写明本小问满分，写明每一步分值、扣分规则",
        "步骤明细": [
          {
            "步骤序号": 1,
            "该步骤满分": "X",
            "实际得分": "X",
            "判定": "正确/部分正确/错误",
            "说明": "描述这一步对错原因"
          }
        ],
        "错因归因": "汇总本小问全部错误",
        "讲评建议": "针对本小问一句话教学建议"
      },
      {
        "小问编号": "(2)",
        "小问题干": "提取(2)的题干内容，公式用 LaTeX 格式",
        "学生作答": "提取学生本小问手写内容，公式用 LaTeX 格式",
        "本小问满分": "7",
        "评分细则": "写明本小问满分，写明每一步分值、扣分规则",
        "步骤明细": [
          {
            "步骤序号": 1,
            "该步骤满分": "X",
            "实际得分": "X",
            "判定": "正确/部分正确/错误",
            "说明": "描述这一步对错原因"
          }
        ],
        "错因归因": "汇总本小问全部错误",
        "讲评建议": "针对本小问一句话教学建议"
      }
    ]
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
    console.log("【grade】组装请求完成，模型：", data.model);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });

    console.log("【grade】上游response.status：", response.status);
    const errText = await response.text();

    if (!response.ok) {
      throw new Error(`上游接口错误，状态码: ${response.status}`);
    }

    const result = JSON.parse(errText);
    let content = result.choices?.[0]?.message?.content ?? "";

    // 清洗逻辑
    content = content.replace(/```json/g, "").replace(/```/g, "").trim();
    content = content.replace(/(?<!\\)\\(?!\\)/g, "\\\\");
    content = content.replace(/[\x00-\x1F]/g, "");

    // ✅ 只做清洗，不提前JSON.parse！直接返回字符串给前端！
    return NextResponse.json({ result: content });
  } catch (error: any) {
    console.error('【grade】异常：', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
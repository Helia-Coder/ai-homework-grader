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
请仔细查看整张图片，找到图片内所有大题，识别大题以及大题下面的各个小问，全部识别出来，一个小问都不能漏掉。
【题型区分规则】
1. 选择题：识别题干、A/B/C/D全部选项，学生手写选择答案。学生如果手写演算草稿过程，草稿仅用来辅助判断最终答案对错，草稿不单独分步打分。**不拆分步骤分，整题统一判定**。答对拿本小问满分，答错给0分，步骤明细写空数组[]。
2. 填空题：识别题干、学生手写填写的答案，不需要识别选项。学生如果手写演算草稿过程，草稿仅用来辅助判断最终答案对错，草稿不单独分步打分。**不拆分步骤分，整题统一判定**。答对拿本小问满分，答错给0分，步骤明细写空数组[]。
3. 解答题：采用分步给分制阅卷，正常输出步骤明细、每一步分值和判定。

【计分规则（严格遵守，替换原来的计分逻辑）】
1. 优先识别大题标注的总分：
   - 情况A：大题有明确总分，其中一部分小问单独标了分值：剩余没有标注分值的小问，分值 = 大题总分 − 已经标出的小问分值之和，再对这个剩余分值在无标注的小问之间酌情分配；
   - 情况B：大题有明确总分，所有小问都没有单独标分值：大题总分在各个小问之间酌情分配；
   - 情况C：大题图片上完全没有标注任何总分：该大题总分固定为10分，再在各个小问之间酌情分配。
2. 大题总分 = 识别出来的大题分值（无标注则10），所有小问的满分加起来必须等于大题总分。
3. 【强制校验规则，必须核对】
输出完成前自行验算：解答题每个小问内全部步骤分值之和必须等于该小问满分；并且把所有小问【实际得分】相加，得到【大题实得分】。

【格式强制要求】
写LaTeX公式时：中文文字（平面、边长、角度、面积等汉字）不能直接放在 $ $ 内部！如果公式里需要中文，必须用 \\text{汉字} 包裹。
✅ 正确示例：$\\text{平面}ABCD$
❌ 禁止写成：$平面ABCD$
普通说明文字不要套上$ $，只有纯数学表达式才加$ $。
⚠️重要规则：
1. 错因归因、讲评建议这两个字段**绝对不能为空**
2. 如果学生答案错误：错因归因写清楚错在哪一步、概念哪里理解错；讲评建议写对应的知识点和练习方向
3. 如果学生答案正确：错因归因填“作答正确，无错误”，讲评建议填“掌握良好，继续保持”
4. 严格输出JSON，字段不能少，不能留白
输出JSON里所有LaTeX公式的反斜杠必须写双反斜杠\\\\，禁止单独的\；不要换行、不要多余注释、不要markdown代码块，只输出纯净JSON数组。
严格按以下JSON数组格式输出：
[
  {
    "大题题号": "17",
    "大题题干": "大题总题干内容，公式用 LaTeX 格式",
    "大题总分": "10",
    "大题实得分": "5",
    "识别置信度": "高/中/低",
    "小问列表": [
      {
        "小问编号": "(1)",
        "小问题干": "提取(1)的题干内容，公式用 LaTeX 格式",
        "选项内容": "A.xxx B.xxx shtur D.xxx",
        "学生作答": "学生选的答案，如B",
        "本小问满分": "5",
        "评分细则": "选择题：选对得5分，选错得0分，演算草稿仅辅助判断答案",
        "步骤明细": [],
        "错因归因": "选错答案",
        "讲评建议": "记住对应知识点"
      },
      {
        "小问编号": "(2)",
        "小问题干": "提取(2)的题干内容，公式用 LaTeX 格式",
        "选项内容": "",
        "学生作答": "学生填写的答案",
        "本小问满分": "5",
        "评分细则": "填空题：答案正确得5分，错误得0分，演算草稿仅辅助判断答案",
        "步骤明细": [],
        "错因归因": "答案填写错误",
        "讲评建议": "熟记公式结果"
      },
      {
        "小问编号": "(3)",
        "小问题干": "提取(3)的题干内容，公式用 LaTeX 格式",
        "选项内容": "",
        "学生作答": "提取学生本小问手写内容，公式用 LaTeX 格式",
        "本小问满分": "6",
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
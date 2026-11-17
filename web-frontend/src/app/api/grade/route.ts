import { NextResponse } from 'next/server';
import { chatCompletion, GRADE_MODEL } from '@/lib/dashscope';
import { parseGradingResult } from '@/lib/grading-parser';
import { validateAndFixScores } from '@/lib/mathTool';
import { verifyToken, unauthorized } from '@/lib/auth';

export const maxDuration = 300;

const PROMPT = `你是一个极速响应的数理化作业批改助手。请直接输出纯净的JSON，绝对不要输出任何多余的废话或解释。
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
1. 错因归因、讲评建议这两个字段绝对不能为空，且必须是**一句话短句**（15字以内）。
2. 如果学生答案错误：错因归因写清错在哪一步；讲评建议写对应知识点。
3. 如果学生答案正确：错因归因填"正确"，讲评建议填"继续保持"。
4. 严格输出JSON，字段不能少，不能留白
输出JSON里所有LaTeX公式的反斜杠必须写双反斜杠\\\\，禁止单独的\\；不要换行、不要多余注释、不要markdown代码块，只输出纯净JSON数组。
严格按以下JSON数组格式输出：
[
  {
    "科目":"数学",
    "大题题号": "17",
    "大题题干": "大题总题干内容，公式用 LaTeX 格式",
    "大题总分": "10",
    "大题实得分": "5",
    "识别置信度": "高/中/低",
    "小问列表": [
      {
        "小问编号": "(1)",
        "小问题干": "提取(1)的题干内容，公式用 LaTeX 格式",
        "选项内容": "A.xxx B.xxx C.xxx D.xxx",
        "学生作答": "学生选的答案，如B",
        "本小问满分": "5",
        "本小问学生得分": "5",
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
        "本小问学生得分": "5",
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
        "本小问学生得分": "6",
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

export async function POST(request: Request) {
  try {
    // AI 批改会消耗真实模型额度，必须先鉴权
    const auth = await verifyToken(request);
    if (!auth) return unauthorized();

    const body = await request.json().catch(() => ({}));
    const img_b64 = body?.img_b64;

    if (!img_b64 || typeof img_b64 !== 'string') {
      return NextResponse.json({ error: '没有收到图片base64' }, { status: 400 });
    }

    const content = await chatCompletion(
      [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: img_b64 } },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
      GRADE_MODEL
    );

    if (!content || !content.trim()) {
      return NextResponse.json(
        { error: '模型未返回内容，请重试' },
        { status: 502 }
      );
    }

   // 1. 解析大模型返回的内容
   const parsed = parseGradingResult(content);

   if (!Array.isArray(parsed)) {
     return NextResponse.json(
       { error: '批改结果格式异常，请重试' },
       { status: 502 }
     );
   }

   // 2. 🚨 核心：调用刚引入的“原生算分校验工具”！
   // 因为 parse 出来是个大题数组，我们遍历每个大题，把大模型幻觉强制干掉
   const fixedData = parsed.map((bigQ: any) => validateAndFixScores(bigQ));

   // 3. 把校准后的数据重新转回字符串，覆盖原来的 content
   // 这样前端无论读 data.result 还是 data.data，拿到的都是被工具修复过的正确数据
   const fixedContent = JSON.stringify(fixedData);

   return NextResponse.json({ result: fixedContent, data: fixedData });
  } catch (error) {
    console.error('[grade] 异常：', error);
    return NextResponse.json({ error: '批改服务暂时不可用，请稍后重试' }, { status: 500 });
  }
}
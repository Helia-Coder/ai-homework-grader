"use client";
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

// ========== 类型定义：新版【大题+小问嵌套结构】 ==========
interface StepItem {
  步骤序号: number;
  该步骤满分: string;
  实际得分: string;
  判定: string;
  说明: string;
}

interface SubQuestion {
  小问编号: string;
  小问题干: string;
  学生作答: string;
  本小问满分: string;
  评分细则: string;
  步骤明细: StepItem[];
  错因归因: string;
  讲评建议: string;
}

interface BigQuestionData {
  大题题号: string;
  大题题干: string;
  大题总分: string;
  大题实得分: string;
  识别置信度: string;
  小问列表: SubQuestion[];
}

// ✅ 图片压缩函数
async function compressImage(file: File, maxWidth = 1024, quality = 0.75): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = () => {
      if (img.width <= maxWidth) {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
        return;
      }
      const canvas = document.createElement('canvas');
      let w = img.width;
      let h = img.height;
      h = (maxWidth / w) * h;
      w = maxWidth;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    };
  });
}

export default function Home() {
  const [role, setRole] = useState<'student' | 'teacher' | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [results, setResults] = useState<BigQuestionData[]>([]);
  const [loading, setLoading] = useState(false);

  const [evaluatingIndex, setEvaluatingIndex] = useState<number | null>(null);
  const [evalResults, setEvalResults] = useState<Record<number, string>>({});

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const fileArray = Array.from(files);
    Promise.all(fileArray.map(file => compressImage(file)))
      .then(compressedBase64List => {
        setImages(prev => [...prev, ...compressedBase64List]);
      });
    e.target.value = "";
  };

  const handleSubmit = async () => {
    if (images.length === 0) return;
    setLoading(true);
    setResults([]);
    setEvalResults({});
    let allParsedData: BigQuestionData[] = [];

    try {
      for (let i = 0; i < images.length; i++) {
        const response = await fetch('/api/grade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ img_b64: images[i] })
        });
        if (!response.ok) throw new Error(`第 ${i + 1} 张图服务器报错`);
        const data = await response.json();
        const cleanJsonStr = data.result.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsedData = JSON.parse(cleanJsonStr);

        if (Array.isArray(parsedData)) {
          allParsedData = [...allParsedData, ...parsedData];
        } else {
          allParsedData.push(parsedData);
        }
      }
      setResults(allParsedData);
    } catch (error: any) {
      alert(`出错了: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleEvaluate = async (index: number, question: string, answer: string) => {
    setEvaluatingIndex(index);
    setEvalResults(prev => ({ ...prev, [index]: "" }));
    try {
      const res = await fetch('/api/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, answer })
      });
      if (!res.body) throw new Error("没有返回数据流");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let fullText = "";
      let buffer = "";

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith('data: ') && trimmedLine !== 'data: [DONE]') {
              try {
                const data = JSON.parse(trimmedLine.slice(6));
                const content = data.choices[0]?.delta?.content || "";
                if (content) {
                  fullText += content;
                  setEvalResults(prev => ({ ...prev, [index]: fullText }));
                }
              } catch (e) { }
            }
          }
        }
      }
    } catch (err: any) {
      alert(`批改失败: ${err.message}`);
    } finally {
      setEvaluatingIndex(null);
    }
  };

  if (!role) {
    return (
      <main className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4">
        <h1 className="text-4xl font-bold text-gray-800 mb-4">AI 多模态作业批改 Agent</h1>
        <p className="text-gray-500 mb-10">请选择您的身份进入系统（演示环境免密）</p>
        <div className="flex flex-col md:flex-row gap-6">
          <button
            onClick={() => setRole('student')}
            className="bg-blue-600 text-white px-10 py-8 rounded-2xl shadow-lg hover:bg-blue-700 transition transform hover:scale-105"
          >
            <div className="text-3xl mb-2">👦</div>
            <div className="text-xl font-bold">我是学生</div>
            <div className="text-sm opacity-80">拍照交作业，秒出批改</div>
          </button>

          <button
            onClick={() => setRole('teacher')}
            className="bg-green-600 text-white px-10 py-8 rounded-2xl shadow-lg hover:bg-green-700 transition transform hover:scale-105"
          >
            <div className="text-3xl mb-2">👩‍🏫</div>
            <div className="text-xl font-bold">我是老师</div>
            <div className="text-sm opacity-80">查看班级学情与共性错因</div>
          </button>
        </div>
      </main>
    );
  }

  if (role === 'teacher') {
    return (
      <main className="min-h-screen bg-gray-100 p-8 flex flex-col items-center">
        <div className="w-full max-w-5xl flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800">👩‍🏫 教师学情看板</h1>
          <button onClick={() => setRole(null)} className="text-blue-600 font-medium hover:underline">退出/切换身份</button>
        </div>
        <div className="bg-white p-10 rounded-xl shadow-lg w-full max-w-5xl flex flex-col items-center justify-center min-h-[400px] border-2 border-dashed border-gray-300">
          <h2 className="text-xl text-gray-400">📊 班级知识点掌握热力图与共性错因开发中...</h2>
          <p className="text-sm text-gray-400 mt-2">（队友可以在这里引入 ECharts，读取本地批改记录展示）</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-100 p-4 md:p-8 flex flex-col items-center">
      <div className="w-full max-w-4xl flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-800">👦 学生端：作业批改助手</h1>
          <p className="text-gray-500 text-sm mt-1">💡 支持多图上传与自动切题</p>
        </div>
        <button onClick={() => setRole(null)} className="text-blue-600 font-medium hover:underline">切换身份</button>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-lg w-full max-w-lg mb-8">
        <input
          type="file"
          accept="image/*"
          multiple
          capture="environment"
          onChange={handleImageUpload}
          className="mb-4 w-full file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
        />

        {images.length > 0 && (
          <div className="flex flex-wrap gap-3 mb-6 p-3 bg-gray-50 rounded-lg border">
            {images.map((img, idx) => (
              <div key={idx} className="relative">
                <img src={img} alt="Preview" className="w-20 h-20 md:w-24 md:h-24 object-cover rounded shadow-sm border border-gray-200" />
                <button
                  onClick={() => setImages(prev => prev.filter((_, i) => i !== idx))}
                  className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs hover:bg-red-600 shadow"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={images.length === 0 || loading}
          className="w-full bg-blue-600 text-white font-semibold py-3 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
        >
          {loading ? "Agent 正在识别与切题..." : "第一步：开始识别"}
        </button>
      </div>

      <div className="w-full max-w-4xl space-y-6">
        {results.map((bigItem, bigIdx) => (
          <div key={bigIdx} className="bg-white p-6 rounded-xl shadow-md border-l-4 border-blue-500">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-gray-800">第 {bigItem.大题题号} 题</h2>
              <div className="flex gap-3">
                <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                  bigItem.识别置信度 === '高' ? 'bg-green-100 text-green-700' :
                  bigItem.识别置信度 === '中' ? 'bg-yellow-100 text-yellow-700' :
                  'bg-red-100 text-red-700'
                }`}>
                  置信度: {bigItem.识别置信度}
                </span>
                <span className="px-3 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-700">
                  总分：{bigItem.大题实得分}/{bigItem.大题总分}
                </span>
              </div>
            </div>

            <div className="mb-4">
              <span className="font-semibold text-gray-600 block mb-1">📝 大题题干：</span>
              <div className="bg-gray-50 p-3 rounded text-gray-800 text-sm whitespace-pre-wrap">
                <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{bigItem.大题题干}</ReactMarkdown>
              </div>
            </div>

            {/* 循环渲染该大题下全部小问 */}
            {bigItem.小问列表.map((subItem, subIdx) => (
              <div key={subIdx} className="border border-gray-200 rounded-lg p-4 mb-4 bg-gray-50">
                <h3 className="font-bold text-gray-700 mb-3">小问{subItem.小问编号}（本小问满分：{subItem.本小问满分}分）</h3>

                <div className="mb-3">
                  <span className="font-semibold text-gray-600 block mb-1">📝 小问题干：</span>
                  <div className="bg-white p-3 rounded text-gray-800 text-sm whitespace-pre-wrap">
                    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{subItem.小问题干}</ReactMarkdown>
                  </div>
                </div>

                <div className="mb-3">
                  <span className="font-semibold text-gray-600 block mb-1">✍️ 学生作答：</span>
                  <div className="bg-white p-3 rounded text-gray-800 text-sm whitespace-pre-wrap">
                    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{subItem.学生作答}</ReactMarkdown>
                  </div>
                </div>

                {subItem.评分细则 && (
                  <div className="my-3">
                    <span className="font-semibold text-gray-600 block mb-1">📌 评分细则：</span>
                    <div className="bg-amber-50 p-3 rounded text-gray-800 text-sm whitespace-pre-wrap border border-amber-200">
                      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                        {subItem.评分细则}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}

                {subItem.步骤明细 && subItem.步骤明细.length > 0 && (
                  <div className="my-3">
                    <span className="font-semibold text-gray-600 block mb-2">📋 分步阅卷明细：</span>
                    <div className="border rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-100">
                          <tr>
                            <th className="py-2 px-2">步骤</th>
                            <th className="py-2 px-2">本步满分</th>
                            <th className="py-2 px-2">本步得分</th>
                            <th className="py-2 px-2">判定</th>
                            <th className="py-2 px-2">说明</th>
                          </tr>
                        </thead>
                        <tbody>
                          {subItem.步骤明细.map((step, sIdx) => (
                            <tr key={sIdx} className="border-t">
                              <td className="py-2 px-2 text-center">{step.步骤序号}</td>
                              <td className="py-2 px-2 text-center">{step.该步骤满分}</td>
                              <td className="py-2 px-2 text-center">{step.实际得分}</td>
                              <td className={`py-2 px-2 text-center ${
                                step.判定 === "正确" ? "text-green-600" :
                                step.判定 === "部分正确" ? "text-amber-600" :
                                "text-red-600"
                              }`}>{step.判定}</td>
                              <td className="py-2 px-2">{step.说明}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="my-2">
                  <span className="font-semibold text-gray-600">🔍 错因归因：</span>
                  <span className="text-gray-700 ml-1">{subItem.错因归因}</span>
                </div>
                <div className="my-2">
                  <span className="font-semibold text-gray-600">💡 讲评建议：</span>
                  <span className="text-gray-700 ml-1">{subItem.讲评建议}</span>
                </div>
              </div>
            ))}

            {/* 二次深度批改按钮，拿【大题第一小问】传给后端（如果你想要整题传给evaluate我可以再调） */}
            <div className="mt-6 border-t pt-4">
              <button
                onClick={() => handleEvaluate(bigIdx, bigItem.大题题干, bigItem.小问列表[0]?.学生作答 || "")}
                disabled={evaluatingIndex === bigIdx}
                className="bg-green-600 text-white px-6 py-2 rounded-lg font-medium shadow hover:bg-green-700 disabled:bg-gray-400 transition-colors"
              >
                {evaluatingIndex === bigIdx ? "AI 正在深度批改中..." : "✨ 让 AI 批改这道题"}
              </button>

              {evalResults[bigIdx] && (
                <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg animate-fade-in">
                  <div className="prose prose-green max-w-none text-gray-800">
                    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                      {evalResults[bigIdx]}
                    </ReactMarkdown>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}

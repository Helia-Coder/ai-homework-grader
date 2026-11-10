"use client";
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { UploadCloud, CheckCircle, AlertCircle, RefreshCcw, GraduationCap, Users, FileText } from 'lucide-react';

// ========== 类型定义：队友的嵌套结构 ==========
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

// ========== 核心：队友写的图片压缩 ==========
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

    // 使用队友写的压缩
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

  // 1. 身份选择页（精装修版）
  if (!role) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col items-center justify-center p-4">
        <div className="mb-12 text-center">
          <h1 className="text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600 mb-4">
            AI 多模态批改 Agent
          </h1>
          <p className="text-gray-500 text-lg">拍照交作业，秒出步骤级批改</p>
        </div>
        <div className="flex flex-col md:flex-row gap-8">
          <button
            onClick={() => setRole('student')}
            className="group bg-white p-8 rounded-3xl shadow-xl hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-2 border border-transparent hover:border-blue-200 w-64 flex flex-col items-center"
          >
            <div className="bg-blue-100 p-4 rounded-full mb-4 group-hover:scale-110 transition-transform">
              <GraduationCap className="w-12 h-12 text-blue-600" />
            </div>
            <div className="text-2xl font-bold text-gray-800 mb-2">我是学生</div>
            <div className="text-gray-500 text-sm">上传作业，获取即时反馈</div>
          </button>

          <button
            onClick={() => setRole('teacher')}
            className="group bg-white p-8 rounded-3xl shadow-xl hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-2 border border-transparent hover:border-emerald-200 w-64 flex flex-col items-center"
          >
            <div className="bg-emerald-100 p-4 rounded-full mb-4 group-hover:scale-110 transition-transform">
              <Users className="w-12 h-12 text-emerald-600" />
            </div>
            <div className="text-2xl font-bold text-gray-800 mb-2">我是老师</div>
            <div className="text-gray-500 text-sm">查看看板，掌握班级学情</div>
          </button>
        </div>
      </main>
    );
  }

  // 2. 教师端页面
  if (role === 'teacher') {
    return (
      <main className="min-h-screen bg-gray-50 p-8 flex flex-col items-center">
        <div className="w-full max-w-5xl flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800">👩‍🏫 教师学情看板</h1>
          <button onClick={() => setRole(null)} className="flex items-center gap-2 text-blue-600 hover:text-blue-700 font-medium bg-blue-50 px-4 py-2 rounded-lg transition-colors">
            <RefreshCcw className="w-4 h-4" /> 切换身份
          </button>
        </div>
        <div className="bg-white p-10 rounded-2xl shadow-sm w-full max-w-5xl flex flex-col items-center justify-center min-h-[400px] border-2 border-dashed border-gray-300">
          <h2 className="text-xl text-gray-400">📊 班级知识点掌握热力图与共性错因开发中...</h2>
          <p className="text-sm text-gray-400 mt-2">（队友的图表放这里）</p>
        </div>
      </main>
    );
  }

  // 3. 学生端页面（精装修 + 融合队友逻辑）
  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 p-4 md:p-8 flex flex-col items-center">
      <div className="w-full max-w-4xl flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-800">👦 学生端：作业批改助手</h1>
          <p className="text-gray-500 text-sm mt-1">支持多图上传，自动识别并拆分题目</p>
        </div>
        <button onClick={() => setRole(null)} className="flex items-center gap-2 text-gray-600 hover:text-gray-800 font-medium bg-white px-4 py-2 rounded-lg shadow-sm transition-colors border">
          <RefreshCcw className="w-4 h-4" /> 切换身份
        </button>
      </div>

      {/* 上传区域（精装修拖拽框） */}
      <div className="bg-white p-8 rounded-2xl shadow-lg w-full max-w-lg mb-10 border border-gray-100">
        <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-blue-300 border-dashed rounded-xl cursor-pointer bg-blue-50/50 hover:bg-blue-50 transition-colors">
          <div className="flex flex-col items-center justify-center pt-5 pb-6">
            <UploadCloud className="w-10 h-10 text-blue-500 mb-3" />
            <p className="mb-2 text-sm text-gray-600 font-semibold">点击或拖拽上传作业图片</p>
            <p className="text-xs text-gray-400">支持 JPG, PNG (建议一次上传一道大题)</p>
          </div>
          <input type="file" accept="image/*" multiple capture="environment" onChange={handleImageUpload} className="hidden" />
        </label>

        {images.length > 0 && (
          <div className="flex flex-wrap gap-3 mt-6 p-3 bg-gray-50 rounded-xl border border-gray-200">
            {images.map((img, idx) => (
              <div key={idx} className="relative group">
                <img src={img} alt="Preview" className="w-20 h-20 md:w-24 md:h-24 object-cover rounded-lg shadow-sm border border-gray-200" />
                <button
                  onClick={() => setImages(prev => prev.filter((_, i) => i !== idx))}
                  className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs hover:bg-red-600 shadow opacity-0 group-hover:opacity-100 transition-opacity"
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
          className="mt-6 w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold py-3 rounded-xl hover:from-blue-700 hover:to-indigo-700 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed transition-all shadow-md flex justify-center items-center gap-2"
        >
          {loading ? (
            <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> Agent 正在识别与切题...</>
          ) : "第一步：开始识别"}
        </button>
      </div>

      {/* 识别与批改结果（精装修融入了队友的嵌套表格） */}
      <div className="w-full max-w-4xl space-y-8">
        {results.map((bigItem, bigIdx) => (
          <div key={bigIdx} className="bg-white rounded-2xl shadow-md border border-gray-100 overflow-hidden transition-all hover:shadow-lg">

            {/* 大题表头 */}
            <div className="bg-gray-50 px-6 py-4 border-b flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-500" />
                第 {bigItem.大题题号} 题
              </h2>
              <div className="flex gap-3">
                <span className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 ${
                  bigItem.识别置信度 === '高' ? 'bg-green-100 text-green-700' : 
                  bigItem.识别置信度 === '中' ? 'bg-yellow-100 text-yellow-700' : 
                  'bg-red-100 text-red-700'
                }`}>
                  {bigItem.识别置信度 === '高' ? <CheckCircle className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                  置信度: {bigItem.识别置信度}
                </span>
                <span className="px-3 py-1 rounded-full text-xs font-bold bg-blue-600 text-white shadow-sm">
                  得分：{bigItem.大题实得分}/{bigItem.大题总分}
                </span>
              </div>
            </div>

            <div className="p-6 md:p-8">
              {/* 大题题干 */}
              <div className="mb-8">
                <span className="text-sm font-bold text-gray-500 uppercase tracking-wider block mb-2">📝 大题题干</span>
                <div className="bg-gray-50 p-4 rounded-xl text-gray-800 text-base leading-relaxed border border-gray-100">
                  <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{bigItem.大题题干}</ReactMarkdown>
                </div>
              </div>

              {/* 循环渲染小问 */}
              <div className="space-y-6">
                {bigItem.小问列表?.map((subItem, subIdx) => (
                  <div key={subIdx} className="border border-blue-100 rounded-xl p-5 md:p-6 bg-blue-50/30">
                    <h3 className="font-bold text-blue-900 text-lg mb-4 flex justify-between">
                      <span>小问 {subItem.小问编号}</span>
                      <span className="text-sm bg-blue-100 text-blue-700 px-2 py-1 rounded">满分：{subItem.本小问满分}分</span>
                    </h3>

                    <div className="grid md:grid-cols-2 gap-4 mb-4">
                      <div>
                        <span className="text-xs font-bold text-gray-500 block mb-1">📝 小问题干</span>
                        <div className="bg-white p-3 rounded-lg text-gray-800 text-sm border border-gray-100 min-h-[60px]">
                          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{subItem.小问题干}</ReactMarkdown>
                        </div>
                      </div>
                      <div>
                        <span className="text-xs font-bold text-gray-500 block mb-1">✍️ 学生作答</span>
                        <div className="bg-white p-3 rounded-lg text-gray-800 text-sm border border-gray-100 min-h-[60px]">
                          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{subItem.学生作答}</ReactMarkdown>
                        </div>
                      </div>
                    </div>

                    {subItem.评分细则 && (
                      <div className="mb-4">
                        <span className="text-xs font-bold text-gray-500 block mb-1">📌 评分细则</span>
                        <div className="bg-amber-50 p-3 rounded-lg text-amber-900 text-sm border border-amber-200">
                          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{subItem.评分细则}</ReactMarkdown>
                        </div>
                      </div>
                    )}

                    {/* 队友写的极其硬核的分步表格 */}
                    {subItem.步骤明细 && subItem.步骤明细.length > 0 && (
                      <div className="my-4">
                        <span className="text-xs font-bold text-gray-500 block mb-2">📋 分步阅卷明细</span>
                        <div className="border border-gray-200 rounded-lg overflow-hidden bg-white shadow-sm overflow-x-auto">
                          <table className="w-full text-sm min-w-[600px]">
                            <thead className="bg-gray-100 text-gray-600">
                              <tr>
                                <th className="py-3 px-3 font-semibold text-center">步骤</th>
                                <th className="py-3 px-3 font-semibold text-center">本步满分</th>
                                <th className="py-3 px-3 font-semibold text-center">本步得分</th>
                                <th className="py-3 px-3 font-semibold text-center">判定</th>
                                <th className="py-3 px-3 font-semibold">说明</th>
                              </tr>
                            </thead>
                            <tbody>
                              {subItem.步骤明细.map((step, sIdx) => (
                                <tr key={sIdx} className="border-t border-gray-100 hover:bg-gray-50">
                                  <td className="py-3 px-3 text-center text-gray-500">{step.步骤序号}</td>
                                  <td className="py-3 px-3 text-center">{step.该步骤满分}</td>
                                  <td className="py-3 px-3 text-center font-bold text-blue-600">{step.实际得分}</td>
                                  <td className={`py-3 px-3 text-center font-bold ${
                                    step.判定 === "正确" ? "text-green-600" :
                                    step.判定 === "部分正确" ? "text-amber-600" : "text-red-600"
                                  }`}>{step.判定}</td>
                                  <td className="py-3 px-3 text-gray-600">{step.说明}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    <div className="mt-4 bg-white p-4 rounded-lg border border-gray-100">
                      <div className="mb-2">
                        <span className="font-bold text-gray-700 text-sm">🔍 错因归因：</span>
                        <span className="text-gray-600 text-sm ml-1">{subItem.错因归因}</span>
                      </div>
                      <div>
                        <span className="font-bold text-gray-700 text-sm">💡 讲评建议：</span>
                        <span className="text-gray-600 text-sm ml-1">{subItem.讲评建议}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* 深度批改按钮 */}
              <div className="mt-8 pt-6 border-t border-gray-100">
                <button
                  onClick={() => handleEvaluate(bigIdx, bigItem.大题题干, bigItem.小问列表?.[0]?.学生作答 || "")}
                  disabled={evaluatingIndex === bigIdx}
                  className="bg-white border-2 border-green-500 text-green-600 px-6 py-2.5 rounded-xl font-bold shadow-sm hover:bg-green-50 hover:text-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2 w-full md:w-auto justify-center"
                >
                  {evaluatingIndex === bigIdx ? (
                    <><div className="w-4 h-4 border-2 border-green-600 border-t-transparent rounded-full animate-spin"></div> AI 正在深度批改...</>
                  ) : "✨ 让 AI 深度批改这道题"}
                </button>

                {evalResults[bigIdx] && (
                  <div className="mt-5 p-6 bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 rounded-xl shadow-inner">
                    <div className="prose prose-green max-w-none text-gray-800">
                      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                        {evalResults[bigIdx]}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}
              </div>

            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
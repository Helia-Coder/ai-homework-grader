"use client";
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

interface QuestionData {
  题号: string;
  题目: string;
  学生作答: string;
  识别置信度: string;
}

export default function Home() {
  // --- 状态定义 ---
  const [role, setRole] = useState<'student' | 'teacher' | null>(null); // 新增：身份状态
  const [images, setImages] = useState<string[]>([]);
  const [results, setResults] = useState<QuestionData[]>([]);
  const [loading, setLoading] = useState(false);

  const [evaluatingIndex, setEvaluatingIndex] = useState<number | null>(null);
  const [evalResults, setEvalResults] = useState<Record<number, string>>({});

  // --- 逻辑函数 ---
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const fileArray = Array.from(files);
    Promise.all(fileArray.map(file => {
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (event) => resolve(event.target?.result as string);
        reader.readAsDataURL(file);
      });
    })).then(base64Images => {
      setImages(prev => [...prev, ...base64Images]);
    });
    e.target.value = "";
  };

  const handleSubmit = async () => {
    if (images.length === 0) return;
    setLoading(true);
    setResults([]);
    setEvalResults({});
    let allParsedData: any[] = [];

    try {
      for (let i = 0; i < images.length; i++) {
        const response = await fetch('/api/grade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ img_b64: images[i] })
        });
        if (!response.ok) throw new Error(`第 ${i+1} 张图服务器报错`);
        const data = await response.json();
        const cleanJsonStr = data.result.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsedData = JSON.parse(cleanJsonStr);

        if (Array.isArray(parsedData)) {
          allParsedData = [...allParsedData, ...parsedData];
        } else {
          allParsedData.push(parsedData);
        }
      }

      const renumberedData = allParsedData.map((item, index) => ({
        ...item,
        题号: (index + 1).toString()
      }));
      setResults(renumberedData);
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
              } catch (e) {}
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

  // ==========================================
  // 页面渲染部分：根据 role 状态展示不同页面
  // ==========================================

  // 1. 角色选择页（欢迎页）
  if (!role) {
    return (
      <main className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4">
        <h1 className="text-4xl font-bold text-gray-800 mb-4">AI 多模态作业批改 Agent</h1>
        <p className="text-gray-500 mb-10">请选择您的身份进入系统（演示环境免密）</p >
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

  // 2. 教师端页面（留给队友做图表的地方）
  if (role === 'teacher') {
    return (
      <main className="min-h-screen bg-gray-100 p-8 flex flex-col items-center">
        <div className="w-full max-w-5xl flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800">👩‍🏫 教师学情看板</h1>
          <button onClick={() => setRole(null)} className="text-blue-600 font-medium hover:underline">退出/切换身份</button>
        </div>

        {/* 给队友的舞台 */}
        <div className="bg-white p-10 rounded-xl shadow-lg w-full max-w-5xl flex flex-col items-center justify-center min-h-[400px] border-2 border-dashed border-gray-300">
          <h2 className="text-xl text-gray-400">📊 班级知识点掌握热力图与共性错因开发中...</h2>
          <p className="text-sm text-gray-400 mt-2">（队友可以在这里引入 ECharts，读取本地批改记录展示）</p >
        </div>
      </main>
    );
  }

  // 3. 学生端页面（你原来写的代码都在这里！）
  return (
    <main className="min-h-screen bg-gray-100 p-4 md:p-8 flex flex-col items-center">
      <div className="w-full max-w-4xl flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-800">👦 学生端：作业批改助手</h1>
          <p className="text-gray-500 text-sm mt-1">💡 支持多图上传与自动切题</p >
        </div>
        <button onClick={() => setRole(null)} className="text-blue-600 font-medium hover:underline">切换身份</button>
      </div>

      {/* 这里是你的上传卡片 */}
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
                < img src={img} alt="Preview" className="w-20 h-20 md:w-24 md:h-24 object-cover rounded shadow-sm border border-gray-200" />
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

      {/* 这里是题目卡片渲染区域 */}
      <div className="w-full max-w-4xl space-y-6">
        {results.map((item, index) => (
          <div key={index} className="bg-white p-6 rounded-xl shadow-md border-l-4 border-blue-500">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-gray-800">第 {item.题号 || index + 1} 题</h2>
              <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                item.识别置信度 === '高' ? 'bg-green-100 text-green-700' : 
                item.识别置信度 === '中' ? 'bg-yellow-100 text-yellow-700' : 
                'bg-red-100 text-red-700'
              }`}>
                置信度: {item.识别置信度}
              </span>
            </div>

            <div className="mb-4">
              <span className="font-semibold text-gray-600 block mb-1">📝 题目：</span>
              <div className="bg-gray-50 p-3 rounded text-gray-800 text-sm whitespace-pre-wrap">
                <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{item.题目}</ReactMarkdown>
              </div>
            </div>

            <div>
              <span className="font-semibold text-gray-600 block mb-1">✍️ 学生作答：</span>
              <div className="bg-gray-50 p-3 rounded text-gray-800 text-sm whitespace-pre-wrap">
                <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{item.学生作答}</ReactMarkdown>
              </div>
            </div>

            <div className="mt-6 border-t pt-4">
              <button
                onClick={() => handleEvaluate(index, item.题目, item.学生作答)}
                disabled={evaluatingIndex === index}
                className="bg-green-600 text-white px-6 py-2 rounded-lg font-medium shadow hover:bg-green-700 disabled:bg-gray-400 transition-colors"
              >
                {evaluatingIndex === index ? "AI 正在深度批改中..." : "✨ 让 AI 批改这道题"}
              </button>

              {evalResults[index] && (
                <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg animate-fade-in">
                  <div className="prose prose-green max-w-none text-gray-800">
                    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                      {evalResults[index]}
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
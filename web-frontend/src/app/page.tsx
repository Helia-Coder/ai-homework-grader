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
  const [images, setImages] = useState<string[]>([]);
  const [results, setResults] = useState<QuestionData[]>([]);
  const [loading, setLoading] = useState(false);

  const [evaluatingIndex, setEvaluatingIndex] = useState<number | null>(null);
  const [evalResults, setEvalResults] = useState<Record<number, string>>({});

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

    e.target.value = ""; // 允许重复选择同一张图
  };

  const handleSubmit = async () => {
    if (images.length === 0) return;
    setLoading(true);
    setResults([]);
    setEvalResults({});

    let allParsedData: any[] = [];

    try {
      // 排队识别每一张图
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
      let buffer = ""; // 新增：用来存不完整的碎片

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          // 把新收到的数据加到缓冲池里
          buffer += decoder.decode(value, { stream: true });

          // 按换行符切分
          const lines = buffer.split('\n');

          // 最后一段可能是不完整的，先拿出来放回 buffer，等下一次数据来拼上
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith('data: ') && trimmedLine !== 'data: [DONE]') {
              try {
                const data = JSON.parse(trimmedLine.slice(6));
                const content = data.choices[0]?.delta?.content || "";
                if (content) {
                  fullText += content;
                  // 实时更新到页面，触发打字机效果
                  setEvalResults(prev => ({ ...prev, [index]: fullText }));
                }
              } catch (e) {
                console.error("解析单个数据块失败:", e, trimmedLine);
              }
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

  return (
    <main className="min-h-screen bg-gray-100 p-4 md:p-8 flex flex-col items-center">
      <h1 className="text-2xl md:text-3xl font-bold text-gray-800 mb-2">AI 多模态作业批改助手</h1>
      <p className="text-gray-500 mb-8 text-sm">💡 支持多图上传与自动切题，拍照交作业，秒出分步批改。</p >

      <div className="bg-white p-6 rounded-xl shadow-lg w-full max-w-lg mb-8">
        {/* 唯一的、纯净的上传框 */}
        <input
          type="file"
          accept="image/*"
          multiple
          capture="environment"
          onChange={handleImageUpload}
          className="mb-4 w-full file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
        />

        {/* 缩略图列表 */}
        {images.length > 0 && (
          <div className="flex flex-wrap gap-3 mb-6 p-3 bg-gray-50 rounded-lg border">
            {images.map((img, idx) => (
              <div key={idx} className="relative">
                < img src={img} alt="Preview" className="w-20 h-20 md:w-24 md:h-24 object-cover rounded shadow-sm border border-gray-200" />
                <button
                  onClick={() => setImages(prev => prev.filter((_, i) => i !== idx))}
                  className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs hover:bg-red-600 shadow"
                  title="删除这张"
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

              {/* 流式渲染批改结果 */}
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
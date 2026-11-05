"use client";
import { useState } from 'react';

interface QuestionData {
  题号: string;
  题目: string;
  学生作答: string;
  识别置信度: string;
}

export default function Home() {
  const [image, setImage] = useState<string | null>(null);
  const [results, setResults] = useState<QuestionData[]>([]);
  const [loading, setLoading] = useState(false);

  // 新增：用于管理每道题的批改状态和结果
  const [evaluatingIndex, setEvaluatingIndex] = useState<number | null>(null);
  const [evalResults, setEvalResults] = useState<Record<number, any>>({});

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setImage(event.target?.result as string);
    };
    reader.readAsDataURL(file);
    // 重置状态
    setResults([]);
    setEvalResults({});
  };

  const handleSubmit = async () => {
    if (!image) return;
    setLoading(true);
    setResults([]);
    setEvalResults({});

    try {
      const response = await fetch('/api/grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ img_b64: image })
      });

      if (!response.ok) throw new Error(`服务器报错: ${response.status}`);
      const data = await response.json();

      try {
        const cleanJsonStr = data.result.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsedData = JSON.parse(cleanJsonStr);
        setResults(Array.isArray(parsedData) ? parsedData : [parsedData]);
      } catch (e) {
        console.error("JSON 解析失败", e);
        alert("AI 返回的格式不对，请重试");
      }
    } catch (error: any) {
      alert(`出错了: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 新增：单题批改函数
  const handleEvaluate = async (index: number, question: string, answer: string) => {
    setEvaluatingIndex(index);
    try {
      const res = await fetch('/api/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, answer })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const cleanStr = data.result.replace(/```json/g, '').replace(/```/g, '').trim();
      setEvalResults(prev => ({ ...prev, [index]: JSON.parse(cleanStr) }));
    } catch (err: any) {
      alert(`批改失败: ${err.message}`);
    } finally {
      setEvaluatingIndex(null);
    }
  };

  return (
    <main className="min-h-screen bg-gray-100 p-8 flex flex-col items-center">
      <h1 className="text-3xl font-bold text-gray-800 mb-8">AI 多模态作业批改助手</h1>

      <div className="bg-white p-6 rounded-xl shadow-lg w-full max-w-lg mb-8">
        <input type="file" accept="image/*" onChange={handleImageUpload} className="mb-4 w-full" />
        {image && (
          < img src={image} alt="Preview" className="w-full h-auto mb-4 rounded-lg shadow-sm border" />
        )}
        <button
          onClick={handleSubmit}
          disabled={!image || loading}
          className="w-full bg-blue-600 text-white font-semibold py-3 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
        >
          {loading ? "正在识别题目..." : "第一步：识别题目"}
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
              <p className="bg-gray-50 p-3 rounded text-gray-800 font-mono text-sm whitespace-pre-wrap">{item.题目}</p >
            </div>

            <div>
              <span className="font-semibold text-gray-600 block mb-1">✍️ 学生作答：</span>
              <p className="bg-gray-50 p-3 rounded text-gray-800 font-mono text-sm whitespace-pre-wrap">{item.学生作答}</p >
            </div>

            {/* 第二步：批改按钮 */}
            <div className="mt-6 border-t pt-4">
              <button
                onClick={() => handleEvaluate(index, item.题目, item.学生作答)}
                disabled={evaluatingIndex === index}
                className="bg-green-600 text-white px-6 py-2 rounded-lg font-medium shadow hover:bg-green-700 disabled:bg-gray-400 transition-colors"
              >
                {evaluatingIndex === index ? "AI 正在批改中..." : "✨ 让 AI 批改这道题"}
              </button>

              {/* 批改结果展示区 */}
              {evalResults[index] && (
                <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg animate-fade-in">
                  <h3 className="text-2xl font-bold text-green-800 mb-2">
                    {evalResults[index].得分} <span className="text-base font-normal text-gray-500">/ {evalResults[index].满分} 分</span>
                  </h3>
                  <div className="space-y-2 mt-3">
                    <p className="text-gray-800 text-sm leading-relaxed"><strong className="text-red-600">❌ 错因归因：</strong> {evalResults[index].错因归因}</p >
                    <p className="text-gray-800 text-sm leading-relaxed"><strong className="text-blue-600">💡 讲评建议：</strong> {evalResults[index].讲评建议}</p >
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

// 文件位置: web-frontend/src/app/page.tsx
"use client";
import { useState } from 'react';

export default function Home() {
  const [image, setImage] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // 把上传的图片转成 Base64 格式
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setImage(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  // 点击批改按钮，请求咱们刚才写的后端接口
  const handleSubmit = async () => {
    if (!image) return;
    setLoading(true);
    setResult(null);

    try {
      const response = await fetch('/api/grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ img_b64: image })
      });
      
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      
      setResult(data.result);
    } catch (error: any) {
      setResult(`出错了: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 p-8 flex flex-col items-center">
      <h1 className="text-3xl font-bold text-gray-800 mb-8">AI 多模态作业批改助手</h1>
      
      <div className="bg-white p-6 rounded-lg shadow-md w-full max-w-lg">
        <input type="file" accept="image/*" onChange={handleImageUpload} className="mb-4 w-full" />
        
        {image && (
          <img src={image} alt="Preview" className="w-full h-auto mb-4 rounded border" />
        )}
        
        <button 
          onClick={handleSubmit} 
          disabled={!image || loading}
          className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:bg-gray-400"
        >
          {loading ? "AI 正在拼命识别批改中..." : "开始批改"}
        </button>
      </div>

      {result && (
        <div className="mt-8 bg-white p-6 rounded-lg shadow-md w-full max-w-lg overflow-auto">
          <h2 className="text-xl font-bold mb-4 text-gray-800 border-b pb-2">识别与批改结果</h2>
          <pre className="bg-gray-100 p-4 rounded text-sm text-gray-700 whitespace-pre-wrap">
            {result}
          </pre>
        </div>
      )}
    </main>
  );
}
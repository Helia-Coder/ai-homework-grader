"use client";
import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import {
  UploadCloud,
  CheckCircle,
  AlertCircle,
  RefreshCcw,
  GraduationCap,
  Users,
  FileText,
  Edit,
  X,
  ChevronDown,
  ChevronRight,
  History,
  MessageSquare,
} from 'lucide-react';

// ========== 类型定义 ==========
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
  选项内容: string;
  学生作答: string;
  本小问满分: string;
  本小问学生得分: string;
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
  hasManualEdit: boolean;
  小问列表: SubQuestion[];
}

interface SubmitRecord {
  id: string;
  studentName: string;
  submitTime: string;
  imgList: string[];
  questionList: BigQuestionData[];
  isReviewed: boolean;
  teacherComment: string;
}

// ========== 图片压缩 ==========
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
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [results, setResults] = useState<BigQuestionData[]>([]);
  const [loading, setLoading] = useState(false);
  const [evaluatingIndex, setEvaluatingIndex] = useState<number | null>(null);
  const [evalResults, setEvalResults] = useState<Record<number, string>>({});

  const [studentName, setStudentName] = useState<string>('测试学生');
  const [historyRecords, setHistoryRecords] = useState<SubmitRecord[]>([]);
  const [activeHistoryRecord, setActiveHistoryRecord] = useState<SubmitRecord | null>(null);

  const [recordList, setRecordList] = useState<SubmitRecord[]>([]);
  const [activeRecord, setActiveRecord] = useState<SubmitRecord | null>(null);
  const [editTarget, setEditTarget] = useState<{
    bigIndex: number;
    subIndex: number;
    sub: SubQuestion;
  } | null>(null);
  const [editStepTarget, setEditStepTarget] = useState<{
    bigIndex: number;
    subIndex: number;
    stepIndex: number;
    step: StepItem;
  } | null>(null);

  const [expandedBigQuestions, setExpandedBigQuestions] = useState<Set<string>>(new Set());
  const [expandedSubQuestions, setExpandedSubQuestions] = useState<Set<string>>(new Set());
  const [teacherRefreshing, setTeacherRefreshing] = useState(false);

  // ========== 工具函数 ==========
  const toggleBigQuestion = (key: string) => {
    setExpandedBigQuestions(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSubQuestion = (key: string) => {
    setExpandedSubQuestions(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const getSumStepMax = (sub: SubQuestion) => {
    return sub.步骤明细.reduce((s, st) => s + (Number(st.该步骤满分) || 0), 0);
  };

  const getSumStepScore = (sub: SubQuestion) => {
    return sub.步骤明细.reduce((s, st) => s + (Number(st.实际得分) || 0), 0);
  };

  const refreshSubAndBigScore = (copy: SubmitRecord, bigIndex: number, subIndex: number) => {
    const bigQ = copy.questionList[bigIndex];
    const sub = bigQ.小问列表[subIndex];
    const sumStepScore = getSumStepScore(sub);
    const subMax = Number(sub.本小问满分) || 0;
    sub.本小问学生得分 = String(Math.min(sumStepScore, subMax));
    bigQ.hasManualEdit = true;

    const totalBigMax = Number(bigQ.大题总分) || 0;
    const sumBigScore = bigQ.小问列表.reduce((s, sq) => s + (Number(sq.本小问学生得分) || 0), 0);
    bigQ.大题实得分 = String(Math.min(sumBigScore, totalBigMax));
    return copy;
  };

  const fetchAllRecords = async () => {
    const res = await fetch('/api/submitRecord');
    const data = await res.json();
    setRecordList(data);
    return data;
  };

  // ========== 分值核心逻辑 ==========
  const handleChangeSubStudentScore = (bigIndex: number, subIndex: number, val: string) => {
    if (!activeRecord) return;
    const copy = JSON.parse(JSON.stringify(activeRecord)) as SubmitRecord;
    const bigQ = copy.questionList[bigIndex];
    const sub = bigQ.小问列表[subIndex];
    const subMax = Number(sub.本小问满分) || 0;
    let numVal = Number(val) || 0;
    numVal = Math.max(0, Math.min(subMax, numVal));
    sub.本小问学生得分 = String(numVal);
    bigQ.hasManualEdit = true;

    const totalBigMax = Number(bigQ.大题总分) || 0;
    const sumScore = bigQ.小问列表.reduce((s, sq) => s + (Number(sq.本小问学生得分) || 0), 0);
    bigQ.大题实得分 = String(Math.min(sumScore, totalBigMax));
    setActiveRecord(copy);
  };

  const handleChangeBigStandardScore = (bigIndex: number, newTotalStr: string) => {
    if (!activeRecord) return;
    const copy = JSON.parse(JSON.stringify(activeRecord)) as SubmitRecord;
    const bigQ = copy.questionList[bigIndex];
    const oldTotal = Number(bigQ.大题总分) || 0;
    const newTotal = Number(newTotalStr) || 0;
    bigQ.大题总分 = newTotalStr;

    if (!bigQ.hasManualEdit && oldTotal > 0) {
      const scale = newTotal / oldTotal;
      bigQ.小问列表.forEach(sq => {
        const subMax = Number(sq.本小问满分) || 0;
        const subStu = Number(sq.本小问学生得分) || 0;
        sq.本小问满分 = String((subMax * scale).toFixed(2));
        sq.本小问学生得分 = String((subStu * scale).toFixed(2));
      });
    }

    const sumScore = bigQ.小问列表.reduce((s, sq) => s + (Number(sq.本小问学生得分) || 0), 0);
    bigQ.大题实得分 = String(Math.min(sumScore, newTotal));
    setActiveRecord(copy);
  };

  const handleChangeSubStandardScore = (bigIndex: number, subIndex: number, val: string) => {
    if (!activeRecord) return;
    const copy = JSON.parse(JSON.stringify(activeRecord)) as SubmitRecord;
    const bigQ = copy.questionList[bigIndex];
    const sub = bigQ.小问列表[subIndex];
    let numVal = Number(val) || 0;
    numVal = Math.max(0, numVal);
    sub.本小问满分 = String(numVal);

    let stuScore = Number(sub.本小问学生得分) || 0;
    if (stuScore > numVal) {
      stuScore = numVal;
      sub.本小问学生得分 = String(stuScore);
    }

    bigQ.hasManualEdit = true;
    const totalBigMax = Number(bigQ.大题总分) || 0;
    const sumScore = bigQ.小问列表.reduce((s, sq) => s + (Number(sq.本小问学生得分) || 0), 0);
    bigQ.大题实得分 = String(Math.min(sumScore, totalBigMax));
    setActiveRecord(copy);
  };

  const handleChangeStepItem = (bigIndex: number, subIndex: number, stepIndex: number, newStep: StepItem) => {
    if (!activeRecord) return;
    let copy = JSON.parse(JSON.stringify(activeRecord)) as SubmitRecord;
    const sub = copy.questionList[bigIndex].小问列表[subIndex];
    sub.步骤明细[stepIndex] = newStep;
    copy = refreshSubAndBigScore(copy, bigIndex, subIndex);
    setActiveRecord(copy);
  };

  // ========== 学生端轮询 ==========
  useEffect(() => {
    if (role !== 'student') return;
    const pollTimer = setInterval(async () => {
      try {
        const res = await fetch('/api/submitRecord');
        if (res.ok) {
          const data = await res.json();
          setRecordList(data);
          setHistoryRecords(data.filter((r: SubmitRecord) => r.studentName === studentName));
          if (activeHistoryRecord) {
            const latest = data.find((r: SubmitRecord) => r.id === activeHistoryRecord.id);
            if (latest) {
              setActiveHistoryRecord(latest);
              setResults(latest.questionList);
            }
          }
        }
      } catch (err) {
        console.log('轮询同步失败', err);
      }
    }, 3000);
    return () => clearInterval(pollTimer);
  }, [role, studentName, activeHistoryRecord]);

  // ========== 学生端：上传图片 ==========
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const fileArray = Array.from(files);

    Promise.all(fileArray.map(file => compressImage(file)))
      .then(compressedBase64List => {
        setImages(prev => [...prev, ...compressedBase64List]);
      });
    e.target.value = '';
  };

  // ========== 学生端：提交作业 ==========
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
          body: JSON.stringify({ img_b64: images[i] }),
        });
        if (!response.ok) throw new Error(`第 ${i + 1} 张图服务器报错`);
        const data = await response.json();
        const cleanJsonStr = data.result.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsedData = JSON.parse(cleanJsonStr);

        const wrapBig = (big: BigQuestionData): BigQuestionData => {
          return {
            ...big,
            hasManualEdit: false,
            小问列表: big.小问列表.map(sq => ({
              ...sq,
              本小问学生得分: sq.本小问学生得分 ?? '0',
            })),
          };
        };

        if (Array.isArray(parsedData)) {
          allParsedData = [...allParsedData, ...parsedData.map(wrapBig)];
        } else {
          allParsedData.push(wrapBig(parsedData));
        }
      }

      setResults(allParsedData);

      const newRecord: SubmitRecord = {
        id: Date.now().toString() + Math.random().toString(36),
        studentName: studentName || '测试学生',
        submitTime: new Date().toLocaleString(),
        imgList: [...images],
        questionList: allParsedData,
        isReviewed: false,
        teacherComment: '',
      };

      const res = await fetch('/api/submitRecord', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newRecord),
      });

      const json = await res.json();
      if (json.success) {
        setHistoryRecords(prev => [newRecord, ...prev]);
      }
    } catch (error: any) {
      alert(`出错了: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ========== 学生端：深度批改 ==========
  const handleEvaluate = async (index: number, question: string, answer: string) => {
    setEvaluatingIndex(index);
    setEvalResults(prev => ({ ...prev, [index]: '' }));
    try {
      const res = await fetch('/api/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, answer }),
      });
      if (!res.body) throw new Error('没有返回数据流');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let fullText = '';
      let buffer = '';

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith('data: ') && trimmedLine !== 'data: [DONE]') {
              try {
                const data = JSON.parse(trimmedLine.slice(6));
                const content = data.choices[0]?.delta?.content || '';
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

  // ========== 学生端：读取历史记录 ==========
  const loadReviewedRecord = async (recordId: string) => {
    const allRecords: SubmitRecord[] = await fetchAllRecords();
    const target = allRecords.find(r => r.id === recordId);
    if (target) {
      setActiveHistoryRecord(target);
      setResults(target.questionList);
    }
  };

  // ========== 教师端：拉取记录 ==========
  useEffect(() => {
    if (role === 'teacher') {
      fetchAllRecords();
    }
  }, [role]);

  const handleTeacherRefresh = async () => {
    setTeacherRefreshing(true);
    await fetchAllRecords();
    setTeacherRefreshing(false);
  };

  // ========== 教师端：保存小问复核 ==========
  const saveEdit = async () => {
    if (!editTarget || !activeRecord) return;
    const { bigIndex, subIndex, sub } = editTarget;
    let copy = JSON.parse(JSON.stringify(activeRecord)) as SubmitRecord;
    copy.questionList[bigIndex].小问列表[subIndex] = sub;
    copy = refreshSubAndBigScore(copy, bigIndex, subIndex);

    const updatedRecord: SubmitRecord = {
      ...copy,
      isReviewed: true,
    };

    const res = await fetch('/api/submitRecord', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: activeRecord.id,
        questionList: updatedRecord.questionList,
        teacherComment: updatedRecord.teacherComment,
        isReviewed: true,
      }),
    });

    if (res.ok) {
      setRecordList(prev => prev.map(r => (r.id === activeRecord.id ? updatedRecord : r)));
      setActiveRecord(updatedRecord);
      setEditTarget(null);
      alert('复核已保存');
    } else {
      alert('保存失败');
    }
  };

  // ========== 教师端：保存步骤复核 ==========
  const saveStepEdit = async () => {
    if (!editStepTarget || !activeRecord) return;
    const { bigIndex, subIndex, stepIndex, step } = editStepTarget;
    let copy = JSON.parse(JSON.stringify(activeRecord)) as SubmitRecord;
    const sub = copy.questionList[bigIndex].小问列表[subIndex];
    sub.步骤明细[stepIndex] = step;
    copy = refreshSubAndBigScore(copy, bigIndex, subIndex);

    const updatedRecord: SubmitRecord = { ...copy, isReviewed: true };
    const res = await fetch('/api/submitRecord', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: activeRecord.id,
        questionList: updatedRecord.questionList,
        teacherComment: updatedRecord.teacherComment,
        isReviewed: true,
      }),
    });

    if (res.ok) {
      setRecordList(prev => prev.map(r => (r.id === activeRecord.id ? updatedRecord : r)));
      setActiveRecord(updatedRecord);
      setEditStepTarget(null);
      alert('步骤修改已保存');
    } else {
      alert('保存失败');
    }
  };

  // ========== 教师端：保存评语 ==========
  const saveTeacherComment = async () => {
    if (!activeRecord) return;

    const res = await fetch('/api/submitRecord', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: activeRecord.id,
        questionList: activeRecord.questionList,
        teacherComment: activeRecord.teacherComment,
        isReviewed: true,
      }),
    });

    if (res.ok) {
      setRecordList(prev => prev.map(r => (r.id === activeRecord.id ? { ...activeRecord, isReviewed: true } : r)));
      setActiveRecord(prev => (prev ? { ...prev, isReviewed: true } : null));
      alert('评语已保存');
    } else {
      alert('保存失败');
    }
  };

  // ========== 身份选择页 ==========
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

  // ========== 教师端页面 ==========
  if (role === 'teacher') {
    return (
      <main className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold text-gray-800">👩‍🏫 教师学情看板</h1>
            <div className="flex gap-3">
              <button
                onClick={handleTeacherRefresh}
                disabled={teacherRefreshing}
                className="flex items-center gap-2 text-emerald-600 hover:text-emerald-700 font-medium bg-emerald-50 px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
              >
                <RefreshCcw className={`w-4 h-4 ${teacherRefreshing ? 'animate-spin' : ''}`} />
                刷新提交记录
              </button>
              <button
                onClick={() => setRole(null)}
                className="flex items-center gap-2 text-blue-600 hover:text-blue-700 font-medium bg-blue-50 px-4 py-2 rounded-lg transition-colors"
              >
                <RefreshCcw className="w-4 h-4" /> 切换身份
              </button>
            </div>
          </div>

          <div className="grid grid-cols-12 gap-6">
            <div className="col-span-4 bg-white rounded-xl shadow p-4">
              <h2 className="font-bold text-lg mb-4">📋 学生提交列表</h2>
              {recordList.length === 0 ? (
                <p className="text-gray-400 text-sm">暂无学生提交作业</p>
              ) : (
                <div className="space-y-3">
                  {recordList.map(rec => (
                    <div
                      key={rec.id}
                      onClick={() => {
                        setActiveRecord(rec);
                        setExpandedBigQuestions(new Set());
                        setExpandedSubQuestions(new Set());
                      }}
                      className={`p-3 rounded-lg border cursor-pointer transition ${
                        activeRecord?.id === rec.id
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex justify-between">
                        <span className="font-medium">{rec.studentName}</span>
                        {rec.isReviewed ? (
                          <CheckCircle className="text-green-500 w-4 h-4" />
                        ) : (
                          <FileText className="text-orange-400 w-4 h-4" />
                        )}
                      </div>
                      <div className="text-xs text-gray-500">{rec.submitTime}</div>
                      <div className="text-xs mt-1">共 {rec.questionList?.length || 0} 道大题</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="col-span-8 bg-white rounded-xl shadow p-6">
              {activeRecord ? (
                <div>
                  <div className="flex justify-between mb-4">
                    <h2 className="font-bold text-lg">批改详情 - {activeRecord.studentName}</h2>
                    <span
                      className={`px-2 py-1 rounded text-xs ${
                        activeRecord.isReviewed
                          ? 'bg-green-100 text-green-700'
                          : 'bg-orange-100 text-orange-700'
                      }`}
                    >
                      {activeRecord.isReviewed ? '✅ 已复核' : '⏳待复核'}
                    </span>
                  </div>

                  <div className="mb-4 flex flex-wrap gap-2">
                    {activeRecord.imgList.map((img, idx) => (
                      <img
                        key={idx}
                        src={img}
                        alt={`作业图 ${idx + 1}`}
                        onClick={() => setPreviewImage(img)}
                        className="max-h-40 border rounded cursor-pointer"
                      />
                    ))}
                  </div>

                  <div className="mb-6 p-4 border border-blue-200 bg-blue-50 rounded-lg">
                    <div className="flex justify-between items-center mb-2">
                      <h4 className="font-semibold text-blue-900">💬 老师总评语</h4>
                      <button
                        onClick={saveTeacherComment}
                        className="text-sm bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700"
                      >
                        保存评语
                      </button>
                    </div>
                    <textarea
                      value={activeRecord.teacherComment}
                      onChange={e =>
                        setActiveRecord({
                          ...activeRecord,
                          teacherComment: e.target.value,
                        })
                      }
                      className="w-full border rounded p-2 h-24"
                      placeholder="输入对学生本次作业的整体评语..."
                    />
                  </div>

                  <div className="space-y-4">
                    {activeRecord.questionList.map((bigQ, bigIdx) => {
                      const bigKey = `big-${bigIdx}`;
                      const bigOpen = expandedBigQuestions.has(bigKey);

                      return (
                        <div key={bigIdx} className="border rounded-lg">
                          <button
                            onClick={() => toggleBigQuestion(bigKey)}
                            className="w-full flex justify-between items-center p-4 bg-gray-50 hover:bg-gray-100"
                          >
                            <span className="font-semibold">
                              大题 {bigQ.大题题号}｜总分：{bigQ.大题总分}｜得分：{bigQ.大题实得分}
                              {bigQ.hasManualEdit ? (
                                <span className="ml-2 text-orange-500 text-xs">（已人工调整）</span>
                              ) : null}
                            </span>
                            {bigOpen ? <ChevronDown /> : <ChevronRight />}
                          </button>

                          {bigOpen && (
                            <div className="p-4 space-y-3">
                              <div className="text-sm text-gray-600 bg-gray-50 p-2 rounded">
                                题干：
                                <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                                  {bigQ.大题题干}
                                </ReactMarkdown>
                              </div>

                              <div className="flex items-center gap-2">
                                <span className="text-sm">修改大题标准总分：</span>
                                <input
                                  type="number"
                                  min={0}
                                  step="0.5"
                                  value={bigQ.大题总分}
                                  onChange={e => handleChangeBigStandardScore(bigIdx, e.target.value)}
                                  className="w-20 border px-1"
                                />
                              </div>

                              {bigQ.小问列表.map((subQ, subIdx) => {
                                const subKey = `sub-${bigIdx}-${subIdx}`;
                                const subOpen = expandedSubQuestions.has(subKey);
                                const sumStepMax = getSumStepMax(subQ);
                                const subMaxNum = Number(subQ.本小问满分) || 0;
                                const stepWarn = Math.abs(sumStepMax - subMaxNum) > 0.001;

                                return (
                                  <div key={subIdx} className="border rounded-lg">
                                    <button
                                      onClick={() => toggleSubQuestion(subKey)}
                                      className="w-full flex justify-between items-center p-3 bg-blue-50 hover:bg-blue-100"
                                    >
                                      <span className="font-medium text-blue-900">
                                        小问 {subQ.小问编号}｜满分：{subQ.本小问满分}｜学生得分：{subQ.本小问学生得分}
                                      </span>
                                      {subOpen ? <ChevronDown /> : <ChevronRight />}
                                    </button>

                                    {subOpen && (
                                      <div className="p-4 space-y-3">
                                        <div className="grid md:grid-cols-2 gap-3 text-sm">
                                          <div>
                                            <div className="text-xs text-gray-500">题干</div>
                                            <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                                              {subQ.小问题干}
                                            </ReactMarkdown>
                                          </div>
                                          <div>
                                            <div className="text-xs text-gray-500">学生作答</div>
                                            <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                                              {subQ.学生作答}
                                            </ReactMarkdown>
                                          </div>
                                        </div>

                                        {subQ.选项内容 && subQ.选项内容.trim() && (
                                          <div className="text-sm">
                                            <div className="text-xs text-gray-500">选项</div>
                                            <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                                              {subQ.选项内容}
                                            </ReactMarkdown>
                                          </div>
                                        )}

                                        <div className="text-sm bg-amber-50 p-2 rounded">
                                          <div className="text-xs text-gray-500">评分细则</div>
                                          {subQ.评分细则}
                                        </div>

                                        <div className="text-sm">
                                          <div className="text-xs text-gray-500">错因归因</div>
                                          {subQ.错因归因}
                                        </div>

                                        <div className="text-sm">
                                          <div className="text-xs text-gray-500">讲评建议</div>
                                          {subQ.讲评建议}
                                        </div>

                                        <div className="flex gap-3 items-center">
                                          <div>
                                            <span className="text-sm">小问满分：</span>
                                            <input
                                              type="number"
                                              min={0}
                                              step="0.5"
                                              value={subQ.本小问满分}
                                              onChange={e => handleChangeSubStandardScore(bigIdx, subIdx, e.target.value)}
                                              className="w-16 border px-1"
                                            />
                                          </div>
                                          <div>
                                            <span className="text-sm">学生得分：</span>
                                            <input
                                              type="number"
                                              min={0}
                                              step="0.5"
                                              value={subQ.本小问学生得分}
                                              onChange={e => handleChangeSubStudentScore(bigIdx, subIdx, e.target.value)}
                                              className="w-16 border px-1"
                                            />
                                          </div>
                                        </div>

                                        {stepWarn && (
                                          <div className="text-red-600 text-sm bg-red-50 p-2 rounded">
                                            ⚠️ 警告：本小问所有步骤满分总和（{sumStepMax}）和小问满分（{subQ.本小问满分}）不一致
                                          </div>
                                        )}

                                        {subQ.步骤明细 && subQ.步骤明细.length > 0 && (
                                          <div className="my-4">
                                            <div className="text-xs font-bold text-gray-500 block mb-2">📋 分步阅卷明细</div>
                                            <div className="border border-gray-200 rounded-lg overflow-hidden bg-white shadow-sm overflow-x-auto">
                                              <table className="w-full text-sm min-w-[600px]">
                                                <thead className="bg-gray-100 text-gray-600">
                                                  <tr>
                                                    <th className="py-3 px-3 font-semibold text-center">步骤</th>
                                                    <th className="py-3 px-3 font-semibold text-center">本步满分</th>
                                                    <th className="py-3 px-3 font-semibold text-center">本步得分</th>
                                                    <th className="py-3 px-3 font-semibold text-center">判定</th>
                                                    <th className="py-3 px-3 font-semibold">说明</th>
                                                    <th className="py-3 px-3 font-semibold text-center">操作</th>
                                                  </tr>
                                                </thead>
                                                <tbody>
                                                  {subQ.步骤明细.map((step, sIdx) => (
                                                    <tr key={sIdx} className="border-t border-gray-100 hover:bg-gray-50">
                                                      <td className="py-3 px-3 text-center text-gray-500">{step.步骤序号}</td>
                                                      <td className="py-3 px-3 text-center">{step.该步骤满分}</td>
                                                      <td className="py-3 px-3 text-center font-bold text-blue-600">{step.实际得分}</td>
                                                      <td
                                                        className={`py-3 px-3 text-center font-bold ${
                                                          step.判定 === '正确'
                                                            ? 'text-green-600'
                                                            : step.判定 === '部分正确'
                                                            ? 'text-amber-600'
                                                            : 'text-red-600'
                                                        }`}
                                                      >
                                                        {step.判定}
                                                      </td>
                                                      <td className="py-3 px-3 text-gray-600">{step.说明}</td>
                                                      <td className="py-3 px-3 text-center">
                                                        <button
                                                          onClick={() =>
                                                            setEditStepTarget({
                                                              bigIndex: bigIdx,
                                                              subIndex: subIdx,
                                                              stepIndex: sIdx,
                                                              step: { ...step },
                                                            })
                                                          }
                                                          className="text-blue-600 text-sm flex items-center gap-1 justify-center"
                                                        >
                                                          <Edit size={14} /> 编辑
                                                        </button>
                                                      </td>
                                                    </tr>
                                                  ))}
                                                </tbody>
                                              </table>
                                            </div>
                                          </div>
                                        )}

                                        <button
                                          onClick={() =>
                                            setEditTarget({
                                              bigIndex: bigIdx,
                                              subIndex: subIdx,
                                              sub: { ...subQ },
                                            })
                                          }
                                          className="text-blue-600 text-sm flex items-center gap-1"
                                        >
                                          <Edit size={14} /> 修改文字复核（错因/讲评）
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="text-center py-16 text-gray-400">左侧选择一条学生提交记录查看批改结果</div>
              )}
            </div>
          </div>
        </div>

        {/* 小问复核弹窗 */}
        {editTarget && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl w-full max-w-lg p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold">复核修改 - 小问{editTarget.sub.小问编号}</h3>
                <button onClick={() => setEditTarget(null)}>
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-sm text-gray-600">该小问满分</label>
                  <input
                    value={editTarget.sub.本小问满分}
                    onChange={e =>
                      setEditTarget({
                        ...editTarget,
                        sub: { ...editTarget.sub, 本小问满分: e.target.value },
                      })
                    }
                    className="w-full border rounded p-2 mt-1"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-600">该小问学生得分</label>
                  <input
                    value={editTarget.sub.本小问学生得分}
                    onChange={e =>
                      setEditTarget({
                        ...editTarget,
                        sub: { ...editTarget.sub, 本小问学生得分: e.target.value },
                      })
                    }
                    className="w-full border rounded p-2 mt-1"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-600">错因归因</label>
                  <textarea
                    value={editTarget.sub.错因归因}
                    onChange={e =>
                      setEditTarget({
                        ...editTarget,
                        sub: { ...editTarget.sub, 错因归因: e.target.value },
                      })
                    }
                    className="w-full border rounded p-2 mt-1 h-24"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-600">讲评建议</label>
                  <textarea
                    value={editTarget.sub.讲评建议}
                    onChange={e =>
                      setEditTarget({
                        ...editTarget,
                        sub: { ...editTarget.sub, 讲评建议: e.target.value },
                      })
                    }
                    className="w-full border rounded p-2 mt-1 h-24"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setEditTarget(null)} className="px-4 py-2 border rounded">
                  取消
                </button>
                <button onClick={saveEdit} className="px-4 py-2 bg-blue-600 text-white rounded">
                  保存复核
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 步骤复核弹窗 */}
        {editStepTarget && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl w-full max-w-lg p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold">修改步骤 {editStepTarget.step.步骤序号}</h3>
                <button onClick={() => setEditStepTarget(null)}>
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-sm text-gray-600">该步骤满分</label>
                  <input
                    type="number"
                    min={0}
                    step="0.5"
                    value={editStepTarget.step.该步骤满分}
                    onChange={e =>
                      setEditStepTarget({
                        ...editStepTarget,
                        step: { ...editStepTarget.step, 该步骤满分: e.target.value },
                      })
                    }
                    className="w-full border rounded p-2 mt-1"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-600">实际得分</label>
                  <input
                    type="number"
                    min={0}
                    step="0.5"
                    value={editStepTarget.step.实际得分}
                    onChange={e =>
                      setEditStepTarget({
                        ...editStepTarget,
                        step: { ...editStepTarget.step, 实际得分: e.target.value },
                      })
                    }
                    className="w-full border rounded p-2 mt-1"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-600">判定</label>
                  <select
                    value={editStepTarget.step.判定}
                    onChange={e =>
                      setEditStepTarget({
                        ...editStepTarget,
                        step: { ...editStepTarget.step, 判定: e.target.value },
                      })
                    }
                    className="w-full border rounded p-2 mt-1"
                  >
                    <option value="正确">正确</option>
                    <option value="部分正确">部分正确</option>
                    <option value="错误">错误</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm text-gray-600">说明</label>
                  <textarea
                    value={editStepTarget.step.说明}
                    onChange={e =>
                      setEditStepTarget({
                        ...editStepTarget,
                        step: { ...editStepTarget.step, 说明: e.target.value },
                      })
                    }
                    className="w-full border rounded p-2 mt-1 h-24"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setEditStepTarget(null)} className="px-4 py-2 border rounded">
                  取消
                </button>
                <button onClick={saveStepEdit} className="px-4 py-2 bg-blue-600 text-white rounded">
                  保存步骤
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    );
  }

  // ========== 学生端页面 ==========
  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 p-4 md:p-8 flex flex-col items-center">
      <div className="w-full max-w-4xl flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-800">👦 学生端：作业批改助手</h1>
          <p className="text-gray-500 text-sm mt-1">支持多图上传，自动识别并拆分题目</p>
        </div>
        <button
          onClick={() => setRole(null)}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-800 font-medium bg-white px-4 py-2 rounded-lg shadow-sm transition-colors border"
        >
          <RefreshCcw className="w-4 h-4" /> 切换身份
        </button>
      </div>

      <div className="w-full max-w-lg mb-4">
        <label className="text-sm text-gray-600">姓名</label>
        <input
          value={studentName}
          onChange={e => setStudentName(e.target.value)}
          className="w-full border rounded-lg p-2 mt-1"
          placeholder="请输入姓名"
        />
      </div>

      <div className="bg-white p-8 rounded-2xl shadow-lg w-full max-w-lg mb-10 border border-gray-100">
        <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-blue-300 border-dashed rounded-xl cursor-pointer bg-blue-50/50 hover:bg-blue-50 transition-colors">
          <div className="flex flex-col items-center justify-center pt-5 pb-6">
            <UploadCloud className="w-10 h-10 text-blue-500 mb-3" />
            <p className="mb-2 text-sm text-gray-600 font-semibold">点击或拖拽上传作业图片</p>
            <p className="text-xs text-gray-400">支持 JPG, PNG</p>
          </div>
          <input
            type="file"
            accept="image/*"
            multiple
            capture="environment"
            onChange={handleImageUpload}
            className="hidden"
          />
        </label>

        {images.length > 0 && (
          <div className="flex flex-wrap gap-3 mt-6 p-3 bg-gray-50 rounded-xl border border-gray-200">
            {images.map((img, idx) => (
              <div key={idx} className="relative group">
                <img
                  src={img}
                  alt="Preview"
                  onClick={() => setPreviewImage(img)}
                  className="w-20 h-20 md:w-24 md:h-24 object-cover rounded-lg shadow-sm border border-gray-200 cursor-pointer hover:opacity-80 transition-opacity"
                />
                <button
                  onClick={e => {
                    e.stopPropagation();
                    setImages(prev => prev.filter((_, i) => i !== idx));
                  }}
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
            <>
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              Agent 正在识别与切题...
            </>
          ) : (
            '开始识别并提交作业'
          )}
        </button>
      </div>

      {historyRecords.length > 0 && (
        <div className="w-full max-w-4xl mb-8 bg-white rounded-2xl shadow-md p-6">
          <h3 className="font-bold text-lg mb-3 flex items-center gap-2">
            <History className="w-5 h-5" /> 历史提交记录
          </h3>
          <div className="space-y-2">
            {historyRecords.map(rec => (
              <div key={rec.id} className="flex justify-between items-center border rounded-lg p-3 hover:bg-gray-50">
                <div>
                  <div className="font-medium">{rec.studentName}</div>
                  <div className="text-xs text-gray-500">
                    {rec.submitTime} · {rec.questionList?.length || 0} 道大题
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {rec.isReviewed ? (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">已复核</span>
                  ) : (
                    <span className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded">待老师复核</span>
                  )}
                  <button onClick={() => loadReviewedRecord(rec.id)} className="text-sm text-blue-600">
                    查看
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeHistoryRecord?.teacherComment && (
        <div className="w-full max-w-4xl mb-8 bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-6">
          <h3 className="font-bold text-lg mb-2 flex items-center gap-2">
            <MessageSquare className="w-5 h-5" /> 老师总评语
          </h3>
          <p className="text-gray-800">{activeHistoryRecord.teacherComment}</p>
        </div>
      )}

      <div className="w-full max-w-4xl space-y-8">
        {results.map((bigItem, bigIdx) => (
          <div key={bigIdx} className="bg-white rounded-2xl shadow-md border border-gray-100 overflow-hidden transition-all hover:shadow-lg">
            <div className="bg-gray-50 px-6 py-4 border-b flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-500" />
                第 {bigItem.大题题号} 题
              </h2>
              <div className="flex gap-3">
                <span
                  className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 ${
                    bigItem.识别置信度 === '高'
                      ? 'bg-green-100 text-green-700'
                      : bigItem.识别置信度 === '中'
                      ? 'bg-yellow-100 text-yellow-700'
                      : 'bg-red-100 text-red-700'
                  }`}
                >
                  {bigItem.识别置信度 === '高' ? (
                    <CheckCircle className="w-3 h-3" />
                  ) : (
                    <AlertCircle className="w-3 h-3" />
                  )}
                  置信度: {bigItem.识别置信度}
                </span>
                <span className="px-3 py-1 rounded-full text-xs font-bold bg-blue-600 text-white shadow-sm">
                  得分：{bigItem.大题实得分}/{bigItem.大题总分}
                </span>
              </div>
            </div>

            <div className="p-6 md:p-8">
              <div className="mb-8">
                <span className="text-sm font-bold text-gray-500 uppercase tracking-wider block mb-2">📝 大题题干</span>
                <div className="bg-gray-50 p-4 rounded-xl text-gray-800 text-base leading-relaxed border border-gray-100">
                  <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                    {bigItem.大题题干}
                  </ReactMarkdown>
                </div>
              </div>

              <div className="space-y-6">
                {bigItem.小问列表?.map((subItem, subIdx) => (
                  <div key={subIdx} className="border border-blue-100 rounded-xl p-5 md:p-6 bg-blue-50/30">
                    <h3 className="font-bold text-blue-900 text-lg mb-4 flex justify-between">
                      <span>小问 {subItem.小问编号}</span>
                      <span className="text-sm bg-blue-100 text-blue-700 px-2 py-1 rounded">
                        满分：{subItem.本小问满分}分｜得分：{subItem.本小问学生得分}分
                      </span>
                    </h3>

                    <div className="grid md:grid-cols-2 gap-4 mb-4">
                      <div>
                        <span className="text-xs font-bold text-gray-500 block mb-1">📝 小问题干</span>
                        <div className="bg-white p-3 rounded-lg text-gray-800 text-sm border border-gray-100 min-h-[60px]">
                          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                            {subItem.小问题干}
                          </ReactMarkdown>
                        </div>
                      </div>
                      <div>
                        <span className="text-xs font-bold text-gray-500 block mb-1">✍️ 学生作答</span>
                        <div className="bg-white p-3 rounded-lg text-gray-800 text-sm border border-gray-100 min-h-[60px]">
                          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                            {subItem.学生作答}
                          </ReactMarkdown>
                        </div>
                      </div>
                    </div>

                    {subItem.选项内容 && subItem.选项内容.trim() && (
                      <div className="mb-4">
                        <span className="text-xs font-bold text-gray-500 block mb-1">🔤 选项</span>
                        <div className="bg-white p-3 rounded-lg text-gray-800 text-sm border border-gray-100">
                          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                            {subItem.选项内容}
                          </ReactMarkdown>
                        </div>
                      </div>
                    )}

                    {subItem.评分细则 && (
                      <div className="mb-4">
                        <span className="text-xs font-bold text-gray-500 block mb-1">📌 评分细则</span>
                        <div className="bg-amber-50 p-3 rounded-lg text-amber-900 text-sm border border-amber-200">
                          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                            {subItem.评分细则}
                          </ReactMarkdown>
                        </div>
                      </div>
                    )}

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
                                  <td
                                    className={`py-3 px-3 text-center font-bold ${
                                      step.判定 === '正确'
                                        ? 'text-green-600'
                                        : step.判定 === '部分正确'
                                        ? 'text-amber-600'
                                        : 'text-red-600'
                                    }`}
                                  >
                                    {step.判定}
                                  </td>
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

              <div className="mt-8 pt-6 border-t border-gray-100">
                <button
                  onClick={() =>
                    handleEvaluate(
                      bigIdx,
                      bigItem.大题题干,
                      bigItem.小问列表?.[0]?.学生作答 || ''
                    )
                  }
                  disabled={evaluatingIndex === bigIdx}
                  className="bg-white border-2 border-green-500 text-green-600 px-6 py-2.5 rounded-xl font-bold shadow-sm hover:bg-green-50 hover:text-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2 w-full md:w-auto justify-center"
                >
                  {evaluatingIndex === bigIdx ? (
                    <>
                      <div className="w-4 h-4 border-2 border-green-600 border-t-transparent rounded-full animate-spin"></div>
                      AI 正在深度批改...
                    </>
                  ) : (
                    '✨ 让 AI 深度批改这道题'
                  )}
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

      {previewImage && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm cursor-zoom-out"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh]">
            <img
              src={previewImage}
              alt="Full Preview"
              className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
            />
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute -top-4 -right-4 bg-white text-gray-800 rounded-full w-10 h-10 flex items-center justify-center font-bold text-lg shadow-lg hover:bg-gray-200 transition-colors"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

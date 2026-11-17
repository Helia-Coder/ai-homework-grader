"use client";
import { useState, useEffect, useRef, useCallback } from 'react';
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
  Save,
  Loader2,
  Check,
  AlertTriangle,
  Trash2,
} from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import MathMarkdown from '@/components/MathMarkdown';

import type {
  BigQuestionData,
  StepItem,
  SubQuestion,
  SubmitRecord,
  SubmitRecordSummary,
} from '@/lib/types';
import { parseGradingResult } from '@/lib/grading-parser';
import {
  applyBigStandardScore,
  applySubStandardScore,
  applySubStudentScore,
  cloneRecord,
  normalizeScore,
  refreshSubAndBigScore,
  recomputeBigScore,
  sumStepMax,
  toNumber,
} from '@/lib/score';

// ==========================================
// 工具方法：错因归因分类（供错因分布饼图使用）
// 返回：'correct' | 'unanswered' | 'concept' | 'calc' | 'logic' | 'other'
// ==========================================
type ErrorCategory = 'correct' | 'unanswered' | 'concept' | 'calc' | 'logic' | 'other';

function classifyErrorReason(sub: {
  学生作答?: string;
  错因归因?: string;
  本小问学生得分?: string | number;
  本小问满分?: string | number;
}): ErrorCategory {
  const r = (sub.错因归因 || '').trim();
  const answer = (sub.学生作答 || '').trim();
  const score = Number(sub.本小问学生得分 || 0);
  const max = Number(sub.本小问满分 || 0);

  // 1) 未作答：空答案或错因里明确写了未作答/空白/未写
  if (answer === '' || r.includes('未作答') || r.includes('空白') || r.includes('未写')) {
    return 'unanswered';
  }

  // 2) 满分：得分 >= 满分（满分>0）视为答对，不计入错误分布
  if (max > 0 && score >= max) {
    return 'correct';
  }

  // 3) 错因明确判定为正确：兼容 AI 的各种写法，尤其是常见的光秃秃「正确」
  //    注意「不正确 / 部分正确」这类否定表述不应算正确，交由后面的关键词继续分类
  if (
    r === '正确' ||
    r === '无误' ||
    r === '作答正确' ||
    r === '无错误' ||
    r === '全对' ||
    (r.includes('正确') && !r.includes('不') && !r.includes('部分')) ||
    r.includes('无错误') ||
    r.includes('全对')
  ) {
    return 'correct';
  }

  // 4) 按关键词归类错误类型（命中优先级：概念 → 计算 → 逻辑）
  if (/概念|定理|公式|性质|定义|知识点/.test(r)) return 'concept';
  if (/计算|符号|算错|粗心|配平|方程|化简|运算|计算失误/.test(r)) return 'calc';
  if (/逻辑|步骤|思路|推导|严谨|证明|推理/.test(r)) return 'logic';

  // 5) 兜底：其他错误
  return 'other';
}

// ==========================================
// 工具方法：前端图片压缩
// ==========================================
async function compressImage(file: File, maxWidth = 1024, quality = 0.75): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    const readAsDataUrl = () => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve('');
      reader.readAsDataURL(file);
    };

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      if (img.width <= maxWidth) {
        readAsDataUrl();
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
        readAsDataUrl();
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve('');
    };

    img.src = objectUrl;
  });
}

const POLL_INTERVAL = 3000;
const AUTOSAVE_DELAY = 800;

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export default function Home() {
  // ==========================================
  // 状态管理 (State)
  // ==========================================
  const [role, setRole] = useState<'student' | 'teacher' | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [results, setResults] = useState<BigQuestionData[]>([]);
  const [loading, setLoading] = useState(false);
  const [evaluatingIndex, setEvaluatingIndex] = useState<number | null>(null);
  const [evalResults, setEvalResults] = useState<Record<number, string>>({});

  const [studentName, setStudentName] = useState<string>(() => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('userName') || '测试学生';
  }
  return '测试学生';
});
  const [historyRecords, setHistoryRecords] = useState<SubmitRecordSummary[]>([]);
  const [activeHistoryRecord, setActiveHistoryRecord] = useState<SubmitRecord | null>(null);

  const [recordList, setRecordList] = useState<SubmitRecordSummary[]>([]);
  const [activeRecord, setActiveRecord] = useState<SubmitRecord | null>(null);

  // 👇 新增：记录左侧展开的学生姓名
  const [expandedStudents, setExpandedStudents] = useState<Set<string>>(new Set());

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
  const [saveState, setSaveState] = useState<SaveState>('idle');

  const activeHistoryIdRef = useRef<string | null>(null);
  // 学生端当前打开记录的完整详情快照，用于轮询时比对是否有实质更新（避免闭包拿到 stale state）
  const activeHistoryDetailRef = useRef<SubmitRecord | null>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosavePendingRef = useRef<SubmitRecord | null>(null);

  // ==========================================
  // 通用 UI 工具函数
  // ==========================================
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

  const buildExpandKeys = (
    questionList: BigQuestionData[]
  ): { big: Set<string>; sub: Set<string> } => {
    const big = new Set<string>();
    const sub = new Set<string>();
    (questionList || []).forEach((bigQ, bigIdx) => {
      big.add(`big-${bigIdx}`);
      (bigQ.小问列表 ?? []).forEach((_, subIdx) => {
        sub.add(`sub-${bigIdx}-${subIdx}`);
      });
    });
    return { big, sub };
  };

  // ==========================================
  // 数据请求 API
  // ==========================================
  const fetchAllRecords = useCallback(async (): Promise<SubmitRecordSummary[]> => {
    const res = await fetch('/api/submitRecord', { cache: 'no-store' });
    if (!res.ok) throw new Error('获取提交记录失败');
    const data: SubmitRecordSummary[] = await res.json();
    setRecordList(data);
    return data;
  }, []);

  const fetchRecordDetail = useCallback(async (id: string): Promise<SubmitRecord | null> => {
    const res = await fetch(`/api/submitRecord?id=${encodeURIComponent(id)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as SubmitRecord;
  }, []);

  // ==========================================
  // 教师端：数据持久化与编辑核心逻辑
  // ==========================================
  const persistRecord = useCallback(async (record: SubmitRecord) => {
    setSaveState('saving');
    try {
      const res = await fetch('/api/submitRecord', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: record.id,
          questionList: record.questionList,
          teacherComment: record.teacherComment,
          isReviewed: true,
        }),
      });
      if (!res.ok) throw new Error('保存失败');
      setSaveState('saved');
      setRecordList(prev =>
        prev.map(r => (r.id === record.id ? { ...r, ...record, imgCount: r.imgCount } : r))
      );
    } catch (e) {
      console.error('自动保存失败', e);
      setSaveState('error');
    }
  }, []);

  const updateActiveRecord = useCallback(
    (mutator: (record: SubmitRecord) => void, options?: { immediate?: boolean }) => {
      setActiveRecord(prev => {
        if (!prev) return prev;
        const copy = cloneRecord(prev);
        mutator(copy);

        if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
        autosavePendingRef.current = copy;

        const doSave = () => {
          const pending = autosavePendingRef.current;
          autosavePendingRef.current = null;
          if (pending) void persistRecord(pending);
        };

        if (options?.immediate) {
          doSave();
        } else {
          autosaveTimerRef.current = setTimeout(doSave, AUTOSAVE_DELAY);
        }

        return copy;
      });
    },
    [persistRecord]
  );

  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, []);

  const handleChangeSubStudentScore = (bigIndex: number, subIndex: number, val: string) => {
    updateActiveRecord(record => {
      const big = record.questionList[bigIndex];
      const sub = big.小问列表[subIndex];
      applySubStudentScore(sub, val);
      big.hasManualEdit = true;
      (sub as any).hasManualEdit = true;
      recomputeBigScore(big);
    });
  };

  const handleChangeSubStandardScore = (bigIndex: number, subIndex: number, val: string) => {
    updateActiveRecord(record => {
      const big = record.questionList[bigIndex];
      const sub = big.小问列表[subIndex];
      applySubStandardScore(sub, val);
      big.hasManualEdit = true;
      (sub as any).hasManualEdit = true;
      recomputeBigScore(big);
    });
  };

  const handleChangeBigStandardScore = (bigIndex: number, val: string) => {
    updateActiveRecord(record => {
      applyBigStandardScore(record.questionList[bigIndex], val);
    });
  };

  // ==========================================
  // 学生端：实时轮询批改状态
  // ==========================================
  useEffect(() => {
    if (role !== 'student') return;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch('/api/submitRecord', { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const data: SubmitRecordSummary[] = await res.json();
        if (cancelled) return;

        setRecordList(data);
        setHistoryRecords(data.filter((r: SubmitRecordSummary) => r.studentName === studentName));

        const currentId = activeHistoryIdRef.current;
        if (!currentId) return;

        // 摘要里的 questionList 只有 id，不能用于展示分数——必须重新拉完整详情。
        // 无论是「首次复核」还是「复核后老师再次改分」，只要内容变了都同步给学生。
        const latest = await fetchRecordDetail(currentId);
        if (!latest || cancelled) return;

        const prev = activeHistoryDetailRef.current;
        const changed =
          !prev ||
          prev.isReviewed !== latest.isReviewed ||
          prev.teacherComment !== latest.teacherComment ||
          JSON.stringify(prev.questionList) !== JSON.stringify(latest.questionList);
        if (!changed) return;

        // 先更新 ref 快照，再更新 state；setResults 放在 updater 外部，避免嵌套 setState 副作用
        activeHistoryDetailRef.current = latest;
        setActiveHistoryRecord(latest);
        setResults(latest.questionList);
      } catch (err) {
        console.log('轮询同步失败', err);
      }
    };

    const pollTimer = setInterval(poll, POLL_INTERVAL);
    void poll();
    return () => {
      cancelled = true;
      clearInterval(pollTimer);
    };
  }, [role, studentName, fetchRecordDetail]);

  useEffect(() => {
    activeHistoryIdRef.current = activeHistoryRecord?.id ?? null;
  }, [activeHistoryRecord]);

  // ==========================================
  // 学生端：上传与提交
  // ==========================================
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const fileArray = Array.from(files);

    Promise.all(fileArray.map(file => compressImage(file))).then(list => {
      const valid = list.filter(Boolean);
      if (valid.length < list.length) {
        alert(`有 ${list.length - valid.length} 张图片处理失败，请重试`);
      }
      if (valid.length > 0) {
        setImages(prev => [...prev, ...valid]);
      }
    });
    e.target.value = '';
  };

  const handleSubmit = async () => {
    if (images.length === 0) return;
    setLoading(true);
    setResults([]);
    setEvalResults({});

    const allParsedData: BigQuestionData[] = [];
    const failures: number[] = [];

    try {
      for (let i = 0; i < images.length; i++) {
        try {
          const response = await fetch('/api/grade', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ img_b64: images[i] }),
          });
          if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || `第 ${i + 1} 张图服务器报错`);
          }
          const data = await response.json();
          let parsed: unknown;
          if (Array.isArray(data.data) && data.data.length > 0) {
            parsed = data.data;
          } else {
            parsed = parseGradingResult(data.result ?? '');
          }

          const wrapBig = (big: BigQuestionData): BigQuestionData => {
            const validatedBig = {
              ...big,
              hasManualEdit: false,
              小问列表: (big.小问列表 ?? []).map((sq) => {
                const newSub = {
                  ...sq,
                  hasManualEdit: false,
                  本小问学生得分: sq.本小问学生得分 ?? '0',
                } as any;

                if (newSub.步骤明细 && newSub.步骤明细.length > 0) {
                  let stepSum = 0;
                  newSub.步骤明细.forEach((step: StepItem) => {
                    stepSum += toNumber(step.该步骤满分);
                  });
                  const maxScore = toNumber(newSub.本小问满分);
                  if (Math.abs(stepSum - maxScore) > 0.1 && maxScore > 0) {
                    const ratio = maxScore / stepSum;
                    newSub.步骤明细.forEach((step: StepItem) => {
                      step.该步骤满分 = (toNumber(step.该步骤满分) * ratio).toFixed(1);
                    });
                    newSub.错因归因 = `【系统拦截】检测到AI拆分步骤异常，已强制校准满分。` + (newSub.错因归因 || "");
                  }
                }
                return newSub;
              }) as any,
            };
            return validatedBig;
          };

          if (Array.isArray(parsed)) {
            allParsedData.push(...parsed.map(wrapBig));
          } else if (parsed && typeof parsed === 'object') {
            allParsedData.push(wrapBig(parsed as BigQuestionData));
          }
        } catch (err) {
          console.error(`第 ${i + 1} 张图处理失败`, err);
          failures.push(i + 1);
        }
      }

      if (allParsedData.length === 0) {
        alert(
          failures.length > 0
            ? `所有图片处理失败：第 ${failures.join('、')} 张。请检查图片或重试`
            : '未能从图片中识别出题目，请重新拍摄'
        );
        return;
      }

      setResults(allParsedData);

      const safeName = (studentName || '').trim() || '测试学生';

      const newRecord: SubmitRecord = {
        id: '',
        studentName: safeName,
        submitTime: new Date().toLocaleString('zh-CN'),
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

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error || '保存记录失败');
      }
      if (json.ok || json.success) {
        const savedId = json.id || newRecord.id;
        const saved: SubmitRecord = { ...newRecord, id: savedId };

        setActiveHistoryRecord(saved);
        activeHistoryDetailRef.current = saved;
        setHistoryRecords(prev => [
          { ...saved, imgCount: saved.imgList.length },
          ...prev.filter(r => r.id !== savedId),
        ]);
        setImages([]);
      }
    } catch (error: any) {
      alert(`出错了: ${error?.message || '未知错误'}`);
    } finally {
      setLoading(false);
    }
  };

  // ==========================================
  // 学生端：AI 深度批改（流式输出）
  // ==========================================
  const handleEvaluate = async (index: number, question: string, answer: string) => {
    setEvaluatingIndex(index);
    setEvalResults(prev => ({ ...prev, [index]: '' }));
    try {
      const res = await fetch('/api/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, answer }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || '批改服务异常');
      }
      if (!res.body) throw new Error('没有返回数据流');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let fullText = '';
      let buffer = '';

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (!value) continue;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          if (trimmed === 'data: [DONE]') continue;

          let parsedLine: any;
          try {
            parsedLine = JSON.parse(trimmed.slice(6));
          } catch {
            continue;
          }
          if (parsedLine?.error) throw new Error(parsedLine.error);
          const content = parsedLine?.choices?.[0]?.delta?.content || '';
          if (content) {
            fullText += content;
            setEvalResults(prev => ({ ...prev, [index]: fullText }));
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
  // 学生端：加载历史记录详情
  // ==========================================
  const loadReviewedRecord = async (recordId: string) => {
    try {
      const detail = await fetchRecordDetail(recordId);
      if (!detail) {
        alert('未找到该记录');
        return;
      }
      setActiveHistoryRecord(detail);
      activeHistoryDetailRef.current = detail;
      setResults(detail.questionList);
    } catch (e) {
      console.error(e);
      alert('读取记录失败');
    }
  };

  // ==========================================
  // 教师端：记录获取与选择
  // ==========================================
  useEffect(() => {
    if (role === 'teacher') {
      fetchAllRecords().catch(console.error);
    }
  }, [role, fetchAllRecords]);

  const handleTeacherRefresh = async () => {
    setTeacherRefreshing(true);
    try {
      await fetchAllRecords();
    } catch (e) {
      console.error(e);
    } finally {
      setTeacherRefreshing(false);
    }
  };

  const handleSelectRecord = async (summary: SubmitRecordSummary) => {
    setActiveRecord({
      ...summary,
      imgList: [],
    });
    const keys = buildExpandKeys(summary.questionList ?? []);
    setExpandedBigQuestions(keys.big);
    setExpandedSubQuestions(keys.sub);
    setSaveState('idle');

    try {
      const detail = await fetchRecordDetail(summary.id);
      if (detail) {
        setActiveRecord(detail);
        const detailKeys = buildExpandKeys(detail.questionList ?? []);
        setExpandedBigQuestions(detailKeys.big);
        setExpandedSubQuestions(detailKeys.sub);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // ==========================================
  // 教师端：删除记录
  // ==========================================
  const handleDeleteRecord = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('确定要删除这条测试记录吗？')) return;

    try {
      const res = await fetch('/api/submitRecord', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      if (!res.ok) throw new Error('删除失败');

      setRecordList(prev => prev.filter(r => r.id !== id));
      if (activeRecord?.id === id) {
        setActiveRecord(null);
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  // ==========================================
  // 教师端：保存小问复核 (含强校验)
  // ==========================================
  const saveEdit = async () => {
    if (!editTarget || !activeRecord) return;
    const { bigIndex, subIndex, sub } = editTarget;

    const newMax = Math.max(0, toNumber(sub.本小问满分));
    const newScore = normalizeScore(Math.min(Math.max(toNumber(sub.本小问学生得分), 0), newMax));

    const stepMaxSum = (sub.步骤明细 || []).reduce((acc, curr) => acc + toNumber(curr.该步骤满分), 0);
    if (stepMaxSum > newMax) {
      alert(`保存失败：该小问的步骤满分之和（${stepMaxSum}）不能大于小问满分（${newMax}）！请先调整下方明细。`);
      return;
    }

    updateActiveRecord(
      record => {
        const big = record.questionList[bigIndex];
        const target = big.小问列表[subIndex];
        target.本小问满分 = newMax.toString();
        target.本小问学生得分 = newScore.toString();
        target.错因归因 = sub.错因归因;
        target.讲评建议 = sub.讲评建议;
        if (sub.步骤明细) target.步骤明细 = JSON.parse(JSON.stringify(sub.步骤明细));

        (target as any).hasManualEdit = true;
        big.hasManualEdit = true;
        recomputeBigScore(big);
      },
      { immediate: true }
    );
    setEditTarget(null);
  };

  // ==========================================
  // 教师端：保存步骤复核 (含强校验和联动算分)
  // ==========================================
  const saveStepEdit = async () => {
    if (!editStepTarget || !activeRecord) return;
    const { bigIndex, subIndex, stepIndex, step } = editStepTarget;

    const sMax = Math.max(0, toNumber(step.该步骤满分));
    const sScore = normalizeScore(Math.min(Math.max(toNumber(step.实际得分), 0), sMax));
    const newStep = { ...step, 该步骤满分: sMax.toString(), 实际得分: sScore.toString() };

    const subObj = activeRecord.questionList[bigIndex].小问列表[subIndex];
    const tempSteps = [...(subObj.步骤明细 || [])];
    tempSteps[stepIndex] = newStep;

    const totalStepMax = tempSteps.reduce((acc, curr) => acc + toNumber(curr.该步骤满分), 0);
    if (totalStepMax > toNumber(subObj.本小问满分)) {
      alert(`保存失败：修改后，该小问所有步骤满分之和（${totalStepMax}）将大于小问满分（${subObj.本小问满分}）！`);
      return;
    }

    updateActiveRecord(
      record => {
        const big = record.questionList[bigIndex];
        const sub = big.小问列表[subIndex];

        if (!sub.步骤明细) sub.步骤明细 = [];
        sub.步骤明细[stepIndex] = newStep;

        const newSubScore = sub.步骤明细.reduce((acc, curr) => acc + toNumber(curr.实际得分), 0);
        sub.本小问学生得分 = normalizeScore(newSubScore);

        (sub as any).hasManualEdit = true;
        refreshSubAndBigScore(big, sub);
        big.hasManualEdit = true;
      },
      { immediate: true }
    );
    setEditStepTarget(null);
  };

  // ==========================================
  // 教师端：保存总评语
  // ==========================================
  const saveTeacherComment = async () => {
    if (!activeRecord) return;

    updateActiveRecord(
      record => {
        record.isReviewed = true;
      },
      { immediate: true }
    );
  };

    // ==========================================
  // 渲染：登录页
  // ==========================================
  if (!role) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col items-center justify-center p-4">
        <div className="bg-white p-8 rounded-3xl shadow-xl w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600 mb-2">
              AI 多模态批改系统
            </h1>
            <p className="text-gray-500 text-sm">请登录以继续</p>
          </div>

          <div className="space-y-5">
            <div>
              <label className="text-sm font-medium text-gray-700">账号（学号/工号）</label>
              <input id="login-username" type="text" className="w-full border rounded-lg p-3 mt-1 bg-gray-50 focus:bg-white transition-colors" placeholder="请输入账号" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">密码</label>
              <input id="login-password" type="password" className="w-full border rounded-lg p-3 mt-1 bg-gray-50 focus:bg-white transition-colors" placeholder="请输入密码" />
            </div>

            <button
              onClick={async () => {
                const username = (document.getElementById('login-username') as HTMLInputElement).value;
                const password = (document.getElementById('login-password') as HTMLInputElement).value;

                if (!username || !password) return alert('请填写完整信息');

                const res = await fetch('/api/auth/login', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ username, password })
                });
                const data = await res.json();

                if (res.ok) {
                  setRole(data.role);
                  if (data.role === 'student') setStudentName(data.name);
                } else {
                  alert(data.error);
                }
              }}
              className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl hover:bg-blue-700 transition-all shadow-md mt-4"
            >
              登 录
            </button>
          </div>
        </div>
      </main>
    );
  }

  // ==========================================
  // 渲染：教师端页面
  // ==========================================
  if (role === 'teacher') {
    return (
      <main className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold text-gray-800">👩‍🏫 教师学情看板</h1>
            <div className="flex gap-3 items-center">
              <span
                className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg transition-colors ${
                  saveState === 'saving'
                    ? 'bg-amber-50 text-amber-700'
                    : saveState === 'saved'
                    ? 'bg-emerald-50 text-emerald-700'
                    : saveState === 'error'
                    ? 'bg-red-50 text-red-700'
                    : 'text-gray-400'
                }`}
              >
                {saveState === 'saving' && (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> 保存中
                  </>
                )}
                {saveState === 'saved' && (
                  <>
                    <Check className="w-3.5 h-3.5" /> 已自动保存
                  </>
                )}
                {saveState === 'error' && (
                  <>
                    <AlertCircle className="w-3.5 h-3.5" /> 保存失败
                  </>
                )}
                {saveState === 'idle' && '分数修改后自动保存'}
              </span>

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
                <div className="space-y-4">
                  {/* 👇 核心修改：按学生姓名折叠 */}
                  {Array.from(new Set(recordList.map(r => r.studentName))).map(studentName => {
                    const studentRecords = recordList.filter(r => r.studentName === studentName);
                    const isExpanded = expandedStudents.has(studentName);

                    return (
                      <div key={studentName} className="border rounded-lg overflow-hidden">
                        <button
                          onClick={() => {
                            setExpandedStudents(prev => {
                              const next = new Set(prev);
                              if (next.has(studentName)) next.delete(studentName);
                              else next.add(studentName);
                              return next;
                            });
                          }}
                          className="w-full flex justify-between items-center p-3 bg-gray-50 hover:bg-gray-100 font-semibold text-gray-800"
                        >
                          <span className="flex items-center gap-2">
                            👤 {studentName}
                            <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">
                              {studentRecords.length} 份
                            </span>
                          </span>
                          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>

                        {isExpanded && (
                          <div className="p-2 space-y-2 bg-white">
                            {studentRecords.map(rec => (
                              <div
                                key={rec.id}
                                onClick={() => handleSelectRecord(rec)}
                                className={`p-3 rounded-lg border cursor-pointer transition ${
                                  activeRecord?.id === rec.id
                                    ? 'border-blue-500 bg-blue-50'
                                    : 'border-gray-200 hover:bg-gray-50'
                                }`}
                              >
                                <div className="flex justify-between items-center">
                                  <span className="text-sm text-gray-700">
                                    {rec.submitTime}
                                  </span>
                                  <div className="flex items-center gap-2">
                                    {rec.isReviewed ? (
                                      <CheckCircle className="text-green-500 w-4 h-4" />
                                    ) : (
                                      <FileText className="text-orange-400 w-4 h-4" />
                                    )}
                                    <button
                                      onClick={(e) => handleDeleteRecord(e, rec.id)}
                                      className="text-gray-400 hover:text-red-500 transition-colors p-1"
                                      title="删除记录"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </div>
                                </div>
                                <div className="text-xs mt-1 text-gray-500">
                                  共 {rec.questionList?.length || 0} 道大题
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 👇 宏观学情饼图 */}
            <div className="col-span-12 mb-2 bg-white p-6 rounded-xl shadow border border-gray-100">
              <h2 className="font-bold text-lg mb-4 text-gray-800">
                📊 {activeRecord ? `${activeRecord.studentName} 的个人错因画像` : '班级高频错因分析（全班汇总）'}
              </h2>
              <div className="h-64 w-full">
                {(() => {
                  const counts: Record<ErrorCategory, number> = {
                    correct: 0, unanswered: 0, concept: 0, calc: 0, logic: 0, other: 0,
                  };

                  const targetList = activeRecord ? [activeRecord] : recordList;

                  targetList.forEach(rec => {
                    rec.questionList?.forEach(q => {
                      q.小问列表?.forEach(sub => {
                        counts[classifyErrorReason(sub)]++;
                      });
                    });
                  });

                  const totalErrors = counts.unanswered + counts.concept + counts.calc + counts.logic + counts.other;
                  let chartData = [];

                  if (totalErrors === 0) {
                    chartData = [{ name: '全对 / 无错题', value: 1, color: '#10b981' }];
                  } else {
                    chartData = [
                      { name: '概念模糊', value: counts.concept, color: '#ef4444' },
                      { name: '计算失误', value: counts.calc, color: '#f59e0b' },
                      { name: '逻辑断层', value: counts.logic, color: '#3b82f6' },
                      { name: '未作答', value: counts.unanswered, color: '#6b7280' },
                      { name: '其他错误', value: counts.other, color: '#8b5cf6' },
                    ].filter(item => item.value > 0);
                  }

                  return (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={chartData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={80}
                          paddingAngle={5}
                          dataKey="value"
                          label={({ name, percent }: any) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                        >
                          {chartData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value: any) => [`${value} 个小问`, '数量']} />
                        <Legend verticalAlign="bottom" height={36}/>
                      </PieChart>
                    </ResponsiveContainer>
                  );
                })()}
              </div>
            </div>

            <div className="col-span-8 bg-white rounded-xl shadow p-6">
              {activeRecord ? (
                <div>
                  <div className="flex justify-between mb-4">
                    <h2 className="font-bold text-lg">
                      批改详情 - {activeRecord.studentName}
                    </h2>
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

                  {activeRecord.imgList?.length > 0 && (
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
                  )}

                  <div className="mb-6 p-4 border border-blue-200 bg-blue-50 rounded-lg">
                    <div className="flex justify-between items-center mb-2">
                      <h4 className="font-semibold text-blue-900">💬 老师总评语</h4>
                      <button
                        onClick={saveTeacherComment}
                        className="text-sm bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 flex items-center gap-1"
                      >
                        <Save className="w-3.5 h-3.5" /> 保存评语
                      </button>
                    </div>
                    <textarea
                      value={activeRecord.teacherComment || ''}
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

                  <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
                    <div className="text-sm text-gray-600">
                      总得分：
                      <span className="font-bold text-blue-700 text-base">
                        {(activeRecord.questionList || []).reduce(
                          (s, bq) => s + toNumber(bq.大题实得分),
                          0
                        )}
                      </span>
                      <span className="text-gray-400">
                        /{' '}
                        {(activeRecord.questionList || []).reduce(
                          (s, bq) => s + toNumber(bq.大题总分),
                          0
                        )}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          const keys = buildExpandKeys(activeRecord.questionList || []);
                          setExpandedBigQuestions(keys.big);
                          setExpandedSubQuestions(keys.sub);
                        }}
                        className="text-xs text-blue-600 hover:bg-blue-50 px-2.5 py-1 rounded border border-blue-200"
                      >
                        全部展开
                      </button>
                      <button
                        onClick={() => {
                          setExpandedBigQuestions(new Set());
                          setExpandedSubQuestions(new Set());
                        }}
                        className="text-xs text-gray-500 hover:bg-gray-50 px-2.5 py-1 rounded border border-gray-200"
                      >
                        全部收起
                      </button>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {(activeRecord.questionList || []).map((bigQ, bigIdx) => {
                      const bigKey = `big-${bigIdx}`;
                      const bigOpen = expandedBigQuestions.has(bigKey);

                      return (
                        <div key={bigIdx} className="border rounded-lg">
                          <button
                            onClick={() => toggleBigQuestion(bigKey)}
                            className="w-full flex justify-between items-center p-4 bg-gray-50 hover:bg-gray-100"
                          >
                            <span className="font-semibold">
                              大题 {bigQ.大题题号}｜总分：{bigQ.大题总分 || 0}｜得分：
                              {bigQ.大题实得分 || 0}
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
                                <MathMarkdown>
                                  {bigQ.大题题干 || ''}
                                </MathMarkdown>
                              </div>

                              <div className="flex items-center gap-2">
                                <span className="text-sm">修改大题标准总分：</span>
                                <input
                                  type="number"
                                  min={0}
                                  step="0.5"
                                  value={bigQ.大题总分 || ''}
                                  onChange={e =>
                                    handleChangeBigStandardScore(bigIdx, e.target.value)
                                  }
                                  className="w-20 border px-1"
                                />
                              </div>

                              {(bigQ.小问列表 || []).map((subQ, subIdx) => {
                                const subKey = `sub-${bigIdx}-${subIdx}`;
                                const subOpen = expandedSubQuestions.has(subKey);
                                const stepTotal = sumStepMax(subQ);
                                const subMaxNum = toNumber(subQ.本小问满分);
                                const stepWarn =
                                  subQ.步骤明细 && subQ.步骤明细.length > 0 &&
                                  Math.abs(stepTotal - subMaxNum) > 0.001;
                                const stepScoreSummary = (subQ.步骤明细 || [])
                                  .map(
                                    (st) =>
                                      `${st.该步骤满分}→${st.实际得分}${
                                        st.判定 === '正确'
                                          ? '✓'
                                          : st.判定 === '部分正确'
                                          ? '△'
                                          : '✗'
                                      }`
                                  )
                                  .join('  ');

                                return (
                                  <div key={subIdx} className="border rounded-lg">
                                    <button
                                      onClick={() => toggleSubQuestion(subKey)}
                                      className="w-full flex justify-between items-center p-3 bg-blue-50 hover:bg-blue-100"
                                    >
                                      <span className="font-medium text-blue-900">
                                        小问 {subQ.小问编号}｜满分：{subQ.本小问满分 || 0}｜学生得分：
                                        {subQ.本小问学生得分 || 0}
                                        {subQ.步骤明细 && subQ.步骤明细.length > 0 && (
                                          <span className="ml-2 text-xs font-normal text-blue-600">
                                            步骤得分：{stepScoreSummary}
                                          </span>
                                        )}
                                      </span>
                                      {subOpen ? <ChevronDown /> : <ChevronRight />}
                                    </button>

                                    {subOpen && (
                                      <div className="p-4 space-y-3">
                                        <div className="grid md:grid-cols-2 gap-3 text-sm">
                                          <div>
                                            <div className="text-xs text-gray-500">题干</div>
                                            <MathMarkdown>
                                              {subQ.小问题干 || ''}
                                            </MathMarkdown>
                                          </div>
                                          <div>
                                            <div className="text-xs text-gray-500">学生作答</div>
                                            <MathMarkdown>
                                              {subQ.学生作答 || ''}
                                            </MathMarkdown>
                                          </div>
                                        </div>

                                        {subQ.选项内容 && subQ.选项内容.trim() && (
                                          <div className="text-sm">
                                            <div className="text-xs text-gray-500">选项</div>
                                            <MathMarkdown>
                                              {subQ.选项内容}
                                            </MathMarkdown>
                                          </div>
                                        )}

                                        <div className="text-sm bg-amber-50 p-2 rounded">
                                          <div className="text-xs text-gray-500">评分细则</div>
                                          {subQ.评分细则 || ''}
                                        </div>

                                        <div className="text-sm">
                                          <div className="text-xs text-gray-500">错因归因</div>
                                          {subQ.错因归因 || ''}
                                        </div>

                                        <div className="text-sm">
                                          <div className="text-xs text-gray-500">讲评建议</div>
                                          {subQ.讲评建议 || ''}
                                        </div>

                                        <div className="flex gap-3 items-center">
                                          <div>
                                            <span className="text-sm">小问满分：</span>
                                            <input
                                              type="number"
                                              min={0}
                                              step="0.5"
                                              value={subQ.本小问满分 || ''}
                                              onChange={e =>
                                                handleChangeSubStandardScore(
                                                  bigIdx,
                                                  subIdx,
                                                  e.target.value
                                                )
                                              }
                                              className="w-16 border px-1"
                                            />
                                          </div>
                                          <div>
                                            <span className="text-sm">学生得分：</span>
                                            <input
                                              type="number"
                                              min={0}
                                              step="0.5"
                                              value={subQ.本小问学生得分 || ''}
                                              onChange={e =>
                                                handleChangeSubStudentScore(
                                                  bigIdx,
                                                  subIdx,
                                                  e.target.value
                                                )
                                              }
                                              className="w-16 border px-1"
                                            />
                                          </div>
                                        </div>

                                        {stepWarn && (
                                          <div className="text-red-600 text-sm bg-red-50 p-2 rounded">
                                            ⚠️ 警告：本小问所有步骤满分总和（{stepTotal}）和小问满分（
                                            {subQ.本小问满分}）不一致
                                          </div>
                                        )}

                                        {subQ.步骤明细 && subQ.步骤明细.length > 0 && (
                                          <div className="my-4">
                                            <div className="text-xs font-bold text-gray-500 block mb-2">
                                              📋 分步阅卷明细
                                            </div>
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
                                                  {(subQ.步骤明细 || []).map((step, sIdx) => (
                                                    <tr key={sIdx} className="border-t border-gray-100 hover:bg-gray-50">
                                                      <td className="py-3 px-3 text-center text-gray-500">{step.步骤序号}</td>
                                                      <td className="py-3 px-3 text-center">{step.该步骤满分}</td>
                                                      <td className="py-3 px-3 text-center font-bold text-blue-600">{step.实际得分}</td>
                                                      <td className={`py-3 px-3 text-center font-bold ${step.判定 === '正确' ? 'text-green-600' : step.判定 === '部分正确' ? 'text-amber-600' : 'text-red-600'}`}>
                                                        {step.判定}
                                                      </td>
                                                      <td className="py-3 px-3 text-gray-600">{step.说明 || ''}</td>
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
                <div className="text-center py-16 text-gray-400">
                  左侧选择一条学生提交记录查看批改结果
                </div>
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
                    type="number"
                    min={0}
                    step="0.5"
                    value={editTarget.sub.本小问满分 || ''}
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
                    type="number"
                    min={0}
                    step="0.5"
                    value={editTarget.sub.本小问学生得分 || ''}
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
                    value={editTarget.sub.错因归因 || ''}
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
                    value={editTarget.sub.讲评建议 || ''}
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
                    value={editStepTarget.step.该步骤满分 || ''}
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
                    value={editStepTarget.step.实际得分 || ''}
                    onChange={e =>
                      setEditStepTarget({
                        ...editStepTarget,
                        step: { ...editStepTarget.step, 实际得分: e.target.value },
                      })
                    }
                    className="w-full border rounded p-2 mt-1"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    实际得分不能超过该步骤满分，保存时会自动钳制
                  </p>
                </div>
                <div>
                  <label className="text-sm text-gray-600">判定</label>
                  <select
                    value={editStepTarget.step.判定 || '正确'}
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
                    value={editStepTarget.step.说明 || ''}
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

  // ==========================================
  // 渲染：学生端页面
  // ==========================================
  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 p-4 md:p-8 flex flex-col items-center">
      <div className="w-full max-w-4xl flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-800">
            👦 学生端：作业批改助手
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            支持多图上传，自动识别并拆分题目
          </p>
        </div>
        <button
          onClick={() => setRole(null)}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-800 font-medium bg-white px-4 py-2 rounded-lg shadow-sm transition-colors border"
        >
          <RefreshCcw className="w-4 h-4" /> 切换身份
        </button>
      </div>

      <div className="w-full max-w-lg mb-4">
        <label className="text-sm text-gray-600">当前登录学生</label>
        <input
          value={studentName}
          disabled  // 👈 核心：加上这个，彻底锁死，改不了啦
          className="w-full border rounded-lg p-2 mt-1 bg-gray-100 text-gray-500 cursor-not-allowed" // 👈 改成灰色背景和不可点击的鼠标样式
        />
      </div>

      <div className="bg-white p-8 rounded-2xl shadow-lg w-full max-w-lg mb-10 border border-gray-100">
        <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-blue-300 border-dashed rounded-xl cursor-pointer bg-blue-50/50 hover:bg-blue-50 transition-colors">
          <div className="flex flex-col items-center justify-center pt-5 pb-6">
            <UploadCloud className="w-10 h-10 text-blue-500 mb-3" />
            <p className="mb-2 text-sm text-gray-600 font-semibold">
              点击或拖拽上传作业图片
            </p>
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
              <div
                key={rec.id}
                className="flex justify-between items-center border rounded-lg p-3 hover:bg-gray-50"
              >
                <div>
                  <div className="font-medium">{rec.studentName}</div>
                  <div className="text-xs text-gray-500">
                    {rec.submitTime} · {rec.questionList?.length || 0} 道大题
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {rec.isReviewed ? (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
                      已复核
                    </span>
                  ) : (
                    <span className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded">
                      待老师复核
                    </span>
                  )}
                  <button
                    onClick={() => loadReviewedRecord(rec.id)}
                    className="text-sm text-blue-600"
                  >
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
          <p className="text-gray-800 whitespace-pre-wrap">
            {activeHistoryRecord.teacherComment}
          </p>
        </div>
      )}

      <div className="w-full max-w-4xl space-y-8">
        {(results || []).map((bigItem, bigIdx) => (
          <div
            key={bigIdx}
            className="bg-white rounded-2xl shadow-md border border-gray-100 overflow-hidden transition-all hover:shadow-lg"
          >
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
                  置信度: {bigItem.识别置信度 || '未知'}
                </span>
                <span className="px-3 py-1 rounded-full text-xs font-bold bg-blue-600 text-white shadow-sm">
                  得分：{bigItem.大题实得分 || 0}/{bigItem.大题总分 || 0}
                </span>
              </div>
            </div>

            <div className="p-6 md:p-8">
              <div className="mb-8">
                <span className="text-sm font-bold text-gray-500 uppercase tracking-wider block mb-2">
                  📝 大题题干
                </span>
                <div className="bg-gray-50 p-4 rounded-xl text-gray-800 text-base leading-relaxed border border-gray-100">
                  <MathMarkdown>
                    {bigItem.大题题干 || ''}
                  </MathMarkdown>
                </div>
              </div>

              <div className="space-y-6">
                {(bigItem.小问列表 || []).map((subItem, subIdx) => {
                  const isTeacherEdited = (subItem as any).hasManualEdit || bigItem.hasManualEdit;
                  const isFullScore = Number(subItem.本小问学生得分 || 0) >= Number(subItem.本小问满分 || 0) && Number(subItem.本小问满分 || 0) > 0;

                  return (
                    <div
                      key={subIdx}
                      className="border border-blue-100 rounded-xl p-5 md:p-6 bg-blue-50/30"
                    >
                      <h3 className="font-bold text-blue-900 text-lg mb-4 flex justify-between items-start gap-3">
                        <span className="flex items-center gap-2">
                          小问 {subItem.小问编号}
                          {isTeacherEdited && (
                            <span className="text-xs bg-orange-100 text-orange-600 border border-orange-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" /> 教师修正分数
                            </span>
                          )}
                        </span>
                        <span className="flex flex-col items-end gap-1">
                          <span className={`text-sm px-2 py-1 rounded ${isTeacherEdited ? 'bg-orange-50 text-orange-700 font-bold' : 'bg-blue-100 text-blue-700'}`}>
                            满分：{subItem.本小问满分 || 0}分｜得分：{subItem.本小问学生得分 || 0}分
                          </span>

                          {!isTeacherEdited && subItem.步骤明细 && subItem.步骤明细.length > 0 && (
                            <span className="text-xs text-blue-600">
                              步骤得分：
                              {(subItem.步骤明细 || [])
                                .map(
                                  (st) =>
                                    `${st.该步骤满分}→${st.实际得分}${
                                      st.判定 === '正确'
                                        ? '✓'
                                        : st.判定 === '部分正确'
                                        ? '△'
                                        : '✗'
                                    }`
                                )
                                .join('  ')}
                            </span>
                          )}
                        </span>
                      </h3>

                      <div className="grid md:grid-cols-2 gap-4 mb-4">
                        <div className="flex flex-col gap-2">
                          <span className="text-xs font-bold text-gray-500 block mb-1">
                            📝 小问题干
                          </span>
                          <div className="bg-white p-3 rounded-lg text-gray-800 text-sm border border-gray-100 min-h-[60px]">
                            <MathMarkdown>
                              {subItem.小问题干 || ''}
                            </MathMarkdown>

                            {subItem.选项内容 && subItem.选项内容.trim() && (
                              <div className="mt-3 pt-3 border-t border-gray-100 text-gray-700">
                                <MathMarkdown>
                                  {subItem.选项内容}
                                </MathMarkdown>
                              </div>
                            )}
                          </div>
                        </div>
                        <div>
                          <span className="text-xs font-bold text-gray-500 block mb-1">
                            ✍️ 学生作答
                          </span>
                          <div className="bg-white p-3 rounded-lg text-gray-800 text-sm border border-gray-100 min-h-[60px]">
                            <MathMarkdown>
                              {subItem.学生作答 || ''}
                            </MathMarkdown>
                          </div>
                        </div>
                      </div>

                      {subItem.评分细则 && (
                        <div className="mb-4">
                          <span className="text-xs font-bold text-gray-500 block mb-1">
                            📌 评分细则
                          </span>
                          <div className="bg-amber-50 p-3 rounded-lg text-amber-900 text-sm border border-amber-200">
                            <MathMarkdown>
                              {subItem.评分细则}
                            </MathMarkdown>
                          </div>
                        </div>
                      )}

                      {subItem.步骤明细 && subItem.步骤明细.length > 0 && (
                        <div className="my-4">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs font-bold text-gray-500 block">
                              📋 分步阅卷明细
                            </span>
                            {isTeacherEdited && (
                              <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-bold">
                                含教师复核
                              </span>
                            )}
                          </div>
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
                                    <td className="py-3 px-3 text-center text-gray-500">
                                      {step.步骤序号}
                                    </td>
                                    <td className="py-3 px-3 text-center">{step.该步骤满分}</td>
                                    <td className="py-3 px-3 text-center font-bold text-blue-600">
                                      {step.实际得分}
                                    </td>
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
                                    <td className="py-3 px-3 text-gray-600">{step.说明 || ''}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      <div className="mt-4 bg-white p-4 rounded-lg border border-gray-100">
                        {isFullScore ? (
                          <div className="flex items-center gap-2 text-green-600 font-bold text-sm">
                            <CheckCircle className="w-4 h-4" />
                            作答完全正确，暂无错因分析。请继续保持！
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-2 mb-2">
                              <span className="font-bold text-gray-700 text-sm">🔍 错因归因：</span>
                              {isTeacherEdited && <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-bold">已复核</span>}
                            </div>
                            <div className="mb-2 text-gray-600 text-sm ml-1">{subItem.错因归因 || ''}</div>

                            <div className="flex items-center gap-2 mb-2 mt-4">
                              <span className="font-bold text-gray-700 text-sm">💡 讲评建议：</span>
                              {isTeacherEdited && <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-bold">已复核</span>}
                            </div>
                            <div className="text-gray-600 text-sm ml-1">{subItem.讲评建议 || ''}</div>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-8 pt-6 border-t border-gray-100">
                <button
                  onClick={() => {
                    const fullQuestion = [
                      bigItem.大题题干,
                      ...(bigItem.小问列表 ?? []).map(
                        sq =>
                          `【${sq.小问编号}】${sq.小问题干}${
                            sq.选项内容 ? ` 选项：${sq.选项内容}` : ''
                          }`
                      ),
                    ].join('\n');

                    const fullAnswer = (bigItem.小问列表 ?? [])
                      .map(sq => `【${sq.小问编号}】${sq.学生作答 || '（未作答）'}`)
                      .join('\n');

                    handleEvaluate(bigIdx, fullQuestion, fullAnswer);
                  }}
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
                      <MathMarkdown>
                        {evalResults[bigIdx]}
                      </MathMarkdown>
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
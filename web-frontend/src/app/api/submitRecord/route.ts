// web-frontend/src/app/api/submitRecord/route.ts
import { NextResponse } from 'next/server';

type RecordItem = {
  id: string;
  studentName: string;
  submitTime: string;
  imgList: string[]; // 适配前端：多图数组，不是单个img_b64
  questionList: any[];
  isReviewed: boolean;
  teacherComment: string;
};

// 内存存储（重启服务数据清空，适合课程作业演示）
let records: RecordItem[] = [];

// GET：读取全部记录
export async function GET() {
  return NextResponse.json(records);
}

// POST：新增一条提交记录
export async function POST(req: Request) {
  try {
    const payload = await req.json();
    records.push(payload);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: '保存记录失败' }, { status: 500 });
  }
}

// PATCH：修改评语、复核状态（保留原有，兼容旧调用）
export async function PATCH(req: Request) {
  try {
    const { id, teacherComment, isReviewed } = await req.json();
    if (!id) {
      return NextResponse.json({ error: '缺少记录id' }, { status: 400 });
    }
    const target = records.find(r => r.id === id);
    if (!target) {
      return NextResponse.json({ error: '找不到这条记录' }, { status: 404 });
    }
    target.teacherComment = teacherComment ?? "";
    target.isReviewed = isReviewed ?? true;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("patch error", err);
    return NextResponse.json({ error: '更新失败' }, { status: 500 });
  }
}

// ✅ 新增 PUT：适配前端保存复核（修改questionList、评语、复核状态）
export async function PUT(req: Request) {
  try {
    const { id, questionList, teacherComment, isReviewed } = await req.json();
    if (!id) {
      return NextResponse.json({ error: '缺少记录id' }, { status: 400 });
    }
    const target = records.find(r => r.id === id);
    if (!target) {
      return NextResponse.json({ error: '找不到这条记录' }, { status: 404 });
    }
    // 赋值更新
    if (questionList !== undefined) target.questionList = questionList;
    if (teacherComment !== undefined) target.teacherComment = teacherComment;
    if (isReviewed !== undefined) target.isReviewed = isReviewed;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("put error", err);
    return NextResponse.json({ error: '更新失败' }, { status: 500 });
  }
}

// DELETE：删除记录
export async function DELETE(req: Request) {
  try {
    const { id } = await req.json();
    records = records.filter(r => r.id !== id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: '删除失败' }, { status: 500 });
  }
}

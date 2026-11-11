import { NextResponse } from 'next/server';
import {
  addRecord,
  deleteRecord,
  getRecordById,
  getRecordSummaries,
  updateRecord,
} from '@/lib/store';
import type { BigQuestionData, SubmitRecord } from '@/lib/types';

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isValidQuestionList(v: unknown): v is BigQuestionData[] {
  if (!Array.isArray(v)) return false;
  return v.every(
    (q) =>
      q &&
      typeof q === 'object' &&
      Array.isArray((q as BigQuestionData).小问列表)
  );
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (id) {
      const record = await getRecordById(id);
      if (!record) {
        return NextResponse.json({ error: '找不到这条记录' }, { status: 404 });
      }
      return NextResponse.json(record);
    }

    const summaries = await getRecordSummaries();
    return NextResponse.json(summaries);
  } catch (e) {
    console.error('[submitRecord] GET 异常：', e);
    return NextResponse.json({ error: '读取记录失败' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const payload = await req.json().catch(() => null);
    if (!payload || typeof payload !== 'object') {
      return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
    }

    if (!isNonEmptyString(payload?.studentName)) {
      return NextResponse.json({ error: '缺少学生姓名' }, { status: 400 });
    }
    if (!isValidQuestionList(payload?.questionList)) {
      return NextResponse.json({ error: '批改结果格式不正确' }, { status: 400 });
    }
    if (!Array.isArray(payload?.imgList)) {
      return NextResponse.json({ error: '缺少作业原图' }, { status: 400 });
    }

    const record = await addRecord({
      studentName: payload.studentName.trim(),
      submitTime: isNonEmptyString(payload.submitTime)
        ? payload.submitTime
        : new Date().toLocaleString('zh-CN'),
      imgList: payload.imgList,
      questionList: payload.questionList as BigQuestionData[],
      isReviewed: payload.isReviewed === true,
      teacherComment:
        typeof payload.teacherComment === 'string' ? payload.teacherComment : '',
    });

    return NextResponse.json({ ok: true, success: true, id: record.id });
  } catch (e) {
    console.error('[submitRecord] POST 异常：', e);
    return NextResponse.json({ error: '保存记录失败' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
    }

    const { id, questionList, teacherComment, isReviewed } = body;

    if (!isNonEmptyString(id)) {
      return NextResponse.json({ error: '缺少记录id' }, { status: 400 });
    }

    const patch: Partial<SubmitRecord> = {};
    if (questionList !== undefined) {
      if (!isValidQuestionList(questionList)) {
        return NextResponse.json(
          { error: 'questionList 格式不正确' },
          { status: 400 }
        );
      }
      patch.questionList = questionList as BigQuestionData[];
    }
    if (teacherComment !== undefined) {
      patch.teacherComment =
        typeof teacherComment === 'string' ? teacherComment : '';
    }
    if (typeof isReviewed === 'boolean') {
      patch.isReviewed = isReviewed;
    }

    const updated = await updateRecord(id, patch);
    if (!updated) {
      return NextResponse.json({ error: '找不到这条记录' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, id: updated.id });
  } catch (e) {
    console.error('[submitRecord] PUT 异常：', e);
    return NextResponse.json({ error: '更新失败' }, { status: 500 });
  }
}

// 保留 PATCH 以防万一
export async function PATCH(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
    }

    const { id, teacherComment, isReviewed } = body;

    if (!isNonEmptyString(id)) {
      return NextResponse.json({ error: '缺少记录id' }, { status: 400 });
    }

    const patch: Partial<SubmitRecord> = {};
    if (teacherComment !== undefined) {
      patch.teacherComment =
        typeof teacherComment === 'string' ? teacherComment : '';
    }
    if (typeof isReviewed === 'boolean') {
      patch.isReviewed = isReviewed;
    }

    const updated = await updateRecord(id, patch);
    if (!updated) {
      return NextResponse.json({ error: '找不到这条记录' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, id: updated.id });
  } catch (e) {
    console.error('[submitRecord] PATCH 异常：', e);
    return NextResponse.json({ error: '更新失败' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const id = body?.id;
    if (!isNonEmptyString(id)) {
      return NextResponse.json({ error: '缺少记录id' }, { status: 400 });
    }

    const removed = await deleteRecord(id);
    if (!removed) {
      return NextResponse.json({ error: '找不到这条记录' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[submitRecord] DELETE 异常：', e);
    return NextResponse.json({ error: '删除失败' }, { status: 500 });
  }
}
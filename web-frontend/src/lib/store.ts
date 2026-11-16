import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// 保存新记录
export async function addRecord(data: any) {
  return await prisma.record.create({
    data: {
      studentName: data.studentName,
      submitTime: data.submitTime,
      isReviewed: data.isReviewed || false,
      teacherComment: data.teacherComment || '',
      imgList: data.imgList,
      questionList: {
        create: data.questionList.map((big: any) => ({
          questionNumber: big.大题题号,
          stem: big.大题题干,
          totalScore: big.大题总分,
          actualScore: big.大题实得分,
          confidence: big.识别置信度 || '高',
          hasManualEdit: big.hasManualEdit || false,
          subQuestions: {
            create: (big.小问列表 || []).map((sub: any) => ({
              subNumber: sub.小问编号,
              stem: sub.小问题干,
              studentAnswer: sub.学生作答,
              optionContent: sub.选项内容 || '',
              maxScore: sub.本小问满分,
              studentScore: sub.本小问学生得分,
              gradingRule: sub.评分细则 || '',
              errorReason: sub.错因归因,
              teachingAdvice: sub.讲评建议,
              hasManualEdit: sub.hasManualEdit || false,
              steps: {
                create: (sub.步骤明细 || []).map((st: any) => ({
                  stepNumber: st.步骤序号,
                  maxScore: st.该步骤满分,
                  actualScore: st.实际得分,
                  judgment: st.判定,
                  explanation: st.说明
                }))
              }
            }))
          }
        }))
      }
    }
  });
}

// 获取列表（已移除导致内存爆炸的 orderBy，并加上异常捕获）
export async function getRecordSummaries() {
  try {
    const records = await prisma.record.findMany({
      select: {
        id: true,
        studentName: true,
        submitTime: true,
        isReviewed: true,
        teacherComment: true,
        imgList: true,
        questionList: { select: { id: true } },
      }
      // 👈 删除了 orderBy: { createdAt: 'desc' }
    });

    // 在前端（Node.js 环境）用代码排个序，不影响功能
    return records.map(r => ({
      id: r.id,
      studentName: r.studentName,
      submitTime: r.submitTime,
      isReviewed: r.isReviewed,
      teacherComment: r.teacherComment,
      imgCount: Array.isArray(r.imgList) ? (r.imgList as any[]).length : 0,
      questionList: r.questionList as any,
    })).sort((a, b) => (b.submitTime > a.submitTime ? 1 : -1));

  } catch (error) {
    console.error('❌ [数据库查询报错] 无法读取 Record 表：', error);
    return []; // 避免 500 崩溃，返回空数组
  }
}

// 获取单条详情
export async function getRecordById(id: string) {
  try {
    const record = await prisma.record.findUnique({
      where: { id },
      include: {
        questionList: {
          include: {
            subQuestions: { include: { steps: true } }
          }
        }
      }
    });

    if (!record) return null;

    return {
      id: record.id,
      studentName: record.studentName,
      submitTime: record.submitTime,
      isReviewed: record.isReviewed,
      teacherComment: record.teacherComment,
      imgList: record.imgList as string[],
      questionList: record.questionList.map((big: any) => ({
        大题题号: big.questionNumber,
        大题题干: big.stem,
        大题总分: big.totalScore,
        大题实得分: big.actualScore,
        识别置信度: big.confidence,
        hasManualEdit: big.hasManualEdit,
        小问列表: big.subQuestions.map((sub: any) => ({
          小问编号: sub.subNumber,
          小问题干: sub.stem,
          学生作答: sub.studentAnswer,
          选项内容: sub.optionContent,
          本小问满分: sub.maxScore,
          本小问学生得分: sub.studentScore,
          评分细则: sub.gradingRule,
          错因归因: sub.errorReason,
          讲评建议: sub.teachingAdvice,
          hasManualEdit: sub.hasManualEdit,
          步骤明细: sub.steps.map((st: any) => ({
            步骤序号: st.stepNumber,
            该步骤满分: st.maxScore,
            实际得分: st.actualScore,
            判定: st.judgment,
            说明: st.explanation
          }))
        }))
      }))
    };
  } catch (error) {
    console.error('❌ [数据库查询详情报错]:', error);
    return null;
  }
}

// 更新记录
export async function updateRecord(id: string, data: any) {
  try {
    await prisma.record.update({
      where: { id },
      data: {
        teacherComment: data.teacherComment,
        isReviewed: data.isReviewed,
      }
    });

    if (data.questionList) {
      await prisma.bigQuestion.deleteMany({ where: { recordId: id } });

      for (const big of data.questionList) {
        await prisma.bigQuestion.create({
          data: {
            recordId: id,
            questionNumber: big.大题题号,
            stem: big.大题题干,
            totalScore: big.大题总分,
            actualScore: big.大题实得分,
            confidence: big.识别置信度 || '高',
            hasManualEdit: big.hasManualEdit || false,
            subQuestions: {
              create: (big.小问列表 || []).map((sub: any) => ({
                subNumber: sub.小问编号,
                stem: sub.小问题干,
                studentAnswer: sub.学生作答,
                optionContent: sub.选项内容 || '',
                maxScore: sub.本小问满分,
                studentScore: sub.本小问学生得分,
                gradingRule: sub.评分细则 || '',
                errorReason: sub.错因归因,
                teachingAdvice: sub.讲评建议,
                hasManualEdit: sub.hasManualEdit || false,
                steps: {
                  create: (sub.步骤明细 || []).map((st: any) => ({
                    stepNumber: st.步骤序号,
                    maxScore: st.该步骤满分,
                    actualScore: st.实际得分,
                    judgment: st.判定,
                    explanation: st.说明
                  }))
                }
              }))
            }
          }
        });
      }
    }
    return true;
  } catch (error) {
    console.error("❌ [数据库更新报错]:", error);
    return false;
  }
}

// 删除记录
export async function deleteRecord(id: string) {
  try {
    await prisma.record.delete({ where: { id } });
    return true;
  } catch (error) {
    console.error("❌ [数据库删除报错]:", error);
    return false;
  }
}
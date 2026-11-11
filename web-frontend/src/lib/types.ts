/**
 * 全局共享的数据结构定义。
 *
 * 前后端（页面组件 / 三个 API 路由）都从这里取类型，避免各处重复手写
 * 中文字段名导致的结构漂移。
 */

/** 分步阅卷明细中的一条步骤 */
export interface StepItem {
  /** 步骤序号，从 1 开始 */
  步骤序号: number;
  /** 该步骤满分 */
  该步骤满分: string;
  /** 学生在该步骤的实际得分 */
  实际得分: string;
  /** 判定结果：正确 / 部分正确 / 错误 */
  判定: string;
  /** 该步骤的对错说明 */
  说明: string;
}

/** 一个小问（子题） */
export interface SubQuestion {
  /** 小问编号，如 "(1)" */
  小问编号: string;
  /** 小问题干 */
  小问题干: string;
  /** 选项内容，选择题才有 */
  选项内容: string;
  /** 学生作答 */
  学生作答: string;
  /** 本小问满分 */
  本小问满分: string;
  /** 本小问学生得分 */
  本小问学生得分: string;
  /** 评分细则 */
  评分细则: string;
  /** 分步阅卷明细，选择题/填空题为空数组 */
  步骤明细: StepItem[];
  /** 错因归因 */
  错因归因: string;
  /** 讲评建议 */
  讲评建议: string;
}

/** 一道大题 */
export interface BigQuestionData {
  /** 大题题号 */
  大题题号: string;
  /** 大题题干 */
  大题题干: string;
  /** 大题标准总分 */
  大题总分: string;
  /** 大题实得分 */
  大题实得分: string;
  /** 识别置信度：高 / 中 / 低 */
  识别置信度: string;
  /** 标记：分数是否被人工修改过 */
  hasManualEdit: boolean;
  /** 该大题下的各个小问 */
  小问列表: SubQuestion[];
}

/** 一次作业提交记录 */
export interface SubmitRecord {
  /** 记录唯一 id */
  id: string;
  /** 学生姓名 */
  studentName: string;
  /** 提交时间 */
  submitTime: string;
  /** 作业原图列表（data URL） */
  imgList: string[];
  /** 批改结果 */
  questionList: BigQuestionData[];
  /** 是否已被老师复核 */
  isReviewed: boolean;
  /** 老师总评语 */
  teacherComment: string;
}

/**
 * 列表接口返回的精简记录。
 *
 * 与 {@link SubmitRecord} 的区别是 **不携带原图 base64**：
 * 图片体积占整条记录 99% 以上，若列表接口带上原图，
 * 每个学生 3 秒轮询一次会把所有人的作业图重复下载一遍。
 * 前端需要看原图时，再按 id 调详情接口单独取。
 */
export interface SubmitRecordSummary {
  id: string;
  studentName: string;
  submitTime: string;
  questionList: BigQuestionData[];
  isReviewed: boolean;
  teacherComment: string;
  /** 原图数量，前端据此渲染占位 */
  imgCount: number;
}

/** 判断对象是否为合法的提交记录 */
export function isSubmitRecord(value: unknown): value is SubmitRecord {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.studentName === 'string' &&
    Array.isArray(v.questionList)
  );
}

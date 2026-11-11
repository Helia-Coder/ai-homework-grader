import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { SubmitRecord, SubmitRecordSummary } from './types';

/**
 * 提交记录存储层。
 *
 * 设计要点：
 * 1. **文件持久化**：数据落在 `.data/submit-records.json`，重启服务不丢。
 *    课程演示场景下够用，且不引入数据库依赖。
 * 2. **写操作串行化**：多个请求同时写同一个文件会互相覆盖，
 *    这里用一条 Promise 链把所有写操作排队，保证最终一致。
 * 3. **列表不含原图**：原图 base64 占单条记录的 99%，
 *    列表接口剥离后只返回 imgCount，详情按需单独取。
 */

const DATA_DIR = path.join(process.cwd(), '.data');
const DATA_FILE = path.join(DATA_DIR, 'submit-records.json');

/** 内存缓存，避免每次请求都读盘 */
let cache: SubmitRecord[] | null = null;
/** 写队列，保证写操作串行执行 */
let writeChain: Promise<unknown> = Promise.resolve();

/** 读取全部记录（带内存缓存） */
async function readAll(): Promise<SubmitRecord[]> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    cache = Array.isArray(parsed) ? (parsed as SubmitRecord[]) : [];
  } catch {
    // 文件不存在或内容损坏时，从空列表开始，不影响服务可用性
    cache = [];
  }
  return cache;
}

/** 写回磁盘。使用临时文件 + rename，保证不会写出半截文件 */
async function writeAll(records: SubmitRecord[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmpFile = `${DATA_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmpFile, JSON.stringify(records, null, 2), 'utf-8');
  await fs.rename(tmpFile, DATA_FILE);
}

/**
 * 把写操作排进串行队列。
 *
 * 直接并发写同一个文件会导致后写覆盖先写，
 * 这里保证任意时刻只有一个写操作在进行。
 */
function enqueueWrite(mutator: (records: SubmitRecord[]) => SubmitRecord[]): Promise<void> {
  const task = writeChain.then(async () => {
    const records = await readAll();
    const next = mutator(records);
    await writeAll(next);
    cache = next;
  });
  // 单个写失败不能阻断后续写，用 catch 兜住
  writeChain = task.catch(() => undefined);
  return task;
}

/** 剥离原图，生成列表用的精简记录 */
export function toSummary(record: SubmitRecord): SubmitRecordSummary {
  const { imgList, ...rest } = record;
  return { ...rest, imgCount: imgList?.length ?? 0 };
}

/** 获取全部记录（含原图），供详情查询使用 */
export async function getRecords(): Promise<SubmitRecord[]> {
  return readAll();
}

/** 获取列表用的精简记录 */
export async function getRecordSummaries(): Promise<SubmitRecordSummary[]> {
  const records = await readAll();
  return records.map(toSummary);
}

/** 按 id 获取单条记录 */
export async function getRecordById(id: string): Promise<SubmitRecord | undefined> {
  const records = await readAll();
  return records.find((r) => r.id === id);
}

/** 新增一条记录，返回带 id 的完整记录 */
export async function addRecord(
  record: Omit<SubmitRecord, 'id'> & { id?: string }
): Promise<SubmitRecord> {
  const created: SubmitRecord = {
    ...record,
    id: record.id ?? `rec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
  };
  await enqueueWrite((records) => [...records, created]);
  return created;
}

/** 按 id 更新记录，返回更新后的记录；找不到返回 undefined */
export async function updateRecord(
  id: string,
  patch: Partial<Pick<SubmitRecord, 'questionList' | 'teacherComment' | 'isReviewed'>>
): Promise<SubmitRecord | undefined> {
  let updated: SubmitRecord | undefined;
  await enqueueWrite((records) => {
    updated = records.find((r) => r.id === id);
    if (!updated) return records;
    updated = { ...updated, ...patch };
    return records.map((r) => (r.id === id ? updated! : r));
  });
  return updated;
}

/** 按 id 删除记录 */
export async function deleteRecord(id: string): Promise<boolean> {
  let removed = false;
  await enqueueWrite((records) => {
    const next = records.filter((r) => r.id !== id);
    removed = next.length !== records.length;
    return next;
  });
  return removed;
}

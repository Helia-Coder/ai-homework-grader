import { jwtVerify, type JWTPayload } from 'jose';
import { NextResponse } from 'next/server';

/**
 * 统一鉴权工具。
 *
 * 登录接口签发 Token，业务接口校验 Token，全部收敛到这里，
 * 避免每个路由各写一套解析逻辑（容易漏校验、算法不一致）。
 *
 * 角色目前存的是字符串（数据库 User.role），这里统一收窄为两种。
 */
export type Role = 'student' | 'teacher';

export const AUTH_COOKIE = 'auth_token';
export const AUTH_HEADER = 'authorization';

/** Token 里承载的身份信息 */
export interface AuthUser {
  id: string;
  role: Role;
  name: string;
}

/** 开发期兜底密钥。生产环境必须配置 JWT_SECRET，否则拒绝启动鉴权。 */
const DEV_FALLBACK_SECRET = 'dev-only-insecure-secret';

/** 统一解析签名密钥：生产环境强制要求环境变量。 */
export function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('生产环境必须配置环境变量 JWT_SECRET');
  }
  return new TextEncoder().encode(secret || DEV_FALLBACK_SECRET);
}

/**
 * 从请求里取出 Token。
 * 优先读 HttpOnly Cookie（浏览器自动携带），兼容 Authorization: Bearer（便于脚本/测试）。
 */
export function readToken(req: Request): string | null {
  const authHeader = req.headers.get(AUTH_HEADER);
  if (authHeader?.toLowerCase().startsWith('bearer ')) {
    const t = authHeader.slice(7).trim();
    if (t) return t;
  }
  const cookie = req.headers.get('cookie') || '';
  for (const part of cookie.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === AUTH_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/**
 * 校验请求身份。签名、有效期、字段结构全部检查。
 * 校验失败返回 null，调用方据此返回 401。
 */
export async function verifyToken(req: Request): Promise<AuthUser | null> {
  const token = readToken(req);
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    return toAuthUser(payload);
  } catch {
    // 签名错误 / 已过期 / 算法不符 —— 一律视为未登录
    return null;
  }
}

/** 把 jose 的 payload 收敛成 AuthUser，结构不合法直接判空 */
function toAuthUser(payload: JWTPayload): AuthUser | null {
  const { id, role, name } = payload;
  if (
    typeof id !== 'string' ||
    typeof name !== 'string' ||
    (role !== 'student' && role !== 'teacher')
  ) {
    return null;
  }
  return { id, role, name };
}

/**
 * 统一的鉴权失败响应。
 * 注意：错误信息保持笼统，不向前端泄露内部异常细节。
 */
export function unauthorized(): NextResponse {
  return NextResponse.json({ error: '未登录或登录已过期，请重新登录' }, { status: 401 });
}

export function forbidden(): NextResponse {
  return NextResponse.json({ error: '无权执行此操作' }, { status: 403 });
}

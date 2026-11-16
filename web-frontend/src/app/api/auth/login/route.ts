import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { SignJWT } from 'jose';

const prisma = new PrismaClient();

// 签名密钥一律走环境变量（模板见 .env.example）。
// 开发期保留兜底值以便本地直接启动；生产环境缺失配置时直接拒绝签发，
// 避免用写在源码里的默认值签发可被伪造的 Token。
const DEV_FALLBACK_SECRET = 'dev-only-insecure-secret';
function resolveJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('生产环境必须配置环境变量 JWT_SECRET');
  }
  return new TextEncoder().encode(secret || DEV_FALLBACK_SECRET);
}

export async function POST(req: Request) {
  try {
    const JWT_SECRET = resolveJwtSecret();
    const { username, password } = await req.json();

    if (!username || !password) {
      return NextResponse.json({ error: '请填写账号和密码' }, { status: 400 });
    }

    // 👇 真正去数据库查用户
    const user = await prisma.user.findUnique({ where: { username } });

    if (!user) {
      return NextResponse.json({ error: '找不到该用户' }, { status: 401 });
    }

    // 👇 直接比对明文密码，绕开哈希的坑！
    if (user.password !== password) {
      return NextResponse.json({ error: '密码错误' }, { status: 401 });
    }

    // 生成 Token，把数据库里的 user.id 传进去
    const token = await new SignJWT({ id: user.id, role: user.role, name: user.name })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1d')
      .sign(JWT_SECRET);

    const response = NextResponse.json({ success: true, role: user.role, name: user.name });

    response.cookies.set('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24,
      path: '/',
    });

    return response;
  } catch (error: unknown) {
    console.error('登录接口报错:', error);
    const message =
      error instanceof Error ? error.message : '登录失败，请稍后重试';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
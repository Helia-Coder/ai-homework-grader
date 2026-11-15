import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { SignJWT } from 'jose';

const prisma = new PrismaClient();
const JWT_SECRET = new TextEncoder().encode('your-super-secret-key-change-this-in-production');

export async function POST(req: Request) {
  try {
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
  } catch (error: any) {
    console.error('登录接口报错:', error);
    return NextResponse.json({ error: '数据库连接失败' }, { status: 500 });
  }
}
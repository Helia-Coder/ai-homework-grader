import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { SignJWT } from 'jose';
import bcrypt from 'bcryptjs';
import { AUTH_COOKIE, getJwtSecret, type Role } from '@/lib/auth';

const prisma = new PrismaClient();

/** bcrypt 哈希的典型前缀，用于区分「已哈希」与「历史明文」 */
function isBcryptHash(value: string): boolean {
  return /^\$2[aby]\$\d{2}\$/.test(value);
}

export async function POST(req: Request) {
  try {
    const { username, password } = await req.json();

    if (!username || !password) {
      return NextResponse.json({ error: '请填写账号和密码' }, { status: 400 });
    }

    // 真正去数据库查用户
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      // 账号与密码错误使用同一句话，避免枚举用户名
      return NextResponse.json({ error: '账号或密码错误' }, { status: 401 });
    }

    const stored = user.password as string;
    let passwordOk = false;

    if (isBcryptHash(stored)) {
      // 新数据：bcrypt 比对
      passwordOk = await bcrypt.compare(password, stored);
    } else {
      // 兼容历史明文：比对成功后即时升级为 bcrypt 哈希并写回，
      // 实现「无感知平滑迁移」，运维无需一次性清洗全部数据。
      passwordOk = stored === password;
      if (passwordOk) {
        const hashed = await bcrypt.hash(password, 10);
        await prisma.user.update({
          where: { id: user.id },
          data: { password: hashed },
        });
      }
    }

    if (!passwordOk) {
      return NextResponse.json({ error: '账号或密码错误' }, { status: 401 });
    }

    const role = user.role as Role;
    const token = await new SignJWT({ id: user.id, role, name: user.name })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1d')
      .sign(getJwtSecret());

    const response = NextResponse.json({
      success: true,
      role: user.role,
      name: user.name,
    });

    response.cookies.set(AUTH_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24,
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('登录接口报错:', error);
    // 不回传内部错误细节（可能含数据库信息），只给笼统提示
    return NextResponse.json({ error: '登录失败，请稍后重试' }, { status: 500 });
  }
}

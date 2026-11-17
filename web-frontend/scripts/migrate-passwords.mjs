/**
 * 存量明文密码 → bcrypt 哈希 一次性迁移脚本
 *
 * 用途：项目历史上把用户密码以明文存进 User.password。登录接口已改为
 *       「登录成功即自动升级」，本脚本用于运维主动一次性清洗全部存量数据，
 *       避免明文长期滞留数据库。两者可以并存，互不影响。
 *
 * 运行前置：
 *   1. 在 web-frontend 目录确保 .env.local 中 DATABASE_URL 可用
 *   2. 已执行 prisma generate（node_modules/@prisma/client 可用）
 *
 * 用法（在 web-frontend 目录下）：
 *   node scripts/migrate-passwords.mjs --dry-run   # 预览将要迁移的账号，不写库
 *   node scripts/migrate-passwords.mjs             # 实际执行迁移
 *
 * 安全说明：
 *   - 只会处理「非 bcrypt 格式」的密码，已哈希的账号会被跳过，可重复执行（幂等）
 *   - 默认 cost=10；数据量大时可调高 COST，但会显著变慢
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const COST = 10;
const BCRYPT_RE = /^\$2[aby]\$\d{2}\$/;
const DRY_RUN = process.argv.includes('--dry-run');

const prisma = new PrismaClient();

function isHashed(value) {
  return typeof value === 'string' && BCRYPT_RE.test(value);
}

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, username: true, password: true },
  });

  const pending = users.filter(
    (u) => typeof u.password === 'string' && u.password.length > 0 && !isHashed(u.password)
  );

  console.log(`共 ${users.length} 个账号，其中 ${pending.length} 个仍是明文密码。`);

  if (DRY_RUN) {
    console.log('[dry-run] 以下账号将被迁移（仅预览，未写库）：');
    pending.forEach((u) => console.log(`  - ${u.username} (id=${u.id})`));
    console.log('[dry-run] 去掉 --dry-run 参数即可实际执行。');
    return;
  }

  let done = 0;
  for (const u of pending) {
    const hashed = await bcrypt.hash(u.password, COST);
    await prisma.user.update({
      where: { id: u.id },
      data: { password: hashed },
    });
    done += 1;
    console.log(`  ✓ 已迁移 ${u.username}`);
  }
  console.log(`迁移完成，共处理 ${done} 个账号。`);
}

main()
  .catch((err) => {
    console.error('迁移失败：', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

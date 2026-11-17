/**
 * 添加用户（学生 / 教师）脚本
 *
 * 直接把用户写进当前配置的数据库（与 Web 应用同一个库），
 * 密码用 bcrypt 哈希存储，添加后即可直接登录，无需等首次登录自动升级。
 *
 * 运行前置（在 web-frontend 目录下）：
 *   - 确保 prisma/.env 的 DATABASE_URL 指向正确的库（与 .env.local 一致）
 *   - 已执行过 npx prisma generate（node_modules/@prisma/client 可用）
 *
 * ── 三种用法 ──────────────────────────────────────────────
 *
 * 1) 交互式（最省事，跟着提示填即可）：
 *      node scripts/add-user.mjs
 *
 * 2) 命令行参数（加单个人）：
 *      node scripts/add-user.mjs --username student3 --name 王五 --role student --password 123456
 *
 * 3) 批量（一次加整个班，见 users.example.json 格式）：
 *      node scripts/add-user.mjs --file scripts/users.json
 *
 * 说明：
 *   - username 登录账号（学号/工号），唯一，重复会被跳过
 *   - name     真实姓名 —— 学生端展示的姓名就是它，务必填对
 *   - role     student 或 teacher（默认 student）
 *   - password 初始密码
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import fs from 'node:fs';

const prisma = new PrismaClient();
const COST = 10;
const VALID_ROLES = ['student', 'teacher'];

/** 解析 --key value 形式的命令行参数 */
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw.startsWith('--')) continue;
    const key = raw.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

async function prompt(rl, label, defaultValue = '') {
  const suffix = defaultValue ? `（默认 ${defaultValue}）` : '';
  const answer = (await rl.question(`${label}${suffix}: `)).trim();
  return answer || defaultValue;
}

function normalizeRole(value) {
  const role = String(value || '').trim().toLowerCase();
  if (!VALID_ROLES.includes(role)) {
    throw new Error(`角色 role 必须是 ${VALID_ROLES.join(' / ')}，收到：${value}`);
  }
  return role;
}

/** 创建单个用户；已存在则跳过（幂等，可重复运行） */
async function createUser({ username, name, role, password }) {
  username = String(username || '').trim();
  name = String(name || '').trim();
  role = normalizeRole(role);
  password = String(password || '');

  if (!username) throw new Error('缺少 username（登录账号）');
  if (!name) throw new Error('缺少 name（真实姓名）');
  if (!password) throw new Error('缺少 password（初始密码）');

  const exists = await prisma.user.findUnique({ where: { username } });
  if (exists) {
    return { status: 'skip', username, reason: `账号 ${username} 已存在（姓名：${exists.name}）` };
  }

  const hashed = await bcrypt.hash(password, COST);
  await prisma.user.create({
    data: { username, name, role, password: hashed },
  });
  return { status: 'ok', username, name, role };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let rl;

  try {
    // ── 批量模式 ──
    if (args.file) {
      const list = JSON.parse(fs.readFileSync(args.file, 'utf8'));
      if (!Array.isArray(list)) throw new Error('批量文件必须是一个 JSON 数组');
      let ok = 0, skip = 0, fail = 0;
      for (const item of list) {
        try {
          const r = await createUser(item);
          if (r.status === 'ok') {
            ok++;
            console.log(`  ✓ 已添加 ${r.username}（${r.name} / ${r.role}）`);
          } else {
            skip++;
            console.log(`  - 跳过 ${r.username}：${r.reason}`);
          }
        } catch (e) {
          fail++;
          console.log(`  ✗ 失败 ${item.username || '?'}：${e.message}`);
        }
      }
      console.log(`\n批量完成：成功 ${ok}，跳过 ${skip}，失败 ${fail}。`);
      return;
    }

    // ── 单个模式：参数不全则进入交互式 ──
    const needsInteractive = !args.username || !args.name || !args.password || !args.role;
    if (needsInteractive) {
      rl = readline.createInterface({ input, output });
      console.log('=== 添加用户 ===');
      console.log('提示：直接回车可沿用默认值。\n');
    }

    const username = args.username || (await prompt(rl, '登录账号 username（学号/工号）'));
    const name = args.name || (await prompt(rl, '真实姓名 name（学生端将显示此姓名）'));
    const role = args.role || (await prompt(rl, '角色 role（student / teacher）', 'student'));
    const password = args.password || (await prompt(rl, '初始密码 password'));

    const r = await createUser({ username, name, role, password });
    if (r.status === 'skip') {
      console.log(`\n未添加：${r.reason}。`);
    } else {
      console.log('\n✓ 添加成功：');
      console.log(`  登录账号：${r.username}`);
      console.log(`  姓名：${r.name}`);
      console.log(`  角色：${r.role}`);
      console.log('  密码已加密存储，可直接登录。');
    }
  } catch (err) {
    console.error('\n添加失败：', err.message);
    process.exitCode = 1;
  } finally {
    if (rl) rl.close();
    await prisma.$disconnect();
  }
}

main();

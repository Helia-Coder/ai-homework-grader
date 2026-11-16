# web-frontend · Next.js 应用主体

本目录是「智阅 · AI 智能作业批改与学情分析系统」的前端 + 服务端接口实现（Next.js 16 App Router）。

> **完整的项目介绍、技术架构、安装运行指南、环境变量说明与团队信息，请见仓库根目录的 [`../README.md`](../README.md)。**
> 技术文档、演示视频脚本与提交材料自查位于 [`../docs/`](../docs/)。

## 本目录速查

```bash
cd web-frontend
npm install
cp .env.example .env.local   # 填入真实配置，切勿提交
npx prisma generate && npx prisma db push
npm run dev                  # http://localhost:3000
```

| 路径 | 作用 |
|---|---|
| `src/app/page.tsx` | 登录页、教师学情看板、学生提交与批改详情（单页多角色） |
| `src/app/api/auth/login/` | 账号校验与 JWT 签发 |
| `src/app/api/grade/` | 多模态识别 + 结构化批改 + 算分校准 |
| `src/app/api/evaluate/` | 规则检索 + SSE 流式讲评 |
| `src/app/api/submitRecord/` | 提交记录的增删改查 |
| `src/lib/dashscope.ts` | 上游模型统一封装（超时 / 重试 / 错误信息） |
| `src/lib/mathTool.ts` | 原生算分工具，拦截模型分数幻觉 |
| `src/lib/rules.json` | 本地评分细则知识库 |
| `prisma/schema.prisma` | MySQL 数据模型 |

`AGENTS.md` 为 Next.js 16 自动生成的开发约定文件，请勿手动删除，否则 `next dev` 会重新生成造成未提交改动。

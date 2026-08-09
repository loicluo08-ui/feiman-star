# 费曼星

Next.js 14 + TypeScript + Tailwind CSS 的 AI 工具站，当前包含：

- Supabase 邮箱+密码注册/登录，JWT 只保存在 HTTP-only Cookie
- Free / Lite / Pro / VIP 套餐、兑换码与 AI 调用额度
- 教培客服话术、高转化商品文案与通用 AI 对话
- 用户私有知识库：TXT / Markdown / PDF 上传、智谱 embedding-2、Supabase pgvector 检索

浏览器只调用本站 API Routes。DeepSeek、智谱、Supabase service role 和管理员密钥均只在服务端使用。

## 环境变量

复制 `.env.example` 为 `.env.local`，填写：

```bash
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_BASE_URL=https://api.deepseek.com

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

ADMIN_TOKEN=
ZHIPU_API_KEY=
ZHIPU_BASE_URL=https://open.bigmodel.cn/api/paas/v4
```

不要提交 `.env.local`。生产环境变量应在 Vercel 项目设置中填写。

## Supabase 初始化

按文件名顺序在 Supabase SQL Editor 执行：

1. `supabase/migrations/202608090001_billing.sql`
2. `supabase/migrations/202608090002_rag.sql`

第二个迁移会启用 `pgcrypto` 和 `vector` 扩展，并创建用户隔离的知识库表与相似度检索函数。当前邮箱确认已开启，注册用户需先点击确认邮件再登录；手机号登录代码保留，后续配置短信供应商后再开放入口。

## 本地运行

```bash
yarn install
yarn dev
```

打开 `http://localhost:3000`。登录后可访问 `/tools`、`/chat`、`/knowledge` 和 `/redeem`。

## 管理员生成兑换码

请求头使用 `Authorization: Bearer <ADMIN_TOKEN>`：

```bash
curl -X POST http://localhost:3000/api/admin/generate-codes \
  -H 'Authorization: Bearer <ADMIN_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"plan":"pro","count":10}'
```

## 验证

```bash
npm run typecheck
npm run lint
npm run build
```

知识库限制：单文件 5MB，仅支持 TXT、Markdown、PDF，每位用户最多 10 个文档；分片目标 500 字、重叠 100 字，检索 top 5 且余弦相似度不低于 0.7。

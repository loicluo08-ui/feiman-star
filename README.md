# 费曼星 P0

Next.js 14 + TypeScript + Tailwind CSS 的两工具闭环，当前包含：

- `/`：两个 P0 工具入口
- `/tools/script-generator`：教培客服话术生成器表单
- `/tools/product-copy`：高转化商品文案表单

两个表单均通过本站 API Routes 以 blocking 模式调用 DeepSeek，服务端完成输入与模型 JSON 输出校验后再整体返回。API Key 不会下发浏览器。

当前不包含 Dify、登录、额度、审核、计费或知识库。

## 环境变量

复制 `.env.example` 为 `.env.local`，填写：

```bash
DEEPSEEK_API_KEY=你的服务端密钥
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

不要提交 `.env.local`。

## 本地运行

```bash
yarn install
yarn dev
```

## 验证

```bash
npm run typecheck
npm run lint
npm run build
```

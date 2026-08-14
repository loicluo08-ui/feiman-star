# 费曼星 · 美股投资分析工具

AI驱动的美股选股、复盘、对话工具。免费使用，无需登录。

## 功能

- **AI选股**：输入美股代码，自动拉取Yahoo Finance实时行情+24个财务指标，AI生成6维度分析报告
- **交易复盘**：输入交易记录，AI做归因分析（盈亏来源/策略评估/行为偏差/改进建议），历史记录本地保存
- **自选看板**：多股票实时监控，迷你走势图，异动高亮，30秒自动刷新

## 技术栈

- Next.js 14 + TypeScript + Tailwind CSS
- Finnhub（实时行情）+ Yahoo Finance（K线）
- DeepSeek API（AI分析）

## 环境变量

```bash
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

## 本地运行

```bash
yarn install
yarn dev
```

打开 http://localhost:3000

## 声明

实时行情来自Finnhub，K线数据来自Yahoo Finance。所有数据和分析由AI生成，仅供研究参考，不构成任何投资建议。

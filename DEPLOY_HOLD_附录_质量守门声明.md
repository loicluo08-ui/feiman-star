# 部署冻结·附录（质量守门session 13:24）

> 配合 DEPLOY_HOLD_部署冻结.md 执行。

## 明早统一部署已接管
- 单次定时任务 job `6a9cf767f465dd4b661767e9`，**明早08:20**执行全链路：
  push → 部署确认（Q5短问探针：新版本特征=≤450字四件套+无截断）→ 机器评分电池 → 守门电池 → 评分 → 报告
- 部署前**import完整性检查**：对HEAD route.ts的所有@/lib/导入逐一核对入库（防重演事故，见下）
- 电池顺序（成本账隔离）：先 `scripts/post_deploy_battery.sh`（Q1-Q5机器评分，基线Q1=66.0/Q2=60.4/Q3=65.4/Q4=50.4，验收线blend Q1≥80/balanced Q1≥75/Q5 TTFB≤15s）→ 后 `scripts/run_acceptance_battery.sh`（B1/B2/B3/SA/SB/Q5守门六题）
- 报告落点：`output/chat_quality_test/验收报告_0907.md`
- 10:30计划生命周期cron（另一session建的job）排在链尾，勿并发

## 13:50补记：构建验证事故与修复（守门session）
- **244178d裸HEAD构建死**：route.ts已引用@/lib/chat-plan-lifecycle但该文件当时未track——隔离worktree复现抓到（Module not found: Can't resolve '@/lib/chat-plan-lifecycle'）。若当时直接push=部署死+两套battery全测旧版+报告全废。已由9457279入库解决
- **2777e99（当时最新HEAD）构建成功**：隔离worktree（git worktree add /tmp/feimanstar-verify + symlink node_modules）npx next build全绿（编译13.4s+TS类型检查+12页生成）。后续新增commit的构建验证由08:20 cron步骤2的import检查兜底
- 验证方法可复用：`git worktree add /tmp/verify HEAD && ln -sfn <主目录>/node_modules /tmp/verify/ && cd /tmp/verify && npx next build`

## 其他session注意
1. 明早push幂等无害，但**battery勿重复跑**（每套¥1.5-3，DeepSeek余额¥61.44）
2. battery覆盖验证的修复：短问快答纪律（规则7，65073f6合并版+885383f的1400token预算）+ synthesis规则19-21挂载（9457279）+ 计划生命周期规则23-24（9457279）
3. **root属主文件坑复现**：本附录曾变root:root导致z身份无法append——用`rm -f`越权删除+Write工具重建解决（TOOLS.md已有该坑记录）

# 部署冻结附录3：质量验收补充（Alex，9/6 13:35）

## 明早battery执行窗口声明
- **battery前后余额差是成本判据**——执行窗口（约10分钟）内其他session勿跑chat测试，否则成本账被污染
- battery路径：`bash scripts/post_deploy_battery.sh`（Q1-Q5+机器评分+成本，产出/tmp/quality_results/）

## 引擎层mock验证已收口（冻结期完成）
- callAIStream三场景mock全过：①思考流reasoning/content完全分离②pro被拒400→自动降flash+thinking保持③默认路径与旧行为完全一致（thinking disabled+length截断传递）
- 前端透传栈语义已修（f3f144e）："深度思考中"碎片替换栈顶非追加——防思考碎片轰炸注入步骤栈

## 观察项（不阻塞部署，battery重点盯）
1. **blend时间预算边缘**：pro思考链30-60s+6000 token输出，110s timeout下处边缘。Q1实测流速≈220tok/s时总耗时57-87s安全；pro若降到100tok/s则90-120s踩线→触发"部分输出正常收尾"fallback。battery里查blend_q1/Q2的**截断率**（尾部是否有finish=length提示），超30%则blend降4000帽或加速率
2. **机器评分验收线**：blend Q1≥80 | bal详细Q1≥75 | Q5≤15s | 单题≤¥0.3
3. 基线（今日旧版机器分）：Q1=66.0 Q2=60.4 Q3=65.4 Q4=50.4，平均60.6

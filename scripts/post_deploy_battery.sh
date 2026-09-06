#!/bin/bash
# 明日部署后一键质量验证（9/6冻结令配套——限额重置统一部署完成后跑）
# 用法: bash scripts/post_deploy_battery.sh
# 产出: /tmp/quality_results/ 下5题完整采集+基线对照
#
# 验证目标（对照QUALITY_RUBRIC.md）：
# 1. 新引擎分层生效：详细类问题status行出现"深度推理中"（thinking启用信号）
# 2. blend旗舰：status行"大师圆桌深度思考中"+首字符必须是【（567239e硬约束）
# 3. 思维链透传：等待期status出现"深度思考中…"滚动
# 4. 质量对比基线（9/6 12:50旧版）：Q1 2495字/7分，Q2 1568字/10分
# 5. 成本：余额前后差
set -u
OUT=/tmp/quality_results
mkdir -p $OUT
BASE="https://sufve.com/api/invest/chat"
Q1="全面分析英伟达（NVDA）：按五维度框架逐项拆解，多空论据都要给，最后给仓位策略建议"
Q2="我持有50股英伟达正股，成本210。想用备兑开仓增强收益，行权价和到期日怎么选？帮我挑这个方案最强的漏洞"
Q3="我看多英伟达长期，逻辑是AI算力需求不可逆。挑战我这个持仓逻辑，找最强的反方论据"
Q5="苹果现在什么情况"

echo "=== 0. 余额与版本探测 ==="
curl -s "https://sufve.com/api/invest/balance-check?token=1825f61b2a0c6ee92adf4b0511db6e41" --max-time 10 | python3 -c "import json,sys; d=json.load(sys.stdin); print('余额:', d.get('balance'))"

run_q() { # $1=标签 $2=问题 $3=风格 $4=超时
  local tag=$1 q=$2 style=$3 tmo=$4
  local start=$(date +%s)
  curl -sN --max-time $tmo -X POST "$BASE" -H "Content-Type: application/json" \
    -d "{\"messages\":[{\"role\":\"user\",\"content\":{\"type\":\"text\",\"text\":\"$q\"}}],\"style\":\"$style\"}" \
    -o "$OUT/${tag}_raw.txt" 2>/dev/null
  local end=$(date +%s)
  python3 - "$tag" "$((end-start))" "$OUT" << 'PYEOF'
import json, sys
tag, elapsed, out = sys.argv[1], sys.argv[2], sys.argv[3]
statuses, text, nchunk, ping_n = [], "", 0, 0
for line in open(f"{out}/{tag}_raw.txt"):
    line = line.strip()
    if not line: continue
    try: e = json.loads(line)
    except: continue
    t = e.get("type")
    if t == "status": statuses.append(e["text"])
    elif t == "chunk": text += e["text"]; nchunk += 1
    elif t == "ping": ping_n += 1
print(f"[{tag}] 耗时{elapsed}s | {nchunk} chunks | {len(text)}字 | ping×{ping_n}")
for s in statuses: print(f"  STATUS: {s}")
print(f"  首字符: {text[:1]!r} | 结尾120字: {text[-120:]!r}")
open(f"{out}/{tag}_text.txt", "w").write(text)
PYEOF
}

echo; echo "=== 1. blend旗舰 Q1（大师圆桌+pro+thinking） ==="
run_q "blend_q1" "$Q1" "blend" 115

echo; echo "=== 2. blend旗舰 Q2（期权+对抗，期权链注入+pro） ==="
run_q "blend_q2" "$Q2" "blend" 115

echo; echo "=== 3. balanced详细 Q1（flash+thinking引擎分层验证） ==="
run_q "bal_q1" "$Q1" "balanced" 115

echo; echo "=== 4. balanced短问 Q5（快路径回归：不能变慢） ==="
run_q "bal_q5" "$Q5" "balanced" 60

echo; echo "=== 5. 机器评分（eval_chat_quality五维） ==="
for tag in blend_q1 blend_q2 bal_q1; do
  python3 -c "
import json
text = open('$OUT/${tag}_text.txt').read()
q = {'blend_q1':'$Q1','blend_q2':'$Q2','bal_q1':'$Q1'}.get('$tag','$Q1')
json.dump({'question': q, 'full': text}, open('$OUT/${tag}_eval.json','w'), ensure_ascii=False)
" && python3 "$(dirname "$0")/eval_chat_quality.py" "$OUT/${tag}_eval.json" 2>/dev/null | tail -9
done

echo; echo "=== 6. 成本核算 ==="
curl -s "https://sufve.com/api/invest/balance-check?token=1825f61b2a0c6ee92adf4b0511db6e41" --max-time 10 | python3 -c "import json,sys; print('余额:', json.load(sys.stdin).get('balance'))"
echo "对照基线（9/6 12:50旧版flash无思考）：Q1机器评分66/100 | Q1 2495字/17s | Q2 1568字/11s | 5题成本¥0.43"
echo "验收线：blend Q1≥80/100 | bal详细Q1≥75/100 | Q5短问≤15s不退化"
echo; echo "全部采集完成: $OUT/"

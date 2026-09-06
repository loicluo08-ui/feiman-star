#!/bin/bash
# 大师融合(blend)落地验收电池 —— 9/6质量守门session
# 独立于builder的验收（交叉验证纪律：重要结论两个独立来源）
# 用法: run_acceptance_battery.sh [base_url]
# 输出: output/chat_quality_test/battery_<ts>/ 目录（逐题全文+TTFB+成本）

BASE="${1:-https://sufve.com}"
OUT="output/chat_quality_test/battery_$(date +%H%M%S)"
mkdir -p "$OUT"
BAL_TOKEN="1825f61b2a0c6ee92adf4b0511db6e41"

balance() {
  curl -s --max-time 15 "$BASE/api/invest/balance-check?token=$BAL_TOKEN" | jq -r '.balance // "ERR"' 2>/dev/null
}

run_test() {
  local name="$1" style="$2" question="$3"
  local b0=$(balance)
  local start=$(date +%s%3N)
  bash scripts/test_chat_quality.sh "$question" "$style" > "$OUT/${name}.txt" 2>&1
  local end=$(date +%s%3N)
  local b1=$(balance)
  {
    echo "name=$name style=$style"
    echo "ttfb_ms=见STATUS首行; total_ms=$((end-start))"
    echo "balance_before=$b0 balance_after=$b1 cost=$(echo "$b0 $b1" | awk '{printf "%.3f", $1-$2}')"
    echo "chars=$(wc -c < "$OUT/${name}.txt")"
  } > "$OUT/${name}.meta"
  echo "[$name] done, cost=$(echo "$b0 $b1" | awk '{printf "%.3f", $1-$2}') total_ms=$((end-start)) chars=$(wc -c < "$OUT/${name}.txt")"
}

echo "=== blend验收电池 $(date) ==="
echo "base=$BASE out=$OUT"
echo "balance_start=$(balance)"
echo ""

# B1 融合完整性：$5万NVDA决策（验收测试集7项判据）
run_test "B1_blend_nvda" "blend" "深度分析英伟达：现在这个位置还能买吗？我准备投5万美元，给我一个完整的分析与计划"

# B2 计划触发检测：纯认知问题不应出行动计划
run_test "B2_blend_cognition" "blend" "从第一性原理看AI芯片行业的终局是什么"

# B3 balanced对照（融合判断力无显式分区）
run_test "B3_balanced_nvda" "balanced" "深度分析英伟达：现在这个位置还能买吗？我准备投5万美元，给我一个完整的分析与计划"

# 短板A复验：用户假前提（周日休市+虚构板块跌幅）必须被纠错
run_test "SA_premise_guard" "balanced" "昨天半导体板块大跌3%，我的英伟达浮盈被吃了不少，该不该先跑一部分？"

# 短板B复验：期权IV纪律（有CBOE注入后IV必须引真实链数据）
run_test "SB_option_iv" "balanced" "我持有50股英伟达正股，成本210。想用备兑开仓增强收益，行权价和到期日怎么选？帮我挑这个方案最强的漏洞"

# Q5 短问回归：不能因深度模式把短问变慢
run_test "Q5_short" "balanced" "苹果现在什么情况"

echo ""
echo "balance_end=$(balance)"
echo "=== 电池完成，评分看 $OUT ==="

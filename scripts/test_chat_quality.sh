#!/bin/bash
# 投资对话质量基线测试：打live，采集TTFB+全文+结构标记
# 用法: test_chat_quality.sh "问题" [style]
Q="$1"
STYLE="${2:-balanced}"
START=$(date +%s%3N)
TTFB=0
FULL=""
curl -sN --max-time 115 -X POST https://sufve.com/api/invest/chat \
  -H "Content-Type: application/json" \
  -d "{\"messages\":[{\"role\":\"user\",\"content\":{\"type\":\"text\",\"text\":\"$Q\"}}],\"style\":\"$STYLE\"}" | \
while IFS= read -r line; do
  [ -z "$line" ] && continue
  NOW=$(date +%s%3N)
  echo "$line" | jq -r 'if .type == "status" then "STATUS: \(.text)" 
    elif .type == "chunk" then .text 
    elif .type == "patch" then "\n===PATCH===\n\(.text)" 
    elif .type == "error" then "ERROR: \(.message)" 
    elif .type == "done" then "===DONE===" 
    elif .type == "ping" then "" 
    else .type end' 2>/dev/null
done

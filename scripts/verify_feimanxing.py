#!/usr/bin/env python3
"""费曼星发布前验证脚本
用法: python3 scripts/verify_feimanxing.py
"""

import requests
import time
import re
import sys
from datetime import datetime

BASE = "https://feiman-star.vercel.app"
PASS = "\033[92m✅\033[0m"
FAIL = "\033[91m❌\033[0m"
WARN = "\033[93m⚠️\033[0m"

results = []

def check(name, ok, detail=""):
    status = PASS if ok else FAIL
    results.append(ok)
    print(f"  {status} {name}" + (f" — {detail}" if detail else ""))

def is_english_dominant(text):
    if not text or len(text) < 10:
        return False
    chinese = len(re.findall(r'[\u4e00-\u9fff]', text))
    letters = len(re.findall(r'[a-zA-Z]', text))
    return chinese / max(len(text), 1) < 0.15 and letters > 50

print("=" * 60)
print("费曼星发布前验证")
print(f"时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
print("=" * 60)

# ── 1. API可用性 ──
print("\n[1] API可用性")
try:
    r = requests.get(f"{BASE}/api/invest/flash", timeout=15)
    check("API返回200", r.status_code == 200, f"status={r.status_code}")
    data = r.json()
except Exception as e:
    check("API可用", False, str(e))
    sys.exit(1)

items = data.get("data", [])
check("返回≥10条", len(items) >= 10, f"实际{len(items)}条")
check("source字段存在", bool(data.get("source")), data.get("source", "?"))

# ── 2. 内容验证 ──
print("\n[2] 内容验证（用户视角）")

english_count = 0
empty_count = 0
spam_count = 0
for item in items:
    content = item.get("content_text", "")
    if is_english_dominant(content):
        english_count += 1
    if not content or len(content) < 8:
        empty_count += 1
    if re.search(r'扫码|加微信|进群|限时优惠', content):
        spam_count += 1

check("无英文主导条目", english_count == 0, f"发现{english_count}条英文")
check("无空内容", empty_count == 0, f"发现{empty_count}条空")
check("无广告垃圾", spam_count == 0, f"发现{spam_count}条垃圾")

# ── 3. 时间验证 ──
print("\n[3] 时间验证")
now = time.time()
if items:
    latest_ts = items[0].get("timestamp", 0)
    delay_min = (now - latest_ts) / 60
    
    check("最新快讯≤5分钟", delay_min <= 5, f"延迟{delay_min:.1f}分钟")
    check("最新快讯≤10分钟", delay_min <= 10, f"延迟{delay_min:.1f}分钟")
    
    # 检查排序
    timestamps = [i.get("timestamp", 0) for i in items]
    is_sorted = all(timestamps[j] >= timestamps[j+1] for j in range(len(timestamps)-1))
    check("按时间降序", is_sorted)
    
    # 检查时间标签合理性
    time_str = items[0].get("time_str", "")
    check("时间标签非空", bool(time_str), time_str)

# ── 4. 去重验证 ──
print("\n[4] 去重验证")
fingerprints = []
dup_count = 0
for item in items:
    fp = re.sub(r'[\s\W]', '', item.get("content_text", ""))[:20]
    if fp in fingerprints:
        dup_count += 1
    fingerprints.append(fp)
check("无重复条目", dup_count == 0, f"发现{dup_count}条重复")

# ── 5. 重要标记验证 ──
print("\n[5] 重要标记验证")
important_items = [i for i in items if i.get("is_important")]
normal_items = [i for i in items if not i.get("is_important")]
check("有重要标记", len(important_items) > 0, f"{len(important_items)}条重要")
check("有普通标记", len(normal_items) > 0, f"{len(normal_items)}条普通")

# ── 汇总 ──
print("\n" + "=" * 60)
total = len(results)
passed = sum(results)
failed = total - passed
if failed == 0:
    print(f"{PASS} 全部通过 ({passed}/{total})")
else:
    print(f"{FAIL} {passed}/{total}通过, {failed}项失败")
print("=" * 60)

sys.exit(0 if failed == 0 else 1)

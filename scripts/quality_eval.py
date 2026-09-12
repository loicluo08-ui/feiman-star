#!/usr/bin/env python3
"""质量评估自动化（9/6质量专项——冻结期建好，限额重置部署后线上跑）

跑法：python3 scripts/quality_eval.py [--base]  （--base=写基线档，不带=对比基线）
线上环境：https://sufve.com（部署冻结解除后）
判据来源：scripts/QUALITY_RUBRIC.md（Q1-Q5固定题集+7维度评分+硬性合规）

自动评分项（机械可判）：
- 事实锚密度：[数据]/[推导]/[经验]/[模型记忆] 标注计数（≥8处满分）
- 算式数：含×/÷/%的等式计数（≥3处满分）
- 具体性：具体数字/日期引用密度（"XX亿美元/9月X日/PE XX"式）
- 会诊标签：[大师·视角]式标签存在性（融合输出纪律的执行证据）
- 计划六要素：时间框架/仓位结构/触发分支/证伪信号/检查点/失效边界 关键词命中
- 结论连续性标记：【立场变化】显式声明（多轮Q7测）
- 绝对化漏网：永久/必然/肯定/绝对不会出现（crossValidate后仍漏=0分项）
- 长度/延迟记录

人工评分项（打印输出供人工对照Rubric打分）：深度洞察/对抗性质量
"""

import json
import re
import subprocess
import sys
import time
import urllib.request

BASE_URL = "https://sufve.com"
OUT_DIR = "/home/z/my-project/output/quality_eval"
BASELINE_FILE = f"{OUT_DIR}/baseline.json"

QUESTIONS = [
    {"id": "Q1", "style": "balanced", "text": "全面分析英伟达（NVDA）：按五维度框架逐项拆解，多空论据都要给，最后给仓位策略建议"},
    {"id": "Q2", "style": "balanced", "text": "我持有50股英伟达正股，成本210。想用备兑开仓增强收益，行权价和到期日怎么选？帮我挑这个方案最强的漏洞"},
    {"id": "Q3", "style": "balanced", "text": "我看多英伟达长期，逻辑是AI算力需求不可逆。挑战我这个持仓逻辑，找最强的反方论据"},
    {"id": "Q4", "style": "balanced", "text": "现在的美股大盘环境适合加仓吗？"},
    {"id": "Q5", "style": "balanced", "text": "苹果现在什么情况"},
    {"id": "Q6", "style": "blend", "text": "英伟达现在还能持有吗？我成本150，仓位占组合三成，帮我全面分析并给出完整行动计划"},
]


def run_question(q):
    payload = json.dumps({
        "messages": [{"role": "user", "content": {"type": "text", "text": q["text"]}}],
        "style": q["style"],
    }).encode()
    req = urllib.request.Request(
        f"{BASE_URL}/api/invest/chat",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    t0 = time.time()
    text = ""
    first_chunk_at = None
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            for raw_line in resp:
                line = raw_line.decode("utf-8").strip()
                if not line:
                    continue
                try:
                    d = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if d.get("type") == "chunk":
                    if first_chunk_at is None:
                        first_chunk_at = time.time() - t0
                    text += d.get("text", "")
                elif d.get("type") == "error":
                    text += f"\n[ERROR] {d.get('message')}"
    except Exception as e:  # noqa: BLE001
        return {"error": str(e), "text": text}
    total = time.time() - t0
    return {"text": text, "ttfb": first_chunk_at, "total_s": round(total, 1), "len": len(text)}


ANCHOR_RE = re.compile(r"\[(数据|推导|经验|模型记忆|估算)[·\w]*\]")
FORMULA_RE = re.compile(r"[（(][^（）()]{2,30}[）)]|[=\d]\s*[×÷%/]\s*[\d.]+|×\s*\d")
SPECIFIC_RE = re.compile(r"\d+(\.\d+)?\s*(亿美元|美元|亿|万亿|%|倍|元)|\d月\d+日|PE\s?\d|VIX\s?\d")
MASTER_RE = re.compile(r"\[(芒格|巴菲特|利弗莫尔|索罗斯|马斯克|段永平|马克斯|塔勒布|林奇|格雷厄姆)[·・]")
ABS_RE = re.compile(r"永远|必然|肯定会|绝对不会|百分之百")

PLAN_ELEMENTS = {
    "时间框架": r"时间框架|适用周期|短期1-4周|波段1-3月|长期6月",
    "仓位结构": r"目标仓位|仓位结构|分[23]笔|首笔",
    "触发分支": r"触发式操作|条件→|站稳|跌破.*则|若.*跌",
    "证伪信号": r"证伪信号|证伪条件|退出动作",
    "检查点": r"检查点|财报日|届时核验",
    "失效边界": r"失效边界|计划作废|作废重评",
}


def score_answer(text):
    anchors = len(ANCHOR_RE.findall(text))
    formulas = len(FORMULA_RE.findall(text))
    specifics = len(SPECIFIC_RE.findall(text))
    masters = len(MASTER_RE.findall(text))
    plan_hits = {k: bool(re.search(p, text)) for k, p in PLAN_ELEMENTS.items()}
    abs_leaks = len(ABS_RE.findall(text))
    return {
        "anchors": anchors,
        "formulas": formulas,
        "specifics": specifics,
        "master_labels": masters,
        "plan_elements": {k: v for k, v in plan_hits.items()},
        "plan_score": sum(plan_hits.values()),
        "abs_leaks": abs_leaks,
        "has_analysis_header": "【分析思路】" in text,
        "tail_no_questions": "【追问方向】" not in text,
    }


def main():
    is_base = "--base" in sys.argv
    import os
    os.makedirs(OUT_DIR, exist_ok=True)

    results = {}
    for q in QUESTIONS:
        print(f"跑 {q['id']} ({q['style']}): {q['text'][:30]}…", flush=True)
        r = run_question(q)
        r["score"] = score_answer(r.get("text", ""))
        results[q["id"]] = r
        s = r["score"]
        print(f"  长度{r.get('len', 0)}字 TTFB {r.get('ttfb', 'N/A')}s 总{r.get('total_s', 'N/A')}s | 锚{s['anchors']} 算式{s['formulas']} 具体{s['specifics']} 大师标签{s['master_labels']} 计划{s['plan_score']}/6 绝对化漏网{s['abs_leaks']}", flush=True)
        time.sleep(3)

    if is_base:
        with open(BASELINE_FILE, "w") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
        print(f"\n基线已写入 {BASELINE_FILE}")
        return

    # 对比模式
    try:
        with open(BASELINE_FILE) as f:
            base = json.load(f)
    except FileNotFoundError:
        print("无基线档，先跑 --base")
        return

    print("\n=== 前后对比（机械评分项）===")
    for qid, r in results.items():
        b = base.get(qid, {})
        bs, cs = b.get("score", {}), r.get("score", {})
        rows = [
            ("长度", b.get("len", 0), r.get("len", 0)),
            ("事实锚", bs.get("anchors", 0), cs.get("anchors", 0)),
            ("算式", bs.get("formulas", 0), cs.get("formulas", 0)),
            ("具体性", bs.get("specifics", 0), cs.get("specifics", 0)),
            ("大师标签", bs.get("master_labels", 0), cs.get("master_labels", 0)),
            ("计划六要素", bs.get("plan_score", 0), cs.get("plan_score", 0)),
            ("绝对化漏网", bs.get("abs_leaks", 0), cs.get("abs_leaks", 0)),
            ("TTFB(s)", round(b.get("ttfb", 0) or 0, 1), round(r.get("ttfb", 0) or 0, 1)),
        ]
        print(f"\n{qid}:")
        for name, bv, cv in rows:
            delta = ""
            if isinstance(bv, (int, float)) and isinstance(cv, (int, float)):
                d = cv - bv
                delta = f"  {'↑' if d > 0 else ('↓' if d < 0 else '=')}{abs(d)}"
            print(f"  {name}: {bv} → {cv}{delta}")

    out = f"{OUT_DIR}/after_{int(time.time())}.json"
    with open(out, "w") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"\n详细结果已存 {out}（人工评分项：深度洞察/对抗性按QUALITY_RUBRIC.md对照打分）")


if __name__ == "__main__":
    main()

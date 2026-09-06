#!/usr/bin/env python3
"""
费曼星投资对话质量回归测试（9/6质量专项·验证端）

测试问题集=QUALITY_RUBRIC.md固定Q1-Q5（前后对比必须同题，人工评分的自动化辅助）：
- Q1 五维度NVDA分析（结构+深度）
- Q2 备兑期权+挑漏洞（期权链利用+对抗）
- Q3 挑战长期看多逻辑（对抗性）
- Q4 大盘环境（VIX+快讯利用，无标的）
- Q5 苹果短问（回归：短问不因深度模式变慢）

产出：answers/Q*.json（全文+TTFB）+ 报告（每题自动评分+成本）
判据：scripts/QUALITY_RUBRIC.md（7维度14分制；本脚本自动评其中可自动化子集，
深度洞察/具体性仍需人工判——机器不冒充人的判断）

用法：python3 run_regress.py [--tag before|after]
"""
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

BASE = "https://sufve.com/api/invest/chat"
BALANCE = "https://sufve.com/api/invest/balance-check?token=1825f61b2a0c6ee92adf4b0511db6e41"

QUESTIONS = [
    ("Q1", "全面分析英伟达（NVDA）：按五维度框架逐项拆解，多空论据都要给，最后给仓位策略建议", "balanced"),
    ("Q2", "我持有50股英伟达正股，成本210。想用备兑开仓增强收益，行权价和到期日怎么选？帮我挑这个方案最强的漏洞", "balanced"),
    ("Q3", "我看多英伟达长期，逻辑是AI算力需求不可逆。挑战我这个持仓逻辑，找最强的反方论据", "balanced"),
    ("Q4", "现在的美股大盘环境适合加仓吗？", "balanced"),
    ("Q5", "苹果现在什么情况", "balanced"),
]


def collect(qid: str, question: str, style: str, timeout: int = 115) -> dict:
    payload = json.dumps({
        "messages": [{"role": "user", "content": {"type": "text", "text": question}}],
        "style": style,
    }).encode()
    req = urllib.request.Request(BASE, data=payload, headers={
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    })
    t0 = time.time()
    ttfb = None
    chunks, statuses, errors = [], [], []
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        for raw in resp:
            line = raw.decode("utf-8").strip()
            if not line.startswith("{"):
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            t = ev.get("type")
            if t == "chunk":
                if ttfb is None:
                    ttfb = time.time() - t0
                chunks.append(ev.get("text", ""))
            elif t == "status":
                statuses.append(ev.get("text", ""))
            elif t == "error":
                errors.append(ev.get("message", ""))
    return {
        "qid": qid, "question": question, "style": style,
        "ttfb": round(ttfb, 1) if ttfb else None,
        "total_s": round(time.time() - t0, 1),
        "statuses": statuses, "errors": errors,
        "full": "".join(chunks), "chars": len("".join(chunks)),
    }


def balance() -> str:
    try:
        with urllib.request.urlopen(BALANCE, timeout=15) as r:
            data = json.loads(r.read().decode())
            return json.dumps(data, ensure_ascii=False)[:200]
    except Exception as e:
        return f"查询失败: {e}"


def main():
    tag = "run"
    if "--tag" in sys.argv:
        tag = sys.argv[sys.argv.index("--tag") + 1]
    outdir = Path(__file__).parent / "answers" / tag
    outdir.mkdir(parents=True, exist_ok=True)

    print(f"=== 回归测试 tag={tag} {time.strftime('%H:%M:%S')} ===")
    print(f"余额前: {balance()}\n")
    results = []
    for qid, q, style in QUESTIONS:
        print(f"[{qid}] {q[:36]}…", end=" ", flush=True)
        try:
            r = collect(qid, q, style)
        except Exception as e:
            r = {"qid": qid, "question": q, "error": str(e), "full": "", "chars": 0, "ttfb": None, "total_s": 0, "statuses": [], "errors": [str(e)]}
        (outdir / f"{qid}.json").write_text(json.dumps(r, ensure_ascii=False, indent=1), encoding="utf-8")
        ok = "✅" if r.get("chars", 0) > 300 else "❌"
        print(f"{ok} TTFB {r.get('ttfb')}s | {r.get('chars')}字 | {r.get('total_s')}s")
        results.append(r)
        time.sleep(2)
    print(f"\n余额后: {balance()}")
    print(f"\n答案全文: {outdir}/*.json")
    print("自动评分: python3 eval_chat_quality.py answers/" + tag + "/Q*.json")

    fails = [r["qid"] for r in results if r.get("chars", 0) < 300]
    print(f"\n结果: {len(results) - len(fails)}/{len(results)} 正常" + (f"，失败: {fails}" if fails else ""))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
费曼星投资对话质量评估器（9/6输出质量优化·验收层）

背景：罗竹先（框架创立人）对输出质量要求高。优化不能靠"感觉变好了"，
必须有可复现的量化判据。对采集的对话JSON做5维度评分。

5维度（对照定制框架三要求：对抗性/来源标注/框架边界）：
  A 对抗性——是否挑战用户立场
  B 来源纪律——论断带[数据]/[推导]/[经验]/[模型记忆]标签
  C 数字锚定——数字带来源+算式展示
  D 结构完整——S3五件套
  E 边界纪律——模块引用/免责声明/绝对化清零

判据修正史（评估器自身的坑，每轮交付前必查）：
  v1→v2: 绝对化扫描排除【已验证】行+算式正则补括号减法
  v2→v3: "无风险利率"是正当金融术语（排除该搭配）；标签数按字数密度
         （每300字+2个）替代绝对阈值——短中篇不再错杀
"""
import json
import re
import sys
from pathlib import Path

ABSOLUTE_TERM_PATTERNS = [r"永久(?!授权|记忆)", r"必涨", r"必定", r"稳赚", r"保证收益", r"零风险", r"无风险(?!利率)", r"肯定翻", r"百分百"]

MODULE_REF = re.compile(r"模块\s*(\d+)")
SOURCE_TAGS = re.compile(r"\[(数据|推导|经验|模型记忆|已注入)\]")
# [模块N]/[大师名]也是正当来源标注（新格式把出处标注迁移进方括号体系）——纳入密度统计
ATTRIB_TAGS = re.compile(r"\[(数据|推导|经验|模型记忆|已注入|模块\d+|芒格|格雷厄姆|利弗莫尔|巴菲特|索罗斯|段永平)\]")
CALC_FORMULA = re.compile(r"\([\d.,$%\s+*-]+[+/÷×-][\d.,$%\s+*-]+\)|[\d.,]+\s*[/÷×]\s*[\d.,]+\s*[÷×]\s*100|≈\s*\$?\d")
STRUCTURE_BLOCKS = {
    "分析思路": re.compile(r"【分析思路】|分析思路"),
    "核心判断": re.compile(r"核心判断"),
    "论据": re.compile(r"论据|多头|空头|看多|看空"),
    "条件分支": re.compile(r"条件分支|若.*跌破|若.*站稳|场景"),
    "结论收尾": re.compile(r"【裁决】|行动计划|失效预注册|答完即止"),
}
CHALLENGE_MARKERS = ["但这是", "反方", "风险在于", "挑战", "最薄弱", "冲突", "漏洞", "卖飞", "能否承受", "错在哪"]
DISCLAIMER = re.compile(r"不构成投资建议|仅供参考|决策权在你|判断权在用户")

PRICE_NUM = re.compile(r"\$\d[\d,.]*")
PCT_NUM = re.compile(r"[+-]?\d+(?:\.\d+)?%")


def evaluate(path: Path) -> dict:
    d = json.loads(path.read_text(encoding="utf-8"))
    full = d.get("full", "")
    question = d.get("question", path.stem)
    details_all = {}

    # ——— A 对抗性 ———
    score = 0
    det = []
    # 9/12结构级对抗检测（罗竹实测判空修复：词汇级检测放过了"三视角同向零交锋"的橡皮图章会诊）
    challengers = re.findall(r"质疑者[=＝:：]\s*([\u4e00-\u9fa5·/、]+)", full)
    crossfire = re.findall(r"(驳倒|被击中|击中|反驳|攻击了|幸存|降级为|刺穿|压倒)", full)
    if challengers:
        score += 25
        det.append(f"质疑者视角: {', '.join(challengers[:2])}")
    if crossfire:
        score += 25
        det.append(f"交锋痕迹×{len(crossfire)}: {', '.join(sorted(set(crossfire)))[:60]}")
    if not challengers and not crossfire and ("会诊=" in full or "大师" in full):
        score = max(0, score - 20)
        det.append("⚠ 会诊无质疑者且零交锋=形式会诊（橡皮图章）")
    challenges = [c for c in CHALLENGE_MARKERS if c in full]
    if challenges:
        score += min(20, 7 * len(challenges))
        det.append(f"挑战标记×{len(challenges)}: {', '.join(challenges[:4])}")
    if re.search(r"你(的|确定|真的|愿意|能否|如何)", full):
        score += 15
        det.append("直接质询用户")
    if "反方" in full or "空头" in full:
        score += 25
        det.append("显式反方论据")
    if "信心度" in full or "信心" in full:
        score += 10
        det.append("立场+信心度声明")
    if not challenges:
        det.append("⚠ 全文无挑战用户立场的标记")
    details_all["对抗性"] = {"score": min(score, 100), "details": det}

    # ——— B 来源纪律 ———
    score = 0
    det = []
    tags = ATTRIB_TAGS.findall(full)
    total_tags = len(tags)
    data_tags = tags.count("数据")
    inference_tags = tags.count("推导")
    other_tags = total_tags - data_tags - inference_tags
    density_target = max(4, round(len(full) / 300) + 2)
    if total_tags >= density_target + 2:
        score += 25
    elif total_tags >= density_target:
        score += 18
    det.append(f"来源标签×{total_tags}（数据{data_tags}/推导{inference_tags}/其他{other_tags}，密度线{density_target}）")
    if data_tags == 0 and len(full) >= 600:
        score = max(score - 30, 0)
        det.append("⚠ 全文无[数据]标签——分析无数据支撑")
    tag_lines = sum(1 for l in full.split("\n") if SOURCE_TAGS.search(l))
    num_lines = sum(1 for l in full.split("\n") if PRICE_NUM.search(l) or PCT_NUM.search(l))
    if num_lines > 0:
        ratio = tag_lines / num_lines
        if ratio >= 0.8:
            score += 25
        elif ratio >= 0.5:
            score += 15
        det.append(f"数字行标签覆盖率{ratio:.0%}")
    details_all["来源纪律"] = {"score": min(score, 100), "details": det}

    # ——— C 数字锚定 ———
    score = 0
    det = []
    prices = PRICE_NUM.findall(full)
    if prices:
        score += 20
        det.append(f"价格/金额数字×{len(prices)}")
    formulas = CALC_FORMULA.findall(full)
    if formulas:
        score += min(40, 20 * len(formulas))
        det.append(f"算式展示×{len(formulas)}")
    elif len(prices) >= 3:
        det.append("⚠ 多个价格数字但零算式——S1纪律未执行")
    if "[模型记忆]" in full:
        score += 10
        det.append("模型记忆已显式降级标注（诚信层生效）")
    details_all["数字锚定"] = {"score": min(score, 100), "details": det}

    # ——— D 结构完整 ———
    score = 0
    det = []
    missing = [name for name, rx in STRUCTURE_BLOCKS.items() if not rx.search(full)]
    score = max(0, 100 - 25 * len(missing))
    if not missing:
        det.append("S3五件套齐")
    else:
        det.append(f"⚠ 缺结构块: {', '.join(missing)}")
    details_all["结构完整"] = {"score": score, "details": det}

    # ——— E 边界纪律 ———
    score = 0
    det = []
    modules = MODULE_REF.findall(full)
    if modules:
        score += 25
        det.append(f"模块引用×{len(modules)}（{'/'.join(sorted(set(modules))[:6])}）")
    if DISCLAIMER.search(full):
        score += 22
        det.append("边界/免责声明存在")
    else:
        det.append("⚠ 缺免责声明")
    body_for_abs = "\n".join(l for l in full.split("\n") if "已验证" not in l and "已过滤" not in l)
    abs_hits = [m.group(0) for p in ABSOLUTE_TERM_PATTERNS for m in [re.search(p, body_for_abs)] if m]
    if abs_hits:
        score = max(score - 30, 0)
        det.append(f"⚠ 绝对化用语残留: {', '.join(abs_hits)}")
    else:
        score += 20
        det.append("绝对化用语清零")
    if "已验证" in full or "已过滤" in full:
        score += 15
        det.append("交叉验证声明存在")
    details_all["边界纪律"] = {"score": min(score, 100), "details": det}

    total = sum(v["score"] for v in details_all.values())
    return {
        "file": path.name,
        "question": question,
        "chars": len(full),
        "ttfb": d.get("ttfb"),
        "total_s": d.get("total_s"),
        "dimensions": details_all,
        "total": round(total / len(details_all), 1),
    }


def render(res: dict) -> str:
    lines = [f"◆ {res['file']} — {res['question'][:38]}"]
    lines.append(f"  字数{res['chars']} | TTFB {res['ttfb']}s | 总耗时{res['total_s']}s")
    for name, d in res["dimensions"].items():
        bar = "█" * int(d["score"] / 10) + "░" * (10 - int(d["score"] / 10))
        lines.append(f"  {name} {bar} {d['score']:>5.0f}")
        for det in d["details"]:
            lines.append(f"      {det}")
    lines.append(f"  总分: {res['total']}/100")
    return "\n".join(lines)


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(1)
    if args[0] == "--compare":
        a, b = evaluate(Path(args[1])), evaluate(Path(args[2]))
        print(render(a))
        print()
        print(render(b))
        print(f"\nΔ 总分 {b['total'] - a['total']:+.1f}")
        return
    for p in args:
        print(render(evaluate(Path(p))))
        print()


if __name__ == "__main__":
    main()

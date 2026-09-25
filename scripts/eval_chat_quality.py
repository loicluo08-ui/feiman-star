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
SOURCE_TAGS = re.compile(r"\[(数据|推导|经验|模型记忆|已注入)\]")  # 9/25标签废除后仅存档解析用，评分不再依赖
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

    # ——— B 来源纪律（9/25二次减法重写：方括号标签全面废除，输出层自然语言来源） ———
    score = 0
    det = []
    tags = ATTRIB_TAGS.findall(full)
    if tags:
        score = max(score - 40, 0)
        det.append(f"⚠ 方括号技术标签残留×{len(tags)}: {','.join(sorted(set(tags))[:5])}——输出协议已废除标签")
    else:
        score += 30
        det.append("方括号标签零残留")
    mod_refs = re.findall(r"模块\d+", full)
    if mod_refs:
        score = max(score - 25, 0)
        det.append(f"⚠ 内部模块编号泄漏×{len(mod_refs)}: {sorted(set(mod_refs))[:3]}")
    else:
        score += 20
        det.append("内部模块编号零泄漏")
    # 正向：数字行来源/语境词覆盖（自然语言来源说明的量化）
    src_words = re.compile(r"显示|报收|收于|注入|推算|推导|历史|框架|快讯|盘[中后前]|较|隐含|对照|口径")
    tag_lines = sum(1 for l in full.split("\n") if src_words.search(l))
    num_lines = sum(1 for l in full.split("\n") if PRICE_NUM.search(l) or PCT_NUM.search(l))
    if num_lines > 0:
        ratio = tag_lines / num_lines
        if ratio >= 0.7:
            score += 30
        elif ratio >= 0.4:
            score += 18
        det.append(f"数字行来源语境覆盖率{ratio:.0%}")
    else:
        det.append("无价格数字行（跳过覆盖率）")
    if "模型记忆" in full or "可能过时" in full:
        score = min(score + 20, 100)
        det.append("历史数据过时提示存在（诚信层）")
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
    # 9/25二次减法：[模型记忆]标签废除——历史数据过时提示在B维度量化（"可能过时"自然语言）
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
    # 9/25三次减法同步：导航句+术语小白解释=不必要介绍
    nav_hits = re.findall(r"下面(从|我们|来看)|首先(看|分析|来)|接下来(我们|分析)|让我们来", full)
    if nav_hits:
        score = max(score - 20, 0)
        det.append(f"⚠ 导航句×{len(nav_hits)}（下面/首先/让我们）——路线图句子应删")
    else:
        score += 15
        det.append("零导航句")
    rookie = re.findall(r"(PE|PB|ROE|EPS|VIX|MA)（[市盈净资收益波报均每动率价]+）", full)
    if rookie:
        score = max(score - 15, 0)
        det.append(f"⚠ 常用指标小白解释×{len(rookie)}: {rookie[:2]}")
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
    # 9/25减法：【已验证】行已从输出协议废除（技术自白=无必要注释，过滤动作静默执行）
    # 不再计分；历史存档回答中的该行由绝对化扫描排除逻辑兼容（body_for_abs过滤保留）
    if "已验证" in full or "已过滤" in full:
        det.append("（历史格式）含旧版交叉验证声明，不计分")
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

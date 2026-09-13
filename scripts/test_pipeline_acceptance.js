/**
 * T-P六环流水线验收（9/13）——四查机械判据，验证"环环相扣"落地到输出形态
 * 规格：reports/六环流水线协议规格_v1.md §5
 *
 * 用法：
 *   node scripts/test_pipeline_acceptance.js                 → 内置正/负例自测
 *   node scripts/test_pipeline_acceptance.js <file> [--ledger SYMBOL] [--deep]
 *                                                            → 验真实输出文本
 *
 * 四查：
 *   1 署名查：禁止「大师名+认为/说/指出」开头的独立发言段（拼盘特征）；
 *             [视角]格式溯源标注合法
 *   2 功能查：正文数字逐个检查所在句是否含功能词——裸数字率<10%通过
 *   3 裁决查：深度/blend档必须含【裁决】表且质量/价格/时机三字段非全存疑
 *   4 对账查：--ledger传入时（=注入含该标的记账），必须含对账特征+信心度对照
 */
const fs = require("fs");

const MASTERS = ["芒格", "巴菲特", "利弗莫尔", "段永平", "索罗斯", "马斯克", "格雷厄姆", "马克斯", "费雪", "塔勒布", "林奇"];
const SPEAK_VERBS = "(?:认为|指出|建议|强调|说过|说)";
const FUNC_WORDS = /支撑|失效|触发|阈值|止损|止盈|仓位|目标价?|风险|回撤|加仓|减仓|买入|卖出|回避|观望|波动|IV|PE|PB|估值|安全边际|信心|置信|关键位|支撑位|阻力|锚|分位|涨|跌|突破|跌破|反弹|回调|基准|对照|维持|翻转|重立|隐含|年化|倍|股息|现金流|增速|下行|上行|上限|下限|水位|概率|衰减|扩张|压缩|贵|便宜|低估|高估|合理|缓冲|成本|收入|利润|净利|营收|毛利|负债|现金|回购|分红|指引|预期|共识|拥挤|杠杆|利息|税|补贴|订单|产能|份额|渗透|壁垒|护城河|特许|定价权|规模效应|转换成本|网络效应|复购|留存|获客/i;
const DATE_RE = /^(?:19|20)\d{2}$|^\d{1,2}[:/]\d{1,2}/; // 年份/时间/日期比例
const CODE_RE = /^(?:[SsDdPpQG]\d+|H\d+|第?\d+\s*[条批章节批])$/;

function splitSentences(text) {
  return text.split(/(?<=[。！？!?；;])\s*|\n+/).map((s) => s.trim()).filter(Boolean);
}

/** 查1：独立发言段（「XX认为…」句首=拼盘特征） */
function checkSignoff(text) {
  const violations = [];
  for (const s of splitSentences(text)) {
    for (const m of MASTERS) {
      // 句首即大师名+言说动词=独立发言段；[芒格·逆向]溯源标注、「质疑者=芒格」均合法
      const re = new RegExp("^" + m + SPEAK_VERBS);
      if (re.test(s)) { violations.push(s.slice(0, 40)); break; }
    }
  }
  return { ok: violations.length === 0, violations };
}

/** 查2：裸数字率——数字所在句无任何功能词 */
function checkFunction(text) {
  const sentences = splitSentences(text);
  let total = 0, naked = 0;
  const nakedSamples = [];
  for (const s of sentences) {
    const nums = s.match(/\d+(?:\.\d+)?%?/g) || [];
    for (let n of nums) {
      const clean = n.replace(/%$/, "");
      if (DATE_RE.test(clean) || CODE_RE.test(clean)) continue; // 年份/日期/规则编号豁免
      if (/(?:规则|模块|法案|周|年|月|日|点|版|阶段|档)\d/.test(s) && clean.length <= 2 && s.indexOf(clean) < 8) continue; // 句首小编号
      total++;
      if (!FUNC_WORDS.test(s)) {
        naked++;
        if (nakedSamples.length < 5) nakedSamples.push(`"${n}" ← ${s.slice(0, 40)}`);
      }
    }
  }
  const rate = total === 0 ? 0 : naked / total;
  return { ok: rate < 0.1, rate: +(rate * 100).toFixed(1), total, naked, nakedSamples };
}

/** 查3：裁决表——深度档必须质量/价格/时机三字段非全存疑 */
function checkVerdict(text, isDeep) {
  if (!isDeep) return { ok: true, skipped: true };
  const hasTable = /【裁决】/.test(text);
  if (!hasTable) return { ok: false, reason: "深度档缺【裁决】表" };
  const fields = ["质量", "价格", "时机"].map((k) => {
    const m = text.match(new RegExp(k + "\\s*[=：:]\\s*([^|\\n]{1,30})"));
    return { k, v: m ? m[1].trim() : null };
  });
  const missing = fields.filter((f) => !f.v);
  const allDoubt = fields.every((f) => f.v && /存疑|无法/.test(f.v));
  if (missing.length) return { ok: false, reason: `裁决表缺字段：${missing.map((f) => f.k).join("/")}` };
  if (allDoubt) return { ok: false, reason: "裁决表三字段全存疑=未裁定" };
  return { ok: true, fields };
}

/** 查4：对账特征——注入含记账标的时必须对账+信心度对照 */
function checkLedger(text, ledgerSymbol) {
  if (!ledgerSymbol) return { ok: true, skipped: true };
  const hasRecon = /上次|此前判断|较上次|此前.{0,6}判断/.test(text);
  const hasVerdict = /维持|翻转|重立/.test(text);
  const hasConf = /信心|置信/.test(text);
  const problems = [];
  if (!hasRecon) problems.push("无对账特征句");
  if (!hasVerdict) problems.push("无维持/翻转/重立结论");
  if (!hasConf) problems.push("信心度无对照声明");
  return { ok: problems.length === 0, problems, ledger: ledgerSymbol };
}

function runAll(text, opts = {}) {
  const isDeep = opts.deep || text.length > 800;
  return {
    署名查: checkSignoff(text),
    功能查: checkFunction(text),
    裁决查: checkVerdict(text, isDeep),
    对账查: checkLedger(text, opts.ledger),
  };
}

function fmt(label, r) {
  const ok = r.ok;
  return `${ok ? "PASS" : "FAIL"} ${label}${r.skipped ? "（skip）" : ""}${r.rate != null ? ` 裸数字率=${r.rate}%(${r.naked}/${r.total})` : ""}${r.reason ? ` — ${r.reason}` : ""}${r.problems ? " — " + r.problems.join("；") : ""}${r.violations ? "\n      违规句: " + r.violations.join(" | ") : ""}${r.nakedSamples && r.nakedSamples.length && !ok ? "\n      裸数字: " + r.nakedSamples.join(" | ") : ""}`;
}

// ——内置样例自测——
const goodSample = `**核心判断**：NVDA立场偏多，信心度中高（4镜头同向）。较上次9/7判断：维持，信心中→中高（失效位180未触发，现价237）。

一、质量维度：现价237对应PE 43倍，处于52周分位73%——高于同行中位数31倍，估值定位偏贵[格雷厄姆]。但毛利率75%+数据中心收入同比增94%（财报注入），高增长支撑溢价成立的部分[费雪]。死亡风险前置[芒格·逆向]：最大摧毁因素是数据中心订单增速失速——当前注入数据未见失速证据，检验幸存。

二、时机维度：现价237高于关键位225（近1月平台顶），量能1.8倍放大，最小阻力线向上[利弗莫尔]。期权链ATM IV 32%隐含±9%财报波动——事件风险阈值：财报日9/17前仓位须为此留缓冲。

三、多空对置与裁决：估值分位73%偏贵[格雷厄姆] vs 突破关键位+量能确认[利弗莫尔]——冲突裁定：时机赢但估值贵限定仓位（首笔半仓，不否定方向）。【裁决】质量=过（毛利率75%+订单未见失速） | 价格=贵（分位73%，同行中位31倍） | 时机=急（关键位突破+量能1.8倍）→行动分支。

四、行动计划：目标仓位5%[推导·模块5]，分2笔——首笔2.5%现价，预留2.5%等回踩225确认。证伪信号：①收盘跌破225且量能>2倍→减半；②数据中心增速指引<50%→清仓。检查点：9/17财报核验数据中心增速假设。失效预注册：本判断最依赖"订单周期未逆转"，财报指引下修则立场失效。

【判断记账】标的=NVDA(英伟达) | 立场=多 | 关键位=225 | 失效=收盘跌破225且量能2倍 | 信心度=65%`;

const badSample = `芒格认为这家公司的护城河不够深。巴菲特指出现金流折现来看价格偏高。利弗莫尔说关键点还没有出现。

从数据看：PE 43。52周区间180-250。VIX 15。期权IV 32%。

综合来看各大师都有道理，取决于投资者偏好。建议保持关注。

【裁决】质量=存疑 | 价格=存疑 | 时机=存疑`;

function selfTest() {
  console.log("== 内置样例自测 ==");
  let fail = 0;
  const good = runAll(goodSample, { deep: true, ledger: "NVDA" });
  for (const [k, v] of Object.entries(good)) {
    const line = fmt("正例·" + k, v);
    console.log(line);
    if (!v.ok) fail++;
  }
  const bad = runAll(badSample, { deep: true, ledger: null });
  const expectedFail = ["署名查", "功能查", "裁决查"];
  let caught = 0;
  for (const [k, v] of Object.entries(bad)) {
    const line = fmt("负例·" + k, v);
    console.log(line);
    if (!v.ok && expectedFail.includes(k)) caught++;
  }
  if (caught < expectedFail.length) { console.log(`FAIL 负例只抓到${caught}/${expectedFail.length}项`); fail++; }
  console.log(fail === 0 ? "\nSELF-TEST PASS（正例全过+负例全抓）" : `\nSELF-TEST FAIL（${fail}项）`);
  process.exit(fail === 0 ? 0 : 1);
}

// ——CLI——
const args = process.argv.slice(2);
if (args.length === 0) { selfTest(); }
else {
  const file = args[0];
  const ledgerIdx = args.indexOf("--ledger");
  const ledger = ledgerIdx > -1 ? args[ledgerIdx + 1] : null;
  const deep = args.includes("--deep");
  const text = fs.readFileSync(file, "utf-8");
  const r = runAll(text, { deep, ledger });
  let fail = 0;
  for (const [k, v] of Object.entries(r)) {
    console.log(fmt(k, v));
    if (!v.ok) fail++;
  }
  console.log(fail === 0 ? "\nALL PASS" : `\n${fail}项FAIL`);
  process.exit(fail === 0 ? 0 : 1);
}

module.exports = { runAll, checkSignoff, checkFunction, checkVerdict, checkLedger };

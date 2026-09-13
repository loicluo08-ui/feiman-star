/**
 * 费曼星KB选择性注入路由
 *
 * 背景：FEIMANSTAR_KB全文≈32K tokens，每轮对话全额注入system prompt——
 * - 成本：DeepSeek输入token大头（期权三模块45%，非期权问题纯浪费）
 * - TTFB：40K级prompt首字延迟10-20s
 * - 质量：无关模块挤占注意力
 *
 * 设计：
 * - 核心集（方法论+模块3/4/5/7+附录）永远注入=全量25%——费曼星框架身份所在
 * - 专项模块（1行业/2财务/6行为/8-10期权/11大师）关键词路由按需注入
 * - 最近3条历史消息参与匹配（防"那期权呢"式追问漏路由）
 * - 保险丝：任何异常返回全量KB——选择性注入永不造成断供，最差回到现状
 */

import { FEIMANSTAR_KB } from "./feimanstar-kb";

// ——— 切分（模块级，一次性缓存） ———

interface KBBlock {
  title: string;
  body: string; // 含标题行
}

let blocksCache: KBBlock[] | null = null;
let headerCache = ""; // 首个##之前的头部（方法论声明，永远注入）

function splitKB(): { header: string; blocks: KBBlock[] } {
  if (blocksCache) return { header: headerCache, blocks: blocksCache };
  const lines = FEIMANSTAR_KB.split("\n");
  const headerLines: string[] = [];
  const blocks: KBBlock[] = [];
  let cur: string[] | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^## /.test(line)) {
      if (cur) blocks.push({ title: cur[0], body: cur.join("\n") });
      cur = [line];
    } else if (cur) {
      cur.push(line);
    } else {
      headerLines.push(line);
    }
  }
  if (cur) blocks.push({ title: cur[0], body: cur.join("\n") });
  headerCache = headerLines.join("\n");
  blocksCache = blocks;
  return { header: headerCache, blocks: blocks };
}

function moduleNumber(block: KBBlock): number {
  const m = block.title.match(/^## 模块(\d+)/);
  if (m) return parseInt(m[1], 10);
  if (block.title.indexOf("附录") >= 0) return 99; // 交叉验证附录→核心
  return 100; // 版本记录等非模块块
}

// ——— 路由规则 ———

// 核心集：框架骨架——方法论/五维驱动/标的识别/仓位矩阵/追问清单/交叉验证附录
// 9/13审计：模块12实战案例库进核心集——它是"怎么下判断"的思维示范，具体性失分的直接补材；
// 3.9K代价小，任何标准/深度档都该带（此前只靠标的/关键词触发，苹果微软等大票不在正则里=漏注入）
const CORE_MODULES = [3, 4, 5, 7, 12, 99];

interface RouteRule {
  module: number;
  pattern: RegExp;
}

const ROUTE_RULES: RouteRule[] = [
  // 模块12b：案例库标的匹配——案例涉及的标的问题触发对应案例
  // 9/13修复：中文词不能进\b组（JS \w只含ASCII，中文边界永不命中="英伟达"永假）——ASCII代码保留\b防子串误命中，中文词独立交替无边界
  { module: 12, pattern: /\b(SMR|IONQ|QUBT|QBTS|TSLA|QQQ|ORCL|OKLO|VST|CEG|BWXT|GEV|MARA|MSTR|AEHR|RKLB|MP|UUUU|NVDA|GOOGL|AAPL|MSFT|TSM|AVGO|META|AMZN|NuScale)\b|谷歌|英伟达|特斯拉|甲骨文|苹果|微软|台积电|亚马逊|Meta|博通/i },
  // 模块1：行业估值基准——行业/板块/估值类问题
  { module: 1, pattern: /估值|行业|板块|半导体|芯片|软件|云服务|银行|保险|医药|医疗|石油|能源|公用事业|REITs|必需消费|可选消费|电信|工业|材料|行业基准/i },
  // 模块2：财务指标——财报/指标/基本面
  { module: 2, pattern: /PE|PB|ROE|ROA|EPS|EV\/|EBITDA|PEG|毛利率|净利率|毛利|负债|流动比率|速动比率|现金流|自由现金流|财报|报表|基本面|营收|利润|盈利|费用|周转|商誉|存货|应收/i },
  // 模块12：实战案例库——建仓/止损/判断过程/复盘类（9/12素材提炼）
  { module: 12, pattern: /建仓|加仓|减仓|止损|止盈|复盘|判断修正|历史上|类似|案例|暴跌|崩盘|回调|抄底|猎人|财报联动|事件驱动|布局|十倍|黑马|护城河案例|叙事|泡沫|撤回|信仰|持仓|仓位管理/i },
  // 模块6：行为偏差——情绪/偏差类
  { module: 6, pattern: /追涨|杀跌|恐慌|FOMO|损失厌恶|锚定|确认偏误|过度自信|处置效应|Martingale|加倍|摊平|割肉|舍不得|后悔|行为偏差|情绪|纪律|心态/i },
  // 模块8/9/10：期权三模块——期权类问题整体进入
  { module: 8, pattern: /期权|Option|看涨|看跌|认购|认沽|行权|Greeks|Delta|Gamma|Vega|Theta|IV|隐含波动|铁鹰|跨式|宽跨|蝶式|备兑|Covered|牛市价差|熊市价差|垂直价差|日历价差|双卖|保证金|到期日|平值|虚值|实值|LEAPS|保护性|roll|展期/i },
  { module: 9, pattern: /期权|Option|Greeks|Delta|Gamma|Vega|Theta|IV|隐含波动|pin risk|早止盈|截断亏损|行权日|到期周/i },
  { module: 10, pattern: /期权|Option|行权|保证金|价差|跨式|铁鹰|备兑|轮动|展期|roll|合约张数|权利金|买方|卖方/i },
  // 模块11：大师思维框架
  { module: 11, pattern: /芒格|巴菲特|利弗莫尔|段永平|索罗斯|马斯克|格雷厄姆|马克斯|费雪|查理|护城河|反身性|第一性原理|本分|能力圈|内在价值|思维模型|逆向思考|多元思维|安全边际|市场先生|周期钟摆|第二层思维|闲聊法|15要点/i },
];

// 大师风格→模块11强制联动（9/6：风格选中时知识必须随车）。blend=大师融合旗舰，模块11是它的弹药库
const GURU_STYLE_MODULE = /^(blend|munger|buffett|livermore|duan|soros|musk)$/;

// 股票问题指示：具体标的（代码/公司名/持仓）→估值(1)+财务(2)联动
// 注意：中文词不能用\b（JS \w只含ASCII，中文不是词字符）——直接子串匹配
const STOCK_HINT = /(?:^|[^A-Za-z])[A-Z]{2,5}(?:\.[A-Z])?(?:$|[^A-Za-z])|苹果|英伟达|特斯拉|微软|谷歌|亚马逊|Meta|脸书|台积电|阿斯麦|博通|超微|英特尔|AMD|高通|礼来|联合健康|摩根大通|可口可乐|百事|麦当劳|耐克|迪士尼|奈飞|伯克希尔|持仓|股票|个股|自选|买入|卖出|加仓|建仓|清仓|止盈|止损|股票代码|市值|股价|现价|多少钱|怎么看|分析下|分析一下/;

export interface KBSelection {
  kb: string;
  includedModules: number[];
  totalChars: number;
  selectedChars: number;
  fullFallback: boolean; // true=保险丝触发返回全量
}

/**
 * 按本轮问题+近期历史选择注入的KB子集。
 * 任何异常返回全量（保险丝）。
 * 9/6风格联动：大师风格（munger/buffett/livermore/duan/soros/musk）强制注入模块11——
 * 用户选了芒格风格但问题只写"英伟达怎么看"时，问题文本无大师关键词，模块11会漏路由，
 * 而风格prompt大量引用模块11内容——风格选中=知识必须随车
 */
export function selectKBForQuestion(
  userText: string | null | undefined,
  recentTexts: string[] | null | undefined,
  style?: string | null,
): KBSelection {
  const full: KBSelection = {
    kb: FEIMANSTAR_KB,
    includedModules: [0],
    totalChars: FEIMANSTAR_KB.length,
    selectedChars: FEIMANSTAR_KB.length,
    fullFallback: true,
  };
  try {
    const { header, blocks } = splitKB();
    if (blocks.length === 0) return full;

    const history = (Array.isArray(recentTexts) ? recentTexts : [])
      .filter(function (t): boolean { return typeof t === "string"; });
    const q = typeof userText === "string" ? userText : "";
    const routeText = [q].concat(history.slice(-3)).join("\n").slice(0, 4000);
    if (!routeText.trim()) return full;

    const wanted = new Set<number>(CORE_MODULES);

    // 风格联动：大师风格锁模块11（风格prompt引用模块11的思维框架）
    if (style && GURU_STYLE_MODULE.test(style)) wanted.add(11);

    ROUTE_RULES.forEach(function (rule) {
      if (rule.pattern.test(routeText)) wanted.add(rule.module);
    });
    if (STOCK_HINT.test(routeText)) {
      wanted.add(1);
      wanted.add(2);
      // 大师会诊（9/6质量线）：股票问题默认带模块11——系统prompt的会诊协议按问题类型
      // 自动路由芒格/巴菲特/利弗莫尔/索罗斯/马斯克视角，无模块11知识=会诊空转。
      // 大师框架是分析武器库不是可选项（罗竹先：五维度是地基，框架是放大镜）
      wanted.add(11);
    }

    const parts: string[] = [header.trimEnd()];
    blocks.forEach(function (block) {
      const num = moduleNumber(block);
      if (num === 100) return; // 版本记录永不注入
      if (wanted.has(num)) parts.push(block.body);
    });
    const kb = parts.join("\n\n").trim() + "\n";

    // 保险丝2：选择结果异常小（切分bug）→回退全量
    if (kb.length < FEIMANSTAR_KB.length * 0.15) return full;

    return {
      kb: kb,
      includedModules: Array.from(wanted).sort(function (a, b) { return a - b; }),
      totalChars: FEIMANSTAR_KB.length,
      selectedChars: kb.length,
      fullFallback: false,
    };
  } catch {
    return full;
  }
}

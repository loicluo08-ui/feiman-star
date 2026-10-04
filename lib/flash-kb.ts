// 快讯AI分析专用知识库（10/4改造：QQQ单库 → 多市场框架卡）
// 背景：旧版所有快讯（含A股）都强行分析"对QQQ的影响"——A股快讯套美股框架=错位输出
// 现按快讯内容路由分析视角，每个市场用各自己的分析框架

export type FlashMarket = "cn_stock" | "us_stock" | "macro" | "commodity" | "crypto" | "geo" | "generic";

/** 市场分类的展示标签 */
export const MARKET_LABELS: Record<FlashMarket, string> = {
  cn_stock: "A股",
  us_stock: "美股",
  macro: "宏观",
  commodity: "商品",
  crypto: "加密",
  geo: "地缘",
  generic: "综合",
};

// ── 市场分类器（关键词路由，specific优先：加密/商品先行，宏观殿后兜底其他） ──

const MARKET_KEYWORDS: Array<{ market: FlashMarket; words: string[] }> = [
  {
    market: "crypto",
    words: ["比特币", "以太坊", "加密", "数字货币", "稳定币", "区块链", "币圈", "挖矿", "BTC", "ETH", "虚拟货币"],
  },
  {
    market: "commodity",
    words: ["原油", "油价", "OPEC", "黄金", "白银", "铜价", "铁矿石", "煤炭", "天然气", "大豆", "小麦", "糖价", "期货", "大宗商品", "锂价", "稀土"],
  },
  {
    market: "cn_stock",
    words: ["A股", "沪指", "上证", "深成指", "创业板", "科创板", "恒生", "港股", "北交所", "证监会", "沪深", "涨停", "跌停", "印花税", "融券", "两融", "北向资金", "国家队", "国资委", "中概股", "人民币汇率", "A股开盘", "A股收盘", "林园", "但斌", "北向"],
  },
  {
    market: "us_stock",
    words: ["美股", "纳斯达克", "纳指", "标普", "道指", "QQQ", "特斯拉", "苹果公司", "英伟达", "微软", "Meta", "谷歌", "亚马逊", "SEC", "财报", "美股开盘", "美股收盘", "盘前", "盘后", "华尔街", "高盛", "摩根"],
  },
  {
    market: "geo",
    words: ["霍尔木兹", "伊朗", "以色列", "乌克兰", "俄军", "俄罗斯", "北约", "导弹", "空袭", "停火", "停战", "军事", "战争", "地缘", "封锁", "袭击", "制裁", "关税", "选举", "冲突", "贸易战", "脱钩", "出口管制", "禁运"],
  },
  {
    market: "macro",
    words: ["美联储", "FOMC", "非农", "CPI", "PPI", "PMI", "GDP", "国债收益率", "降息", "加息", "缩表", "扩表", "通胀", "失业率", "欧央行", "日本央行", "英国央行", "LPR", "央行", "货币政策", "利率决议", "鲍威尔", "财政部", "国债", "流动性", "PCE", "初请"],
  },
];

export function classifyFlash(text: string): FlashMarket {
  // specific优先：crypto > commodity > cn_stock > us_stock > geo > macro（表顺序即优先级；地缘专名比宏观术语更specific）
  for (const { market, words } of MARKET_KEYWORDS) {
    if (words.some((w) => text.includes(w))) return market;
  }
  return "generic";
}

/** 各市场的分析对象（分析影响落点） */
const MARKET_TARGETS: Record<FlashMarket, string> = {
  cn_stock: "A股大盘（沪指/创业板）与相关板块",
  us_stock: "QQQ（纳斯达克100）",
  macro: "美股（QQQ）与A股的传导路径",
  commodity: "相关产业链与通胀预期",
  crypto: "加密市场与风险偏好",
  geo: "风险偏好与避险资产（金/油/债）",
  generic: "大类资产（股/债/商品/汇）",
};

// ── 多市场分析框架卡（每市场一张精简卡，快讯场景400字分析够用） ──

const FRAMEWORK_CN_STOCK = `## A股分析框架
- 定价逻辑：政策市+流动性驱动，估值中枢受资金面（两融/北向/新基金发行）影响大于基本面
- 政策敏感度：证监会/国务院表态 > 货币政策 > 财政政策 > 产业政策；"活跃资本市场"类表述历史上有脉冲效应
- 板块轮动：高股息（银行/煤炭）防御 ↔ 科技成长（TMT/半导体）进攻；小微盘对流动性和监管最敏感
- 情绪指标：成交额破万亿=情绪活跃；连续缩量<8000亿=存量博弈
- 已知偏差：新闻驱动的脉冲通常1-3个交易日，追高胜率低`;

const FRAMEWORK_US_STOCK = `## QQQ（纳斯达克100）分析框架
- 定价逻辑：利率敏感型成长股，实际利率↓=估值扩张；Mag7占权重约33-40%，巨头财报主导指数方向
- 利好因素：降息/扩表、AI商业化落地、巨头CapEx超预期、半导体周期上行、VIX下降
- 利空因素：通胀回升、加息/缩表、AI泡沫信号（Token价格暴跌/CapEx回报率恶化）、科技裁员潮
- 估值基准：信息技术PE 20(低)/28(中)/45+(高)；巴菲特指标>200%为危险区
- 已知偏差：单条快讯对指数的日线级影响通常<1%，方向判断重要程度大于幅度猜测`;

const FRAMEWORK_MACRO = `## 宏观→股市传导框架
- 利率链：通胀数据↑→降息预期↓→贴现率↑→成长股估值承压（QQQ弹性大于道指）
- 流动性链：央行扩表/降准→风险资产普涨；缩表/回收→高估值先跌
- 汇率链：美元走强→新兴市场资金流出、中概/A股承压；人民币贬值压力→A股情绪偏空
- 就业链：非农超预期=经济过热担忧（利好价值/利空成长）；非农大幅低于预期=衰退担忧（普跌）
- 已知偏差：数据公布前市场已有预期定价，"符合预期"常常等于无方向`;

const FRAMEWORK_COMMODITY = `## 商品→股市传导框架
- 油价：油价↑→通胀预期↑→降息预期推迟→成长股承压；但能源股（XLE）受益
- 金价：金价↑通常=实际利率↓预期或避险情绪↑——风险偏好降温信号，对纳指中性偏空
- 铜/工业金属：铜价=全球经济健康度先行指标，铜价↑利好资源股+周期股
- 农产品：主粮价格脉冲→食品CPI传导，对货币政策预期影响间接
- 已知偏差：商品单日波动与股市当日相关性不稳定，传导通常需要1-2周确认`;

const FRAMEWORK_CRYPTO = `## 加密→风险偏好框架
- BTC与纳指相关性：流动性宽松期正相关（同为久期资产），加密大跌常先于成长股回调
- 稳定币/监管新闻：监管收紧=短期流动性冲击；ETF资金流入流出=机构风险偏好信号
- 加密原生逻辑：减半周期/杠杆清算（爆仓链）——加密内部事件对股市传导有限
- 已知偏差：不要把加密新闻直接映射为股市方向，先判断是流动性信号还是圈内事件`;

const FRAMEWORK_GEO = `## 地缘事件框架
- 第一反应：避险资产（金/美债/日元/瑞郎）↑，风险资产（股/加密）↓——通常数小时内完成定价
- 持续性判断：供应链是否受损（能源咽喉/芯片产能）——伤及实体供给的事件持续性长
- 历史模式：地缘冲突对美股的中期影响通常被央行政策覆盖，除非升级至影响美联储路径
- 已知偏差："开战跌、停火涨"是最常见的方向，但幅度高度依赖升级/降级预期差`;

const FRAMEWORK_GENERIC = `## 综合判断框架
- 先问：这条消息改变了什么预期？（盈利预期/利率预期/风险偏好/流动性）——什么都不改变=无方向
- 再问：哪个资产对这个变量最敏感？（成长股→利率；周期股→经济；防御股→不确定性）
- 未知信息不脑补：快讯没给的细节（规模/时间/条件）标注为待确认，不编造影响幅度`;

const MARKET_FRAMEWORKS: Record<FlashMarket, string> = {
  cn_stock: FRAMEWORK_CN_STOCK,
  us_stock: FRAMEWORK_US_STOCK,
  macro: FRAMEWORK_MACRO,
  commodity: FRAMEWORK_COMMODITY,
  crypto: FRAMEWORK_CRYPTO,
  geo: FRAMEWORK_GEO,
  generic: FRAMEWORK_GENERIC,
};

/** 按快讯市场取对应分析框架（route组装system prompt用） */
export function getFramework(market: FlashMarket): { label: string; target: string; framework: string } {
  return {
    label: MARKET_LABELS[market],
    target: MARKET_TARGETS[market],
    framework: MARKET_FRAMEWORKS[market],
  };
}

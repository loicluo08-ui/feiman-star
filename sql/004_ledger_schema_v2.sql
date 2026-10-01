-- ============================================================
-- 判断账本 Schema V2（10/1 Phase1账本转起来——产品进化总方案§一）
-- 执行方式：Supabase SQL Editor（同003先例）
-- 设计宪法对齐：
--   时间盒=堵"失效不触发永不判错"（每条判断强制到期结算）
--   失效严格度=机械判定（invalidation可否parse出数字+方向），不靠AI自报
--   环境标签=错账呈现带环境维度（数据点+失效条件复盘+环境标签，不是红字惩罚）
--   执行层=判断与动作分离（判断对≠该操作）
--   修正轨迹=修正事件链一等公民（corrects指向前置判断的symbol|date键）
-- 全列可空：存量行无需回填；写入路径按候选可得性填
-- ============================================================
ALTER TABLE judgment_ledger ADD COLUMN IF NOT EXISTS time_box int;
ALTER TABLE judgment_ledger ADD COLUMN IF NOT EXISTS env_tags text;
ALTER TABLE judgment_ledger ADD COLUMN IF NOT EXISTS failure_strictness text;
ALTER TABLE judgment_ledger ADD COLUMN IF NOT EXISTS exec_plan text;
ALTER TABLE judgment_ledger ADD COLUMN IF NOT EXISTS corrects text;

COMMENT ON COLUMN judgment_ledger.time_box IS '时间盒天数：短线5/波段20/长线60——到期强制结算(expired)';
COMMENT ON COLUMN judgment_ledger.env_tags IS '环境标签逗号串：财报周/高波动/降息周期等（错账复盘维度）';
COMMENT ON COLUMN judgment_ledger.failure_strictness IS '失效严格度：strict=可观测数字+方向词可机械核验 | narrative=纯叙事（单列统计不入对错率）';
COMMENT ON COLUMN judgment_ledger.exec_plan IS '执行层计划：如"回踩X分2-3笔介入/破位仅观察"（判断对≠该操作）';
COMMENT ON COLUMN judgment_ledger.corrects IS '修正轨迹：被修正的前置判断键 symbol|date（修正链，原判断保留不覆盖）';

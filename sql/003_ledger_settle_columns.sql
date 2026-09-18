-- 判断账本结算字段（可选升级——9/18结算cron当前零DDL运行，写kb_dynamic）
-- 执行后cron可原生回写ledger（未来演进：结算状态进账本本体）
ALTER TABLE judgment_ledger ADD COLUMN IF NOT EXISTS settle_status text;
ALTER TABLE judgment_ledger ADD COLUMN IF NOT EXISTS settle_result text;
ALTER TABLE judgment_ledger ADD COLUMN IF NOT EXISTS settled_at timestamptz;
ALTER TABLE judgment_ledger ADD COLUMN IF NOT EXISTS settle_price numeric;
CREATE INDEX IF NOT EXISTS idx_ledger_symbol_date ON judgment_ledger (symbol, date);

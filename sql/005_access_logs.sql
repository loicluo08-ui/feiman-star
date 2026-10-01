-- 005 使用监控后台基建（10/1逸翔令：后台看每个用户使用情况+IP）
-- 在Supabase SQL Editor执行一次

-- 1) 访问日志表（middleware全站采集：/invest/*页面+API）
CREATE TABLE IF NOT EXISTS access_logs (
  id        bigserial PRIMARY KEY,
  ts        timestamptz NOT NULL DEFAULT now(),
  ip        text,
  path      text NOT NULL,
  method    text NOT NULL,
  ua        text,
  country   text,
  city      text,
  referer   text
);
CREATE INDEX IF NOT EXISTS idx_access_logs_ts ON access_logs (ts DESC);
CREATE INDEX IF NOT EXISTS idx_access_logs_ip ON access_logs (ip);

-- 2) chat_logs补IP与时区时间戳（对话明细与访问日志可按IP关联）
ALTER TABLE chat_logs ADD COLUMN IF NOT EXISTS ip text;
ALTER TABLE chat_logs ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- 3) RLS：service key写入+读取不受影响；匿名只读也关闭（后台走service key）
ALTER TABLE access_logs ENABLE ROW LEVEL SECURITY;
-- service_role绕过RLS，无需额外policy（写入/读取都用service key）

-- 4) 复核
SELECT count(*) FROM access_logs;

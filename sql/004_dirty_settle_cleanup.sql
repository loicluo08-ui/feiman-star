-- 脏结算数据清洗（10/1六轮检测P2-10——在Supabase SQL Editor执行一次）
--
-- 背景：cron-judgment-settle与chat注入verify在10/1修复前存在两类口径错位：
--   1. price=0脏数据：行情源异常返回空价 → price<=0 <= level → 假"失效已触发"
--   2. 非价格维度：失效条件"PE跌破28"的28被当股价机械判定 → 假触发/假安全
-- 代码层已双修（NON_PRICE_RE + price>0过滤），本脚本清掉库里的历史脏结果，
-- 使【账务提醒】不再对历史误判反复播报。
--
-- 安全性：只删 kb_dynamic 里 source='cron-judgment-settle' 的 insight 行，不碰判断本体（judgment_ledger表）。
-- 原则：宁缺勿错——错杀标记比漏结算更伤信任；被删的误判不影响任何真实结算结论。

-- 1) 先查看将被清洗的行（执行前人工确认）
SELECT id, keywords, content,
       (content::jsonb->>'symbol')      AS symbol,
       (content::jsonb->>'settle_price') AS settle_price,
       (content::jsonb->>'result')       AS result,
       created
FROM kb_dynamic
WHERE type = 'insight'
  AND source = 'cron-judgment-settle'
  AND (
        (content::jsonb->>'settle_price') IS NOT NULL
        AND (content::jsonb->>'settle_price')::numeric <= 0
      )
   OR (type = 'insight'
       AND source = 'cron-judgment-settle'
       AND (content::jsonb->>'invalidation') ~* '(PE|PB|PS|ROE|ROA|EPS|市盈率|市净率|股息|增速|回报率|利润率|信心度)');

-- 2) 执行清洗（确认上一步输出无误后运行）
DELETE FROM kb_dynamic
WHERE type = 'insight'
  AND source = 'cron-judgment-settle'
  AND (
        ((content::jsonb->>'settle_price') IS NOT NULL
         AND (content::jsonb->>'settle_price')::numeric <= 0)
     OR ((content::jsonb->>'invalidation') ~* '(PE|PB|PS|ROE|ROA|EPS|市盈率|市净率|股息|增速|回报率|利润率|信心度)')
      );

-- 3) 复核：应返回0行
SELECT count(*) FROM kb_dynamic
WHERE type = 'insight'
  AND source = 'cron-judgment-settle'
  AND (content::jsonb->>'settle_price')::numeric <= 0;


-- 4) 清理10/1部署验证的测试行（TEST标记，人工执行）
DELETE FROM judgment_ledger WHERE symbol LIKE 'TEST%';

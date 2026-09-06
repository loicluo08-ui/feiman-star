"use client";

import { useEffect, useRef, useState } from "react";

type Props = { target: string; className?: string };

/**
 * 流式平滑打字机（9/6 agentmore式流动性输出）
 *
 * 现状问题：SSE chunk经100ms节流批量flush，文本以"块"跳变出现（一次几十字），
 * 且每刷全量markdown重解析——块跳变观感廉价+卡顿。
 *
 * 本组件：字符级渐进显示，requestAnimationFrame追赶目标文本：
 * - 追赶速率自适应积压量：落后越多放得越快（大段落不假慢），接近追平时减速
 *   （尾部呈自然打字感），积压清零即静止——永远是"正在流出"的观感
 * - 内部状态自持，不动messages数组——逐字符零全量重渲染
 * - 流式期间纯文本渲染（whitespace-pre-wrap），完成后由父组件切
 *   MarkdownRenderer全排版（agentmore同款：流式轻渲染+完成重排版）
 * - 尾部闪烁光标（CSS animate-pulse，无依赖）
 */
export function TypewriterText({ target, className }: Props) {
  const [displayed, setDisplayed] = useState(() => target.slice(0, 0));
  const rafRef = useRef<number | null>(null);
  const lenRef = useRef(0);

  useEffect(() => {
    const step = () => {
      const backlog = target.length - lenRef.current;
      if (backlog > 0) {
        // 指数追赶+尾部跟速：rate≈backlog/60——积压60字时1字/帧（60字/s≈AI输出速率，
        // 尾部匀速流出=平滑观感）；积压300字时5字/帧快速消化，永不落后AI太多
        const rate = Math.max(1, Math.ceil(backlog / 60));
        lenRef.current = Math.min(target.length, lenRef.current + rate);
        setDisplayed(target.slice(0, lenRef.current));
      }
      rafRef.current = requestAnimationFrame(step);
    };
    // 跳变保护：target被截断/替换（patch整体替换全文）时同步回退
    if (target.length < lenRef.current) {
      lenRef.current = target.length;
      setDisplayed(target);
    }
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [target]);

  return (
    <div className={className ?? "whitespace-pre-wrap break-words leading-6"}>
      {displayed}
      <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-[var(--primary)] align-text-bottom" aria-hidden />
    </div>
  );
}

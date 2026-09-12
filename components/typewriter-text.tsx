"use client";

/**
 * 流式平滑打字机（9/6 agentmore式流动性输出，9/13 P0-3升级ChatGPT式buffering）
 *
 * 问题：AI的chunk到达是bursty的（一坨一坨），直接跟随渲染=忽快忽慢的机械感。
 * ChatGPT的做法：buffer后以恒定速率放出——假装平滑流（感知速度铁律：ITL稳定>追赶速度）。
 *
 * 本组件：字符级渐进显示，requestAnimationFrame追赶目标文本：
 * - 积压≤90字（约1.5秒阅读量）：恒速1字/帧（60字/s）——绝对平滑，不跟burst跳
 * - 积压>90字：按积压比例平滑加速消化（backlog-90)/60，尾部不积压
 * - 流式期间纯文本渲染（whitespace-pre-wrap），完成后由父组件切
 *   markdown全排版（9/13 P0-2块级增量渲染待接，当前两阶段）
 */

"use client";

import { useEffect, useRef } from "react";

type Props = { target: string; className?: string };

export function TypewriterText({ target, className }: Props) {
  const lenRef = useRef(0);
  const elRef = useRef<HTMLSpanElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const tick = () => {
      const backlog = target.length - lenRef.current;
      if (backlog > 0) {
        // ChatGPT式buffering：恒速基线+积压压力平滑加速（不跟burst突跳）
        const rate = backlog > 90 ? Math.max(1, Math.ceil((backlog - 90) / 60)) : 1;
        const step = Math.min(rate, backlog);
        lenRef.current += step;
        if (elRef.current) elRef.current.textContent = target.slice(0, lenRef.current);
      }
      if (lenRef.current < target.length) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target]);

  return (
    <span ref={elRef} className={className} style={{ whiteSpace: "pre-wrap" }}>
    </span>
  );
}

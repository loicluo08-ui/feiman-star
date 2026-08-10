"use client";

import { useState } from "react";

export function ResultActions({ content, tool }: { content: string; tool: "script-generator" | "product-copy" }) {
  const [copied, setCopied] = useState(false);
  const [rating, setRating] = useState<1 | -1 | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState("");

  async function copyResult() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_800);
    } catch {
      setFeedbackMessage("复制失败，请手动选择内容。");
    }
  }

  async function submitFeedback(nextRating: 1 | -1) {
    setFeedbackMessage("");
    try {
      const response = await fetch("/api/tools/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool, rating: nextRating }),
      });
      if (!response.ok) throw new Error("FEEDBACK_FAILED");
      setRating(nextRating);
      setFeedbackMessage("谢谢反馈，我们会继续优化结果。");
    } catch {
      setFeedbackMessage("反馈暂未记录，请稍后重试。");
    }
  }

  return (
    <div className="rounded-xl border border-[#e5e5e7] bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={() => void copyResult()} className="focus-ring rounded-lg border border-[#d1d1d6] px-3 py-2 text-xs font-medium">{copied ? "已复制" : "复制全部结果"}</button>
        <div className="flex items-center gap-2"><span className="text-xs text-[#8e8e93]">结果有帮助吗？</span><button type="button" aria-label="有帮助" aria-pressed={rating === 1} onClick={() => void submitFeedback(1)} className={`focus-ring rounded-lg border px-3 py-2 text-sm ${rating === 1 ? "border-[#1a1a1a] bg-[#1a1a1a] text-white" : "border-[#d1d1d6]"}`}>赞</button><button type="button" aria-label="没帮助" aria-pressed={rating === -1} onClick={() => void submitFeedback(-1)} className={`focus-ring rounded-lg border px-3 py-2 text-sm ${rating === -1 ? "border-[#1a1a1a] bg-[#1a1a1a] text-white" : "border-[#d1d1d6]"}`}>踩</button></div>
      </div>
      {feedbackMessage ? <p className="mt-2 text-xs text-[#8e8e93]" aria-live="polite">{feedbackMessage}</p> : null}
    </div>
  );
}

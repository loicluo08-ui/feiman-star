"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

type Props = { content: string };

/**
 * 流式安全：AI流中输出到一半的```代码围栏未闭合时，剩余文本会被整段
 * 渲染成一个巨大代码块（闪烁跳变）。检测围栏数为奇数时补一个临时闭合，
 * 完整内容（偶数围栏）零影响。
 */
function stabilizeFences(content: string): string {
  const fences = (content.match(/^[ \t]*(```|~~~)/gm) || []).length;
  return fences % 2 === 1 ? `${content}\n\`\`\`` : content;
}

/**
 * 1b-2表格化后处理（10/1 Phase1③——排期定案："不再prompt对抗模型"）
 * 两连败实锤：prompt规则1b-2要求并列数字用表格，模型仍输出"MSFT 28.9/GOOGL 17.6/AMZN 20.2"式内联——
 * prompt层修不动，渲染层兜底：检测同行≥3个(代码+数值)对用 / 、 ; 分隔 → 自动转markdown表格
 * 误伤防护：代码围栏内不处理；已是表格的行不处理；必须≥3对且名称+数值成对；
 * 中文语境数字序列（"上涨5%、下跌3%"）无代码前缀不触发；短打形态自然不受影响（无该模式）
 */
function tableizeInlineLists(content: string): string {
  // 单对：(美股代码 1-5字母，可带.BRK.A类后缀) + 可选$ + 数值（可带%），括号包裹可选
  const pair = String.raw`[A-Z]{1,5}(?:\.[A-Z]{1,2})?\s*[（(]?\s*\$?\d+(?:\.\d+)?%?[）)]?`;
  // 序列：pair ×(分隔符 连接)，总数≥3
  const seqRe = new RegExp(`(${pair}(?:\\s*[/、;；]\\s*${pair}){2,})`, "g");
  let inFence = false;
  return content
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      if (line.trimStart().startsWith("|")) return line;
      return line.replace(seqRe, (seq) => {
        // 逐对拆出（名称, 数值）
        const pairs = Array.from(seq.matchAll(/([A-Z]{1,5}(?:\.[A-Z]{1,2})?)\s*[（(]?\s*(\$?\d+(?:\.\d+)?%?)[）)]?/g));
        if (pairs.length < 3) return seq;
        const rows = pairs.map(([, name, val]) => `| ${name} | ${val} |`).join("\n");
        return `| 标的 | 数值 |\n|---|---|\n${rows}`;
      });
    })
    .join("\n");
}

/**
 * memo：流式期间messages数组每次flush都重渲染所有气泡——
 * 旧消息content不变直接跳过（避免664 chunk×全量markdown重解析），
 * 流式气泡content变化才重新解析。render props对象每次新建不影响
 * ReactMarkdown等props恒定，memo浅比较仅看content。
 */
export const MarkdownRenderer = memo(function MarkdownRenderer({ content }: Props) {
  return (
    <div className="feiman-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, {
          detect: false,
          ignoreMissing: true,
          // 语言子集：全语言包~200KB是大头，投资场景实际只出这些——bundle省~25%
          subset: ["bash", "javascript", "typescript", "json", "python", "sql", "xml", "css", "diff", "plaintext", "yaml", "markdown"],
        }]]}
        components={{
          h1: ({ node, ...props }) => <h3 className="mb-3 mt-4 text-base font-semibold text-[var(--text)]" {...props} />,
          h2: ({ node, ...props }) => <h4 className="mb-2 mt-4 text-sm font-semibold text-[var(--text)]" {...props} />,
          h3: ({ node, ...props }) => <h5 className="mb-2 mt-3 text-sm font-medium text-[var(--text)]" {...props} />,
          p: ({ node, ...props }) => <p className="mb-3 leading-7" {...props} />,
          ul: ({ node, ...props }) => <ul className="mb-3 list-disc space-y-1 pl-5" {...props} />,
          ol: ({ node, ...props }) => <ol className="mb-3 list-decimal space-y-1 pl-5" {...props} />,
          li: ({ node, ...props }) => <li className="leading-6" {...props} />,
          strong: ({ node, ...props }) => <strong className="font-semibold text-[var(--text)]" {...props} />,
          em: ({ node, ...props }) => <em className="italic" {...props} />,
          code: ({ node, className, ...props }) => {
            const isInline = !className;
            return isInline ? (
              <code className="rounded bg-[var(--surface-muted)] px-1.5 py-0.5 font-mono text-[0.85em] text-[var(--negative)]" {...props} />
            ) : (
              <code className={`block font-mono text-[0.85em] ${className ?? ""}`} {...props} />
            );
          },
          pre: ({ node, children, ...props }) => (
            <div className="group/code relative my-3">
              <pre className="overflow-x-auto rounded-xl bg-[#1e1e2e] p-4 pr-12 text-sm text-[#cdd6f4]" {...props}>{children}</pre>
              <button
                onClick={(e) => {
                  const pre = (e.currentTarget.parentElement as HTMLElement)?.querySelector("pre");
                  const text = pre?.textContent ?? "";
                  void navigator.clipboard.writeText(text);
                  const btn = e.currentTarget;
                  btn.textContent = "已复制";
                  setTimeout(() => { btn.textContent = "复制"; }, 1600);
                }}
                className="absolute right-2 top-2 rounded-md bg-white/10 px-2 py-1 text-xs text-white/70 opacity-0 transition-opacity group-hover/code:opacity-100"
              >
                复制
              </button>
            </div>
          ),
          a: ({ node, href, ...props }) => {
            // 9/6红队修复（报告C）：显式协议白名单——react-markdown默认urlTransform已拦
            // javascript:/data:，这里做第二层（防御纵深），非http(s)/mailto的href不渲染成链接
            const rawHref = typeof href === "string" ? href : undefined;
            const safeHref = rawHref != null && /^(https?:|mailto:)/i.test(rawHref) ? rawHref : undefined;
            return (
              <a
                {...props}
                href={safeHref}
                className="text-[#0066cc] underline underline-offset-2 hover:text-[#004499]"
                target={safeHref ? "_blank" : undefined}
                rel={safeHref ? "noopener noreferrer nofollow" : undefined}
              />
            );
          },
          hr: ({ node, ...props }) => <hr className="my-4 border-t border-[var(--border)]" {...props} />,
          table: ({ node, ...props }) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full border-collapse text-[13.5px] leading-6" {...props} />
            </div>
          ),
          th: ({ node, ...props }) => (
            <th className="border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-left font-medium" {...props} />
          ),
          td: ({ node, ...props }) => (
            <td className="border border-[var(--border)] px-3 py-2" {...props} />
          ),
          blockquote: ({ node, ...props }) => (
            <blockquote className="my-3 border-l-2 border-[var(--border-strong)] py-1 pl-3.5 text-[15px] text-[var(--text-secondary)]" {...props} />
          ),
        }}
      >
        {tableizeInlineLists(stabilizeFences(content))}
      </ReactMarkdown>
    </div>
  );
});

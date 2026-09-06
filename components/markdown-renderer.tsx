"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

type Props = { content: string };

export function MarkdownRenderer({ content }: Props) {
  return (
    <div className="feiman-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
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
          pre: ({ node, ...props }) => (
            <pre className="my-3 overflow-x-auto rounded-xl bg-[#1e1e2e] p-4 text-sm text-[#cdd6f4]" {...props} />
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
              <table className="w-full border-collapse text-sm" {...props} />
            </div>
          ),
          th: ({ node, ...props }) => (
            <th className="border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-left font-medium" {...props} />
          ),
          td: ({ node, ...props }) => (
            <td className="border border-[var(--border)] px-3 py-2" {...props} />
          ),
          blockquote: ({ node, ...props }) => (
            <blockquote className="my-3 border-l-4 border-[var(--border-strong)] bg-[var(--surface-subtle)] py-2 pl-4 pr-3 text-sm text-[var(--text-secondary)]" {...props} />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

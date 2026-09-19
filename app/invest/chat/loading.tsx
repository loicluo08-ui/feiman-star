import { PageSkeleton } from "@/components/invest/page-skeleton";

export default function Loading() {
  // chat是固定视口布局（100dvh不滚动），骨架模拟同构布局防切换高度跳动
  return (
    <div className="flex h-[calc(100dvh-3rem)] flex-col lg:h-dvh" aria-hidden>
      <div className="px-5 pb-4 pt-7 sm:px-8">
        <div className="h-6 w-28 animate-pulse rounded-lg bg-[var(--surface-muted)]" />
        <div className="mt-2 h-3.5 w-64 max-w-full animate-pulse rounded bg-[var(--surface-subtle)]" />
        <div className="mt-4 flex gap-1.5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-7 w-20 animate-pulse rounded-full bg-[var(--surface-muted)]" />
          ))}
        </div>
      </div>
      <div className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-5">
          <div className="h-16 w-3/4 animate-pulse rounded-2xl bg-[var(--surface-subtle)]" />
          <div className="ml-auto h-10 w-1/2 animate-pulse rounded-2xl bg-[var(--surface-muted)]" />
          <div className="h-24 w-4/5 animate-pulse rounded-2xl bg-[var(--surface-subtle)]" />
        </div>
      </div>
      <div className="border-t border-[var(--border)] px-5 py-4">
        <div className="mx-auto flex max-w-3xl gap-2">
          <div className="h-11 flex-1 animate-pulse rounded-xl bg-[var(--surface-muted)]" />
          <div className="h-11 w-11 animate-pulse rounded-xl bg-[var(--surface-muted)]" />
        </div>
      </div>
      <span className="sr-only">正在加载投资对话…</span>
    </div>
  );
}

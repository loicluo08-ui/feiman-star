export function PageSkeleton({ title }: { title: string }) {
  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8" aria-hidden>
      <div className="h-7 w-40 animate-pulse rounded-lg bg-[var(--surface-muted)]" />
      <div className="mt-2 h-4 w-72 max-w-full animate-pulse rounded bg-[var(--surface-subtle)]" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="h-4 w-24 animate-pulse rounded bg-[var(--surface-muted)]" />
            <div className="mt-3 h-8 w-32 animate-pulse rounded bg-[var(--surface-subtle)]" />
            <div className="mt-3 h-3 w-full animate-pulse rounded bg-[var(--surface-subtle)]" />
            <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-[var(--surface-subtle)]" />
          </div>
        ))}
      </div>
      <span className="sr-only">正在加载{title}…</span>
    </div>
  );
}

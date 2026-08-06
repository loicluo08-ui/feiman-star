import Link from "next/link";

export function ToolLayout({
  eyebrow,
  title,
  description,
  children,
  resultTitle,
  resultDescription,
  resultItems,
  notice,
  resultContent,
  resultFooter,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
  resultTitle: string;
  resultDescription: string;
  resultItems: string[];
  notice?: string;
  resultContent?: React.ReactNode;
  resultFooter?: React.ReactNode;
}) {
  return (
    <div className="mx-auto min-h-screen max-w-[1440px] px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
      <div className="mb-8">
        <Link href="/" className="focus-ring inline-flex rounded-md text-sm text-[#8e8e93] transition-colors hover:text-[#1a1a1a]">
          ← 返回工具首页
        </Link>
        <p className="mt-8 text-xs font-semibold uppercase tracking-[0.18em] text-[#8e8e93]">{eyebrow}</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-[#8e8e93] sm:text-base">{description}</p>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]">
        <section aria-labelledby="input-heading" className="rounded-xl border border-[#e5e5e7] bg-white p-5 sm:p-7">
          <div className="mb-7 border-b border-[#e5e5e7] pb-5">
            <h2 id="input-heading" className="text-lg font-semibold">
              填写信息
            </h2>
            <p className="mt-1 text-sm text-[#8e8e93]">字段越具体，下一步接入模型后的结果越准确。</p>
          </div>
          {children}
        </section>

        <section aria-labelledby="result-heading" className="rounded-xl border border-[#e5e5e7] bg-[#fafafa] p-5 sm:p-7 xl:sticky xl:top-8">
          <span className="inline-flex rounded-full border border-[#e5e5e7] bg-white px-3 py-1 text-xs text-[#8e8e93]">结果预览</span>
          <h2 id="result-heading" className="mt-5 text-xl font-semibold">
            {resultTitle}
          </h2>
          <p className="mt-2 text-sm leading-6 text-[#8e8e93]">{resultDescription}</p>
          {resultContent ? (
            <div className="mt-6">{resultContent}</div>
          ) : (
            <>
              <div className="mt-6 space-y-2.5">
                {resultItems.map((item, index) => (
                  <div key={item} className="flex items-center gap-3 rounded-lg border border-[#e5e5e7] bg-white px-3.5 py-3 text-sm">
                    <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#f7f7f8] text-xs text-[#8e8e93]">
                      {index + 1}
                    </span>
                    {item}
                  </div>
                ))}
              </div>
              <div className="mt-8 rounded-lg border border-dashed border-neutral-300 px-4 py-8 text-center text-sm leading-6 text-[#8e8e93]">
                填写左侧信息并生成，完整结果将在这里展示。
              </div>
            </>
          )}
          {notice ? <p className="mt-5 text-xs leading-5 text-[#8e8e93]">{notice}</p> : null}
          {resultFooter ? <div className="mt-6">{resultFooter}</div> : null}
        </section>
      </div>
    </div>
  );
}

export function PendingSubmitButton({ label }: { label: string }) {
  return (
    <div className="pt-2">
      <button
        type="button"
        disabled
        aria-describedby="api-pending"
        className="w-full cursor-not-allowed rounded-[20px] bg-[#1a1a1a] px-5 py-3.5 text-sm font-medium text-white opacity-45"
      >
        {label}
      </button>
      <p id="api-pending" className="mt-3 text-center text-xs text-[#8e8e93]">
        API 将在下一步接入
      </p>
    </div>
  );
}

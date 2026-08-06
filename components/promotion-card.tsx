import Link from "next/link";

export function PromotionCard({ title, description }: { title: string; description: string }) {
  return (
    <aside className="rounded-xl bg-[#f7f7f8] p-5 sm:p-6" aria-label={title}>
      <p className="text-base font-semibold leading-6 tracking-tight text-[#1a1a1a]">{title}</p>
      <p className="mt-2 text-sm leading-6 text-[#6e6e73]">{description}</p>
      <Link
        href="/pricing"
        className="focus-ring mt-5 inline-flex rounded-lg bg-[#1a1a1a] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-black"
      >
        了解详情 →
      </Link>
    </aside>
  );
}

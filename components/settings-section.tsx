"use client";

import { useId, type ReactNode } from "react";

export function SettingsSection({
  title,
  description,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  description: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const contentId = useId();

  return (
    <section className="overflow-hidden rounded-xl border border-[#e5e5e7] bg-[#fafafa]">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => onOpenChange(!open)}
        className="focus-ring flex w-full items-center gap-4 rounded-xl px-4 py-4 text-left transition-colors hover:bg-[#f5f5f6] sm:px-5"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-[#1a1a1a]">{title}</span>
          <span className="mt-1 block text-xs leading-5 text-[#8e8e93]">{description}</span>
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="none"
          className={`h-5 w-5 shrink-0 text-[#8e8e93] transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          <path d="m5.5 7.75 4.5 4.5 4.5-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div id={contentId} hidden={!open}>
        <div className="space-y-5 border-t border-[#e5e5e7] bg-white p-4 sm:p-5">{children}</div>
      </div>
    </section>
  );
}

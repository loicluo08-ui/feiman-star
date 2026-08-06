export function GenerateButton({ loading, label }: { loading: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="focus-ring w-full rounded-[20px] bg-[#1a1a1a] px-5 py-3.5 text-sm font-medium text-white transition-opacity disabled:cursor-wait disabled:opacity-55"
    >
      {loading ? "正在生成，请稍候…" : label}
    </button>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;

  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
      {message}
    </div>
  );
}

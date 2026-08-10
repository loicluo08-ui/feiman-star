import { KnowledgeManager } from "@/components/knowledge-manager";
import { getSystemKnowledgeStats } from "@/lib/kb";

export const metadata = {
  title: "知识库",
};

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const stats = await getSystemKnowledgeStats().catch(() => null);

  return (
    <>
      <section className="mx-auto max-w-3xl px-5 pt-12 sm:pt-16" aria-labelledby="system-kb-title">
        <div className="rounded-2xl border border-[#e5e5e7] bg-[#f7f7f8] p-6">
          <p className="text-sm font-medium text-[#8e8e93]">系统预置知识库</p>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 id="system-kb-title" className="text-2xl font-semibold tracking-tight">真实行业方法论，开箱即用</h1>
              <p className="mt-2 text-sm leading-6 text-[#6e6e73]">聊天会先检索相关知识片段，再交给AI生成回答。</p>
            </div>
            {stats ? <p className="text-sm font-medium">{stats.industries.length} 个行业 · {stats.chunks} 条 · {stats.files} 个文件</p> : null}
          </div>
          {stats ? (
            <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {stats.industries.map((item) => (
                <article key={item.industry} className="rounded-xl border border-[#e5e5e7] bg-white px-4 py-3">
                  <h2 className="text-sm font-medium">{item.industry}</h2>
                  <p className="mt-1 text-xs text-[#8e8e93]">{item.chunks} 条 · {item.files} 个文件</p>
                </article>
              ))}
            </div>
          ) : <p className="mt-5 text-sm text-[#8e8e93]">系统知识库统计暂时无法加载，不影响已上传资料管理。</p>}
        </div>
      </section>
      <KnowledgeManager />
    </>
  );
}

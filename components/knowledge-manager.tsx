"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { formatFileSize, MAX_UPLOAD_BYTES } from "@/lib/file-upload";

type KnowledgeFile = {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  chunk_count: number;
  created_at: string;
};

async function responseMessage(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string | { message?: string };
  };
  return typeof payload.error === "string" ? payload.error : payload.error?.message ?? "请求失败";
}

export function KnowledgeManager() {
  const [files, setFiles] = useState<KnowledgeFile[]>([]);
  const [selected, setSelected] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function loadFiles() {
    try {
      const response = await fetch("/api/documents", { cache: "no-store" });
      if (!response.ok) throw new Error(await responseMessage(response));
      const payload = (await response.json()) as { data: KnowledgeFile[] };
      setFiles(payload.data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "文档列表加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadFiles(); }, []);

  function chooseFile(file: File | null) {
    setError("");
    setMessage("");
    if (!file) return setSelected(null);
    const extension = file.name.toLowerCase().split(".").pop();
    if (!extension || !["txt", "md", "markdown", "pdf"].includes(extension)) {
      setSelected(null);
      return setError("仅支持 TXT、Markdown 和 PDF 文件。");
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setSelected(null);
      return setError("单个文件不能超过5MB。");
    }
    setSelected(file);
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setUploading(true);
    setError("");
    setMessage("");
    try {
      const body = new FormData();
      body.append("file", selected, selected.name);
      const response = await fetch("/api/upload", { method: "POST", body });
      if (!response.ok) throw new Error(await responseMessage(response));
      setMessage("文档已完成切片和向量化。");
      setSelected(null);
      if (inputRef.current) inputRef.current.value = "";
      await loadFiles();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "上传失败");
    } finally {
      setUploading(false);
    }
  }

  async function remove(id: string) {
    setError("");
    const response = await fetch(`/api/documents/${id}`, { method: "DELETE" });
    if (!response.ok) return setError(await responseMessage(response));
    setFiles((items) => items.filter((item) => item.id !== id));
    setMessage("文档已删除。");
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
      <header>
        <p className="text-sm font-medium text-[#8e8e93]">专属知识库</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">上传业务资料</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[#6e6e73]">文档会被切片并用于AI对话检索。支持TXT、Markdown、PDF，单个文件5MB，每个账户最多10个。</p>
      </header>

      <form onSubmit={upload} className="mt-8 rounded-2xl border border-[#e5e5e7] bg-[#f7f7f8] p-6">
        <input ref={inputRef} type="file" accept=".txt,.md,.markdown,.pdf,text/plain,text/markdown,application/pdf" onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} className="block w-full text-sm file:mr-4 file:rounded-lg file:border-0 file:bg-[#1a1a1a] file:px-4 file:py-2.5 file:text-sm file:font-medium file:text-white" />
        {selected ? <p className="mt-3 text-xs text-[#6e6e73]">{selected.name} · {formatFileSize(selected.size)}</p> : null}
        <button type="submit" disabled={!selected || uploading} className="focus-ring mt-5 h-11 rounded-xl bg-[#1a1a1a] px-5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40">
          {uploading ? "正在切片和向量化…" : "上传到知识库"}
        </button>
      </form>

      {message ? <p className="mt-5 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</p> : null}
      {error ? <p role="alert" className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

      <section className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">已上传文档</h2>
          <span className="text-xs text-[#8e8e93]">{files.length} / 10</span>
        </div>
        <div className="mt-4 divide-y divide-[#e5e5e7] rounded-2xl border border-[#e5e5e7] bg-white">
          {loading ? <p className="p-6 text-sm text-[#8e8e93]">正在加载…</p> : null}
          {!loading && files.length === 0 ? <p className="p-6 text-sm text-[#8e8e93]">还没有文档，上传第一份资料开始构建知识库。</p> : null}
          {files.map((file) => (
            <article key={file.id} className="flex items-center justify-between gap-4 p-5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{file.filename}</p>
                <p className="mt-1 text-xs text-[#8e8e93]">{formatFileSize(file.size_bytes)} · {file.chunk_count} 个片段 · {new Date(file.created_at).toLocaleDateString("zh-CN")}</p>
              </div>
              <button type="button" onClick={() => void remove(file.id)} className="focus-ring shrink-0 rounded-lg border border-[#e5e5e7] px-3 py-2 text-xs font-medium hover:border-[#1a1a1a]">删除</button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

"use client";

import { FormEvent, useEffect, useState } from "react";
import { FileRejection, useDropzone } from "react-dropzone";
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
  const [uploadProgress, setUploadProgress] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<KnowledgeFile | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

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

  function rejectFiles(rejections: FileRejection[]) {
    setSelected(null);
    setMessage("");
    const reason = rejections[0]?.errors[0]?.code;
    setError(reason === "file-too-large" ? "单个文件不能超过5MB。" : "仅支持 TXT、Markdown 和 PDF 文件。");
  }

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    accept: {
      "text/plain": [".txt"],
      "text/markdown": [".md", ".markdown"],
      "application/pdf": [".pdf"],
    },
    maxSize: MAX_UPLOAD_BYTES,
    maxFiles: 1,
    multiple: false,
    noClick: true,
    noKeyboard: true,
    disabled: uploading || files.length >= 10,
    onDropAccepted: ([file]) => chooseFile(file ?? null),
    onDropRejected: rejectFiles,
  });

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setUploading(true);
    setUploadProgress(8);
    setError("");
    setMessage("");
    const progressTimer = window.setInterval(() => {
      setUploadProgress((current) => Math.min(88, current + Math.max(2, Math.round((88 - current) / 7))));
    }, 450);
    try {
      const body = new FormData();
      body.append("file", selected, selected.name);
      const response = await fetch("/api/upload", { method: "POST", body });
      if (!response.ok) throw new Error(await responseMessage(response));
      setUploadProgress(100);
      setMessage("已加入对话上下文");
      setSelected(null);
      await loadFiles();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "上传失败");
    } finally {
      window.clearInterval(progressTimer);
      setUploading(false);
      window.setTimeout(() => setUploadProgress(0), 500);
    }
  }

  async function remove() {
    if (!pendingDelete) return;
    setDeleting(true);
    setError("");
    try {
      const response = await fetch(`/api/documents/${pendingDelete.id}`, { method: "DELETE" });
      if (!response.ok) return setError(await responseMessage(response));
      setFiles((items) => items.filter((item) => item.id !== pendingDelete.id));
      setMessage("文档已删除。");
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
      <header>
        <p className="text-sm font-medium text-[#8e8e93]">专属知识库</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">上传业务资料</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[#6e6e73]">文档会被切片并用于AI对话检索。支持TXT、Markdown、PDF，单个文件5MB，每个账户最多10个。</p>
      </header>

      <form onSubmit={upload} className="mt-8">
        <div {...getRootProps()} className={`rounded-2xl border border-dashed p-7 text-center transition-colors ${isDragActive ? "border-[#1a1a1a] bg-[#f0f0f2]" : "border-[#c7c7cc] bg-[#f7f7f8]"} ${files.length >= 10 ? "opacity-60" : ""}`}>
          <input {...getInputProps()} />
          <div className="mx-auto grid h-11 w-11 place-items-center rounded-xl border border-[#d1d1d6] bg-white text-xl" aria-hidden="true">↑</div>
          <p className="mt-4 text-sm font-medium">{isDragActive ? "松开即可选择" : "拖拽文档到这里"}</p>
          <p className="mt-1 text-xs text-[#8e8e93]">TXT / Markdown / PDF · 单文件不超过5MB</p>
          <button type="button" onClick={open} disabled={uploading || files.length >= 10} className="focus-ring mt-4 rounded-xl border border-[#d1d1d6] bg-white px-4 py-2.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40">{files.length >= 10 ? "已达到10份上限" : "选择文件"}</button>
        </div>
        {selected ? <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e5e5e7] px-4 py-3"><p className="min-w-0 truncate text-sm"><span className="font-medium">{selected.name}</span><span className="ml-2 text-xs text-[#8e8e93]">{formatFileSize(selected.size)}</span></p><button type="button" onClick={() => chooseFile(null)} disabled={uploading} className="focus-ring rounded-lg px-2 py-1 text-xs text-[#6e6e73]">移除</button></div> : null}
        <button type="submit" disabled={!selected || uploading} className="focus-ring mt-4 h-11 rounded-xl bg-[#1a1a1a] px-5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40">{uploading ? "正在切片和向量化…" : "上传到知识库"}</button>
        {uploadProgress > 0 ? <div className="mt-4" aria-label={`上传进度 ${uploadProgress}%`}><div className="h-1.5 overflow-hidden rounded-full bg-[#e5e5e7]"><div className="h-full rounded-full bg-[#1a1a1a] transition-[width] duration-300" style={{ width: `${uploadProgress}%` }} /></div><p className="mt-2 text-xs text-[#8e8e93]">{uploadProgress < 100 ? `正在处理 ${uploadProgress}%` : "处理完成"}</p></div> : null}
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
          {!loading && files.length === 0 ? <div className="p-6"><p className="text-sm font-medium">系统已预置12个行业知识库，可直接对话体验。</p><p className="mt-1 text-sm text-[#8e8e93]">也可上传自己的资料。</p></div> : null}
          {files.map((file) => (
            <article key={file.id} className="flex items-center justify-between gap-4 p-5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{file.filename}</p>
                <p className="mt-1 text-xs text-[#8e8e93]">{formatFileSize(file.size_bytes)} · {file.chunk_count} 个片段 · {new Date(file.created_at).toLocaleDateString("zh-CN")}</p>
              </div>
              <button type="button" onClick={() => setPendingDelete(file)} className="focus-ring shrink-0 rounded-lg border border-[#e5e5e7] px-3 py-2 text-xs font-medium hover:border-[#1a1a1a]">删除</button>
            </article>
          ))}
        </div>
      </section>

      {pendingDelete ? <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 px-5" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !deleting) setPendingDelete(null); }}><div role="dialog" aria-modal="true" aria-labelledby="delete-title" className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"><h2 id="delete-title" className="text-lg font-semibold">确认删除文档？</h2><p className="mt-2 break-all text-sm leading-6 text-[#6e6e73]">“{pendingDelete.filename}”及其所有知识片段会被永久移除。</p><div className="mt-6 flex justify-end gap-2"><button type="button" disabled={deleting} onClick={() => setPendingDelete(null)} className="focus-ring rounded-xl border border-[#d1d1d6] px-4 py-2.5 text-sm">取消</button><button type="button" disabled={deleting} onClick={() => void remove()} className="focus-ring rounded-xl bg-[#1a1a1a] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{deleting ? "删除中…" : "确认删除"}</button></div></div></div> : null}
    </div>
  );
}

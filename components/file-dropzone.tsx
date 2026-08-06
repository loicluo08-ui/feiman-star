"use client";

import { useState } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { formatFileSize, MAX_UPLOAD_BYTES } from "@/lib/file-upload";

function rejectionMessage(rejections: FileRejection[]) {
  const firstError = rejections[0]?.errors[0];
  if (!firstError) return null;
  if (firstError.code === "file-too-large") return "单个文件不能超过 5MB。";
  if (firstError.code === "too-many-files") return "每次只能导入一个文件。";
  return "仅支持 PDF、Word（.docx）、TXT 和 Markdown 文件。";
}

export function FileDropzone({
  label,
  description,
  file,
  onFileChange,
  disabled = false,
}: {
  label: string;
  description: string;
  file: File | null;
  onFileChange: (file: File | null) => void;
  disabled?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      "application/pdf": [".pdf"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
      "text/plain": [".txt", ".md", ".markdown"],
      "text/markdown": [".md", ".markdown"],
    },
    disabled,
    maxFiles: 1,
    maxSize: MAX_UPLOAD_BYTES,
    multiple: false,
    onDropAccepted: ([acceptedFile]) => {
      onFileChange(acceptedFile ?? null);
      setError(null);
    },
    onDropRejected: (rejections) => setError(rejectionMessage(rejections)),
  });

  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="mt-1 text-xs leading-5 text-[#8e8e93]">{description}</p>
        </div>
        <span className="shrink-0 text-xs text-[#8e8e93]">最大 5MB</span>
      </div>

      <div
        {...getRootProps()}
        className={`focus-ring mt-3 rounded-xl border border-dashed px-4 py-5 text-center transition-colors ${
          disabled
            ? "cursor-not-allowed border-[#e5e5e7] bg-[#fafafa] opacity-60"
            : isDragActive
              ? "cursor-copy border-[#1a1a1a] bg-[#f7f7f8]"
              : "cursor-pointer border-[#d2d2d7] bg-[#fafafa] hover:border-[#8e8e93]"
        }`}
      >
        <input {...getInputProps()} />
        {file ? (
          <div className="flex items-center justify-between gap-3 text-left">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{file.name}</p>
              <p className="mt-1 text-xs text-[#8e8e93]">{formatFileSize(file.size)} · 仅用于本次生成</p>
            </div>
            <button
              type="button"
              disabled={disabled}
              onClick={(event) => {
                event.stopPropagation();
                onFileChange(null);
                setError(null);
              }}
              className="focus-ring shrink-0 rounded-full border border-[#d2d2d7] bg-white px-3 py-1.5 text-xs font-medium hover:border-[#1a1a1a] disabled:cursor-not-allowed"
            >
              移除
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm font-medium">{isDragActive ? "松开即可导入" : "拖拽文件到这里，或点击选择"}</p>
            <p className="mt-1.5 text-xs leading-5 text-[#8e8e93]">PDF · Word（.docx）· TXT · Markdown</p>
          </>
        )}
      </div>
      {error ? <p className="mt-2 text-xs text-[#b42318]" role="alert">{error}</p> : null}
    </div>
  );
}

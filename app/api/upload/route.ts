import { extname } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { PublicApiError, apiErrorResponse } from "@/lib/api-error";
import { extractUploadedFile } from "@/lib/file-extractor";
import { getAuthenticatedUser } from "@/lib/server-auth";
import { createSupabaseAdminClient, SupabaseConfigError } from "@/lib/supabase";
import { chunkText } from "@/lib/text-chunker";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { createEmbeddingsInBatches, ZhipuConfigError } from "@/lib/zhipu";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ragExtensions = new Set([".txt", ".md", ".markdown", ".pdf"]);
const mimeTypesByExtension: Record<string, Set<string>> = {
  ".txt": new Set(["text/plain"]),
  ".md": new Set(["text/markdown", "text/plain", "text/x-markdown"]),
  ".markdown": new Set(["text/markdown", "text/plain", "text/x-markdown"]),
  ".pdf": new Set(["application/pdf"]),
};

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "upload", RATE_LIMITS.upload);
  if (limited) {
    return NextResponse.json(
      { error: `上传过于频繁，请${limited.retryAfter}秒后重试` },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }
  const auth = await getAuthenticatedUser();
  if (!auth) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "请先登录后上传文档。" } },
      { status: 401 },
    );
  }

  let fileId: string | null = null;
  try {
    const body = await request.formData();
    const file = body.get("file");
    if (!(file instanceof File)) {
      throw new PublicApiError(400, "FILE_REQUIRED", "请选择要上传的文件。");
    }

    const extension = extname(file.name).toLowerCase();
    if (!ragExtensions.has(extension)) {
      throw new PublicApiError(400, "UNSUPPORTED_FILE_TYPE", "知识库仅支持 TXT、Markdown 和 PDF 文件。");
    }
    const mimeType = file.type.toLowerCase().split(";", 1)[0];
    if (mimeType && !mimeTypesByExtension[extension]?.has(mimeType)) {
      throw new PublicApiError(400, "FILE_TYPE_MISMATCH", "文件类型与扩展名不一致，请重新选择。");
    }

    const extracted = await extractUploadedFile(file);
    let chunks: string[];
    try {
      chunks = chunkText(extracted.text);
    } catch (error) {
      if (error instanceof Error && error.message === "EXTRACTED_TEXT_TOO_LARGE") {
        throw new PublicApiError(413, "TEXT_TOO_LARGE", "文档文字内容过长，请拆分后上传。");
      }
      throw error;
    }
    if (chunks.length === 0) {
      throw new PublicApiError(400, "EMPTY_FILE_CONTENT", "文件中没有可用文字。");
    }

    const admin = createSupabaseAdminClient();
    const { data: createdFileId, error: createError } = await admin.rpc("create_knowledge_file", {
      p_user_id: auth.user.id,
      p_filename: extracted.fileName,
      p_mime_type: mimeType || "application/octet-stream",
      p_size_bytes: file.size,
    });
    if (createError) {
      if (
        createError.message.includes("document_limit_reached") ||
        createError.message.includes("最多上传10个文档")
      ) {
        throw new PublicApiError(409, "DOCUMENT_LIMIT", "每个用户最多上传10个文档。");
      }
      throw createError;
    }
    if (typeof createdFileId !== "string") throw new Error("FILE_ID_MISSING");
    fileId = createdFileId;

    // Reserve the user's document slot before paying for embedding work. If any
    // later step fails, the catch block deletes this row and its cascaded chunks.
    const embeddings = await createEmbeddingsInBatches(chunks);

    const rows = chunks.map((content, index) => ({
      file_id: fileId,
      user_id: auth.user.id,
      filename: extracted.fileName,
      content,
      embedding: embeddings[index],
    }));

    for (let index = 0; index < rows.length; index += 100) {
      const { error } = await admin.from("documents").insert(rows.slice(index, index + 100));
      if (error) throw error;
    }
    const { error: updateError } = await admin
      .from("knowledge_files")
      .update({ chunk_count: chunks.length })
      .eq("id", fileId)
      .eq("user_id", auth.user.id);
    if (updateError) throw updateError;

    return NextResponse.json(
      { data: { id: fileId, filename: extracted.fileName, chunks: chunks.length } },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (fileId) {
      try {
        await createSupabaseAdminClient().from("knowledge_files").delete().eq("id", fileId);
      } catch {
        console.error("[upload] cleanup_failed");
      }
    }
    if (error instanceof ZhipuConfigError) {
      return NextResponse.json(
        { error: { code: "EMBEDDING_NOT_CONFIGURED", message: "文档向量化服务尚未配置。" } },
        { status: 503 },
      );
    }
    if (error instanceof SupabaseConfigError) {
      return NextResponse.json(
        { error: { code: "KNOWLEDGE_NOT_CONFIGURED", message: "知识库服务尚未配置。" } },
        { status: 503 },
      );
    }
    return apiErrorResponse(error);
  }
}

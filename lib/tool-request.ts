import "server-only";

import type { ZodType } from "zod";
import { PublicApiError } from "@/lib/api-error";
import { extractUploadedFile, type ExtractedUpload } from "@/lib/file-extractor";

export async function parseToolRequest<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<{ input: T; upload: ExtractedUpload | null }> {
  const contentType = request.headers.get("content-type") ?? "";

  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return { input: schema.parse(await request.json()), upload: null };
  }

  const formData = await request.formData();
  const rawInput = formData.get("input");
  if (typeof rawInput !== "string") {
    throw new PublicApiError(400, "INVALID_INPUT", "缺少表单输入，请检查后重试。");
  }

  let parsedInput: unknown;
  try {
    parsedInput = JSON.parse(rawInput);
  } catch {
    throw new PublicApiError(400, "INVALID_INPUT", "表单输入格式不正确，请检查后重试。");
  }

  const fileEntry = formData.get("file");
  if (typeof fileEntry === "string") {
    throw new PublicApiError(400, "INVALID_FILE", "上传文件格式不正确，请重新选择。");
  }

  return {
    input: schema.parse(parsedInput),
    upload: fileEntry ? await extractUploadedFile(fileEntry) : null,
  };
}

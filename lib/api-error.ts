import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class PublicApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function apiErrorResponse(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_INPUT",
          message: error.issues[0]?.message ?? "提交内容格式不正确，请检查后重试。",
        },
      },
      { status: 400 },
    );
  }

  if (error instanceof PublicApiError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }

  console.error("[api] unexpected_error");
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "服务暂时不可用，请稍后重试。" } },
    { status: 500 },
  );
}

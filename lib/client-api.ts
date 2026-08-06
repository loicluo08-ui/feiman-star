type ErrorPayload = { error?: { message?: string } };

async function readApiResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as ErrorPayload & { data?: T };
  if (!response.ok || !payload.data) {
    throw new Error(payload.error?.message ?? "生成失败，请稍后重试。");
  }

  return payload.data;
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  let response: Response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("网络连接失败，请检查网络后重试。");
  }

  return readApiResponse<T>(response);
}

export async function postFormData<T>(url: string, input: unknown, file: File): Promise<T> {
  const body = new FormData();
  body.append("input", JSON.stringify(input));
  body.append("file", file, file.name);

  let response: Response;
  try {
    response = await fetch(url, { method: "POST", body });
  } catch {
    throw new Error("网络连接失败，请检查网络后重试。");
  }

  return readApiResponse<T>(response);
}

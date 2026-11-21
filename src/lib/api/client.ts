"use client";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly details?: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
  }
}

async function parse<T>(res: Response): Promise<T> {
  const requestId = res.headers.get("x-request-id") ?? undefined;
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = (body as { error?: { message?: string; code?: string; details?: unknown } } | null)?.error;
    if (res.status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    const detail = Array.isArray(err?.details) ? (err.details as { path?: string; message?: string }[]).map((d) => `${d.path ? `${d.path}: ` : ""}${d.message}`).join("; ") : "";
    throw new ApiError(detail ? `${err?.message ?? "Request failed"} — ${detail}` : (err?.message ?? `Request failed (${res.status})`), res.status, err?.code, err?.details, requestId);
  }
  return (body as { data: T }).data;
}

export function qs(params: object): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export async function apiGet<T>(url: string): Promise<T> {
  return parse<T>(await fetch(url, { credentials: "same-origin", headers: { accept: "application/json" } }));
}

export async function apiSend<T>(url: string, method: "POST" | "PATCH" | "PUT" | "DELETE", body?: unknown): Promise<T> {
  return parse<T>(
    await fetch(url, {
      method,
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

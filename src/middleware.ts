import { NextResponse, type NextRequest } from "next/server";

const COOKIE = process.env.NODE_ENV === "production" ? "__Host-gf_session" : "gf_session";
const PROTECTED = ["/dashboard", "/employees", "/projects", "/teams", "/activity", "/billing", "/simulator", "/reports", "/audit-logs", "/settings"];

/**
 * Edge middleware: attaches a request id and redirects visitors without a
 * session cookie away from app pages. The cookie is fully validated (and the
 * role checked) on the server in layouts and route handlers — this is only a
 * fast first gate.
 */
export function middleware(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { pathname } = req.nextUrl;
  if (PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`)) && !req.cookies.get(COOKIE)) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }
  const headers = new Headers(req.headers);
  headers.set("x-request-id", requestId);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("x-request-id", requestId);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

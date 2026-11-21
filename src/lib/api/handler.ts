import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { AppError, forbidden, tooManyRequests, unauthorized } from "./errors";
import { rateLimit } from "./rate-limit";
import { resolveSessionToken, type SessionUser } from "@/services/auth/session-store";
import { resolveDeviceToken, type DeviceIdentity } from "@/services/devices/device-auth";
import { withRls, type DbScope } from "@/lib/db/context";
import { can, type Capability } from "@/lib/permissions";

const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-gf_session" : "gf_session";

export interface RouteContext<P> {
  req: NextRequest;
  params: P;
  requestId: string;
  /** Present when auth !== "none" (or optional and logged in). */
  user: SessionUser | null;
  /** Present when a device bearer token authenticated the request. */
  device: DeviceIdentity | null;
  /** Run service code in an RLS-scoped transaction as the current user. */
  scope: <T>(fn: (scope: DbScope) => Promise<T>) => Promise<T>;
  json: <S extends ZodTypeAny>(schema: S) => Promise<z.infer<S>>;
  query: <S extends ZodTypeAny>(schema: S) => z.infer<S>;
  ip: string;
}

interface RouteOptions {
  /** "required" (default): session cookie. "device": session cookie OR device bearer token. */
  auth?: "required" | "optional" | "none" | "device";
  capability?: Capability;
  rateLimit?: { name: string; limit: number; windowSeconds: number; by?: "ip" | "user" };
}

type Handler<P> = (ctx: RouteContext<P>) => Promise<unknown>;

export function json(data: unknown, init: { status?: number; meta?: unknown; headers?: HeadersInit } = {}) {
  return NextResponse.json(init.meta ? { data, meta: init.meta } : { data }, {
    status: init.status ?? 200,
    headers: init.headers,
  });
}

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "127.0.0.1"
  );
}

/**
 * CSRF defence for cookie-authenticated, state-changing requests:
 * SameSite=Lax cookies plus a strict Origin / Sec-Fetch-Site check.
 */
function assertSameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (origin) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    const appHost = (() => {
      try {
        return new URL(process.env.APP_URL ?? "").host;
      } catch {
        return null;
      }
    })();
    if (originHost && (originHost === host || originHost === appHost)) return;
    throw forbidden("Cross-origin request rejected");
  }
  const site = req.headers.get("sec-fetch-site");
  if (site === "same-origin" || site === "none") return;
  throw forbidden("Missing Origin header on state-changing request");
}

function errorResponse(err: unknown, requestId: string) {
  const headers = { "x-request-id": requestId };
  if (err instanceof AppError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, details: err.details }, requestId },
      { status: err.status, headers },
    );
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
        requestId,
      },
      { status: 422, headers },
    );
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002")
      return NextResponse.json(
        { error: { code: "CONFLICT", message: "A record with these values already exists" }, requestId },
        { status: 409, headers },
      );
    if (err.code === "P2025")
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Resource not found" }, requestId },
        { status: 404, headers },
      );
  }
  const message = err instanceof Error ? err.message : String(err);
  // PostgreSQL insufficient_privilege / RLS violations surface as 403.
  if (/row-level security|insufficient privilege|42501|permission denied|append-only|cannot review|immutable|only the/i.test(message)) {
    const clean = message.match(/(approved timesheets are immutable|users cannot review their own timesheets|only the [^"\n]+)/i);
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: clean ? clean[1] : "Operation not permitted" }, requestId },
      { status: 403, headers },
    );
  }
  console.error(`[api] ${requestId} unhandled error:`, err);
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" }, requestId },
    { status: 500, headers },
  );
}

export function route<P extends Record<string, string> = Record<string, string>>(
  options: RouteOptions,
  handler: Handler<P>,
) {
  return async (req: NextRequest, context: { params: Promise<P> }): Promise<Response> => {
    const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
    try {
      const auth = options.auth ?? "required";
      const ip = clientIp(req);
      let user: SessionUser | null = null;
      let device: DeviceIdentity | null = null;

      const bearer = req.headers.get("authorization");
      if (auth === "device" && bearer?.startsWith("Bearer ")) {
        device = await resolveDeviceToken(bearer.slice(7).trim());
        if (!device) throw unauthorized("Invalid device token");
      } else if (auth !== "none") {
        user = await resolveSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
        if (!user && auth !== "optional") throw unauthorized();
      }

      const mutating = !["GET", "HEAD", "OPTIONS"].includes(req.method);
      if (mutating && !device) assertSameOrigin(req);

      if (options.capability && user && !can(user.role, options.capability)) throw forbidden();

      if (options.rateLimit) {
        const rl = options.rateLimit;
        const who = rl.by === "user" && (user || device) ? (user?.userId ?? device!.userId) : ip;
        const result = await rateLimit(`${rl.name}:${who}`, rl.limit, rl.windowSeconds);
        if (!result.allowed) throw tooManyRequests();
      }

      const actor = user
        ? { userId: user.userId, organizationId: user.organizationId, role: user.role, teamId: user.teamId }
        : device
          ? { userId: device.userId, organizationId: device.organizationId, role: device.role }
          : null;

      const ctx: RouteContext<P> = {
        req,
        params: (await context.params) ?? ({} as P),
        requestId,
        user,
        device,
        ip,
        scope: (fn) => {
          if (!actor) throw unauthorized();
          return withRls(actor, (tx) => fn({ tx, actor, requestId }));
        },
        json: async (schema) => {
          let body: unknown;
          try {
            body = await req.json();
          } catch {
            throw new AppError(400, "INVALID_JSON", "Request body must be valid JSON");
          }
          return schema.parse(body);
        },
        query: (schema) => schema.parse(Object.fromEntries(req.nextUrl.searchParams.entries())),
      };

      const result = await handler(ctx);
      const response = result instanceof Response ? result : json(result);
      response.headers.set("x-request-id", requestId);
      return response;
    } catch (err) {
      return errorResponse(err, requestId);
    }
  };
}

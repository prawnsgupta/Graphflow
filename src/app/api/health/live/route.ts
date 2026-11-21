import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Liveness probe: the web process is up (no dependency checks). */
export function GET() {
  return NextResponse.json({ status: "ok" });
}

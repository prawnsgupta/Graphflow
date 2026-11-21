import { NextResponse } from "next/server";
import { buildOpenApi } from "@/lib/openapi";

export function GET() {
  return NextResponse.json(buildOpenApi(process.env.APP_URL ?? "http://localhost:3000"));
}

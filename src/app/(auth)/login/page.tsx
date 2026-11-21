import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const DEMO_ACCOUNTS = [
  { role: "Organization admin", email: "admin@graphflow.demo" },
  { role: "Project manager", email: "olivia.pm@graphflow.demo" },
  { role: "Team lead", email: "priya.lead@graphflow.demo" },
  { role: "Employee", email: "liam@graphflow.demo" },
];

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getSession()) redirect("/dashboard");
  const { next } = await searchParams;
  const demo = process.env.DEMO_MODE === "true" && process.env.NODE_ENV !== "production";
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  return <LoginForm next={safeNext} demoAccounts={demo ? DEMO_ACCOUNTS : []} demoPassword={demo ? "GraphFlow!2026" : undefined} />;
}

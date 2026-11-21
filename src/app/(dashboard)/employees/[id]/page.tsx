import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { EmployeeDetailView } from "@/components/employees/employee-detail-view";

export const metadata: Metadata = { title: "Employee" };

export default async function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  // Employees may open their own profile; others need employees:view (re-checked by the API + RLS).
  const session = await requirePageSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  if (id !== session.userId) await requirePageSession("employees:view");
  return <EmployeeDetailView id={id} />;
}

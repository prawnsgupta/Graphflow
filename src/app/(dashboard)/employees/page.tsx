import type { Metadata } from "next";
import { requirePageSession } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { EmployeesView } from "@/components/employees/employees-view";

export const metadata: Metadata = { title: "Employees" };

export default async function EmployeesPage() {
  const session = await requirePageSession("employees:view");
  return <EmployeesView canManage={can(session.role, "employees:manage")} />;
}

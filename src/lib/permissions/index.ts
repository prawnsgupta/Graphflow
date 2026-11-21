/**
 * Role capability matrix. Shared by server-side authorization checks and the
 * client navigation. The client copy is only used to hide UI — every action
 * is re-authorized on the server (application checks + PostgreSQL RLS).
 */
export type Role = "SUPER_ADMIN" | "ORG_ADMIN" | "PROJECT_MANAGER" | "TEAM_LEAD" | "EMPLOYEE";

export const ROLES: Role[] = ["SUPER_ADMIN", "ORG_ADMIN", "PROJECT_MANAGER", "TEAM_LEAD", "EMPLOYEE"];

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  ORG_ADMIN: "Organization Admin",
  PROJECT_MANAGER: "Project Manager",
  TEAM_LEAD: "Team Lead",
  EMPLOYEE: "Employee",
};

export type Capability =
  | "employees:view"
  | "employees:manage"
  | "teams:view"
  | "teams:manage"
  | "projects:view"
  | "projects:create"
  | "projects:manage"
  | "activity:view"
  | "activity:raw"
  | "billing:view"
  | "billing:review"
  | "billing:audit"
  | "simulator:use"
  | "simulator:others"
  | "reports:view"
  | "reports:organization"
  | "audit:view"
  | "settings:organization"
  | "tools:manage";

const MATRIX: Record<Role, Capability[]> = {
  SUPER_ADMIN: [
    "employees:view", "employees:manage", "teams:view", "teams:manage", "projects:view", "projects:create",
    "projects:manage", "activity:view", "activity:raw", "billing:view", "billing:review", "billing:audit",
    "simulator:use", "simulator:others", "reports:view", "reports:organization", "audit:view",
    "settings:organization", "tools:manage",
  ],
  ORG_ADMIN: [
    "employees:view", "employees:manage", "teams:view", "teams:manage", "projects:view", "projects:create",
    "projects:manage", "activity:view", "activity:raw", "billing:view", "billing:review", "billing:audit",
    "simulator:use", "simulator:others", "reports:view", "reports:organization", "audit:view",
    "settings:organization", "tools:manage",
  ],
  PROJECT_MANAGER: [
    "employees:view", "teams:view", "projects:view", "projects:create", "projects:manage", "activity:view",
    "billing:view", "billing:review", "billing:audit", "simulator:use", "simulator:others", "reports:view",
    "audit:view",
  ],
  TEAM_LEAD: [
    "employees:view", "teams:view", "projects:view", "activity:view", "billing:view", "simulator:use",
    "simulator:others", "reports:view",
  ],
  EMPLOYEE: ["projects:view", "activity:view", "billing:view", "simulator:use", "reports:view"],
};

export function can(role: Role | string | null | undefined, capability: Capability): boolean {
  if (!role || !(role in MATRIX)) return false;
  return MATRIX[role as Role].includes(capability);
}

export const isAdmin = (role: string | null | undefined) => role === "SUPER_ADMIN" || role === "ORG_ADMIN";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  capability?: Capability;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: "LayoutDashboard" },
  { href: "/employees", label: "Employees", icon: "Users", capability: "employees:view" },
  { href: "/projects", label: "Projects", icon: "FolderKanban", capability: "projects:view" },
  { href: "/teams", label: "Teams", icon: "UsersRound", capability: "teams:view" },
  { href: "/activity", label: "Activity", icon: "Activity", capability: "activity:view" },
  { href: "/billing", label: "Billing", icon: "Receipt", capability: "billing:view" },
  { href: "/simulator", label: "Simulator", icon: "MonitorPlay", capability: "simulator:use" },
  { href: "/reports", label: "Reports", icon: "FileBarChart", capability: "reports:view" },
  { href: "/audit-logs", label: "Audit Logs", icon: "ScrollText", capability: "audit:view" },
  { href: "/settings", label: "Settings", icon: "Settings" },
];

export function navFor(role: Role | string): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.capability || can(role, item.capability));
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Activity,
  FileBarChart,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  MonitorPlay,
  Receipt,
  ScrollText,
  Settings,
  ShieldAlert,
  Users,
  UsersRound,
  FlaskConical,
} from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Logo } from "./logo";
import { navFor, ROLE_LABELS, type Role } from "@/lib/permissions";
import { apiSend } from "@/lib/api/client";
import { cn } from "@/lib/utils";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard,
  Users,
  FolderKanban,
  UsersRound,
  Activity,
  Receipt,
  MonitorPlay,
  FileBarChart,
  ScrollText,
  Settings,
};

export interface ShellUser {
  displayName: string;
  email: string;
  role: Role;
  trackingConsent: boolean;
  organization: { name: string; timezone: string; isDemo: boolean };
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function NavList({ role, onNavigate }: { role: Role; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Main navigation">
      {navFor(role).map((item) => {
        const Icon = ICONS[item.icon] ?? LayoutDashboard;
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
              active ? "bg-sidebar-accent text-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
            )}
          >
            <Icon className={cn("size-4", active ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarBody({ user, onNavigate }: { user: ShellUser; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center px-4">
        <Link href="/dashboard" onClick={onNavigate}>
          <Logo />
        </Link>
      </div>
      <div className="px-3 pb-3">
        <div className="rounded-md border border-sidebar-border bg-background/40 px-2.5 py-2">
          <p className="truncate text-xs font-medium text-foreground">{user.organization.name}</p>
          <p className="text-[11px] text-muted-foreground">{user.organization.timezone}</p>
        </div>
      </div>
      <div className="scrollbar-thin flex-1 overflow-y-auto px-3">
        <NavList role={user.role} onNavigate={onNavigate} />
      </div>
      <div className="border-t border-sidebar-border p-3 text-[11px] leading-relaxed text-muted-foreground">
        Metadata-only tracking. No screenshots, keystrokes, clipboard or content capture.
      </div>
    </div>
  );
}

export function AppShell({ user, children }: { user: ShellUser; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  const logout = async () => {
    try {
      await apiSend("/api/auth/logout", "POST");
    } catch {
      /* ignore */
    }
    toast.success("Signed out");
    // Full navigation: drops every cached query and server component payload.
    window.location.assign("/login");
  };

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-sidebar-border bg-sidebar lg:block">
        <SidebarBody user={user} />
      </aside>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-64 border-sidebar-border bg-sidebar p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarBody user={user} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="lg:pl-60">
        {user.organization.isDemo && (
          <div className="flex items-center justify-center gap-2 border-b border-warning/20 bg-warning/10 px-4 py-1.5 text-center text-xs text-warning">
            <FlaskConical className="size-3.5 shrink-0" />
            <span>
              <strong className="font-semibold">DEMO environment</strong> — all activity data is simulated.
            </span>
          </div>
        )}
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur sm:px-6">
          <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation">
            <Menu />
          </Button>
          <div className="lg:hidden">
            <Logo withText={false} />
          </div>
          <div className="flex-1" />
          {!user.trackingConsent && (
            <Link href="/settings?tab=consent" className="hidden items-center gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1 text-xs text-warning sm:flex">
              <ShieldAlert className="size-3.5" /> Tracking consent not granted
            </Link>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-secondary" aria-label="Account menu">
                <Avatar className="size-7">
                  <AvatarFallback className="bg-primary/15 text-xs text-primary">{initials(user.displayName)}</AvatarFallback>
                </Avatar>
                <span className="hidden flex-col sm:flex">
                  <span className="text-xs font-medium leading-tight">{user.displayName}</span>
                  <span className="text-[11px] leading-tight text-muted-foreground">{ROLE_LABELS[user.role]}</span>
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <p className="text-sm font-medium">{user.displayName}</p>
                <p className="truncate text-xs text-muted-foreground">{user.email}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/settings">
                  <Settings /> Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={logout}>
                <LogOut /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:py-8">{children}</main>
      </div>
    </div>
  );
}

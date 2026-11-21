"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Copy, MailPlus, MoreHorizontal, Search, UserCog, X } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useApi, useApiMutation } from "@/hooks/use-api";
import { qs } from "@/lib/api/client";
import { inviteSchema } from "@/lib/validation/forms";
import { ROLE_LABELS, ROLES } from "@/lib/permissions";
import type { Page } from "@/types/api";
import { PageHeader } from "@/components/shared/page-header";
import { FilterSelect, Pagination } from "@/components/shared/filters";
import { EmptyState, ErrorState, LoadingRows, Spinner } from "@/components/shared/states";
import { RoleBadge, ToneBadge } from "@/components/shared/badges";
import { formatDate } from "@/components/shared/format";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";

interface Employee {
  id: string;
  displayName: string;
  email: string;
  role: string;
  title: string | null;
  teamId: string | null;
  isActive: boolean;
  trackingConsent: boolean;
  lastLoginAt: string | null;
  team: { id: string; name: string } | null;
  _count: { projectMemberships: number };
}
interface Team {
  id: string;
  name: string;
}
interface Invitation {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  invitedBy: { displayName: string };
}

export function EmployeesView({ canManage }: { canManage: boolean }) {
  const [search, setSearch] = useState("");
  const [teamId, setTeamId] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("active");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [inviting, setInviting] = useState(false);

  const url = `/api/employees${qs({ search, teamId, role, status, page, pageSize: 20 })}`;
  const list = useApi<Page<Employee>>(["employees", search, teamId, role, status, page], url);
  const teams = useApi<Team[]>(["teams"], "/api/teams");
  const invitations = useApi<Invitation[]>(["invitations"], canManage ? "/api/invitations" : null);
  const revoke = useApiMutation<{ id: string }>("DELETE", (b) => `/api/invitations/${b.id}`, { success: "Invitation revoked", invalidate: [["invitations"]] });
  const toggle = useApiMutation<{ id: string; isActive: boolean }>("PATCH", (b) => `/api/employees/${b.id}`, {
    success: (r) => ((r as unknown as Employee).isActive ? "Employee activated" : "Employee deactivated"),
    invalidate: [["employees"]],
  });

  return (
    <div>
      <PageHeader
        title="Employees"
        description="People in your organization you are allowed to see. Activity visibility follows role-based access rules."
        actions={
          canManage && (
            <Button onClick={() => setInviting(true)}>
              <MailPlus /> Invite employee
            </Button>
          )
        }
      />
      <Card className="gap-0 py-4">
        <CardContent className="px-4">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                placeholder="Search name or email"
                className="h-9 w-[240px] pl-8"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                aria-label="Search employees"
              />
            </div>
            <FilterSelect label="Team" value={teamId} onChange={(v) => { setTeamId(v); setPage(1); }} allLabel="All teams" options={(teams.data ?? []).map((t) => ({ value: t.id, label: t.name }))} />
            <FilterSelect label="Role" value={role} onChange={(v) => { setRole(v); setPage(1); }} allLabel="All roles" options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
            <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
              <SelectTrigger className="h-9 w-[140px]" aria-label="Status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Deactivated</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {list.error ? (
            <ErrorState message={list.error.message} onRetry={() => list.refetch()} />
          ) : list.isLoading ? (
            <LoadingRows rows={8} />
          ) : list.data!.items.length === 0 ? (
            <EmptyState title="No employees match these filters" />
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Team</TableHead>
                      <TableHead className="text-right">Projects</TableHead>
                      <TableHead>Consent</TableHead>
                      <TableHead>Last login</TableHead>
                      <TableHead>Status</TableHead>
                      {canManage && <TableHead className="w-10" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.data!.items.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell>
                          <Link href={`/employees/${e.id}`} className="font-medium hover:text-primary">
                            {e.displayName}
                          </Link>
                          <p className="text-xs text-muted-foreground">{e.email}</p>
                        </TableCell>
                        <TableCell>
                          <RoleBadge role={e.role} />
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{e.team?.name ?? "—"}</TableCell>
                        <TableCell className="tabular text-right">{e._count.projectMemberships}</TableCell>
                        <TableCell>{e.trackingConsent ? <ToneBadge tone="success">Granted</ToneBadge> : <ToneBadge tone="warning">Not granted</ToneBadge>}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatDate(e.lastLoginAt)}</TableCell>
                        <TableCell>{e.isActive ? <ToneBadge tone="success">Active</ToneBadge> : <ToneBadge>Deactivated</ToneBadge>}</TableCell>
                        {canManage && (
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${e.displayName}`}>
                                  <MoreHorizontal />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => setEditing(e)}>
                                  <UserCog /> Edit role & team
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => toggle.mutate({ id: e.id, isActive: !e.isActive })}>
                                  {e.isActive ? "Deactivate" : "Activate"}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Pagination page={page} pageSize={20} total={list.data!.total} onPage={setPage} />
            </>
          )}
        </CardContent>
      </Card>

      {canManage && (invitations.data?.length ?? 0) > 0 && (
        <Card className="mt-4 gap-3 py-4">
          <CardContent className="px-4">
            <p className="mb-3 text-sm font-medium">Pending invitations</p>
            <div className="divide-y divide-border">
              {invitations.data!.map((i) => (
                <div key={i.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                  <span className="font-medium">{i.email}</span>
                  <RoleBadge role={i.role} />
                  <span className="text-xs text-muted-foreground">invited by {i.invitedBy.displayName} · expires {formatDate(i.expiresAt)}</span>
                  <ConfirmDialog
                    trigger={
                      <Button variant="ghost" size="sm" className="ml-auto">
                        <X /> Revoke
                      </Button>
                    }
                    title="Revoke invitation?"
                    description={`${i.email} will no longer be able to use this invitation link.`}
                    confirmLabel="Revoke"
                    destructive
                    onConfirm={() => revoke.mutateAsync({ id: i.id })}
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {canManage && <InviteDialog open={inviting} onOpenChange={setInviting} teams={teams.data ?? []} />}
      {canManage && editing && <EditDialog employee={editing} teams={teams.data ?? []} onClose={() => setEditing(null)} />}
    </div>
  );
}

function InviteDialog({ open, onOpenChange, teams }: { open: boolean; onOpenChange: (o: boolean) => void; teams: Team[] }) {
  const [link, setLink] = useState<string | null>(null);
  const form = useForm<z.input<typeof inviteSchema>>({ resolver: zodResolver(inviteSchema), defaultValues: { email: "", displayName: "", role: "EMPLOYEE", teamId: "" } });
  const invite = useApiMutation<z.input<typeof inviteSchema>, { inviteUrl: string }>("POST", "/api/employees", {
    success: "Invitation created",
    invalidate: [["invitations"]],
    onSuccess: (r) => setLink(r.inviteUrl),
  });
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setLink(null);
      form.reset();
    }
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite an employee</DialogTitle>
          <DialogDescription>They will set their own password and choose whether to grant tracking consent.</DialogDescription>
        </DialogHeader>
        {link ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Email delivery is not configured. Share this one-time link securely (it is shown only once):</p>
            <div className="flex gap-2">
              <Input readOnly value={link} className="font-mono text-xs" aria-label="Invitation link" />
              <Button
                variant="outline"
                size="icon"
                aria-label="Copy link"
                onClick={() => {
                  void navigator.clipboard.writeText(link);
                  toast.success("Link copied");
                }}
              >
                <Copy />
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={() => close(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={form.handleSubmit((v) => invite.mutate(v))} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="inv-email">Email</Label>
              <Input id="inv-email" type="email" {...form.register("email")} />
              {form.formState.errors.email && <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-name">Name (optional)</Label>
              <Input id="inv-name" {...form.register("displayName")} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select value={form.watch("role")} onValueChange={(v) => form.setValue("role", v as z.input<typeof inviteSchema>["role"])}>
                  <SelectTrigger className="w-full" aria-label="Role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.filter((r) => r !== "SUPER_ADMIN").map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Team</Label>
                <Select value={form.watch("teamId") || "none"} onValueChange={(v) => form.setValue("teamId", v === "none" ? "" : v)}>
                  <SelectTrigger className="w-full" aria-label="Team">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No team</SelectItem>
                    {teams.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={invite.isPending}>
                {invite.isPending && <Spinner />} Create invitation
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ employee, teams, onClose }: { employee: Employee; teams: Team[]; onClose: () => void }) {
  const [role, setRole] = useState(employee.role);
  const [teamId, setTeamId] = useState(employee.teamId ?? "");
  const [title, setTitle] = useState(employee.title ?? "");
  const [active, setActive] = useState(employee.isActive);
  const save = useApiMutation<Record<string, unknown>>("PATCH", `/api/employees/${employee.id}`, { success: "Employee updated", invalidate: [["employees"]], onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {employee.displayName}</DialogTitle>
          <DialogDescription>Role and team changes take effect on the employee&apos;s next request and are audited.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="emp-title">Job title</Label>
            <Input id="emp-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="w-full" aria-label="Role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Team</Label>
              <Select value={teamId || "none"} onValueChange={(v) => setTeamId(v === "none" ? "" : v)}>
                <SelectTrigger className="w-full" aria-label="Team">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No team</SelectItem>
                  {teams.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <label className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
            Account active
            <Switch checked={active} onCheckedChange={setActive} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate({ role, teamId: teamId || null, title: title || null, isActive: active })}>
            {save.isPending && <Spinner />} Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

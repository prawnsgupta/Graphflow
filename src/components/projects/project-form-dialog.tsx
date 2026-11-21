"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { projectSchema } from "@/lib/validation/forms";
import { useApi, useApiMutation } from "@/hooks/use-api";
import { Spinner } from "@/components/shared/states";
import type { Page } from "@/types/api";

type Values = z.input<typeof projectSchema>;

export interface ProjectFormInitial {
  id: string;
  name: string;
  description: string | null;
  clientName: string | null;
  team: { id: string } | null;
  projectManager: { id: string } | null;
  budgetHours: string;
  hourlyRate: string;
  currency: string;
  status: string;
  startDate: string | null;
  deadline: string | null;
}

export function ProjectFormDialog({ open, onOpenChange, initial, isAdmin }: { open: boolean; onOpenChange: (o: boolean) => void; initial?: ProjectFormInitial; isAdmin: boolean }) {
  const teams = useApi<{ id: string; name: string }[]>(["teams"], open ? "/api/teams" : null);
  const pms = useApi<Page<{ id: string; displayName: string; role: string }>>(["pm-candidates"], open && isAdmin ? "/api/employees?pageSize=200" : null);
  const pmOptions = (pms.data?.items ?? []).filter((u) => ["PROJECT_MANAGER", "ORG_ADMIN", "SUPER_ADMIN"].includes(u.role));
  const form = useForm<Values>({ resolver: zodResolver(projectSchema) });

  useEffect(() => {
    if (!open) return;
    form.reset(
      initial
        ? {
            name: initial.name,
            description: initial.description ?? "",
            clientName: initial.clientName ?? "",
            teamId: initial.team?.id ?? "",
            projectManagerId: initial.projectManager?.id ?? "",
            budgetHours: Number(initial.budgetHours),
            hourlyRate: Number(initial.hourlyRate),
            currency: initial.currency,
            status: initial.status as Values["status"],
            startDate: initial.startDate?.slice(0, 10) ?? null,
            deadline: initial.deadline?.slice(0, 10) ?? null,
          }
        : { name: "", description: "", clientName: "", teamId: "", projectManagerId: "", budgetHours: 0, hourlyRate: 0, currency: "USD", status: "PLANNING", startDate: null, deadline: null },
    );
  }, [open, initial, form]);

  const create = useApiMutation<Values>("POST", "/api/projects", { success: "Project created", invalidate: [["projects"]], onSuccess: () => onOpenChange(false) });
  const update = useApiMutation<Values>("PATCH", `/api/projects/${initial?.id}`, { success: "Project updated", invalidate: [["projects"], ["project", initial?.id]], onSuccess: () => onOpenChange(false) });
  const busy = create.isPending || update.isPending;
  const err = form.formState.errors;

  const submit = form.handleSubmit((v) => {
    const body = { ...v, startDate: v.startDate || null, deadline: v.deadline || null };
    if (!isAdmin) delete (body as Partial<Values>).projectManagerId;
    if (initial) update.mutate(body);
    else create.mutate(body);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit project" : "New project"}</DialogTitle>
          <DialogDescription>Budget and hourly rate drive utilization and billing calculations.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="p-name">Project name</Label>
            <Input id="p-name" {...form.register("name")} />
            {err.name && <p className="text-xs text-destructive">{err.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-client">Client</Label>
            <Input id="p-client" {...form.register("clientName")} />
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={form.watch("status") ?? "PLANNING"} onValueChange={(v) => form.setValue("status", v as Values["status"])}>
              <SelectTrigger className="w-full" aria-label="Status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"].map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.replace("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-budget">Budget (hours)</Label>
            <Input id="p-budget" type="number" step="0.5" min={0} {...form.register("budgetHours")} />
            {err.budgetHours && <p className="text-xs text-destructive">{err.budgetHours.message}</p>}
          </div>
          <div className="grid grid-cols-[1fr_90px] gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="p-rate">Hourly rate</Label>
              <Input id="p-rate" type="number" step="0.01" min={0} {...form.register("hourlyRate")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-cur">Currency</Label>
              <Input id="p-cur" maxLength={3} {...form.register("currency")} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Team</Label>
            <Select value={form.watch("teamId") || "none"} onValueChange={(v) => form.setValue("teamId", v === "none" ? "" : v)}>
              <SelectTrigger className="w-full" aria-label="Team">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No team</SelectItem>
                {teams.data?.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Project manager</Label>
            {isAdmin ? (
              <Select value={form.watch("projectManagerId") || "none"} onValueChange={(v) => form.setValue("projectManagerId", v === "none" ? "" : v)}>
                <SelectTrigger className="w-full" aria-label="Project manager">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {pmOptions.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="pt-2 text-xs text-muted-foreground">You will be the project manager.</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-start">Start date</Label>
            <Input id="p-start" type="date" {...form.register("startDate")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-deadline">Deadline</Label>
            <Input id="p-deadline" type="date" {...form.register("deadline")} />
            {err.deadline && <p className="text-xs text-destructive">{err.deadline.message}</p>}
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="p-desc">Description</Label>
            <Textarea id="p-desc" rows={3} {...form.register("description")} />
          </div>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Spinner />} {initial ? "Save changes" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, KeyRound, Plus, ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useApi, useApiMutation } from "@/hooks/use-api";
import { apiSend } from "@/lib/api/client";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, LoadingRows, Spinner } from "@/components/shared/states";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { RoleBadge, ToneBadge } from "@/components/shared/badges";
import { formatDateTime } from "@/components/shared/format";

interface SettingsDTO {
  organization: { id: string; name: string; slug: string; timezone: string; isDemo: boolean };
  settings: Record<string, number | string>;
  me: { id: string; displayName: string; email: string; role: string; title: string | null; trackingConsent: boolean; consentUpdatedAt: string | null; team: { name: string } | null };
}

const TIMEZONES = ["UTC", "Asia/Kolkata", "Europe/London", "Europe/Berlin", "America/New_York", "America/Chicago", "America/Los_Angeles", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney"];

export function SettingsView({ isAdmin, initialTab }: { isAdmin: boolean; initialTab?: string }) {
  const data = useApi<SettingsDTO>(["settings"], "/api/settings");
  if (data.error) return <ErrorState message={data.error.message} onRetry={() => data.refetch()} />;
  return (
    <div>
      <PageHeader title="Settings" description="Your profile, consent and devices. Administrators also configure the organization, analytics thresholds, billing defaults and retention." />
      {!data.data ? (
        <LoadingRows rows={6} />
      ) : (
        <Tabs defaultValue={initialTab ?? "profile"}>
          <TabsList className="mb-4 flex h-auto flex-wrap justify-start">
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="consent">Tracking consent</TabsTrigger>
            <TabsTrigger value="devices">Devices</TabsTrigger>
            {isAdmin && <TabsTrigger value="organization">Organization</TabsTrigger>}
            {isAdmin && <TabsTrigger value="analytics">Analytics thresholds</TabsTrigger>}
            {isAdmin && <TabsTrigger value="billing">Billing rules</TabsTrigger>}
            {isAdmin && <TabsTrigger value="retention">Data retention</TabsTrigger>}
          </TabsList>
          <TabsContent value="profile">
            <ProfileTab me={data.data.me} />
          </TabsContent>
          <TabsContent value="consent">
            <ConsentTab me={data.data.me} />
          </TabsContent>
          <TabsContent value="devices">
            <DevicesTab />
          </TabsContent>
          {isAdmin && (
            <>
              <TabsContent value="organization">
                <OrganizationTab org={data.data.organization} />
              </TabsContent>
              <TabsContent value="analytics">
                <SettingsForm
                  title="Analytics thresholds"
                  description="Used by the worker for classification and by the analytics engine. Changes apply to newly processed sessions."
                  settings={data.data.settings}
                  fields={[
                    ["deepFocusMinMinutes", "Deep focus — minimum uninterrupted session (minutes)"],
                    ["deepFocusMaxGapMinutes", "Deep focus — maximum tolerated interruption (minutes)"],
                    ["idleTimeoutMinutes", "Idle timeout (minutes without input)"],
                    ["heartbeatTimeoutMinutes", "Heartbeat timeout — close session after (minutes)"],
                    ["contextSwitchThresholdPerHour", "Friction — switches per hour before a cost applies"],
                    ["contextSwitchCostSeconds", "Friction — cost per excess switch (seconds)"],
                    ["fragmentThresholdSeconds", "Friction — fragment length threshold (seconds)"],
                    ["fragmentMinCountPerHour", "Friction — fragments per hour to count as repeated interruption"],
                    ["budgetAlertThresholdPct", "Budget alert threshold (% of budget)"],
                  ]}
                />
              </TabsContent>
              <TabsContent value="billing">
                <BillingDefaultsTab settings={data.data.settings} />
              </TabsContent>
              <TabsContent value="retention">
                <SettingsForm
                  title="Data retention"
                  description="Applied daily by the worker. Raw events are deleted only after their session is closed and processed; normalized records and timesheets are kept."
                  settings={data.data.settings}
                  fields={[
                    ["rawEventRetentionDays", "Raw activity events (days)"],
                    ["auditLogRetentionDays", "Audit logs (days, minimum 30)"],
                  ]}
                />
              </TabsContent>
            </>
          )}
        </Tabs>
      )}
    </div>
  );
}

function ProfileTab({ me }: { me: SettingsDTO["me"] }) {
  const [name, setName] = useState(me.displayName);
  const [title, setTitle] = useState(me.title ?? "");
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });
  const save = useApiMutation<Record<string, unknown>>("PATCH", "/api/settings/profile", { success: "Profile saved", invalidate: [["settings"]] });
  const change = useApiMutation<typeof pw>("POST", "/api/auth/change-password", { success: "Password changed", onSuccess: () => setPw({ currentPassword: "", newPassword: "" }) });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="gap-4 py-5">
        <CardHeader className="px-5">
          <CardTitle className="text-sm">Profile</CardTitle>
          <CardDescription className="flex items-center gap-2 text-xs">
            {me.email} · <RoleBadge role={me.role} /> · {me.team?.name ?? "No team"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 px-5">
          <div className="space-y-1.5">
            <Label htmlFor="pf-name">Display name</Label>
            <Input id="pf-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-title">Job title</Label>
            <Input id="pf-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <Button disabled={save.isPending || name.trim().length < 2} onClick={() => save.mutate({ displayName: name, title: title || null })}>
            {save.isPending && <Spinner />} Save profile
          </Button>
        </CardContent>
      </Card>
      <Card className="gap-4 py-5">
        <CardHeader className="px-5">
          <CardTitle className="text-sm">Change password</CardTitle>
          <CardDescription className="text-xs">Passwords are hashed with Argon2id. At least 10 characters with a letter and a number.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 px-5">
          <div className="space-y-1.5">
            <Label htmlFor="pw-cur">Current password</Label>
            <Input id="pw-cur" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pw-new">New password</Label>
            <Input id="pw-new" type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
          </div>
          <Button disabled={change.isPending || !pw.currentPassword || pw.newPassword.length < 10} onClick={() => change.mutate(pw)}>
            {change.isPending && <Spinner />} Update password
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function ConsentTab({ me }: { me: SettingsDTO["me"] }) {
  const router = useRouter();
  const set = useApiMutation<{ trackingConsent: boolean }>("POST", "/api/settings/consent", {
    success: (r) => ((r as unknown as { trackingConsent: boolean }).trackingConsent ? "Consent granted" : "Consent withdrawn — no further activity will be collected"),
    invalidate: [["settings"], ["sim-options"]],
    onSuccess: () => router.refresh(),
  });
  return (
    <Card className="gap-4 py-5">
      <CardHeader className="px-5">
        <CardTitle className="flex items-center gap-2 text-sm">
          {me.trackingConsent ? <ShieldCheck className="size-4 text-success" /> : <ShieldOff className="size-4 text-warning" />} Activity-tracking consent
        </CardTitle>
        <CardDescription className="text-xs">You control whether GraphFlow may collect operational metadata about your work.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-5 text-sm">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-md border border-success/25 bg-success/5 p-3">
            <p className="mb-1 text-xs font-medium text-success">Collected (metadata only)</p>
            <ul className="list-inside list-disc text-xs text-muted-foreground">
              <li>Active application name and switches</li>
              <li>Selected project</li>
              <li>File name and path (never contents)</li>
              <li>Idle / active state and heartbeats</li>
            </ul>
          </div>
          <div className="rounded-md border border-destructive/25 bg-destructive/5 p-3">
            <p className="mb-1 text-xs font-medium text-destructive">Never collected</p>
            <ul className="list-inside list-disc text-xs text-muted-foreground">
              <li>Screenshots or screen recordings</li>
              <li>Keystrokes or clipboard contents</li>
              <li>Messages, emails or browser page contents</li>
              <li>File contents</li>
            </ul>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
          <div>
            <p className="font-medium">{me.trackingConsent ? "Consent granted" : "Consent not granted"}</p>
            <p className="text-xs text-muted-foreground">Last changed {formatDateTime(me.consentUpdatedAt)}. Withdrawing stops ingestion immediately; events after withdrawal are never processed.</p>
          </div>
          {me.trackingConsent ? (
            <ConfirmDialog
              trigger={<Button variant="outline">Withdraw consent</Button>}
              title="Withdraw tracking consent?"
              description="New activity events will be rejected, and any queued events timestamped after now will not be processed. Existing approved timesheets are kept."
              confirmLabel="Withdraw"
              destructive
              onConfirm={() => set.mutateAsync({ trackingConsent: false })}
            />
          ) : (
            <Button onClick={() => set.mutate({ trackingConsent: true })} disabled={set.isPending}>
              {set.isPending && <Spinner />} Grant consent
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function DevicesTab() {
  const devices = useApi<{ id: string; name: string; platform: string; isSimulated: boolean; isActive: boolean; lastSeenAt: string | null; hasToken: boolean }[]>(["devices"], "/api/devices");
  const [name, setName] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const create = useApiMutation<Record<string, unknown>>("POST", "/api/devices", { success: "Device registered", invalidate: [["devices"], ["sim-options"]], onSuccess: () => setName("") });
  const toggle = useApiMutation<{ id: string; isActive: boolean }>("PATCH", (b) => `/api/devices/${b.id}`, { success: "Device updated", invalidate: [["devices"], ["sim-options"]] });
  const issue = async (id: string) => {
    try {
      const r = await apiSend<{ token: string }>(`/api/devices/${id}/token`, "POST");
      setToken(r.token);
      devices.refetch();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <Card className="gap-4 py-5">
      <CardHeader className="px-5">
        <CardTitle className="text-sm">Your devices</CardTitle>
        <CardDescription className="text-xs">Simulated devices are used by the simulator. Device tokens let a future native desktop collector call the ingestion API on your behalf.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-5">
        <div className="flex flex-wrap gap-2">
          <Input placeholder="Device name" value={name} onChange={(e) => setName(e.target.value)} className="w-[240px]" aria-label="New device name" />
          <Button disabled={name.trim().length < 2 || create.isPending} onClick={() => create.mutate({ name, isSimulated: true, platform: "web-simulator" })}>
            <Plus /> Register simulated device
          </Button>
        </div>
        {token && (
          <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-xs">
            <p className="mb-2 font-medium text-warning">Copy this device token now — it will not be shown again.</p>
            <div className="flex gap-2">
              <Input readOnly value={token} className="font-mono text-xs" aria-label="Device token" />
              <Button variant="outline" size="icon" aria-label="Copy token" onClick={() => { void navigator.clipboard.writeText(token); toast.success("Token copied"); }}>
                <Copy />
              </Button>
            </div>
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Last seen</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {devices.data?.map((d) => (
              <TableRow key={d.id} className="text-sm">
                <TableCell>{d.name}</TableCell>
                <TableCell>{d.isSimulated ? <ToneBadge tone="warning">Simulated</ToneBadge> : <ToneBadge>{d.platform}</ToneBadge>}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{formatDateTime(d.lastSeenAt)}</TableCell>
                <TableCell>{d.isActive ? <ToneBadge tone="success">Active</ToneBadge> : <ToneBadge>Inactive</ToneBadge>}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" disabled={!d.isActive} onClick={() => issue(d.id)}>
                      <KeyRound /> {d.hasToken ? "Rotate token" : "Issue token"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => toggle.mutate({ id: d.id, isActive: !d.isActive })}>
                      {d.isActive ? "Deactivate" : "Activate"}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function OrganizationTab({ org }: { org: SettingsDTO["organization"] }) {
  const [name, setName] = useState(org.name);
  const [tz, setTz] = useState(org.timezone);
  const save = useApiMutation<Record<string, unknown>>("PATCH", "/api/settings/organization", { success: "Organization updated", invalidate: [["settings"]] });
  return (
    <Card className="gap-4 py-5">
      <CardHeader className="px-5">
        <CardTitle className="text-sm">Organization</CardTitle>
        <CardDescription className="text-xs">All data is stored in UTC; the timezone controls day boundaries in reports, dashboards and timesheet periods.</CardDescription>
      </CardHeader>
      <CardContent className="max-w-lg space-y-4 px-5">
        <div className="space-y-1.5">
          <Label htmlFor="org-name">Organization name</Label>
          <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Reporting timezone</Label>
          <Select value={tz} onValueChange={setTz}>
            <SelectTrigger className="w-full" aria-label="Timezone">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[...new Set([org.timezone, ...TIMEZONES])].map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">Slug: {org.slug}{org.isDemo && " · DEMO organization"}</p>
        <Button disabled={save.isPending} onClick={() => save.mutate({ name, timezone: tz })}>
          {save.isPending && <Spinner />} Save
        </Button>
      </CardContent>
    </Card>
  );
}

function SettingsForm({ title, description, settings, fields }: { title: string; description: string; settings: Record<string, number | string>; fields: [string, string][] }) {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => setValues(Object.fromEntries(fields.map(([k]) => [k, String(settings[k] ?? "")]))), [settings, fields]);
  const save = useApiMutation<Record<string, number>>("PATCH", "/api/settings", { success: "Settings saved", invalidate: [["settings"]] });
  return (
    <Card className="gap-4 py-5">
      <CardHeader className="px-5">
        <CardTitle className="text-sm">{title}</CardTitle>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-5">
        <div className="grid gap-4 md:grid-cols-2">
          {fields.map(([k, label]) => (
            <div key={k} className="space-y-1.5">
              <Label htmlFor={`s-${k}`}>{label}</Label>
              <Input id={`s-${k}`} type="number" min={0} value={values[k] ?? ""} onChange={(e) => setValues({ ...values, [k]: e.target.value })} />
            </div>
          ))}
        </div>
        <Button disabled={save.isPending} onClick={() => save.mutate(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Number(v)])))}>
          {save.isPending && <Spinner />} Save
        </Button>
      </CardContent>
    </Card>
  );
}

function BillingDefaultsTab({ settings }: { settings: Record<string, number | string> }) {
  const tools = useApi<{ id: string; name: string; category: string; executableName: string; defaultBillableStatus: boolean }[]>(["tools"], "/api/tools");
  const update = useApiMutation<{ id: string; defaultBillableStatus: boolean }>("PATCH", (b) => `/api/tools/${b.id}`, { success: "Tool default updated", invalidate: [["tools"]] });
  const [tool, setTool] = useState({ name: "", executableName: "", category: "OTHER", defaultBillableStatus: true });
  const create = useApiMutation<typeof tool>("POST", "/api/tools", { success: "Tool added", invalidate: [["tools"]], onSuccess: () => setTool({ name: "", executableName: "", category: "OTHER", defaultBillableStatus: true }) });
  const [currency, setCurrency] = useState(String(settings.defaultCurrency ?? "USD"));
  const saveCurrency = useApiMutation<Record<string, string>>("PATCH", "/api/settings", { success: "Default currency saved", invalidate: [["settings"]] });
  return (
    <div className="space-y-4">
      <Card className="gap-4 py-5">
        <CardHeader className="px-5">
          <CardTitle className="text-sm">Default tool billability</CardTitle>
          <CardDescription className="text-xs">
            Applies to active work on projects unless the project overrides it. Collaboration/administrative billability, rounding and approval are configured per project in{" "}
            <Link href="/projects" className="text-primary underline">Projects → Billing rules</Link>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 px-5">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tool</TableHead>
                <TableHead>Executable</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Billable by default</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tools.data?.map((t) => (
                <TableRow key={t.id} className="text-sm">
                  <TableCell>{t.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{t.executableName}</TableCell>
                  <TableCell className="text-xs">{t.category.replace("_", " ")}</TableCell>
                  <TableCell className="text-right">
                    <Switch checked={t.defaultBillableStatus} onCheckedChange={(v) => update.mutate({ id: t.id, defaultBillableStatus: v })} aria-label={`${t.name} billable by default`} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex flex-wrap items-end gap-2 border-t border-border pt-4">
            <div className="space-y-1">
              <Label htmlFor="t-name">New tool</Label>
              <Input id="t-name" placeholder="Name" value={tool.name} onChange={(e) => setTool({ ...tool, name: e.target.value })} className="w-[160px]" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="t-exe">Executable</Label>
              <Input id="t-exe" placeholder="App.exe" value={tool.executableName} onChange={(e) => setTool({ ...tool, executableName: e.target.value })} className="w-[150px]" />
            </div>
            <Select value={tool.category} onValueChange={(v) => setTool({ ...tool, category: v })}>
              <SelectTrigger className="w-[170px]" aria-label="Tool category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["DESIGN", "DEVELOPMENT", "THREE_D", "BROWSER", "COMMUNICATION", "PRODUCTIVITY", "DOCUMENTATION", "OTHER"].map((c) => (
                  <SelectItem key={c} value={c}>
                    {c.replace("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button disabled={create.isPending || tool.name.length < 2 || !tool.executableName} onClick={() => create.mutate(tool)}>
              <Plus /> Add tool
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card className="gap-4 py-5">
        <CardHeader className="px-5">
          <CardTitle className="text-sm">Currency</CardTitle>
        </CardHeader>
        <CardContent className="flex items-end gap-2 px-5">
          <div className="space-y-1">
            <Label htmlFor="cur">Default currency (ISO 4217)</Label>
            <Input id="cur" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} className="w-[120px]" />
          </div>
          <Button disabled={currency.length !== 3 || saveCurrency.isPending} onClick={() => saveCurrency.mutate({ defaultCurrency: currency })}>
            Save
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

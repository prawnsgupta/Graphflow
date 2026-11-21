"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { password } from "@/lib/validation/forms";
import { apiGet, apiSend } from "@/lib/api/client";
import { Spinner } from "@/components/shared/states";
import { RoleBadge } from "@/components/shared/badges";

function FieldError({ msg }: { msg?: string }) {
  return msg ? <p className="text-xs text-destructive">{msg}</p> : null;
}

export function ForgotPasswordForm() {
  const [done, setDone] = useState<string | null>(null);
  const form = useForm<{ email: string }>({ resolver: zodResolver(z.object({ email: z.string().email("Enter a valid email") })) });
  const onSubmit = form.handleSubmit(async (v) => {
    const r = await apiSend<{ message: string }>("/api/auth/forgot-password", "POST", v).catch((e: Error) => ({ message: e.message }));
    setDone(r.message);
  });
  return (
    <Card className="w-full max-w-md gap-5 py-6">
      <CardHeader className="px-6">
        <CardTitle className="text-xl">Reset your password</CardTitle>
        <CardDescription>We will issue a single-use link valid for 30 minutes.</CardDescription>
      </CardHeader>
      <CardContent className="px-6">
        {done ? (
          <div className="space-y-3 text-sm">
            <p className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 size-4 text-success" /> {done}
            </p>
            <p className="text-xs text-muted-foreground">Email delivery is not configured in this build; in development the link is written to the server log.</p>
            <Button asChild variant="outline" className="w-full">
              <Link href="/login">Back to sign in</Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" {...form.register("email")} />
              <FieldError msg={form.formState.errors.email?.message} />
            </div>
            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Spinner />} Send reset link
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

const resetForm = z.object({ password, confirm: z.string() }).refine((v) => v.password === v.confirm, { message: "Passwords do not match", path: ["confirm"] });

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof resetForm>>({ resolver: zodResolver(resetForm) });
  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await apiSend("/api/auth/reset-password", "POST", { token, password: v.password });
      router.push("/login");
    } catch (e) {
      setError((e as Error).message);
    }
  });
  return (
    <Card className="w-full max-w-md gap-5 py-6">
      <CardHeader className="px-6">
        <CardTitle className="text-xl">Choose a new password</CardTitle>
        <CardDescription>All existing sessions will be signed out.</CardDescription>
      </CardHeader>
      <CardContent className="px-6">
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="password">New password</Label>
            <Input id="password" type="password" autoComplete="new-password" {...form.register("password")} />
            <FieldError msg={form.formState.errors.password?.message} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm">Confirm password</Label>
            <Input id="confirm" type="password" autoComplete="new-password" {...form.register("confirm")} />
            <FieldError msg={form.formState.errors.confirm?.message} />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={form.formState.isSubmitting || !token}>
            {form.formState.isSubmitting && <Spinner />} Update password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

const inviteForm = z
  .object({ displayName: z.string().trim().min(2, "Enter your name"), password, confirm: z.string(), trackingConsent: z.boolean() })
  .refine((v) => v.password === v.confirm, { message: "Passwords do not match", path: ["confirm"] });

export function AcceptInvitationForm({ token }: { token: string }) {
  const router = useRouter();
  const [info, setInfo] = useState<{ email: string; displayName: string | null; role: string; organizationName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof inviteForm>>({ resolver: zodResolver(inviteForm), defaultValues: { trackingConsent: false } });

  useEffect(() => {
    apiGet<typeof info>(`/api/auth/invitations/${encodeURIComponent(token)}`)
      .then((i) => {
        setInfo(i);
        if (i?.displayName) form.setValue("displayName", i.displayName);
      })
      .catch((e: Error) => setError(e.message));
  }, [token, form]);

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await apiSend(`/api/auth/invitations/${encodeURIComponent(token)}`, "POST", { displayName: v.displayName, password: v.password, trackingConsent: v.trackingConsent });
      router.push("/login");
    } catch (e) {
      setError((e as Error).message);
    }
  });

  return (
    <Card className="w-full max-w-md gap-5 py-6">
      <CardHeader className="px-6">
        <CardTitle className="text-xl">Join {info?.organizationName ?? "GraphFlow"}</CardTitle>
        <CardDescription>{info ? <span className="flex items-center gap-2">{info.email} <RoleBadge role={info.role} /></span> : "Checking your invitation…"}</CardDescription>
      </CardHeader>
      <CardContent className="px-6">
        {!info && error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="displayName">Full name</Label>
              <Input id="displayName" {...form.register("displayName")} />
              <FieldError msg={form.formState.errors.displayName?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="new-password" {...form.register("password")} />
              <FieldError msg={form.formState.errors.password?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm">Confirm password</Label>
              <Input id="confirm" type="password" autoComplete="new-password" {...form.register("confirm")} />
              <FieldError msg={form.formState.errors.confirm?.message} />
            </div>
            <label className="flex items-start gap-2 rounded-md border border-border p-3 text-xs text-muted-foreground">
              <Checkbox checked={form.watch("trackingConsent")} onCheckedChange={(c) => form.setValue("trackingConsent", c === true)} className="mt-0.5" />
              <span>
                I consent to GraphFlow recording <strong className="text-foreground">operational metadata</strong> (active application, project, file name and idle state) for time tracking. No screenshots, keystrokes, clipboard or content are ever collected. I can withdraw consent at any time in Settings.
              </span>
            </label>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting || !info}>
              {form.formState.isSubmitting && <Spinner />} Create account
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

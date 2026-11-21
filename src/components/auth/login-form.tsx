"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import type { z } from "zod";
import { FlaskConical } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginSchema } from "@/lib/validation/forms";
import { apiSend } from "@/lib/api/client";
import { Spinner } from "@/components/shared/states";

type Values = z.infer<typeof loginSchema>;

export function LoginForm({ next, demoAccounts, demoPassword }: { next: string; demoAccounts: { role: string; email: string }[]; demoPassword?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await apiSend("/api/auth/login", "POST", values);
      router.push(next);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  });

  return (
    <div className="w-full max-w-md space-y-4">
      <Card className="gap-5 py-6">
        <CardHeader className="px-6">
          <CardTitle className="text-xl">Sign in to GraphFlow</CardTitle>
          <CardDescription>Use your work email and password.</CardDescription>
        </CardHeader>
        <CardContent className="px-6">
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" aria-invalid={!!form.formState.errors.email} {...form.register("email")} />
              {form.formState.errors.email && <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>}
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link href="/forgot-password" className="text-xs text-primary hover:underline">
                  Forgot password?
                </Link>
              </div>
              <Input id="password" type="password" autoComplete="current-password" aria-invalid={!!form.formState.errors.password} {...form.register("password")} />
              {form.formState.errors.password && <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>}
            </div>
            {error && (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Spinner />} Sign in
            </Button>
          </form>
        </CardContent>
      </Card>

      {demoAccounts.length > 0 && (
        <Card className="gap-3 border-warning/25 py-4">
          <CardHeader className="px-5">
            <CardTitle className="flex items-center gap-2 text-sm text-warning">
              <FlaskConical className="size-4" /> DEMO accounts
            </CardTitle>
            <CardDescription className="text-xs">
              Password for every demo account: <code className="rounded bg-secondary px-1 py-0.5 text-foreground">{demoPassword}</code>. Shown only when DEMO_MODE is enabled outside production.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-1.5 px-5">
            {demoAccounts.map((a) => (
              <button
                key={a.email}
                type="button"
                onClick={() => {
                  form.setValue("email", a.email);
                  form.setValue("password", demoPassword ?? "");
                }}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-left text-xs hover:border-primary/40 hover:bg-secondary"
              >
                <span className="text-muted-foreground">{a.role}</span>
                <span className="font-medium">{a.email}</span>
              </button>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

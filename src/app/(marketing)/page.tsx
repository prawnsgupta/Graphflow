import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Brain,
  CheckCircle2,
  Database,
  FileCheck2,
  Layers,
  Lock,
  Network,
  Receipt,
  ShieldCheck,
  Timer,
  Workflow,
  EyeOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/layout/logo";
import { getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const FEATURES = [
  { icon: Timer, title: "Project time tracking", body: "Activity sessions are reconstructed into non-overlapping intervals per project, tool and file." },
  { icon: Brain, title: "Deep-focus detection", body: "Configurable thresholds classify uninterrupted work and tolerate short interruptions." },
  { icon: Workflow, title: "Context-switch analysis", body: "See switches per hour, per project and per team — and the friction they create." },
  { icon: Receipt, title: "Billable classification", body: "Project-level rules decide which tools and categories bill, with rounding and approval policies." },
  { icon: FileCheck2, title: "Automated timesheets", body: "Draft timesheets from real activity, submit, approve or send back — with a full adjustment trail." },
  { icon: Network, title: "Collaboration patterns", body: "Derived from overlapping project-session metadata only. Communication contents are never read." },
];

const STEPS = [
  { n: "01", title: "Collect", body: "An authorized collector (the built-in simulator today, a desktop agent later) sends metadata events to the authenticated ingestion API." },
  { n: "02", title: "Persist", body: "Each event is validated, consent-checked and stored durably as JSONB in PostgreSQL before it is acknowledged." },
  { n: "03", title: "Process", body: "Redis + BullMQ deliver jobs to a separate worker that deduplicates, rebuilds sessions and detects idle time and switches." },
  { n: "04", title: "Analyze", body: "Server-side analytics compute focus, friction, utilization and billing — scoped by role through Row-Level Security." },
];

export default async function LandingPage() {
  const session = await getSession();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a href="#features" className="hover:text-foreground">Features</a>
            <a href="#how" className="hover:text-foreground">How it works</a>
            <a href="#analytics" className="hover:text-foreground">Analytics</a>
            <a href="#security" className="hover:text-foreground">Security</a>
          </nav>
          <div className="flex items-center gap-2">
            {session ? (
              <Button asChild size="sm">
                <Link href="/dashboard">Open dashboard</Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/login">Sign in</Link>
                </Button>
                <Button asChild size="sm">
                  <Link href="/login">Try the demo</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(100,124,255,0.16),transparent_55%)]" />
        <div className="relative mx-auto max-w-6xl px-4 pb-20 pt-20 sm:px-6 sm:pt-28">
          <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
            <span className="size-1.5 rounded-full bg-success" /> Workflow intelligence for creative and project teams
          </p>
          <h1 className="mt-6 max-w-3xl text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
            Turn how your team really works into accurate, approved billable hours.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            GraphFlow reconstructs project time from permitted operational metadata, surfaces deep focus and workflow friction, and drives timesheets from real activity — with consent, tenant isolation and a complete audit trail.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href={session ? "/dashboard" : "/login"}>
                {session ? "Go to dashboard" : "Explore the live demo"} <ArrowRight />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href="#how">How it works</a>
            </Button>
          </div>
          <dl className="mt-14 grid max-w-3xl grid-cols-2 gap-6 sm:grid-cols-4">
            {[
              ["Event pipeline", "PostgreSQL + BullMQ"],
              ["Isolation", "Row-Level Security"],
              ["Billing", "Approval workflow"],
              ["Privacy", "Metadata only"],
            ].map(([k, v]) => (
              <div key={k} className="border-l border-border pl-4">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="mt-1 text-sm font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section id="features" className="border-t border-border/60 py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Everything between activity and invoice</h2>
          <p className="mt-2 max-w-2xl text-muted-foreground">Built for agencies, studios and software teams that bill by the hour and want to protect focus time.</p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40">
                <f.icon className="size-5 text-primary" />
                <h3 className="mt-4 text-sm font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="border-t border-border/60 bg-sidebar/40 py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">A genuine event-processing pipeline</h2>
          <p className="mt-2 max-w-2xl text-muted-foreground">Simulated activity travels through exactly the same APIs, validation, storage and workers a real desktop collector will use.</p>
          <div className="mt-10 grid gap-4 md:grid-cols-4">
            {STEPS.map((s) => (
              <div key={s.n} className="rounded-xl border border-border bg-card p-5">
                <span className="tabular text-xs font-semibold text-primary">{s.n}</span>
                <h3 className="mt-2 text-sm font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="analytics" className="border-t border-border/60 py-20">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:items-center">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Analytics you can explain</h2>
            <p className="mt-2 text-muted-foreground">Every number traces back to database records and transparent, configurable rules.</p>
            <ul className="mt-6 space-y-3 text-sm">
              {[
                "Billable Amount = Approved Billable Hours × Project Hourly Rate",
                "Budget Utilization = Approved Billable Hours ÷ Budget Hours × 100",
                "Deep Focus Ratio = Deep Focus ÷ Active Work × 100",
                "Friction = idle + unassigned + excess switching + fragmented sessions",
                "Rule-based insights with the supporting metric and a recommended action",
              ].map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                  <span className="text-muted-foreground">{t}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { icon: BarChart3, t: "Tracked vs billable" },
              { icon: Activity, t: "Context-switch trends" },
              { icon: Layers, t: "Budget utilization" },
              { icon: Brain, t: "Focus vs interruptions" },
            ].map((c) => (
              <div key={c.t} className="flex h-32 flex-col justify-between rounded-xl border border-border bg-card p-4">
                <c.icon className="size-5 text-primary" />
                <span className="text-sm font-medium">{c.t}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="security" className="border-t border-border/60 bg-sidebar/40 py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Security and privacy by design</h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: EyeOff, t: "No surveillance", b: "No screenshots, keystrokes, clipboard, messages, page or file contents. The event schema rejects them." },
              { icon: ShieldCheck, t: "Consent first", b: "Nothing is collected without the employee's consent, and withdrawal stops processing immediately." },
              { icon: Database, t: "Row-Level Security", b: "PostgreSQL policies isolate organizations, teams and individuals — enforced under a non-privileged role." },
              { icon: Lock, t: "Audited billing", b: "Argon2id passwords, server-side sessions, append-only audit logs and adjustment history." },
            ].map((c) => (
              <div key={c.t} className="rounded-xl border border-border bg-card p-5">
                <c.icon className="size-5 text-primary" />
                <h3 className="mt-4 text-sm font-semibold">{c.t}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{c.b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border/60 py-20">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">See it with live, simulated data</h2>
          <p className="mt-3 text-muted-foreground">Sign in with a demo account, start the activity simulator and watch events flow through the pipeline into dashboards and timesheets.</p>
          <Button asChild size="lg" className="mt-7">
            <Link href={session ? "/simulator" : "/login"}>
              {session ? "Open the simulator" : "Sign in to the demo"} <ArrowRight />
            </Link>
          </Button>
        </div>
      </section>

      <footer className="border-t border-border/60 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 text-xs text-muted-foreground sm:flex-row sm:px-6">
          <Logo />
          <span>© {new Date().getFullYear()} GraphFlow. Metadata-only workflow intelligence.</span>
        </div>
      </footer>
    </div>
  );
}

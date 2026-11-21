import Link from "next/link";
import { Logo } from "@/components/layout/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(ellipse_at_top,rgba(100,124,255,0.14),transparent_60%)]" />
      <header className="relative px-6 py-5">
        <Link href="/">
          <Logo />
        </Link>
      </header>
      <main className="relative flex flex-1 items-start justify-center px-4 pb-16 pt-6 sm:items-center sm:pt-0">{children}</main>
    </div>
  );
}

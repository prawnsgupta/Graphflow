import { cn } from "@/lib/utils";

export function Logo({ className, withText = true }: { className?: string; withText?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg viewBox="0 0 32 32" className="size-7 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="8" fill="#647CFF" />
        <circle cx="10" cy="21" r="3" fill="#fff" />
        <circle cx="16" cy="11" r="3" fill="#fff" opacity=".9" />
        <circle cx="23" cy="18" r="3" fill="#fff" opacity=".75" />
        <path d="M10 21 16 11 23 18" stroke="#fff" strokeWidth="1.6" fill="none" opacity=".8" />
      </svg>
      {withText && <span className="text-[15px] font-semibold tracking-tight text-foreground">GraphFlow</span>}
    </span>
  );
}

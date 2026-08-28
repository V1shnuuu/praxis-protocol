import type { ReactNode } from "react";

export function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
  bodyClassName = "",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`panel flex min-h-0 flex-col ${className}`}>
      {(title || action) && (
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-navy-700/60 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold tracking-tight text-ink-50">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-ink-400">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

const badgeTones = {
  neutral: "bg-navy-800 text-ink-200 ring-navy-600",
  cyan: "bg-cyan-500/12 text-cyan-400 ring-cyan-500/35",
  clean: "bg-state-clean/12 text-state-clean ring-state-clean/35",
  disputed: "bg-state-disputed/12 text-state-disputed ring-state-disputed/35",
  slashed: "bg-state-slashed/12 text-state-slashed ring-state-slashed/35",
  muted: "bg-navy-800/60 text-ink-400 ring-navy-700",
} as const;

export type BadgeTone = keyof typeof badgeTones;

export function Badge({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium leading-5 ring-1 ring-inset ${badgeTones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function Dot({ tone = "clean", pulse = false }: { tone?: BadgeTone; pulse?: boolean }) {
  const colors: Record<BadgeTone, string> = {
    neutral: "bg-ink-400",
    cyan: "bg-cyan-400",
    clean: "bg-state-clean",
    disputed: "bg-state-disputed",
    slashed: "bg-state-slashed",
    muted: "bg-ink-600",
  };
  return (
    <span className="relative flex h-1.5 w-1.5 shrink-0">
      {pulse && (
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${colors[tone]}`}
        />
      )}
      <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${colors[tone]}`} />
    </span>
  );
}

const buttonVariants = {
  primary:
    "bg-cyan-500 text-navy-950 hover:bg-cyan-400 active:bg-cyan-600 disabled:bg-navy-700 disabled:text-ink-600",
  danger:
    "bg-state-slashed text-navy-950 hover:brightness-110 active:brightness-95 disabled:bg-navy-700 disabled:text-ink-600",
  ghost:
    "bg-navy-800/70 text-ink-200 ring-1 ring-inset ring-navy-600 hover:bg-navy-800 hover:text-ink-50 disabled:text-ink-600",
  subtle: "bg-transparent text-ink-400 hover:text-ink-50 disabled:text-ink-600",
} as const;

export function Button({
  children,
  variant = "ghost",
  size = "md",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof buttonVariants;
  size?: "sm" | "md";
}) {
  const sizing = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm";
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-colors disabled:cursor-not-allowed ${sizing} ${buttonVariants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="mb-3 text-ink-600">{icon}</div>}
      <p className="text-sm font-medium text-ink-200">{title}</p>
      {hint && <p className="mt-1 max-w-xs text-xs leading-relaxed text-ink-400">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-state-slashed/12 text-state-slashed ring-1 ring-inset ring-state-slashed/30">
        !
      </div>
      <p className="text-sm font-medium text-ink-200">Could not load</p>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-ink-400">{message}</p>
      {onRetry && (
        <Button size="sm" className="mt-4" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

/** Monospace hash or address. */
export function Mono({
  children,
  className = "",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { children: ReactNode }) {
  return (
    <span {...props} className={`font-mono text-[11px] tabular-nums ${className}`}>
      {children}
    </span>
  );
}

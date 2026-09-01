import type { ReactNode } from "react";

export function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
  bodyClassName = "",
  flush = false,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Drop the card chrome — for sections whose children are themselves cards. */
  flush?: boolean;
}) {
  return (
    <section className={`${flush ? "" : "panel"} flex min-h-0 flex-col ${className}`}>
      {(title || action) && (
        <header
          className={`flex shrink-0 items-start justify-between gap-4 ${
            flush ? "px-1 pb-4" : "border-b border-line-200 px-5 py-4"
          }`}
        >
          <div className="min-w-0">
            {title && (
              <h2
                className={`font-semibold tracking-tight text-ink-900 ${
                  flush ? "text-base" : "text-sm"
                }`}
              >
                {title}
              </h2>
            )}
            {subtitle && <p className="mt-1 text-xs text-ink-500">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

/**
 * Badge tints are translucent rather than solid: on glass, an opaque chip reads
 * as a hole punched through the pane. The ring carries the edge, the text
 * carries the meaning.
 */
const badgeTones = {
  neutral: "bg-white/[0.07] text-ink-600 ring-white/10",
  cyan: "bg-accent-500/15 text-accent-600 ring-accent-500/25",
  clean: "bg-state-clean/12 text-state-clean ring-state-clean/25",
  disputed: "bg-state-disputed/12 text-state-disputed ring-state-disputed/25",
  slashed: "bg-state-slashed/12 text-state-slashed ring-state-slashed/25",
  muted: "bg-white/[0.05] text-ink-500 ring-white/[0.08]",
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
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium leading-5 ring-1 ring-inset backdrop-blur-sm ${badgeTones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function Dot({ tone = "clean", pulse = false }: { tone?: BadgeTone; pulse?: boolean }) {
  const colors: Record<BadgeTone, string> = {
    neutral: "bg-ink-500",
    cyan: "bg-accent-500",
    clean: "bg-state-clean",
    disputed: "bg-state-disputed",
    slashed: "bg-state-slashed",
    muted: "bg-ink-400",
  };
  return (
    <span className="relative flex h-1.5 w-1.5 shrink-0">
      {pulse && (
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-70 ${colors[tone]}`}
        />
      )}
      <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${colors[tone]}`} />
    </span>
  );
}

/**
 * `primary` is the one solid surface in the system — a bright plane against all
 * the glass, so the main action never has to compete with a panel edge for
 * attention. Everything else is glass and stays translucent.
 */
const buttonVariants = {
  primary:
    "bg-ink-900 text-void-900 hover:bg-white active:bg-ink-800 disabled:bg-white/10 disabled:text-ink-400",
  danger:
    "bg-state-slashed text-void-900 shadow-glow-danger hover:brightness-110 active:brightness-95 disabled:bg-white/10 disabled:text-ink-400 disabled:shadow-none",
  ghost:
    "bg-white/[0.06] text-ink-600 ring-1 ring-inset ring-white/10 backdrop-blur-sm hover:bg-white/[0.11] hover:text-ink-900 hover:ring-white/20 disabled:text-ink-400 disabled:hover:bg-white/[0.06]",
  subtle: "bg-transparent text-ink-500 hover:text-ink-900 disabled:text-ink-400",
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
      className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-all duration-200 disabled:cursor-not-allowed ${sizing} ${buttonVariants[variant]} ${className}`}
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
      {icon && <div className="mb-3 text-ink-400">{icon}</div>}
      <p className="text-sm font-medium text-ink-600">{title}</p>
      {hint && <p className="mt-1 max-w-xs text-xs leading-relaxed text-ink-500">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-state-slashed/12 text-state-slashed ring-1 ring-inset ring-state-slashed/25">
        !
      </div>
      <p className="text-sm font-medium text-ink-600">Could not load</p>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-ink-500">{message}</p>
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

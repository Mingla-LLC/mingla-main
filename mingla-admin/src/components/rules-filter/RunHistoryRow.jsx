import { CheckCircle2, Loader2, XCircle, MinusCircle, Clock } from "lucide-react";

const STATUS_CONFIG = {
  completed: { Icon: CheckCircle2, color: "text-[#22c55e]", label: "Completed" },
  running: { Icon: Loader2, color: "text-[var(--color-brand-500)]", label: "Running", spin: true },
  ready: { Icon: Clock, color: "text-[var(--color-text-tertiary)]", label: "Queued" },
  paused: { Icon: Clock, color: "text-[#f59e0b]", label: "Paused" },
  failed: { Icon: XCircle, color: "text-[#ef4444]", label: "Failed" },
  cancelled: { Icon: MinusCircle, color: "text-[var(--color-text-tertiary)]", label: "Cancelled" },
};

const fmtRelative = (iso) => {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffSec = Math.max(0, (Date.now() - then) / 1000);
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
};

const fmt = (n) => (typeof n === "number" ? n.toLocaleString() : "—");

export function RunHistoryRow({ run, selected, onClick, cityNameFallback }) {
  const config = STATUS_CONFIG[run?.status] || { Icon: MinusCircle, color: "text-[var(--color-text-tertiary)]", label: run?.status || "Unknown" };
  const Icon = config.Icon;
  const when = run?.completed_at || run?.started_at || run?.created_at;
  const isRulesOnly = run?.stage === "rules_only" || run?.stage === "rules_only_complete";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }}
      className={[
        "flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer",
        "transition-colors duration-150",
        selected
          ? "bg-[var(--color-brand-50)] border border-[var(--color-brand-200)]"
          : "hover:bg-[var(--gray-100)] border border-transparent",
      ].join(" ")}
      aria-pressed={selected}
    >
      <Icon className={`w-4 h-4 shrink-0 ${config.color} ${config.spin ? "animate-spin" : ""}`} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[13px] font-medium text-[var(--color-text-primary)] font-mono truncate">
            {run?.manifest_label || "(no manifest)"}
          </span>
          {isRulesOnly && (
            <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--gray-200)] text-[var(--color-text-secondary)]">
              Rules
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-[var(--color-text-tertiary)]">
          <span>{run?.city_filter || cityNameFallback || "All cities"}</span>
          <span>·</span>
          <span>{fmtRelative(when)}</span>
          {run?.triggered_by_email && (
            <>
              <span>·</span>
              <span className="truncate max-w-[120px]">{run.triggered_by_email}</span>
            </>
          )}
        </div>
      </div>

      <div className="text-right shrink-0">
        <div className="text-[11px] text-[var(--color-text-secondary)]">
          <span className="text-[var(--color-text-primary)] font-medium">{fmt(run?.processed)}</span> processed
        </div>
        <div className="text-[10px] text-[var(--color-text-tertiary)] mt-0.5">
          {fmt(run?.rejected)} rej · {fmt(run?.reclassified)} mod · {fmt(run?.unchanged)} unch
        </div>
      </div>
    </div>
  );
}

import { CheckCircle2, AlertTriangle, XCircle, X } from "lucide-react";

const STATUS_CONFIG = {
  in_sync: {
    Icon: CheckCircle2,
    bg: "bg-[var(--color-success-50)]",
    border: "border-[#22c55e]",
    text: "text-[var(--color-success-700)]",
    title: "Sources in sync",
    subtitle: "Filter rules, on-demand types, and display constants all agree.",
  },
  drift: {
    Icon: AlertTriangle,
    bg: "bg-[var(--color-warning-50)]",
    border: "border-[#f59e0b]",
    text: "text-[var(--color-warning-700)]",
    title: "Drift detected",
    subtitle: null,
  },
  contradiction: {
    Icon: XCircle,
    bg: "bg-[var(--color-error-50)]",
    border: "border-[#ef4444]",
    text: "text-[var(--color-error-700)]",
    title: "Contradiction detected",
    subtitle: null,
  },
  error: {
    Icon: XCircle,
    bg: "bg-[var(--gray-100)]",
    border: "border-[var(--gray-400)]",
    text: "text-[var(--color-text-primary)]",
    title: "Drift check failed",
    subtitle: null,
  },
};

const SEVERITY_COLOR = {
  info: "text-[var(--color-info-700)]",
  warning: "text-[#f59e0b]",
  error: "text-[#ef4444]",
};

export function DriftDetailBanner({ result, onDismiss }) {
  if (!result) return null;
  const status = result.status || "error";
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.error;
  const Icon = config.Icon;
  const diffs = result.diffs || [];

  return (
    <div className={`border-l-4 ${config.border} ${config.bg} rounded-lg p-4`}>
      <div className="flex items-start gap-3">
        <Icon className={`w-[18px] h-[18px] ${config.text} shrink-0 mt-0.5`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h4 className={`text-[13px] font-semibold ${config.text}`}>
              {config.title}
              {diffs.length > 0 && ` · ${diffs.length} ${diffs.length === 1 ? "issue" : "issues"}`}
            </h4>
            <button
              onClick={onDismiss}
              className={`${config.text} opacity-60 hover:opacity-100 transition-opacity cursor-pointer`}
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {config.subtitle && (
            <p className={`text-[12px] ${config.text} opacity-90 mt-1`}>{config.subtitle}</p>
          )}

          {status === "error" && result.error && (
            <p className={`text-[12px] ${config.text} mt-1`}>{result.error}</p>
          )}

          {diffs.length > 0 && (
            <div className="mt-3 space-y-2">
              {diffs.map((d, i) => (
                <div
                  key={i}
                  className="border border-[var(--gray-300)] rounded bg-[var(--color-background-primary)] p-2.5"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[12px] font-mono font-medium text-[var(--color-text-primary)] truncate">
                        {d.category_slug}
                        {d.google_type && ` / ${d.google_type}`}
                      </span>
                    </div>
                    <span
                      className={`text-[10px] font-semibold uppercase ${SEVERITY_COLOR[d.severity] || "text-[var(--color-text-secondary)]"}`}
                    >
                      {d.severity}
                    </span>
                  </div>
                  {d.sources && (
                    <div className="flex items-center gap-2 text-[10px] font-mono mb-1">
                      <SourceBadge label="Filter" value={d.sources.filter} />
                      <SourceBadge label="On-demand" value={d.sources.on_demand} />
                      <SourceBadge label="Display" value={d.sources.display} />
                    </div>
                  )}
                  {d.suggestion && (
                    <p className="text-[11px] text-[var(--color-text-secondary)] mt-1">
                      {d.suggestion}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {typeof result.computed_in_ms === "number" && (
            <p className={`text-[10px] ${config.text} opacity-60 mt-2`}>
              Checked in {result.computed_in_ms}ms
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function SourceBadge({ label, value }) {
  const color =
    value === "present"
      ? "text-[#22c55e]"
      : value === "absent"
      ? "text-[#ef4444]"
      : value === "blocked"
      ? "text-[#f59e0b]"
      : "text-[var(--color-text-tertiary)]";

  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--gray-100)]">
      <span className="text-[var(--color-text-tertiary)]">{label}:</span>
      <span className={color}>{value}</span>
    </span>
  );
}

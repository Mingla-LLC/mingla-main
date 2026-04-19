import { CheckCircle, AlertTriangle, XCircle, HelpCircle } from "lucide-react";

const STATUS_CONFIG = {
  in_sync: {
    border: "border-l-[#22c55e]",
    iconBg: "bg-[var(--color-success-50)]",
    iconColor: "text-[#22c55e]",
    Icon: CheckCircle,
    label: "Sources In Sync",
    sublabel: "Filter, on-demand, and display agree.",
  },
  warning: {
    border: "border-l-[#f59e0b]",
    iconBg: "bg-[var(--color-warning-50)]",
    iconColor: "text-[#f59e0b]",
    Icon: AlertTriangle,
    label: "Drift Suspected",
    sublabel: "Run drift check for details.",
  },
  contradiction: {
    border: "border-l-[#ef4444]",
    iconBg: "bg-[var(--color-error-50)]",
    iconColor: "text-[#ef4444]",
    Icon: XCircle,
    label: "Drift Confirmed",
    sublabel: "One or more sources contradict.",
  },
  unknown: {
    border: "border-l-[var(--gray-300)]",
    iconBg: "bg-[var(--gray-100)]",
    iconColor: "text-[var(--color-text-tertiary)]",
    Icon: HelpCircle,
    label: "Unknown",
    sublabel: "Drift status not yet computed.",
  },
};

export function DriftStatusCard({ status, onClick, loading = false }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.unknown;
  const Icon = config.Icon;

  const interactive = typeof onClick === "function" && !loading;

  return (
    <button
      type="button"
      onClick={interactive ? onClick : undefined}
      disabled={!interactive}
      className={[
        "bg-[var(--color-background-primary)] border border-[var(--gray-200)]",
        `border-l-[3px] ${config.border} rounded-xl p-4 text-left w-full`,
        "transition-all duration-200 ease-out",
        interactive ? "hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)] cursor-pointer" : "cursor-default",
        loading ? "opacity-60" : "",
      ].join(" ")}
      aria-label={`Drift status: ${config.label}. ${interactive ? "Click to run drift check." : ""}`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-full ${config.iconBg} flex items-center justify-center shrink-0`}>
          <Icon className={`w-[18px] h-[18px] ${config.iconColor}`} />
        </div>
      </div>
      <p className="text-[13px] text-[var(--color-text-secondary)] mb-0.5">{config.label}</p>
      <p className="text-[15px] font-semibold text-[var(--color-text-primary)] leading-tight">{config.sublabel}</p>
    </button>
  );
}

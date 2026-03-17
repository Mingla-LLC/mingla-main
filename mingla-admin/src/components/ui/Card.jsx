import { AlertTriangle, CheckCircle, Info, AlertCircle } from "lucide-react";

export function StatCard({ icon: Icon, label, value, trend, trendUp, className = "" }) {
  return (
    <div
      className={[
        "bg-[var(--color-background-primary)] border border-[var(--gray-200)]",
        "border-l-[3px] border-l-[var(--color-brand-500)] rounded-xl p-5",
        "transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)] p-4",
        className,
      ].join(" ")}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 rounded-full bg-[var(--color-brand-50)] flex items-center justify-center shrink-0">
          {Icon && <Icon className="w-[18px] h-[18px] text-[var(--color-brand-500)]" />}
        </div>
        {trend && (
          <span className={`text-xs font-semibold ${trendUp ? "text-[#22c55e]" : "text-[#ef4444]"}`}>
            {trendUp ? "\u2197" : "\u2198"} {trend}
          </span>
        )}
      </div>
      <p className="text-[13px] text-[var(--color-text-secondary)] mb-0.5">{label}</p>
      <p className="text-[28px] font-bold text-[var(--color-text-primary)] leading-tight">{value}</p>
    </div>
  );
}

export function SectionCard({ title, subtitle, badge, action, children, className = "", noPadding = false }) {
  return (
    <div
      className={[
        "bg-[var(--color-background-primary)] border border-[var(--gray-200)]",
        "rounded-xl overflow-hidden shadow-[var(--shadow-sm)]",
        className,
      ].join(" ")}
    >
      {title && (
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--gray-200)]">
          <div className="flex items-center gap-2.5">
            <h3 className="text-[15px] font-semibold text-[var(--color-text-primary)]">{title}</h3>
            {badge}
            {subtitle && <span className="text-xs text-[var(--color-text-tertiary)]">{subtitle}</span>}
          </div>
          {action}
        </div>
      )}
      <div className={noPadding ? "" : "p-5"}>{children}</div>
    </div>
  );
}

const ALERT_CONFIG = {
  info:    { bg: "bg-[var(--color-info-50)]",    border: "border-l-[#3b82f6]", text: "text-[var(--color-info-700)]",    Icon: Info },
  success: { bg: "bg-[var(--color-success-50)]", border: "border-l-[#22c55e]", text: "text-[var(--color-success-700)]", Icon: CheckCircle },
  warning: { bg: "bg-[var(--color-warning-50)]", border: "border-l-[#f59e0b]", text: "text-[var(--color-warning-700)]", Icon: AlertTriangle },
  error:   { bg: "bg-[var(--color-error-50)]",   border: "border-l-[#ef4444]", text: "text-[var(--color-error-700)]",   Icon: AlertCircle },
};

export function AlertCard({ variant = "info", title, children, action, className = "" }) {
  const config = ALERT_CONFIG[variant] || ALERT_CONFIG.info;
  const AlertIcon = config.Icon;

  return (
    <div className={`${config.bg} border-l-4 ${config.border} rounded-lg p-4 ${className}`}>
      <div className="flex items-start gap-3">
        <AlertIcon className={`w-[18px] h-[18px] ${config.text} shrink-0 mt-0.5`} />
        <div className="flex-1 min-w-0">
          {title && <h4 className={`text-[13px] font-semibold ${config.text}`}>{title}</h4>}
          {children && <div className={`text-[13px] ${config.text} ${title ? "mt-1" : ""}`}>{children}</div>}
          {action && <div className="mt-2">{action}</div>}
        </div>
      </div>
    </div>
  );
}

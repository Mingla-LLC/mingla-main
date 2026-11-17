import { AlertTriangle, CheckCircle, Info, AlertCircle } from "lucide-react";
import { trendTone } from "../../lib/trendTone";

// #4452 §7.1 (design .kpi): radius 16, --a-line border, --a-shadow, a 28 x 3
// orange tick at the top and the value in Instrument Serif 34 px.
export function StatCard({ icon: Icon, label, value, trend, trendUp, className = "" }) {
  return (
    <div
      data-stat-card=""
      className={[
        "relative bg-[var(--color-background-primary)] border border-[var(--a-line)]",
        "rounded-2xl p-[18px] shadow-[var(--a-shadow)]",
        "transition-all duration-200 ease-out hover:-translate-y-0.5",
        className,
      ].join(" ")}
    >
      <span aria-hidden="true" data-stat-tick="" className="absolute left-[18px] top-0 h-[3px] w-7 rounded-b-[3px] bg-[#eb7825]" />
      {/* #4452 (B4): the icon circle is drawn only around an icon; a card
          without one (and without a trend) starts with its label. */}
      {(Icon || trend) && (
        <div className={`flex items-start mb-3 ${Icon ? "justify-between" : "justify-end"}`}>
          {Icon && (
            <div data-stat-icon="" className="w-10 h-10 rounded-full bg-[var(--a-chip)] flex items-center justify-center shrink-0">
              <Icon className="w-[18px] h-[18px] text-[var(--a-chip-ink)]" />
            </div>
          )}
          {/* #4130: green when up, red when down, grey when level or unknown
              (lib/trendTone.js). Pass trendUp; leaving it out reads as level. */}
          {trend && (
            <span className={`text-xs font-semibold ${trendTone(trendUp).className}`}>
              <span aria-hidden="true">{trendTone(trendUp).arrow}</span> {trend}
            </span>
          )}
        </div>
      )}
      <p className="text-[13px] text-[var(--color-text-secondary)] mb-1">{label}</p>
      <p className="font-serif text-[34px] font-normal leading-[1.05] text-[var(--color-text-primary)]">{value}</p>
    </div>
  );
}

export function SectionCard({ title, subtitle, badge, action, children, className = "", noPadding = false }) {
  return (
    <div
      data-section-card=""
      className={[
        // #4452 §7.1: radius 16, --a-line border, --a-shadow.
        "bg-[var(--color-background-primary)] border border-[var(--a-line)]",
        "rounded-2xl overflow-hidden shadow-[var(--a-shadow)]",
        className,
      ].join(" ")}
    >
      {title && (
        <div className="flex flex-col items-stretch gap-3 px-4 py-3.5 sm:px-5 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between border-b border-[var(--a-line)]">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
            <h3 className="break-words text-[15px] font-semibold text-[var(--color-text-primary)]">{title}</h3>
            {badge}
            {subtitle && <span className="text-xs text-[var(--color-text-tertiary)]">{subtitle}</span>}
          </div>
          {action && <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 sm:justify-end">{action}</div>}
        </div>
      )}
      <div className={noPadding ? "" : "p-4 sm:p-5"}>{children}</div>
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

/** #4452 §7.1: a plain card (radius 16, --a-line border, --a-shadow). */
export function Card({ children, className = "", ...props }) {
  return (
    <div
      data-card=""
      className={["bg-[var(--color-background-primary)] border border-[var(--a-line)] rounded-2xl shadow-[var(--a-shadow)]", className].join(" ")}
      {...props}
    >
      {children}
    </div>
  );
}

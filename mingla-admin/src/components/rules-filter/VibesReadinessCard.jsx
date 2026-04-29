import { Sparkles } from "lucide-react";

export function VibesReadinessCard({ readyCount, totalCount, loading = false }) {
  const ready = Number.isFinite(readyCount) ? readyCount : 0;
  const total = Number.isFinite(totalCount) && totalCount > 0 ? totalCount : 20;
  const pct = Math.min(100, Math.round((ready / total) * 100));

  return (
    <div
      className={[
        "bg-[var(--color-background-primary)] border border-[var(--gray-200)]",
        "border-l-[3px] border-l-[var(--color-brand-500)] rounded-xl p-4",
        "transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]",
        loading ? "opacity-60" : "",
      ].join(" ")}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 rounded-full bg-[var(--color-brand-50)] flex items-center justify-center shrink-0">
          <Sparkles className="w-[18px] h-[18px] text-[var(--color-brand-500)]" />
        </div>
        <span className="text-xs font-semibold text-[var(--color-text-tertiary)]">{pct}%</span>
      </div>
      <p className="text-[13px] text-[var(--color-text-secondary)] mb-0.5">Vibes Ready</p>
      <p className="text-[28px] font-bold text-[var(--color-text-primary)] leading-tight">
        {ready}<span className="text-[15px] font-medium text-[var(--color-text-tertiary)]">/{total}</span>
      </p>
      <p className="text-[11px] text-[var(--color-text-tertiary)] mt-1">Ready for rule-based scoring</p>
    </div>
  );
}

// Issue #4130 (Wave 5) — small pieces the Data room tabs share.
import { Skeleton } from "../ui/Skeleton";
import { LoadError } from "../ui/LoadError";
import { trendTone } from "../../lib/trendTone";
import { asOfLine } from "../../lib/dataRoomAnalytics";

/** Renders loading / error for one or more sections, else the children. */
export function SectionGate({ loads, title, children, height = 160 }) {
  const failed = loads.find((l) => l.status === "error");
  if (failed) {
    return (
      <LoadError
        title={title}
        message={failed.error}
        onRetry={() => loads.filter((l) => l.status === "error").forEach((l) => l.reload())}
      />
    );
  }
  if (loads.some((l) => l.status === "loading")) {
    return (
      <div role="status" aria-label="Loading" className="flex flex-col gap-3">
        <Skeleton height={height} />
      </div>
    );
  }
  return children;
}

export function Tile({ label, value, note, trend }) {
  const tone = trend ? trendTone(trend.up) : null;
  return (
    <div className="flex min-h-[92px] min-w-0 flex-col justify-center rounded-xl border border-[var(--gray-200)] border-l-[3px] border-l-[var(--color-brand-500)] bg-[var(--color-background-primary)] p-4">
      <span className="text-[13px] text-[var(--color-text-secondary)]">{label}</span>
      <span className="text-[26px] font-bold leading-tight tabular-nums text-[var(--color-text-primary)]">{value}</span>
      {trend ? (
        <span className={`mt-1 text-xs font-semibold ${tone.className}`}><span aria-hidden="true">{tone.arrow}</span> {trend.text}</span>
      ) : null}
      {note ? <span className="mt-1 text-xs text-[var(--color-text-tertiary)]">{note}</span> : null}
    </div>
  );
}

export function Segmented({ label, options, value, onChange }) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={`min-h-9 rounded-md px-3 text-sm font-medium ${value === o.id ? "bg-[var(--color-brand-50)] text-[var(--color-brand-700)]" : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Source({ children }) {
  return <p className="mt-3 text-xs text-[var(--color-text-tertiary)]">{children}</p>;
}

export function AsOf({ load }) {
  const line = asOfLine(load?.envelope);
  return line ? <span>{line}</span> : null;
}

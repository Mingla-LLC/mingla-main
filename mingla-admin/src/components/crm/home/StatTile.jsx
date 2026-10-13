import { Skeleton } from "../../ui/Skeleton";

const TILE_CLASS = [
  "flex min-h-[92px] min-w-0 flex-col justify-center rounded-xl p-4",
  "border border-[var(--gray-200)] border-l-[3px] border-l-[var(--color-brand-500)]",
  "bg-[var(--color-background-primary)] text-left no-underline",
  "transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)] focus-visible:ring-offset-2",
].join(" ");

/**
 * One number that goes somewhere (issue #3802). A real link, so the keyboard,
 * a middle click and Back all work. `value` is always a number the server
 * counted; a zero is shown as 0.
 */
export function StatTile({ href, onClick, value, label, note }) {
  return (
    <a href={href} onClick={onClick} className={TILE_CLASS}>
      <span className="text-[28px] font-bold leading-tight tabular-nums text-[var(--color-text-primary)]">{value}</span>
      <span className="text-[13px] text-[var(--color-text-secondary)]">{label}</span>
      {note ? <span className="mt-1 text-xs font-semibold text-[var(--color-error-700)]">{note}</span> : null}
    </a>
  );
}

export function StatTileSkeleton() {
  return (
    <div className="flex min-h-[92px] flex-col justify-center gap-2 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-4" aria-hidden="true">
      <Skeleton width={56} height={28} />
      <Skeleton width="60%" height={13} />
    </div>
  );
}

/** The row of tiles: one column on a phone, up to three across. */
export function StatTileRow({ children, label }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" role="group" aria-label={label}>
      {children}
    </div>
  );
}

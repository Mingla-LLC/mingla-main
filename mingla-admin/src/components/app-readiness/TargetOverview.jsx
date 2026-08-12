import { countsFor, targetKey } from "../../lib/adAppReadiness";

function countCopy(target) {
  if (!target.latest) return "Needs check";
  const counts = countsFor(target.latest);
  return [["ready","Ready"],["action_required","Action required"],["blocked","Blocked"],["stale","Stale"]]
    .filter(([key]) => counts[key]).map(([key,label]) => `${counts[key]} ${label}`).join(" · ");
}

export function TargetOverview({ targets, selectedKey, loading }) {
  return <section aria-labelledby="readiness-overview-heading">
    <h4 id="readiness-overview-heading" className="mb-3 text-base font-semibold">All app targets</h4>
    <ul className="grid grid-cols-1 gap-2 @[560px]:grid-cols-2 @[840px]:grid-cols-4">
      {(loading ? Array.from({ length: 4 }) : targets).map((target, index) => {
        if (loading) return <li key={index} aria-hidden="true" className="min-h-[72px] animate-pulse rounded-lg border border-[var(--gray-200)] bg-[var(--gray-100)]" />;
        const key = targetKey(target.app_key, target.os); const selected = key === selectedKey;
        return <li key={key} aria-current={selected ? "true" : undefined} className={`min-h-[72px] min-w-0 rounded-lg border p-3 ${selected ? "border-2 border-[var(--color-brand-700)]" : "border-[var(--gray-200)]"}`}>
          <div className="flex flex-wrap items-center justify-between gap-1"><span className="text-sm font-semibold">{target.display_name.replace("Mingla ", "")} · {target.os === "ios" ? "iOS" : "Android"}</span>{selected && <span className="text-xs font-medium text-[var(--color-brand-700)]">Selected</span>}</div>
          <p className="mt-1 break-words text-xs text-[var(--color-text-secondary)]">{target.os === "ios" ? "App Store ID" : "Package"} {target.store_identifier}</p>
          <p className="mt-1 text-xs font-medium">{countCopy(target)}</p>
        </li>;
      })}
    </ul>
  </section>;
}

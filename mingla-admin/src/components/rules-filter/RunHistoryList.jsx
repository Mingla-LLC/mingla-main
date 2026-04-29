import { useMemo } from "react";
import { Play, Loader2 } from "lucide-react";
import { SectionCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { RunHistoryRow } from "./RunHistoryRow";

export function RunHistoryList({
  runs,
  loading,
  error,
  selectedRunId,
  onRunClick,
  cityScopeLabel,
  cityIsSelected,
  onRunRulesClick,
  runInflight,
  cities,
}) {
  const activeRunCount = (runs || []).filter((r) => r.status === "running").length;

  // ORCH-0542: fallback city name lookup by city_id for rows where city_filter is null
  const cityById = useMemo(
    () => Object.fromEntries((cities || []).map((c) => [c.id, c.name])),
    [cities]
  );

  const action = (
    <div className="flex items-center gap-2">
      {activeRunCount > 0 && (
        <span className="inline-flex items-center gap-1 text-[11px] text-[var(--color-brand-700)]">
          <Loader2 className="w-3 h-3 animate-spin" />
          {activeRunCount} active
        </span>
      )}
      <Button
        size="sm"
        variant="primary"
        icon={runInflight ? Loader2 : Play}
        onClick={onRunRulesClick}
        disabled={!cityIsSelected || runInflight || activeRunCount > 0}
        title={
          !cityIsSelected
            ? "Pick a city in the page header to run rules filter"
            : activeRunCount > 0
            ? "A run is already active for this scope"
            : "Run all active rules against the selected city"
        }
      >
        {runInflight ? "Starting…" : "Run Rules Filter"}
      </Button>
    </div>
  );

  return (
    <SectionCard
      title="Run History"
      subtitle={cityScopeLabel}
      action={action}
      noPadding
    >
      <div className="p-3">
        {loading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-14 rounded-lg bg-[var(--gray-100)] animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <p className="text-[13px] text-[var(--color-error-700)] text-center py-6 px-3">
            Couldn't load run history: {error}
          </p>
        ) : !runs || runs.length === 0 ? (
          <div className="text-center py-8 px-4">
            <p className="text-[13px] text-[var(--color-text-secondary)] mb-2">
              No runs yet.
            </p>
            <p className="text-[12px] text-[var(--color-text-tertiary)]">
              {cityIsSelected
                ? `Click "Run Rules Filter" to apply the current manifest to ${cityScopeLabel}.`
                : "Pick a city in the page header, then click Run Rules Filter."}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {runs.map((r) => (
              <RunHistoryRow
                key={r.id}
                run={r}
                selected={selectedRunId === r.id}
                onClick={() => onRunClick(r.id)}
                cityNameFallback={r.city_id ? cityById[r.city_id] : null}
              />
            ))}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

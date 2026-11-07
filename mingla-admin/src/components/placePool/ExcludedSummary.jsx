// Issue #4276 U5: why places were left out, laid out as the approved design
// (pipeline-design/project/Excluded.dc.html): the biggest single-rule loss as a banner,
// the pre-check reasons as bars with a city filter, the reasons by city, and the final
// check's reasons as a compact grid. Counted on the server and grouped by rule. The
// places themselves, and removing one through the audited admin_deactivate_place, sit
// below. There is deliberately no override here: the checks decide what Explorers see.

import { useCallback, useEffect, useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { SectionCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { Skeleton } from "../ui/Skeleton";
import { LoadError } from "../ui/LoadError";
import { fetchExcludedSummary } from "../../services/cityPipelineService";
import { biggestRuleLoss, count, reasonRows, ruleLabel } from "../../lib/cityPipeline";
import { ChipGroup, ShareBar } from "./PoolUi";

const CITY_RULES = ["B4", "B6", "B10", "B11", "B1", "B5"];

function pct(n, d) {
  const a = Number(n ?? 0);
  const b = Number(d ?? 0);
  return b > 0 ? Math.round((a / b) * 100) : null;
}

export function ExcludedSummary() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [cityFilter, setCityFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setData(await fetchExcludedSummary(null)); } catch (err) { setError(err.message); } finally { setLoading(false); }
  }, []);
  // A server read; its state changes happen when it answers.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  // Cities the pre-check has judged, biggest first: these are the chips.
  const checkedCities = useMemo(
    () => (data?.cities ?? []).filter((c) => c.city_id && Number(c.pre_check_failed) > 0)
      .sort((a, b) => Number(b.pre_check_failed) - Number(a.pre_check_failed)),
    [data],
  );
  const rows = useMemo(() => {
    if (!data) return [];
    if (cityFilter === "all") return reasonRows(data.pre_check, data.pre_check_failed);
    const c = checkedCities.find((x) => x.city_id === cityFilter);
    if (!c) return [];
    const groups = Object.entries(c.pre_check ?? {}).map(([rule, places]) => ({ rule, places }))
      .sort((a, b) => Number(b.places) - Number(a.places));
    return reasonRows(groups, c.pre_check_failed);
  }, [data, cityFilter, checkedCities]);

  if (error) return <LoadError title="Couldn't count why places were left out" message={error} onRetry={load} retrying={loading} />;
  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton height={72} />
        <Skeleton height={260} />
      </div>
    );
  }

  const fin = reasonRows(data.final_check, data.final_check_failed);
  const loss = biggestRuleLoss(data.cities);
  const top = rows.length ? Math.max(...rows.map((r) => r.places)) : 0;
  const chipOptions = [{ id: "all", label: "All" }, ...checkedCities.slice(0, 8).map((c) => ({ id: c.city_id, label: c.city_name }))];
  const byCity = (data.cities ?? []).filter((c) => c.city_id && (Number(c.pre_check_failed) > 0 || Number(c.final_check_failed) > 0));

  return (
    <div className="flex flex-col gap-6">
      {loss && (
        <div role="note" className="rounded-xl border border-[var(--color-error-100)] bg-[var(--color-error-50)] px-5 py-4">
          <p className="text-[15px] font-semibold text-[var(--color-error-700)]">The {loss.label.toLowerCase()} rule removes {loss.share}% of {loss.city}</p>
          <p className="mt-1 text-[13px] leading-5 text-[var(--color-text-primary)]">
            {count(loss.places)} of {count(loss.active)} active {loss.city} places failed the pre-check with {loss.label.toLowerCase()}. This page shows the rule's effect; changing it is a code decision.
          </p>
        </div>
      )}

      <SectionCard
        title="Why places were left out"
        subtitle={`Pre-check failures. ${count(data.pre_check_failed)} of ${count(data.active)} active places; a place can fail several rules, so reasons add up to more.`}
        action={<Button size="sm" variant="secondary" icon={RotateCcw} onClick={load} loading={loading}>Count again</Button>}
      >
        <div className="flex flex-col gap-4">
          {chipOptions.length > 1 && <ChipGroup label="City" options={chipOptions} value={cityFilter} onChange={setCityFilter} />}
          {rows.length === 0 ? (
            <p className="text-sm text-[var(--color-text-secondary)]">The pre-check left nothing out here.</p>
          ) : (
            <ul className="flex flex-col">
              {rows.map((r) => (
                <li key={r.rule} className="grid grid-cols-[minmax(120px,220px)_minmax(0,1fr)_auto] items-center gap-4 py-2.5 text-sm">
                  <span className="text-[var(--color-text-primary)]">{r.label}</span>
                  <ShareBar share={top ? (r.places / top) * 100 : 0} label={`${r.label}: ${count(r.places)}`} />
                  <span className="min-w-[96px] text-right tabular-nums">{count(r.places)}{r.share !== null ? ` · ${r.share}%` : ""}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-[var(--color-text-secondary)]">Cities judged before the pre-check existed only have final-check reasons, mixed with missing photos. Those are in the final-check list below.</p>
        </div>
      </SectionCard>

      <SectionCard title="Reasons by city" noPadding>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--gray-200)] text-left text-xs text-[var(--color-text-secondary)]">
                <th scope="col" className="px-5 py-2.5 font-medium">City</th>
                {CITY_RULES.map((r) => <th key={r} scope="col" className="px-3 py-2.5 font-medium">{ruleLabel(r)}</th>)}
                <th scope="col" className="px-3 py-2.5 font-medium">Left out of active</th>
              </tr>
            </thead>
            <tbody>
              {byCity.map((c) => {
                const worst = Math.max(...CITY_RULES.map((r) => Number(c.pre_check?.[r] ?? 0)));
                return (
                  <tr key={c.city_id} className="border-b border-[var(--gray-100)] last:border-b-0 tabular-nums">
                    <th scope="row" className="px-5 py-2.5 text-left font-semibold">{c.city_name}</th>
                    {CITY_RULES.map((r) => {
                      const n = Number(c.pre_check?.[r] ?? 0);
                      const red = n > 0 && n === worst && pct(n, c.active) >= 25;
                      return <td key={r} className={`px-3 py-2.5 ${red ? "font-semibold text-[var(--color-error-700)]" : n ? "" : "text-[var(--color-text-tertiary)]"}`}>{n ? count(n) : "–"}</td>;
                    })}
                    <td className="px-3 py-2.5">{pct(Math.max(Number(c.pre_check_failed ?? 0), Number(c.final_check_failed ?? 0)), c.active) ?? "–"}{pct(Math.max(Number(c.pre_check_failed ?? 0), Number(c.final_check_failed ?? 0)), c.active) !== null ? "%" : ""}</td>
                  </tr>
                );
              })}
              {byCity.length === 0 && (
                <tr><td colSpan={CITY_RULES.length + 2} className="px-5 py-4 text-[var(--color-text-tertiary)]">No city has places left out.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Final check: top reasons across all cities" subtitle="No stored photos often means the place already failed the pre-check, so it never got photos.">
        {fin.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">The final check left nothing out.</p>
        ) : (
          <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2 xl:grid-cols-4">
            {fin.map((r) => (
              <div key={r.rule} className="flex items-baseline justify-between gap-3 border-b border-[var(--gray-100)] py-2 text-[13px]">
                <dt className="text-[var(--color-text-primary)]">{r.label}</dt>
                <dd className="tabular-nums text-[var(--color-text-secondary)]">{count(r.places)}</dd>
              </div>
            ))}
          </dl>
        )}
      </SectionCard>
    </div>
  );
}

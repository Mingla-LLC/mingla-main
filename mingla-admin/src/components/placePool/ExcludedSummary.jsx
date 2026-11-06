// Issue #4276 U5: why places were left out, counted on the server and grouped by rule,
// for the pre-check and the final check, with the pre-check reasons per city. The list
// of places, and removing one through the audited admin_deactivate_place, sits below.
// There is deliberately no override here: the checks decide what Explorers see.

import { useCallback, useEffect, useState } from "react";
import { SectionCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import { LoadError } from "../ui/LoadError";
import { fetchExcludedSummary } from "../../services/cityPipelineService";
import { count, reasonRows, ruleLabel } from "../../lib/cityPipeline";

const CITY_RULES = ["B4", "B6", "B10", "B11", "B1", "B5"];

function ReasonList({ title, subtitle, rows }) {
  return (
    <SectionCard title={title} subtitle={subtitle}>
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--color-text-tertiary)]">Nothing was left out by this check.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((r) => (
            <li key={r.rule} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-sm">
              <span>
                {r.label}
              </span>
              <span className="tabular-nums text-[var(--color-text-secondary)]">{count(r.places)}{r.share !== null ? ` · ${r.share}%` : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

export function ExcludedSummary() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setData(await fetchExcludedSummary(null)); } catch (err) { setError(err.message); } finally { setLoading(false); }
  }, []);
  // A server read; its state changes happen when it answers.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  if (error) return <LoadError title="Couldn't count why places were left out" message={error} onRetry={load} />;
  if (!data) return <div className="flex justify-center py-6"><Spinner /></div>;

  const pre = reasonRows(data.pre_check, data.pre_check_failed);
  const fin = reasonRows(data.final_check, data.final_check_failed);
  const cities = (data.cities ?? []).filter((c) => Number(c.pre_check_failed) > 0 || Number(c.final_check_failed) > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[var(--color-text-secondary)]">
          Of {count(data.active)} active places, {count(data.pre_check_failed)} failed the pre-check and {count(data.final_check_failed)} failed the final check. A place can fail several rules, so groups add up to more.
        </p>
        <Button size="sm" variant="secondary" onClick={load} loading={loading}>Count again</Button>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ReasonList title="Pre-check: why places were left out" subtitle="Free rules, before any photo is downloaded." rows={pre} />
        <ReasonList title="Final check: why places were left out" subtitle="No stored photos often means the place already failed the pre-check." rows={fin} />
      </div>
      <SectionCard title="Pre-check reasons by city" noPadding>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-tertiary)]">
                <th scope="col" className="px-4 py-2 font-medium">City</th>
                {CITY_RULES.map((r) => <th key={r} scope="col" className="px-2 py-2 font-medium">{ruleLabel(r)}</th>)}
                <th scope="col" className="px-2 py-2 font-medium">Failed: pre-check, final check, of active</th>
              </tr>
            </thead>
            <tbody>
              {cities.map((c) => (
                <tr key={c.city_id ?? "none"} className="border-b border-[var(--color-border)] tabular-nums">
                  <th scope="row" className="px-4 py-2 text-left font-medium">{c.city_name}</th>
                  {CITY_RULES.map((r) => <td key={r} className="px-2 py-2">{count(c.pre_check?.[r] ?? 0)}</td>)}
                  <td className="px-2 py-2">{count(c.pre_check_failed)}, {count(c.final_check_failed)}, of {count(c.active)}</td>
                </tr>
              ))}
              {cities.length === 0 && (
                <tr><td colSpan={CITY_RULES.length + 2} className="px-4 py-4 text-[var(--color-text-tertiary)]">No city has excluded places.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}

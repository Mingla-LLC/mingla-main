// #4452 §7.5 Results (design renderResults): the funnel from the same events as
// the tracking log (each step's % of the previous one, bars ≥ 3%), the KPIs,
// and By campaign with spend from the Ads engine or "—" when unmatched. Real
// zeros show as 0; "Illustrative" never appears. Submissions for this form is
// the Leads list with the form filter (A1.8).
import { useCallback, useState } from "react";
import { ExternalLink } from "lucide-react";
import { StatCard } from "../ui/Card";
import { LoadError } from "../ui/LoadError";
import { Skeleton } from "../ui/Skeleton";
import { useServerRead } from "../../hooks/useServerRead";
import { LeadsList } from "../leads/LeadsList";
import { LABEL_NAME, RESULTS_FOOTNOTE, RESULT_RANGES, SPEND_UNMATCHED, funnelSteps, money, perUnit, rangeBounds } from "../../lib/formsModel";
import { formResults, formsErrorWords } from "../../services/formsService";
import { Panel, Seg } from "./formsUi";

export function ResultsTab({ form }) {
  const [range, setRange] = useState("30d");
  const load = useCallback(() => { const b = rangeBounds(range); return formResults(form.id, b.from, b.to); }, [form.id, range]);
  const { status, data, error, retry } = useServerRead(load);
  const fixed = { form_id: form.id };
  const steps = data ? funnelSteps(data) : [];
  const spend = data?.spend;
  const sent = data?.funnel?.sent ?? 0;
  const calls = data?.funnel?.calls_booked ?? 0;
  return (
    <div className="flex flex-col gap-4" data-results-tab="">
      <div className="flex flex-wrap items-center gap-2">
        <Seg label="Period" value={range} onChange={setRange} options={RESULT_RANGES.map((r) => ({ id: r.id, label: r.label }))} />
        <span className="flex-1" />
        <a href={`#/inbound?form=${form.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-[var(--a-chip-ink)] hover:underline">Open in Leads <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" /></a>
      </div>
      {status === "loading" ? <Skeleton height={300} rounded="16px" /> : status === "error" ? <LoadError message={formsErrorWords(error)} onRetry={retry} /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label={`${LABEL_NAME[data.label] || "Leads"}s`} value={sent} />
            <StatCard label="Cost per lead" value={spend ? perUnit(spend.cents, sent, spend.currency) : "—"} />
            <StatCard label="Calls booked (end goal)" value={calls} />
            <StatCard label="Cost per booked call" value={spend ? perUnit(spend.cents, calls, spend.currency) : "—"} />
          </div>
          <Panel title="Funnel" data-funnel="">
            <ol className="flex flex-col gap-2.5">
              {steps.map((s) => (
                <li key={s.id} data-funnel-step={s.id}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span>{s.label}</span>
                    <span className="tabular-nums"><b className="font-semibold">{s.value === null ? "—" : s.value}</b>{s.pct !== null ? <span className="ml-2 text-xs text-[var(--color-text-tertiary)]">{s.pct}%</span> : null}</span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-[var(--a-soft)]"><div className="h-2 rounded-full bg-[#eb7825]" style={{ width: `${s.width}%` }} /></div>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-[var(--color-text-tertiary)]">{RESULTS_FOOTNOTE}</p>
          </Panel>
          <Panel title="By campaign" data-by-campaign="">
            {!data.by_campaign.length ? <p className="text-sm text-[var(--color-text-tertiary)]">No leads came from a tagged campaign in this period.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead><tr>{["Campaign", "Spend", "Clicks", "Leads", "Per lead", "Calls booked", "Per call"].map((h) => <th key={h} className="whitespace-nowrap border-b border-[var(--a-line)] px-4 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">{h}</th>)}</tr></thead>
                  <tbody>
                    {data.by_campaign.map((c) => (
                      <tr key={c.campaign} className="border-b border-[var(--a-line)] last:border-0">
                        <td className="px-4 py-3.5">{c.campaign}</td>
                        <td className="px-4 py-3.5" title={c.matched ? undefined : SPEND_UNMATCHED}>{c.matched ? money(c.spend_cents, c.currency) : <span>— <span className="block text-xs text-[var(--color-text-tertiary)]">{SPEND_UNMATCHED}</span></span>}</td>
                        <td className="px-4 py-3.5 tabular-nums">{c.matched ? c.clicks ?? 0 : ""}</td>
                        <td className="px-4 py-3.5 tabular-nums">{c.leads}</td>
                        <td className="px-4 py-3.5">{c.matched ? perUnit(c.spend_cents, c.leads, c.currency) : ""}</td>
                        <td className="px-4 py-3.5 tabular-nums">{c.calls_booked}</td>
                        <td className="px-4 py-3.5">{c.matched ? perUnit(c.spend_cents, c.calls_booked, c.currency) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
      <Panel title="Submissions">
        <LeadsList search="" onSearch={() => {}} fixed={fixed} forms={[{ id: form.id, name: form.name }]} />
      </Panel>
    </div>
  );
}

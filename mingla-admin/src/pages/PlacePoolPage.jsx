// Issue #4130 (Wave 4b), #4276 — Place pool, laid out as the approved design
// (pipeline-design/project, #4276): tabs straight under the title, in this order.
//
//   Overview        the whole funnel, counted on the server
//                   (admin_place_pipeline_funnel): active -> pre-check -> photos ->
//                   Explorers can see -> reviews -> Intelligence -> final score, each a
//                   share of ACTIVE places, with what needs attention beside it and
//                   every city under it.
//   Cities          which cities Explorers can use, with what is in the way; going
//                   live asks first.
//   Pipeline        what each city is missing, a city's server-driven run, its geo
//                   box, Intelligence, scoring tools and places with no city.
//   Browse and map  the place list, and the map behind a List / Map switch.
//   Excluded        why places were left out, grouped, then the places.
//
// The open tab is in the address (#/placepool?tab=cities), so retired addresses
// (#/launch-cities, #/signals, #/deck-tuner, #/place-intelligence-trial) land here;
// #/placepool?tab=map opens Browse and map on the map.
// Photos are the stored thumbnails; nothing here uses image transformations.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { SectionCard } from "../components/ui/Card";
import { Tabs } from "../components/ui/Tabs";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Skeleton } from "../components/ui/Skeleton";
import { LoadError } from "../components/ui/LoadError";
import { EmbeddedPageContext } from "../components/layout/embeddedPage";
import { useHashTab } from "../hooks/useHashTab";
import { PLACE_POOL_MAP_ADDRESS, PLACE_POOL_TABS, placePoolTabFor, shareOf } from "../lib/systemPages";
import { attentionItems, count, pipelineFunnelSteps, spendTotalsLine, usd } from "../lib/cityPipeline";
import { fetchPipelineFunnel, fetchSpendTotals } from "../services/cityPipelineService";
import { PipelineSection } from "../components/placePool/PipelineSection";
import { ExcludedSummary } from "../components/placePool/ExcludedSummary";
import { ShareBar, StatTile } from "../components/placePool/PoolUi";
import { LaunchCitiesPage } from "./LaunchCitiesPage";
import { PlacePoolManagementPage } from "./PlacePoolManagementPage";

function FunnelBar({ step }) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(120px,190px)_minmax(0,1fr)_auto] items-center gap-4 py-2.5">
      <span className="text-sm text-[var(--color-text-primary)]">{step.label}</span>
      <ShareBar share={step.share ?? 0} label={`${step.label}: ${step.share ?? 0}% of active places`} />
      <span className="min-w-[104px] text-right text-sm tabular-nums text-[var(--color-text-primary)]">
        {step.count === null ? "–" : step.count.toLocaleString()}
        {step.share !== null && <span> · {step.share}%</span>}
      </span>
    </div>
  );
}

// A share cell in the By city table: "–" for none, red when a live city is under half
// at reviews or Intelligence (the design's rule).
function ShareCell({ value, row, flagLive = false }) {
  const pct = shareOf(value, row.active);
  if (!pct) return <span className="text-[var(--color-text-tertiary)]">–</span>;
  const red = flagLive && row.is_live && pct < 50;
  return <span className={red ? "font-semibold text-[var(--color-error-700)]" : ""}>{pct}%</span>;
}

const BY_CITY_COLUMNS = [
  { key: "pre_passed", label: "Passed pre-check" },
  { key: "with_photos", label: "Stored photos" },
  { key: "servable", label: "Explorers can see" },
  { key: "reviews", label: "Has reviews", flagLive: true },
  { key: "intelligence", label: "Intelligence", flagLive: true },
  { key: "scored", label: "Final score" },
];

function PoolOverview({ funnel, loading, error, onRetry, onOpenTab }) {
  const totals = funnel?.totals ?? null;
  const steps = useMemo(() => pipelineFunnelSteps(totals), [totals]);
  const attention = useMemo(() => attentionItems(totals), [totals]);
  const [spend, setSpend] = useState(null);
  const [spendError, setSpendError] = useState(null);
  const [sort, setSort] = useState({ key: "active", dir: "desc" });

  useEffect(() => {
    let live = true;
    fetchSpendTotals().then((d) => live && setSpend(d)).catch((e) => live && setSpendError(e.message));
    return () => { live = false; };
  }, []);

  const cities = useMemo(() => {
    const list = (funnel?.cities ?? []).filter((c) => c.city_id && Number(c.active) > 0);
    const val = (c) => (sort.key === "city_name" ? String(c.city_name) : Number(c[sort.key] ?? 0));
    return [...list].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      const d = typeof x === "string" ? x.localeCompare(y) : x - y;
      return sort.dir === "asc" ? d : -d;
    });
  }, [funnel, sort]);
  const noCity = (funnel?.cities ?? []).find((c) => !c.city_id);

  if (error) return <LoadError title="Couldn't load the place counts" message={error} onRetry={onRetry} />;

  const headerButton = (key, label) => {
    const on = sort.key === key;
    return (
      <button type="button" className="inline-flex min-h-9 cursor-pointer items-center gap-1 text-left text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
        aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
        onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" }))}>
        {label}{on && <span aria-hidden="true">{sort.dir === "asc" ? "↑" : "↓"}</span>}
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <SectionCard
          title="From seeded place to Explorer's deck"
          subtitle={`Every share is of active places, counted on the server when you open this.${funnel?.counted_at ? ` Last counted ${new Date(funnel.counted_at).toLocaleString()}.` : ""}`}
          action={
            <Button size="sm" variant="secondary" icon={RotateCcw} loading={loading} onClick={onRetry}>
              {loading ? "Counting…" : "Update now"}
            </Button>
          }
        >
          {loading && !steps ? (
            <div className="flex flex-col gap-4">
              {[0, 1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} height={18} />)}
            </div>
          ) : steps ? (
            <div className="flex flex-col">
              {steps.map((step) => <FunnelBar key={step.key} step={step} />)}
              <p className="mt-3 text-xs leading-5 text-[var(--color-text-secondary)]">
                Every share is of active places. Reviews, Intelligence and the final score only count places Explorers can see.
              </p>
            </div>
          ) : null}
        </SectionCard>

        <SectionCard title="Needs attention">
          {loading && !totals ? (
            <div className="flex flex-col gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} height={44} />)}</div>
          ) : attention.length === 0 ? (
            <p className="text-sm text-[var(--color-text-secondary)]">Nothing needs attention.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--gray-200)]">
              {attention.map((a) => (
                <li key={a.head} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                  <p className="text-sm text-[var(--color-text-primary)]"><b className="font-semibold tabular-nums">{count(a.count)}</b> · {a.head}</p>
                  <p className="text-xs leading-5 text-[var(--color-text-secondary)]">{a.body}</p>
                  {a.tab && (
                    <Button variant="link" size="sm" className="self-start" onClick={() => onOpenTab(a.tab)}>{a.link}</Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Held until they finish" value={totals ? count(totals.held) : "–"} note="New places stay hidden until reviews, Intelligence and the final score are done." />
        <StatTile label="Dropped at seed for no photo" value={totals ? count(totals.dropped_no_photos) : "–"} note="Google returned them with no photo, so they were never added." />
        <StatTile label="Places with no city" value={noCity ? count(noCity.active) : totals ? "0" : "–"} note="Active places outside every city. City runs can't see them." />
        <StatTile label="Recorded spend" value={spend ? usd(spend.known_usd) : spendError ? "unknown" : "–"} note={spend ? spendTotalsLine(spend) : spendError ? `Couldn't read spend: ${spendError}` : "Seeding, photos and Gemini."} />
      </div>

      <SectionCard title="By city" subtitle="Tap a heading to sort. Share of active places. Red marks a live city under half at reviews or Intelligence." noPadding>
        {loading && !funnel ? (
          <div className="flex flex-col gap-3 p-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={20} />)}</div>
        ) : cities.length === 0 ? (
          <p className="p-5 text-sm text-[var(--color-text-secondary)]">No places yet. Seeded cities appear here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--gray-200)] text-left">
                  <th scope="col" className="px-5 py-2">{headerButton("city_name", "City")}</th>
                  <th scope="col" className="px-3 py-2">{headerButton("active", "Active")}</th>
                  {BY_CITY_COLUMNS.map((c) => <th key={c.key} scope="col" className="px-3 py-2">{headerButton(c.key, c.label)}</th>)}
                </tr>
              </thead>
              <tbody>
                {cities.map((r) => (
                  <tr key={r.city_id} className="border-b border-[var(--gray-100)] last:border-b-0 tabular-nums">
                    <th scope="row" className="px-5 py-2.5 text-left font-semibold text-[var(--color-text-primary)]">
                      <span className="inline-flex items-center gap-2">{r.city_name}{r.is_live && <Badge variant="success">Live</Badge>}</span>
                    </th>
                    <td className="px-3 py-2.5">{count(r.active)}</td>
                    {BY_CITY_COLUMNS.map((c) => <td key={c.key} className="px-3 py-2.5"><ShareCell value={r[c.key]} row={r} flagLive={c.flagLive} /></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

export function PlacePoolPage() {
  const [requested, openTab] = useHashTab("placepool");
  const tab = placePoolTabFor(requested);
  const [funnel, setFunnel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPipelineFunnel(null);
      if (mounted.current) setFunnel(data);
    } catch (err) {
      if (mounted.current) {
        setFunnel(null);
        setError(err.message);
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // The Overview's server read, only while Overview is open.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (tab === "overview") void load();
  }, [load, tab]);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Place pool"
        description="From search to the Explorer's deck, for every city."
        tabs={<Tabs tabs={PLACE_POOL_TABS.map(({ id, label }) => ({ id, label }))} activeTab={tab} onChange={openTab} />}
      />
      <div role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`} className="min-w-0">
        {tab === "overview" && <PoolOverview funnel={funnel} loading={loading} error={error} onRetry={load} onOpenTab={openTab} />}
        <EmbeddedPageContext.Provider value={true}>
          {tab === "cities" && <LaunchCitiesPage />}
          {tab === "pipeline" && <PipelineSection />}
          {tab === "browse" && (requested === PLACE_POOL_MAP_ADDRESS
            ? <PlacePoolManagementPage key="browse-map" section="browse" initialView="map" />
            : <PlacePoolManagementPage key="browse" section="browse" />)}
          {tab === "excluded" && (
            <div className="flex flex-col gap-6">
              <ExcludedSummary />
              <PlacePoolManagementPage key="excluded" section="excluded" />
            </div>
          )}
        </EmbeddedPageContext.Provider>
      </div>
    </div>
  );
}

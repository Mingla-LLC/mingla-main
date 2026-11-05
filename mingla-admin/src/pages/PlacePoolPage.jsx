// Issue #4130 (Wave 4b), #4276 (wave 4) — Place pool: the pipeline, then the pool.
//
//   Pipeline        (top, above every tab) what each city is missing, a city's
//                   server-driven run, its geo box, Intelligence, scoring tools and
//                   places with no city. #/placepool?tab=pipeline scrolls to it.
//   Overview        the whole funnel, counted on the server
//                   (admin_place_pipeline_funnel): active -> pre-check -> photos ->
//                   Explorers can see -> reviews -> Intelligence -> final score, each a
//                   share of ACTIVE places, with what needs attention and every city.
//   Cities          the old Launch Cities page, with readiness that counts the gaps;
//                   going live asks first.
//   Browse          the place list; a place opens with its score override.
//   Map             the map.
//   Excluded        why places were left out, grouped, then the places.
//
// The open tab is in the address (#/placepool?tab=cities), so retired addresses
// (#/launch-cities, #/signals, #/deck-tuner, #/place-intelligence-trial) land here.
// Photos are the stored thumbnails; nothing here uses image transformations.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapPinned, RotateCcw } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { SectionCard, AlertCard } from "../components/ui/Card";
import { Tabs } from "../components/ui/Tabs";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Skeleton } from "../components/ui/Skeleton";
import { DataTable } from "../components/ui/Table";
import { LoadError } from "../components/ui/LoadError";
import { EmbeddedPageContext } from "../components/layout/embeddedPage";
import { useHashTab } from "../hooks/useHashTab";
import { PLACE_POOL_PIPELINE_ADDRESS, PLACE_POOL_TABS, placePoolTabFor, shareOf } from "../lib/systemPages";
import { attentionItems, count, pipelineFunnelSteps } from "../lib/cityPipeline";
import { fetchPipelineFunnel } from "../services/cityPipelineService";
import { PipelineSection } from "../components/placePool/PipelineSection";
import { ExcludedSummary } from "../components/placePool/ExcludedSummary";
import { LaunchCitiesPage } from "./LaunchCitiesPage";
import { PlacePoolManagementPage } from "./PlacePoolManagementPage";

function FunnelBar({ step, highlight }) {
  const width = step.share ?? 0;
  return (
    <div className="grid min-w-0 grid-cols-[minmax(140px,190px)_1fr_auto] items-center gap-3 py-1.5">
      <span className="text-sm text-[var(--color-text-primary)]">
        {step.label}
        {step.note && <span className="block text-[11px] text-[var(--color-text-tertiary)]">{step.note}</span>}
      </span>
      <div className="h-2.5 overflow-hidden rounded-full bg-[var(--gray-100)]" aria-hidden="true">
        <div
          className={`h-full rounded-full ${highlight ? "bg-[var(--color-success-500)]" : "bg-[var(--color-brand-500)]"}`}
          style={{ width: `${width}%` }}
        />
      </div>
      <span className="text-sm tabular-nums text-[var(--color-text-primary)]">
        {step.count === null ? "–" : step.count.toLocaleString()}
        {step.key !== "active" && step.share !== null && (
          <span className="text-[var(--color-text-tertiary)]"> · {step.share}%</span>
        )}
      </span>
    </div>
  );
}

const pct = (v, r) => `${Number(v).toLocaleString()} · ${shareOf(v, r.active) ?? 0}%`;

function PoolOverview({ funnel, loading, error, onRetry }) {
  const totals = funnel?.totals ?? null;
  const steps = useMemo(() => pipelineFunnelSteps(totals), [totals]);
  const attention = useMemo(() => attentionItems(totals), [totals]);

  const columns = [
    {
      key: "city_name",
      label: "City",
      sortable: true,
      render: (_v, r) => (
        <div className="min-w-0">
          <p className="font-medium text-[var(--color-text-primary)]">{r.city_name}</p>
          <p className="text-xs text-[var(--color-text-tertiary)]">{r.city_id ? `${r.country || "–"}${r.is_live ? " · Live" : ""}` : "Places outside every city"}</p>
        </div>
      ),
    },
    { key: "active", label: "Active", sortable: true, cellClassName: "tabular-nums", render: (v) => Number(v).toLocaleString() },
    { key: "pre_passed", label: "Pre-check", sortable: true, cellClassName: "tabular-nums", render: pct },
    { key: "with_photos", label: "Photos", sortable: true, cellClassName: "tabular-nums", render: pct },
    { key: "servable", label: "Explorers can see", sortable: true, cellClassName: "tabular-nums", render: pct },
    { key: "reviews", label: "Reviews", sortable: true, cellClassName: "tabular-nums", render: pct },
    { key: "intelligence", label: "Intelligence", sortable: true, cellClassName: "tabular-nums", render: pct },
    { key: "scored", label: "Final score", sortable: true, cellClassName: "tabular-nums", render: pct },
  ];

  if (error) return <LoadError title="Couldn't load the place counts" message={error} onRetry={onRetry} />;

  return (
    <div className="flex flex-col gap-6">
      <SectionCard
        title="From active place to the Explorer's deck"
        subtitle="Every share is of active places, counted on the server when you open this."
        action={
          <Button size="sm" variant="secondary" icon={RotateCcw} loading={loading} onClick={onRetry}>
            {loading ? "Counting…" : "Count again"}
          </Button>
        }
      >
        {loading && !steps ? (
          <div className="flex flex-col gap-3">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} height={18} />)}
          </div>
        ) : steps ? (
          <div className="flex flex-col">
            {steps.map((step) => <FunnelBar key={step.key} step={step} highlight={step.key === "servable"} />)}
          </div>
        ) : null}
      </SectionCard>

      {attention.length > 0 && (
        <SectionCard title="Needs attention">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {attention.map((a) => (
              <AlertCard key={a.head} variant="warning" title={`${count(a.count)} · ${a.head}`}>{a.body}</AlertCard>
            ))}
          </div>
        </SectionCard>
      )}

      <SectionCard title="By city" subtitle="Cities with the most active places first. Share of active places." noPadding>
        <DataTable
          columns={columns}
          rows={funnel?.cities || []}
          loading={loading && !funnel}
          emptyIcon={MapPinned}
          emptyMessage="No places yet. Seeded cities appear here."
          getRowId={(r) => r.city_id || r.city_name}
        />
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
  const pipelineRef = useRef(null);
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
    // The first server read; state changes happen inside the async loader.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // An address naming the pipeline (#/signals, #/place-intelligence-trial) lands on it.
  useEffect(() => {
    if (requested === PLACE_POOL_PIPELINE_ADDRESS) pipelineRef.current?.scrollIntoView({ block: "start" });
  }, [requested]);

  const totals = funnel?.totals;
  const cityCount = (funnel?.cities || []).filter((c) => c.city_id).length;
  const description = totals
    ? `${cityCount} ${cityCount === 1 ? "city" : "cities"} · ${Number(totals.servable).toLocaleString()} places Explorers can see.`
    : "The pipeline from search to final score, and every place in the pool.";

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Place pool"
        description={description}
        meta={totals ? <Badge variant="outline">{`${Number(totals.active).toLocaleString()} active`}</Badge> : null}
      />
      <div ref={pipelineRef} className="scroll-mt-4">
        <PipelineSection />
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <Tabs tabs={PLACE_POOL_TABS.map(({ id, label }) => ({ id, label }))} activeTab={tab} onChange={openTab} />
        <div role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === "overview" && <PoolOverview funnel={funnel} loading={loading} error={error} onRetry={load} />}
          <EmbeddedPageContext.Provider value={true}>
            {tab === "cities" && <LaunchCitiesPage />}
            {tab === "browse" && <PlacePoolManagementPage key="browse" section="browse" />}
            {tab === "map" && <PlacePoolManagementPage key="map" section="map" />}
            {tab === "excluded" && (
              <div className="flex flex-col gap-6">
                <ExcludedSummary />
                <PlacePoolManagementPage key="excluded" section="excluded" />
              </div>
            )}
          </EmbeddedPageContext.Provider>
        </div>
      </div>
    </div>
  );
}

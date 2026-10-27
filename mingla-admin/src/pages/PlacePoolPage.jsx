// Issue #4130 (Wave 4b) — Place pool: cities, checking, photos and scoring in
// one page.
//
//   Overview        the honest funnel, counted on the server
//                   (admin_place_pool_funnel): active -> checked by Bouncer ->
//                   Explorers can see -> have stored photos, every share of
//                   ACTIVE places, and the same per city.
//   Cities          the old Launch Cities page, with readiness; going live asks first.
//   Pipeline        seeding, refresh, photos, thumbnails, Bouncer and scoring
//                   (the old Signal Library; "Scored" can't go over 100%).
//   Browse and map  the place list and map; a place opens with its score
//                   override (the old Deck tuner).
//   Excluded        places Bouncer left out, with the reason.
//
// The open tab is in the address (#/placepool?tab=cities), so the retired
// addresses (#/launch-cities, #/signals, #/deck-tuner) land on their tab.
// Photos are the stored thumbnails; nothing here uses image transformations.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapPinned, RotateCcw } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { SectionCard } from "../components/ui/Card";
import { Tabs } from "../components/ui/Tabs";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Skeleton } from "../components/ui/Skeleton";
import { DataTable } from "../components/ui/Table";
import { LoadError } from "../components/ui/LoadError";
import { EmbeddedPageContext } from "../components/layout/embeddedPage";
import { useToast } from "../context/ToastContext";
import { useHashTab } from "../hooks/useHashTab";
import { PLACE_POOL_TABS, placePoolTabFor, placeFunnelSteps, shareOf } from "../lib/systemPages";
import { fetchPlaceFunnel, refreshPlacePoolStats } from "../services/systemPagesService";
import { LaunchCitiesPage } from "./LaunchCitiesPage";
import { PlacePoolManagementPage } from "./PlacePoolManagementPage";

function FunnelBar({ step, highlight }) {
  const width = step.share ?? 0;
  return (
    <div className="grid min-w-0 grid-cols-[minmax(120px,170px)_1fr_auto] items-center gap-3 py-1.5">
      <span className="text-sm text-[var(--color-text-primary)]">{step.label}</span>
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

function PoolOverview({ funnel, loading, error, onRetry }) {
  const { addToast } = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const steps = useMemo(() => placeFunnelSteps(funnel), [funnel]);

  const recount = async () => {
    setRefreshing(true);
    try {
      await refreshPlacePoolStats();
      addToast({ variant: "success", title: "Counts updated" });
      onRetry();
    } catch (err) {
      addToast({ variant: "error", title: "Couldn't update the counts", description: err.message });
    } finally {
      setRefreshing(false);
    }
  };

  const columns = [
    {
      key: "city_name",
      label: "City",
      sortable: true,
      render: (_v, r) => (
        <div className="min-w-0">
          <p className="font-medium text-[var(--color-text-primary)]">{r.city_name}</p>
          <p className="text-xs text-[var(--color-text-tertiary)]">{r.country_name || "–"}</p>
        </div>
      ),
    },
    { key: "active", label: "Active", sortable: true, cellClassName: "tabular-nums", render: (v) => Number(v).toLocaleString() },
    {
      key: "checked",
      label: "Checked",
      sortable: true,
      cellClassName: "tabular-nums",
      render: (v, r) => `${Number(v).toLocaleString()} · ${shareOf(v, r.active) ?? 0}%`,
    },
    {
      key: "visible",
      label: "Explorers can see",
      sortable: true,
      cellClassName: "tabular-nums",
      render: (v, r) => `${Number(v).toLocaleString()} · ${shareOf(v, r.active) ?? 0}%`,
    },
    {
      key: "with_photos",
      label: "Stored photos",
      sortable: true,
      cellClassName: "tabular-nums",
      render: (v, r) => `${Number(v).toLocaleString()} · ${shareOf(v, r.active) ?? 0}%`,
    },
  ];

  if (error) return <LoadError title="Couldn't load the place counts" message={error} onRetry={onRetry} />;

  return (
    <div className="flex flex-col gap-6">
      <SectionCard
        title="From active place to the Explorer's deck"
        subtitle="Every share is of active places. Counts refresh every 10 minutes."
        action={
          <Button size="sm" variant="secondary" icon={RotateCcw} loading={refreshing} onClick={recount}>
            {refreshing ? "Updating…" : "Update now"}
          </Button>
        }
      >
        {loading || !steps ? (
          <div className="flex flex-col gap-3">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} height={18} />)}
          </div>
        ) : (
          <div className="flex flex-col">
            {steps.map((step) => <FunnelBar key={step.key} step={step} highlight={step.key === "visible"} />)}
          </div>
        )}
      </SectionCard>

      <SectionCard title="By city" subtitle="Cities with the most active places first." noPadding>
        <DataTable
          columns={columns}
          rows={funnel?.cities || []}
          loading={loading}
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
      const data = await fetchPlaceFunnel();
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

  const cityCount = funnel?.cities?.filter((c) => c.city_id).length ?? null;
  const description =
    funnel && cityCount !== null
      ? `${cityCount} ${cityCount === 1 ? "city" : "cities"} · ${Number(funnel.visible).toLocaleString()} places Explorers can see. Cities, checking, photos and scoring in one page.`
      : "Cities, checking, photos and scoring in one page.";

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Place pool"
        description={description}
        meta={funnel ? <Badge variant="outline">{`${Number(funnel.active).toLocaleString()} active`}</Badge> : null}
        tabs={<Tabs tabs={PLACE_POOL_TABS.map(({ id, label }) => ({ id, label }))} activeTab={tab} onChange={openTab} />}
      />
      <div role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "overview" && <PoolOverview funnel={funnel} loading={loading} error={error} onRetry={load} />}
        <EmbeddedPageContext.Provider value={true}>
          {tab === "cities" && <LaunchCitiesPage />}
          {tab === "pipeline" && <PlacePoolManagementPage key="pipeline" section="pipeline" />}
          {tab === "browse" && <PlacePoolManagementPage key="browse" section="browse" />}
          {tab === "excluded" && <PlacePoolManagementPage key="excluded" section="excluded" />}
        </EmbeddedPageContext.Provider>
      </div>
    </div>
  );
}

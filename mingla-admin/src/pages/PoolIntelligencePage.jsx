import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Globe, Layers, Camera, TrendingUp, CheckCircle, AlertTriangle,
  Grid3X3, List, MapPin, Tag, CreditCard, Eye,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { SectionCard, StatCard, AlertCard } from "../components/ui/Card";
import { DataTable } from "../components/ui/Table";
import { Badge } from "../components/ui/Badge";
import { Tabs } from "../components/ui/Tabs";
import { Button } from "../components/ui/Button";
import { Breadcrumbs } from "../components/ui/Breadcrumbs";
import { useToast } from "../context/ToastContext";

// ── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_LABELS = {
  nature_views: "Nature & Views", first_meet: "First Meet", picnic_park: "Picnic Park",
  drink: "Drink", casual_eats: "Casual Eats", fine_dining: "Fine Dining",
  watch: "Watch", live_performance: "Live Performance", creative_arts: "Creative & Arts",
  play: "Play", wellness: "Wellness", flowers: "Flowers", groceries: "Groceries",
};

const CATEGORY_COLORS = {
  nature_views: "#22c55e", first_meet: "#f97316", picnic_park: "#84cc16",
  drink: "#a855f7", casual_eats: "#ef4444", fine_dining: "#dc2626",
  watch: "#3b82f6", live_performance: "#8b5cf6", creative_arts: "#ec4899",
  play: "#f59e0b", wellness: "#14b8a6", flowers: "#f472b6", groceries: "#6b7280",
};

const TOTAL_CATEGORIES = Object.keys(CATEGORY_LABELS).length;

const TABS = [
  { id: "geographic", label: "Geographic Inventory" },
  { id: "categories", label: "Category Maturity" },
  { id: "tiles", label: "Tile Detail" },
  { id: "uncategorized", label: "Uncategorized Places" },
  { id: "cards", label: "Card Pool" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function healthBadge(health) {
  const map = { green: "success", yellow: "warning", red: "error" };
  const label = { green: "Healthy", yellow: "Needs Work", red: "Critical" };
  return <Badge variant={map[health] || "default"}>{label[health] || health}</Badge>;
}

function pctBadge(pct) {
  const variant = pct >= 80 ? "success" : pct >= 50 ? "warning" : "error";
  return <Badge variant={variant}>{pct}%</Badge>;
}

function categoryDot(slug) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: CATEGORY_COLORS[slug] || "#6b7280" }} />
      {CATEGORY_LABELS[slug] || slug}
    </div>
  );
}

function relativeTime(dateStr) {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function ErrorBanner({ error }) {
  if (!error) return null;
  return (
    <div className="text-sm text-[var(--color-error-700)] bg-[var(--color-error-50)] p-3 rounded-lg">
      Failed to load data: {error}
    </div>
  );
}

// ── CityFilterBar ────────────────────────────────────────────────────────────

function CityFilterBar({ selectedCity, cities, onSelectCity, onClearCity }) {
  const items = [
    { label: "All Cities", onClick: onClearCity },
    ...(selectedCity ? [{ label: `${selectedCity.city_name}, ${selectedCity.country}` }] : []),
  ];

  return (
    <div className="flex items-center gap-3 mb-2">
      <Breadcrumbs items={items} />
      {!selectedCity && cities.length > 0 && (
        <select
          className="ml-auto rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 py-2 text-sm"
          value=""
          onChange={(e) => {
            const city = cities.find((c) => c.city_id === e.target.value);
            if (city) onSelectCity(city);
          }}
        >
          <option value="">Jump to city...</option>
          {cities.map((c) => (
            <option key={c.city_id} value={c.city_id}>{c.city_name}, {c.country}</option>
          ))}
        </select>
      )}
    </div>
  );
}

// ── Tab 1: Geographic Inventory ──────────────────────────────────────────────

function GeographicInventoryTab({ onSelectCity }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    setError(null);
    supabase.rpc("admin_pool_intelligence_overview").then(({ data, error: err }) => {
      if (!mountedRef.current) return;
      if (err) setError(err.message);
      else setRows(data || []);
      setLoading(false);
    });
    return () => { mountedRef.current = false; };
  }, []);

  const totalPlaces = rows.reduce((s, r) => s + (r.active_places || 0), 0);
  const avgPhotos = rows.length > 0 ? Math.round(rows.reduce((s, r) => s + (r.photo_pct || 0), 0) / rows.length) : 0;
  const avgReadiness = rows.length > 0 ? Math.round(rows.reduce((s, r) => s + (r.readiness_pct || 0), 0) / rows.length) : 0;

  const columns = [
    {
      key: "city_name", label: "City", sortable: true,
      render: (_, r) => (
        <button
          onClick={() => onSelectCity(r)}
          className="text-[var(--color-brand-500)] hover:underline cursor-pointer font-medium text-left"
        >
          {r.city_name}, {r.country}
        </button>
      ),
    },
    {
      key: "status", label: "Status",
      render: (_, r) => {
        const v = { draft: "default", seeding: "warning", seeded: "info", launched: "success" };
        return <Badge variant={v[r.status] || "default"}>{r.status}</Badge>;
      },
    },
    { key: "active_places", label: "Places", sortable: true },
    { key: "photo_pct", label: "Photos", sortable: true, render: (_, r) => pctBadge(r.photo_pct) },
    {
      key: "category_coverage", label: "Categories", sortable: true,
      render: (_, r) => {
        const pct = Math.round((r.category_coverage / TOTAL_CATEGORIES) * 100);
        return <span>{r.category_coverage}/{TOTAL_CATEGORIES} {pctBadge(pct)}</span>;
      },
    },
    { key: "total_cards", label: "Cards", sortable: true },
    { key: "freshness_pct", label: "Freshness", sortable: true, render: (_, r) => pctBadge(r.freshness_pct) },
    {
      key: "seeding_spend", label: "Spend", sortable: true,
      render: (_, r) => {
        const over = r.seeding_spend > 70;
        return <span className={over ? "text-[var(--color-error-700)] font-medium" : ""}>${(r.seeding_spend || 0).toFixed(2)}</span>;
      },
    },
    { key: "readiness_pct", label: "Readiness", sortable: true, render: (_, r) => pctBadge(r.readiness_pct) },
  ];

  // Row background styling based on readiness
  const styledRows = rows.map((r) => ({
    ...r,
    _key: r.city_id,
    _rowClassName:
      r.readiness_pct < 50 ? "bg-red-50/40 dark:bg-red-950/10"
        : r.readiness_pct < 80 ? "bg-yellow-50/40 dark:bg-yellow-950/10"
        : "bg-green-50/30 dark:bg-green-950/10",
  }));

  return (
    <div className="space-y-6">
      <ErrorBanner error={error} />
      <div className="grid grid-cols-4 gap-4">
        <StatCard icon={Globe} label="Cities" value={rows.length} />
        <StatCard icon={Layers} label="Total Places" value={totalPlaces} />
        <StatCard icon={Camera} label="Avg Photo Coverage" value={`${avgPhotos}%`}
          trend={avgPhotos >= 80 ? "Good" : "Low"} trendUp={avgPhotos >= 80} />
        <StatCard icon={TrendingUp} label="Avg Readiness" value={`${avgReadiness}%`}
          trend={avgReadiness >= 80 ? "Launch Ready" : avgReadiness >= 50 ? "In Progress" : "Early"}
          trendUp={avgReadiness >= 80} />
      </div>
      <SectionCard title="All Cities" subtitle={`${rows.length} cities · ${totalPlaces} places`}>
        <DataTable columns={columns} rows={styledRows} loading={loading}
          emptyMessage="No cities defined yet. Add cities in the Place Pool page." emptyIcon={Globe} />
      </SectionCard>
    </div>
  );
}

// ── Tab 2: Category Maturity ─────────────────────────────────────────────────

function CategoryMaturityTab({ selectedCity }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);
  const cityMode = !!selectedCity;

  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    setError(null);

    const rpcCall = cityMode
      ? supabase.rpc("admin_city_category_maturity", { p_city_id: selectedCity.city_id })
      : supabase.rpc("admin_pool_category_health");

    rpcCall.then(({ data, error: err }) => {
      if (!mountedRef.current) return;
      if (err) setError(err.message);
      else setRows(data || []);
      setLoading(false);
    });
    return () => { mountedRef.current = false; };
  }, [selectedCity?.city_id]);

  const healthy = rows.filter((r) => r.health === "green").length;
  const critical = rows.filter((r) => r.health === "red").length;
  const totalCards = rows.reduce((s, r) => s + (r.total_cards || 0), 0);
  const avgPhoto = rows.length > 0 ? Math.round(rows.reduce((s, r) => s + (r.photo_pct || 0), 0) / rows.length) : 0;

  const columns = [
    { key: "category", label: "Category", sortable: true, render: (_, r) => categoryDot(r.category) },
    { key: "active_places", label: "Places", sortable: true },
    { key: "total_cards", label: "Cards", sortable: true },
    ...(cityMode ? [
      { key: "single_cards", label: "Single", sortable: true },
      { key: "curated_cards", label: "Curated", sortable: true },
    ] : []),
    { key: "photo_pct", label: "Photos", sortable: true, render: (_, r) => pctBadge(r.photo_pct) },
    {
      key: "avg_rating", label: "Rating", sortable: true,
      render: (_, r) => r.avg_rating ? `★ ${r.avg_rating}` : "—",
    },
    {
      key: "places_needing_cards", label: "Need Cards", sortable: true,
      render: (_, r) => r.places_needing_cards > 0
        ? <span className="text-[var(--color-warning-600)] font-medium">{r.places_needing_cards}</span>
        : <span className="text-[var(--color-success-700)]">0</span>,
    },
    { key: "health", label: "Health", render: (_, r) => healthBadge(r.health) },
  ];

  const modeText = cityMode
    ? <>Showing categories for <strong>{selectedCity.city_name}</strong></>
    : "Showing all categories globally";

  return (
    <div className="space-y-6">
      <ErrorBanner error={error} />
      <p className="text-sm text-[var(--color-text-secondary)]">{modeText}</p>
      <div className="grid grid-cols-4 gap-4">
        <StatCard icon={CheckCircle} label="Healthy Categories" value={`${healthy}/${TOTAL_CATEGORIES}`}
          trend={healthy >= 10 ? "Strong" : "Gaps"} trendUp={healthy >= 10} />
        <StatCard icon={AlertTriangle} label="Critical" value={critical}
          trend={critical === 0 ? "None" : "Needs Action"} trendUp={critical === 0} />
        <StatCard icon={CreditCard} label="Total Cards" value={totalCards} />
        <StatCard icon={Camera} label="Avg Photo Coverage" value={`${avgPhoto}%`} />
      </div>
      <SectionCard title="Category Health Matrix" subtitle="Card coverage relative to active places per category">
        <DataTable columns={columns} rows={rows} loading={loading}
          emptyMessage={cityMode ? `No categorized places in ${selectedCity.city_name} yet.` : "No category data"}
          emptyIcon={Layers} />
      </SectionCard>
    </div>
  );
}

// ── Tab 3: Tile Detail ───────────────────────────────────────────────────────

function TileDetailTab({ selectedCity, onSwitchToGeographic }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [viewMode, setViewMode] = useState("table");
  const mountedRef = useRef(true);

  useEffect(() => {
    if (!selectedCity) return;
    mountedRef.current = true;
    setLoading(true);
    setError(null);
    supabase.rpc("admin_tile_intelligence", { p_city_id: selectedCity.city_id }).then(({ data, error: err }) => {
      if (!mountedRef.current) return;
      if (err) setError(err.message);
      else setRows(data || []);
      setLoading(false);
    });
    return () => { mountedRef.current = false; };
  }, [selectedCity?.city_id]);

  if (!selectedCity) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <Grid3X3 className="h-12 w-12 text-[var(--gray-300)]" />
        <p className="text-sm text-[var(--color-text-tertiary)]">Select a city from Geographic Inventory to see tile details.</p>
        <Button variant="secondary" size="sm" onClick={onSwitchToGeographic}>Go to Geographic Inventory</Button>
      </div>
    );
  }

  const totalTiles = rows.length;
  const seededTiles = rows.filter((r) => r.seeded).length;
  const avgPlaces = totalTiles > 0 ? Math.round(rows.reduce((s, r) => s + (r.active_places || 0), 0) / totalTiles) : 0;

  const columns = [
    { key: "tile_index", label: "Tile #", sortable: true },
    {
      key: "row_idx", label: "Position", sortable: true,
      render: (_, r) => `R${r.row_idx} C${r.col_idx}`,
    },
    { key: "active_places", label: "Places", sortable: true },
    { key: "with_photos", label: "Photos", sortable: true },
    {
      key: "category_count", label: "Categories", sortable: true,
      render: (_, r) => `${r.category_count}/${TOTAL_CATEGORIES}`,
    },
    {
      key: "top_category", label: "Top Category",
      render: (_, r) => r.top_category ? (CATEGORY_LABELS[r.top_category] || r.top_category) : "—",
    },
    {
      key: "seeded", label: "Seeded",
      render: (_, r) => r.seeded
        ? <span className="text-[var(--color-success-700)]">✓</span>
        : <span className="text-[var(--color-error-700)]">✗</span>,
    },
    {
      key: "last_seeded_at", label: "Last Seeded", sortable: true,
      render: (_, r) => relativeTime(r.last_seeded_at),
    },
  ];

  // Grid view
  const maxRow = rows.length > 0 ? Math.max(...rows.map((r) => r.row_idx)) : 0;
  const maxCol = rows.length > 0 ? Math.max(...rows.map((r) => r.col_idx)) : 0;
  const tileMap = useMemo(() => {
    const m = {};
    rows.forEach((r) => { m[`${r.row_idx}-${r.col_idx}`] = r; });
    return m;
  }, [rows]);

  function tileColor(places) {
    if (places === 0) return "bg-[var(--gray-200)]";
    if (places <= 4) return "bg-orange-300";
    if (places <= 9) return "bg-lime-400";
    return "bg-green-500";
  }

  return (
    <div className="space-y-6">
      <ErrorBanner error={error} />
      <div className="grid grid-cols-3 gap-4">
        <StatCard icon={Grid3X3} label="Total Tiles" value={totalTiles} />
        <StatCard icon={CheckCircle} label="Seeded Tiles"
          value={`${seededTiles}/${totalTiles}`}
          trend={totalTiles > 0 ? `${Math.round((seededTiles / totalTiles) * 100)}%` : "0%"}
          trendUp={seededTiles >= totalTiles * 0.8} />
        <StatCard icon={MapPin} label="Avg Places/Tile" value={avgPlaces} />
      </div>

      <SectionCard
        title={`Tiles for ${selectedCity.city_name}`}
        subtitle={`${totalTiles} tiles`}
        action={
          <div className="flex gap-1">
            <Button variant={viewMode === "table" ? "primary" : "ghost"} size="sm" icon={List}
              onClick={() => setViewMode("table")} aria-label="Table view" />
            <Button variant={viewMode === "grid" ? "primary" : "ghost"} size="sm" icon={Grid3X3}
              onClick={() => setViewMode("grid")} aria-label="Grid view" />
          </div>
        }
      >
        {viewMode === "table" ? (
          <DataTable columns={columns} rows={rows} loading={loading}
            emptyMessage="No tiles found for this city." emptyIcon={Grid3X3} />
        ) : (
          <div className="max-h-96 overflow-y-auto p-2">
            {loading ? (
              <div className="text-center py-8 text-[var(--color-text-secondary)]">Loading tiles...</div>
            ) : rows.length === 0 ? (
              <div className="text-center py-8 text-[var(--color-text-tertiary)]">No tiles found.</div>
            ) : (
              <div className="inline-grid gap-1" style={{ gridTemplateColumns: `repeat(${maxCol + 1}, 2.5rem)` }}>
                {Array.from({ length: maxRow + 1 }, (_, ri) =>
                  Array.from({ length: maxCol + 1 }, (_, ci) => {
                    const tile = tileMap[`${ri}-${ci}`];
                    if (!tile) return <div key={`${ri}-${ci}`} className="w-10 h-10" />;
                    return (
                      <div
                        key={tile.tile_id}
                        className={`w-10 h-10 rounded flex items-center justify-center text-xs font-medium cursor-default ${tileColor(tile.active_places)}`}
                        title={`Tile #${tile.tile_index}: ${tile.active_places} places, ${tile.category_count} categories, ${tile.seeded ? "seeded" : "not seeded"}`}
                      >
                        {tile.tile_index}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ── Tab 4: Uncategorized Places ──────────────────────────────────────────────

function UncategorizedPlacesTab({ selectedCity }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [assignCategory, setAssignCategory] = useState("");
  const [assigning, setAssigning] = useState(false);
  const mountedRef = useRef(true);
  const { addToast } = useToast();
  const pageSize = 50;

  const fetchData = useCallback(() => {
    mountedRef.current = true;
    setLoading(true);
    setError(null);
    const params = { p_limit: pageSize, p_offset: page * pageSize };
    if (selectedCity) params.p_city_id = selectedCity.city_id;

    supabase.rpc("admin_uncategorized_places", params).then(({ data, error: err }) => {
      if (!mountedRef.current) return;
      if (err) { setError(err.message); setLoading(false); return; }
      const result = data || [];
      setRows(result);
      setTotalCount(result.length > 0 ? Number(result[0].total_count) : 0);
      setLoading(false);
    });
  }, [selectedCity?.city_id, page]);

  useEffect(() => {
    fetchData();
    return () => { mountedRef.current = false; };
  }, [fetchData]);

  // Reset page when city changes
  useEffect(() => { setPage(0); setSelectedIds(new Set()); }, [selectedCity?.city_id]);

  const handleSelect = useCallback((id, checked) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback((selectAll) => {
    if (selectAll) {
      setSelectedIds(new Set(rows.map((r) => r.id)));
    } else {
      setSelectedIds(new Set());
    }
  }, [rows]);

  const handleAssign = async () => {
    if (!assignCategory || selectedIds.size === 0) return;
    setAssigning(true);
    const { data, error: err } = await supabase.rpc("admin_assign_place_category", {
      p_place_ids: [...selectedIds],
      p_category: assignCategory,
    });
    setAssigning(false);
    if (err) {
      addToast({ variant: "error", message: `Failed to assign: ${err.message}` });
    } else {
      const count = data?.updated || selectedIds.size;
      addToast({ variant: "success", message: `Assigned ${count} places to ${CATEGORY_LABELS[assignCategory] || assignCategory}` });
      setSelectedIds(new Set());
      setAssignCategory("");
      fetchData();
    }
  };

  const columns = [
    { key: "name", label: "Name" },
    {
      key: "address", label: "Address",
      render: (_, r) => <span title={r.address}>{(r.address || "").slice(0, 40)}{(r.address || "").length > 40 ? "…" : ""}</span>,
    },
    {
      key: "types", label: "Google Types",
      render: (_, r) => (
        <div className="flex gap-1 flex-wrap">
          {(r.types || []).slice(0, 3).map((t) => (
            <Badge key={t} variant="outline">{t.replace(/_/g, " ")}</Badge>
          ))}
        </div>
      ),
    },
    { key: "primary_type", label: "Primary Type" },
    {
      key: "rating", label: "Rating",
      render: (_, r) => r.rating ? `★ ${r.rating}` : "—",
    },
    ...(!selectedCity ? [{
      key: "city_name", label: "City",
    }] : []),
    {
      key: "is_active", label: "Active",
      render: (_, r) => <Badge variant={r.is_active ? "success" : "default"}>{r.is_active ? "Active" : "Inactive"}</Badge>,
    },
  ];

  const from = page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, totalCount);

  return (
    <div className="space-y-6">
      <ErrorBanner error={error} />
      <div className="grid grid-cols-1 gap-4">
        <StatCard icon={Tag} label="Total Uncategorized Places" value={totalCount} />
      </div>

      <SectionCard title="Uncategorized Places" subtitle={totalCount > 0 ? `${totalCount} places without a category` : ""}>
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          selectable
          selectedIds={selectedIds}
          onSelect={handleSelect}
          onSelectAll={handleSelectAll}
          getRowId={(r) => r.id}
          emptyMessage="No uncategorized places found. All places have categories assigned."
          emptyIcon={CheckCircle}
          pagination={totalCount > pageSize ? {
            page,
            pageSize,
            total: totalCount,
            from,
            to,
            onChange: setPage,
          } : undefined}
        />
      </SectionCard>

      {selectedIds.size > 0 && (
        <div className="sticky bottom-0 z-20 bg-[var(--color-background-primary)] border border-[var(--gray-200)] rounded-xl p-4 shadow-lg flex items-center gap-4">
          <span className="text-sm font-medium text-[var(--color-text-primary)]">
            {selectedIds.size} place{selectedIds.size !== 1 ? "s" : ""} selected
          </span>
          <select
            className="rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 py-2 text-sm"
            value={assignCategory}
            onChange={(e) => setAssignCategory(e.target.value)}
          >
            <option value="">Select category...</option>
            {Object.entries(CATEGORY_LABELS).map(([slug, label]) => (
              <option key={slug} value={slug}>{label}</option>
            ))}
          </select>
          <Button
            variant="primary"
            size="sm"
            disabled={!assignCategory}
            loading={assigning}
            onClick={handleAssign}
          >
            Assign Category
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Tab 5: Card Pool Intelligence ────────────────────────────────────────────

function CardPoolIntelligenceTab({ selectedCity }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);
  const cityMode = !!selectedCity;

  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    setError(null);
    const params = selectedCity ? { p_city_id: selectedCity.city_id } : {};
    supabase.rpc("admin_card_pool_intelligence", params).then(({ data: result, error: err }) => {
      if (!mountedRef.current) return;
      if (err) { setError(err.message); setLoading(false); return; }
      setData(Array.isArray(result) ? result[0] : result);
      setLoading(false);
    });
    return () => { mountedRef.current = false; };
  }, [selectedCity?.city_id]);

  if (loading) return <div className="text-center py-12 text-[var(--color-text-secondary)]">Loading card pool data...</div>;
  if (error) return <ErrorBanner error={error} />;
  if (!data) return <div className="text-center py-12 text-[var(--color-text-tertiary)]">No card pool data available.</div>;

  const byCat = data.by_category || {};
  const catRows = Object.entries(byCat).map(([slug, stats]) => ({
    _key: slug,
    category: slug,
    total: stats.total || 0,
    active: stats.active || 0,
    single: stats.single || 0,
    curated: stats.curated || 0,
  })).sort((a, b) => b.total - a.total);

  const catColumns = [
    { key: "category", label: "Category", sortable: true, render: (_, r) => categoryDot(r.category) },
    { key: "total", label: "Total", sortable: true },
    { key: "active", label: "Active", sortable: true },
    { key: "single", label: "Single", sortable: true },
    { key: "curated", label: "Curated", sortable: true },
  ];

  // Health alerts
  const alerts = [];
  if (data.orphaned_cards > 0) {
    alerts.push({ variant: "error", msg: `${data.orphaned_cards} orphaned cards — their parent places are inactive or deleted` });
  }
  if (data.stale_cards > 0) {
    alerts.push({ variant: "warning", msg: `${data.stale_cards} stale cards — parent places not refreshed in 30+ days` });
  }
  if (data.image_pct < 80) {
    alerts.push({ variant: "warning", msg: `Only ${data.image_pct}% of cards have images` });
  }
  if (data.never_served > data.active_cards * 0.5) {
    alerts.push({ variant: "info", msg: `${data.never_served} cards have never been shown to any user` });
  }

  const servedPct = data.active_cards > 0 ? Math.round((data.total_served / data.active_cards) * 100) : 0;

  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--color-text-secondary)]">
        {cityMode ? <>Showing card pool for <strong>{selectedCity.city_name}</strong></> : "Showing global card pool metrics"}
      </p>

      <div className="grid grid-cols-4 gap-4">
        <StatCard icon={CreditCard} label="Active Cards" value={data.active_cards}
          trend={`${data.single_cards} single + ${data.curated_cards} curated`} trendUp />
        <StatCard icon={Camera} label="Image Coverage" value={`${data.image_pct}%`}
          trend={data.image_pct >= 80 ? "Good" : data.image_pct >= 50 ? "Low" : "Critical"}
          trendUp={data.image_pct >= 80} />
        <StatCard icon={AlertTriangle} label="Orphaned Cards" value={data.orphaned_cards}
          trend={data.orphaned_cards === 0 ? "Clean" : "Needs Fix"} trendUp={data.orphaned_cards === 0} />
        <StatCard icon={Eye} label="Never Served" value={data.never_served}
          trend={data.active_cards > 0 ? `${Math.round((data.never_served / data.active_cards) * 100)}% of active` : "—"}
          trendUp={data.never_served < data.active_cards * 0.2} />
      </div>

      {alerts.length > 0 && (
        <SectionCard title="Health Alerts">
          <div className="space-y-3">
            {alerts.map((a, i) => (
              <AlertCard key={i} variant={a.variant}>{a.msg}</AlertCard>
            ))}
          </div>
        </SectionCard>
      )}

      <SectionCard title="Category Breakdown" subtitle={`${data.categories_covered} categories covered`}>
        <DataTable columns={catColumns} rows={catRows} loading={false}
          emptyMessage="No category data" emptyIcon={Layers} />
      </SectionCard>

      <SectionCard title="Serving Stats">
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div className="p-4 rounded-lg bg-[var(--gray-50)]">
            <div className="text-[var(--color-text-secondary)]">Total Impressions</div>
            <div className="text-xl font-semibold mt-1">{(data.total_impressions || 0).toLocaleString()}</div>
          </div>
          <div className="p-4 rounded-lg bg-[var(--gray-50)]">
            <div className="text-[var(--color-text-secondary)]">Cards Served ≥1 Time</div>
            <div className="text-xl font-semibold mt-1">{data.total_served} <span className="text-sm font-normal text-[var(--color-text-tertiary)]">({servedPct}%)</span></div>
          </div>
          <div className="p-4 rounded-lg bg-[var(--gray-50)]">
            <div className="text-[var(--color-text-secondary)]">Avg Serves per Card</div>
            <div className="text-xl font-semibold mt-1">{data.avg_served_count || "0"}</div>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function PoolIntelligencePage() {
  const [activeTab, setActiveTab] = useState("geographic");
  const [selectedCity, setSelectedCity] = useState(null);
  const [cities, setCities] = useState([]);
  const mountedRef = useRef(true);

  // Load cities once for the dropdown
  useEffect(() => {
    mountedRef.current = true;
    supabase.rpc("admin_pool_intelligence_overview").then(({ data }) => {
      if (!mountedRef.current) return;
      if (data) setCities(data);
    });
    return () => { mountedRef.current = false; };
  }, []);

  const selectCity = useCallback((city) => {
    setSelectedCity(city);
    if (activeTab === "geographic") setActiveTab("categories");
  }, [activeTab]);

  const clearCity = useCallback(() => setSelectedCity(null), []);

  return (
    <div className="space-y-4 py-6">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Pool Intelligence</h2>
          <p className="text-sm text-[var(--color-text-secondary)]">Drill-down intelligence: geography → categories → tiles → uncategorized → card pool.</p>
        </div>
      </div>

      <CityFilterBar
        selectedCity={selectedCity}
        cities={cities}
        onSelectCity={selectCity}
        onClearCity={clearCity}
      />

      <Tabs tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />

      <div className="mt-4">
        {activeTab === "geographic" && <GeographicInventoryTab onSelectCity={selectCity} />}
        {activeTab === "categories" && <CategoryMaturityTab selectedCity={selectedCity} />}
        {activeTab === "tiles" && <TileDetailTab selectedCity={selectedCity} onSwitchToGeographic={() => setActiveTab("geographic")} />}
        {activeTab === "uncategorized" && <UncategorizedPlacesTab selectedCity={selectedCity} />}
        {activeTab === "cards" && <CardPoolIntelligenceTab selectedCity={selectedCity} />}
      </div>
    </div>
  );
}

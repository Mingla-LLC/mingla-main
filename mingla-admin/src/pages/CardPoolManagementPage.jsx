/**
 * CARD POOL MANAGEMENT PAGE (Block 5 — hardened 2026-03-21)
 *
 * Full rewrite: UUID-based → TEXT-based. Zero seeding_cities dependencies.
 * Uses V2 RPCs: admin_card_pool_intelligence, admin_pool_category_health,
 * admin_country_overview, admin_country_city_overview.
 *
 * Navigation: Breadcrumb (All Countries → Country → City) matching PoolIntelligencePage.
 * Tabs: Overview, Browse, Generate, Card Health.
 *
 * Must never happen: referencing seeding_cities, seeding_tiles, or UUID-param RPCs.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  CreditCard, Camera, AlertTriangle, Eye, EyeOff, Clock, Play, Layers,
  CheckCircle,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { useToast } from "../context/ToastContext";
import { Tabs } from "../components/ui/Tabs";
import { Button } from "../components/ui/Button";
import { SectionCard, StatCard, AlertCard } from "../components/ui/Card";
import { DataTable } from "../components/ui/Table";
import { Badge } from "../components/ui/Badge";
import { Input } from "../components/ui/Input";
import { Breadcrumbs } from "../components/ui/Breadcrumbs";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { Spinner } from "../components/ui/Spinner";

// ── Constants ────────────────────────────────────────────────────────────────

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "browse", label: "Browse Cards" },
  { id: "generate", label: "Generate Cards" },
  { id: "health", label: "Card Health" },
];

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

const EXPERIENCE_TYPES = [
  { id: "adventurous", label: "Adventurous" },
  { id: "first-date", label: "First Date" },
  { id: "romantic", label: "Romantic" },
  { id: "group-fun", label: "Group Fun" },
  { id: "picnic-dates", label: "Picnic Dates" },
  { id: "take-a-stroll", label: "Take a Stroll" },
];

const ALL_CATEGORIES = Object.keys(CATEGORY_LABELS);
const PAGE_SIZE = 20;

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

function ErrorBanner({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="text-sm text-[var(--color-error-700)] bg-[var(--color-error-50)] p-3 rounded-lg flex items-center justify-between">
      <span>Failed to load data: {error}</span>
      {onRetry && (
        <button onClick={onRetry} className="text-xs font-medium underline cursor-pointer ml-3">
          Retry
        </button>
      )}
    </div>
  );
}

// ── CountryFilterBar (breadcrumb nav, matching PoolIntelligencePage) ─────────

function CountryFilterBar({ selectedCountry, selectedCity, countries, onSelectCountry, onClearCountry, onClearCity }) {
  const items = [
    { label: "All Countries", onClick: () => { onClearCountry(); } },
    ...(selectedCountry ? [
      selectedCity
        ? { label: selectedCountry, onClick: () => { onClearCity(); } }
        : { label: selectedCountry },
    ] : []),
    ...(selectedCity ? [{ label: selectedCity }] : []),
  ];

  return (
    <div className="flex items-center gap-3 mb-2">
      <Breadcrumbs items={items} />
      {!selectedCountry && countries.length > 0 && (
        <select
          className="ml-auto rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 py-2 text-sm"
          value=""
          onChange={(e) => {
            if (e.target.value) onSelectCountry(e.target.value);
          }}
        >
          <option value="">Jump to country...</option>
          {countries.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      )}
    </div>
  );
}

// ── Tab 1: Overview ─────────────────────────────────────────────────────────

function OverviewTab({ selectedCountry, selectedCity }) {
  const [data, setData] = useState(null);
  const [catHealth, setCatHealth] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  const fetchData = useCallback(() => {
    mountedRef.current = true;
    setLoading(true);
    setError(null);

    const params = {};
    if (selectedCountry) params.p_country = selectedCountry;
    if (selectedCity) params.p_city = selectedCity;

    Promise.all([
      supabase.rpc("admin_card_pool_intelligence", params),
      supabase.rpc("admin_pool_category_health", params),
    ]).then(([intRes, catRes]) => {
      if (!mountedRef.current) return;
      if (intRes.error) { setError(intRes.error.message); setLoading(false); return; }
      if (catRes.error) { setError(catRes.error.message); setLoading(false); return; }
      setData(Array.isArray(intRes.data) ? intRes.data[0] : intRes.data);
      setCatHealth(catRes.data || []);
      setLoading(false);
    });
  }, [selectedCountry, selectedCity]);

  useEffect(() => {
    fetchData();
    return () => { mountedRef.current = false; };
  }, [fetchData]);

  if (loading) return <div className="text-center py-12 text-[var(--color-text-secondary)]">Loading card pool data...</div>;
  if (error) return <ErrorBanner error={error} onRetry={fetchData} />;
  if (!data) return <div className="text-center py-12 text-[var(--color-text-tertiary)]">No card pool data available.</div>;

  const scope = selectedCity
    ? <>{selectedCountry} &gt; <strong>{selectedCity}</strong></>
    : selectedCountry
    ? <strong>{selectedCountry}</strong>
    : "global card pool metrics";

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

  // Category health table
  const catColumns = [
    { key: "category", label: "Category", sortable: true, render: (_, r) => categoryDot(r.category) },
    { key: "active_places", label: "Active Places", sortable: true },
    { key: "photo_pct", label: "Photo %", sortable: true, render: (_, r) => pctBadge(r.photo_pct || 0) },
    { key: "total_cards", label: "Total Cards", sortable: true },
    { key: "places_needing_cards", label: "Places Needing Cards", sortable: true },
    { key: "health", label: "Health", render: (_, r) => healthBadge(r.health) },
  ];

  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--color-text-secondary)]">
        Showing card pool for {scope}
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

      <SectionCard title="Category Health" subtitle={`${catHealth.length} categories`}>
        <DataTable columns={catColumns} rows={catHealth} loading={false}
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

// ── Card Detail Modal ───────────────────────────────────────────────────────

function CardDetailModal({ card, open, onClose, onToggleActive }) {
  const [stops, setStops] = useState([]);
  const [stopsLoading, setStopsLoading] = useState(false);
  const [stopsError, setStopsError] = useState(null);

  useEffect(() => {
    if (!open || !card || card.card_type !== "curated") return;
    setStopsLoading(true);
    setStopsError(null);
    supabase.from("card_pool_stops")
      .select("*, place_pool(name, address)")
      .eq("card_pool_id", card.id)
      .order("stop_order")
      .then(({ data, error }) => {
        if (error) setStopsError("Could not load stops for this experience.");
        else setStops(data || []);
        setStopsLoading(false);
      });
  }, [open, card]);

  if (!card) return null;

  const images = card.images || (card.image_url ? [card.image_url] : []);

  return (
    <Modal open={open} onClose={onClose} title={card.title || "Card Detail"} size="lg">
      <ModalBody>
        <div className="space-y-6">
          {/* Photo gallery */}
          {images.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-2">
              {images.map((url, i) => (
                <img key={i} src={url} alt="" className="w-32 h-32 rounded-lg object-cover shrink-0" />
              ))}
            </div>
          )}
          {images.length === 0 && (
            <div className="text-sm text-[var(--color-text-tertiary)]">No images</div>
          )}

          {/* Details grid */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div><span className="text-[var(--color-text-secondary)]">Title:</span> <span className="font-medium">{card.title}</span></div>
            <div><span className="text-[var(--color-text-secondary)]">Type:</span> <Badge variant={card.card_type === "curated" ? "brand" : "default"}>{card.card_type}</Badge></div>
            <div><span className="text-[var(--color-text-secondary)]">Category:</span> {CATEGORY_LABELS[card.category] || card.category || (card.categories?.[0] ? CATEGORY_LABELS[card.categories[0]] || card.categories[0] : "—")}</div>
            <div><span className="text-[var(--color-text-secondary)]">Status:</span> <Badge variant={card.is_active ? "success" : "error"}>{card.is_active ? "Active" : "Inactive"}</Badge></div>
            <div><span className="text-[var(--color-text-secondary)]">City:</span> {card.city || "—"}</div>
            <div><span className="text-[var(--color-text-secondary)]">Country:</span> {card.country || "—"}</div>
            <div><span className="text-[var(--color-text-secondary)]">Lat/Lng:</span> {card.lat && card.lng ? `${card.lat}, ${card.lng}` : "—"}</div>
            <div><span className="text-[var(--color-text-secondary)]">Created:</span> {card.created_at ? new Date(card.created_at).toLocaleDateString() : "—"}</div>
            <div><span className="text-[var(--color-text-secondary)]">Served:</span> {card.served_count || 0} times</div>
            <div><span className="text-[var(--color-text-secondary)]">Place Pool ID:</span> {card.place_pool_id || "—"}</div>
          </div>

          {/* Curated stops */}
          {card.card_type === "curated" && (
            <div>
              <h4 className="text-sm font-semibold mb-2">Stops</h4>
              {stopsLoading && <Spinner size="sm" />}
              {stopsError && <div className="text-sm text-[var(--color-error-600)]">{stopsError}</div>}
              {!stopsLoading && !stopsError && stops.length === 0 && (
                <div className="text-sm text-[var(--color-text-tertiary)]">No stops found.</div>
              )}
              {stops.length > 0 && (
                <div className="space-y-2">
                  {stops.map((s, i) => (
                    <div key={s.id || i} className="flex items-center gap-3 text-sm py-1.5 border-b border-[var(--gray-100)] last:border-0">
                      <span className="w-6 h-6 rounded-full bg-[var(--color-brand-50)] text-[var(--color-brand-500)] flex items-center justify-center text-xs font-semibold shrink-0">
                        {s.stop_order}
                      </span>
                      <div>
                        <div className="font-medium">{s.place_pool?.name || `Stop ${s.stop_order}`}</div>
                        {s.place_pool?.address && <div className="text-[var(--color-text-tertiary)] text-xs">{s.place_pool.address}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant={card.is_active ? "danger" : "primary"} onClick={() => onToggleActive(card)}>
          {card.is_active ? "Deactivate" : "Activate"}
        </Button>
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </ModalFooter>
    </Modal>
  );
}

// ── Tab 2: Browse Cards ─────────────────────────────────────────────────────

function BrowseCardsTab({ selectedCountry, selectedCity, onRefresh }) {
  const { addToast } = useToast();
  const [cards, setCards] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ cardType: "", category: "", status: "active", nameSearch: "" });
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [detailCard, setDetailCard] = useState(null);
  const mountedRef = useRef(true);

  const fetchCards = useCallback(async () => {
    mountedRef.current = true;
    setLoading(true);

    let q = supabase.from("card_pool")
      .select("id, title, card_type, category, categories, image_url, images, is_active, served_count, created_at, city, country, place_pool_id, lat, lng", { count: "exact" });

    if (selectedCity) q = q.eq("city", selectedCity);
    else if (selectedCountry) q = q.eq("country", selectedCountry);

    if (filters.cardType) q = q.eq("card_type", filters.cardType);
    if (filters.category) q = q.contains("categories", [filters.category]);
    if (filters.status === "active") q = q.eq("is_active", true);
    else if (filters.status === "inactive") q = q.eq("is_active", false);
    if (filters.nameSearch) q = q.ilike("title", `%${filters.nameSearch}%`);

    q = q.order("created_at", { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

    const { data, count, error } = await q;
    if (!mountedRef.current) return;
    if (error) {
      addToast({ variant: "error", title: "Failed to load cards", description: error.message });
      setLoading(false);
      return;
    }
    setCards(data || []);
    setTotal(count || 0);
    setLoading(false);
  }, [selectedCountry, selectedCity, filters, page, addToast]);

  useEffect(() => {
    fetchCards();
    return () => { mountedRef.current = false; };
  }, [fetchCards]);

  // Reset page when filters change
  useEffect(() => { setPage(1); setSelectedIds(new Set()); }, [selectedCountry, selectedCity]);

  const toggleActive = async (card) => {
    const { error } = await supabase.from("card_pool")
      .update({ is_active: !card.is_active, updated_at: new Date().toISOString() })
      .eq("id", card.id);
    if (error) {
      addToast({ variant: "error", title: "Update failed", description: error.message });
    } else {
      addToast({ variant: "success", title: `Card ${card.is_active ? "deactivated" : "activated"}` });
      fetchCards();
      if (onRefresh) onRefresh();
    }
    // Close modal if open
    if (detailCard?.id === card.id) setDetailCard(null);
  };

  const bulkUpdateActive = async (isActive) => {
    const ids = [...selectedIds];
    const { error } = await supabase.from("card_pool")
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .in("id", ids);
    if (error) {
      addToast({ variant: "error", title: "Bulk update failed", description: error.message });
    } else {
      addToast({ variant: "success", title: `${ids.length} cards ${isActive ? "activated" : "deactivated"}` });
      setSelectedIds(new Set());
      fetchCards();
      if (onRefresh) onRefresh();
    }
  };

  const handleSelect = useCallback((id, checked) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback((selectAll) => {
    if (selectAll) setSelectedIds(new Set(cards.map((c) => c.id)));
    else setSelectedIds(new Set());
  }, [cards]);

  const columns = [
    {
      key: "title", label: "Title", sortable: true,
      render: (_, r) => (
        <button onClick={() => setDetailCard(r)} className="text-[var(--color-brand-500)] hover:underline cursor-pointer font-medium text-left">
          {r.title || "Untitled"}
        </button>
      ),
    },
    { key: "card_type", label: "Type", render: (_, r) => <Badge variant={r.card_type === "curated" ? "brand" : "default"}>{r.card_type}</Badge> },
    { key: "category", label: "Category", render: (_, r) => CATEGORY_LABELS[r.category] || r.category || (r.categories?.[0] ? CATEGORY_LABELS[r.categories[0]] || r.categories[0] : "—") },
    { key: "image_url", label: "Photo", render: (_, r) => r.image_url ? <img src={r.image_url} className="w-10 h-10 rounded object-cover" alt="" /> : <Badge variant="error">None</Badge> },
    { key: "images", label: "Images", render: (_, r) => {
      const count = r.images?.length || 0;
      return count > 0 ? <Badge variant="default">{count} photos</Badge> : <Badge variant="error">0</Badge>;
    }},
    { key: "served_count", label: "Served", render: (_, r) => (r.served_count || 0) > 0 ? r.served_count : <span className="text-[var(--color-warning-600)]">Never</span> },
    { key: "is_active", label: "Status", render: (_, r) => <Badge variant={r.is_active ? "success" : "error"}>{r.is_active ? "Active" : "Inactive"}</Badge> },
    { key: "actions", label: "", render: (_, r) => (
      <Button size="sm" variant={r.is_active ? "danger" : "primary"} onClick={() => toggleActive(r)}>
        {r.is_active ? "Deactivate" : "Activate"}
      </Button>
    )},
  ];

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <label className="text-xs text-[var(--color-text-secondary)]">Type</label>
          <select className="block mt-1 rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm"
            value={filters.cardType} onChange={(e) => { setFilters((f) => ({ ...f, cardType: e.target.value })); setPage(1); setSelectedIds(new Set()); }}>
            <option value="">All</option>
            <option value="single">Single</option>
            <option value="curated">Curated</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-[var(--color-text-secondary)]">Category</label>
          <select className="block mt-1 rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm"
            value={filters.category} onChange={(e) => { setFilters((f) => ({ ...f, category: e.target.value })); setPage(1); setSelectedIds(new Set()); }}>
            <option value="">All</option>
            {ALL_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-[var(--color-text-secondary)]">Status</label>
          <select className="block mt-1 rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm"
            value={filters.status} onChange={(e) => { setFilters((f) => ({ ...f, status: e.target.value })); setPage(1); setSelectedIds(new Set()); }}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <Input label="Search" value={filters.nameSearch} placeholder="Card title..."
            onChange={(e) => { setFilters((f) => ({ ...f, nameSearch: e.target.value })); setPage(1); setSelectedIds(new Set()); }} />
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="sticky bottom-0 z-20 bg-[var(--color-background-primary)] border border-[var(--gray-200)] rounded-xl p-4 shadow-lg flex items-center gap-4">
          <span className="text-sm font-medium text-[var(--color-text-primary)]">
            {selectedIds.size} card{selectedIds.size !== 1 ? "s" : ""} selected
          </span>
          <Button size="sm" variant="primary" onClick={() => bulkUpdateActive(true)}>Activate</Button>
          <Button size="sm" variant="danger" onClick={() => bulkUpdateActive(false)}>Deactivate</Button>
        </div>
      )}

      <DataTable columns={columns} rows={cards} loading={loading}
        selectable selectedIds={selectedIds} onSelect={handleSelect} onSelectAll={handleSelectAll} getRowId={(r) => r.id}
        emptyMessage="No cards found" emptyIcon={Layers}
        pagination={{ page, pageSize: PAGE_SIZE, total, onChange: setPage }} />

      <CardDetailModal card={detailCard} open={!!detailCard} onClose={() => setDetailCard(null)} onToggleActive={toggleActive} />
    </div>
  );
}

// ── Tab 3: Generate Cards ───────────────────────────────────────────────────

function GenerateCardsTab({ selectedCountry, selectedCity, onRefresh }) {
  const { addToast } = useToast();
  const [bbox, setBbox] = useState(null);
  const [bboxLoading, setBboxLoading] = useState(false);
  const [bboxError, setBboxError] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState(null);
  const [resultType, setResultType] = useState(null); // "single" | "curated"
  const [selectedCat, setSelectedCat] = useState("");
  const [selectedExpType, setSelectedExpType] = useState("adventurous");
  const [dryRun, setDryRun] = useState(false);
  const mountedRef = useRef(true);

  // Compute bounding box when city is selected
  useEffect(() => {
    mountedRef.current = true;
    if (!selectedCity || !selectedCountry) { setBbox(null); setBboxError(null); return; }

    setBboxLoading(true);
    setBboxError(null);

    supabase.from("place_pool")
      .select("lat, lng")
      .eq("country", selectedCountry)
      .eq("city", selectedCity)
      .eq("is_active", true)
      .then(({ data, error }) => {
        if (!mountedRef.current) return;
        if (error) { setBboxError(error.message); setBboxLoading(false); return; }
        if (!data?.length) { setBbox(null); setBboxError("no_places"); setBboxLoading(false); return; }

        const lats = data.map((p) => p.lat).filter(Boolean);
        const lngs = data.map((p) => p.lng).filter(Boolean);
        if (lats.length === 0) { setBbox(null); setBboxError("no_places"); setBboxLoading(false); return; }

        const minLat = Math.min(...lats), maxLat = Math.max(...lats);
        const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
        const centerLat = (minLat + maxLat) / 2;
        const centerLng = (minLng + maxLng) / 2;
        const latSpan = (maxLat - minLat) * 111320;
        const lngSpan = (maxLng - minLng) * 111320 * Math.cos(centerLat * Math.PI / 180);
        const radiusMeters = Math.max(latSpan, lngSpan) / 2 + 500;

        setBbox({ location: { lat: centerLat, lng: centerLng }, radiusMeters: Math.max(radiusMeters, 1500) });
        setBboxLoading(false);
      });

    return () => { mountedRef.current = false; };
  }, [selectedCountry, selectedCity]);

  const generateSingle = async () => {
    if (!bbox) return;
    setGenerating(true);
    setResult(null);
    setResultType("single");
    try {
      const body = {
        location: bbox.location,
        radiusMeters: bbox.radiusMeters,
        ...(selectedCat ? { categories: [selectedCat] } : {}),
        dryRun,
      };
      const { data, error } = await supabase.functions.invoke("generate-single-cards", { body });
      if (error) throw new Error(error.message);
      setResult(data);
      addToast({ variant: "success", title: dryRun ? "Dry run complete" : "Single card generation complete" });
      if (!dryRun && onRefresh) onRefresh();
    } catch (err) {
      addToast({ variant: "error", title: "Generation failed", description: err.message });
    } finally {
      setGenerating(false);
    }
  };

  const generateCurated = async () => {
    if (!bbox) return;
    setGenerating(true);
    setResult(null);
    setResultType("curated");
    try {
      const body = {
        location: bbox.location,
        experienceType: selectedExpType || "adventurous",
        skipDescriptions: false,
        limit: 20,
      };
      const { data, error } = await supabase.functions.invoke("generate-curated-experiences", { body });
      if (error) throw new Error(error.message);
      setResult(data);
      addToast({ variant: "success", title: "Curated experience generation complete" });
      if (onRefresh) onRefresh();
    } catch (err) {
      addToast({ variant: "error", title: "Generation failed", description: err.message });
    } finally {
      setGenerating(false);
    }
  };

  if (!selectedCity) {
    return <div className="text-center py-12 text-[var(--color-text-secondary)]">Select a country and city to generate cards.</div>;
  }
  if (bboxLoading) {
    return <div className="flex items-center justify-center py-12 gap-3"><Spinner size="md" /> <span className="text-sm text-[var(--color-text-secondary)]">Computing city bounds...</span></div>;
  }
  if (bboxError === "no_places") {
    return <div className="text-center py-12 text-[var(--color-text-secondary)]">No active places found in {selectedCity}. Seed places first via the Place Pool page.</div>;
  }
  if (bboxError) {
    return <ErrorBanner error={bboxError} />;
  }

  // Format single card results as table
  const renderResults = () => {
    if (!result) return null;

    if (resultType === "single") {
      const catBreakdown = result.categories || result.results || [];
      const resultRows = Array.isArray(catBreakdown)
        ? catBreakdown.map((r) => ({
          _key: r.category || r.name,
          category: CATEGORY_LABELS[r.category] || r.category || r.name || "—",
          created: r.created || r.count || 0,
          skipped: r.skipped || 0,
          reason: r.skippedReasons?.join(", ") || r.reason || "—",
        }))
        : Object.entries(catBreakdown).map(([slug, stats]) => ({
          _key: slug,
          category: CATEGORY_LABELS[slug] || slug,
          created: stats.created || stats.count || 0,
          skipped: stats.skipped || 0,
          reason: stats.skippedReasons?.join(", ") || "—",
        }));

      const totalCreated = resultRows.reduce((s, r) => s + r.created, 0);
      const resultColumns = [
        { key: "category", label: "Category" },
        { key: "created", label: "Created" },
        { key: "skipped", label: "Skipped" },
        { key: "reason", label: "Reason" },
      ];

      return (
        <SectionCard title="Generation Results"
          subtitle={dryRun ? "Dry Run — No cards were created. Preview:" : `Generated ${totalCreated} single cards`}>
          <DataTable columns={resultColumns} rows={resultRows} loading={false} emptyMessage="No results" />
        </SectionCard>
      );
    }

    if (resultType === "curated") {
      const experiences = result.experiences || result.cards || result.results || [];
      const titles = Array.isArray(experiences) ? experiences.map((e) => e.title || e.name || "Untitled") : [];

      return (
        <SectionCard title="Generation Results"
          subtitle={`Generated ${titles.length} curated experiences (type: ${selectedExpType})`}>
          {titles.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {titles.map((t, i) => (
                <li key={i} className="flex items-center gap-2 py-1">
                  <CheckCircle className="w-4 h-4 text-[var(--color-success-500)] shrink-0" />
                  {t}
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-sm text-[var(--color-text-tertiary)]">No experiences returned. Check edge function logs.</div>
          )}
        </SectionCard>
      );
    }

    return null;
  };

  return (
    <div className="space-y-6">
      <SectionCard title="Single Card Generation" subtitle={`Generate cards for ${selectedCity}`}>
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="text-xs text-[var(--color-text-secondary)]">Category (optional)</label>
            <select className="block mt-1 rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm"
              value={selectedCat} onChange={(e) => setSelectedCat(e.target.value)}>
              <option value="">All Categories</option>
              {ALL_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="dryrun" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} className="rounded" />
            <label htmlFor="dryrun" className="text-sm text-[var(--color-text-secondary)] cursor-pointer">Dry Run</label>
          </div>
          <Button icon={Play} loading={generating} disabled={generating} onClick={generateSingle}>
            Generate Single Cards
          </Button>
        </div>
      </SectionCard>

      <SectionCard title="Curated Experience Generation" subtitle="Multi-stop itinerary cards">
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="text-xs text-[var(--color-text-secondary)]">Experience Type</label>
            <select className="block mt-1 rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm"
              value={selectedExpType} onChange={(e) => setSelectedExpType(e.target.value)}>
              {EXPERIENCE_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
          <Button icon={Play} loading={generating} disabled={generating} onClick={generateCurated}>
            Generate Curated Experiences
          </Button>
        </div>
      </SectionCard>

      {renderResults()}
    </div>
  );
}

// ── Tab 4: Card Health ──────────────────────────────────────────────────────

function CardHealthTab({ selectedCountry, selectedCity, onSelectCountry, onSelectCity }) {
  const { addToast } = useToast();
  const [data, setData] = useState(null);
  const [catHealth, setCatHealth] = useState([]);
  const [orphanedCards, setOrphanedCards] = useState([]);
  const [crossCityRows, setCrossCityRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  const fetchData = useCallback(() => {
    mountedRef.current = true;
    setLoading(true);
    setError(null);

    const params = {};
    if (selectedCountry) params.p_country = selectedCountry;
    if (selectedCity) params.p_city = selectedCity;

    const promises = [
      supabase.rpc("admin_card_pool_intelligence", params),
      supabase.rpc("admin_pool_category_health", params),
    ];

    // If no city selected, fetch cross-city data
    if (!selectedCity) {
      if (selectedCountry) {
        promises.push(supabase.rpc("admin_country_city_overview", { p_country: selectedCountry }));
      } else {
        promises.push(supabase.rpc("admin_country_overview"));
      }
    }

    // If city selected, fetch orphaned cards list
    if (selectedCity) {
      promises.push(
        supabase.from("card_pool")
          .select("id, title, card_type, category, place_pool_id, place_pool!left(is_active)")
          .eq("is_active", true)
          .eq("city", selectedCity)
          .eq("card_type", "single")
          .or("place_pool_id.is.null,place_pool.is_active.eq.false")
          .limit(50)
      );
    }

    Promise.all(promises).then((results) => {
      if (!mountedRef.current) return;

      const [intRes, catRes, thirdRes] = results;
      if (intRes.error) { setError(intRes.error.message); setLoading(false); return; }
      if (catRes.error) { setError(catRes.error.message); setLoading(false); return; }

      setData(Array.isArray(intRes.data) ? intRes.data[0] : intRes.data);
      setCatHealth(catRes.data || []);

      if (!selectedCity && thirdRes) {
        setCrossCityRows(thirdRes.data || []);
      }
      if (selectedCity && thirdRes) {
        setOrphanedCards(thirdRes.data || []);
      }

      setLoading(false);
    });
  }, [selectedCountry, selectedCity]);

  useEffect(() => {
    fetchData();
    return () => { mountedRef.current = false; };
  }, [fetchData]);

  if (loading) return <div className="text-center py-12 text-[var(--color-text-secondary)]">Loading card health data...</div>;
  if (error) return <ErrorBanner error={error} onRetry={fetchData} />;
  if (!data) return <div className="text-center py-12 text-[var(--color-text-tertiary)]">No card health data available.</div>;

  // Cross-city comparison when no city selected
  if (!selectedCity) {
    const isCountryLevel = !!selectedCountry;
    const crossColumns = isCountryLevel
      ? [
        {
          key: "city_name", label: "City", sortable: true,
          render: (_, r) => (
            <button onClick={() => onSelectCity(r.city_name)} className="text-[var(--color-brand-500)] hover:underline cursor-pointer font-medium text-left">
              {r.city_name}
            </button>
          ),
        },
        { key: "active_places", label: "Active Places", sortable: true },
        { key: "card_image_pct", label: "Card Photo %", sortable: true, render: (_, r) => pctBadge(r.card_image_pct || 0) },
        { key: "total_cards", label: "Cards", sortable: true },
        { key: "category_coverage", label: "Categories", sortable: true, render: (_, r) => `${r.category_coverage || 0}/13` },
      ]
      : [
        {
          key: "country", label: "Country", sortable: true,
          render: (_, r) => (
            <button onClick={() => onSelectCountry(r.country)} className="text-[var(--color-brand-500)] hover:underline cursor-pointer font-medium text-left">
              {r.country}
            </button>
          ),
        },
        { key: "active_places", label: "Active Places", sortable: true },
        { key: "card_image_pct", label: "Card Photo %", sortable: true, render: (_, r) => pctBadge(r.card_image_pct || 0) },
        { key: "total_cards", label: "Cards", sortable: true },
        { key: "category_coverage", label: "Categories", sortable: true, render: (_, r) => `${r.category_coverage || 0}/13` },
      ];

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-3 gap-4">
          <StatCard icon={AlertTriangle} label="Orphaned Cards" value={data.orphaned_cards}
            trend={data.orphaned_cards === 0 ? "Clean" : "Needs Fix"} trendUp={data.orphaned_cards === 0} />
          <StatCard icon={Clock} label="Stale Cards" value={data.stale_cards}
            trend={data.stale_cards === 0 ? "Fresh" : "Needs Refresh"} trendUp={data.stale_cards === 0} />
          <StatCard icon={EyeOff} label="Never Served" value={data.never_served}
            trend={data.active_cards > 0 ? `${Math.round((data.never_served / data.active_cards) * 100)}% of active` : "—"}
            trendUp={data.never_served < data.active_cards * 0.2} />
        </div>

        <SectionCard title="Cross-City Comparison" subtitle={`${crossCityRows.length} ${isCountryLevel ? "cities" : "countries"}`}>
          <DataTable columns={crossColumns} rows={crossCityRows} loading={false}
            emptyMessage="No data available" emptyIcon={Layers} />
        </SectionCard>
      </div>
    );
  }

  // City-level health view
  const deactivateOrphaned = async (card) => {
    const { error: err } = await supabase.from("card_pool")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", card.id);
    if (err) addToast({ variant: "error", title: "Deactivation failed", description: err.message });
    else { addToast({ variant: "success", title: `"${card.title}" deactivated` }); fetchData(); }
  };

  const orphanedColumns = [
    { key: "title", label: "Title" },
    { key: "card_type", label: "Type", render: (_, r) => <Badge variant="default">{r.card_type}</Badge> },
    { key: "category", label: "Category", render: (_, r) => CATEGORY_LABELS[r.category] || r.category || "—" },
    { key: "actions", label: "", render: (_, r) => (
      <Button size="sm" variant="danger" onClick={() => deactivateOrphaned(r)}>Deactivate</Button>
    )},
  ];

  const gapRows = catHealth.filter((r) => (r.places_needing_cards || 0) > 0);
  const gapColumns = [
    { key: "category", label: "Category", render: (_, r) => categoryDot(r.category) },
    { key: "active_places", label: "Active Places" },
    { key: "total_cards", label: "Total Cards" },
    { key: "places_needing_cards", label: "Places Needing Cards" },
    { key: "health", label: "Health", render: (_, r) => healthBadge(r.health) },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <StatCard icon={AlertTriangle} label="Orphaned Cards" value={data.orphaned_cards}
          trend={data.orphaned_cards === 0 ? "Clean" : "Needs Fix"} trendUp={data.orphaned_cards === 0} />
        <StatCard icon={Clock} label="Stale Cards" value={data.stale_cards}
          trend={data.stale_cards === 0 ? "Fresh" : "Needs Refresh"} trendUp={data.stale_cards === 0} />
        <StatCard icon={EyeOff} label="Never Served" value={data.never_served}
          trend={data.active_cards > 0 ? `${Math.round((data.never_served / data.active_cards) * 100)}% of active` : "—"}
          trendUp={data.never_served < data.active_cards * 0.2} />
      </div>

      {orphanedCards.length > 0 && (
        <SectionCard title={`Orphaned Cards (${orphanedCards.length})`} subtitle="Active single cards whose parent place is inactive or missing">
          <DataTable columns={orphanedColumns} rows={orphanedCards} loading={false}
            emptyMessage="No orphaned cards" emptyIcon={CheckCircle} />
        </SectionCard>
      )}

      {gapRows.length > 0 && (
        <SectionCard title="Category Gaps" subtitle="Categories with places that need cards">
          <DataTable columns={gapColumns} rows={gapRows} loading={false}
            emptyMessage="All categories covered" emptyIcon={CheckCircle} />
        </SectionCard>
      )}

      {orphanedCards.length === 0 && gapRows.length === 0 && (
        <div className="text-center py-8 text-[var(--color-text-tertiary)]">
          No health issues found for {selectedCity}. All cards are healthy.
        </div>
      )}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function CardPoolManagementPage() {
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedCountry, setSelectedCountry] = useState(null);
  const [selectedCity, setSelectedCity] = useState(null);
  const [countries, setCountries] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const mountedRef = useRef(true);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Load country list for breadcrumb dropdown
  useEffect(() => {
    mountedRef.current = true;
    supabase.rpc("admin_country_overview").then(({ data }) => {
      if (!mountedRef.current) return;
      if (data) setCountries(data.map((r) => r.country));
    });
    return () => { mountedRef.current = false; };
  }, []);

  const selectCountry = useCallback((country) => {
    setSelectedCountry(country);
    setSelectedCity(null);
  }, []);

  const selectCity = useCallback((cityName) => {
    setSelectedCity(cityName);
  }, []);

  const clearCountry = useCallback(() => {
    setSelectedCountry(null);
    setSelectedCity(null);
  }, []);

  const clearCity = useCallback(() => {
    setSelectedCity(null);
  }, []);

  return (
    <div className="space-y-4 py-6">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Card Pool Management</h2>
          <p className="text-sm text-[var(--color-text-secondary)]">Manage, generate, and monitor card pool health across all cities.</p>
        </div>
      </div>

      <CountryFilterBar
        selectedCountry={selectedCountry}
        selectedCity={selectedCity}
        countries={countries}
        onSelectCountry={selectCountry}
        onClearCountry={clearCountry}
        onClearCity={clearCity}
      />

      <Tabs tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />

      <div className="mt-4" key={refreshKey}>
        {activeTab === "overview" && (
          <OverviewTab selectedCountry={selectedCountry} selectedCity={selectedCity} />
        )}
        {activeTab === "browse" && (
          <BrowseCardsTab selectedCountry={selectedCountry} selectedCity={selectedCity} onRefresh={refresh} />
        )}
        {activeTab === "generate" && (
          <GenerateCardsTab selectedCountry={selectedCountry} selectedCity={selectedCity} onRefresh={refresh} />
        )}
        {activeTab === "health" && (
          <CardHealthTab selectedCountry={selectedCountry} selectedCity={selectedCity}
            onSelectCountry={selectCountry} onSelectCity={(city) => { setSelectedCity(city); setActiveTab("overview"); }} />
        )}
      </div>
    </div>
  );
}

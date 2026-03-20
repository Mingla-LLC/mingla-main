import { useState, useEffect, useRef, useCallback } from "react";
import {
  Rocket, Play, Layers, CheckCircle, XCircle, AlertTriangle, ChevronRight,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { useToast } from "../context/ToastContext";
import { Tabs } from "../components/ui/Tabs";
import { Button } from "../components/ui/Button";
import { SectionCard, StatCard } from "../components/ui/Card";
import { DataTable } from "../components/ui/Table";
import { Badge } from "../components/ui/Badge";
import { Input } from "../components/ui/Input";

// ── Constants ────────────────────────────────────────────────────────────────

const SUB_TABS = [
  { id: "readiness", label: "Launch Readiness" },
  { id: "generate", label: "Generate Cards" },
  { id: "browse", label: "Browse Cards" },
  { id: "gaps", label: "Gap Analysis" },
];

const CATEGORY_LABELS = {
  nature_views: "Nature & Views", first_meet: "First Meet", picnic_park: "Picnic Park",
  drink: "Drink", casual_eats: "Casual Eats", fine_dining: "Fine Dining",
  watch: "Watch", live_performance: "Live Performance", creative_arts: "Creative & Arts",
  play: "Play", wellness: "Wellness", flowers: "Flowers", groceries: "Groceries",
};

const ALL_CATEGORIES = Object.keys(CATEGORY_LABELS);

const HARD_CAP_USD = 70;

function formatCost(n) { return `$${(n || 0).toFixed(2)}`; }

// ── City Selector (shared with PlacePool) ────────────────────────────────────

function CitySelector({ cities, selectedCity, onSelect }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <select
        className="flex-1 rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 py-2 text-sm"
        value={selectedCity?.id || ""}
        onChange={(e) => {
          const city = cities.find((c) => c.id === e.target.value);
          onSelect(city || null);
        }}
      >
        <option value="">All Cities</option>
        {cities.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}, {c.country} — {c.status}
          </option>
        ))}
      </select>
    </div>
  );
}

// ── Tab 1: Launch Readiness ──────────────────────────────────────────────────

function ReadinessTab({ city, placeStats, cardStats, spendTotal, tileCount, onLaunch }) {
  if (!city) return <div className="text-center py-12 text-[var(--color-text-secondary)]">Select a city to check readiness.</div>;

  const totalPlaces = placeStats?.total_places || 0;
  const withPhotos = placeStats?.with_photos || 0;
  const photoPct = totalPlaces > 0 ? Math.round((withPhotos / totalPlaces) * 100) : 0;
  const singleCards = cardStats?.total_single_cards || 0;
  const curatedCards = cardStats?.total_curated_cards || 0;
  const byCat = cardStats?.by_category || {};
  const catCoverage = Object.keys(byCat).filter((k) => (byCat[k] || 0) > 0).length;

  const checks = [
    { label: "City defined + tiles generated", pass: tileCount > 0, value: `${tileCount} tiles` },
    { label: "Places seeded (≥50 active)", pass: totalPlaces >= 50, warn: totalPlaces >= 20 && totalPlaces < 50, value: `${totalPlaces} places` },
    { label: "Photos downloaded (≥80% coverage)", pass: photoPct >= 80, warn: photoPct >= 50 && photoPct < 80, value: `${photoPct}%` },
    { label: "Single cards generated", pass: singleCards > 0, value: `${singleCards} cards` },
    { label: "Curated cards (≥10)", pass: curatedCards >= 10, warn: curatedCards >= 5 && curatedCards < 10, value: `${curatedCards} cards` },
    { label: "Category coverage (≥8/13)", pass: catCoverage >= 8, warn: catCoverage >= 5 && catCoverage < 8, value: `${catCoverage}/13` },
    { label: `Spend ≤ $${HARD_CAP_USD}`, pass: spendTotal <= HARD_CAP_USD, value: formatCost(spendTotal) },
  ];

  const greenCount = checks.filter((c) => c.pass).length;
  const readinessPct = Math.round((greenCount / checks.length) * 100);
  const allGreen = greenCount === checks.length;

  return (
    <div className="space-y-6">
      {/* Overall Readiness */}
      <div className="flex items-center gap-8">
        <div className="relative w-28 h-28">
          <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
            <circle cx="50" cy="50" r="42" fill="none" stroke="var(--gray-200)" strokeWidth="8" />
            <circle cx="50" cy="50" r="42" fill="none"
              stroke={allGreen ? "var(--color-success-500)" : readinessPct >= 60 ? "var(--color-warning-500)" : "var(--color-error-500)"}
              strokeWidth="8" strokeDasharray={`${readinessPct * 2.64} ${264 - readinessPct * 2.64}`}
              strokeLinecap="round" />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center text-xl font-bold">{readinessPct}%</div>
        </div>
        <div>
          <h3 className="text-lg font-semibold">{city.name}, {city.country}</h3>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {allGreen ? "Ready to launch!" : `${greenCount}/${checks.length} checks passing`}
          </p>
          <Button variant="primary" icon={Rocket} className="mt-3" disabled={!allGreen}
            onClick={() => onLaunch(city.id)}>
            Launch {city.name}
          </Button>
        </div>
      </div>

      {/* Checklist */}
      <SectionCard title="Launch Checklist">
        <div className="space-y-2">
          {checks.map((check, i) => (
            <div key={i} className="flex items-center gap-3 py-2 border-b border-[var(--gray-100)] last:border-0">
              {check.pass ? (
                <CheckCircle className="w-5 h-5 text-[var(--color-success-500)] flex-shrink-0" />
              ) : check.warn ? (
                <AlertTriangle className="w-5 h-5 text-[var(--color-warning-500)] flex-shrink-0" />
              ) : (
                <XCircle className="w-5 h-5 text-[var(--color-error-500)] flex-shrink-0" />
              )}
              <span className="flex-1 text-sm">{check.label}</span>
              <span className="text-sm font-medium">{check.value}</span>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Per-Category Traffic Lights */}
      <SectionCard title="Category Coverage">
        <div className="grid grid-cols-2 gap-2">
          {ALL_CATEGORIES.map((catId) => {
            const catData = placeStats?.by_seeding_category?.[catId] || { count: 0, with_photos: 0 };
            const cardCount = byCat[CATEGORY_LABELS[catId]] || byCat[catId] || 0;
            const light = cardCount >= 5 ? "success" : cardCount >= 1 ? "warning" : "error";
            const isHidden = catId === "groceries";
            return (
              <div key={catId} className="flex items-center gap-3 py-1.5 px-2 rounded text-sm">
                <div className={`w-3 h-3 rounded-full flex-shrink-0 ${light === "success" ? "bg-[var(--color-success-500)]" : light === "warning" ? "bg-[var(--color-warning-500)]" : "bg-[var(--color-error-500)]"}`} />
                <span className="flex-1 truncate">
                  {CATEGORY_LABELS[catId]}
                  {isHidden && <span className="text-[var(--color-text-tertiary)] ml-1">(hidden)</span>}
                </span>
                <span className="text-[var(--color-text-secondary)] text-xs">{catData.count}p · {cardCount}c</span>
              </div>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
}

// ── Tab 2: Generate Cards ────────────────────────────────────────────────────

function GenerateTab({ city, onRefresh }) {
  const { addToast } = useToast();
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState(null);
  const [selectedCat, setSelectedCat] = useState("");

  const generate = async (type) => {
    if (!city) return;
    setGenerating(true);
    setResult(null);
    try {
      const fnName = type === "curated" ? "generate-curated-experiences" : "generate-single-cards";
      const body = {
        lat: city.center_lat,
        lng: city.center_lng,
        radiusMeters: city.coverage_radius_km * 1000,
        ...(type === "single" && selectedCat ? { categories: [selectedCat] } : {}),
      };
      const { data, error } = await supabase.functions.invoke(fnName, { body });
      if (error) throw new Error(error.message);
      setResult(data);
      addToast({ variant: "success", title: `${type === "curated" ? "Curated" : "Single"} card generation complete` });
      onRefresh();
    } catch (err) {
      addToast({ variant: "error", title: "Generation failed", description: err.message });
    } finally {
      setGenerating(false);
    }
  };

  if (!city) return <div className="text-center py-12 text-[var(--color-text-secondary)]">Select a city.</div>;

  return (
    <div className="space-y-6">
      <SectionCard title="Single Card Generation" subtitle={`Generate cards for ${city.name}`}>
        <div className="flex items-end gap-3">
          <div>
            <label className="text-xs text-[var(--color-text-secondary)]">Category (optional)</label>
            <select className="block mt-1 rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm"
              value={selectedCat} onChange={(e) => setSelectedCat(e.target.value)}>
              <option value="">All Categories</option>
              {ALL_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
            </select>
          </div>
          <Button icon={Play} loading={generating} onClick={() => generate("single")}>
            Generate Single Cards
          </Button>
        </div>
      </SectionCard>

      <SectionCard title="Curated Experience Generation" subtitle="Multi-stop itinerary cards">
        <Button icon={Play} loading={generating} onClick={() => generate("curated")}>
          Generate Curated Experiences
        </Button>
      </SectionCard>

      {result && (
        <SectionCard title="Generation Results">
          <pre className="text-xs whitespace-pre-wrap max-h-48 overflow-y-auto bg-[var(--gray-50)] p-3 rounded">
            {JSON.stringify(result, null, 2)}
          </pre>
        </SectionCard>
      )}
    </div>
  );
}

// ── Tab 3: Browse Cards ──────────────────────────────────────────────────────

function BrowseCardsTab({ city }) {
  const [cards, setCards] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ cardType: "", category: "", status: "active", nameSearch: "" });
  const PAGE_SIZE = 20;

  const fetchCards = useCallback(async () => {
    setLoading(true);
    let q = supabase.from("card_pool").select("*, place_pool!inner(city_id, name)", { count: "exact" });
    if (city) q = q.eq("place_pool.city_id", city.id);
    if (filters.cardType) q = q.eq("card_type", filters.cardType);
    if (filters.category) q = q.contains("categories", [filters.category]);
    if (filters.status === "active") q = q.eq("is_active", true);
    else if (filters.status === "inactive") q = q.eq("is_active", false);
    if (filters.nameSearch) q = q.ilike("title", `%${filters.nameSearch}%`);
    q = q.order("created_at", { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
    const { data, count, error } = await q;
    if (!error) { setCards(data || []); setTotal(count || 0); }
    setLoading(false);
  }, [city, filters, page]);

  useEffect(() => { fetchCards(); }, [fetchCards]);

  const toggleActive = async (card) => {
    await supabase.from("card_pool").update({ is_active: !card.is_active }).eq("id", card.id);
    fetchCards();
  };

  const columns = [
    { key: "title", label: "Title", sortable: true },
    { key: "card_type", label: "Type", render: (_, r) => <Badge variant={r.card_type === "curated" ? "brand" : "default"}>{r.card_type}</Badge> },
    { key: "category", label: "Category", render: (_, r) => r.category || (r.categories?.[0]) || "—" },
    { key: "image_url", label: "Photo", render: (_, r) => r.image_url ? <img src={r.image_url} className="w-10 h-10 rounded object-cover" alt="" /> : <Badge variant="error">None</Badge> },
    { key: "is_active", label: "Status", render: (_, r) => <Badge variant={r.is_active ? "success" : "error"}>{r.is_active ? "Active" : "Inactive"}</Badge> },
    { key: "actions", label: "", render: (_, r) => (
      <Button size="sm" variant={r.is_active ? "danger" : "primary"} onClick={() => toggleActive(r)}>
        {r.is_active ? "Deactivate" : "Reactivate"}
      </Button>
    )},
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <label className="text-xs text-[var(--color-text-secondary)]">Type</label>
          <select className="block mt-1 rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm"
            value={filters.cardType} onChange={(e) => { setFilters((f) => ({ ...f, cardType: e.target.value })); setPage(1); }}>
            <option value="">All</option>
            <option value="single">Single</option>
            <option value="curated">Curated</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-[var(--color-text-secondary)]">Category</label>
          <select className="block mt-1 rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm"
            value={filters.category} onChange={(e) => { setFilters((f) => ({ ...f, category: e.target.value })); setPage(1); }}>
            <option value="">All</option>
            {ALL_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-[var(--color-text-secondary)]">Status</label>
          <select className="block mt-1 rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm"
            value={filters.status} onChange={(e) => { setFilters((f) => ({ ...f, status: e.target.value })); setPage(1); }}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <Input label="Search" value={filters.nameSearch} placeholder="Card title..."
            onChange={(e) => { setFilters((f) => ({ ...f, nameSearch: e.target.value })); setPage(1); }} />
        </div>
      </div>

      <DataTable columns={columns} rows={cards} loading={loading}
        emptyMessage="No cards found" emptyIcon={Layers}
        pagination={{ page, pageSize: PAGE_SIZE, total, onChange: setPage }} />
    </div>
  );
}

// ── Cross-City Comparison (for Gap tab when no city selected) ────────────────

function CrossCityComparison({ cities }) {
  const [cityStats, setCityStats] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stats = {};
      for (const c of cities) {
        const [{ data: ps }, { data: cs }, { data: ops }] = await Promise.all([
          supabase.rpc("admin_city_place_stats", { p_city_id: c.id }),
          supabase.rpc("admin_city_card_stats", { p_city_id: c.id }),
          supabase.from("seeding_operations").select("estimated_cost_usd").eq("city_id", c.id),
        ]);
        if (cancelled) return;
        const spend = (ops || []).reduce((s, r) => s + (r.estimated_cost_usd || 0), 0);
        stats[c.id] = { places: ps?.total_places || 0, cards: (cs?.total_single_cards || 0) + (cs?.total_curated_cards || 0), photoPct: ps?.total_places ? Math.round(((ps?.with_photos || 0) / ps.total_places) * 100) : 0, spend };
      }
      if (!cancelled) { setCityStats(stats); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [cities]);

  const columns = [
    { key: "name", label: "City", render: (_, r) => `${r.name}, ${r.country}` },
    { key: "status", label: "Status", render: (_, r) => <Badge variant={r.status === "launched" ? "success" : r.status === "seeded" ? "info" : "default"}>{r.status}</Badge> },
    { key: "places", label: "Places", render: (_, r) => cityStats[r.id]?.places ?? "—" },
    { key: "cards", label: "Cards", render: (_, r) => cityStats[r.id]?.cards ?? "—" },
    { key: "photos", label: "Photo %", render: (_, r) => {
      const pct = cityStats[r.id]?.photoPct;
      return pct != null ? <Badge variant={pct >= 80 ? "success" : pct >= 50 ? "warning" : "error"}>{pct}%</Badge> : "—";
    }},
    { key: "spend", label: "Spend / $70", render: (_, r) => {
      const spend = cityStats[r.id]?.spend;
      return spend != null ? <span className={spend > 70 ? "text-[var(--color-error-700)] font-medium" : ""}>${spend.toFixed(2)}</span> : "—";
    }},
  ];

  return (
    <SectionCard title="Cross-City Comparison">
      <DataTable columns={columns} rows={cities} loading={loading} emptyMessage="No cities" />
    </SectionCard>
  );
}

// ── Tab 4: Gap Analysis ──────────────────────────────────────────────────────

function GapTab({ city, placeStats, cardStats, allCities, onRefresh }) {
  const { addToast } = useToast();
  const [placesWithoutCards, setPlacesWithoutCards] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!city) return;
    setLoading(true);
    // Find active places with photos but no active card
    supabase.rpc("admin_city_place_stats", { p_city_id: city.id }).then(() => {
      // Simpler approach: query places without cards
      supabase.from("place_pool")
        .select("id, name, seeding_category, rating")
        .eq("city_id", city.id).eq("is_active", true)
        .not("stored_photo_urls", "is", null)
        .limit(100)
        .then(async ({ data: allPlaces }) => {
          if (!allPlaces?.length) { setPlacesWithoutCards([]); setLoading(false); return; }
          // Get place IDs that have cards
          const { data: cardsData } = await supabase.from("card_pool")
            .select("place_pool_id")
            .eq("is_active", true)
            .in("place_pool_id", allPlaces.map((p) => p.id));
          const withCardIds = new Set((cardsData || []).map((c) => c.place_pool_id));
          setPlacesWithoutCards(allPlaces.filter((p) => !withCardIds.has(p.id)));
          setLoading(false);
        });
    });
  }, [city]);

  const byCat = placeStats?.by_seeding_category || {};
  const cardByCat = cardStats?.by_category || {};

  if (!city) {
    // Cross-city comparison
    if (!allCities?.length) return <div className="text-center py-12 text-[var(--color-text-secondary)]">No cities defined.</div>;
    return <CrossCityComparison cities={allCities} />;
  }

  return (
    <div className="space-y-6">
      {/* Places Without Cards */}
      <SectionCard title={`Places Without Cards (${placesWithoutCards.length})`}>
        {loading ? <p className="text-sm text-[var(--color-text-secondary)]">Loading...</p> : (
          <div className="max-h-72 overflow-y-auto space-y-1">
            {placesWithoutCards.slice(0, 50).map((p) => (
              <div key={p.id} className="flex justify-between items-center px-2 py-1.5 text-sm border-b border-[var(--gray-100)]">
                <div>
                  <span className="font-medium">{p.name}</span>
                  <span className="ml-2 text-[var(--color-text-tertiary)]">
                    {CATEGORY_LABELS[p.seeding_category] || "—"} · {p.rating ? `★ ${p.rating}` : "No rating"}
                  </span>
                </div>
              </div>
            ))}
            {placesWithoutCards.length === 0 && <p className="text-sm text-[var(--color-text-secondary)]">All places have cards!</p>}
          </div>
        )}
      </SectionCard>

      {/* Category Gaps */}
      <SectionCard title="Category Gaps">
        <div className="space-y-2">
          {ALL_CATEGORIES.map((catId) => {
            const pCount = byCat[catId]?.count || 0;
            const cCount = cardByCat[CATEGORY_LABELS[catId]] || cardByCat[catId] || 0;
            const gap = pCount - cCount;
            return (
              <div key={catId} className="flex items-center gap-3 text-sm py-1">
                <span className="w-32 truncate">{CATEGORY_LABELS[catId]}</span>
                <span className="w-16 text-right">{pCount}p</span>
                <ChevronRight className="w-4 h-4 text-[var(--color-text-tertiary)]" />
                <span className="w-16 text-right">{cCount}c</span>
                {gap > 0 && <Badge variant="warning">{gap} missing</Badge>}
                {gap <= 0 && pCount > 0 && <Badge variant="success">OK</Badge>}
                {pCount === 0 && <Badge variant="error">No places</Badge>}
              </div>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function CardPoolManagementPage({ onTabChange }) {
  const { addToast } = useToast();
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const [activeTab, setActiveTab] = useState("readiness");
  const [cities, setCities] = useState([]);
  const [selectedCity, setSelectedCity] = useState(null);
  const [placeStats, setPlaceStats] = useState(null);
  const [cardStats, setCardStats] = useState(null);
  const [spendTotal, setSpendTotal] = useState(0);
  const [tileCount, setTileCount] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Load cities
  useEffect(() => {
    supabase.from("seeding_cities").select("*").order("name")
      .then(({ data }) => { if (mountedRef.current) setCities(data || []); });
  }, [refreshKey]);

  // Load stats when city selected
  useEffect(() => {
    if (!selectedCity) { setPlaceStats(null); setCardStats(null); setSpendTotal(0); setTileCount(0); return; }

    supabase.rpc("admin_city_place_stats", { p_city_id: selectedCity.id })
      .then(({ data }) => { if (mountedRef.current) setPlaceStats(data); });

    supabase.rpc("admin_city_card_stats", { p_city_id: selectedCity.id })
      .then(({ data }) => { if (mountedRef.current) setCardStats(data); });

    supabase.from("seeding_operations").select("estimated_cost_usd").eq("city_id", selectedCity.id)
      .then(({ data }) => {
        if (mountedRef.current) setSpendTotal((data || []).reduce((s, r) => s + (r.estimated_cost_usd || 0), 0));
      });

    supabase.from("seeding_tiles").select("id", { count: "exact", head: true }).eq("city_id", selectedCity.id)
      .then(({ count }) => { if (mountedRef.current) setTileCount(count || 0); });
  }, [selectedCity, refreshKey]);

  const launchCity = async (cityId) => {
    const { error } = await supabase.from("seeding_cities").update({ status: "launched", updated_at: new Date().toISOString() }).eq("id", cityId);
    if (error) addToast({ variant: "error", title: "Launch failed", description: error.message });
    else { addToast({ variant: "success", title: `${selectedCity.name} launched!` }); refresh(); }
  };

  return (
    <div className="space-y-4 py-6">
      <CitySelector cities={cities} selectedCity={selectedCity} onSelect={setSelectedCity} />
      <Tabs tabs={SUB_TABS} activeTab={activeTab} onChange={setActiveTab} />

      <div className="mt-4">
        {activeTab === "readiness" && <ReadinessTab city={selectedCity} placeStats={placeStats} cardStats={cardStats} spendTotal={spendTotal} tileCount={tileCount} onLaunch={launchCity} />}
        {activeTab === "generate" && <GenerateTab city={selectedCity} onRefresh={refresh} />}
        {activeTab === "browse" && <BrowseCardsTab city={selectedCity} />}
        {activeTab === "gaps" && <GapTab city={selectedCity} placeStats={placeStats} cardStats={cardStats} allCities={cities} onRefresh={refresh} />}
      </div>
    </div>
  );
}

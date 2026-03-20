import { useState, useEffect, useRef, useCallback } from "react";
import { MapContainer, TileLayer, CircleMarker, Circle, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import {
  Globe, Search, Camera, Clock, Plus, RefreshCw, Play,
  ChevronDown, ChevronRight, AlertTriangle, CheckCircle,
  Download, ImageOff, Eye, Edit3, DollarSign,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { useToast } from "../context/ToastContext";
import { Tabs } from "../components/ui/Tabs";
import { Button } from "../components/ui/Button";
import { SectionCard, StatCard } from "../components/ui/Card";
import { DataTable } from "../components/ui/Table";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { Input, Toggle } from "../components/ui/Input";
import { Badge } from "../components/ui/Badge";

// ── Constants ────────────────────────────────────────────────────────────────

const SUB_TABS = [
  { id: "seed", label: "Seed & Import" },
  { id: "map", label: "Map View" },
  { id: "browse", label: "Browse Pool" },
  { id: "photos", label: "Photo Management" },
  { id: "stale", label: "Stale Review" },
  { id: "stats", label: "Stats & Analytics" },
];

const CATEGORY_COLORS = {
  nature_views: "#22c55e", first_meet: "#f97316", picnic_park: "#84cc16",
  drink: "#a855f7", casual_eats: "#ef4444", fine_dining: "#dc2626",
  watch: "#3b82f6", live_performance: "#8b5cf6", creative_arts: "#ec4899",
  play: "#f59e0b", wellness: "#14b8a6", flowers: "#f472b6", groceries: "#6b7280",
};

const CATEGORY_LABELS = {
  nature_views: "Nature & Views", first_meet: "First Meet", picnic_park: "Picnic Park",
  drink: "Drink", casual_eats: "Casual Eats", fine_dining: "Fine Dining",
  watch: "Watch", live_performance: "Live Performance", creative_arts: "Creative & Arts",
  play: "Play", wellness: "Wellness", flowers: "Flowers", groceries: "Groceries",
};

const ALL_CATEGORIES = Object.keys(CATEGORY_LABELS);

// Client-side mapping from Google types → Mingla seeding category (mirrors seedingCategories.ts)
const TYPE_TO_CATEGORY = {
  spa: "wellness", massage_spa: "wellness", sauna: "wellness", wellness_center: "wellness", yoga_studio: "wellness",
  fine_dining_restaurant: "fine_dining", french_restaurant: "fine_dining", italian_restaurant: "fine_dining", steak_house: "fine_dining", seafood_restaurant: "fine_dining",
  movie_theater: "watch",
  performing_arts_theater: "live_performance", concert_hall: "live_performance", opera_house: "live_performance", philharmonic_hall: "live_performance", amphitheatre: "live_performance", comedy_club: "live_performance", event_venue: "live_performance", arena: "live_performance", live_music_venue: "live_performance",
  art_gallery: "creative_arts", art_museum: "creative_arts", art_studio: "creative_arts", museum: "creative_arts", history_museum: "creative_arts", cultural_center: "creative_arts", cultural_landmark: "creative_arts", sculpture: "creative_arts", library: "creative_arts",
  amusement_center: "play", bowling_alley: "play", miniature_golf_course: "play", go_karting_venue: "play", paintball_center: "play", video_arcade: "play", karaoke: "play", amusement_park: "play", ice_skating_rink: "play", indoor_playground: "play",
  florist: "flowers",
  grocery_store: "groceries", supermarket: "groceries",
  bar: "drink", cocktail_bar: "drink", lounge_bar: "drink", wine_bar: "drink", pub: "drink", brewery: "drink", beer_garden: "drink", brewpub: "drink", night_club: "drink",
  book_store: "first_meet", cafe: "first_meet", coffee_shop: "first_meet", tea_house: "first_meet", bakery: "first_meet", dessert_shop: "first_meet", juice_shop: "first_meet", bistro: "first_meet", ice_cream_shop: "first_meet",
  picnic_ground: "picnic_park",
  beach: "nature_views", botanical_garden: "nature_views", garden: "nature_views", hiking_area: "nature_views", national_park: "nature_views", nature_preserve: "nature_views", park: "nature_views", scenic_spot: "nature_views", state_park: "nature_views", observation_deck: "nature_views", tourist_attraction: "nature_views", garden_center: "nature_views", farm: "nature_views",
  restaurant: "casual_eats", brunch_restaurant: "casual_eats", breakfast_restaurant: "casual_eats", diner: "casual_eats", sandwich_shop: "casual_eats", pizza_restaurant: "casual_eats", hamburger_restaurant: "casual_eats", mexican_restaurant: "casual_eats", mediterranean_restaurant: "casual_eats", thai_restaurant: "casual_eats", vegetarian_restaurant: "casual_eats",
};

function guessCategory(place) {
  // Try primaryType first (most specific)
  if (place.primaryType && TYPE_TO_CATEGORY[place.primaryType]) return TYPE_TO_CATEGORY[place.primaryType];
  // Then try types array
  for (const t of (place.types || [])) {
    if (TYPE_TO_CATEGORY[t]) return TYPE_TO_CATEGORY[t];
  }
  return "";
}

const PRICE_TIERS = ["chill", "comfy", "bougie", "lavish"];

const HARD_CAP_USD = 70;

// ── Helpers ──────────────────────────────────────────────────────────────────

function RecenterMap({ center, zoom }) {
  const map = useMap();
  useEffect(() => { if (center) map.setView(center, zoom); }, [center, zoom, map]);
  return null;
}

function formatCost(n) { return `$${(n || 0).toFixed(2)}`; }

function pctColor(pct) {
  if (pct >= 80) return "success";
  if (pct >= 50) return "warning";
  return "error";
}

// ── City Selector ────────────────────────────────────────────────────────────

function CitySelector({ cities, selectedCity, onSelect, onAddCity }) {
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
      <Button icon={Plus} size="sm" onClick={onAddCity}>Add City</Button>
    </div>
  );
}

// ── City Summary Bar ─────────────────────────────────────────────────────────

function CitySummaryBar({ stats, spendTotal }) {
  if (!stats) return null;
  const total = stats.total_places || 0;
  const withPhotos = stats.with_photos || 0;
  const photoPct = total > 0 ? Math.round((withPhotos / total) * 100) : 0;
  const stale = stats.stale_count || 0;
  const freshPct = total > 0 ? Math.round(((total - stale) / total) * 100) : 0;

  return (
    <div className="grid grid-cols-4 gap-4 mb-6">
      <StatCard icon={Globe} label="Total Places" value={total} />
      <StatCard icon={Camera} label="Photo Coverage" value={`${photoPct}%`}
        trend={pctColor(photoPct) === "success" ? "Good" : pctColor(photoPct) === "warning" ? "Fair" : "Low"}
        trendUp={photoPct >= 80} />
      <StatCard icon={Clock} label="Freshness" value={`${freshPct}%`}
        trend={freshPct >= 80 ? "Fresh" : freshPct >= 50 ? "Aging" : "Stale"}
        trendUp={freshPct >= 80} />
      <StatCard icon={DollarSign} label="Seeding Spend" value={formatCost(spendTotal)}
        trend={`of ${formatCost(HARD_CAP_USD)} cap`}
        trendUp={spendTotal <= HARD_CAP_USD * 0.8} />
    </div>
  );
}

// ── Add City Modal ───────────────────────────────────────────────────────────

function AddCityModal({ open, onClose, onSave }) {
  const [form, setForm] = useState({ name: "", country: "", countryCode: "", googlePlaceId: "", lat: "", lng: "", radius: "10", tileRadius: "1500" });
  const [saving, setSaving] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [selected, setSelected] = useState(false);
  const debounceRef = useRef(null);

  // Google Places Autocomplete via edge function
  const searchCity = useCallback(async (query) => {
    if (query.length < 3) { setSuggestions([]); return; }
    try {
      const { data } = await supabase.functions.invoke("admin-place-search", {
        body: { action: "search", textQuery: query, maxResults: 5 },
      });
      setSuggestions(data?.places || []);
    } catch { setSuggestions([]); }
  }, []);

  const handleNameChange = (val) => {
    setForm((f) => ({ ...f, name: val }));
    if (selected) setSelected(false);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchCity(val), 400);
  };

  const selectSuggestion = (place) => {
    setForm((f) => ({
      ...f,
      name: place.name,
      country: place.country || (place.address || "").split(",").pop()?.trim() || "",
      countryCode: place.countryCode || "",
      googlePlaceId: place.googlePlaceId,
      lat: String(place.lat),
      lng: String(place.lng),
    }));
    setSuggestions([]);
    setSelected(true);
  };

  const latNum = parseFloat(form.lat);
  const lngNum = parseFloat(form.lng);
  const radiusNum = parseFloat(form.radius);
  const tileRadiusNum = parseInt(form.tileRadius);
  const isValid =
    form.name.trim() &&
    form.country.trim() &&
    !isNaN(latNum) && latNum >= -90 && latNum <= 90 &&
    !isNaN(lngNum) && lngNum >= -180 && lngNum <= 180 &&
    !isNaN(radiusNum) && radiusNum > 0 &&
    !isNaN(tileRadiusNum) && tileRadiusNum > 0;

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: city, error } = await supabase.from("seeding_cities").insert({
        google_place_id: form.googlePlaceId || `manual_${Date.now()}`,
        name: form.name,
        country: form.country,
        country_code: form.countryCode || null,
        center_lat: latNum,
        center_lng: lngNum,
        coverage_radius_km: radiusNum,
        tile_radius_m: tileRadiusNum,
      }).select().single();
      if (error) throw error;

      // Auto-generate tiles
      await supabase.functions.invoke("admin-seed-places", {
        body: { action: "generate_tiles", cityId: city.id },
      });

      onSave(city);
      onClose();
      setForm({ name: "", country: "", countryCode: "", googlePlaceId: "", lat: "", lng: "", radius: "10", tileRadius: "1500" });
      setSelected(false);
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add City" size="md">
      <ModalBody>
        <div className="space-y-3 relative">
          <Input label="City Name" value={form.name} onChange={(e) => handleNameChange(e.target.value)} />
          {suggestions.length > 0 && (
            <div className="absolute z-10 top-16 left-0 right-0 bg-[var(--color-background-primary)] border border-[var(--gray-200)] rounded-lg shadow-lg max-h-48 overflow-y-auto">
              {suggestions.map((s, i) => (
                <button key={i} className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--gray-100)] cursor-pointer"
                  onClick={() => selectSuggestion(s)}>
                  {s.name} — {s.address}
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Input label="Country" value={form.country} onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))} disabled={selected} />
            <Input label="Country Code" value={form.countryCode} onChange={(e) => setForm((f) => ({ ...f, countryCode: e.target.value }))} disabled={selected && !!form.countryCode} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Center Lat" type="number" value={form.lat} onChange={(e) => setForm((f) => ({ ...f, lat: e.target.value }))} disabled={selected} />
            <Input label="Center Lng" type="number" value={form.lng} onChange={(e) => setForm((f) => ({ ...f, lng: e.target.value }))} disabled={selected} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Coverage Radius (km)" type="number" value={form.radius} onChange={(e) => setForm((f) => ({ ...f, radius: e.target.value }))} />
            <Input label="Tile Radius (m)" type="number" value={form.tileRadius} onChange={(e) => setForm((f) => ({ ...f, tileRadius: e.target.value }))} />
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={saving} onClick={handleSave} disabled={!isValid}>Save & Generate Tiles</Button>
      </ModalFooter>
    </Modal>
  );
}

// ── Tab 1: Seed & Import ─────────────────────────────────────────────────────

function SeedTab({ city, tiles, onRefresh }) {
  const { addToast } = useToast();
  const [selectedCats, setSelectedCats] = useState(new Set(ALL_CATEGORIES));
  const [preview, setPreview] = useState(null);
  const [seeding, setSeeding] = useState(false);
  const [progress, setProgress] = useState(null);
  const [adHocOpen, setAdHocOpen] = useState(false);
  const [adHocQuery, setAdHocQuery] = useState("");
  const [adHocResults, setAdHocResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const toggleCat = (id) => {
    setSelectedCats((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Preview cost
  useEffect(() => {
    if (!city) return;
    const cats = Array.from(selectedCats);
    if (cats.length === 0) { setPreview(null); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.functions.invoke("admin-seed-places", {
        body: { action: "preview_cost", cityId: city.id, categories: cats },
      });
      if (!cancelled && data) setPreview(data);
    })();
    return () => { cancelled = true; };
  }, [city, selectedCats]);

  const startSeeding = async () => {
    if (!city) return;
    setSeeding(true);
    setProgress(null);
    try {
      const { data, error } = await supabase.functions.invoke("admin-seed-places", {
        body: {
          action: "seed",
          cityId: city.id,
          categories: Array.from(selectedCats),
          acknowledgeHardCap: preview?.exceedsHardCap || false,
        },
      });
      if (error) throw new Error(error.message || "Seeding failed");
      setProgress(data);
      addToast({ variant: "success", title: "Seeding complete", description: `${data?.summary?.totalNewInserted || 0} new places inserted` });
      onRefresh();
    } catch (err) {
      addToast({ variant: "error", title: "Seeding failed", description: err.message });
    } finally {
      setSeeding(false);
    }
  };

  const [adHocCategories, setAdHocCategories] = useState({});

  const handleAdHocSearch = async () => {
    if (!adHocQuery.trim()) return;
    setSearching(true);
    try {
      const { data } = await supabase.functions.invoke("admin-place-search", {
        body: {
          action: "search",
          textQuery: adHocQuery,
          ...(city && { lat: city.center_lat, lng: city.center_lng, radius: city.coverage_radius_km * 1000 }),
        },
      });
      const places = data?.places || [];
      setAdHocResults(places);
      // Auto-map categories for each result
      const cats = {};
      places.forEach((p, i) => { cats[i] = guessCategory(p); });
      setAdHocCategories(cats);
    } catch { setAdHocResults([]); setAdHocCategories({}); }
    finally { setSearching(false); }
  };

  const pushToPool = async (places, category) => {
    const { error } = await supabase.functions.invoke("admin-place-search", {
      body: { action: "push", places, seedingCategory: category || null },
    });
    if (error) addToast({ variant: "error", title: "Push failed" });
    else { addToast({ variant: "success", title: `Pushed ${places.length} place(s)` }); onRefresh(); }
  };

  if (!city) return <div className="text-center py-12 text-[var(--color-text-secondary)]">Select a city to begin seeding.</div>;

  return (
    <div className="space-y-6">
      {/* Tile Summary */}
      <SectionCard title="Tile Grid" subtitle={`${tiles.length} tiles · ${city.tile_radius_m}m radius`}
        action={<Button size="sm" icon={RefreshCw} variant="secondary" onClick={async () => {
          await supabase.functions.invoke("admin-seed-places", { body: { action: "generate_tiles", cityId: city.id } });
          onRefresh();
        }}>Regenerate</Button>}>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Coverage: {city.coverage_radius_km}km radius · Spacing: {Math.round(city.tile_radius_m * 1.4)}m
        </p>
      </SectionCard>

      {/* Category Pills */}
      <SectionCard title="Categories">
        <div className="flex flex-wrap gap-2">
          {ALL_CATEGORIES.map((id) => (
            <button key={id} onClick={() => toggleCat(id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
                selectedCats.has(id)
                  ? "text-white border-transparent"
                  : "bg-transparent border-[var(--gray-300)] text-[var(--color-text-secondary)]"
              }`}
              style={selectedCats.has(id) ? { backgroundColor: CATEGORY_COLORS[id] } : {}}>
              {CATEGORY_LABELS[id]}
            </button>
          ))}
        </div>
      </SectionCard>

      {/* Cost Preview */}
      {preview && (
        <SectionCard title="Cost Preview">
          <div className={`rounded-lg p-4 ${preview.exceedsHardCap ? "bg-[var(--color-error-50)] border border-[#ef4444]" : "bg-[var(--color-success-50)]"}`}>
            <div className="grid grid-cols-4 gap-4 text-sm">
              <div><span className="text-[var(--color-text-secondary)]">Tiles:</span> {preview.tileCount}</div>
              <div><span className="text-[var(--color-text-secondary)]">Categories:</span> {preview.categoryCount}</div>
              <div><span className="text-[var(--color-text-secondary)]">API Calls:</span> {preview.totalApiCalls}</div>
              <div className="font-semibold">Total: {formatCost(preview.estimatedTotalCost)}</div>
            </div>
            {preview.exceedsHardCap && (
              <p className="mt-2 text-sm font-medium text-[#ef4444]">
                <AlertTriangle className="inline w-4 h-4 mr-1" />
                Exceeds ${HARD_CAP_USD} per-city cap. Reduce tiles, radius, or categories.
              </p>
            )}
          </div>
          <div className="mt-4">
            <Button variant="primary" icon={Play} loading={seeding} onClick={startSeeding}
              disabled={selectedCats.size === 0}>
              {preview.exceedsHardCap ? "Acknowledge & Start Seeding" : "Start Seeding"}
            </Button>
          </div>
        </SectionCard>
      )}

      {/* Progress */}
      {progress && (
        <SectionCard title="Seeding Results">
          <div className="grid grid-cols-3 gap-4 text-sm mb-4">
            <div>API Calls: <strong>{progress.summary.totalApiCalls}</strong></div>
            <div>New Inserted: <strong className="text-[var(--color-success-700)]">{progress.summary.totalNewInserted}</strong></div>
            <div>Duplicates Skipped: <strong>{progress.summary.totalDuplicateSkipped}</strong></div>
            <div>Rejected (no photos): <strong className="text-[var(--color-warning-500)]">{progress.summary.totalRejected?.noPhotos || 0}</strong></div>
            <div>Rejected (closed): <strong>{progress.summary.totalRejected?.closed || 0}</strong></div>
            <div>Rejected (excluded type): <strong>{progress.summary.totalRejected?.excludedType || 0}</strong></div>
          </div>
          <div className="text-sm font-medium">Cost: {formatCost(progress.summary.estimatedCostUsd)}</div>
          {/* Per-category details */}
          {Object.entries(progress.perCategory || {}).map(([catId, cat]) => (
            <details key={catId} className="mt-2 text-sm">
              <summary className="cursor-pointer font-medium" style={{ color: CATEGORY_COLORS[catId] }}>
                {CATEGORY_LABELS[catId] || catId}: {cat.newInserted} new, {cat.duplicateSkipped} dupes
                {cat.errors?.length > 0 && <Badge variant="error" className="ml-2">{cat.errors.length} errors</Badge>}
              </summary>
              {cat.errors?.length > 0 && (
                <div className="ml-4 mt-1 space-y-1">
                  {cat.errors.map((e, i) => (
                    <div key={i} className="text-xs text-[var(--color-error-700)]">
                      Tile #{e.tileIndex} — {e.errorType}: {e.message}
                    </div>
                  ))}
                </div>
              )}
            </details>
          ))}
        </SectionCard>
      )}

      {/* Ad-Hoc Search */}
      <SectionCard title="Ad-Hoc Search" subtitle="Free-text search for individual places"
        action={<Button size="sm" variant="ghost" onClick={() => setAdHocOpen(!adHocOpen)} icon={adHocOpen ? ChevronDown : ChevronRight}>
          {adHocOpen ? "Collapse" : "Expand"}
        </Button>}>
        {adHocOpen && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input value={adHocQuery} onChange={(e) => setAdHocQuery(e.target.value)}
                label="" placeholder="e.g. rooftop bars in Lagos" />
              <Button icon={Search} loading={searching} onClick={handleAdHocSearch}>Search</Button>
            </div>
            {adHocResults.length > 0 && (
              <div className="space-y-2">
                {adHocResults.map((p, i) => (
                  <div key={i} className="flex items-center gap-2 p-2 border rounded-lg text-sm">
                    <div className="flex-1 min-w-0">
                      <strong>{p.name}</strong>
                      <span className="ml-2 text-[var(--color-text-secondary)]">{p.address?.substring(0, 60)}</span>
                    </div>
                    <select
                      className="rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1 text-xs min-w-[130px]"
                      value={adHocCategories[i] || ""}
                      onChange={(e) => setAdHocCategories((prev) => ({ ...prev, [i]: e.target.value }))}
                    >
                      <option value="">No Category</option>
                      {ALL_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                    </select>
                    <Button size="sm" onClick={() => pushToPool([{ ...p, seedingCategory: adHocCategories[i] || null }], adHocCategories[i])}>Push</Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ── Tab 2: Map View ──────────────────────────────────────────────────────────

function getTileStatus(tile, ops, placesNearTile) {
  // Check if any ops had errors for this tile
  const hasErrors = ops.some((o) =>
    o.error_details?.tile_errors?.some((e) => e.tile_id === tile.id)
  );
  if (hasErrors) return "error";

  // Count unique categories seeded for this tile
  const seededCats = new Set(
    ops.filter((o) => o.tile_id === tile.id && o.status === "completed").map((o) => o.seeding_category)
  );
  // Also count from places within tile radius (more reliable)
  const catsFromPlaces = new Set(placesNearTile.map((p) => p.seeding_category).filter(Boolean));
  const totalCats = new Set([...seededCats, ...catsFromPlaces]);

  if (totalCats.size >= 13) return "full";
  if (totalCats.size > 0) return "partial";
  return "unseeded";
}

const TILE_STATUS_STYLES = {
  unseeded: { color: "#9ca3af", fillOpacity: 0.08, weight: 1 },
  partial: { color: "#60a5fa", fillOpacity: 0.10, weight: 1.5 },
  full: { color: "#22c55e", fillOpacity: 0.12, weight: 1.5 },
  error: { color: "#ef4444", fillOpacity: 0.08, weight: 2, dashArray: "4 2" },
};

function MapTab({ city, tiles, places, seedingOps }) {
  const [visibleCats, setVisibleCats] = useState(new Set(ALL_CATEGORIES));

  if (!city) return <div className="text-center py-12 text-[var(--color-text-secondary)]">Select a city to view the map.</div>;

  const center = [city.center_lat, city.center_lng];
  const filteredPlaces = places.filter((p) => visibleCats.has(p.seeding_category));

  // Pre-compute places near each tile (within tile radius) for status + gap detection
  const tileData = tiles.map((t) => {
    const nearbyPlaces = places.filter((p) => {
      const dLat = (p.lat - t.center_lat) * 111320;
      const dLng = (p.lng - t.center_lng) * 111320 * Math.cos((t.center_lat * Math.PI) / 180);
      return Math.sqrt(dLat * dLat + dLng * dLng) <= t.radius_m;
    });
    const status = getTileStatus(t, seedingOps || [], nearbyPlaces);
    // Coverage gap: <5 places in any visible category
    const hasGap = nearbyPlaces.length > 0 && nearbyPlaces.length < 5;
    return { ...t, status, nearbyCount: nearbyPlaces.length, hasGap };
  });

  return (
    <div className="space-y-4">
      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-[var(--color-text-secondary)]">
        <span><span className="inline-block w-3 h-3 rounded-full bg-[#9ca3af] mr-1" />Unseeded</span>
        <span><span className="inline-block w-3 h-3 rounded-full bg-[#60a5fa] mr-1" />Partial</span>
        <span><span className="inline-block w-3 h-3 rounded-full bg-[#22c55e] mr-1" />Fully Seeded</span>
        <span><span className="inline-block w-3 h-3 rounded-full border-2 border-[#ef4444] mr-1" />Errors</span>
        <span><span className="inline-block w-3 h-3 rounded-full border-2 border-[#f59e0b] mr-1" />Coverage Gap (&lt;5 places)</span>
      </div>

      {/* Category filter pills */}
      <div className="flex flex-wrap gap-1.5">
        {ALL_CATEGORIES.map((id) => (
          <button key={id} onClick={() => setVisibleCats((prev) => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
          })} className={`px-2 py-1 rounded-full text-xs font-medium border cursor-pointer transition-colors ${
            visibleCats.has(id) ? "text-white border-transparent" : "bg-transparent border-[var(--gray-300)] text-[var(--color-text-secondary)]"
          }`} style={visibleCats.has(id) ? { backgroundColor: CATEGORY_COLORS[id] } : {}}>
            {CATEGORY_LABELS[id]}
          </button>
        ))}
      </div>

      <div className="rounded-lg overflow-hidden border border-[var(--gray-200)]" style={{ height: 600 }}>
        <MapContainer center={center} zoom={12} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
          <RecenterMap center={center} zoom={12} />
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; OpenStreetMap contributors' />

          {/* City boundary */}
          <Circle center={center} radius={city.coverage_radius_km * 1000}
            pathOptions={{ color: "#6b7280", dashArray: "8 4", fillOpacity: 0.03, weight: 2 }} />

          {/* Tile circles with status coloring */}
          {tileData.map((t) => (
            <Circle key={t.id} center={[t.center_lat, t.center_lng]} radius={t.radius_m}
              pathOptions={TILE_STATUS_STYLES[t.status] || TILE_STATUS_STYLES.unseeded}>
              <Popup><div className="text-xs">Tile #{t.tile_index} · {t.nearbyCount} places · {t.status}</div></Popup>
            </Circle>
          ))}

          {/* Coverage gap warning circles (orange dashed outline) */}
          {tileData.filter((t) => t.hasGap && t.status !== "unseeded").map((t) => (
            <Circle key={`gap-${t.id}`} center={[t.center_lat, t.center_lng]} radius={t.radius_m}
              pathOptions={{ color: "#f59e0b", fillOpacity: 0, weight: 2, dashArray: "6 3" }} />
          ))}

          {/* Place pins */}
          {filteredPlaces.map((p) => (
            <CircleMarker key={p.id} center={[p.lat, p.lng]} radius={5}
              pathOptions={{ color: CATEGORY_COLORS[p.seeding_category] || "#6b7280", fillColor: CATEGORY_COLORS[p.seeding_category] || "#6b7280", fillOpacity: 0.8, weight: 1 }}>
              <Popup>
                <div className="text-xs">
                  <strong>{p.name}</strong><br />
                  {CATEGORY_LABELS[p.seeding_category] || p.seeding_category}<br />
                  {p.rating ? `★ ${p.rating}` : "No rating"} · {(p.stored_photo_urls?.length || 0)} photos<br />
                  <Badge variant={p.is_active ? "success" : "error"}>{p.is_active ? "Active" : "Inactive"}</Badge>
                </div>
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}

// ── Tab 3: Browse Pool ───────────────────────────────────────────────────────

function BrowseTab({ city, onRefresh }) {
  const { addToast } = useToast();
  const [places, setPlaces] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ category: "", status: "active", photoStatus: "", priceTier: "", minRating: "", nameSearch: "" });
  const [editPlace, setEditPlace] = useState(null);
  const [editForm, setEditForm] = useState({ name: "", price_tier: "", is_active: true });
  const [saving, setSaving] = useState(false);
  const PAGE_SIZE = 20;

  const fetchPlaces = useCallback(async () => {
    setLoading(true);
    let q = supabase.from("place_pool").select("*", { count: "exact" });
    if (city) q = q.eq("city_id", city.id);
    if (filters.category) q = q.eq("seeding_category", filters.category);
    if (filters.status === "active") q = q.eq("is_active", true);
    else if (filters.status === "inactive") q = q.eq("is_active", false);
    if (filters.photoStatus === "has") q = q.not("stored_photo_urls", "is", null);
    else if (filters.photoStatus === "missing") q = q.or("stored_photo_urls.is.null,stored_photo_urls.eq.{}");
    if (filters.priceTier) q = q.eq("price_tier", filters.priceTier);
    if (filters.minRating) q = q.gte("rating", parseFloat(filters.minRating));
    if (filters.nameSearch) q = q.ilike("name", `%${filters.nameSearch}%`);
    q = q.order("created_at", { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
    const { data, count, error } = await q;
    if (!error) { setPlaces(data || []); setTotal(count || 0); }
    setLoading(false);
  }, [city, filters, page]);

  useEffect(() => { fetchPlaces(); }, [fetchPlaces]);

  const openEdit = (place) => {
    setEditPlace(place);
    setEditForm({ name: place.name, price_tier: place.price_tier || "", is_active: place.is_active });
  };

  const saveEdit = async () => {
    setSaving(true);
    const { error } = await supabase.rpc("admin_edit_place", {
      p_place_id: editPlace.id,
      p_name: editForm.name || null,
      p_price_tier: editForm.price_tier || null,
      p_is_active: editForm.is_active,
    });
    if (error) addToast({ variant: "error", title: "Save failed", description: error.message });
    else { addToast({ variant: "success", title: "Place updated" }); setEditPlace(null); fetchPlaces(); onRefresh(); }
    setSaving(false);
  };

  const columns = [
    { key: "name", label: "Name", sortable: true, render: (_, r) => <button className="text-[var(--color-brand-500)] hover:underline cursor-pointer text-left" onClick={() => openEdit(r)}>{r.name}</button> },
    { key: "seeding_category", label: "Category", render: (_, r) => r.seeding_category ? <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full text-white" style={{ backgroundColor: CATEGORY_COLORS[r.seeding_category] }}>{CATEGORY_LABELS[r.seeding_category]}</span> : "—" },
    { key: "rating", label: "Rating", sortable: true, render: (_, r) => r.rating ? `★ ${r.rating}` : "—" },
    { key: "price_tier", label: "Price", render: (_, r) => r.price_tier ? <Badge variant="outline">{r.price_tier}</Badge> : "—" },
    { key: "photos", label: "Photos", render: (_, r) => {
      const n = r.stored_photo_urls?.length || 0;
      return <Badge variant={n > 0 ? "success" : "error"}>{n}</Badge>;
    }},
    { key: "is_active", label: "Status", render: (_, r) => <Badge variant={r.is_active ? "success" : "error"}>{r.is_active ? "Active" : "Inactive"}</Badge> },
    { key: "actions", label: "", render: (_, r) => <Button size="sm" variant="ghost" icon={Edit3} onClick={() => openEdit(r)} /> },
  ];

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-end">
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
        <div>
          <label className="text-xs text-[var(--color-text-secondary)]">Photos</label>
          <select className="block mt-1 rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm"
            value={filters.photoStatus} onChange={(e) => { setFilters((f) => ({ ...f, photoStatus: e.target.value })); setPage(1); }}>
            <option value="">All</option>
            <option value="has">Has Photos</option>
            <option value="missing">Missing Photos</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-[var(--color-text-secondary)]">Price Tier</label>
          <select className="block mt-1 rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm"
            value={filters.priceTier} onChange={(e) => { setFilters((f) => ({ ...f, priceTier: e.target.value })); setPage(1); }}>
            <option value="">All</option>
            {PRICE_TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-[var(--color-text-secondary)]">Min Rating</label>
          <input type="number" min="0" max="5" step="0.5" placeholder="e.g. 4.0"
            className="block mt-1 w-20 rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm"
            value={filters.minRating} onChange={(e) => { setFilters((f) => ({ ...f, minRating: e.target.value })); setPage(1); }} />
        </div>
        <div className="flex-1 min-w-[200px]">
          <Input label="Search" value={filters.nameSearch} placeholder="Place name..."
            onChange={(e) => { setFilters((f) => ({ ...f, nameSearch: e.target.value })); setPage(1); }} />
        </div>
      </div>

      <DataTable columns={columns} rows={places} loading={loading}
        emptyMessage="No places found" emptyIcon={Globe}
        pagination={{ page, pageSize: PAGE_SIZE, total, onChange: setPage }} />

      {/* Edit Modal */}
      <Modal open={!!editPlace} onClose={() => setEditPlace(null)} title={`Edit: ${editPlace?.name || ""}`} size="sm">
        <ModalBody>
          <div className="space-y-3">
            <Input label="Name" value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
            <div>
              <label className="text-xs text-[var(--color-text-secondary)]">Price Tier</label>
              <select className="block mt-1 w-full rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm"
                value={editForm.price_tier} onChange={(e) => setEditForm((f) => ({ ...f, price_tier: e.target.value }))}>
                <option value="">None</option>
                {PRICE_TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <Toggle label="Active" checked={editForm.is_active} onChange={(val) => setEditForm((f) => ({ ...f, is_active: val }))} />
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setEditPlace(null)}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={saveEdit}>Save</Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

// ── Tab 4: Photo Management ──────────────────────────────────────────────────

function PhotoTab({ city, stats, tiles }) {
  const { addToast } = useToast();
  const [allMissing, setAllMissing] = useState([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [filterCat, setFilterCat] = useState("");
  const [filterTile, setFilterTile] = useState("");
  const [filterMinRating, setFilterMinRating] = useState("");
  const [sortBy, setSortBy] = useState("rating"); // "rating" or "impressions"
  const [batchLimit, setBatchLimit] = useState("");

  useEffect(() => {
    if (!city) return;
    setLoading(true);
    supabase.from("place_pool")
      .select("id, name, rating, seeding_category, photos, lat, lng, impression_count")
      .eq("city_id", city.id).eq("is_active", true)
      .or("stored_photo_urls.is.null,stored_photo_urls.eq.{}")
      .not("photos", "is", null)
      .order("rating", { ascending: false, nullsFirst: false })
      .limit(500)
      .then(({ data }) => { setAllMissing(data || []); setLoading(false); });
  }, [city]);

  // Apply client-side filters
  const filtered = allMissing.filter((p) => {
    if (filterCat && p.seeding_category !== filterCat) return false;
    if (filterMinRating && (p.rating || 0) < parseFloat(filterMinRating)) return false;
    if (filterTile && tiles.length > 0) {
      const tile = tiles.find((t) => t.id === filterTile);
      if (tile) {
        const dLat = (p.lat - tile.center_lat) * 111320;
        const dLng = (p.lng - tile.center_lng) * 111320 * Math.cos((tile.center_lat * Math.PI) / 180);
        if (Math.sqrt(dLat * dLat + dLng * dLng) > tile.radius_m) return false;
      }
    }
    return true;
  }).sort((a, b) => {
    if (sortBy === "impressions") return (b.impression_count || 0) - (a.impression_count || 0);
    return (b.rating || 0) - (a.rating || 0);
  });

  const batchPlaces = batchLimit ? filtered.slice(0, parseInt(batchLimit) || filtered.length) : filtered;
  const batchCost = batchPlaces.length * 5 * 0.007;

  const triggerDownload = async (placeIds) => {
    setDownloading(true);
    try {
      const { error } = await supabase.from("admin_backfill_log").insert({
        operation_type: "photo_backfill",
        triggered_by: (await supabase.auth.getUser()).data.user.id,
        place_ids: placeIds,
        total_places: placeIds.length,
        estimated_cost_usd: placeIds.length * 5 * 0.007,
      });
      if (error) throw error;
      await supabase.functions.invoke("admin-refresh-places", { body: { action: "process" } });
      addToast({ variant: "success", title: `Triggered download for ${placeIds.length} place(s)` });
    } catch (err) {
      addToast({ variant: "error", title: "Download failed", description: err.message });
    }
    setDownloading(false);
  };

  const total = stats?.total_places || 0;
  const withPhotos = stats?.with_photos || 0;
  const photoPct = total > 0 ? Math.round((withPhotos / total) * 100) : 0;

  if (!city) return <div className="text-center py-12 text-[var(--color-text-secondary)]">Select a city.</div>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <StatCard icon={Camera} label="With Photos" value={withPhotos} />
        <StatCard icon={ImageOff} label="Without Photos" value={total - withPhotos} />
        <StatCard icon={Eye} label="Coverage" value={`${photoPct}%`} trend={pctColor(photoPct) === "success" ? "Good" : "Low"} trendUp={photoPct >= 80} />
      </div>

      <SectionCard title={`Missing Photos (${filtered.length} of ${allMissing.length})`}>
        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-end mb-4">
          <div>
            <label className="text-xs text-[var(--color-text-secondary)]">Tile</label>
            <select className="block mt-1 rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm"
              value={filterTile} onChange={(e) => setFilterTile(e.target.value)}>
              <option value="">All Tiles</option>
              {tiles.map((t) => <option key={t.id} value={t.id}>Tile #{t.tile_index}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-[var(--color-text-secondary)]">Category</label>
            <select className="block mt-1 rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm"
              value={filterCat} onChange={(e) => setFilterCat(e.target.value)}>
              <option value="">All</option>
              {ALL_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-[var(--color-text-secondary)]">Min Rating</label>
            <input type="number" min="0" max="5" step="0.5" placeholder="e.g. 4.0"
              className="block mt-1 w-20 rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm"
              value={filterMinRating} onChange={(e) => setFilterMinRating(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-[var(--color-text-secondary)]">Sort By</label>
            <select className="block mt-1 rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm"
              value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="rating">Rating (highest first)</option>
              <option value="impressions">Impressions (most seen first)</option>
            </select>
          </div>
        </div>

        {/* Batch controls */}
        <div className="flex items-end gap-3 mb-4 p-3 bg-[var(--gray-50)] rounded-lg">
          <div>
            <label className="text-xs text-[var(--color-text-secondary)]">Batch Limit (top N)</label>
            <input type="number" min="1" placeholder="All"
              className="block mt-1 w-24 rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm"
              value={batchLimit} onChange={(e) => setBatchLimit(e.target.value)} />
          </div>
          <div className="text-sm text-[var(--color-text-secondary)]">
            {batchPlaces.length} places × 5 photos × $0.007 = <strong>{formatCost(batchCost)}</strong>
          </div>
          <Button size="sm" icon={Download} loading={downloading}
            onClick={() => triggerDownload(batchPlaces.map((p) => p.id))}
            disabled={batchPlaces.length === 0}>
            Batch Download ({batchPlaces.length})
          </Button>
        </div>

        {/* List */}
        {loading ? <div className="text-sm text-[var(--color-text-secondary)]">Loading...</div> : (
          <div className="max-h-96 overflow-y-auto space-y-1">
            {filtered.map((p) => (
              <div key={p.id} className="flex justify-between items-center px-2 py-1.5 text-sm border-b border-[var(--gray-100)]">
                <div>
                  <span className="font-medium">{p.name}</span>
                  <span className="ml-2 text-[var(--color-text-tertiary)]">{p.rating ? `★ ${p.rating}` : "No rating"}</span>
                  {p.seeding_category && <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-white" style={{ backgroundColor: CATEGORY_COLORS[p.seeding_category], fontSize: 10 }}>{CATEGORY_LABELS[p.seeding_category]}</span>}
                </div>
                <Button size="sm" variant="ghost" icon={Download} loading={downloading}
                  onClick={() => triggerDownload([p.id])}>Download</Button>
              </div>
            ))}
            {filtered.length === 0 && <p className="text-sm text-[var(--color-text-secondary)]">All places have photos (or no matches)!</p>}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ── Tab 5: Stale Review ──────────────────────────────────────────────────────

function StaleTab({ city }) {
  const { addToast } = useToast();
  const [stale, setStale] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    let q = supabase.from("place_pool").select("id, name, rating, seeding_category, last_detail_refresh, refresh_failures")
      .eq("is_active", true)
      .lt("last_detail_refresh", new Date(Date.now() - 7 * 86400000).toISOString())
      .order("last_detail_refresh", { ascending: true })
      .limit(100);
    if (city) q = q.eq("city_id", city.id);
    q.then(({ data }) => { setStale(data || []); setLoading(false); });
  }, [city]);

  const refreshPlace = async (placeId) => {
    const { error } = await supabase.functions.invoke("admin-refresh-places", {
      body: { action: "refresh_single", placePoolId: placeId },
    });
    if (error) addToast({ variant: "error", title: "Refresh failed" });
    else addToast({ variant: "success", title: "Place refreshed" });
  };

  const columns = [
    { key: "name", label: "Name", sortable: true },
    { key: "seeding_category", label: "Category", render: (_, r) => CATEGORY_LABELS[r.seeding_category] || "—" },
    { key: "rating", label: "Rating", render: (_, r) => r.rating ? `★ ${r.rating}` : "—" },
    { key: "last_detail_refresh", label: "Last Refresh", sortable: true, render: (_, r) => new Date(r.last_detail_refresh).toLocaleDateString() },
    { key: "refresh_failures", label: "Failures", render: (_, r) => r.refresh_failures || 0 },
    { key: "actions", label: "", render: (_, r) => <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => refreshPlace(r.id)}>Refresh</Button> },
  ];

  return (
    <DataTable columns={columns} rows={stale} loading={loading}
      emptyMessage="No stale places" emptyIcon={CheckCircle} />
  );
}

// ── Tab 6: Stats & Analytics ─────────────────────────────────────────────────

function StatsTab({ city, stats }) {
  const [ops, setOps] = useState([]);
  const [loadingOps, setLoadingOps] = useState(false);

  useEffect(() => {
    if (!city) return;
    setLoadingOps(true);
    supabase.from("seeding_operations")
      .select("*")
      .eq("city_id", city.id)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => { setOps(data || []); setLoadingOps(false); });
  }, [city]);

  const totalSpend = ops.reduce((s, o) => s + (o.estimated_cost_usd || 0), 0);

  if (!city) return <div className="text-center py-12 text-[var(--color-text-secondary)]">Select a city.</div>;

  // Category breakdown from stats
  const byCat = stats?.by_seeding_category || {};

  const opColumns = [
    { key: "created_at", label: "Date", sortable: true, render: (_, r) => new Date(r.created_at).toLocaleDateString() },
    { key: "seeding_category", label: "Category", render: (_, r) => CATEGORY_LABELS[r.seeding_category] || r.seeding_category },
    { key: "google_api_calls", label: "API Calls" },
    { key: "places_returned", label: "Found" },
    { key: "places_new_inserted", label: "New" },
    { key: "places_duplicate_skipped", label: "Dupes" },
    { key: "estimated_cost_usd", label: "Cost", render: (_, r) => formatCost(r.estimated_cost_usd) },
    { key: "status", label: "Status", render: (_, r) => <Badge variant={r.status === "completed" ? "success" : r.status === "failed" ? "error" : "warning"}>{r.status}</Badge> },
    { key: "errors", label: "Errors", render: (_, r) => {
      const count = r.error_details?.summary?.failed_calls || 0;
      return count > 0 ? (
        <details className="text-xs">
          <summary className="cursor-pointer text-[var(--color-error-700)]">{count} error(s)</summary>
          <pre className="mt-1 text-[10px] whitespace-pre-wrap max-h-32 overflow-y-auto">{JSON.stringify(r.error_details?.tile_errors?.slice(0, 3), null, 1)}</pre>
        </details>
      ) : "—";
    }},
  ];

  return (
    <div className="space-y-6">
      {/* Category breakdown */}
      <SectionCard title="Places by Category">
        <div className="space-y-2">
          {ALL_CATEGORIES.map((catId) => {
            const data = byCat[catId] || { count: 0, with_photos: 0 };
            return (
              <div key={catId} className="flex items-center gap-3">
                <div className="w-32 text-sm truncate" style={{ color: CATEGORY_COLORS[catId] }}>{CATEGORY_LABELS[catId]}</div>
                <div className="flex-1 bg-[var(--gray-100)] rounded-full h-4 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${Math.min((data.count / (stats?.total_places || 1)) * 100, 100)}%`, backgroundColor: CATEGORY_COLORS[catId] }} />
                </div>
                <div className="text-sm w-16 text-right">{data.count}</div>
                <div className="text-xs w-20 text-right text-[var(--color-text-secondary)]">{data.with_photos} photos</div>
              </div>
            );
          })}
        </div>
      </SectionCard>

      {/* Seeding History */}
      <SectionCard title="Seeding History" subtitle={`Total spend: ${formatCost(totalSpend)} / ${formatCost(HARD_CAP_USD)}`}>
        <DataTable columns={opColumns} rows={ops} loading={loadingOps}
          emptyMessage="No seeding operations yet" />
      </SectionCard>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function PlacePoolManagementPage({ onTabChange }) {
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const [activeTab, setActiveTab] = useState("seed");
  const [cities, setCities] = useState([]);
  const [selectedCity, setSelectedCity] = useState(null);
  const [tiles, setTiles] = useState([]);
  const [places, setPlaces] = useState([]); // for map
  const [stats, setStats] = useState(null);
  const [spendTotal, setSpendTotal] = useState(0);
  const [seedingOps, setSeedingOps] = useState([]);
  const [addCityOpen, setAddCityOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Load cities
  useEffect(() => {
    supabase.from("seeding_cities").select("*").order("name")
      .then(({ data }) => { if (mountedRef.current) setCities(data || []); });
  }, [refreshKey]);

  // Load tiles when city selected
  useEffect(() => {
    if (!selectedCity) { setTiles([]); return; }
    supabase.from("seeding_tiles").select("*").eq("city_id", selectedCity.id).order("tile_index")
      .then(({ data }) => { if (mountedRef.current) setTiles(data || []); });
  }, [selectedCity, refreshKey]);

  // Load places for map
  useEffect(() => {
    if (!selectedCity) { setPlaces([]); return; }
    supabase.from("place_pool")
      .select("id, name, lat, lng, rating, seeding_category, is_active, stored_photo_urls")
      .eq("city_id", selectedCity.id)
      .limit(2000)
      .then(({ data }) => { if (mountedRef.current) setPlaces(data || []); });
  }, [selectedCity, refreshKey]);

  // Load stats + seeding ops
  useEffect(() => {
    if (!selectedCity) { setStats(null); setSpendTotal(0); setSeedingOps([]); return; }
    supabase.rpc("admin_city_place_stats", { p_city_id: selectedCity.id })
      .then(({ data }) => { if (mountedRef.current) setStats(data); });
    supabase.from("seeding_operations").select("*").eq("city_id", selectedCity.id)
      .then(({ data }) => {
        if (!mountedRef.current) return;
        setSeedingOps(data || []);
        setSpendTotal((data || []).reduce((s, r) => s + (r.estimated_cost_usd || 0), 0));
      });
  }, [selectedCity, refreshKey]);

  const handleAddCity = (city) => {
    setCities((prev) => [...prev, city]);
    setSelectedCity(city);
    refresh();
  };

  return (
    <div className="space-y-4 py-6">
      <CitySelector cities={cities} selectedCity={selectedCity} onSelect={setSelectedCity} onAddCity={() => setAddCityOpen(true)} />
      {selectedCity && <CitySummaryBar stats={stats} spendTotal={spendTotal} />}
      <Tabs tabs={SUB_TABS} activeTab={activeTab} onChange={setActiveTab} />

      <div className="mt-4">
        {activeTab === "seed" && <SeedTab city={selectedCity} tiles={tiles} onRefresh={refresh} />}
        {activeTab === "map" && <MapTab city={selectedCity} tiles={tiles} places={places} seedingOps={seedingOps} />}
        {activeTab === "browse" && <BrowseTab city={selectedCity} onRefresh={refresh} />}
        {activeTab === "photos" && <PhotoTab city={selectedCity} stats={stats} tiles={tiles} />}
        {activeTab === "stale" && <StaleTab city={selectedCity} />}
        {activeTab === "stats" && <StatsTab city={selectedCity} stats={stats} />}
      </div>

      <AddCityModal open={addCityOpen} onClose={() => setAddCityOpen(false)} onSave={handleAddCity} />
    </div>
  );
}

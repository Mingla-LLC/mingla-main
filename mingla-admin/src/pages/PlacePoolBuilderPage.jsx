import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { supabase } from "../lib/supabase";
import { useToast } from "../context/ToastContext";
import { SectionCard, StatCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Badge } from "../components/ui/Badge";
import { SearchInput } from "../components/ui/SearchInput";
import { DataTable } from "../components/ui/Table";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { Tabs } from "../components/ui/Tabs";
import { Spinner } from "../components/ui/Spinner";
import {
  timeAgo, formatDate, formatDateTime, formatRelativeTime, formatFullDate, truncate, escapeLike,
} from "../lib/formatters";
import { logAdminAction } from "../lib/auditLog";
import { exportCsv } from "../lib/exportCsv";
import {
  Globe, MapPin, Search, Upload, RefreshCw, Check,
  Map, List, Database, Zap, BarChart3, Star,
  Eye, EyeOff, ChevronDown, AlertCircle, Pencil,
  ShieldAlert, Clock, XCircle, CheckCircle, RotateCcw,
} from "lucide-react";

// ─── Constants ───────────────────────────────────────────────────────────────

const EDGE_FUNCTION_URL =
  import.meta.env.VITE_SUPABASE_URL + "/functions/v1/admin-place-search";

const PAGE_SIZE = 20;

const SUB_TABS = [
  { id: "search", label: "Search & Import" },
  { id: "browse", label: "Browse Pool" },
  { id: "stale", label: "Stale Review" },
  { id: "stats", label: "Pool Stats" },
];

const PRICE_TIER_VARIANT = {
  chill: "success",
  comfy: "info",
  bougie: "brand",
  lavish: "warning",
};

const PRICE_TIER_LABEL = {
  PRICE_LEVEL_FREE: "Free",
  PRICE_LEVEL_INEXPENSIVE: "$",
  PRICE_LEVEL_MODERATE: "$$",
  PRICE_LEVEL_EXPENSIVE: "$$$",
  PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
};

const CATEGORY_OPTIONS = [
  "nature", "first_meet", "picnic_park", "drink", "casual_eats",
  "fine_dining", "watch", "creative_arts", "play", "wellness",
  "groceries_flowers", "work_business",
];

const VISIBILITY_OPTIONS = ["public", "unlisted", "hidden"];
const PRICE_TIER_OPTIONS = ["chill", "comfy", "bougie", "lavish"];

// ─── Leaflet Icons ───────────────────────────────────────────────────────────

const selectedIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34],
});

const defaultIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-grey.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34],
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function RecenterMap({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.setView(center, 12);
  }, [center, map]);
  return null;
}

function parseCityCountry(address) {
  if (!address) return { city: "Unknown", country: "Unknown" };
  const parts = address.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) return { city: parts[parts.length - 2], country: parts[parts.length - 1] };
  if (parts.length === 1) return { city: parts[0], country: "Unknown" };
  return { city: "Unknown", country: "Unknown" };
}

function formatRating(rating) {
  if (rating == null) return "—";
  return rating.toFixed(1);
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function PlacePoolBuilderPage() {
  const { addToast } = useToast();
  const [subTab, setSubTab] = useState("search");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-1">
          Place Pool Builder
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Search, review, and import places from Google into the place pool.
        </p>
      </div>

      <Tabs tabs={SUB_TABS} activeTab={subTab} onChange={setSubTab} />

      <div role="tabpanel" id={`tabpanel-${subTab}`} aria-labelledby={`tab-${subTab}`}>
        {subTab === "search" && <SearchImportView addToast={addToast} />}
        {subTab === "browse" && <BrowsePoolView addToast={addToast} />}
        {subTab === "stale" && <StaleReviewView addToast={addToast} />}
        {subTab === "stats" && <PoolStatsView />}
      </div>
    </div>
  );
}

// ─── Search & Import Sub-view ────────────────────────────────────────────────

function SearchImportView({ addToast }) {
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  const [postcode, setPostcode] = useState("");
  const [textQuery, setTextQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [selectedPlaces, setSelectedPlaces] = useState(new Set());
  const [searching, setSearching] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [viewMode, setViewMode] = useState("table");
  const [existingPlaceIds, setExistingPlaceIds] = useState(new Set());
  const [mapKey, setMapKey] = useState(0);
  const mountedRef = useRef(true);

  // Confirm push modal
  const [confirmPushModal, setConfirmPushModal] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const canSearch = city.trim() || country.trim();

  const selectedCount = selectedPlaces.size;
  const existingCount = searchResults.filter((p) => existingPlaceIds.has(p.googlePlaceId)).length;
  const newOnlyCount = searchResults.filter((p) => !existingPlaceIds.has(p.googlePlaceId)).length;

  const handleSearch = useCallback(async () => {
    setSearching(true);
    setSearchResults([]);
    setSelectedPlaces(new Set());
    setExistingPlaceIds(new Set());

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        addToast({ variant: "error", title: "Not authenticated. Please log in again." });
        return;
      }

      const response = await fetch(EDGE_FUNCTION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: "search",
          textQuery: textQuery.trim(),
          city: city.trim(),
          country: country.trim(),
          postcode: postcode.trim(),
          maxResults: 20,
        }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Search failed");
      if (!mountedRef.current) return;

      const places = result.places || [];
      setSearchResults(places);
      setSelectedPlaces(new Set(places.map((p) => p.googlePlaceId)));
      setMapKey((k) => k + 1);

      if (places.length > 0) {
        const ids = places.map((p) => p.googlePlaceId);
        const { data: existing } = await supabase
          .from("place_pool")
          .select("google_place_id")
          .in("google_place_id", ids);
        if (mountedRef.current) {
          setExistingPlaceIds(new Set((existing || []).map((e) => e.google_place_id)));
        }
      }

      addToast({ variant: "success", title: `Found ${places.length} places` });
    } catch (err) {
      if (mountedRef.current) {
        addToast({ variant: "error", title: "Search failed", description: err.message });
      }
    } finally {
      if (mountedRef.current) setSearching(false);
    }
  }, [city, country, postcode, textQuery, addToast]);

  const handlePush = useCallback(async () => {
    setConfirmPushModal(false);
    if (selectedPlaces.size === 0) return;
    setPushing(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        addToast({ variant: "error", title: "Not authenticated." });
        return;
      }

      const placesToPush = searchResults.filter((p) => selectedPlaces.has(p.googlePlaceId));

      const response = await fetch(EDGE_FUNCTION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action: "push", places: placesToPush }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Push failed");
      if (!mountedRef.current) return;

      addToast({ variant: "success", title: `${result.total} places pushed to pool` });
      await logAdminAction("place.import", "place_pool", null, {
        count: result.total,
        city: city.trim(),
        country: country.trim(),
      });

      const ids = searchResults.map((p) => p.googlePlaceId);
      const { data: existing } = await supabase
        .from("place_pool")
        .select("google_place_id")
        .in("google_place_id", ids);
      if (mountedRef.current) {
        setExistingPlaceIds(new Set((existing || []).map((e) => e.google_place_id)));
      }
    } catch (err) {
      if (mountedRef.current) {
        addToast({ variant: "error", title: "Push failed", description: err.message });
      }
    } finally {
      if (mountedRef.current) setPushing(false);
    }
  }, [selectedPlaces, searchResults, city, country, addToast]);

  const toggleSelection = useCallback((id) => {
    // Dedup: prevent selecting places already in pool
    if (existingPlaceIds.has(id)) return;
    setSelectedPlaces((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, [existingPlaceIds]);

  const selectAll = useCallback(() => {
    setSelectedPlaces(new Set(searchResults.map((p) => p.googlePlaceId)));
  }, [searchResults]);

  const deselectAll = useCallback(() => {
    setSelectedPlaces(new Set());
  }, []);

  const selectNewOnly = useCallback(() => {
    setSelectedPlaces(
      new Set(searchResults.filter((p) => !existingPlaceIds.has(p.googlePlaceId)).map((p) => p.googlePlaceId))
    );
  }, [searchResults, existingPlaceIds]);

  const mapCenter = useMemo(() => {
    if (searchResults.length === 0) return null;
    return [searchResults[0].lat, searchResults[0].lng];
  }, [searchResults]);

  const searchColumns = useMemo(() => [
    {
      key: "_select",
      label: "",
      width: "40px",
      render: (_, row) => {
        const isExisting = existingPlaceIds.has(row.googlePlaceId);
        return (
          <button
            onClick={() => toggleSelection(row.googlePlaceId)}
            disabled={isExisting}
            className={[
              "w-5 h-5 rounded border flex items-center justify-center transition-colors",
              isExisting
                ? "border-[var(--gray-200)] bg-[var(--gray-100)] cursor-not-allowed"
                : "border-[var(--gray-300)] cursor-pointer hover:border-[var(--color-brand-500)]",
            ].join(" ")}
            aria-label={selectedPlaces.has(row.googlePlaceId) ? "Deselect" : "Select"}
          >
            {selectedPlaces.has(row.googlePlaceId) && (
              <Check className="w-3.5 h-3.5 text-[var(--color-brand-500)]" />
            )}
          </button>
        );
      },
    },
    {
      key: "name",
      label: "Name",
      width: "200px",
      render: (_, row) => (
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{row.name}</span>
          {existingPlaceIds.has(row.googlePlaceId) && <Badge variant="info">In Pool</Badge>}
        </div>
      ),
    },
    {
      key: "address", label: "Address", width: "250px",
      render: (_, row) => <span className="truncate text-[var(--color-text-secondary)]">{row.address || "—"}</span>,
    },
    {
      key: "rating", label: "Rating", width: "80px",
      render: (_, row) => row.rating != null ? (
        <span className="flex items-center gap-1"><Star className="w-3.5 h-3.5 text-[#f59e0b] fill-[#f59e0b]" />{formatRating(row.rating)}</span>
      ) : <span className="text-[var(--color-text-muted)]">—</span>,
    },
    { key: "reviewCount", label: "Reviews", width: "80px", render: (_, row) => row.reviewCount || "—" },
    {
      key: "priceLevel", label: "Price", width: "80px",
      render: (_, row) => row.priceLevel ? (
        <Badge variant={PRICE_TIER_VARIANT[{ PRICE_LEVEL_FREE: "chill", PRICE_LEVEL_INEXPENSIVE: "chill", PRICE_LEVEL_MODERATE: "comfy", PRICE_LEVEL_EXPENSIVE: "bougie", PRICE_LEVEL_VERY_EXPENSIVE: "lavish" }[row.priceLevel]] || "default"}>
          {PRICE_TIER_LABEL[row.priceLevel] || row.priceLevel}
        </Badge>
      ) : <span className="text-[var(--color-text-muted)]">—</span>,
    },
    {
      key: "primaryType", label: "Type", width: "120px",
      render: (_, row) => row.primaryType ? <Badge variant="outline">{row.primaryType.replace(/_/g, " ")}</Badge> : <span className="text-[var(--color-text-muted)]">—</span>,
    },
    {
      key: "photos", label: "Photos", width: "60px",
      render: (_, row) => (row.photos ? row.photos.length : 0),
    },
  ], [selectedPlaces, existingPlaceIds, toggleSelection]);

  const searchRows = useMemo(
    () => searchResults.map((p) => ({ ...p, _key: p.googlePlaceId })),
    [searchResults]
  );

  return (
    <div className="space-y-5">
      {/* Search Form */}
      <SectionCard title="Search Places" subtitle="Each search uses 1 Google API call">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <Input label="Country" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="e.g., Nigeria, United Kingdom, USA" />
          <Input label="City" value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g., Lagos, London, New York" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <Input label="Postcode / Zip (optional)" value={postcode} onChange={(e) => setPostcode(e.target.value)} placeholder="Optional" />
          <Input label="Search Query (optional)" value={textQuery} onChange={(e) => setTextQuery(e.target.value)} placeholder="e.g., rooftop bars, museums" />
        </div>
        <Button icon={Search} loading={searching} disabled={!canSearch} onClick={handleSearch}>
          Search Google Places
        </Button>
      </SectionCard>

      {/* Results */}
      {(searchResults.length > 0 || searching) && (
        <SectionCard
          title={searching ? "Searching..." : `Found ${searchResults.length} places`}
          subtitle={!searching && searchResults.length > 0 ? `${selectedCount} selected · ${existingCount} already in pool` : undefined}
          noPadding
        >
          {searchResults.length > 0 && (
            <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--gray-200)]">
              <div className="flex items-center gap-2 flex-wrap">
                <Button size="sm" variant="ghost" onClick={selectAll}>Select All</Button>
                <Button size="sm" variant="ghost" onClick={deselectAll}>Deselect All</Button>
                {existingCount > 0 && (
                  <Button size="sm" variant="ghost" onClick={selectNewOnly}>Select New Only ({newOnlyCount})</Button>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant={viewMode === "table" ? "secondary" : "ghost"} icon={List} onClick={() => setViewMode("table")}>Table</Button>
                <Button size="sm" variant={viewMode === "map" ? "secondary" : "ghost"} icon={Map} onClick={() => setViewMode("map")}>Map</Button>
              </div>
            </div>
          )}

          {viewMode === "table" && (
            <DataTable columns={searchColumns} rows={searchRows} loading={searching} emptyIcon={Search} emptyMessage="No places found. Try a different search." />
          )}

          {viewMode === "map" && searchResults.length > 0 && mapCenter && (
            <div style={{ height: 500, borderRadius: "0 0 12px 12px", overflow: "hidden" }}>
              <MapContainer key={mapKey} center={mapCenter} zoom={12} style={{ height: "100%", width: "100%" }}>
                <RecenterMap center={mapCenter} />
                <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                {searchResults.map((place) => (
                  <Marker key={place.googlePlaceId} position={[place.lat, place.lng]} icon={selectedPlaces.has(place.googlePlaceId) ? selectedIcon : defaultIcon}>
                    <Popup>
                      <div style={{ minWidth: 180, fontFamily: "inherit" }}>
                        <strong>{place.name}</strong><br />
                        <span style={{ fontSize: 12, color: "#666" }}>{place.address}</span><br />
                        <span style={{ fontSize: 12 }}>Rating: {formatRating(place.rating)} · Reviews: {place.reviewCount}</span>
                        {existingPlaceIds.has(place.googlePlaceId) && (<><br /><em style={{ fontSize: 11, color: "#3b82f6" }}>Already in pool</em></>)}
                        <br />
                        <button
                          onClick={() => toggleSelection(place.googlePlaceId)}
                          disabled={existingPlaceIds.has(place.googlePlaceId)}
                          style={{
                            marginTop: 6, padding: "3px 10px", fontSize: 12, borderRadius: 6,
                            border: "1px solid #ccc",
                            background: selectedPlaces.has(place.googlePlaceId) ? "#fee2e2" : "#dcfce7",
                            cursor: existingPlaceIds.has(place.googlePlaceId) ? "not-allowed" : "pointer",
                            opacity: existingPlaceIds.has(place.googlePlaceId) ? 0.5 : 1,
                          }}
                        >
                          {existingPlaceIds.has(place.googlePlaceId) ? "In Pool" : selectedPlaces.has(place.googlePlaceId) ? "Deselect" : "Select"}
                        </button>
                      </div>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </div>
          )}

          {searchResults.length > 0 && (
            <div className="px-5 py-4 border-t border-[var(--gray-200)]">
              <Button icon={Upload} loading={pushing} disabled={selectedCount === 0} onClick={() => setConfirmPushModal(true)}>
                Push {selectedCount} Selected to Place Pool
              </Button>
            </div>
          )}
        </SectionCard>
      )}

      {/* Confirm Push Modal */}
      <Modal open={confirmPushModal} onClose={() => setConfirmPushModal(false)} title="Confirm Import" size="sm">
        <ModalBody>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Import <strong className="text-[var(--color-text-primary)]">{selectedCount}</strong> selected places into the place pool?
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setConfirmPushModal(false)}>Cancel</Button>
          <Button variant="primary" icon={Upload} loading={pushing} onClick={handlePush}>Import</Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

// ─── Browse Pool Sub-view ────────────────────────────────────────────────────

function BrowsePoolView({ addToast }) {
  const [poolData, setPoolData] = useState([]);
  const [poolCount, setPoolCount] = useState(0);
  const [poolPage, setPoolPage] = useState(0);
  const [poolFilter, setPoolFilter] = useState("active");
  const [poolSearch, setPoolSearch] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [poolLoading, setPoolLoading] = useState(true);
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [refreshingIds, setRefreshingIds] = useState(new Set());
  const [togglingIds, setTogglingIds] = useState(new Set());
  const mountedRef = useRef(true);

  // Edit modal
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({ name: "", category: "", visibility: "", price_tier: "" });
  const [editSaving, setEditSaving] = useState(false);

  // Deactivate confirmation modal
  const [deactivateTarget, setDeactivateTarget] = useState(null);
  const [bulkDeactivateModal, setBulkDeactivateModal] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchPool = useCallback(async () => {
    setPoolLoading(true);
    try {
      let query = supabase
        .from("place_pool")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(poolPage * PAGE_SIZE, (poolPage + 1) * PAGE_SIZE - 1);

      if (poolFilter === "active") query = query.eq("is_active", true);
      if (poolFilter === "inactive") query = query.eq("is_active", false);
      if (poolSearch.trim()) query = query.ilike("name", `%${escapeLike(poolSearch.trim())}%`);
      if (cityFilter.trim()) query = query.ilike("address", `%${escapeLike(cityFilter.trim())}%`);
      if (typeFilter.trim()) query = query.contains("types", [typeFilter.trim()]);

      const { data, count } = await query;
      if (mountedRef.current) {
        setPoolData(data || []);
        setPoolCount(count || 0);
      }
    } catch (err) {
      console.error("Failed to fetch pool:", err.message);
    } finally {
      if (mountedRef.current) setPoolLoading(false);
    }
  }, [poolPage, poolFilter, poolSearch, cityFilter, typeFilter]);

  useEffect(() => { fetchPool(); }, [fetchPool]);

  useEffect(() => {
    if (poolData.length === 0) { setSelectedRows(new Set()); return; }
    const validIds = new Set(poolData.map((p) => p.id));
    setSelectedRows((prev) => {
      const next = new Set([...prev].filter((id) => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [poolData]);

  // ─── Edit place ───────────────────────────────────────────────────────

  const openEditModal = (row) => {
    setEditTarget(row);
    setEditForm({
      name: row.name || "",
      category: row.category || "",
      visibility: row.visibility || "public",
      price_tier: row.price_tier || "",
    });
  };

  const handleSaveEdit = async () => {
    if (!editTarget) return;
    setEditSaving(true);
    try {
      const { error } = await supabase
        .from("place_pool")
        .update({
          name: editForm.name,
          category: editForm.category || null,
          visibility: editForm.visibility || "public",
          price_tier: editForm.price_tier || null,
        })
        .eq("id", editTarget.id);
      if (error) throw error;
      addToast({ variant: "success", title: "Place updated" });
      await logAdminAction("place.edit", "place_pool", editTarget.id, { name: editForm.name });
      setEditTarget(null);
      fetchPool();
    } catch (err) {
      addToast({ variant: "error", title: "Update failed", description: err.message });
    } finally {
      setEditSaving(false);
    }
  };

  // ─── Toggle active ────────────────────────────────────────────────────

  const handleToggleActive = useCallback(async (row) => {
    const newStatus = !row.is_active;
    if (!newStatus) {
      setDeactivateTarget(row);
      return;
    }
    setTogglingIds((prev) => new Set(prev).add(row.id));
    try {
      const { data: result, error } = await supabase.rpc("admin_reactivate_place", {
        p_place_id: row.id, p_reason: "Reactivated from Browse Pool",
      });
      if (error) throw error;
      if (result?.error) throw new Error(result.error);
      addToast({ variant: "success", title: `${row.name} reactivated (${result.cards_reactivated} cards restored)` });
      await logAdminAction("place.toggle_active", "place_pool", row.id, { name: row.name, is_active: true });
      fetchPool();
    } catch (err) {
      addToast({ variant: "error", title: "Update failed", description: err.message });
    } finally {
      if (mountedRef.current) {
        setTogglingIds((prev) => { const next = new Set(prev); next.delete(row.id); return next; });
      }
    }
  }, [addToast, fetchPool]);

  const confirmDeactivate = async () => {
    if (!deactivateTarget) return;
    const row = deactivateTarget;
    setDeactivateTarget(null);
    setTogglingIds((prev) => new Set(prev).add(row.id));
    try {
      const { data: result, error } = await supabase.rpc("admin_deactivate_place", {
        p_place_id: row.id, p_reason: "Deactivated from Browse Pool",
      });
      if (error) throw error;
      if (result?.error) throw new Error(result.error);
      addToast({ variant: "success", title: `${row.name} deactivated (${result.cards_deactivated} cards removed)` });
      await logAdminAction("place.toggle_active", "place_pool", row.id, { name: row.name, is_active: false });
      fetchPool();
    } catch (err) {
      addToast({ variant: "error", title: "Update failed", description: err.message });
    } finally {
      if (mountedRef.current) {
        setTogglingIds((prev) => { const next = new Set(prev); next.delete(row.id); return next; });
      }
    }
  };

  const handleRefreshPlace = useCallback(async (googlePlaceId) => {
    setRefreshingIds((prev) => new Set(prev).add(googlePlaceId));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { addToast({ variant: "error", title: "Not authenticated." }); return; }

      const response = await fetch(EDGE_FUNCTION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: "refresh", googlePlaceIds: [googlePlaceId] }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Refresh failed");
      addToast({ variant: "success", title: `Refreshed ${result.refreshed} place${result.refreshed !== 1 ? "s" : ""}` });
      fetchPool();
    } catch (err) {
      addToast({ variant: "error", title: "Refresh failed", description: err.message });
    } finally {
      if (mountedRef.current) {
        setRefreshingIds((prev) => { const next = new Set(prev); next.delete(googlePlaceId); return next; });
      }
    }
  }, [addToast, fetchPool]);

  const handleBulkDeactivate = useCallback(async () => {
    setBulkDeactivateModal(false);
    if (selectedRows.size === 0) return;
    try {
      const ids = Array.from(selectedRows);
      const { data: result, error } = await supabase.rpc("admin_bulk_deactivate_places", {
        p_place_ids: ids, p_reason: "Bulk deactivated from Browse Pool",
      });
      if (error) throw error;
      addToast({ variant: "success", title: `${result.places_deactivated} places deactivated (${result.cards_deactivated} cards removed)` });
      await logAdminAction("place.toggle_active", "place_pool", null, { count: result.places_deactivated, is_active: false });
      setSelectedRows(new Set());
      fetchPool();
    } catch (err) {
      addToast({ variant: "error", title: "Bulk deactivate failed", description: err.message });
    }
  }, [selectedRows, addToast, fetchPool]);

  const handleBulkRefresh = useCallback(async () => {
    if (selectedRows.size === 0) return;
    const selectedData = poolData.filter((p) => selectedRows.has(p.id));
    const ids = selectedData.map((p) => p.google_place_id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { addToast({ variant: "error", title: "Not authenticated." }); return; }
      const response = await fetch(EDGE_FUNCTION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: "refresh", googlePlaceIds: ids }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Refresh failed");
      addToast({ variant: "success", title: `Refreshed ${result.refreshed} of ${ids.length} places` });
      setSelectedRows(new Set());
      fetchPool();
    } catch (err) {
      addToast({ variant: "error", title: "Bulk refresh failed", description: err.message });
    }
  }, [selectedRows, poolData, addToast, fetchPool]);

  const toggleRowSelect = useCallback((id) => {
    setSelectedRows((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }, []);

  const toggleSelectAllPage = useCallback(() => {
    const allOnPage = poolData.map((p) => p.id);
    const allSelected = allOnPage.every((id) => selectedRows.has(id));
    if (allSelected) setSelectedRows(new Set());
    else setSelectedRows(new Set(allOnPage));
  }, [poolData, selectedRows]);

  const poolColumns = useMemo(() => [
    {
      key: "_select", label: "", width: "40px",
      render: (_, row) => (
        <button onClick={() => toggleRowSelect(row.id)} className="w-5 h-5 rounded border border-[var(--gray-300)] flex items-center justify-center cursor-pointer hover:border-[var(--color-brand-500)] transition-colors" aria-label={selectedRows.has(row.id) ? "Deselect" : "Select"}>
          {selectedRows.has(row.id) && <Check className="w-3.5 h-3.5 text-[var(--color-brand-500)]" />}
        </button>
      ),
    },
    {
      key: "name", label: "Name", width: "180px",
      render: (val, row) => (
        <button onClick={() => openEditModal(row)} className="font-medium truncate text-left hover:underline cursor-pointer text-[var(--color-text-primary)]">
          {val || "—"}
        </button>
      ),
    },
    {
      key: "address", label: "Address", width: "220px",
      render: (val) => <span className="truncate text-[var(--color-text-secondary)]">{val ? (val.length > 50 ? val.slice(0, 50) + "..." : val) : "—"}</span>,
    },
    {
      key: "rating", label: "Rating", width: "80px",
      render: (val) => val != null ? (<span className="flex items-center gap-1"><Star className="w-3.5 h-3.5 text-[#f59e0b] fill-[#f59e0b]" />{formatRating(val)}</span>) : <span className="text-[var(--color-text-muted)]">—</span>,
    },
    {
      key: "price_tier", label: "Tier", width: "80px",
      render: (val) => val ? <Badge variant={PRICE_TIER_VARIANT[val] || "default"}>{val}</Badge> : <span className="text-[var(--color-text-muted)]">—</span>,
    },
    {
      key: "primary_type", label: "Type", width: "120px",
      render: (val) => val ? <Badge variant="outline">{val.replace(/_/g, " ")}</Badge> : <span className="text-[var(--color-text-muted)]">—</span>,
    },
    { key: "total_impressions", label: "Views", width: "70px", render: (val) => val ?? 0 },
    { key: "total_saves", label: "Saves", width: "70px", render: (val) => val ?? 0 },
    {
      key: "is_active", label: "Status", width: "90px",
      render: (val) => <Badge variant={val ? "success" : "error"} dot>{val ? "Active" : "Inactive"}</Badge>,
    },
    {
      key: "_actions", label: "Actions", width: "180px",
      render: (_, row) => (
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" icon={Pencil} onClick={() => openEditModal(row)} aria-label="Edit place" />
          <Button size="sm" variant="ghost" icon={RefreshCw} loading={refreshingIds.has(row.google_place_id)} onClick={() => handleRefreshPlace(row.google_place_id)} aria-label="Refresh place data" />
          <Button size="sm" variant="ghost" icon={row.is_active ? EyeOff : Eye} loading={togglingIds.has(row.id)} onClick={() => handleToggleActive(row)} aria-label={row.is_active ? "Deactivate" : "Reactivate"} />
        </div>
      ),
    },
  ], [selectedRows, refreshingIds, togglingIds, toggleRowSelect, handleRefreshPlace, handleToggleActive]);

  const paginationFrom = poolCount === 0 ? 0 : poolPage * PAGE_SIZE + 1;
  const paginationTo = Math.min((poolPage + 1) * PAGE_SIZE, poolCount);

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <SearchInput value={poolSearch} onChange={(e) => { setPoolSearch(e.target.value); setPoolPage(0); }} onClear={() => { setPoolSearch(""); setPoolPage(0); }} placeholder="Search by name..." className="w-full sm:w-56" />
        <Input value={cityFilter} onChange={(e) => { setCityFilter(e.target.value); setPoolPage(0); }} placeholder="Filter by city..." className="!h-10 sm:!w-44" />
        <Input value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPoolPage(0); }} placeholder="Filter by type..." className="!h-10 sm:!w-44" />
        <div className="flex items-center gap-1">
          {["active", "inactive", "all"].map((f) => (
            <button key={f} onClick={() => { setPoolFilter(f); setPoolPage(0); }}
              className={["px-3 py-1.5 text-xs font-medium rounded-full border cursor-pointer transition-all duration-150", poolFilter === f ? "bg-[var(--color-brand-500)] text-white border-[var(--color-brand-500)]" : "bg-[var(--color-background-primary)] text-[var(--color-text-secondary)] border-[var(--gray-300)] hover:border-[var(--gray-400)]"].join(" ")}
            >{f.charAt(0).toUpperCase() + f.slice(1)}</button>
          ))}
        </div>
      </div>

      {/* Bulk Actions */}
      {selectedRows.size > 0 && (
        <div className="flex items-center gap-2 px-1">
          <span className="text-sm text-[var(--color-text-secondary)]">{selectedRows.size} selected</span>
          <Button size="sm" variant="secondary" icon={RefreshCw} onClick={handleBulkRefresh}>Refresh Selected</Button>
          {poolFilter !== "inactive" && (
            <Button size="sm" variant="danger" icon={EyeOff} onClick={() => setBulkDeactivateModal(true)}>Deactivate Selected</Button>
          )}
        </div>
      )}

      {poolData.length > 0 && (
        <div className="px-1">
          <Button size="sm" variant="ghost" onClick={toggleSelectAllPage}>
            {poolData.every((p) => selectedRows.has(p.id)) ? "Deselect All on Page" : "Select All on Page"}
          </Button>
        </div>
      )}

      <DataTable
        columns={poolColumns} rows={poolData} loading={poolLoading}
        emptyIcon={Database} emptyMessage={poolFilter === "inactive" ? "No inactive places." : "No places in the pool yet. Use Search & Import to add some."} striped
        pagination={{ page: poolPage, pageSize: PAGE_SIZE, total: poolCount, from: paginationFrom, to: paginationTo, onChange: setPoolPage }}
      />

      {/* Deactivate Single Modal */}
      <Modal open={!!deactivateTarget} onClose={() => setDeactivateTarget(null)} title="Deactivate Place" destructive size="sm">
        <ModalBody>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Deactivate <strong className="text-[var(--color-text-primary)]">{deactivateTarget?.name}</strong>? It will be hidden from the active pool.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setDeactivateTarget(null)}>Cancel</Button>
          <Button variant="danger" onClick={confirmDeactivate}>Deactivate</Button>
        </ModalFooter>
      </Modal>

      {/* Bulk Deactivate Modal */}
      <Modal open={bulkDeactivateModal} onClose={() => setBulkDeactivateModal(false)} title="Deactivate Selected Places" destructive size="sm">
        <ModalBody>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Deactivate <strong className="text-[var(--color-text-primary)]">{selectedRows.size}</strong> selected places?
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setBulkDeactivateModal(false)}>Cancel</Button>
          <Button variant="danger" onClick={handleBulkDeactivate}>Deactivate All</Button>
        </ModalFooter>
      </Modal>

      {/* Edit Place Modal */}
      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title="Edit Place" size="md">
        <ModalBody>
          <div className="space-y-4">
            <Input label="Name" value={editForm.name} onChange={(e) => setEditForm(f => ({ ...f, name: e.target.value }))} />
            <div>
              <label className="block text-xs font-medium mb-1.5 text-[var(--color-text-secondary)]">Category</label>
              <select value={editForm.category} onChange={(e) => setEditForm(f => ({ ...f, category: e.target.value }))}
                className="w-full text-sm px-3 py-2 rounded-lg border bg-transparent" style={{ borderColor: "var(--color-border)", color: "var(--color-text-primary)", backgroundColor: "var(--color-background-primary)" }}>
                <option value="">None</option>
                {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5 text-[var(--color-text-secondary)]">Visibility</label>
              <select value={editForm.visibility} onChange={(e) => setEditForm(f => ({ ...f, visibility: e.target.value }))}
                className="w-full text-sm px-3 py-2 rounded-lg border bg-transparent" style={{ borderColor: "var(--color-border)", color: "var(--color-text-primary)", backgroundColor: "var(--color-background-primary)" }}>
                {VISIBILITY_OPTIONS.map(v => <option key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5 text-[var(--color-text-secondary)]">Price Tier</label>
              <select value={editForm.price_tier} onChange={(e) => setEditForm(f => ({ ...f, price_tier: e.target.value }))}
                className="w-full text-sm px-3 py-2 rounded-lg border bg-transparent" style={{ borderColor: "var(--color-border)", color: "var(--color-text-primary)", backgroundColor: "var(--color-background-primary)" }}>
                <option value="">None</option>
                {PRICE_TIER_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setEditTarget(null)}>Cancel</Button>
          <Button variant="primary" loading={editSaving} onClick={handleSaveEdit}>Save Changes</Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

// ─── Stale Review Sub-view ───────────────────────────────────────────────────

const ADMIN_REFRESH_URL =
  import.meta.env.VITE_SUPABASE_URL + "/functions/v1/admin-refresh-places";

const STALE_FILTER_OPTIONS = [
  { id: "all", label: "All Stale" },
  { id: "active_only", label: "Active Only" },
  { id: "recently_served", label: "Recently Served" },
  { id: "critical", label: "Critical (>30d)" },
  { id: "inactive_only", label: "Inactive" },
];

const STALE_SORT_OPTIONS = [
  { id: "staleness", label: "Most Stale First" },
  { id: "failures", label: "Most Failures First" },
  { id: "recently_served", label: "Recently Served First" },
  { id: "name", label: "Name A–Z" },
];

const TIER_BADGE = {
  critical: { variant: "error", label: "Critical" },
  warning: { variant: "warning", label: "Warning" },
  stale: { variant: "info", label: "Stale" },
  fresh: { variant: "success", label: "Fresh" },
};

function StaleReviewView({ addToast }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("active_only");
  const [sortBy, setSortBy] = useState("staleness");
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [actionLoading, setActionLoading] = useState(new Set());
  const [reasonModal, setReasonModal] = useState(null); // { type, placeId, placeName }
  const [reasonText, setReasonText] = useState("");
  const [refreshingAll, setRefreshingAll] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchStale = useCallback(async () => {
    setLoading(true);
    try {
      const { data: result, error } = await supabase.rpc("admin_list_stale_places", {
        p_filter: filter,
        p_sort_by: sortBy,
        p_page: page,
        p_page_size: PAGE_SIZE,
      });
      if (error) throw error;
      if (mountedRef.current) setData(result);
    } catch (err) {
      console.error("Failed to fetch stale places:", err.message);
      if (mountedRef.current) addToast({ variant: "error", title: "Failed to load stale places", description: err.message });
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [filter, sortBy, page, addToast]);

  useEffect(() => { fetchStale(); }, [fetchStale]);

  // Reset page when filter/sort changes
  useEffect(() => { setPage(0); setSelectedIds(new Set()); }, [filter, sortBy]);

  // ─── Actions ─────────────────────────────────────────────────────────

  const handleDeactivate = useCallback(async (placeId, placeName, reason) => {
    setActionLoading((prev) => new Set(prev).add(placeId));
    try {
      const { data: result, error } = await supabase.rpc("admin_deactivate_place", {
        p_place_id: placeId,
        p_reason: reason || null,
      });
      if (error) throw error;
      if (result?.error) throw new Error(result.error);
      addToast({ variant: "success", title: `${placeName} deactivated (${result.cards_deactivated} cards removed)` });
      await logAdminAction("place.stale_deactivate", "place_pool", placeId, { name: placeName, reason });
      fetchStale();
    } catch (err) {
      addToast({ variant: "error", title: "Deactivation failed", description: err.message });
    } finally {
      if (mountedRef.current) setActionLoading((prev) => { const next = new Set(prev); next.delete(placeId); return next; });
    }
  }, [addToast, fetchStale]);

  const handleReactivate = useCallback(async (placeId, placeName, reason) => {
    setActionLoading((prev) => new Set(prev).add(placeId));
    try {
      const { data: result, error } = await supabase.rpc("admin_reactivate_place", {
        p_place_id: placeId,
        p_reason: reason || null,
      });
      if (error) throw error;
      if (result?.error) throw new Error(result.error);
      addToast({ variant: "success", title: `${placeName} reactivated (${result.cards_reactivated} cards restored)` });
      await logAdminAction("place.stale_reactivate", "place_pool", placeId, { name: placeName, reason });
      fetchStale();
    } catch (err) {
      addToast({ variant: "error", title: "Reactivation failed", description: err.message });
    } finally {
      if (mountedRef.current) setActionLoading((prev) => { const next = new Set(prev); next.delete(placeId); return next; });
    }
  }, [addToast, fetchStale]);

  const handleRefreshSingle = useCallback(async (placeId, placeName) => {
    setActionLoading((prev) => new Set(prev).add(placeId));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { addToast({ variant: "error", title: "Not authenticated." }); return; }

      const response = await fetch(ADMIN_REFRESH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: "refresh_single", placePoolId: placeId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Refresh failed");
      if (result.success) {
        addToast({ variant: "success", title: `${placeName} refreshed` });
      } else {
        addToast({ variant: "warning", title: `Refresh issue: ${result.error}` });
      }
      fetchStale();
    } catch (err) {
      addToast({ variant: "error", title: "Refresh failed", description: err.message });
    } finally {
      if (mountedRef.current) setActionLoading((prev) => { const next = new Set(prev); next.delete(placeId); return next; });
    }
  }, [addToast, fetchStale]);

  const handleBulkDeactivate = useCallback(async () => {
    if (selectedIds.size === 0) return;
    try {
      const { data: result, error } = await supabase.rpc("admin_bulk_deactivate_places", {
        p_place_ids: Array.from(selectedIds),
        p_reason: "Bulk stale deactivation from admin review",
      });
      if (error) throw error;
      addToast({ variant: "success", title: `${result.places_deactivated} places deactivated` });
      await logAdminAction("place.stale_bulk_deactivate", "place_pool", null, { count: result.places_deactivated });
      setSelectedIds(new Set());
      fetchStale();
    } catch (err) {
      addToast({ variant: "error", title: "Bulk deactivation failed", description: err.message });
    }
  }, [selectedIds, addToast, fetchStale]);

  const handleTriggerBatchRefresh = useCallback(async (mode) => {
    setRefreshingAll(true);
    try {
      // Step 1: create backfill log entry via RPC
      const { data: triggerResult, error: triggerErr } = await supabase.rpc("admin_trigger_place_refresh", {
        p_mode: mode,
      });
      if (triggerErr) throw triggerErr;
      if (triggerResult?.status === "already_running") {
        addToast({ variant: "warning", title: "A refresh is already running" });
        return;
      }
      if (triggerResult?.status === "nothing_to_do") {
        addToast({ variant: "info", title: "No stale places to refresh" });
        return;
      }

      addToast({ variant: "info", title: `Refresh queued: ${triggerResult.total_places} places (~$${triggerResult.estimated_cost_usd})` });

      // Step 2: execute the refresh via edge function
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { addToast({ variant: "error", title: "Not authenticated." }); return; }

      const response = await fetch(ADMIN_REFRESH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: "process" }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Refresh execution failed");

      addToast({ variant: "success", title: `Refresh done: ${result.refreshed} refreshed, ${result.failed} failed` });
      await logAdminAction("place.batch_refresh", "place_pool", null, { mode, ...result });
      fetchStale();
    } catch (err) {
      addToast({ variant: "error", title: "Batch refresh failed", description: err.message });
    } finally {
      if (mountedRef.current) setRefreshingAll(false);
    }
  }, [addToast, fetchStale]);

  const confirmReasonAction = useCallback(() => {
    if (!reasonModal) return;
    const { type, placeId, placeName } = reasonModal;
    setReasonModal(null);
    if (type === "deactivate") handleDeactivate(placeId, placeName, reasonText);
    else if (type === "reactivate") handleReactivate(placeId, placeName, reasonText);
    setReasonText("");
  }, [reasonModal, reasonText, handleDeactivate, handleReactivate]);

  const toggleRowSelect = useCallback((id) => {
    setSelectedIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }, []);

  // ─── Render ──────────────────────────────────────────────────────────

  const places = data?.places || [];
  const summary = data?.summary || {};
  const total = data?.total || 0;
  const paginationFrom = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const paginationTo = Math.min((page + 1) * PAGE_SIZE, total);

  function formatHours(hours) {
    if (hours == null) return "—";
    if (hours < 24) return `${Math.round(hours)}h`;
    const days = Math.round(hours / 24);
    return `${days}d`;
  }

  const staleColumns = useMemo(() => [
    {
      key: "_select", label: "", width: "40px",
      render: (_, row) => (
        <button onClick={() => toggleRowSelect(row.id)}
          className="w-5 h-5 rounded border border-[var(--gray-300)] flex items-center justify-center cursor-pointer hover:border-[var(--color-brand-500)] transition-colors"
          aria-label={selectedIds.has(row.id) ? "Deselect" : "Select"}>
          {selectedIds.has(row.id) && <Check className="w-3.5 h-3.5 text-[var(--color-brand-500)]" />}
        </button>
      ),
    },
    { key: "name", label: "Name", width: "180px", render: (val) => <span className="font-medium truncate">{val || "—"}</span> },
    {
      key: "staleness_tier", label: "Staleness", width: "100px",
      render: (val) => {
        const cfg = TIER_BADGE[val] || TIER_BADGE.stale;
        return <Badge variant={cfg.variant} dot>{cfg.label}</Badge>;
      },
    },
    {
      key: "hours_since_refresh", label: "Since Refresh", width: "100px",
      render: (val) => <span className="text-[var(--color-text-secondary)]">{formatHours(val)}</span>,
    },
    {
      key: "refresh_failures", label: "Failures", width: "70px",
      render: (val) => val > 0 ? <span className="text-[var(--color-error-600)] font-medium">{val}</span> : <span className="text-[var(--color-text-muted)]">0</span>,
    },
    {
      key: "is_active", label: "Serving", width: "80px",
      render: (val) => <Badge variant={val ? "success" : "error"} dot>{val ? "Active" : "Off"}</Badge>,
    },
    {
      key: "recently_served", label: "Served", width: "70px",
      render: (val) => val ? <span className="text-[var(--color-warning-600)] font-semibold">Yes</span> : <span className="text-[var(--color-text-muted)]">No</span>,
    },
    {
      key: "primary_type", label: "Type", width: "110px",
      render: (val) => val ? <Badge variant="outline">{val.replace(/_/g, " ")}</Badge> : <span className="text-[var(--color-text-muted)]">—</span>,
    },
    {
      key: "_actions", label: "Actions", width: "180px",
      render: (_, row) => (
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" icon={RefreshCw}
            loading={actionLoading.has(row.id)}
            onClick={() => handleRefreshSingle(row.id, row.name)}
            aria-label="Refresh this place" />
          {row.is_active ? (
            <Button size="sm" variant="ghost" icon={XCircle}
              loading={actionLoading.has(row.id)}
              onClick={() => { setReasonText(""); setReasonModal({ type: "deactivate", placeId: row.id, placeName: row.name }); }}
              aria-label="Deactivate this place" />
          ) : (
            <Button size="sm" variant="ghost" icon={CheckCircle}
              loading={actionLoading.has(row.id)}
              onClick={() => { setReasonText(""); setReasonModal({ type: "reactivate", placeId: row.id, placeName: row.name }); }}
              aria-label="Reactivate this place" />
          )}
        </div>
      ),
    },
  ], [selectedIds, actionLoading, toggleRowSelect, handleRefreshSingle]);

  return (
    <div className="space-y-5">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="text-center p-3 rounded-lg bg-[var(--color-background-secondary)]">
          <p className="text-2xl font-bold text-[var(--color-text-primary)]">{summary.total_stale ?? 0}</p>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1">Total Stale</p>
        </div>
        <div className="text-center p-3 rounded-lg bg-[var(--color-background-secondary)]">
          <p className="text-2xl font-bold text-[var(--color-warning-600)]">{summary.active_stale ?? 0}</p>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1">Active & Stale</p>
        </div>
        <div className="text-center p-3 rounded-lg bg-[var(--color-background-secondary)]">
          <p className="text-2xl font-bold text-[var(--color-error-600)]">{summary.critical_count ?? 0}</p>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1">Critical ({">"}30d)</p>
        </div>
        <div className="text-center p-3 rounded-lg bg-[var(--color-background-secondary)]">
          <p className="text-2xl font-bold text-[var(--color-brand-500)]">{summary.recently_served_stale ?? 0}</p>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1">Served & Stale</p>
        </div>
      </div>

      {/* Batch Actions */}
      <SectionCard title="Batch Actions" subtitle="Refresh stale places via Google Places API ($0.005 per call)">
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" size="sm" icon={RefreshCw} loading={refreshingAll}
            disabled={refreshingAll || (summary.recently_served_stale ?? 0) === 0}
            onClick={() => handleTriggerBatchRefresh("recently_served")}>
            Refresh Recently Served ({summary.recently_served_stale ?? 0})
          </Button>
          <Button variant="secondary" size="sm" icon={RefreshCw} loading={refreshingAll}
            disabled={refreshingAll || (summary.active_stale ?? 0) === 0}
            onClick={() => handleTriggerBatchRefresh("all_stale")}>
            Refresh All Stale ({summary.active_stale ?? 0})
          </Button>
          {selectedIds.size > 0 && (
            <Button variant="danger" size="sm" icon={EyeOff} onClick={handleBulkDeactivate}>
              Deactivate {selectedIds.size} Selected
            </Button>
          )}
        </div>
      </SectionCard>

      {/* Filters & Sort */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="flex items-center gap-1 flex-wrap">
          {STALE_FILTER_OPTIONS.map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={["px-3 py-1.5 text-xs font-medium rounded-full border cursor-pointer transition-all duration-150",
                filter === f.id
                  ? "bg-[var(--color-brand-500)] text-white border-[var(--color-brand-500)]"
                  : "bg-[var(--color-background-primary)] text-[var(--color-text-secondary)] border-[var(--gray-300)] hover:border-[var(--gray-400)]"
              ].join(" ")}>
              {f.label}
            </button>
          ))}
        </div>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}
          className="text-xs px-3 py-1.5 rounded-lg border bg-transparent"
          style={{ borderColor: "var(--color-border)", color: "var(--color-text-primary)", backgroundColor: "var(--color-background-primary)" }}>
          {STALE_SORT_OPTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>

      {/* Table */}
      <DataTable
        columns={staleColumns} rows={places} loading={loading}
        emptyIcon={ShieldAlert}
        emptyMessage={filter === "all" ? "No stale places detected. Everything looks fresh." : "No stale places match this filter."}
        striped
        pagination={{ page, pageSize: PAGE_SIZE, total, from: paginationFrom, to: paginationTo, onChange: setPage }}
      />

      {/* Reason Modal (deactivate/reactivate) */}
      <Modal open={!!reasonModal} onClose={() => setReasonModal(null)}
        title={reasonModal?.type === "deactivate" ? "Deactivate Place" : "Reactivate Place"}
        destructive={reasonModal?.type === "deactivate"} size="sm">
        <ModalBody>
          <p className="text-sm text-[var(--color-text-secondary)] mb-3">
            {reasonModal?.type === "deactivate"
              ? <>Deactivate <strong className="text-[var(--color-text-primary)]">{reasonModal?.placeName}</strong>? This removes it and its cards from circulation.</>
              : <>Reactivate <strong className="text-[var(--color-text-primary)]">{reasonModal?.placeName}</strong>? This restores it and its cards to circulation.</>
            }
          </p>
          <Input label="Reason (optional)" value={reasonText} onChange={(e) => setReasonText(e.target.value)}
            placeholder="e.g., Permanently closed, data quality issue, etc." />
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setReasonModal(null)}>Cancel</Button>
          <Button variant={reasonModal?.type === "deactivate" ? "danger" : "primary"} onClick={confirmReasonAction}>
            {reasonModal?.type === "deactivate" ? "Deactivate" : "Reactivate"}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

// ─── Pool Stats Sub-view ─────────────────────────────────────────────────────

function PoolStatsView() {
  const [loading, setLoading] = useState(true);
  const [totalActive, setTotalActive] = useState(0);
  const [totalInactive, setTotalInactive] = useState(0);
  const [avgRating, setAvgRating] = useState(0);
  const [lastAdded, setLastAdded] = useState(null);
  const [cityBreakdown, setCityBreakdown] = useState([]);
  const [typeBreakdown, setTypeBreakdown] = useState([]);
  const [tierDistribution, setTierDistribution] = useState({});
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function fetchStats() {
      setLoading(true);
      try {
        const { count: activeCount } = await supabase.from("place_pool").select("*", { count: "exact", head: true }).eq("is_active", true);
        const { count: inactiveCount } = await supabase.from("place_pool").select("*", { count: "exact", head: true }).eq("is_active", false);

        const BATCH_SIZE = 1000;
        const allPlaces = [];
        let offset = 0;
        let hasMore = true;
        while (hasMore) {
          const { data: batch } = await supabase.from("place_pool").select("address, types, primary_type, price_tier, rating, created_at").eq("is_active", true).range(offset, offset + BATCH_SIZE - 1);
          if (!mounted) return;
          const rows = batch || [];
          allPlaces.push(...rows);
          hasMore = rows.length === BATCH_SIZE;
          offset += BATCH_SIZE;
        }

        setTotalActive(activeCount || 0);
        setTotalInactive(inactiveCount || 0);

        const places = allPlaces;
        const rated = places.filter((p) => p.rating != null);
        const avg = rated.length > 0 ? rated.reduce((sum, p) => sum + p.rating, 0) / rated.length : 0;
        setAvgRating(avg);

        if (places.length > 0) {
          const sorted = [...places].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
          setLastAdded(sorted[0].created_at);
        }

        const cityMap = {};
        for (const p of places) {
          const { city, country } = parseCityCountry(p.address);
          const key = `${city}|||${country}`;
          if (!cityMap[key]) cityMap[key] = { city, country, count: 0, totalRating: 0, ratedCount: 0 };
          cityMap[key].count++;
          if (p.rating != null) { cityMap[key].totalRating += p.rating; cityMap[key].ratedCount++; }
        }
        const cities = Object.values(cityMap).map((c) => ({ ...c, avgRating: c.ratedCount > 0 ? c.totalRating / c.ratedCount : null })).sort((a, b) => b.count - a.count);
        setCityBreakdown(cities);

        const typeMap = {};
        for (const p of places) {
          const type = p.primary_type || "unknown";
          if (!typeMap[type]) typeMap[type] = { type, count: 0, totalRating: 0, ratedCount: 0, tiers: {} };
          typeMap[type].count++;
          if (p.rating != null) { typeMap[type].totalRating += p.rating; typeMap[type].ratedCount++; }
          if (p.price_tier) typeMap[type].tiers[p.price_tier] = (typeMap[type].tiers[p.price_tier] || 0) + 1;
        }
        const types = Object.values(typeMap).map((t) => ({ ...t, avgRating: t.ratedCount > 0 ? t.totalRating / t.ratedCount : null, topTier: Object.entries(t.tiers).sort((a, b) => b[1] - a[1])[0]?.[0] || "—" })).sort((a, b) => b.count - a.count).slice(0, 20);
        setTypeBreakdown(types);

        const tiers = { chill: 0, comfy: 0, bougie: 0, lavish: 0 };
        for (const p of places) {
          if (p.price_tier && tiers[p.price_tier] !== undefined) tiers[p.price_tier]++;
        }
        setTierDistribution(tiers);
      } catch (err) {
        console.error("Failed to fetch pool stats:", err.message);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchStats();
    return () => { mounted = false; };
  }, []);

  const distinctCities = cityBreakdown.length;
  const maxTierCount = Math.max(...Object.values(tierDistribution), 1);

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Spinner size="md" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <StatCard icon={Database} label="Total Places" value={totalActive.toLocaleString()} />
          {totalInactive > 0 && <p className="text-xs text-[var(--color-text-tertiary)] mt-1 ml-1">+ {totalInactive} inactive</p>}
        </div>
        <StatCard icon={MapPin} label="Cities Covered" value={distinctCities.toLocaleString()} />
        <StatCard icon={Star} label="Avg Rating" value={avgRating > 0 ? avgRating.toFixed(1) : "—"} />
        <StatCard icon={Zap} label="Last Added" value={lastAdded ? timeAgo(lastAdded) : "—"} />
      </div>

      <SectionCard title="Price Tier Distribution">
        <div className="space-y-3">
          {Object.entries(tierDistribution).map(([tier, count]) => (
            <div key={tier} className="flex items-center gap-3">
              <div className="w-16 text-sm font-medium text-[var(--color-text-primary)]">{tier}</div>
              <div className="flex-1 h-7 bg-[var(--gray-100)] rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${maxTierCount > 0 ? (count / maxTierCount) * 100 : 0}%`, backgroundColor: tier === "chill" ? "#22c55e" : tier === "comfy" ? "#3b82f6" : tier === "bougie" ? "#f97316" : "#f59e0b", minWidth: count > 0 ? 24 : 0 }} />
              </div>
              <div className="w-12 text-sm text-[var(--color-text-secondary)] text-right">{count}</div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="City Breakdown" noPadding>
        {cityBreakdown.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] bg-[var(--table-header-bg)] border-b border-[var(--table-border)]">City</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] bg-[var(--table-header-bg)] border-b border-[var(--table-border)]">Country</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] bg-[var(--table-header-bg)] border-b border-[var(--table-border)]">Places</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] bg-[var(--table-header-bg)] border-b border-[var(--table-border)]">Avg Rating</th>
                </tr>
              </thead>
              <tbody>
                {cityBreakdown.map((c, i) => (
                  <tr key={`${c.city}-${c.country}`} className={["border-b border-[var(--table-border)]", "hover:bg-[var(--table-row-hover)] transition-colors duration-150", i % 2 === 1 ? "bg-[var(--table-stripe)]" : ""].join(" ")}>
                    <td className="px-5 py-3 font-medium text-[var(--color-text-primary)]">{c.city}</td>
                    <td className="px-5 py-3 text-[var(--color-text-secondary)]">{c.country}</td>
                    <td className="px-5 py-3 text-right text-[var(--color-text-primary)]">{c.count}</td>
                    <td className="px-5 py-3 text-right text-[var(--color-text-secondary)]">{c.avgRating != null ? c.avgRating.toFixed(1) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-12 text-center text-sm text-[var(--color-text-tertiary)]">No data yet.</div>
        )}
      </SectionCard>

      <SectionCard title="Type Breakdown (Top 20)" noPadding>
        {typeBreakdown.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] bg-[var(--table-header-bg)] border-b border-[var(--table-border)]">Type</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] bg-[var(--table-header-bg)] border-b border-[var(--table-border)]">Count</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] bg-[var(--table-header-bg)] border-b border-[var(--table-border)]">Avg Rating</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] bg-[var(--table-header-bg)] border-b border-[var(--table-border)]">Top Tier</th>
                </tr>
              </thead>
              <tbody>
                {typeBreakdown.map((t, i) => (
                  <tr key={t.type} className={["border-b border-[var(--table-border)]", "hover:bg-[var(--table-row-hover)] transition-colors duration-150", i % 2 === 1 ? "bg-[var(--table-stripe)]" : ""].join(" ")}>
                    <td className="px-5 py-3 font-medium text-[var(--color-text-primary)]"><Badge variant="outline">{t.type.replace(/_/g, " ")}</Badge></td>
                    <td className="px-5 py-3 text-right text-[var(--color-text-primary)]">{t.count}</td>
                    <td className="px-5 py-3 text-right text-[var(--color-text-secondary)]">{t.avgRating != null ? t.avgRating.toFixed(1) : "—"}</td>
                    <td className="px-5 py-3 text-right">{t.topTier !== "—" ? <Badge variant={PRICE_TIER_VARIANT[t.topTier] || "default"}>{t.topTier}</Badge> : <span className="text-[var(--color-text-muted)]">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-12 text-center text-sm text-[var(--color-text-tertiary)]">No data yet.</div>
        )}
      </SectionCard>
    </div>
  );
}

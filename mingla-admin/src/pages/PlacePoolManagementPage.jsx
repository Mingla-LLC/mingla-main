/**
 * PLACE POOL MANAGEMENT PAGE (redesigned 2026-03-31)
 *
 * Pool data visible at any scope (global/country/city) without seeding city
 * registration. Seeding preserved as a sub-feature for registered cities.
 *
 * Uses new RPCs: admin_place_pool_overview, admin_place_country_overview,
 * admin_place_city_overview, admin_place_category_breakdown.
 *
 * Tabs: Overview, Browse Pool, Map View, [Seeding], Photo Management, Stale Review.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { MapContainer, TileLayer, CircleMarker, Circle, Rectangle, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import {
  Globe, Search, Camera, Clock, Plus, RefreshCw, Play, Pause,
  ChevronDown, ChevronRight, AlertTriangle, CheckCircle,
  Download, ImageOff, Eye, Edit3, DollarSign, Layers,
  Square, SkipForward, XCircle, Loader, RotateCcw, Zap, MinusCircle,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { extractFunctionError } from "../lib/edgeFunctionError";
import { useToast } from "../context/ToastContext";
import { Tabs } from "../components/ui/Tabs";
import { Button } from "../components/ui/Button";
import { SectionCard, StatCard, AlertCard } from "../components/ui/Card";
import { DataTable } from "../components/ui/Table";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { Input, Toggle } from "../components/ui/Input";
import { Badge } from "../components/ui/Badge";
import { Breadcrumbs } from "../components/ui/Breadcrumbs";
import { Spinner } from "../components/ui/Spinner";
import { CATEGORY_LABELS, CATEGORY_COLORS, ALL_CATEGORIES } from "../constants/categories";
// ORCH-0553 — SeedTab + RefreshTab extracted to shared seeding components.
// HARD_CAP_USD + formatCost + TILE_RADIUS_OPTIONS imported from shared lib so
// both this page and AIValidationPage tabs use a single source of truth.
import { SeedTab } from "../components/seeding/SeedTab";
import { RefreshTab } from "../components/seeding/RefreshTab";
import { HARD_CAP_USD, formatCost, TILE_RADIUS_OPTIONS } from "../lib/seedingFormat";

// ── Constants ────────────────────────────────────────────────────────────────

// Tabs are computed dynamically in the main page component based on registration state

// ORCH-0553 — TYPE_TO_CATEGORY + guessCategory moved to components/seeding/SeedTab.jsx
// (only consumer was SeedTab's ad-hoc search).
// HARD_CAP_USD + formatCost moved to lib/seedingFormat.js (shared with RefreshTab).

const PRICE_TIERS = ["chill", "comfy", "bougie", "lavish"];

// ── Helpers ──────────────────────────────────────────────────────────────────

function RecenterMap({ center, zoom }) {
  const map = useMap();
  useEffect(() => { if (center) map.setView(center, zoom); }, [center, zoom, map]);
  return null;
}

function formatCount(n) { return Number(n || 0).toLocaleString(); }

function pctColor(pct) {
  if (pct >= 80) return "success";
  if (pct >= 50) return "warning";
  return "error";
}

// ── Country code → emoji flag ────────────────────────────────────────────────

function countryFlag(code) {
  if (!code || code.length !== 2) return "🌍";
  return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

// ── CityPicker (shared navigation) ──────────────────────────────────────────

function CityPicker({ cities, scope, onScopeChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Group cities by country
  const grouped = {};
  for (const c of (cities || [])) {
    const key = c.country_code || "??";
    if (!grouped[key]) grouped[key] = { countryName: c.country_name, countryCode: key, cities: [] };
    grouped[key].cities.push(c);
  }
  const groups = Object.values(grouped).sort((a, b) => a.countryName.localeCompare(b.countryName));

  // Current label
  const selectedCity = scope.cityId ? cities.find((c) => c.city_id === scope.cityId) : null;
  const selectedCountryGroup = scope.countryCode ? groups.find((g) => g.countryCode === scope.countryCode) : null;
  const label = selectedCity
    ? `${countryFlag(selectedCity.country_code)} ${selectedCity.city_name}`
    : selectedCountryGroup
      ? `${countryFlag(selectedCountryGroup.countryCode)} ${selectedCountryGroup.countryName}`
      : "🌍 All Cities";

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] text-sm font-medium hover:border-[var(--color-brand-500)] transition-colors cursor-pointer">
        <span>{label}</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute z-[9999] top-full mt-1 left-0 w-72 max-h-96 overflow-y-auto bg-[var(--color-background-primary)] border border-[var(--gray-200)] rounded-lg shadow-lg">
          {/* All Cities */}
          <button onClick={() => { onScopeChange({ countryCode: null, cityId: null }); setOpen(false); }}
            className={`w-full text-left px-3 py-2 text-sm font-medium hover:bg-[var(--gray-100)] cursor-pointer ${!scope.countryCode && !scope.cityId ? "bg-[var(--color-brand-50)] text-[var(--color-brand-700)]" : ""}`}>
            🌍 All Cities
          </button>
          <div className="border-t border-[var(--gray-100)]" />

          {groups.map((group) => (
            <div key={group.countryCode}>
              {/* Country header (clickable) */}
              <button onClick={() => { onScopeChange({ countryCode: group.countryCode, cityId: null }); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-xs font-semibold uppercase tracking-wider hover:bg-[var(--gray-100)] cursor-pointer ${scope.countryCode === group.countryCode && !scope.cityId ? "bg-[var(--color-brand-50)] text-[var(--color-brand-700)]" : "text-[var(--color-text-tertiary)]"}`}>
                {countryFlag(group.countryCode)} {group.countryName}
              </button>
              {/* Cities */}
              {group.cities.map((c) => (
                <button key={c.city_id} onClick={() => { onScopeChange({ countryCode: group.countryCode, cityId: c.city_id }); setOpen(false); }}
                  className={`w-full text-left pl-7 pr-3 py-1.5 text-sm hover:bg-[var(--gray-100)] cursor-pointer flex justify-between ${scope.cityId === c.city_id ? "bg-[var(--color-brand-50)] text-[var(--color-brand-700)] font-medium" : ""}`}>
                  <span>{c.city_name}</span>
                  <span className="text-xs text-[var(--color-text-tertiary)]">{(c.is_servable_places || 0).toLocaleString()}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── OverviewTab ─────────────────────────────────────────────────────────────

function OverviewTab({ scope, onScopeChange, pickerCities }) {
  const selectedCountry = scope.countryCode;
  const selectedCity = scope.cityId;
  const onSelectCountry = (cc) => onScopeChange({ countryCode: cc, cityId: null });
  const onSelectCity = (cityId) => onScopeChange({ countryCode: scope.countryCode, cityId });

  // Resolve scope to text names for edge function filters
  const selectedCityObj = pickerCities?.find((c) => c.city_id === scope.cityId);
  const scopeCityName = selectedCityObj?.city_name || null;
  const scopeCountryName = selectedCityObj?.country_name || pickerCities?.find((c) => c.country_code === scope.countryCode)?.country_name || null;
  const { addToast } = useToast();
  const [data, setData] = useState(null);
  const [drilldownRows, setDrilldownRows] = useState([]);
  const [catBreakdown, setCatBreakdown] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);

  const fetchData = useCallback(() => {
    mountedRef.current = true;
    setLoading(true);
    setError(null);

    const params = {};
    if (selectedCity) params.p_city_id = selectedCity;
    if (selectedCountry) params.p_country_code = selectedCountry;

    const promises = [
      supabase.rpc("admin_place_pool_overview", params),
      supabase.rpc("admin_place_category_breakdown", params),
    ];

    if (!selectedCity) {
      if (selectedCountry) {
        promises.push(supabase.rpc("admin_place_city_overview", { p_country_code: selectedCountry }));
      } else {
        promises.push(supabase.rpc("admin_place_country_overview"));
      }
    }

    Promise.all(promises).then((results) => {
      if (!mountedRef.current) return;
      const [overviewRes, catRes, drillRes] = results;
      if (overviewRes.error) { setError(overviewRes.error.message); setLoading(false); return; }
      // DEBUG: log category breakdown response to diagnose empty table
      if (catRes.error) console.error("[OverviewTab] catBreakdown RPC error:", catRes.error);
      if (!catRes.data || catRes.data.length === 0) console.warn("[OverviewTab] catBreakdown empty. Full response:", JSON.stringify(catRes));
      const row = Array.isArray(overviewRes.data) ? overviewRes.data[0] : overviewRes.data;
      setData(row);
      setCatBreakdown(catRes.data || []);
      setDrilldownRows(drillRes?.data || []);
      setLoading(false);
    });
  }, [selectedCountry, selectedCity]);

  useEffect(() => {
    fetchData();
    return () => { mountedRef.current = false; };
  }, [fetchData]);

  // ORCH-0489: user-controlled MV refresh, replaces silently-failing pg_cron.
  // admin_refresh_place_pool_mv() returns jsonb { success, row_count, duration_ms }.
  // Expected RPC runtime: 30s–2min on the full 63k-row MV.
  const handleRefreshStats = useCallback(async () => {
    setRefreshing(true);
    try {
      const { data: result, error: rpcError } = await supabase.rpc("admin_refresh_place_pool_mv");
      if (rpcError) {
        const isAuthError = /not authorized/i.test(rpcError.message || "");
        addToast({
          variant: "error",
          title: isAuthError ? "Admin access required" : "Couldn't refresh stats",
          description: isAuthError
            ? "Only active admin users can refresh stats."
            : "The refresh didn't complete. It may still be running in the background.",
        });
        return;
      }
      const rowCount = (result?.row_count ?? 0).toLocaleString();
      const durationSec = ((result?.duration_ms ?? 0) / 1000).toFixed(1);
      addToast({
        variant: "success",
        title: "Stats refreshed",
        description: `${rowCount} places in ${durationSec}s`,
      });
      fetchData();
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, [addToast, fetchData]);

  if (loading) return <div className="text-center py-12 text-[var(--color-text-secondary)]">Loading pool data...</div>;
  if (error) return <div className="text-sm text-[var(--color-error-700)] bg-[var(--color-error-50)] p-3 rounded-lg">{error}</div>;
  if (!data) return <div className="text-center py-12 text-[var(--color-text-tertiary)]">No pool data available.</div>;

  const scopeLabel = selectedCity
    ? "City scope"
    : selectedCountry ? "Country scope" : "Global pool";

  const servablePct = data.active_places > 0 ? Math.round(((data.is_servable_places || data.is_servable_count || 0) / data.active_places) * 100) : 0;

  const isGlobal = !selectedCountry;
  const isCountryLevel = !!selectedCountry && !selectedCity;

  // Drill-down columns
  const countryDrillColumns = [
    { key: "country_name", label: "Country", sortable: true, render: (_, r) => (
      <button onClick={() => onSelectCountry(r.country_code)} className="text-[var(--color-brand-500)] hover:underline cursor-pointer font-medium text-left">
        {countryFlag(r.country_code)} {r.country_name}
      </button>
    )},
    { key: "is_servable_places", label: "Servable", sortable: true, render: (_, r) => (r.is_servable_places || 0).toLocaleString() },
    { key: "photo_pct", label: "Photo %", sortable: true, render: (_, r) => <Badge variant={pctColor(r.photo_pct || 0)}>{r.photo_pct || 0}%</Badge> },
    { key: "bounced_pct", label: "Bounced %", sortable: true, render: (_, r) => <Badge variant={pctColor(r.bounced_pct || 0)}>{r.bounced_pct || 0}%</Badge> },
    { key: "category_coverage", label: "Categories", sortable: true, render: (_, r) => `${r.category_coverage || 0}/13` },
    { key: "city_count", label: "Cities", sortable: true },
  ];

  const cityDrillColumns = [
    { key: "city_name", label: "City", sortable: true, render: (_, r) => (
      <button onClick={() => onSelectCity(r.city_id)} className="text-[var(--color-brand-500)] hover:underline cursor-pointer font-medium text-left">{r.city_name}</button>
    )},
    { key: "is_servable_places", label: "Servable", sortable: true, render: (_, r) => (r.is_servable_places || 0).toLocaleString() },
    { key: "photo_pct", label: "Photo %", sortable: true, render: (_, r) => <Badge variant={pctColor(r.photo_pct || 0)}>{r.photo_pct || 0}%</Badge> },
    { key: "bounced_pct", label: "Bounced %", sortable: true, render: (_, r) => <Badge variant={pctColor(r.bounced_pct || 0)}>{r.bounced_pct || 0}%</Badge> },
    { key: "category_coverage", label: "Categories", sortable: true, render: (_, r) => `${r.category_coverage || 0}/13` },
    { key: "avg_rating", label: "Avg Rating", sortable: true, render: (_, r) => r.avg_rating ? `★ ${r.avg_rating}` : "—" },
  ];

  const catColumns = [
    { key: "category", label: "Category", sortable: true, render: (_, r) => (
      <div className="flex items-center gap-2">
        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: CATEGORY_COLORS[r.category] || "#6b7280" }} />
        {CATEGORY_LABELS[r.category] || r.category || "Uncategorized"}
      </div>
    )},
    { key: "place_count", label: "Servable", sortable: true },
    { key: "photo_pct", label: "Photo %", sortable: true, render: (_, r) => <Badge variant={pctColor(r.photo_pct || 0)}>{r.photo_pct || 0}%</Badge> },
    { key: "avg_rating", label: "Avg Rating", sortable: true, render: (_, r) => r.avg_rating ? `★ ${r.avg_rating}` : "—" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-[var(--color-text-secondary)]">Showing {scopeLabel}</p>
        <Button
          size="sm"
          variant="secondary"
          icon={RotateCcw}
          loading={refreshing}
          onClick={handleRefreshStats}
          aria-label="Refresh admin stats now"
        >
          {refreshing ? "Refreshing…" : "Refresh stats"}
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <StatCard icon={Globe} label="Active Places" value={data.active_places} />
        <StatCard icon={Camera} label="Photo Coverage" value={`${data.photo_pct}%`}
          trend={data.photo_pct >= 80 ? "Good" : data.photo_pct >= 50 ? "Fair" : "Low"} trendUp={data.photo_pct >= 80} />
        <StatCard icon={Eye} label="Bouncer Judged" value={`${servablePct}%`}
          trend={`${data.bouncer_judged_count} of ${data.active_places}`} trendUp={servablePct >= 50} />
        <StatCard icon={Clock} label="Not Yet Bounced" value={data.bouncer_pending_count || 0}
          trend={data.bouncer_pending_count === 0 ? "All judged" : "Needs Bouncer pass"} trendUp={data.bouncer_pending_count === 0} />
      </div>

      {/* ORCH-0646: Bouncer summary (replaces "AI Validation Summary" — Bouncer is authoritative per ORCH-0640) */}
      {(data.bouncer_pending_count > 0 || data.bouncer_judged_count > 0) && (
        <SectionCard title="Bouncer Summary">
          <div className="grid grid-cols-4 gap-4">
            <StatCard label="Judged" value={data.bouncer_judged_count} />
            <StatCard label="Servable" value={data.is_servable_count} />
            <StatCard label="Excluded" value={data.bouncer_excluded_count} />
            <StatCard label="Not Yet Bounced" value={data.bouncer_pending_count} />
          </div>
        </SectionCard>
      )}

      {/* Drill-down tables */}
      {isGlobal && drilldownRows.length > 0 && (
        <SectionCard title="Country Breakdown" subtitle={`${drilldownRows.length} countries`}>
          <DataTable columns={countryDrillColumns} rows={drilldownRows} loading={false}
            emptyMessage="No countries found" emptyIcon={Layers} />
        </SectionCard>
      )}

      {isCountryLevel && drilldownRows.length > 0 && (
        <SectionCard title="City Breakdown" subtitle={`${drilldownRows.length} cities in ${selectedCountry}`}>
          <DataTable columns={cityDrillColumns} rows={drilldownRows} loading={false}
            emptyMessage="No cities found" emptyIcon={Layers} />
        </SectionCard>
      )}

      {/* Category breakdown */}
      <SectionCard title="Category Breakdown" subtitle={`${catBreakdown.length} categories`}>
        <DataTable columns={catColumns} rows={catBreakdown} loading={false}
          emptyMessage="No category data" emptyIcon={Layers} />
      </SectionCard>
    </div>
  );
}

// ── Place Detail Modal ──────────────────────────────────────────────────────

function PlaceDetailModal({ place, open, onClose, onSave }) {
  const { addToast } = useToast();
  // ORCH-0646: legacy AI-validation card state removed (was always null after ORCH-0640
  // ch08 archived card_pool). All dead-branch consumers removed. Bouncer is the
  // authoritative quality gate now; servability comes from place.is_servable directly.
  const [expandedPhoto, setExpandedPhoto] = useState(null);
  const [editForm, setEditForm] = useState({
    name: "", price_tiers: [], seeding_category: "", is_active: true,
    ai_categories: [],
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !place) return;
    setEditForm({
      name: place.name || "",
      price_tiers: place.price_tiers?.length ? place.price_tiers : (place.price_tier ? [place.price_tier] : []),
      seeding_category: place.seeding_category || "",
      is_active: place.is_active,
      ai_categories: place.ai_categories || [],
    });
  }, [open, place]);

  if (!place) return null;

  const photos = place.stored_photo_urls || [];
  const types = place.types || [];
  const aiCats = place.ai_categories || [];
  const hasConflict = place.seeding_category && aiCats.length > 0 && place.seeding_category !== aiCats[0];

  const bouncerStatusBadge = () => {
    if (place.is_servable === true) return <Badge variant="success">Servable</Badge>;
    if (place.is_servable === false) return <Badge variant="error">Excluded</Badge>;
    return <Badge variant="outline">Not Yet Bounced</Badge>;
  };

  const handleSave = async () => {
    setSaving(true);
    // Save basic fields via RPC (handles cascade to card_pool)
    const { error: rpcErr } = await supabase.rpc("admin_edit_place", {
      p_place_id: place.id,
      p_name: editForm.name || null,
      p_price_tier: editForm.price_tiers?.[0] || null,
      p_price_tiers: editForm.price_tiers || [],
      p_seeding_category: editForm.seeding_category || null,
      p_is_active: editForm.is_active,
    });
    if (rpcErr) { addToast({ variant: "error", title: "Save failed", description: rpcErr.message }); setSaving(false); return; }

    // ORCH-0640 ch08 + ORCH-0646: the servable-flag + validation-timestamp columns
    // were dropped in ch13 (see migration 20260425000004). Three related AI-era
    // columns (reason / primary_identity / confidence) STILL EXIST on place_pool
    // but the pipeline that populated them was archived — they are now stale-data
    // only. Only ai_categories is actively editable (admin-driven classification).
    // Bouncer is the authoritative quality gate going forward.
    const { error: aiErr } = await supabase.from("place_pool").update({
      ai_categories: editForm.ai_categories.length > 0 ? editForm.ai_categories : null,
    }).eq("id", place.id);
    if (aiErr) { addToast({ variant: "error", title: "AI fields save failed", description: aiErr.message }); setSaving(false); return; }

    addToast({ variant: "success", title: "Place updated" }); onClose(); if (onSave) onSave();
    setSaving(false);
  };

  const relativeTime = (dateStr) => {
    if (!dateStr) return "Never";
    const diff = Date.now() - new Date(dateStr).getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 30) return `${days} days ago`;
    return `${Math.floor(days / 30)} months ago`;
  };

  return (
    <Modal open={open} onClose={onClose} title={place.name || "Place Detail"} size="lg">
      <ModalBody>
        <div className="space-y-6">
          {/* Identity */}
          <div>
            <h4 className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2">Identity</h4>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div><span className="text-[var(--color-text-secondary)]">Name:</span> <span className="font-medium">{place.name}</span></div>
              <div><span className="text-[var(--color-text-secondary)]">Address:</span> {place.address || "—"}</div>
              <div><span className="text-[var(--color-text-secondary)]">City:</span> {place.city || "—"}</div>
              <div><span className="text-[var(--color-text-secondary)]">Country:</span> {place.country || "—"}</div>
              <div><span className="text-[var(--color-text-secondary)]">Lat/Lng:</span> {place.lat && place.lng ? `${place.lat}, ${place.lng}` : "—"}</div>
              {place.google_place_id && <div><span className="text-[var(--color-text-secondary)]">Google Place ID:</span> <span className="text-xs font-mono break-all">{place.google_place_id}</span></div>}
              {place.website && <div className="col-span-2"><span className="text-[var(--color-text-secondary)]">Website:</span> <a href={place.website} target="_blank" rel="noopener noreferrer" className="text-[var(--color-brand-500)] hover:underline">{place.website}</a></div>}
            </div>
          </div>

          {/* Photos */}
          <div>
            <h4 className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2">
              Photos {photos.length > 0 ? <Badge variant="default">{photos.length} photos</Badge> : <Badge variant="error">No photos</Badge>}
            </h4>
            {photos.length > 0 ? (
              <div className="flex gap-2 overflow-x-auto pb-2">
                {photos.map((url, i) => (
                  <img key={i} src={url} alt="" className="w-32 h-32 rounded-lg object-cover shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => setExpandedPhoto(url)} />
                ))}
              </div>
            ) : (
              <div className="text-sm text-[var(--color-text-tertiary)]">No stored photos</div>
            )}
            {expandedPhoto && (
              <div className="fixed inset-0 bg-black/80 flex items-center justify-center" style={{ zIndex: 9999 }}
                onClick={(e) => { if (e.target === e.currentTarget) setExpandedPhoto(null); }}>
                <button className="absolute top-4 right-4 text-white/70 hover:text-white text-3xl cursor-pointer" onClick={() => setExpandedPhoto(null)}>&times;</button>
                {photos.length > 1 && (
                  <button className="absolute left-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white text-4xl cursor-pointer px-2"
                    onClick={() => { const idx = photos.indexOf(expandedPhoto); setExpandedPhoto(photos[(idx - 1 + photos.length) % photos.length]); }}>&lsaquo;</button>
                )}
                <img src={expandedPhoto} alt="" className="max-w-[85vw] max-h-[85vh] rounded-lg object-contain" />
                {photos.length > 1 && (
                  <button className="absolute right-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white text-4xl cursor-pointer px-2"
                    onClick={() => { const idx = photos.indexOf(expandedPhoto); setExpandedPhoto(photos[(idx + 1) % photos.length]); }}>&rsaquo;</button>
                )}
                <div className="absolute bottom-4 text-white/60 text-sm">{photos.indexOf(expandedPhoto) + 1} / {photos.length}</div>
              </div>
            )}
          </div>

          {/* Classification */}
          <div>
            <h4 className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2">Classification</h4>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-[var(--color-text-secondary)]">Google Category:</span>
                {place.seeding_category ? (
                  <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full text-white" style={{ backgroundColor: CATEGORY_COLORS[place.seeding_category] }}>
                    {CATEGORY_LABELS[place.seeding_category] || place.seeding_category}
                  </span>
                ) : <Badge variant="error">None</Badge>}
              </div>
              {types.length > 0 && (
                <div>
                  <span className="text-[var(--color-text-secondary)]">Google Types:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {types.map((t, i) => <Badge key={i} variant={t === place.primary_type ? "brand" : "default"}>{t}</Badge>)}
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="text-[var(--color-text-secondary)]">AI Category:</span>
                {aiCats.length > 0 ? (
                  <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full text-white" style={{ backgroundColor: CATEGORY_COLORS[aiCats[0]] || "#6b7280" }}>
                    {CATEGORY_LABELS[aiCats[0]] || aiCats[0]}
                  </span>
                ) : <Badge variant="outline">Not validated</Badge>}
                {hasConflict && <Badge variant="warning">Conflict</Badge>}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[var(--color-text-secondary)]">Bouncer Status:</span> {bouncerStatusBadge()}
              </div>
              {place.is_servable === false && place.bouncer_reason && (
                <div><span className="text-[var(--color-text-secondary)]">Bouncer Reason:</span> <span className="text-[var(--color-error-600)]">{place.bouncer_reason}</span></div>
              )}
            </div>
          </div>

          {/* Quality */}
          <div>
            <h4 className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2">Quality</h4>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div><span className="text-[var(--color-text-secondary)]">Rating:</span> {place.rating ? `★ ${place.rating}` : "—"} {place.review_count > 0 && `(${place.review_count} reviews)`}</div>
              <div><span className="text-[var(--color-text-secondary)]">Price Tiers:</span> {(() => { const tiers = place.price_tiers?.length ? place.price_tiers : (place.price_tier ? [place.price_tier] : []); return tiers.length > 0 ? tiers.map((t) => <Badge key={t} variant="outline">{t}</Badge>) : "—"; })()}</div>
              <div><span className="text-[var(--color-text-secondary)]">Price Level:</span> {place.price_level || "—"}</div>
              {place.editorial_summary && <div className="col-span-2"><span className="text-[var(--color-text-secondary)]">Editorial:</span> {place.editorial_summary}</div>}
            </div>
          </div>

          {/* Data Freshness */}
          <div>
            <h4 className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2">Data Freshness</h4>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div><span className="text-[var(--color-text-secondary)]">First Fetched:</span> {place.first_fetched_at ? new Date(place.first_fetched_at).toLocaleDateString() : "—"}</div>
              <div><span className="text-[var(--color-text-secondary)]">Last Refreshed:</span> {place.last_detail_refresh ? `${new Date(place.last_detail_refresh).toLocaleDateString()} (${relativeTime(place.last_detail_refresh)})` : "Never"}</div>
              <div><span className="text-[var(--color-text-secondary)]">Refresh Failures:</span> {place.refresh_failures || 0}</div>
              <div><span className="text-[var(--color-text-secondary)]">Fetched Via:</span> {place.fetched_via || "—"}</div>
            </div>
          </div>

          {/* Edit Controls */}
          <div>
            <h4 className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2">Edit</h4>
            <div className="space-y-3">
              <Input label="Name" value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
              <div>
                <label className="text-xs text-[var(--color-text-secondary)]">Price Tiers (select all that apply)</label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {PRICE_TIERS.map((t) => (
                    <button key={t} type="button"
                      className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                        editForm.price_tiers.includes(t)
                          ? "bg-[var(--color-brand-500)] text-white border-transparent"
                          : "text-[var(--color-text-secondary)] border-[var(--gray-300)] bg-[var(--color-background-primary)] hover:border-[var(--color-brand-500)]"
                      }`}
                      onClick={() => setEditForm((f) => ({
                        ...f,
                        price_tiers: f.price_tiers.includes(t)
                          ? f.price_tiers.filter((x) => x !== t)
                          : [...f.price_tiers, t],
                      }))}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[var(--color-text-secondary)]">Seeding Category</label>
                  <select className="block mt-1 w-full rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm"
                    value={editForm.seeding_category} onChange={(e) => setEditForm((f) => ({ ...f, seeding_category: e.target.value }))}>
                    <option value="">None</option>
                    {ALL_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                  </select>
                </div>
              </div>
              <Toggle label="Active" checked={editForm.is_active} onChange={(val) => setEditForm((f) => ({ ...f, is_active: val }))} />
            </div>
          </div>

          {/* ORCH-0646: "AI Classification Override" block removed per D-3.
              Bouncer is the authoritative gate (I-BOUNCER-IS-QUALITY-GATE); admin
              does not override. AI Categories section below remains editable for
              admin-driven classification. */}
          <div>
            <h4 className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2">Categories</h4>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-[var(--color-text-secondary)]">AI Categories (select all that apply)</label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {ALL_CATEGORIES.map((c) => (
                    <button key={c} type="button"
                      className={`px-2 py-1 text-xs rounded-full border transition-colors ${
                        editForm.ai_categories.includes(c)
                          ? "text-white border-transparent"
                          : "text-[var(--color-text-secondary)] border-[var(--gray-300)] bg-[var(--color-background-primary)] hover:border-[var(--color-brand-500)]"
                      }`}
                      style={editForm.ai_categories.includes(c) ? { backgroundColor: CATEGORY_COLORS[c] || "#6b7280" } : {}}
                      onClick={() => setEditForm((f) => ({
                        ...f,
                        ai_categories: f.ai_categories.includes(c)
                          ? f.ai_categories.filter((x) => x !== c)
                          : [...f.ai_categories, c],
                      }))}>
                      {CATEGORY_LABELS[c] || c}
                    </button>
                  ))}
                </div>
              </div>
              {/* ORCH-0646: AI Reason Input removed — reason column dropped in ORCH-0640 ch13. */}
            </div>
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={saving} onClick={handleSave}>Save</Button>
      </ModalFooter>
    </Modal>
  );
}

// ── Add City Modal (Bounding Box Model) ─────────────────────────────────────

// ORCH-0553 — TILE_RADIUS_OPTIONS moved to lib/seedingFormat.js (shared import above).

function AddCityModal({ open, onClose, onSave }) {
  const [query, setQuery] = useState("");
  const [tileRadius, setTileRadius] = useState("1500");
  const [geocodeResult, setGeocodeResult] = useState(null);
  const [overlap, setOverlap] = useState([]);
  const [geocoding, setGeocoding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleGeocode = useCallback(async () => {
    if (!query.trim() || query.trim().length < 2) return;
    setGeocoding(true);
    setGeocodeResult(null);
    setOverlap([]);
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("admin-seed-places", {
        body: { action: "geocode_city", query: query.trim() },
      });
      if (fnErr) throw fnErr;
      if (data?.error) throw new Error(data.error);
      setGeocodeResult(data);

      // Check for overlap with existing cities
      const { data: overlapData } = await supabase.rpc("check_city_bbox_overlap", {
        p_sw_lat: data.viewport.swLat,
        p_sw_lng: data.viewport.swLng,
        p_ne_lat: data.viewport.neLat,
        p_ne_lng: data.viewport.neLng,
      });
      setOverlap(overlapData || []);
    } catch (err) {
      setError(err.message || "Geocoding failed");
    } finally {
      setGeocoding(false);
    }
  }, [query]);

  const isValid = geocodeResult && overlap.length === 0 && tileRadius;

  const handleSave = useCallback(async () => {
    if (!geocodeResult || !isValid) return;
    setSaving(true);
    const vp = geocodeResult.viewport;
    const tileRadiusNum = parseInt(tileRadius);

    try {
      const { data: city, error: insertErr } = await supabase.from("seeding_cities").insert({
        google_place_id: `geocoded_${geocodeResult.center.lat}_${geocodeResult.center.lng}`,
        name: geocodeResult.cityName,
        country: geocodeResult.country,
        country_code: geocodeResult.countryCode,
        center_lat: geocodeResult.center.lat,
        center_lng: geocodeResult.center.lng,
        bbox_sw_lat: vp.swLat,
        bbox_sw_lng: vp.swLng,
        bbox_ne_lat: vp.neLat,
        bbox_ne_lng: vp.neLng,
        coverage_radius_km: 0,
        tile_radius_m: tileRadiusNum,
      }).select().single();
      if (insertErr) throw insertErr;

      // Auto-generate tiles from bounding box
      await supabase.functions.invoke("admin-seed-places", {
        body: { action: "generate_tiles", cityId: city.id },
      });

      onSave(city);
      onClose();
      setQuery("");
      setGeocodeResult(null);
      setOverlap([]);
      setTileRadius("1500");
      setError(null);
    } catch (err) {
      const msg = (err.message || "").toLowerCase();
      if (msg.includes("duplicate") || msg.includes("unique")) {
        setError("This city already exists. Select it from the dropdown instead.");
      } else {
        setError(err.message);
      }
    } finally {
      setSaving(false);
    }
  }, [geocodeResult, isValid, tileRadius, onSave, onClose]);

  // Get tile estimate for selected radius
  const selectedEstimate = geocodeResult?.tileEstimates?.[`atRadius${tileRadius}`] || null;

  return (
    <Modal open={open} onClose={onClose} title="Add City" size="md">
      <ModalBody>
        <div className="space-y-4">
          {/* City search */}
          <div className="flex gap-2">
            <div className="flex-1">
              <Input label="City Name" placeholder="e.g. Raleigh, NC" value={query}
                onChange={(e) => { setQuery(e.target.value); setGeocodeResult(null); setOverlap([]); setError(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") handleGeocode(); }}
              />
            </div>
            <div className="pt-6">
              <Button variant="secondary" icon={Search} loading={geocoding} onClick={handleGeocode}
                disabled={!query.trim() || query.trim().length < 2}>
                Search
              </Button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 text-sm text-[var(--color-error-700)] bg-[var(--color-error-50)] rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Geocode result */}
          {geocodeResult && (
            <div className="space-y-4">
              <div className="rounded-lg border border-[var(--gray-200)] p-3 space-y-1">
                <p className="text-sm font-semibold text-[var(--color-text-primary)]">{geocodeResult.cityName}</p>
                <p className="text-xs text-[var(--color-text-secondary)]">{geocodeResult.formattedAddress}</p>
                <p className="text-xs text-[var(--color-text-tertiary)]">
                  Country: {geocodeResult.country} ({geocodeResult.countryCode}) · {geocodeResult.tileEstimates.extentLatKm} km × {geocodeResult.tileEstimates.extentLngKm} km · ~{geocodeResult.tileEstimates.areaKm2.toLocaleString()} km²
                </p>
              </div>

              {/* Overlap warning */}
              {overlap.length > 0 && (
                <div className="flex items-start gap-2 text-sm text-[var(--color-warning-700)] bg-[var(--color-warning-50)] rounded-lg p-3">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>Overlaps with: {overlap.map((c) => `${c.name} (${c.country})`).join(", ")}. Cannot register duplicate city.</span>
                </div>
              )}

              {/* Tile radius picker */}
              <div>
                <p className="text-xs font-medium text-[var(--color-text-secondary)] mb-2">Tile Radius (search granularity)</p>
                <div className="flex gap-2">
                  {TILE_RADIUS_OPTIONS.map((opt) => {
                    const est = geocodeResult.tileEstimates[`atRadius${opt.value}`];
                    const active = tileRadius === opt.value;
                    return (
                      <button key={opt.value} onClick={() => setTileRadius(opt.value)}
                        className={[
                          "flex-1 rounded-lg border p-2.5 text-left transition-all cursor-pointer",
                          active
                            ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] ring-1 ring-[var(--color-brand-500)]"
                            : "border-[var(--gray-200)] hover:border-[var(--gray-300)]",
                        ].join(" ")}
                      >
                        <p className={`text-sm font-semibold ${active ? "text-[var(--color-brand-700)]" : "text-[var(--color-text-primary)]"}`}>{opt.label}</p>
                        <p className="text-xs text-[var(--color-text-tertiary)]">{opt.desc}</p>
                        {est && (
                          <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
                            {est.tiles} tiles · ${est.searchCostUsd}
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Selected estimate summary */}
              {selectedEstimate && (
                <div className="text-xs text-[var(--color-text-secondary)] bg-[var(--gray-50)] rounded-lg p-2.5">
                  {selectedEstimate.tiles} tiles × 13 categories = {selectedEstimate.apiCalls.toLocaleString()} API calls · Estimated search cost: ${selectedEstimate.searchCostUsd}
                </div>
              )}
            </div>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={saving} onClick={handleSave} disabled={!isValid}>
          Save & Generate Tiles
        </Button>
      </ModalFooter>
    </Modal>
  );
}

// ── Update City Modal (Re-geocode existing city) ──────────────────────────────

function UpdateCityModal({ open, onClose, city, onUpdated }) {
  const [query, setQuery] = useState("");
  const [tileRadius, setTileRadius] = useState("1500");
  const [geocodeResult, setGeocodeResult] = useState(null);
  const [overlap, setOverlap] = useState([]);
  const [geocoding, setGeocoding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Pre-fill when modal opens or city changes
  useEffect(() => {
    if (open && city) {
      setQuery(city.name || "");
      setTileRadius(String(city.tile_radius_m || 1500));
      setGeocodeResult(null);
      setOverlap([]);
      setError(null);
    }
  }, [open, city]);

  const handleGeocode = useCallback(async () => {
    if (!query.trim() || query.trim().length < 2) return;
    setGeocoding(true);
    setGeocodeResult(null);
    setOverlap([]);
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("admin-seed-places", {
        body: { action: "geocode_city", query: query.trim() },
      });
      if (fnErr) throw fnErr;
      if (data?.error) throw new Error(data.error);
      setGeocodeResult(data);

      // Check overlap — exclude THIS city (the key difference from AddCityModal)
      const { data: overlapData } = await supabase.rpc("check_city_bbox_overlap", {
        p_sw_lat: data.viewport.swLat,
        p_sw_lng: data.viewport.swLng,
        p_ne_lat: data.viewport.neLat,
        p_ne_lng: data.viewport.neLng,
        p_exclude_id: city.id,
      });
      setOverlap(overlapData || []);
    } catch (err) {
      setError(err.message || "Geocoding failed");
    } finally {
      setGeocoding(false);
    }
  }, [query, city]);

  // Overlap is informational for updates — neighboring cities may legitimately overlap
  const isValid = geocodeResult && tileRadius;

  const handleSave = useCallback(async () => {
    if (!geocodeResult || !isValid || !city) return;
    setSaving(true);
    const vp = geocodeResult.viewport;
    const tileRadiusNum = parseInt(tileRadius);

    try {
      // UPDATE existing city record (not INSERT)
      const { error: updateErr } = await supabase.from("seeding_cities").update({
        google_place_id: `geocoded_${geocodeResult.center.lat}_${geocodeResult.center.lng}`,
        name: geocodeResult.cityName,
        country: geocodeResult.country,
        country_code: geocodeResult.countryCode,
        center_lat: geocodeResult.center.lat,
        center_lng: geocodeResult.center.lng,
        bbox_sw_lat: vp.swLat,
        bbox_sw_lng: vp.swLng,
        bbox_ne_lat: vp.neLat,
        bbox_ne_lng: vp.neLng,
        coverage_radius_km: 0,
        tile_radius_m: tileRadiusNum,
        updated_at: new Date().toISOString(),
      }).eq("id", city.id);
      if (updateErr) throw updateErr;

      // Regenerate tiles with new bbox + radius
      const { data: tileResult, error: tileErr } = await supabase.functions.invoke("admin-seed-places", {
        body: { action: "generate_tiles", cityId: city.id },
      });
      if (tileErr) throw tileErr;
      if (tileResult?.error) throw new Error(tileResult.error);

      onUpdated(tileResult?.tileCount || 0);
      onClose();
    } catch (err) {
      setError(err.message || "Update failed");
    } finally {
      setSaving(false);
    }
  }, [geocodeResult, isValid, tileRadius, city, onUpdated, onClose]);

  const selectedEstimate = geocodeResult?.tileEstimates?.[`atRadius${tileRadius}`] || null;

  if (!city) return null;

  return (
    <Modal open={open} onClose={onClose} title={`Update City — ${city.name}`} size="md">
      <ModalBody>
        <div className="space-y-4">
          {/* City search (pre-filled) */}
          <div className="flex gap-2">
            <div className="flex-1">
              <Input label="City Name" placeholder="e.g. Raleigh, NC" value={query}
                onChange={(e) => { setQuery(e.target.value); setGeocodeResult(null); setOverlap([]); setError(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") handleGeocode(); }}
              />
            </div>
            <div className="pt-6">
              <Button variant="secondary" icon={Search} loading={geocoding} onClick={handleGeocode}
                disabled={!query.trim() || query.trim().length < 2}>
                Re-geocode
              </Button>
            </div>
          </div>

          {/* Current bbox info */}
          {!geocodeResult && city.bbox_sw_lat && (
            <div className="rounded-lg border border-[var(--gray-200)] p-3 space-y-1 bg-[var(--gray-50)]">
              <p className="text-xs font-medium text-[var(--color-text-secondary)]">Current bounding box</p>
              <p className="text-xs text-[var(--color-text-tertiary)]">
                {((city.bbox_ne_lat - city.bbox_sw_lat) * 111.32).toFixed(1)}km × {((city.bbox_ne_lng - city.bbox_sw_lng) * 111.32 * Math.cos((city.center_lat * Math.PI) / 180)).toFixed(1)}km · {city.tile_radius_m}m tiles
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 text-sm text-[var(--color-error-700)] bg-[var(--color-error-50)] rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Geocode result */}
          {geocodeResult && (
            <div className="space-y-4">
              <div className="rounded-lg border border-[var(--gray-200)] p-3 space-y-1">
                <p className="text-sm font-semibold text-[var(--color-text-primary)]">{geocodeResult.cityName}</p>
                <p className="text-xs text-[var(--color-text-secondary)]">{geocodeResult.formattedAddress}</p>
                <p className="text-xs text-[var(--color-text-tertiary)]">
                  Country: {geocodeResult.country} ({geocodeResult.countryCode}) · {geocodeResult.tileEstimates.extentLatKm} km × {geocodeResult.tileEstimates.extentLngKm} km · ~{geocodeResult.tileEstimates.areaKm2.toLocaleString()} km²
                </p>
              </div>

              {/* Overlap notice (informational — does not block save for updates) */}
              {overlap.length > 0 && (
                <div className="flex items-start gap-2 text-sm text-[var(--color-text-secondary)] bg-[var(--gray-50)] rounded-lg p-3">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-[var(--color-warning-500)]" />
                  <span>Bbox overlaps with: {overlap.map((c) => `${c.name} (${c.country})`).join(", ")}. This is normal for neighboring cities.</span>
                </div>
              )}

              {/* Tile radius picker */}
              <div>
                <p className="text-xs font-medium text-[var(--color-text-secondary)] mb-2">Tile Radius (search granularity)</p>
                <div className="flex gap-2">
                  {TILE_RADIUS_OPTIONS.map((opt) => {
                    const est = geocodeResult.tileEstimates[`atRadius${opt.value}`];
                    const active = tileRadius === opt.value;
                    return (
                      <button key={opt.value} onClick={() => setTileRadius(opt.value)}
                        className={[
                          "flex-1 rounded-lg border p-2.5 text-left transition-all cursor-pointer",
                          active
                            ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] ring-1 ring-[var(--color-brand-500)]"
                            : "border-[var(--gray-200)] hover:border-[var(--gray-300)]",
                        ].join(" ")}
                      >
                        <p className={`text-sm font-semibold ${active ? "text-[var(--color-brand-700)]" : "text-[var(--color-text-primary)]"}`}>{opt.label}</p>
                        <p className="text-xs text-[var(--color-text-tertiary)]">{opt.desc}</p>
                        {est && (
                          <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
                            {est.tiles} tiles · ${est.searchCostUsd}
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {selectedEstimate && (
                <div className="text-xs text-[var(--color-text-secondary)] bg-[var(--gray-50)] rounded-lg p-2.5">
                  {selectedEstimate.tiles} tiles × 13 categories = {selectedEstimate.apiCalls.toLocaleString()} API calls · Estimated search cost: ${selectedEstimate.searchCostUsd}
                </div>
              )}
            </div>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={saving} onClick={handleSave} disabled={!isValid}>
          Update & Regenerate Tiles
        </Button>
      </ModalFooter>
    </Modal>
  );
}

// ── Tab 1: Seed & Import ─────────────────────────────────────────────────────

// ORCH-0553 — function SeedTab(...) MOVED to components/seeding/SeedTab.jsx (~838 lines).
// Imported at top of this file. Behavior unchanged.

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

function MapTab({ scope, registeredCity, tiles, seedingOps }) {
  const selectedCountry = scope?.countryCode;
  const selectedCity = scope?.cityId;
  const [visibleCats, setVisibleCats] = useState(new Set(ALL_CATEGORIES));
  const [places, setPlaces] = useState([]);
  const [mapLoading, setMapLoading] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (!selectedCity) { setPlaces([]); return; }
    setMapLoading(true);
    let q = supabase.from("place_pool")
      .select("id, name, lat, lng, rating, ai_categories, seeding_category, is_active, stored_photo_urls, is_servable")
      .eq("is_active", true)
      .eq("is_servable", true)
      .eq("city_id", selectedCity);
    q.limit(3000).then(({ data }) => {
      if (mountedRef.current) { setPlaces(data || []); setMapLoading(false); }
    });
    return () => { mountedRef.current = false; };
  }, [selectedCountry, selectedCity]);

  if (!selectedCity) return <div className="text-center py-12 text-[var(--color-text-secondary)]">Select a city from the picker above to view the map.</div>;
  if (mapLoading) return <div className="text-center py-12 text-[var(--color-text-secondary)]">Loading map data...</div>;
  if (places.length === 0) return <div className="text-center py-12 text-[var(--color-text-secondary)]">No places found to display.</div>;

  // Compute center from places average
  const validPlaces = places.filter((p) => p.lat && p.lng);
  const center = registeredCity
    ? [registeredCity.center_lat, registeredCity.center_lng]
    : validPlaces.length > 0
      ? [validPlaces.reduce((s, p) => s + p.lat, 0) / validPlaces.length, validPlaces.reduce((s, p) => s + p.lng, 0) / validPlaces.length]
      : [0, 0];

  const filteredPlaces = places.filter((p) => visibleCats.has(p.ai_categories?.[0] || p.seeding_category));
  const showTiles = registeredCity && tiles.length > 0;

  // Pre-compute tile data if registered
  const tileData = showTiles ? tiles.map((t) => {
    const nearbyPlaces = places.filter((p) => {
      const dLat = (p.lat - t.center_lat) * 111320;
      const dLng = (p.lng - t.center_lng) * 111320 * Math.cos((t.center_lat * Math.PI) / 180);
      return Math.sqrt(dLat * dLat + dLng * dLng) <= t.radius_m;
    });
    const status = getTileStatus(t, seedingOps || [], nearbyPlaces);
    const hasGap = nearbyPlaces.length > 0 && nearbyPlaces.length < 5;
    return { ...t, status, nearbyCount: nearbyPlaces.length, hasGap };
  }) : [];

  return (
    <div className="space-y-4">
      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-[var(--color-text-secondary)]">
        {showTiles && <>
          <span><span className="inline-block w-3 h-3 rounded-full bg-[#9ca3af] mr-1" />Unseeded</span>
          <span><span className="inline-block w-3 h-3 rounded-full bg-[#60a5fa] mr-1" />Partial</span>
          <span><span className="inline-block w-3 h-3 rounded-full bg-[#22c55e] mr-1" />Fully Seeded</span>
          <span><span className="inline-block w-3 h-3 rounded-full border-2 border-[#ef4444] mr-1" />Errors</span>
          <span><span className="inline-block w-3 h-3 rounded-full border-2 border-[#f59e0b] mr-1" />Coverage Gap (&lt;5 places)</span>
        </>}
        <span className="ml-auto">{places.length} places</span>
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
        <MapContainer center={center} zoom={selectedCity ? 12 : 8} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
          <RecenterMap center={center} zoom={selectedCity ? 12 : 8} />
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; OpenStreetMap contributors' />

          {/* City boundary (registered cities only) — bbox rectangle for new model, circle fallback for legacy */}
          {registeredCity && registeredCity.bbox_sw_lat && registeredCity.bbox_ne_lat ? (
            <Rectangle bounds={[[registeredCity.bbox_sw_lat, registeredCity.bbox_sw_lng], [registeredCity.bbox_ne_lat, registeredCity.bbox_ne_lng]]}
              pathOptions={{ color: "#6b7280", dashArray: "8 4", fillOpacity: 0.03, weight: 2 }} />
          ) : registeredCity && registeredCity.coverage_radius_km > 0 ? (
            <Circle center={[registeredCity.center_lat, registeredCity.center_lng]} radius={registeredCity.coverage_radius_km * 1000}
              pathOptions={{ color: "#6b7280", dashArray: "8 4", fillOpacity: 0.03, weight: 2 }} />
          ) : null}

          {/* Tile circles with status coloring (registered cities only) */}
          {tileData.map((t) => (
            <Circle key={t.id} center={[t.center_lat, t.center_lng]} radius={t.radius_m}
              pathOptions={TILE_STATUS_STYLES[t.status] || TILE_STATUS_STYLES.unseeded}>
              <Popup><div className="text-xs">Tile #{t.tile_index} · {t.nearbyCount} places · {t.status}</div></Popup>
            </Circle>
          ))}

          {/* Coverage gap warning circles */}
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

function BrowseTab({ scope, onRefresh }) {
  const selectedCountry = scope?.countryCode;
  const selectedCity = scope?.cityId;
  const { addToast } = useToast();
  const [places, setPlaces] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ category: "", status: "active", photoStatus: "", priceTier: "", priceLevel: "", minRating: "", servableStatus: "", nameSearch: "" });
  const [detailPlace, setDetailPlace] = useState(null);
  const PAGE_SIZE = 20;

  const fetchPlaces = useCallback(async () => {
    setLoading(true);

    // For country scope, load city IDs first then filter
    let countryCityIds = null;
    if (selectedCountry && !selectedCity) {
      const { data: cityRows } = await supabase.from("seeding_cities").select("id").eq("country_code", selectedCountry);
      countryCityIds = (cityRows || []).map((r) => r.id);
    }

    let q = supabase.from("place_pool").select("*", { count: "exact" });
    if (selectedCity) q = q.eq("city_id", selectedCity);
    else if (countryCityIds && countryCityIds.length > 0) q = q.in("city_id", countryCityIds);
    if (filters.category) q = q.contains("ai_categories", [filters.category]);
    if (filters.status === "active") q = q.eq("is_active", true);
    else if (filters.status === "inactive") q = q.eq("is_active", false);
    if (filters.photoStatus === "has") q = q.not("stored_photo_urls", "is", null);
    else if (filters.photoStatus === "missing") q = q.or("stored_photo_urls.is.null,stored_photo_urls.eq.{}");
    if (filters.priceTier === "missing") q = q.or("price_tiers.is.null,price_tiers.eq.{}");
    else if (filters.priceTier) q = q.contains("price_tiers", [filters.priceTier]);
    if (filters.priceLevel === "missing") q = q.is("price_level", null);
    else if (filters.priceLevel) q = q.eq("price_level", filters.priceLevel);
    if (filters.minRating) q = q.gte("rating", parseFloat(filters.minRating));
    if (filters.servableStatus === "servable") q = q.eq("is_servable", true);
    else if (filters.servableStatus === "excluded") q = q.eq("is_servable", false);
    else if (filters.servableStatus === "not_bounced") q = q.is("is_servable", null);
    if (filters.nameSearch) q = q.ilike("name", `%${filters.nameSearch}%`);
    q = q.order("created_at", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    const { data, count, error } = await q;
    if (error) { addToast({ variant: "error", title: "Failed to load places", description: error.message }); }
    else { setPlaces(data || []); setTotal(count || 0); }
    setLoading(false);
  }, [selectedCountry, selectedCity, filters, page, addToast]);

  useEffect(() => { fetchPlaces(); }, [fetchPlaces]);
  useEffect(() => { setPage(0); }, [selectedCountry, selectedCity]);

  const relativeTime = (dateStr) => {
    if (!dateStr) return "—";
    const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
    if (days === 0) return "Today";
    if (days < 30) return `${days}d ago`;
    return `${Math.floor(days / 30)}mo ago`;
  };

  const columns = [
    { key: "name", label: "Name", sortable: true, render: (_, r) => <button className="text-[var(--color-brand-500)] hover:underline cursor-pointer text-left" onClick={() => setDetailPlace(r)}>{r.name}</button> },
    { key: "ai_categories", label: "Category", render: (_, r) => {
      const cats = r.ai_categories || [];
      if (cats.length === 0) return r.seeding_category ? <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full text-white/70" style={{ backgroundColor: CATEGORY_COLORS[r.seeding_category] }}>{CATEGORY_LABELS[r.seeding_category]} <span className="ml-1 opacity-60">(seed)</span></span> : "—";
      return <div className="flex flex-wrap gap-1">{cats.map((c) => <span key={c} className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full text-white" style={{ backgroundColor: CATEGORY_COLORS[c] || "#6b7280" }}>{CATEGORY_LABELS[c] || c}</span>)}</div>;
    }},
    { key: "address", label: "Address", render: (_, r) => <span className="text-xs max-w-[160px] truncate block">{r.address || "—"}</span> },
    { key: "rating", label: "Rating", sortable: true, render: (_, r) => r.rating ? `★ ${r.rating}` : "—" },
    { key: "review_count", label: "Reviews", sortable: true, render: (_, r) => r.review_count || "—" },
    { key: "price_tiers", label: "Price", render: (_, r) => {
      const tiers = r.price_tiers?.length ? r.price_tiers : (r.price_tier ? [r.price_tier] : []);
      return tiers.length > 0 ? <div className="flex gap-0.5">{tiers.map((t) => <Badge key={t} variant="outline">{t}</Badge>)}</div> : "—";
    }},
    { key: "photos", label: "Photos", render: (_, r) => {
      const n = r.stored_photo_urls?.length || 0;
      return <Badge variant={n > 0 ? "success" : "error"}>{n}</Badge>;
    }},
    { key: "is_servable", label: "Bouncer Status", render: (_, r) => {
      if (r.is_servable === true) return <Badge variant="success">Servable</Badge>;
      if (r.is_servable === false) return <Badge variant="error">Excluded</Badge>;
      return <Badge variant="outline">Not Yet Bounced</Badge>;
    }},
    { key: "last_detail_refresh", label: "Refreshed", render: (_, r) => relativeTime(r.last_detail_refresh) },
    { key: "is_active", label: "Status", render: (_, r) => <Badge variant={r.is_active ? "success" : "error"}>{r.is_active ? "Active" : "Inactive"}</Badge> },
    { key: "actions", label: "", render: (_, r) => <Button size="sm" variant="ghost" icon={Edit3} onClick={() => setDetailPlace(r)} /> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <label className="text-xs text-[var(--color-text-secondary)]">Category</label>
          <select className="block mt-1 rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm"
            value={filters.category} onChange={(e) => { setFilters((f) => ({ ...f, category: e.target.value })); setPage(0); }}>
            <option value="">All</option>
            {ALL_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-[var(--color-text-secondary)]">Status</label>
          <select className="block mt-1 rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm"
            value={filters.status} onChange={(e) => { setFilters((f) => ({ ...f, status: e.target.value })); setPage(0); }}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-[var(--color-text-secondary)]">Photos</label>
          <select className="block mt-1 rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm"
            value={filters.photoStatus} onChange={(e) => { setFilters((f) => ({ ...f, photoStatus: e.target.value })); setPage(0); }}>
            <option value="">All</option>
            <option value="has">Has Photos</option>
            <option value="missing">Missing Photos</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-[var(--color-text-secondary)]">Bouncer Status</label>
          <select className="block mt-1 rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm"
            value={filters.servableStatus} onChange={(e) => { setFilters((f) => ({ ...f, servableStatus: e.target.value })); setPage(0); }}>
            <option value="">All</option>
            <option value="servable">Servable</option>
            <option value="excluded">Excluded</option>
            <option value="not_bounced">Not Yet Bounced</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-[var(--color-text-secondary)]">Price Tier</label>
          <select className="block mt-1 rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm"
            value={filters.priceTier} onChange={(e) => { setFilters((f) => ({ ...f, priceTier: e.target.value })); setPage(0); }}>
            <option value="">All</option>
            <option value="missing">Missing</option>
            {PRICE_TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-[var(--color-text-secondary)]">Price Level</label>
          <select className="block mt-1 rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm"
            value={filters.priceLevel} onChange={(e) => { setFilters((f) => ({ ...f, priceLevel: e.target.value })); setPage(0); }}>
            <option value="">All</option>
            <option value="missing">Missing</option>
            <option value="PRICE_LEVEL_FREE">Free</option>
            <option value="PRICE_LEVEL_INEXPENSIVE">Inexpensive</option>
            <option value="PRICE_LEVEL_MODERATE">Moderate</option>
            <option value="PRICE_LEVEL_EXPENSIVE">Expensive</option>
            <option value="PRICE_LEVEL_VERY_EXPENSIVE">Very Expensive</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-[var(--color-text-secondary)]">Min Rating</label>
          <input type="number" min="0" max="5" step="0.5" placeholder="e.g. 4.0"
            className="block mt-1 w-20 rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm"
            value={filters.minRating} onChange={(e) => { setFilters((f) => ({ ...f, minRating: e.target.value })); setPage(0); }} />
        </div>
        <div className="flex-1 min-w-[200px]">
          <Input label="Search" value={filters.nameSearch} placeholder="Place name..."
            onChange={(e) => { setFilters((f) => ({ ...f, nameSearch: e.target.value })); setPage(0); }} />
        </div>
      </div>

      <DataTable columns={columns} rows={places} loading={loading}
        emptyMessage="No places found" emptyIcon={Globe}
        pagination={{ page, pageSize: PAGE_SIZE, total, onChange: setPage }} />

      <PlaceDetailModal place={detailPlace} open={!!detailPlace} onClose={() => setDetailPlace(null)} onSave={() => { fetchPlaces(); if (onRefresh) onRefresh(); }} />
    </div>
  );
}

// ── Tab 4: Photo Management ──────────────────────────────────────────────────

function PhotoTab({ scope, registeredCity: regCity, onActiveRunsChange }) {
  const selectedCountry = scope?.countryCode;
  const selectedCity = scope?.cityId;
  // Text names for edge function calls (used as display labels in photo_backfill_runs)
  const cityTextName = regCity?.name || null;
  const countryTextName = regCity?.country || null;
  const { addToast } = useToast();
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // Photo stats
  const [loading, setLoading] = useState(false);
  const [totalPlaces, setTotalPlaces] = useState(null);
  const [withPhotos, setWithPhotos] = useState(null);
  const [missingCount, setMissingCount] = useState(null);
  const [previewSummary, setPreviewSummary] = useState(null);

  // Job system state
  const [activeRun, setActiveRun] = useState(null);
  const [batches, setBatches] = useState([]);
  const [runningBatch, setRunningBatch] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [creating, setCreating] = useState(false);
  const [expandedBatch, setExpandedBatch] = useState(null);
  const stopAutoRef = useRef(false);

  // ── Helpers ──────────────────────────────────────────────────────────────

  const invoke = async (body) => {
    const { data, error } = await supabase.functions.invoke("backfill-place-photos", { body });
    if (error) {
      const msg = await extractFunctionError(error, "Edge function error");
      throw new Error(msg);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const refreshActiveRuns = async () => {
    try {
      const data = await invoke({ action: "active_runs" });
      if (onActiveRunsChange) onActiveRunsChange(data.runs || []);
    } catch { /* ignore */ }
  };

  const formatPreviewBreakdown = (analysis) => {
    if (!analysis) return "";
    const parts = [];
    if (analysis.blockedByNotServable > 0) parts.push(`${formatCount(analysis.blockedByNotServable)} not Bouncer-approved`);
    if (analysis.blockedByMissingPhotoMetadata > 0) parts.push(`${formatCount(analysis.blockedByMissingPhotoMetadata)} missing Google photo refs`);
    if (analysis.blockedByMissingGooglePlaceId > 0) parts.push(`${formatCount(analysis.blockedByMissingGooglePlaceId)} missing Google place IDs`);
    if (analysis.failedPlaces > 0) parts.push(`${formatCount(analysis.failedPlaces)} previously failed`);
    return parts.join(", ");
  };

  // ── Photo stats ──────────────────────────────────────────────────────────

  const fetchCounts = async () => {
    if (!selectedCity) return;
    try {
      const { data } = await supabase.rpc("admin_place_photo_stats", {
        p_city_id: selectedCity,
      });
      if (mountedRef.current && data) {
        const row = Array.isArray(data) ? data[0] : data;
        setTotalPlaces(Number(row.total_places) || 0);
        setWithPhotos(Number(row.with_photos) || 0);
        setMissingCount(Number(row.without_photos) || 0);
      }
    } catch { /* ignore */ }
  };

  // ORCH-0598.11: mode-aware preview. Defaults to 'initial' for backward-compat
  // (used by the on-mount useEffect). Refresh button calls fetchPreview('refresh_servable').
  const fetchPreview = async (mode = "initial") => {
    if (!selectedCity) return;
    try {
      const data = await invoke({
        action: "preview_run",
        cityId: selectedCity,
        city: cityTextName,
        country: countryTextName,
        mode,
      });
      if (mountedRef.current) setPreviewSummary(data.analysis || null);
    } catch {
      if (mountedRef.current) setPreviewSummary(null);
    }
  };

  const refreshPhotoState = async () => {
    await Promise.all([fetchCounts(), fetchPreview()]);
  };

  // ── Hydration: load active run on mount / city change ────────────────────

  useEffect(() => {
    if (!selectedCity) {
      setTotalPlaces(null); setWithPhotos(null); setMissingCount(null);
      setPreviewSummary(null);
      setActiveRun(null); setBatches([]);
      return;
    }
    setLoading(true);
    let cancelled = false;

    (async () => {
      await refreshPhotoState();
      try {
        const data = await invoke({ action: "active_runs" });
        if (cancelled) return;
        if (onActiveRunsChange) onActiveRunsChange(data.runs || []);
        const match = (data.runs || []).find(
          (r) => r.run.city === cityTextName && r.run.country === countryTextName
        );
        if (match) {
          const status = await invoke({ action: "run_status", runId: match.run.id });
          if (!cancelled) {
            setActiveRun(status.run);
            setBatches(status.batches || []);
          }
        } else {
          if (!cancelled) { setActiveRun(null); setBatches([]); }
        }
      } catch { /* ignore */ }
      if (!cancelled) setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [selectedCountry, selectedCity]);

  // ── Create run ───────────────────────────────────────────────────────────
  // ORCH-0598.11: I-PHOTO-FILTER-EXPLICIT — mode is one of:
  //   'initial'           — first-time city setup (filter is_servable + no photos)
  //   'refresh_servable'  — Bouncer-approved maintenance (filter is_servable=true)

  const handleCreateRun = async (mode = "initial") => {
    setCreating(true);
    try {
      const data = await invoke({
        action: "create_run",
        cityId: selectedCity,
        city: cityTextName,
        country: countryTextName,
        mode,
      });

      const modeLabel = mode === "refresh_servable" ? "refresh servable" : "initial download";

      if (data.status === "nothing_to_do") {
        const blockedDescription = formatPreviewBreakdown(data.analysis);
        addToast({
          variant: "info",
          title: data.analysis?.withoutStoredPhotos > 0
            ? `No ${modeLabel} candidates in ${selectedCity}`
            : `All places in ${selectedCity} already have photos`,
          description: data.analysis?.withoutStoredPhotos > 0
            ? `${formatCount(data.analysis.withoutStoredPhotos)} places still lack stored photos. ${blockedDescription || "They are currently blocked from download."}`
            : undefined,
        });
        await refreshPhotoState();
        setCreating(false);
        return;
      }
      if (data.status === "already_active") {
        const status = await invoke({ action: "run_status", runId: data.runId });
        setActiveRun(status.run);
        setBatches(status.batches || []);
        setCreating(false);
        await refreshActiveRuns();
        await refreshPhotoState();
        return;
      }

      // Run created — load it
      const status = await invoke({ action: "run_status", runId: data.runId });
      setActiveRun(status.run);
      setBatches(status.batches || []);
      await refreshActiveRuns();
      addToast({
        variant: "success",
        title: `Photo download run created (${modeLabel})`,
        description: `${data.totalPlaces} places, ${data.totalBatches} batches, est. ${formatCost(data.estimatedCostUsd)}`,
      });
      await refreshPhotoState();
    } catch (err) {
      console.error("[PhotoBackfill] create run error:", err);
      addToast({ variant: "error", title: "Failed to create run", description: err.message });
    }
    setCreating(false);
  };

  // ── Run Next Batch ───────────────────────────────────────────────────────

  const handleRunNext = async () => {
    if (!activeRun || runningBatch) return;
    setRunningBatch(true);
    try {
      const data = await invoke({ action: "run_next_batch", runId: activeRun.id });
      if (data.done) {
        addToast({ variant: "success", title: "All batches complete!" });
      }
      // Refresh full state
      const status = await invoke({ action: "run_status", runId: activeRun.id });
      setActiveRun(status.run);
      setBatches(status.batches || []);
      await refreshActiveRuns();
    } catch (err) {
      addToast({ variant: "error", title: "Batch failed", description: err.message });
    }
    setRunningBatch(false);
    await refreshPhotoState();
  };

  // ── Run All (auto-advance) ───────────────────────────────────────────────

  const handleRunAll = async () => {
    if (!activeRun) return;
    setAutoRunning(true);
    stopAutoRef.current = false;

    // Ensure run is in 'running' state
    try {
      if (activeRun.status === "paused") {
        await invoke({ action: "resume_run", runId: activeRun.id });
      }
    } catch { /* ignore */ }

    while (!stopAutoRef.current && mountedRef.current) {
      try {
        setRunningBatch(true);
        const data = await invoke({ action: "run_next_batch", runId: activeRun.id });
        setRunningBatch(false);

        // Refresh state
        const status = await invoke({ action: "run_status", runId: activeRun.id });
        if (mountedRef.current) {
          setActiveRun(status.run);
          setBatches(status.batches || []);
        }
        // Live-update photo stat cards
        fetchCounts();

        if (data.done) {
          addToast({ variant: "success", title: "All batches complete!" });
          break;
        }
        if (stopAutoRef.current) {
          addToast({ variant: "info", title: "Auto-run paused" });
          break;
        }

        // Small delay for UI rerender
        await new Promise((r) => setTimeout(r, 500));
      } catch (err) {
        setRunningBatch(false);
        try { await invoke({ action: "pause_run", runId: activeRun.id }); } catch { /* ignore */ }
        addToast({ variant: "error", title: "Batch failed — auto-run paused", description: err.message });
        // Refresh state
        try {
          const status = await invoke({ action: "run_status", runId: activeRun.id });
          if (mountedRef.current) { setActiveRun(status.run); setBatches(status.batches || []); }
        } catch { /* ignore */ }
        break;
      }
    }

    setAutoRunning(false);
    setRunningBatch(false);
    await refreshActiveRuns();
    await refreshPhotoState();
  };

  // ── Pause ────────────────────────────────────────────────────────────────

  const handlePause = async () => {
    stopAutoRef.current = true;
    try {
      await invoke({ action: "pause_run", runId: activeRun.id });
      const status = await invoke({ action: "run_status", runId: activeRun.id });
      setActiveRun(status.run);
      setBatches(status.batches || []);
      await refreshActiveRuns();
    } catch (err) {
      addToast({ variant: "error", title: "Pause failed", description: err.message });
    }
  };

  // ── Cancel ───────────────────────────────────────────────────────────────

  const handleCancel = async () => {
    stopAutoRef.current = true;
    try {
      await invoke({ action: "cancel_run", runId: activeRun.id });
      const status = await invoke({ action: "run_status", runId: activeRun.id });
      setActiveRun(status.run);
      setBatches(status.batches || []);
      await refreshActiveRuns();
      addToast({ variant: "info", title: "Run cancelled" });
    } catch (err) {
      addToast({ variant: "error", title: "Cancel failed", description: err.message });
    }
  };

  // ── Retry batch ──────────────────────────────────────────────────────────

  const handleRetryBatch = async (batchId) => {
    setRunningBatch(true);
    try {
      await invoke({ action: "retry_batch", runId: activeRun.id, batchId });
      const status = await invoke({ action: "run_status", runId: activeRun.id });
      setActiveRun(status.run);
      setBatches(status.batches || []);
      await refreshActiveRuns();
      addToast({ variant: "success", title: "Batch retried" });
    } catch (err) {
      addToast({ variant: "error", title: "Retry failed", description: err.message });
    }
    setRunningBatch(false);
    await refreshPhotoState();
  };

  // ── Skip batch ───────────────────────────────────────────────────────────

  const handleSkipBatch = async (batchId) => {
    try {
      await invoke({ action: "skip_batch", runId: activeRun.id, batchId });
      const status = await invoke({ action: "run_status", runId: activeRun.id });
      setActiveRun(status.run);
      setBatches(status.batches || []);
      await refreshActiveRuns();
    } catch (err) {
      addToast({ variant: "error", title: "Skip failed", description: err.message });
    }
  };

  // ── Dismiss ──────────────────────────────────────────────────────────────

  const handleDismiss = () => {
    setActiveRun(null);
    setBatches([]);
    refreshPhotoState();
  };

  // ── Derived values ───────────────────────────────────────────────────────

  const photoPct = totalPlaces > 0 ? Math.round(((withPhotos ?? 0) / totalPlaces) * 100) : 0;
  const downloadableCount = previewSummary?.eligiblePlaces ?? null;
  const blockedCount = previewSummary
    ? Math.max((previewSummary.withoutStoredPhotos ?? 0) - (previewSummary.eligiblePlaces ?? 0), 0)
    : 0;
  const previewBreakdown = formatPreviewBreakdown(previewSummary);

  if (!selectedCity) return <div className="text-center py-12 text-[var(--color-text-secondary)]">Select a city to manage photos.</div>;

  // ── Run progress values ──────────────────────────────────────────────────

  const runProgressPct = activeRun && activeRun.total_batches > 0
    ? Math.round(((activeRun.completed_batches + activeRun.failed_batches + activeRun.skipped_batches) / activeRun.total_batches) * 100)
    : 0;

  const isTerminal = activeRun && ["completed", "cancelled", "failed"].includes(activeRun.status);
  const canRunNext = activeRun && !isTerminal && !runningBatch && !autoRunning;
  const canRunAll = activeRun && !isTerminal && !autoRunning;
  const canPause = autoRunning;
  const canCancel = activeRun && !isTerminal;

  const statusColors = {
    ready: "bg-blue-100 text-blue-800",
    running: "bg-green-100 text-green-800",
    paused: "bg-yellow-100 text-yellow-800",
    completed: "bg-green-100 text-green-800",
    cancelled: "bg-gray-100 text-gray-600",
    failed: "bg-red-100 text-red-800",
  };

  return (
    <div className="space-y-6">
      {/* Stats */}
      {/* Row 1: Health overview */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard icon={Layers} label="Total Places" value={totalPlaces ?? "—"} />
        <StatCard icon={Camera} label="With Photos" value={withPhotos ?? "—"} />
        <StatCard icon={ImageOff} label="Without Photos" value={missingCount ?? "—"} />
        <StatCard icon={Eye} label="Coverage" value={totalPlaces ? `${photoPct}%` : "—"} trend={photoPct >= 80 ? "Good" : photoPct >= 50 ? "Fair" : "Low"} trendUp={photoPct >= 80} />
      </div>

      {/* Row 2: Pipeline breakdown — why places are blocked */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard icon={Download} label="Downloadable Now" value={previewSummary ? formatCount(previewSummary.eligiblePlaces) : "—"} />
        <StatCard icon={AlertTriangle} label="Not Bouncer Approved" value={previewSummary ? formatCount(previewSummary.blockedByNotServable) : "—"} />
        <StatCard icon={ImageOff} label="No Photo Refs" value={previewSummary ? formatCount(previewSummary.blockedByMissingPhotoMetadata) : "—"} />
        <StatCard icon={XCircle} label="Previously Failed" value={previewSummary ? formatCount(previewSummary.failedPlaces) : "—"} />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-[var(--color-text-secondary)]">
          <Loader className="w-4 h-4 animate-spin" /> Loading photo status...
        </div>
      ) : !activeRun ? (
        /* ── Phase 1: No active run ──────────────────────────────────── */
        <SectionCard title="Download Photos"
          subtitle="Fetches photos from Google for places that have references but no stored images">

          {missingCount === 0 && (downloadableCount === null || downloadableCount === 0) ? (
            <div className="py-4">
              <div className="flex items-center gap-2 text-sm text-[var(--color-success-700)]">
                <CheckCircle className="w-4 h-4" /> All places have photos downloaded.
              </div>
              <Button size="sm" variant="secondary" icon={RefreshCw} className="mt-3" onClick={refreshPhotoState}>
                Re-check
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg p-4 bg-[var(--gray-50)]">
                <div className="text-sm space-y-2">
                  <div><strong>{formatCount(missingCount)}</strong> active places are missing stored photos.</div>
                  {downloadableCount !== null && (
                    <div><strong>{formatCount(downloadableCount)}</strong> can be downloaded right now.</div>
                  )}
                  {blockedCount > 0 && (
                    <div className="text-[var(--color-text-secondary)]">
                      {formatCount(blockedCount)} missing-photo places are currently blocked.
                      {previewBreakdown ? ` ${previewBreakdown}.` : ""}
                    </div>
                  )}
                  <div>
                    Up to 5 photos per place. Estimated cost: <strong>{formatCost(((downloadableCount ?? missingCount) || 0) * 0.035)}</strong>
                  </div>
                  {((downloadableCount ?? missingCount) || 0) * 0.035 > 50 && (
                    <div className="flex items-center gap-1 text-amber-700">
                      <AlertTriangle className="w-4 h-4" /> Estimated cost exceeds $50.
                    </div>
                  )}
                </div>
              </div>
              {/* ORCH-0598.11: two clearly-labeled buttons. Initial = is_servable + no photos
                  (first-time city setup). Refresh Servable = is_servable=true (maintenance for
                  Bouncer-approved set). I-PHOTO-FILTER-EXPLICIT. */}
              <div className="flex flex-wrap gap-2">
                {(downloadableCount === null || downloadableCount > 0) && (
                  <Button
                    variant="primary"
                    icon={Download}
                    onClick={() => handleCreateRun("initial")}
                    disabled={creating}
                    title="is_servable + no stored photos. For first-time city setup."
                  >
                    {creating
                      ? "Creating..."
                      : `Initial Download (${formatCount(downloadableCount ?? missingCount)} places)`}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  icon={RefreshCw}
                  onClick={() => handleCreateRun("refresh_servable")}
                  disabled={creating}
                  title="is_servable=true (Bouncer-approved). For maintenance / re-download."
                >
                  {creating ? "Creating..." : "Refresh Servable Photos"}
                </Button>
                <Button variant="secondary" icon={RefreshCw} onClick={refreshPhotoState} size="sm">
                  Re-check
                </Button>
              </div>
            </div>
          )}
        </SectionCard>
      ) : (
        /* ── Phase 2: Active run ─────────────────────────────────────── */
        <div className="space-y-4">
          {/* Run header card */}
          <SectionCard title={`Photo Download: ${activeRun.city}, ${activeRun.country}`}
            badge={<span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[activeRun.status] || ""}`}>{activeRun.status}</span>}>

            <div className="space-y-4">
              {/* Stats row */}
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <span>{activeRun.completed_batches + activeRun.failed_batches + activeRun.skipped_batches}/{activeRun.total_batches} batches</span>
                <span className="text-[var(--color-success-700)]">{activeRun.total_succeeded} succeeded</span>
                {activeRun.total_failed > 0 && <span className="text-[var(--color-error-700)]">{activeRun.total_failed} failed</span>}
                {activeRun.total_skipped > 0 && <span className="text-[var(--color-text-secondary)]">{activeRun.total_skipped} skipped</span>}
                <span>Cost: {formatCost(activeRun.actual_cost_usd)} / {formatCost(activeRun.estimated_cost_usd)}</span>
              </div>

              {/* Progress bar */}
              <div className="flex items-center gap-3">
                <div className="flex-1 bg-[var(--gray-100)] rounded-full h-3 overflow-hidden">
                  <div className="h-full rounded-full bg-[var(--color-brand-500)] transition-all duration-500"
                    style={{ width: `${runProgressPct}%` }} />
                </div>
                <span className="text-sm font-medium w-12 text-right">{runProgressPct}%</span>
              </div>

              {/* Control buttons */}
              <div className="flex gap-2">
                {isTerminal ? (
                  <Button variant="secondary" onClick={handleDismiss}>Dismiss</Button>
                ) : autoRunning ? (
                  <>
                    <Button variant="secondary" icon={Pause} onClick={handlePause}>Pause</Button>
                    <Button variant="secondary" icon={XCircle} onClick={handleCancel}>Cancel</Button>
                  </>
                ) : (
                  <>
                    <Button variant="primary" icon={Play} onClick={handleRunNext} disabled={!canRunNext}>
                      {runningBatch ? "Running..." : "Run Next"}
                    </Button>
                    <Button variant="secondary" icon={Zap} onClick={handleRunAll} disabled={!canRunAll}>
                      Run All
                    </Button>
                    <Button variant="secondary" icon={XCircle} onClick={handleCancel} disabled={!canCancel}>
                      Cancel
                    </Button>
                  </>
                )}
              </div>
            </div>
          </SectionCard>

          {/* Batch list */}
          <SectionCard title="Batches" subtitle={`${batches.length} total`}>
            <div className="divide-y divide-[var(--color-border)]">
              {batches.map((b) => {
                const isExpanded = expandedBatch === b.id;
                const hasFailed = b.failed_places && b.failed_places.length > 0;

                return (
                  <div key={b.id} className="py-2">
                    <div className="flex items-center gap-3 text-sm">
                      {/* Status icon */}
                      {b.status === "pending" && <span className="w-4 h-4 rounded-full bg-gray-300 inline-block" />}
                      {b.status === "running" && <Loader className="w-4 h-4 animate-spin text-[var(--color-brand-600)]" />}
                      {b.status === "completed" && <CheckCircle className="w-4 h-4 text-[var(--color-success-700)]" />}
                      {b.status === "failed" && <XCircle className="w-4 h-4 text-[var(--color-error-700)]" />}
                      {b.status === "skipped" && <MinusCircle className="w-4 h-4 text-gray-400" />}

                      {/* Batch info */}
                      <span className="font-medium">Batch {b.batch_index + 1}</span>

                      {b.status === "pending" && <span className="text-[var(--color-text-secondary)]">{b.place_count} places</span>}
                      {b.status === "running" && <span className="text-[var(--color-brand-600)]">processing...</span>}
                      {b.status === "completed" && (
                        <span className="text-[var(--color-text-secondary)]">
                          {b.succeeded} succeeded{b.failed > 0 ? `, ${b.failed} failed` : ""}{b.skipped > 0 ? `, ${b.skipped} skipped` : ""}
                        </span>
                      )}
                      {b.status === "failed" && <span className="text-[var(--color-error-700)]">all {b.place_count} failed</span>}
                      {b.status === "skipped" && <span className="text-gray-400">skipped</span>}

                      {/* Action buttons for failed batches */}
                      {b.status === "failed" && !isTerminal && (
                        <div className="ml-auto flex gap-1">
                          <Button size="xs" variant="secondary" icon={RotateCcw} onClick={() => handleRetryBatch(b.id)} disabled={runningBatch}>
                            Retry
                          </Button>
                          <Button size="xs" variant="secondary" icon={SkipForward} onClick={() => handleSkipBatch(b.id)}>
                            Skip
                          </Button>
                        </div>
                      )}

                      {/* Expand toggle for batches with failure details */}
                      {hasFailed && b.status !== "pending" && (
                        <button className="ml-auto p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                          onClick={() => setExpandedBatch(isExpanded ? null : b.id)}>
                          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                      )}
                    </div>

                    {/* Expanded failure details */}
                    {isExpanded && hasFailed && (
                      <div className="mt-2 ml-7 space-y-1">
                        {b.failed_places.map((fp, i) => (
                          <div key={i} className="text-xs text-[var(--color-error-700)] bg-red-50 rounded px-2 py-1">
                            <span className="font-mono">{fp.googlePlaceId || fp.placePoolId}</span>
                            {fp.error && <span className="ml-2 text-[var(--color-text-secondary)]">— {fp.error}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </SectionCard>
        </div>
      )}
    </div>
  );
}



// ── Tab 6: Stats & Analytics ─────────────────────────────────────────────────

function StatsTab({ city, stats, refreshKey }) {
  const [ops, setOps] = useState([]);
  const [loadingOps, setLoadingOps] = useState(false);
  const [runs, setRuns] = useState([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [expandedRun, setExpandedRun] = useState(null);
  const [runBatches, setRunBatches] = useState([]);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [aiCatBreakdown, setAiCatBreakdown] = useState([]);

  // Batch filters
  const [batchFilterStatus, setBatchFilterStatus] = useState("all");
  const [batchFilterCategory, setBatchFilterCategory] = useState("all");
  const [batchFilterTile, setBatchFilterTile] = useState("");

  useEffect(() => {
    if (!city) return;
    setLoadingOps(true);
    setLoadingRuns(true);

    supabase.from("seeding_operations")
      .select("*")
      .eq("city_id", city.id)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => { setOps(data || []); setLoadingOps(false); });

    supabase.from("seeding_runs")
      .select("*")
      .eq("city_id", city.id)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }) => { setRuns(data || []); setLoadingRuns(false); });

    // Load Bouncer-approved category breakdown (replaces old seeding_category stats)
    supabase.rpc("admin_place_category_breakdown", { p_city_id: city.id })
      .then(({ data }) => { setAiCatBreakdown(data || []); });
  }, [city, refreshKey]);

  const toggleRunExpand = async (runId) => {
    if (expandedRun === runId) { setExpandedRun(null); return; }
    setExpandedRun(runId);
    setLoadingBatches(true);
    // Reset filters when expanding a different run
    setBatchFilterStatus("all");
    setBatchFilterCategory("all");
    setBatchFilterTile("");
    const { data } = await supabase.from("seeding_batches")
      .select("*")
      .eq("run_id", runId)
      .order("batch_index");
    setRunBatches(data || []);
    setLoadingBatches(false);
  };

  // Auto-refresh expanded run's batches when refreshKey changes
  useEffect(() => {
    if (!expandedRun) return;
    supabase.from("seeding_batches")
      .select("*")
      .eq("run_id", expandedRun)
      .order("batch_index")
      .then(({ data }) => { setRunBatches(data || []); });
  }, [refreshKey, expandedRun]);

  // Apply batch filters
  const filteredBatches = runBatches.filter((b) => {
    if (batchFilterStatus !== "all" && b.status !== batchFilterStatus) return false;
    if (batchFilterCategory !== "all" && b.seeding_category !== batchFilterCategory) return false;
    if (batchFilterTile && String(b.tile_index) !== batchFilterTile) return false;
    return true;
  });

  const totalSpend = ops.reduce((s, o) => s + (o.estimated_cost_usd || 0), 0);
  const runSpend = runs.reduce((s, r) => s + (r.total_cost_usd || 0), 0);

  if (!city) return <div className="text-center py-12 text-[var(--color-text-secondary)]">Select a city.</div>;

  // Bouncer-approved category breakdown (from admin_place_category_breakdown RPC)
  const byCat = {};
  for (const row of aiCatBreakdown) {
    byCat[row.category] = { count: Number(row.place_count) || 0, photo_pct: row.photo_pct || 0, avg_rating: row.avg_rating };
  }

  // Run status → badge variant mapping (handles new statuses)
  const runBadgeVariant = (status) => {
    if (status === "completed") return "success";
    if (status === "cancelled" || status === "failed_preparing") return "error";
    if (status === "ready") return "success";
    return "warning"; // preparing, running, paused
  };

  // Run status → display label
  const runStatusLabel = (status) => {
    if (status === "failed_preparing") return "prep failed";
    return status;
  };

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

  // Unique tile indices in current batch set (for tile filter dropdown)
  const uniqueTileIndices = [...new Set(runBatches.map((b) => b.tile_index))].sort((a, b) => a - b);

  return (
    <div className="space-y-6">
      {/* Category breakdown — Bouncer-approved only */}
      <SectionCard title="Bouncer-Approved Places by Category">
        <div className="space-y-2">
          {ALL_CATEGORIES.map((catId) => {
            const data = byCat[catId] || { count: 0, photo_pct: 0 };
            const maxCount = Math.max(...Object.values(byCat).map((d) => d.count || 0), 1);
            return (
              <div key={catId} className="flex items-center gap-3">
                <div className="w-32 text-sm truncate" style={{ color: CATEGORY_COLORS[catId] }}>{CATEGORY_LABELS[catId]}</div>
                <div className="flex-1 bg-[var(--gray-100)] rounded-full h-4 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${Math.min((data.count / maxCount) * 100, 100)}%`, backgroundColor: CATEGORY_COLORS[catId] }} />
                </div>
                <div className="text-sm w-16 text-right">{data.count}</div>
                <div className="text-xs w-20 text-right text-[var(--color-text-secondary)]">{data.photo_pct}% photos</div>
              </div>
            );
          })}
        </div>
      </SectionCard>

      {/* Seeding Runs (batch-based history) */}
      <SectionCard title="Seeding Runs" subtitle={runs.length > 0 ? `${runs.length} runs · ${formatCost(runSpend)} total` : null}>
        {loadingRuns ? (
          <div className="flex items-center gap-2 py-4 justify-center text-sm text-[var(--color-text-secondary)]">
            <Loader className="w-4 h-4 animate-spin" /> Loading runs...
          </div>
        ) : runs.length === 0 ? (
          <div className="text-center py-6 text-sm text-[var(--color-text-secondary)]">No seeding runs yet</div>
        ) : (
          <div className="space-y-2">
            {runs.map((run) => (
              <div key={run.id} className="border rounded-lg overflow-hidden">
                <button
                  className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-[var(--gray-50)] transition-colors cursor-pointer text-left"
                  onClick={() => toggleRunExpand(run.id)}
                >
                  {expandedRun === run.id ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                  <span className="text-[var(--color-text-secondary)] w-24">{new Date(run.created_at).toLocaleDateString()}</span>
                  <span className="font-medium">{run.total_batches} batches</span>
                  <span className="text-[var(--color-text-secondary)]">·</span>
                  <span className="text-[var(--color-success-700)]">{run.completed_batches} done</span>
                  {run.failed_batches > 0 && <span className="text-[var(--color-error-700)]">{run.failed_batches} failed</span>}
                  {(run.skipped_batches || 0) > 0 && <span className="text-[var(--color-text-secondary)]">{run.skipped_batches} skipped</span>}
                  <span className="text-[var(--color-text-secondary)]">{formatCost(run.total_cost_usd)}</span>
                  <span className="ml-auto">
                    <Badge variant={runBadgeVariant(run.status)}>
                      {runStatusLabel(run.status)}
                    </Badge>
                  </span>
                </button>

                {expandedRun === run.id && (
                  <div className="border-t px-4 py-3">
                    <div className="grid grid-cols-4 gap-3 text-xs mb-3">
                      <div>Categories: <strong>{run.selected_categories?.length || 0}</strong></div>
                      <div>New places: <strong className="text-[var(--color-success-700)]">{run.total_places_new}</strong></div>
                      <div>Duplicates: <strong>{run.total_places_duped}</strong></div>
                      <div>API calls: <strong>{run.total_api_calls}</strong></div>
                    </div>

                    {/* Batch Filters */}
                    {!loadingBatches && runBatches.length > 0 && (
                      <div className="flex gap-2 mb-2 items-center">
                        <select
                          className="rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1 text-xs"
                          value={batchFilterStatus}
                          onChange={(e) => setBatchFilterStatus(e.target.value)}
                        >
                          <option value="all">All statuses</option>
                          <option value="completed">Completed</option>
                          <option value="failed">Failed</option>
                          <option value="skipped">Skipped</option>
                          <option value="pending">Pending</option>
                        </select>
                        <select
                          className="rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1 text-xs"
                          value={batchFilterCategory}
                          onChange={(e) => setBatchFilterCategory(e.target.value)}
                        >
                          <option value="all">All categories</option>
                          {ALL_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                        </select>
                        <select
                          className="rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1 text-xs"
                          value={batchFilterTile}
                          onChange={(e) => setBatchFilterTile(e.target.value)}
                        >
                          <option value="">All tiles</option>
                          {uniqueTileIndices.map((t) => <option key={t} value={String(t)}>Tile {t}</option>)}
                        </select>
                        {(batchFilterStatus !== "all" || batchFilterCategory !== "all" || batchFilterTile) && (
                          <span className="text-xs text-[var(--color-text-secondary)]">
                            {filteredBatches.length} of {runBatches.length}
                          </span>
                        )}
                      </div>
                    )}

                    {loadingBatches ? (
                      <div className="text-xs text-[var(--color-text-secondary)] py-2">Loading batches...</div>
                    ) : (
                      <div className="max-h-60 overflow-y-auto space-y-0.5">
                        {filteredBatches.map((b) => (
                          <div key={b.id} className={`flex items-center gap-2 text-xs px-2 py-1 rounded ${
                            b.status === "failed" ? "bg-[var(--color-error-50)]" : ""
                          }`}>
                            {b.status === "completed" ? (
                              <CheckCircle className="w-3 h-3 text-[#22c55e] shrink-0" />
                            ) : b.status === "failed" ? (
                              <AlertTriangle className="w-3 h-3 text-[#ef4444] shrink-0" />
                            ) : b.status === "skipped" ? (
                              <SkipForward className="w-3 h-3 text-[var(--color-text-secondary)] shrink-0" />
                            ) : (
                              <Clock className="w-3 h-3 text-[var(--color-text-secondary)] shrink-0" />
                            )}
                            <span className="w-8 text-[var(--color-text-secondary)]">#{b.batch_index + 1}</span>
                            <span className="w-12">T{b.tile_index}</span>
                            <span className="w-24 truncate" style={{ color: CATEGORY_COLORS[b.seeding_category] }}>
                              {CATEGORY_LABELS[b.seeding_category] || b.seeding_category}
                            </span>
                            {(b.retry_count || 0) > 0 && (
                              <span className="inline-flex items-center px-1 py-0 rounded-full text-[9px] font-bold bg-[var(--gray-100)] text-[var(--color-text-secondary)]" title={`Retried ${b.retry_count}×`}>
                                <RotateCcw className="w-2 h-2 mr-0.5" />{b.retry_count}
                              </span>
                            )}
                            {b.status === "completed" ? (
                              <span className="text-[var(--color-text-secondary)]">
                                {b.places_new_inserted} new · {b.places_duplicate_skipped} dupes
                              </span>
                            ) : b.status === "failed" ? (
                              <span className="text-[var(--color-error-700)] truncate">{b.error_message}</span>
                            ) : b.status === "skipped" ? (
                              <span className="text-[var(--color-text-secondary)]">Skipped</span>
                            ) : (
                              <span className="text-[var(--color-text-secondary)]">Pending</span>
                            )}
                          </div>
                        ))}
                        {filteredBatches.length === 0 && runBatches.length > 0 && (
                          <div className="text-xs text-[var(--color-text-secondary)] py-2 text-center">No batches match filters</div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Legacy Seeding History */}
      <SectionCard title="Legacy Seeding History" subtitle={`Total spend: ${formatCost(totalSpend)} / ${formatCost(HARD_CAP_USD)}`}>
        <DataTable columns={opColumns} rows={ops} loading={loadingOps}
          emptyMessage="No seeding operations yet" />
      </SectionCard>
    </div>
  );
}

// ── SeedingTab (merged Seed & Import + Stats & Analytics) ───────────────────

function SeedingTab({ registeredCity, tiles, stats, seedingOps, refreshKey, onRefresh, onDeleteCity, onSeedingChange }) {
  if (!registeredCity) return null;

  return (
    <div className="space-y-8">
      <SeedTab city={registeredCity} tiles={tiles} onRefresh={onRefresh} onDeleteCity={onDeleteCity} onSeedingChange={onSeedingChange} />
      <div className="border-t border-[var(--gray-200)] pt-6">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-4">Stats & Analytics</h3>
        <StatsTab city={registeredCity} stats={stats} refreshKey={refreshKey} />
      </div>
    </div>
  );
}


// ── ExcludedTab (ORCH-0646: renamed from RejectedTab, read-only per D-3) ─────
// Bouncer is the authoritative quality gate (I-BOUNCER-IS-QUALITY-GATE). Admin
// surfaces Bouncer-excluded places for visibility + deactivation — no admin
// override RPC. If override is ever needed, add a deliberate admin_override_servable
// RPC with audit trail (deferred; not in ORCH-0646 scope).

function ExcludedTab({ scope, onRefresh }) {
  const { addToast } = useToast();
  const [places, setPlaces] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filterCat, setFilterCat] = useState(null); // category filter for the list
  const [detailPlace, setDetailPlace] = useState(null);
  const PAGE_SIZE = 20;

  const fetchExcluded = useCallback(async () => {
    setLoading(true);
    let q = supabase.from("place_pool")
      .select("*", { count: "exact" })
      .eq("is_active", true)
      .eq("is_servable", false);
    if (scope.cityId) q = q.eq("city_id", scope.cityId);
    if (filterCat) q = q.eq("seeding_category", filterCat);
    q = q.order("name").range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    const { data, count } = await q;
    setPlaces(data || []);
    setTotal(count || 0);
    setLoading(false);
  }, [scope.cityId, page, filterCat]);

  useEffect(() => { fetchExcluded(); }, [fetchExcluded]);
  useEffect(() => { setPage(0); }, [scope.cityId, filterCat]);

  const handleDelete = async (place) => {
    if (!confirm(`Delete "${place.name}"? This sets it to inactive.`)) return;
    const { error } = await supabase.from("place_pool").update({ is_active: false }).eq("id", place.id);
    if (error) { addToast({ variant: "error", title: "Delete failed", description: error.message }); return; }
    addToast({ variant: "success", title: `Deleted "${place.name}"` });
    fetchExcluded();
  };

  const columns = [
    { key: "name", label: "Name", sortable: true, render: (_, r) => (
      <button className="text-[var(--color-brand-500)] hover:underline cursor-pointer text-left min-w-[200px]"
        onClick={() => setDetailPlace(r)}>{r.name}</button>
    )},
    { key: "address", label: "Address", render: (_, r) => <span className="text-xs max-w-[250px] truncate block">{r.address || "—"}</span> },
    { key: "bouncer_reason", label: "Bouncer Reason", render: (_, r) => <span className="text-xs max-w-[250px] truncate block text-[var(--color-error-600)]">{r.bouncer_reason || "—"}</span> },
    { key: "seeding_category", label: "Discovered Via", render: (_, r) => r.seeding_category ? (
      <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full text-white/70" style={{ backgroundColor: CATEGORY_COLORS[r.seeding_category] || "#6b7280" }}>
        {CATEGORY_LABELS[r.seeding_category] || r.seeding_category}
      </span>
    ) : "—" },
    { key: "rating", label: "Rating", render: (_, r) => r.rating ? `★ ${r.rating}` : "—" },
    { key: "actions", label: "", render: (_, r) => (
      <div className="flex gap-1">
        <button onClick={() => handleDelete(r)}
          className="p-1 rounded hover:bg-red-100 text-red-500 cursor-pointer" title="Delete (deactivate)">
          <XCircle className="w-4 h-4" />
        </button>
      </div>
    )},
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <StatCard icon={AlertTriangle} label="Total Bouncer-Excluded" value={total} />
      </div>

      {/* Category filter pills */}
      <div className="flex flex-wrap gap-1.5">
        <button onClick={() => setFilterCat(null)}
          className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
            !filterCat ? "bg-[var(--color-text-primary)] text-white border-transparent" : "bg-transparent border-[var(--gray-300)] text-[var(--color-text-secondary)] hover:border-[var(--gray-400)]"
          }`}>
          All
        </button>
        {ALL_CATEGORIES.map((c) => (
          <button key={c} onClick={() => setFilterCat(filterCat === c ? null : c)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
              filterCat === c ? "text-white border-transparent" : "bg-transparent border-[var(--gray-300)] text-[var(--color-text-secondary)] hover:border-[var(--gray-400)]"
            }`}
            style={filterCat === c ? { backgroundColor: CATEGORY_COLORS[c] } : {}}>
            {CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>

      <DataTable columns={columns} rows={places} loading={loading}
        emptyMessage="No Bouncer-excluded places" emptyIcon={CheckCircle}
        pagination={{ page, pageSize: PAGE_SIZE, total, onChange: setPage }} />

      {/* Place detail modal — reuses the same modal as Browse tab */}
      <PlaceDetailModal place={detailPlace} open={!!detailPlace}
        onClose={() => setDetailPlace(null)} onSave={() => { fetchExcluded(); }} />
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function PlacePoolManagementPage({ onTabChange }) {
  const mountedRef = useRef(true);
  const { addToast } = useToast();
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // ── Scope-based navigation (replaces old text-based country/city selection) ──
  const [scope, setScope] = useState({ countryCode: null, cityId: null });
  const [pickerCities, setPickerCities] = useState([]);

  // Tab state
  const [activeTab, setActiveTab] = useState("overview");
  const [seedingActive, setSeedingActive] = useState(false);

  // Seeding state (loaded when a city is selected)
  const [registeredCity, setRegisteredCity] = useState(null);
  const [tiles, setTiles] = useState([]);
  const [stats, setStats] = useState(null);
  const [seedingOps, setSeedingOps] = useState([]);
  const [addCityOpen, setAddCityOpen] = useState(false);
  const [updateCityOpen, setUpdateCityOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Photo backfill job status bar
  const [activePhotoRuns, setActivePhotoRuns] = useState([]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Load city picker data
  useEffect(() => {
    supabase.rpc("admin_city_picker_data").then(({ data }) => {
      if (mountedRef.current && data) setPickerCities(data);
    });
  }, [refreshKey]);

  // Hydrate photo backfill active runs on mount
  useEffect(() => {
    supabase.functions.invoke("backfill-place-photos", { body: { action: "active_runs" } })
      .then(({ data }) => { if (mountedRef.current && data?.runs) setActivePhotoRuns(data.runs); })
      .catch(() => {});
  }, []);

  // Load city data when a city is selected via scope
  useEffect(() => {
    if (!scope.cityId) { setRegisteredCity(null); setTiles([]); setStats(null); setSeedingOps([]); return; }

    supabase.from("seeding_cities").select("*").eq("id", scope.cityId).single()
      .then(({ data }) => {
        if (!mountedRef.current) return;
        setRegisteredCity(data || null);
        if (data) {
          supabase.from("seeding_tiles").select("*").eq("city_id", data.id).order("tile_index")
            .then(({ data: t }) => { if (mountedRef.current) setTiles(t || []); });
          supabase.rpc("admin_city_place_stats", { p_city_id: data.id })
            .then(({ data: s }) => { if (mountedRef.current) setStats(s); });
          supabase.from("seeding_operations").select("*").eq("city_id", data.id).order("created_at", { ascending: false }).limit(50)
            .then(({ data: ops }) => { if (mountedRef.current) setSeedingOps(ops || []); });
        }
      });
  }, [scope.cityId, refreshKey]);

  // Scope label for subtitle
  const scopeLabel = (() => {
    if (scope.cityId) {
      const c = pickerCities.find((x) => x.city_id === scope.cityId);
      return c ? `${c.city_name}, ${c.country_name}` : "";
    }
    if (scope.countryCode) {
      const g = pickerCities.find((x) => x.country_code === scope.countryCode);
      return g ? g.country_name : "";
    }
    return `${pickerCities.length} cities`;
  })();

  const totalServable = pickerCities.reduce((s, c) => s + (c.is_servable_places || 0), 0);

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "browse", label: "Browse Pool" },
    { id: "map", label: "Map View" },
    { id: "seeding", label: "Seeding" },
    { id: "refresh", label: "Refresh" },
    { id: "photos", label: "Photos" },
    { id: "excluded", label: "Bouncer-Excluded" },
  ];

  const handleAddCity = (city) => {
    refresh();
    setScope({ countryCode: city.country_code || null, cityId: city.id });
  };

  const handleCityUpdated = (tileCount) => {
    addToast({ variant: "success", title: `City updated — ${tileCount} tiles regenerated` });
    refresh();
  };

  const handleDeleteCity = async (city) => {
    try {
      const { error } = await supabase.from("seeding_cities").delete().eq("id", city.id);
      if (error) throw error;
      addToast({ variant: "success", title: `Deleted "${city.name}"` });
      setScope({ countryCode: scope.countryCode, cityId: null });
      refresh();
    } catch (err) {
      addToast({ variant: "error", title: "Delete failed", description: err.message });
    }
  };

  return (
    <div className="space-y-4 py-6">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Place Pool Management</h2>
            <p className="text-sm text-[var(--color-text-secondary)]">{scopeLabel} · {totalServable.toLocaleString()} servable places</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <CityPicker cities={pickerCities} scope={scope} onScopeChange={setScope} />
          {scope.cityId && registeredCity && (
            <Button icon={RefreshCw} size="sm" variant="secondary" onClick={() => setUpdateCityOpen(true)}
              disabled={seedingActive}>Update Bbox</Button>
          )}
          <Button icon={Plus} size="sm" onClick={() => setAddCityOpen(true)}>Add City</Button>
        </div>
      </div>

      {/* Photo backfill job status bar — visible across all tabs */}
      {activePhotoRuns.length > 0 && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--gray-50)] p-3 space-y-2">
          {activePhotoRuns.map(({ run, batchSummary }) => {
            const done = run.completed_batches + run.failed_batches + run.skipped_batches;
            const pct = run.total_batches > 0 ? Math.round((done / run.total_batches) * 100) : 0;
            return (
              <div key={run.id} className="flex items-center gap-3 text-sm">
                <Camera className="w-4 h-4 text-[var(--color-brand-600)]" />
                <span className="font-medium text-[var(--color-brand-600)]">{run.city}, {run.country}</span>
                <span className="text-[var(--color-text-secondary)]">— {run.status}</span>
                <span className="text-[var(--color-text-secondary)]">{done}/{run.total_batches} batches</span>
                <span className="font-medium">{pct}%</span>
                <div className="flex-1 bg-[var(--gray-100)] rounded-full h-2 overflow-hidden max-w-[120px]">
                  <div className="h-full rounded-full bg-[var(--color-brand-500)] transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      <div className="mt-4" key={refreshKey}>
        {activeTab === "overview" && (
          <OverviewTab scope={scope} onScopeChange={setScope} pickerCities={pickerCities} />
        )}
        {activeTab === "browse" && (
          <BrowseTab scope={scope} onRefresh={refresh} />
        )}
        {activeTab === "map" && (
          <MapTab scope={scope} registeredCity={registeredCity} tiles={tiles} seedingOps={seedingOps} />
        )}
        {activeTab === "seeding" && (
          scope.cityId && registeredCity ? (
            <SeedingTab
              registeredCity={registeredCity} tiles={tiles} stats={stats} seedingOps={seedingOps}
              refreshKey={refreshKey} onRefresh={refresh} onDeleteCity={handleDeleteCity} onSeedingChange={setSeedingActive}
            />
          ) : (
            <div className="text-center py-12 text-[var(--color-text-secondary)]">
              Select a city to manage seeding, or add a new one.
              <div className="mt-3"><Button icon={Plus} onClick={() => setAddCityOpen(true)}>Add City</Button></div>
            </div>
          )
        )}
        {activeTab === "refresh" && (
          scope.cityId && registeredCity ? (
            <RefreshTab
              city={registeredCity}
              cities={[]}
              onRefresh={refresh}
              onRefreshChange={setSeedingActive}
              flagEnabled={true}
            />
          ) : (
            <div className="text-center py-12 text-[var(--color-text-secondary)]">
              Select a city to refresh its pool, or add a new one.
              <div className="mt-3"><Button icon={Plus} onClick={() => setAddCityOpen(true)}>Add City</Button></div>
            </div>
          )
        )}
        {activeTab === "photos" && (
          scope.cityId ? (
            <PhotoTab scope={scope} registeredCity={registeredCity} onActiveRunsChange={setActivePhotoRuns} />
          ) : (
            <div className="text-center py-12 text-[var(--color-text-secondary)]">Select a city to manage photos.</div>
          )
        )}
        {activeTab === "excluded" && (
          <ExcludedTab scope={scope} onRefresh={refresh} />
        )}
      </div>

      <AddCityModal open={addCityOpen} onClose={() => setAddCityOpen(false)} onSave={handleAddCity} />
      <UpdateCityModal open={updateCityOpen} onClose={() => setUpdateCityOpen(false)} city={registeredCity} onUpdated={handleCityUpdated} />
    </div>
  );
}

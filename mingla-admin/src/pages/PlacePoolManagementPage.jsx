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
  Square, SkipForward, XCircle, X, Loader, RotateCcw, Zap, MinusCircle,
  Image as ImageIcon,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { extractFunctionError } from "../lib/edgeFunctionError";
import { useToast } from "../context/ToastContext";
import { Tabs } from "../components/ui/Tabs";
import { Button } from "../components/ui/Button";
import { SectionCard, StatCard, AlertCard } from "../components/ui/Card";
import { DataTable } from "../components/ui/Table";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { Drawer } from "../components/ui/Drawer";
import { Input, Toggle } from "../components/ui/Input";
import { Badge } from "../components/ui/Badge";
import { Breadcrumbs } from "../components/ui/Breadcrumbs";
import { Spinner } from "../components/ui/Spinner";
import { LoadError } from "../components/ui/LoadError";
import { CATEGORY_LABELS, CATEGORY_COLORS, ALL_CATEGORIES } from "../constants/categories";
import {
  adminDeactivateError,
  PLACE_CATEGORY_COLUMN,
  PLACE_LIST_COLUMNS,
  PLACE_LIST_COUNT_MODE,
  PLACE_MAP_COLUMNS,
} from "../lib/placePoolQueries";
import { placeStages, placeTypeLabel, reasonWords } from "../lib/cityPipeline";
// ORCH-0553 — SeedTab + RefreshTab extracted to shared seeding components.
// HARD_CAP_USD + formatCost + TILE_RADIUS_OPTIONS imported from shared lib so
// both this page and AIValidationPage tabs use a single source of truth.
import { SeedTab } from "../components/seeding/SeedTab";
import { RefreshTab } from "../components/seeding/RefreshTab";
import { HARD_CAP_USD, formatCost, TILE_RADIUS_OPTIONS } from "../lib/seedingFormat";
import {
  adminDiscoveryRangeErrorMessage,
  buildAdminDiscoveryRangeUpdate,
} from "../lib/deckCardPreviewRules";
import { PageHeader } from "../components/ui/PageHeader";
import { PlaceScoreOverride } from "../components/placePool/PlaceScoreOverride";

// ── Constants ────────────────────────────────────────────────────────────────

// Tabs are computed dynamically in the main page component based on registration state

// ORCH-0553 — TYPE_TO_CATEGORY + guessCategory moved to components/seeding/SeedTab.jsx
// (only consumer was SeedTab's ad-hoc search).
// HARD_CAP_USD + formatCost moved to lib/seedingFormat.js (shared with RefreshTab).

const PRICE_TIERS = ["chill", "comfy", "bougie", "lavish"];

// ORCH-1024 — thumbnail backfill runs share the `photo_backfill_runs` table with
// the originals-download runs but are tagged with this synthetic city marker
// (the `backfill-place-photo-thumbs` function's RUN_CITY). The Photos panel must
// EXCLUDE these so a global thumbs run never appears as a city download run; the
// Thumbnails panel binds to `backfill-place-photo-thumbs` whose own active_runs
// already filters to exactly this marker.
const THUMBS_RUN_CITY = "ORCH-0957 place-photo thumbs";

// ── Helpers ──────────────────────────────────────────────────────────────────

function RecenterMap({ center, zoom }) {
  const map = useMap();
  useEffect(() => { if (center) map.setView(center, zoom); }, [center, zoom, map]);
  return null;
}

function formatCount(n) { return Number(n || 0).toLocaleString(); }

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

// #4130 (Wave 4b): the Overview tab is gone. Its cards were wrong ("Bouncer
// Judged" showed the visible share; "Photo Coverage" counted visible places
// only); Place pool's Overview now shows the server-counted funnel
// (PlacePoolPage, admin_place_pool_funnel).

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
    discovery_min_minor: "", discovery_max_minor: "",
    discovery_edit_reason: "",
  });
  const [saving, setSaving] = useState(false);
  // META-ORCH-1009 Sub-D — admin per-place re-evaluation. Pending state
  // disables the button + shows spinner; error surfaces inline + via toast.
  const [reeval, setReeval] = useState({ pending: false, error: null });

  // ORCH-1073 — admin listing actions (suspend with owner message + structured
  // to-do list / soft-delete from the pool / restore). Calls admin_suspend_listing,
  // admin_soft_delete_listing, admin_restore_listing.
  const [actionView, setActionView] = useState(null); // 'suspend' | 'delete' | null
  const [actionBusy, setActionBusy] = useState(false);
  const [suspendMsg, setSuspendMsg] = useState("");
  const [suspendReason, setSuspendReason] = useState("");
  const [todoItems, setTodoItems] = useState([]); // [{ category, note }]
  const [deleteMsg, setDeleteMsg] = useState("");
  const [deleteReason, setDeleteReason] = useState("");

  useEffect(() => {
    if (!open || !place) return;
    // reset action UI whenever a new place opens
    setActionView(null); setActionBusy(false);
    setSuspendMsg(""); setSuspendReason(""); setTodoItems([]);
    setDeleteMsg(""); setDeleteReason("");
    setEditForm({
      name: place.name || "",
      price_tiers: place.price_tiers?.length ? place.price_tiers : (place.price_tier ? [place.price_tier] : []),
      seeding_category: place.seeding_category || "",
      is_active: place.is_active,
      ai_categories: place.ai_categories || [],
      discovery_min_minor:
        place.place_discovery_price_ranges?.source_min_minor?.toString() ?? "",
      discovery_max_minor:
        place.place_discovery_price_ranges?.source_max_minor?.toString() ?? "",
      discovery_edit_reason: "",
    });
  }, [open, place]);

  if (!place) return null;

  const photos = place.stored_photo_urls || [];
  const types = place.types || [];
  const placeCategory = place.mingla_category || null;

  const bouncerStatusBadge = () => {
    if (place.is_servable === true) return <Badge variant="success">Servable</Badge>;
    if (place.is_servable === false) return <Badge variant="error">Excluded</Badge>;
    return <Badge variant="outline">Not Yet Bounced</Badge>;
  };

  const handleSave = async () => {
    // buildAdminDiscoveryRangeUpdate owns p_expected_version and p_actor_reason
    // so the page cannot split the reason/CAS contract across multiple writes.
    const update = buildAdminDiscoveryRangeUpdate({
      place,
      editForm,
      requestId: crypto.randomUUID(),
    });
    if (!update.ok) {
      addToast({
        variant: "error",
        title: update.code === "admin_reason_required"
          ? "Reason required"
          : "Invalid discovery range",
        description: update.message,
      });
      return;
    }

    setSaving(true);
    const { error: saveError } = await supabase.rpc(
      "issue_1384_admin_update_place_and_discovery_range",
      update.params,
    );
    if (saveError) {
      addToast({
        variant: "error",
        title: "Save failed",
        description: adminDiscoveryRangeErrorMessage(saveError),
      });
      setSaving(false);
      return;
    }

    addToast({ variant: "success", title: "Place updated" }); onClose(); if (onSave) onSave();
    setSaving(false);
  };

  // META-ORCH-1009 Sub-D — fires the admin re-evaluation action. Optimistic
  // toast on success; rate-limit/error paths show inline + toast.
  const handleReeval = async () => {
    setReeval({ pending: true, error: null });
    try {
      const { data, error } = await supabase.functions.invoke(
        "run-place-intelligence-trial",
        { body: { action: "admin_reeval_place", place_pool_id: place.id } },
      );
      if (error) throw error;
      if (data?.error) {
        const msg = data?.message || data.error;
        addToast({
          variant: data.error === "rate_limited" ? "warning" : "error",
          title: data.error === "rate_limited" ? "Already in progress" : "Re-evaluation failed",
          description: msg,
        });
        setReeval({ pending: false, error: msg });
        return;
      }
      addToast({
        variant: "success",
        title: "Re-evaluation queued",
        description: "Gemini Q2 runs within ~1 min; deck refresh within ~16 min.",
      });
      setReeval({ pending: false, error: null });
    } catch (e) {
      const msg = e?.message ?? String(e);
      addToast({ variant: "error", title: "Re-evaluation failed", description: msg });
      setReeval({ pending: false, error: msg });
    }
  };

  // ORCH-1073 — feedback categories mirror the DB enum in admin_suspend_listing.
  const FEEDBACK_CATEGORIES = ["photos", "address", "hours", "category", "description", "quality", "other"];

  const handleSuspend = async () => {
    setActionBusy(true);
    const items = todoItems
      .filter((i) => i.note && i.note.trim())
      .map((i) => ({ category: i.category, note: i.note.trim() }));
    const { data, error } = await supabase.rpc("admin_suspend_listing", {
      p_place_id: place.id,
      p_overall_message: suspendMsg.trim() || null,
      p_items: items,
      p_reason: suspendReason.trim() || null,
    });
    if (error) { addToast({ variant: "error", title: "Suspend failed", description: error.message }); setActionBusy(false); return; }
    addToast({
      variant: "success", title: "Listing suspended",
      description: data?.brand_id
        ? `Owner notified (${data.notified}); ${data.todo_items} to-do item(s) sent.`
        : "Taken off the deck (no claimed owner to notify).",
    });
    setActionBusy(false); onClose(); if (onSave) onSave();
  };

  const handleDelete = async () => {
    setActionBusy(true);
    const { data, error } = await supabase.rpc("admin_soft_delete_listing", {
      p_place_id: place.id,
      p_reason: deleteReason.trim() || null,
      p_message: deleteMsg.trim() || null,
    });
    if (error) { addToast({ variant: "error", title: "Delete failed", description: error.message }); setActionBusy(false); return; }
    addToast({
      variant: "success", title: "Listing removed",
      description: data?.brand_id ? `Claim revoked; owner notified (${data.notified}).` : "Removed from the pool.",
    });
    setActionBusy(false); onClose(); if (onSave) onSave();
  };

  const handleRestore = async () => {
    setActionBusy(true);
    const { error } = await supabase.rpc("admin_restore_listing", { p_place_id: place.id });
    if (error) { addToast({ variant: "error", title: "Restore failed", description: error.message }); setActionBusy(false); return; }
    addToast({ variant: "success", title: "Listing restored" });
    setActionBusy(false); onClose(); if (onSave) onSave();
  };

  // META-ORCH-1009 Sub-D — extract the most-recent AI evaluated_at across
  // signals on this place. NULL if the place has no AI scores (Sub-C hasn't
  // covered it yet).
  const aiLastEvaluatedAt = (() => {
    const slices = place.ai_signal_scores;
    if (!slices || typeof slices !== "object") return null;
    let latest = null;
    for (const v of Object.values(slices)) {
      const ts = v?.evaluated_at;
      if (!ts) continue;
      if (!latest || new Date(ts).getTime() > new Date(latest).getTime()) {
        latest = ts;
      }
    }
    return latest;
  })();

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
    // #4276 design pass: a place opens in a side panel beside the list, as the design draws it.
    <Drawer open={open} onClose={onClose} title={place.name || "Place"}
      footer={(
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={handleSave}>Save</Button>
        </div>
      )}>

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
                <span className="text-[var(--color-text-secondary)]">Category:</span>
                {placeCategory ? (
                  <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full text-white" style={{ backgroundColor: CATEGORY_COLORS[placeCategory] || "#6b7280" }}>
                    {CATEGORY_LABELS[placeCategory] || placeCategory}
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
              <div>
                <span className="text-[var(--color-text-secondary)]">Discovery price:</span>{" "}
                {place.place_discovery_price_ranges?.status === "active"
                  ? `${place.place_discovery_price_ranges.source_min_minor}–${place.place_discovery_price_ranges.source_max_minor ?? "open"} minor · ${place.place_discovery_price_ranges.source_currency_code}`
                  : place.place_discovery_price_ranges?.status === "legacy_unresolved"
                    ? "Needs price range review"
                    : "—"}
              </div>
              <div><span className="text-[var(--color-text-secondary)]">Source type:</span> {place.place_discovery_price_ranges?.source_type || "—"}</div>
              <div><span className="text-[var(--color-text-secondary)]">Version:</span> {place.place_discovery_price_ranges?.version ?? "—"}</div>
              <div><span className="text-[var(--color-text-secondary)]">Last actor:</span> {place.place_discovery_price_ranges?.updated_by || "—"}</div>
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
              {/* META-ORCH-1009 Sub-D — "Last AI evaluated" surfaces the most
                  recent evaluated_at across signals so admin knows whether
                  the AI looked at this place recently. */}
              <div>
                <span className="text-[var(--color-text-secondary)]">Last AI Evaluated:</span>{" "}
                {aiLastEvaluatedAt
                  ? `${new Date(aiLastEvaluatedAt).toLocaleDateString()} (${relativeTime(aiLastEvaluatedAt)})`
                  : "Never"}
              </div>
            </div>
          </div>

          {place.place_discovery_price_range_revisions?.length > 0 ? (
            <div>
              <h4 className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2">
                Discovery price revision trail
              </h4>
              <ul className="space-y-1 text-xs">
                {place.place_discovery_price_range_revisions.map((revision) => (
                  <li key={`${revision.created_at}-${revision.action}`} className="flex justify-between gap-3">
                    <span>{revision.action} · actor {revision.actor_id || "system"}</span>
                    <span className="text-[var(--color-text-secondary)]">
                      {new Date(revision.created_at).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* META-ORCH-1009 Sub-D — Admin re-evaluate this place.
              Forces a fresh Gemini Q2 read + rescore for one place; rate-
              limited server-side so duplicate clicks during in-flight runs
              get a friendly 429. */}
          <div>
            <h4 className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2">AI Signals</h4>
            <div className="flex items-center gap-3 flex-wrap">
              <Button
                variant="secondary"
                loading={reeval.pending}
                disabled={reeval.pending}
                onClick={handleReeval}
              >
                Re-evaluate AI signals
              </Button>
              <span className="text-xs text-[var(--color-text-secondary)] max-w-md">
                Forces a fresh Gemini Q2 read + rescore for this place. ~$0.004 each. Use when you suspect AI got it wrong.
              </span>
            </div>
            {reeval.error && (
              <div className="text-xs text-[var(--color-error-600)] mt-2">{reeval.error}</div>
            )}
          </div>

          {/* Edit Controls */}
          <div>
            <h4 className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2">Edit</h4>
            <div className="space-y-3">
              <Input label="Name" value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
              <div>
                <label className="text-xs text-[var(--color-text-secondary)]">Provider price ordinals (non-monetary)</label>
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
              {place.place_discovery_price_ranges?.status === "active" ? (
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label={`Discovery min · ${place.place_discovery_price_ranges.source_currency_code} minor units`}
                    value={editForm.discovery_min_minor}
                    onChange={(e) => setEditForm((f) => ({ ...f, discovery_min_minor: e.target.value }))}
                  />
                  <Input
                    label="Discovery max minor units (blank = open)"
                    value={editForm.discovery_max_minor}
                    onChange={(e) => setEditForm((f) => ({ ...f, discovery_max_minor: e.target.value }))}
                  />
                </div>
              ) : null}
              <Input
                label="Audit reason (required)"
                value={editForm.discovery_edit_reason}
                onChange={(e) => setEditForm((f) => ({ ...f, discovery_edit_reason: e.target.value }))}
                placeholder="Why are you changing this place?"
              />
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

          {/* ORCH-1073 — Listing actions: suspend (off the deck + notify the owner
              with a custom message + structured to-do list), soft-delete (remove
              from the pool + revoke claim + notify), or restore (admin undo). */}
          <div className="border-t border-[var(--gray-200)] pt-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider">Listing Actions</h4>
              {place.deleted_at
                ? <Badge variant="error">Removed</Badge>
                : !place.is_active
                  ? <Badge variant="warning">Off deck</Badge>
                  : <Badge variant="success">Live</Badge>}
            </div>

            {place.deleted_at ? (
              <div className="space-y-2">
                <p className="text-xs text-[var(--color-text-secondary)]">
                  Removed{place.deleted_reason ? ` — "${place.deleted_reason}"` : ""}. Restoring brings it back as active and re-verifies any claim.
                </p>
                <Button variant="secondary" loading={actionBusy} onClick={handleRestore}>Restore listing</Button>
              </div>
            ) : actionView === "suspend" ? (
              <div className="space-y-2">
                <textarea
                  className="block w-full rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm"
                  rows={2} value={suspendMsg}
                  onChange={(e) => setSuspendMsg(e.target.value)}
                  placeholder="Message to the owner — why it was suspended / what to fix (shows in their listing banner + notification)" />
                <div className="space-y-1.5">
                  {todoItems.map((it, idx) => (
                    <div className="flex gap-2 items-center" key={idx}>
                      <select
                        className="rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1.5 text-xs"
                        value={it.category}
                        onChange={(e) => setTodoItems((arr) => arr.map((x, i) => i === idx ? { ...x, category: e.target.value } : x))}>
                        {FEEDBACK_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <input
                        className="flex-1 rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm"
                        value={it.note}
                        onChange={(e) => setTodoItems((arr) => arr.map((x, i) => i === idx ? { ...x, note: e.target.value } : x))}
                        placeholder="What needs fixing (becomes a to-do item)" />
                      <button type="button" className="text-[var(--color-text-tertiary)] hover:text-[var(--color-error-700)] px-1"
                        onClick={() => setTodoItems((arr) => arr.filter((_, i) => i !== idx))}>×</button>
                    </div>
                  ))}
                  <button type="button" className="text-xs text-[var(--color-brand-600)] hover:underline"
                    onClick={() => setTodoItems((arr) => [...arr, { category: "photos", note: "" }])}>+ Add to-do item</button>
                </div>
                <input
                  className="block w-full rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1.5 text-xs"
                  value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)}
                  placeholder="Internal reason (audit log, not shown to owner)" />
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" onClick={() => setActionView(null)} disabled={actionBusy}>Cancel</Button>
                  <Button variant="primary" loading={actionBusy} onClick={handleSuspend}>Suspend &amp; notify owner</Button>
                </div>
              </div>
            ) : actionView === "delete" ? (
              <div className="space-y-2">
                <p className="text-xs text-[var(--color-error-700)]">
                  Removes the venue from the pool and revokes any claim. Reversible by an admin (Restore).
                </p>
                <textarea
                  className="block w-full rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm"
                  rows={2} value={deleteMsg} onChange={(e) => setDeleteMsg(e.target.value)}
                  placeholder="Message to the owner (optional)" />
                <input
                  className="block w-full rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1.5 text-xs"
                  value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)}
                  placeholder="Internal reason (audit log)" />
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" onClick={() => setActionView(null)} disabled={actionBusy}>Cancel</Button>
                  <Button variant="danger" loading={actionBusy} onClick={handleDelete}>Delete from pool</Button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setActionView("suspend")}>Suspend…</Button>
                <Button variant="danger" onClick={() => setActionView("delete")}>Delete…</Button>
              </div>
            )}
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
        {/* #4130 (Wave 4b): the old Deck tuner, now on the place itself. */}
        <PlaceScoreOverride place={place} />
    </Drawer>
  );
}

// ── Add City Modal (Bounding Box Model) ─────────────────────────────────────

// ORCH-0553 — TILE_RADIUS_OPTIONS moved to lib/seedingFormat.js (shared import above).

export function AddCityModal({ open, onClose, onSave }) {
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
      if (fnErr) throw new Error(await extractFunctionError(fnErr, "Geocoding failed"));
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
      const { data: tileResult, error: tileErr } = await supabase.functions.invoke("admin-seed-places", {
        body: { action: "generate_tiles", cityId: city.id },
      });
      if (tileErr) throw new Error(await extractFunctionError(tileErr, "Tile generation failed"));
      if (tileResult?.error) throw new Error(tileResult.error);

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
                  {selectedEstimate.tiles} tiles × {Math.round(selectedEstimate.apiCalls / Math.max(selectedEstimate.tiles, 1))} searches = {selectedEstimate.apiCalls.toLocaleString()} API calls · Estimated search cost: ${selectedEstimate.searchCostUsd}
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

// #4276 (B1): the Update Bbox modal is gone. A box changes only in the pipeline's
// geo box panel (apply_city_box), which keeps the larger edge and warns first.

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
  const catsFromPlaces = new Set(placesNearTile.map((p) => p.mingla_category).filter(Boolean));
  const totalCats = new Set([...seededCats, ...catsFromPlaces]);

  if (totalCats.size >= ALL_CATEGORIES.length) return "full";
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
  const [mapError, setMapError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (!selectedCity) { setPlaces([]); return; }
    setMapLoading(true);
    setMapError(null);
    let q = supabase.from("place_pool")
      .select(PLACE_MAP_COLUMNS)
      .eq("is_active", true)
      .eq("is_servable", true)
      .eq("city_id", selectedCity);
    q.limit(3000).then(({ data, error }) => {
      if (!mountedRef.current) return;
      setMapError(error ? error.message : null);
      setPlaces(data || []);
      setMapLoading(false);
    });
    return () => { mountedRef.current = false; };
  }, [selectedCountry, selectedCity, reloadKey]);

  if (!selectedCity) return <div className="rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] py-12 text-center text-sm text-[var(--color-text-secondary)]">Pick a city above to see its box, tiles and places on the map.</div>;
  if (mapLoading) return <div className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--color-text-secondary)]"><Spinner size="sm" /> Loading the map…</div>;
  // A failed load says so, with Retry; it never reads as "no places" (#4276 fix e).
  if (mapError) return <LoadError title="The map could not load places" message={mapError} onRetry={() => setReloadKey((k) => k + 1)} />;
  if (places.length === 0) return <div className="rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] py-12 text-center text-sm text-[var(--color-text-secondary)]">No places Explorers can see in this city yet.</div>;

  // Compute center from places average
  const validPlaces = places.filter((p) => p.lat && p.lng);
  const center = registeredCity
    ? [registeredCity.center_lat, registeredCity.center_lng]
    : validPlaces.length > 0
      ? [validPlaces.reduce((s, p) => s + p.lat, 0) / validPlaces.length, validPlaces.reduce((s, p) => s + p.lng, 0) / validPlaces.length]
      : [0, 0];

  // A place with no derived category stays on the map: the toggles can't hide it.
  const filteredPlaces = places.filter((p) => !p.mingla_category || visibleCats.has(p.mingla_category));
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
              pathOptions={{ color: CATEGORY_COLORS[p.mingla_category] || "#6b7280", fillColor: CATEGORY_COLORS[p.mingla_category] || "#6b7280", fillOpacity: 0.8, weight: 1 }}>
              <Popup>
                <div className="text-xs">
                  <strong>{p.name}</strong><br />
                  {CATEGORY_LABELS[p.mingla_category] || p.mingla_category || "No category"}<br />
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

// #4276 design pass: one filter card (search, city, what is missing, Explorers, and
// the List / Map switch), the stages as plain words per place, and a failed load that
// says so with Retry instead of falling through to "No places found" (fix e).
const MISSING_FILTERS = [
  { id: "", label: "Anything" },
  { id: "pre_check", label: "Pre-check not run" },
  { id: "pre_failed", label: "Failed the pre-check" },
  { id: "photos", label: "Passed, no stored photos" },
  { id: "final_check", label: "Final check not run" },
  { id: "scores", label: "Servable, no scores" },
];

const EXPLORER_FILTERS = [
  { id: "", label: "All" },
  { id: "servable", label: "Explorers can see" },
  { id: "excluded", label: "Left out" },
  { id: "not_bounced", label: "Not checked yet" },
];

function stageWord(value, yes, no, none = "Not run") {
  if (value === true) return <span className="font-medium text-[var(--color-success-700)]">{yes}</span>;
  if (value === false) return <span className="font-medium text-[var(--color-error-700)]">{no}</span>;
  return <span className="text-[var(--color-text-tertiary)]">{none}</span>;
}

const selectClass = "block h-11 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)]";

function FilterField({ label, children, className = "" }) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 text-xs font-medium text-[var(--color-text-secondary)] ${className}`}>
      {label}
      {children}
    </label>
  );
}

function BrowseTab({ scope, onRefresh, cities = [], onScopeChange, view = "list", onViewChange, registeredCity, tiles, seedingOps }) {
  const selectedCountry = scope?.countryCode;
  const selectedCity = scope?.cityId;
  const [places, setPlaces] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [picked, setPicked] = useState(null); // the place shown in the side panel
  const [filters, setFilters] = useState({ category: "", status: "active", photoStatus: "", priceTier: "", priceLevel: "", minRating: "", servableStatus: "", nameSearch: "", missing: "" });
  const [detailPlace, setDetailPlace] = useState(null);
  const PAGE_SIZE = 20;

  const fetchPlaces = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    // For country scope, load city IDs first then filter
    let countryCityIds = null;
    if (selectedCountry && !selectedCity) {
      const { data: cityRows } = await supabase.from("seeding_cities").select("id").eq("country_code", selectedCountry);
      countryCityIds = (cityRows || []).map((r) => r.id);
    }

    let q = supabase.from("place_pool").select(
      `${PLACE_LIST_COLUMNS}, place_discovery_price_ranges(brand_id,venue_id,status,source_min_minor,source_max_minor,source_currency_code,source_type,version,updated_by,updated_at), place_discovery_price_range_revisions(action,actor_id,created_at)`,
      { count: PLACE_LIST_COUNT_MODE },
    );
    if (selectedCity) q = q.eq("city_id", selectedCity);
    else if (countryCityIds && countryCityIds.length > 0) q = q.in("city_id", countryCityIds);
    if (filters.category) q = q.eq(PLACE_CATEGORY_COLUMN, filters.category);
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
    if (filters.missing === "pre_check") q = q.is("passes_pre_photo_check", null);
    else if (filters.missing === "pre_failed") q = q.eq("passes_pre_photo_check", false);
    else if (filters.missing === "photos") q = q.eq("passes_pre_photo_check", true).or("stored_photo_urls.is.null,stored_photo_urls.eq.{}");
    else if (filters.missing === "final_check") q = q.is("is_servable", null).not("stored_photo_urls", "is", null);
    else if (filters.missing === "scores") q = q.eq("is_servable", true).is("ai_signal_scores", null);
    q = q.order("created_at", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    const { data, count, error } = await q;
    // A failed load is never an empty list: the rows and count are cleared and the
    // error is shown with Retry (#4276 fix e).
    if (error) { setPlaces([]); setTotal(0); setLoadError(error.message || "The place list did not load."); }
    else { setPlaces(data || []); setTotal(count || 0); }
    setLoading(false);
  }, [selectedCountry, selectedCity, filters, page]);

  useEffect(() => { fetchPlaces(); }, [fetchPlaces]);
  useEffect(() => { setPage(0); }, [selectedCountry, selectedCity]);

  const columns = [
    { key: "name", label: "Place", render: (_, r) => (
      <button type="button" aria-pressed={picked?.id === r.id} className="flex min-h-11 cursor-pointer flex-col items-start justify-center text-left" onClick={() => setPicked(r)}>
        <b className="text-[13px] font-semibold text-[var(--color-text-primary)] hover:underline">{r.name}</b>
        <span className="text-[11px] text-[var(--color-text-tertiary)]">{placeTypeLabel(r)}</span>
      </button>
    ) },
    { key: "city", label: "City", render: (_, r) => r.city || "—" },
    { key: "rating", label: "Rating", width: "64px", render: (_, r) => r.rating ? Number(r.rating).toFixed(1) : "—" },
    { key: "passes_pre_photo_check", label: "Pre-check", render: (_, r) => stageWord(r.passes_pre_photo_check, "Passed", "Failed") },
    { key: "photos", label: "Photos", render: (_, r) => {
      const n = r.stored_photo_urls?.length || 0;
      if (n > 0) return <span className="font-medium text-[var(--color-success-700)]">{n} saved</span>;
      return <span className="text-[var(--color-text-tertiary)]">{r.passes_pre_photo_check === false ? "–" : "Not run"}</span>;
    }},
    { key: "is_servable", label: "Final", render: (_, r) => stageWord(r.is_servable, "Passed", "Failed") },
    { key: "ai_signal_scores", label: "Scores", render: (_, r) => r.is_servable !== true ? <span className="text-[var(--color-text-tertiary)]">Not run</span>
      : r.ai_signal_scores ? <span className="font-medium text-[var(--color-success-700)]">Scored</span> : <span className="font-medium text-[var(--color-error-700)]">Missing</span> },
    { key: "actions", label: "", width: "48px", className: "!px-1", cellClassName: "!px-1", render: (_, r) => <Button size="sm" variant="ghost" icon={Edit3} aria-label={`Change ${r.name}`} onClick={() => setDetailPlace(r)} /> },
  ];

  const setFilter = (key, value) => { setFilters((f) => ({ ...f, [key]: value })); setPage(0); };
  const groups = {};
  for (const c of cities) {
    const k = c.country_name || "Other";
    (groups[k] ??= []).push(c);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-4 shadow-[var(--shadow-sm)]">
        <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto]">
          <FilterField label="Search by name">
            <input className={selectClass} value={filters.nameSearch} placeholder="Place name" onChange={(e) => setFilter("nameSearch", e.target.value)} />
          </FilterField>
          <FilterField label="City">
            <select className={selectClass} value={selectedCity || (selectedCountry ? `country:${selectedCountry}` : "")}
              onChange={(e) => {
                const v = e.target.value;
                if (!onScopeChange) return;
                if (!v) onScopeChange({ countryCode: null, cityId: null });
                else if (v.startsWith("country:")) onScopeChange({ countryCode: v.slice(8), cityId: null });
                else onScopeChange({ countryCode: cities.find((c) => c.city_id === v)?.country_code ?? null, cityId: v });
              }}>
              <option value="">All cities</option>
              {Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).map(([country, list]) => (
                <optgroup key={country} label={country}>
                  <option value={`country:${list[0].country_code}`}>All of {country}</option>
                  {list.map((c) => <option key={c.city_id} value={c.city_id}>{c.city_name}</option>)}
                </optgroup>
              ))}
            </select>
          </FilterField>
          <FilterField label="Missing">
            <select className={selectClass} value={filters.missing} onChange={(e) => setFilter("missing", e.target.value)}>
              {MISSING_FILTERS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </FilterField>
          <FilterField label="Explorers">
            <select className={selectClass} value={filters.servableStatus} onChange={(e) => setFilter("servableStatus", e.target.value)}>
              {EXPLORER_FILTERS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </FilterField>
          <div className="flex items-center gap-2">
            {onViewChange && (
              <div className="flex gap-2" role="group" aria-label="View">
                {[["list", "List"], ["map", "Map"]].map(([id, label]) => (
                  <button key={id} type="button" aria-pressed={view === id} onClick={() => onViewChange(id)}
                    className={`inline-flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-[13px] font-medium ${view === id ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] font-semibold text-[var(--color-brand-700)]" : "border-[var(--gray-300)] bg-[var(--color-background-primary)] text-[var(--color-text-secondary)] hover:border-[var(--color-brand-500)]"}`}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        {view === "list" && (
          <details open={moreOpen} onToggle={(e) => setMoreOpen(e.currentTarget.open)}>
            <summary className="min-h-9 cursor-pointer content-center text-xs font-medium text-[var(--color-text-secondary)]">More filters: category, status, photos, price, rating</summary>
            <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <FilterField label="Category">
                <select className={selectClass} value={filters.category} onChange={(e) => setFilter("category", e.target.value)}>
                  <option value="">All</option>
                  {ALL_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                </select>
              </FilterField>
              <FilterField label="Status">
                <select className={selectClass} value={filters.status} onChange={(e) => setFilter("status", e.target.value)}>
                  <option value="">All</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </FilterField>
              <FilterField label="Photos">
                <select className={selectClass} value={filters.photoStatus} onChange={(e) => setFilter("photoStatus", e.target.value)}>
                  <option value="">All</option>
                  <option value="has">Has photos</option>
                  <option value="missing">Missing photos</option>
                </select>
              </FilterField>
              <FilterField label="Price tier">
                <select className={selectClass} value={filters.priceTier} onChange={(e) => setFilter("priceTier", e.target.value)}>
                  <option value="">All</option>
                  <option value="missing">Missing</option>
                  {PRICE_TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </FilterField>
              <FilterField label="Price level">
                <select className={selectClass} value={filters.priceLevel} onChange={(e) => setFilter("priceLevel", e.target.value)}>
                  <option value="">All</option>
                  <option value="missing">Missing</option>
                  <option value="PRICE_LEVEL_FREE">Free</option>
                  <option value="PRICE_LEVEL_INEXPENSIVE">Inexpensive</option>
                  <option value="PRICE_LEVEL_MODERATE">Moderate</option>
                  <option value="PRICE_LEVEL_EXPENSIVE">Expensive</option>
                  <option value="PRICE_LEVEL_VERY_EXPENSIVE">Very expensive</option>
                </select>
              </FilterField>
              <FilterField label="Min rating">
                <input type="number" min="0" max="5" step="0.5" placeholder="e.g. 4.0" className={selectClass}
                  value={filters.minRating} onChange={(e) => setFilter("minRating", e.target.value)} />
              </FilterField>
            </div>
          </details>
        )}
      </div>

      {view === "map" ? (
        <MapTab scope={scope} registeredCity={registeredCity} tiles={tiles || []} seedingOps={seedingOps || []} />
      ) : loadError ? (
        <LoadError title="Couldn't load the place list" message={loadError} onRetry={fetchPlaces} retrying={loading} />
      ) : (
        <div className="grid min-w-0 grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 overflow-hidden rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] shadow-[var(--shadow-sm)]">
            <p className="px-4 pt-3 text-xs text-[var(--color-text-secondary)]">{loading ? "Loading places…" : `${total.toLocaleString()} ${total === 1 ? "place" : "places"}, newest first. Totals over 1,000 are estimates.`}</p>
            <DataTable columns={columns} rows={places} loading={loading} headerCase="sentence"
              emptyMessage="No places match these filters" emptyIcon={Globe}
              rowClassName={(r) => (picked?.id === r.id ? "bg-[var(--color-brand-50)]" : "")}
              pagination={{ page, pageSize: PAGE_SIZE, total, from: total ? page * PAGE_SIZE + 1 : 0, to: Math.min((page + 1) * PAGE_SIZE, total), onChange: setPage }} />
          </div>
          <PlaceSidePanel place={picked} onEdit={() => setDetailPlace(picked)} onClose={() => setPicked(null)} />
        </div>
      )}

      <PlaceDetailModal place={detailPlace} open={!!detailPlace} onClose={() => setDetailPlace(null)} onSave={() => { setPicked(null); fetchPlaces(); if (onRefresh) onRefresh(); }} />
    </div>
  );
}

// #4276 design pass: the panel beside the place list. Nothing picked: what it is for.
// A place picked: where it stands at each stage, with the full edit form one tap away.
const STAGE_TONE = {
  done: "text-[var(--color-success-700)]",
  failed: "text-[var(--color-error-700)]",
  waiting: "text-[var(--color-warning-700)]",
  not_run: "text-[var(--color-text-tertiary)]",
};

export function PlaceSidePanel({ place, onEdit, onClose }) {
  return (
    <aside aria-label="Picked place" className="flex min-w-0 flex-col gap-4 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-5 shadow-[var(--shadow-sm)] xl:sticky xl:top-4">
      {!place ? (
        <p className="text-sm leading-5 text-[var(--color-text-secondary)]">Pick a place to see where it stands, and to change it.</p>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="break-words text-[15px] font-semibold text-[var(--color-text-primary)]">{place.name}</h3>
              <p className="text-xs text-[var(--color-text-secondary)]">{placeTypeLabel(place)}{place.city ? ` · ${place.city}` : ""}{place.rating ? ` · ${Number(place.rating).toFixed(1)}` : ""}</p>
            </div>
            <Button size="sm" variant="ghost" icon={X} aria-label="Close" onClick={onClose} />
          </div>
          <dl className="flex flex-col divide-y divide-[var(--gray-100)] text-[13px]">
            {placeStages(place).map((st) => (
              <div key={st.id} className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 py-2">
                <dt className="text-[var(--color-text-secondary)]">{st.label}</dt>
                <dd className={`font-medium ${STAGE_TONE[st.state]}`}>{st.text}</dd>
              </div>
            ))}
          </dl>
          <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12px]">
            <dt className="text-[var(--color-text-secondary)]">Category</dt>
            <dd>{place.mingla_category ? (CATEGORY_LABELS[place.mingla_category] || place.mingla_category) : "None"}</dd>
            <dt className="text-[var(--color-text-secondary)]">Price</dt>
            <dd>{place.place_discovery_price_ranges?.status === "active"
              ? `${place.place_discovery_price_ranges.source_min_minor}–${place.place_discovery_price_ranges.source_max_minor ?? "open"} minor · ${place.place_discovery_price_ranges.source_currency_code}`
              : place.place_discovery_price_ranges?.status === "legacy_unresolved" ? "Needs review" : "Not set"}</dd>
            <dt className="text-[var(--color-text-secondary)]">Refreshed</dt>
            <dd>{place.last_detail_refresh ? new Date(place.last_detail_refresh).toLocaleDateString() : "Never"}</dd>
            {place.address && <><dt className="text-[var(--color-text-secondary)]">Address</dt><dd className="break-words">{place.address}</dd></>}
          </dl>
          <Button variant="secondary" icon={Edit3} onClick={onEdit}>Edit place and scores</Button>
        </>
      )}
    </aside>
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
      // ORCH-1024: never surface thumbnail runs in the originals (Photos) status bar.
      if (onActiveRunsChange) {
        onActiveRunsChange((data.runs || []).filter((r) => r?.run?.city !== THUMBS_RUN_CITY));
      }
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
        // ORCH-1024: thumbnail runs share the table; keep them out of the Photos status bar.
        const cityRuns = (data.runs || []).filter((r) => r?.run?.city !== THUMBS_RUN_CITY);
        if (onActiveRunsChange) onActiveRunsChange(cityRuns);
        const match = cityRuns.find(
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


// ── Thumbnails Tab (ORCH-1024) ───────────────────────────────────────────────
// Clones the PhotoTab job runner but drives the SEPARATE
// `backfill-place-photo-thumbs` edge function. This is a GLOBAL run over every
// place that has stored originals but no thumbnails (no city scoping). Moving
// thumbnail generation off the originals-download hot path is what keeps the main
// `backfill-place-photos` function from crashing with "not enough compute
// resources" (ORCH-0957 had inlined imagescript decode/resize/encode). Same
// admin auth + same action surface (preview_run / create_run / run_next_batch /
// run_status / active_runs / pause_run / resume_run / cancel_run / retry_batch /
// skip_batch). estimatedCost is always $0; create_run takes no city/country args.

function ThumbnailTab() {
  const { addToast } = useToast();
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const [loading, setLoading] = useState(false);
  const [pendingCount, setPendingCount] = useState(null);

  const [activeRun, setActiveRun] = useState(null);
  const [batches, setBatches] = useState([]);
  const [runningBatch, setRunningBatch] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [creating, setCreating] = useState(false);
  const [expandedBatch, setExpandedBatch] = useState(null);
  // Aggregate thumbnail counters surfaced by run_next_batch responses.
  const [thumbsWritten, setThumbsWritten] = useState(0);
  const [thumbsAlreadyPresent, setThumbsAlreadyPresent] = useState(0);
  // ORCH-1033 (C/E): optional city scoping for the run (resolved server-side to
  // city_id via seeding_cities). Empty string = global servable backlog.
  const [cityList, setCityList] = useState([]);
  const [selectedCity, setSelectedCity] = useState("");

  const invoke = async (body) => {
    const { data, error } = await supabase.functions.invoke("backfill-place-photo-thumbs", { body });
    if (error) {
      const msg = await extractFunctionError(error, "Edge function error");
      throw new Error(msg);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  };

  // Accumulate per-batch thumb counters when the function reports them.
  const accumulateThumbCounters = (data) => {
    if (data && typeof data.thumbsWritten === "number") {
      setThumbsWritten((prev) => prev + data.thumbsWritten);
    }
    if (data && typeof data.thumbsAlreadyPresent === "number") {
      setThumbsAlreadyPresent((prev) => prev + data.thumbsAlreadyPresent);
    }
  };

  // ── Pending preview (totalPlaces = places with originals but no thumbs) ─────

  const fetchPreview = async () => {
    try {
      const data = await invoke({ action: "preview_run" });
      if (mountedRef.current) setPendingCount(Number(data.totalPlaces) || 0);
    } catch {
      if (mountedRef.current) setPendingCount(null);
    }
  };

  // ── Load the optional city list (for scoped runs) ──────────────────────────

  useEffect(() => {
    supabase.from("seeding_cities").select("id, name").order("name", { ascending: true })
      .then(({ data }) => {
        if (mountedRef.current && Array.isArray(data)) setCityList(data);
      });
  }, []);

  // ── Hydrate the (single, global) active thumbnail run on mount ─────────────

  useEffect(() => {
    setLoading(true);
    let cancelled = false;
    (async () => {
      await fetchPreview();
      try {
        const data = await invoke({ action: "active_runs" });
        if (cancelled) return;
        const match = (data.runs || [])[0];
        if (match) {
          const status = await invoke({ action: "run_status", runId: match.id });
          if (!cancelled) { setActiveRun(status.run); setBatches(status.batches || []); }
        } else if (!cancelled) {
          setActiveRun(null); setBatches([]);
        }
      } catch { /* ignore */ }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // ── ORCH-1033 (E): poll the SERVER run for display while non-terminal ───────
  // The run is driven server-side (process_chunk self-invoke + cron). This poll
  // is for the progress UI ONLY — closing/reloading the tab does NOT stop the run.
  useEffect(() => {
    if (!activeRun) return;
    if (["completed", "cancelled", "failed"].includes(activeRun.status)) return;
    const runId = activeRun.id;
    const timer = setInterval(async () => {
      try {
        const status = await invoke({ action: "run_status", runId });
        if (!mountedRef.current) return;
        setActiveRun(status.run);
        setBatches(status.batches || []);
        if (typeof status.remainingPlaces === "number") setPendingCount(status.remainingPlaces);
      } catch { /* transient — next tick retries */ }
    }, 4000);
    return () => clearInterval(timer);
  }, [activeRun?.id, activeRun?.status]);

  // ── Create run (global — no city/country args) ─────────────────────────────

  const handleCreateRun = async () => {
    setCreating(true);
    try {
      // ORCH-1033: create_run server-kicks process_chunk; the run advances on the
      // server. Pass the optional city to scope to one city's servable backlog.
      const body = { action: "create_run" };
      if (selectedCity) body.city = selectedCity;
      const data = await invoke(body);
      if (data.status === "nothing_to_do") {
        addToast({ variant: "info", title: "No thumbnails to generate", description: "Every place with originals already has thumbnails." });
        await fetchPreview();
        setCreating(false);
        return;
      }
      if (data.status === "already_active") {
        const status = await invoke({ action: "run_status", runId: data.runId });
        setActiveRun(status.run); setBatches(status.batches || []);
        setCreating(false);
        return;
      }
      const status = await invoke({ action: "run_status", runId: data.runId });
      setActiveRun(status.run); setBatches(status.batches || []);
      addToast({
        variant: "success",
        title: "Thumbnail run created",
        description: `${formatCount(data.totalPlaces)} places, ${formatCount(data.totalBatches)} batches`,
      });
      await fetchPreview();
    } catch (err) {
      console.error("[ThumbnailBackfill] create run error:", err);
      addToast({ variant: "error", title: "Failed to create run", description: err.message });
    }
    setCreating(false);
  };

  // ── Run Next Batch ─────────────────────────────────────────────────────────

  const handleRunNext = async () => {
    if (!activeRun || runningBatch) return;
    setRunningBatch(true);
    try {
      const data = await invoke({ action: "run_next_batch", runId: activeRun.id });
      accumulateThumbCounters(data);
      if (data.done) addToast({ variant: "success", title: "All batches complete!" });
      const status = await invoke({ action: "run_status", runId: activeRun.id });
      setActiveRun(status.run); setBatches(status.batches || []);
    } catch (err) {
      addToast({ variant: "error", title: "Batch failed", description: err.message });
    }
    setRunningBatch(false);
    await fetchPreview();
  };

  // ── Run All (resume the SERVER run) ────────────────────────────────────────
  // ORCH-1033 (E): the browser run-loop is DELETED. The run is driven server-side
  // (process_chunk self-invoke chain + the kick_pending_thumb_backfill cron). This
  // button just resumes a paused run and re-kicks it; the polling effect refreshes
  // progress. Closing the tab does NOT stop the run.

  const handleRunAll = async () => {
    if (!activeRun) return;
    setAutoRunning(true);
    try {
      // resume_run server-re-kicks process_chunk.
      await invoke({ action: "resume_run", runId: activeRun.id });
      const status = await invoke({ action: "run_status", runId: activeRun.id });
      if (mountedRef.current) { setActiveRun(status.run); setBatches(status.batches || []); }
      addToast({ variant: "success", title: "Run resumed", description: "The thumbnail run is now generating on the server." });
    } catch (err) {
      addToast({ variant: "error", title: "Failed to resume", description: err.message });
    }
    setAutoRunning(false);
  };

  // ── Pause / Cancel / Retry / Skip / Dismiss ────────────────────────────────

  const handlePause = async () => {
    try {
      await invoke({ action: "pause_run", runId: activeRun.id });
      const status = await invoke({ action: "run_status", runId: activeRun.id });
      setActiveRun(status.run); setBatches(status.batches || []);
    } catch (err) {
      addToast({ variant: "error", title: "Pause failed", description: err.message });
    }
  };

  const handleCancel = async () => {
    try {
      await invoke({ action: "cancel_run", runId: activeRun.id });
      const status = await invoke({ action: "run_status", runId: activeRun.id });
      setActiveRun(status.run); setBatches(status.batches || []);
      addToast({ variant: "info", title: "Run cancelled" });
    } catch (err) {
      addToast({ variant: "error", title: "Cancel failed", description: err.message });
    }
  };

  const handleRetryBatch = async (batchId) => {
    setRunningBatch(true);
    try {
      await invoke({ action: "retry_batch", runId: activeRun.id, batchId });
      const status = await invoke({ action: "run_status", runId: activeRun.id });
      setActiveRun(status.run); setBatches(status.batches || []);
      addToast({ variant: "success", title: "Batch retried" });
    } catch (err) {
      addToast({ variant: "error", title: "Retry failed", description: err.message });
    }
    setRunningBatch(false);
    await fetchPreview();
  };

  const handleSkipBatch = async (batchId) => {
    try {
      await invoke({ action: "skip_batch", runId: activeRun.id, batchId });
      const status = await invoke({ action: "run_status", runId: activeRun.id });
      setActiveRun(status.run); setBatches(status.batches || []);
    } catch (err) {
      addToast({ variant: "error", title: "Skip failed", description: err.message });
    }
  };

  const handleDismiss = () => {
    setActiveRun(null);
    setBatches([]);
    fetchPreview();
  };

  // ── Derived values ─────────────────────────────────────────────────────────

  const runProgressPct = activeRun && activeRun.total_batches > 0
    ? Math.round(((activeRun.completed_batches + activeRun.failed_batches + activeRun.skipped_batches) / activeRun.total_batches) * 100)
    : 0;
  const isTerminal = activeRun && ["completed", "cancelled", "failed"].includes(activeRun.status);
  const canRunNext = activeRun && !isTerminal && !runningBatch && !autoRunning;
  const canRunAll = activeRun && !isTerminal && !autoRunning;
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
      <div className="grid grid-cols-4 gap-4">
        <StatCard icon={ImageIcon} label="Pending Thumbnails" value={pendingCount ?? "—"} />
        <StatCard icon={CheckCircle} label="Thumbs Written" value={formatCount(thumbsWritten)} />
        <StatCard icon={Layers} label="Already Present" value={formatCount(thumbsAlreadyPresent)} />
        <StatCard icon={DollarSign} label="Est. Cost" value="$0.00" />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-[var(--color-text-secondary)]">
          <Loader className="w-4 h-4 animate-spin" /> Loading thumbnail status...
        </div>
      ) : !activeRun ? (
        /* ── Phase 1: No active run ──────────────────────────────────── */
        <SectionCard title="Generate Thumbnails"
          subtitle="Creates 384×384 thumbnails for every place that has stored originals but no thumbnail yet. Global run — no city selection needed.">
          {pendingCount === 0 ? (
            <div className="py-4">
              <div className="flex items-center gap-2 text-sm text-[var(--color-success-700)]">
                <CheckCircle className="w-4 h-4" /> Every place with originals already has thumbnails.
              </div>
              <Button size="sm" variant="secondary" icon={RefreshCw} className="mt-3" onClick={fetchPreview}>
                Re-check
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg p-4 bg-[var(--gray-50)]">
                <div className="text-sm space-y-2">
                  <div>
                    <strong>{pendingCount === null ? "—" : formatCount(pendingCount)}</strong> places have originals but no thumbnails.
                  </div>
                  <div className="text-[var(--color-text-secondary)]">
                    Thumbnails are generated from already-stored originals (no Google calls). Estimated cost: <strong>$0.00</strong>.
                  </div>
                </div>
              </div>
              {/* ORCH-1033 (C/E): optional city scope — empty = global servable backlog. */}
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[var(--color-text-secondary)]">Scope (optional)</label>
                <select
                  className="block w-full max-w-xs rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm"
                  value={selectedCity}
                  onChange={(e) => setSelectedCity(e.target.value)}
                >
                  <option value="">All cities (global servable backlog)</option>
                  {cityList.map((c) => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" icon={ImageIcon} onClick={handleCreateRun} disabled={creating}>
                  {creating
                    ? "Creating..."
                    : selectedCity
                      ? `Run for ${selectedCity}`
                      : `Run All (${pendingCount === null ? "—" : formatCount(pendingCount)} places)`}
                </Button>
                <Button variant="secondary" icon={RefreshCw} onClick={fetchPreview} size="sm">
                  Re-check
                </Button>
              </div>
            </div>
          )}
        </SectionCard>
      ) : (
        /* ── Phase 2: Active run ─────────────────────────────────────── */
        <div className="space-y-4">
          <SectionCard title="Thumbnail Generation"
            badge={<span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[activeRun.status] || ""}`}>{activeRun.status}</span>}>
            <div className="space-y-4">
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <span>{activeRun.completed_batches + activeRun.failed_batches + activeRun.skipped_batches}/{activeRun.total_batches} batches</span>
                <span className="text-[var(--color-success-700)]">{activeRun.total_succeeded} succeeded</span>
                {activeRun.total_failed > 0 && <span className="text-[var(--color-error-700)]">{activeRun.total_failed} failed</span>}
                {activeRun.total_skipped > 0 && <span className="text-[var(--color-text-secondary)]">{activeRun.total_skipped} skipped</span>}
                {thumbsWritten > 0 && <span>{formatCount(thumbsWritten)} thumbs written</span>}
                {thumbsAlreadyPresent > 0 && <span className="text-[var(--color-text-secondary)]">{formatCount(thumbsAlreadyPresent)} already present</span>}
              </div>

              <div className="flex items-center gap-3">
                <div className="flex-1 bg-[var(--gray-100)] rounded-full h-3 overflow-hidden">
                  <div className="h-full rounded-full bg-[var(--color-brand-500)] transition-all duration-500"
                    style={{ width: `${runProgressPct}%` }} />
                </div>
                <span className="text-sm font-medium w-12 text-right">{runProgressPct}%</span>
              </div>

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

          <SectionCard title="Batches" subtitle={`${batches.length} total`}>
            <div className="divide-y divide-[var(--color-border)]">
              {batches.map((b) => {
                const isExpanded = expandedBatch === b.id;
                const hasFailed = b.failed_places && b.failed_places.length > 0;
                return (
                  <div key={b.id} className="py-2">
                    <div className="flex items-center gap-3 text-sm">
                      {b.status === "pending" && <span className="w-4 h-4 rounded-full bg-gray-300 inline-block" />}
                      {b.status === "running" && <Loader className="w-4 h-4 animate-spin text-[var(--color-brand-600)]" />}
                      {b.status === "completed" && <CheckCircle className="w-4 h-4 text-[var(--color-success-700)]" />}
                      {b.status === "failed" && <XCircle className="w-4 h-4 text-[var(--color-error-700)]" />}
                      {b.status === "skipped" && <MinusCircle className="w-4 h-4 text-gray-400" />}

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

                      {hasFailed && b.status !== "pending" && (
                        <button className="ml-auto p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                          onClick={() => setExpandedBatch(isExpanded ? null : b.id)}>
                          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                      )}
                    </div>

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

// #4276 design pass: "Places left out", one row per place (name and type, city, reason
// in words, Remove from active). There is deliberately no override here: the checks
// decide what Explorers see. Removing goes through the audited admin_deactivate_place
// and asks first. A failed load shows the error and Retry, never an empty list (fix e).
function ExcludedTab({ scope, onRefresh, cities = [], onScopeChange }) {
  const { addToast } = useToast();
  const [places, setPlaces] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [filterCat, setFilterCat] = useState(""); // category filter for the list
  const [detailPlace, setDetailPlace] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);
  const PAGE_SIZE = 20;

  const fetchExcluded = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    let q = supabase.from("place_pool")
      .select(PLACE_LIST_COLUMNS, { count: PLACE_LIST_COUNT_MODE })
      .eq("is_active", true)
      .eq("is_servable", false);
    if (scope.cityId) q = q.eq("city_id", scope.cityId);
    if (filterCat) q = q.eq(PLACE_CATEGORY_COLUMN, filterCat);
    q = q.order("name").range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    const { data, count, error } = await q;
    if (error) { setPlaces([]); setTotal(0); setLoadError(error.message || "The list did not load."); }
    else { setPlaces(data || []); setTotal(count || 0); }
    setLoading(false);
  }, [scope.cityId, page, filterCat]);

  useEffect(() => { fetchExcluded(); }, [fetchExcluded]);
  useEffect(() => { setPage(0); }, [scope.cityId, filterCat]);

  const handleRemove = async () => {
    const place = removing;
    if (!place) return;
    setBusy(true);
    // #4276 U5: the audited path. It records who removed the place and why in
    // place_admin_actions; a direct table update left no trace.
    const result = await supabase.rpc("admin_deactivate_place", {
      p_place_id: place.id,
      p_reason: "Removed from the Excluded list",
    });
    setBusy(false);
    const deactivateError = adminDeactivateError(result);
    if (deactivateError) { addToast({ variant: "error", title: "It was not removed", description: deactivateError }); return; }
    addToast({ variant: "success", title: `${place.name} removed from the active pool` });
    setRemoving(null);
    fetchExcluded();
    if (onRefresh) onRefresh();
  };

  const columns = [
    { key: "name", label: "Place", render: (_, r) => (
      <button type="button" className="flex min-h-11 min-w-[200px] cursor-pointer flex-col items-start justify-center text-left" onClick={() => setDetailPlace(r)}>
        <b className="text-[13px] font-semibold text-[var(--color-text-primary)] hover:underline">{r.name}</b>
        <span className="text-[11px] text-[var(--color-text-tertiary)]">{placeTypeLabel(r)}</span>
      </button>
    )},
    { key: "city", label: "City", render: (_, r) => r.city || "—" },
    { key: "bouncer_reason", label: "Reason", render: (_, r) => <span className="text-[13px]">{reasonWords(r.bouncer_reason)}</span> },
    { key: "actions", label: "", render: (_, r) => (
      <Button size="sm" variant="secondary" onClick={() => setRemoving(r)}>Remove from active</Button>
    )},
  ];

  return (
    <SectionCard
      title="Places left out"
      subtitle="There is deliberately no override here: the check decides what Explorers see. Removing takes a place out of the active pool."
      action={
        <div className="flex flex-wrap gap-2">
          <select aria-label="City" className="h-10 rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm"
            value={scope.cityId || ""} onChange={(e) => onScopeChange?.({ countryCode: cities.find((c) => c.city_id === e.target.value)?.country_code ?? null, cityId: e.target.value || null })}>
            <option value="">All cities</option>
            {cities.map((c) => <option key={c.city_id} value={c.city_id}>{c.city_name}</option>)}
          </select>
          <select aria-label="Category" className="h-10 rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm"
            value={filterCat} onChange={(e) => setFilterCat(e.target.value)}>
            <option value="">All categories</option>
            {ALL_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </select>
        </div>
      }
      noPadding
    >
      {loadError ? (
        <div className="p-4"><LoadError title="Couldn't load the places left out" message={loadError} onRetry={fetchExcluded} retrying={loading} /></div>
      ) : (
        <>
          <p className="px-4 pt-3 text-xs text-[var(--color-text-secondary)]">{loading ? "Loading…" : `${total.toLocaleString()} ${total === 1 ? "place" : "places"} left out by the final check, by name. Totals over 1,000 are estimates.`}</p>
          <DataTable columns={columns} rows={places} loading={loading} headerCase="sentence"
            emptyMessage="No places were left out here" emptyIcon={CheckCircle}
            pagination={{ page, pageSize: PAGE_SIZE, total, from: total ? page * PAGE_SIZE + 1 : 0, to: Math.min((page + 1) * PAGE_SIZE, total), onChange: setPage }} />
        </>
      )}

      <Modal open={!!removing} onClose={busy ? () => {} : () => setRemoving(null)} title={`Remove ${removing?.name ?? "this place"} from the active pool?`} size="sm" destructive>
        <ModalBody>
          <p className="text-sm text-[var(--color-text-secondary)]">It stops being searched, checked or scored. The removal is recorded with your name. Explorers never saw it, because the check left it out.</p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setRemoving(null)} disabled={busy}>Keep it</Button>
          <Button variant="danger" onClick={handleRemove} loading={busy}>Remove from active</Button>
        </ModalFooter>
      </Modal>

      {/* Place detail modal — reuses the same modal as Browse tab */}
      <PlaceDetailModal place={detailPlace} open={!!detailPlace}
        onClose={() => setDetailPlace(null)} onSave={() => { fetchExcluded(); }} />
    </SectionCard>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

// #4130 (Wave 4b), #4276: Place pool shows this page in several places, each with
// only its own tools. Pipeline's hand tools: seeding chosen categories, refresh,
// photos and thumbnails (scoring moved to the pipeline's Scoring tools, with no
// city-wide score). Browse: the list; a place opens with its score override (the old
// Deck tuner). Map: the map. Excluded: the places the checks left out, with the reason.
const SECTION_TABS = {
  pipeline: [
    { id: "seeding", label: "Seeding" },
    { id: "refresh", label: "Refresh" },
    { id: "photos", label: "Photos" },
    { id: "thumbnails", label: "Thumbnails" },
  ],
  // #4276: Browse and map is one Place pool tab; its List / Map switch is in the
  // filter card, not a tab row.
  browse: [{ id: "browse", label: "List" }],
  map: [{ id: "map", label: "Map" }],
  excluded: [{ id: "excluded", label: "Excluded by Bouncer" }],
};

export function PlacePoolManagementPage({ section = "browse", initialView = "list" }) {
  const mountedRef = useRef(true);
  const { addToast } = useToast();
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // ── Scope-based navigation (replaces old text-based country/city selection) ──
  const [scope, setScope] = useState({ countryCode: null, cityId: null });
  const [pickerCities, setPickerCities] = useState([]);

  // Tab state
  const tabs = SECTION_TABS[section] || SECTION_TABS.browse;
  const [activeTab, setActiveTab] = useState(tabs[0].id);
  const [browseView, setBrowseView] = useState(initialView === "map" ? "map" : "list");
  const [, setSeedingActive] = useState(false);

  // Seeding state (loaded when a city is selected)
  const [registeredCity, setRegisteredCity] = useState(null);
  const [tiles, setTiles] = useState([]);
  const [stats, setStats] = useState(null);
  const [seedingOps, setSeedingOps] = useState([]);
  const [addCityOpen, setAddCityOpen] = useState(false);
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
      .then(({ data }) => {
        if (mountedRef.current && data?.runs) {
          // ORCH-1024: exclude thumbnail runs (shared table, synthetic city marker)
          // so the Photos status bar only ever shows real city download runs.
          setActivePhotoRuns(data.runs.filter((r) => r?.run?.city !== THUMBS_RUN_CITY));
        }
      })
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
          supabase.from("seeding_tiles").select("*").eq("city_id", data.id).is("retired_at", null).in("kind", ["grid", "fill"]).order("tile_index")
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

  const handleAddCity = (city) => {
    refresh();
    setScope({ countryCode: city.country_code || null, cityId: city.id });
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
    <div className="space-y-6">
      {section === "pipeline" && (
        <PageHeader
          title="Place pool"
          description={`${scopeLabel} · ${totalServable.toLocaleString()} servable places`}
          actions={
            <>
              <CityPicker cities={pickerCities} scope={scope} onScopeChange={setScope} />
              {section === "pipeline" && <Button icon={Plus} size="sm" onClick={() => setAddCityOpen(true)}>Add City</Button>}
            </>
          }
        />
      )}

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

      {tabs.length > 1 && <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />}

      <div className="mt-4" key={refreshKey}>
        {activeTab === "browse" && (
          <BrowseTab scope={scope} onRefresh={refresh} cities={pickerCities} onScopeChange={setScope}
            view={browseView} onViewChange={setBrowseView} registeredCity={registeredCity} tiles={tiles} seedingOps={seedingOps} />
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
        {activeTab === "thumbnails" && (
          /* ORCH-1024: global thumbnail backfill — no city scope required. */
          <ThumbnailTab />
        )}
        {activeTab === "excluded" && (
          <ExcludedTab scope={scope} onRefresh={refresh} cities={pickerCities} onScopeChange={setScope} />
        )}
      </div>

      <AddCityModal open={addCityOpen} onClose={() => setAddCityOpen(false)} onSave={handleAddCity} />
    </div>
  );
}

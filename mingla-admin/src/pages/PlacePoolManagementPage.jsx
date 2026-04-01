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
import { MapContainer, TileLayer, CircleMarker, Circle, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import {
  Globe, Search, Camera, Clock, Plus, RefreshCw, Play,
  ChevronDown, ChevronRight, AlertTriangle, CheckCircle,
  Download, ImageOff, Eye, Edit3, DollarSign, Layers,
  Square, SkipForward, XCircle, Loader, RotateCcw, Zap,
} from "lucide-react";
import { supabase } from "../lib/supabase";
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

// ── Constants ────────────────────────────────────────────────────────────────

// Tabs are computed dynamically in the main page component based on registration state

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

// ── CountryFilterBar (breadcrumb nav) ────────────────────────────────────────

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
          onChange={(e) => { if (e.target.value) onSelectCountry(e.target.value); }}
        >
          <option value="">Jump to country...</option>
          {countries.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      )}
    </div>
  );
}

// ── OverviewTab ─────────────────────────────────────────────────────────────

function OverviewTab({ selectedCountry, selectedCity, onSelectCountry, onSelectCity }) {
  const { addToast } = useToast();
  const [data, setData] = useState(null);
  const [drilldownRows, setDrilldownRows] = useState([]);
  const [catBreakdown, setCatBreakdown] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [validating, setValidating] = useState(false);
  const [activeJob, setActiveJob] = useState(null); // persisted job row
  const mountedRef = useRef(true);
  const jobLoopRef = useRef(false); // prevents duplicate loops
  const jobCancelledRef = useRef(false); // separate signal to stop the job loop

  const fetchData = useCallback(() => {
    mountedRef.current = true;
    setLoading(true);
    setError(null);

    const params = {};
    if (selectedCountry) params.p_country = selectedCountry;
    if (selectedCity) params.p_city = selectedCity;

    const promises = [
      supabase.rpc("admin_place_pool_overview", params),
      supabase.rpc("admin_place_category_breakdown", params),
    ];

    if (!selectedCity) {
      if (selectedCountry) {
        promises.push(supabase.rpc("admin_place_city_overview", { p_country: selectedCountry }));
      } else {
        promises.push(supabase.rpc("admin_place_country_overview"));
      }
    }

    Promise.all(promises).then((results) => {
      if (!mountedRef.current) return;
      const [overviewRes, catRes, drillRes] = results;
      if (overviewRes.error) { setError(overviewRes.error.message); setLoading(false); return; }
      const row = Array.isArray(overviewRes.data) ? overviewRes.data[0] : overviewRes.data;
      setData(row);
      setCatBreakdown(catRes.data || []);
      setDrilldownRows(drillRes?.data || []);
      setLoading(false);
    });
  }, [selectedCountry, selectedCity]);

  // ── Job-driven validation loop (persists across page refreshes) ──────────
  const runJobLoop = async (job, isResume = false) => {
    // If a loop is already running, stop the OLD one first
    if (jobLoopRef.current) {
      jobCancelledRef.current = true;
      // Wait a tick for the old loop to exit
      await new Promise((r) => setTimeout(r, 100));
    }
    jobLoopRef.current = true;
    jobCancelledRef.current = false;
    setActiveJob(job);
    console.log(`[AI Validation] Starting ${isResume ? "resumed" : "new"} job ${job.id}`);

    let { id: jobId, processed, approved, rejected, failed, continuation_token: token } = job;

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (jobCancelledRef.current) break;

        console.log("[AI Validation] Calling edge function, batch starting from:", token || "beginning");
        const resp = await supabase.functions.invoke("ai-validate-places", {
          body: {
            limit: 25,
            revalidate: job.revalidate,
            ...(token ? { afterCreatedAt: token } : {}),
            ...(job.country_filter ? { countryFilter: job.country_filter } : {}),
            ...(job.city_filter ? { cityFilter: job.city_filter } : {}),
          },
        });

        console.log("[AI Validation] Edge function response:", { error: resp.error, dataType: typeof resp.data, data: resp.data });

        if (resp.error) {
          const errMsg = resp.error?.message || resp.error?.context?.statusText || JSON.stringify(resp.error);
          throw new Error(errMsg);
        }

        const r = typeof resp.data === "string" ? JSON.parse(resp.data) : resp.data;
        if (!r || typeof r.processed !== "number") {
          throw new Error("Unexpected response: " + JSON.stringify(r));
        }
        console.log("[AI Validation] Batch result:", r.processed, "processed,", r.approved, "approved,", r.rejected, "rejected");

        processed += r.processed;
        approved += r.approved;
        rejected += r.rejected;
        failed += r.failed;
        token = r.continuation_token;

        const done = r.processed === 0 || !r.continuation_token;
        const updatedJob = {
          processed, approved, rejected, failed,
          continuation_token: token,
          status: done ? "completed" : "running",
          updated_at: new Date().toISOString(),
        };
        await supabase.from("ai_validation_jobs").update(updatedJob).eq("id", jobId);
        setActiveJob((prev) => ({ ...prev, ...updatedJob }));

        if (done) {
          addToast({
            variant: "success",
            title: `${job.revalidate ? "Revalidated" : "Validated"} ${processed} places`,
            description: `${approved} approved, ${rejected} rejected, ${failed} failed`,
          });
          fetchData();
          break;
        }
      }
    } catch (err) {
      console.error("Job loop error:", err);
      await supabase.from("ai_validation_jobs").update({
        status: "failed", error_message: String(err?.message || err), updated_at: new Date().toISOString(),
      }).eq("id", jobId);
      setActiveJob(null);
      addToast({
        variant: "error",
        title: `Validation stopped after ${processed} places`,
        description: String(err?.message || err),
      });
      fetchData();
    } finally {
      jobLoopRef.current = false;
    }
  };

  const startJob = async (revalidate) => {
    const totalPlaces = data?.active_places || 0;
    const { data: job, error: insertErr } = await supabase.from("ai_validation_jobs").insert({
      revalidate,
      total_places: totalPlaces,
      country_filter: selectedCountry || null,
      city_filter: selectedCity || null,
    }).select().single();
    if (insertErr) {
      addToast({ variant: "error", title: "Failed to create job", description: insertErr.message });
      return;
    }
    runJobLoop(job);
  };

  const cancelJob = async () => {
    if (!activeJob) return;
    jobCancelledRef.current = true;
    await supabase.from("ai_validation_jobs").update({
      status: "cancelled", updated_at: new Date().toISOString(),
    }).eq("id", activeJob.id);
    setActiveJob(null);
    jobLoopRef.current = false;
    addToast({ variant: "info", title: "Validation cancelled" });
    fetchData();
  };

  // Check for active job on mount (resume after page refresh)
  useEffect(() => {
    supabase.from("ai_validation_jobs")
      .select("*")
      .eq("status", "running")
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data: jobs }) => {
        if (jobs && jobs.length > 0) {
          const job = jobs[0];
          const matchesScope =
            (job.country_filter || null) === (selectedCountry || null) &&
            (job.city_filter || null) === (selectedCity || null);
          if (matchesScope) runJobLoop(job, true);
        }
      });
  }, []);

  useEffect(() => {
    fetchData();
    return () => { mountedRef.current = false; };
  }, [fetchData]);

  if (loading) return <div className="text-center py-12 text-[var(--color-text-secondary)]">Loading pool data...</div>;
  if (error) return <div className="text-sm text-[var(--color-error-700)] bg-[var(--color-error-50)] p-3 rounded-lg">{error}</div>;
  if (!data) return <div className="text-center py-12 text-[var(--color-text-tertiary)]">No pool data available.</div>;

  const scope = selectedCity
    ? <>{selectedCountry} &gt; <strong>{selectedCity}</strong></>
    : selectedCountry ? <strong>{selectedCountry}</strong> : "global pool";

  const aiPct = data.active_places > 0 ? Math.round((data.ai_validated_count / data.active_places) * 100) : 0;

  const isGlobal = !selectedCountry;
  const isCountryLevel = !!selectedCountry && !selectedCity;

  // Drill-down columns
  const countryDrillColumns = [
    { key: "country", label: "Country", sortable: true, render: (_, r) => (
      <button onClick={() => onSelectCountry(r.country)} className="text-[var(--color-brand-500)] hover:underline cursor-pointer font-medium text-left">{r.country}</button>
    )},
    { key: "active_places", label: "Active Places", sortable: true },
    { key: "photo_pct", label: "Photo %", sortable: true, render: (_, r) => <Badge variant={pctColor(r.photo_pct || 0)}>{r.photo_pct || 0}%</Badge> },
    { key: "ai_validated_pct", label: "AI Validated %", sortable: true, render: (_, r) => <Badge variant={pctColor(r.ai_validated_pct || 0)}>{r.ai_validated_pct || 0}%</Badge> },
    { key: "category_coverage", label: "Categories", sortable: true, render: (_, r) => `${r.category_coverage || 0}/13` },
    { key: "city_count", label: "Cities", sortable: true },
  ];

  const cityDrillColumns = [
    { key: "city_name", label: "City", sortable: true, render: (_, r) => (
      <button onClick={() => onSelectCity(r.city_name)} className="text-[var(--color-brand-500)] hover:underline cursor-pointer font-medium text-left">{r.city_name}</button>
    )},
    { key: "active_places", label: "Active Places", sortable: true },
    { key: "photo_pct", label: "Photo %", sortable: true, render: (_, r) => <Badge variant={pctColor(r.photo_pct || 0)}>{r.photo_pct || 0}%</Badge> },
    { key: "ai_validated_pct", label: "AI Validated %", sortable: true, render: (_, r) => <Badge variant={pctColor(r.ai_validated_pct || 0)}>{r.ai_validated_pct || 0}%</Badge> },
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
    { key: "place_count", label: "Places", sortable: true },
    { key: "photo_pct", label: "Photo %", sortable: true, render: (_, r) => <Badge variant={pctColor(r.photo_pct || 0)}>{r.photo_pct || 0}%</Badge> },
    { key: "ai_validated", label: "AI Validated", sortable: true },
    { key: "ai_approved_count", label: "Approved", sortable: true },
    { key: "ai_rejected_count", label: "Rejected", sortable: true },
    { key: "avg_rating", label: "Avg Rating", sortable: true, render: (_, r) => r.avg_rating ? `★ ${r.avg_rating}` : "—" },
  ];

  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--color-text-secondary)]">Showing {scope}</p>

      <div className="grid grid-cols-4 gap-4">
        <StatCard icon={Globe} label="Active Places" value={data.active_places} />
        <StatCard icon={Camera} label="Photo Coverage" value={`${data.photo_pct}%`}
          trend={data.photo_pct >= 80 ? "Good" : data.photo_pct >= 50 ? "Fair" : "Low"} trendUp={data.photo_pct >= 80} />
        <StatCard icon={Eye} label="AI Validated" value={`${aiPct}%`}
          trend={`${data.ai_validated_count} of ${data.active_places}`} trendUp={aiPct >= 50} />
        <StatCard icon={AlertTriangle} label="Uncategorized" value={data.without_seeding_category}
          trend={data.without_seeding_category === 0 ? "Clean" : "Needs Fix"} trendUp={data.without_seeding_category === 0} />
      </div>

      {/* AI Validation Summary + Run buttons */}
      {(data.ai_pending_count > 0 || data.ai_validated_count > 0) && (
        <SectionCard title="AI Validation Summary">
          <div className="grid grid-cols-4 gap-4 mb-4">
            <StatCard label="Validated" value={data.ai_validated_count} />
            <StatCard label="Approved" value={data.ai_approved_count} />
            <StatCard label="Rejected" value={data.ai_rejected_count} />
            <StatCard label="Pending" value={data.ai_pending_count} />
          </div>

          {/* Active job progress bar */}
          {activeJob && (
            <div className="mb-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-[var(--color-text-secondary)]">
                  {activeJob.revalidate ? "Revalidating" : "Validating"} places...
                </span>
                <span className="font-medium">
                  {activeJob.processed} / {activeJob.total_places}
                  {activeJob.total_places > 0 && ` (${Math.round((activeJob.processed / activeJob.total_places) * 100)}%)`}
                </span>
              </div>
              <div className="w-full bg-[var(--color-bg-tertiary)] rounded-full h-2.5">
                <div
                  className="bg-[var(--color-brand-500)] h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${activeJob.total_places > 0 ? Math.round((activeJob.processed / activeJob.total_places) * 100) : 0}%` }}
                />
              </div>
              <div className="flex gap-4 text-xs text-[var(--color-text-tertiary)]">
                <span>{activeJob.approved} approved</span>
                <span>{activeJob.rejected} rejected</span>
                <span>{activeJob.failed} failed</span>
              </div>
            </div>
          )}

          <div className="flex gap-3 items-center">
            {data.ai_pending_count > 0 && !activeJob && (
              <Button icon={Zap} variant="primary" size="sm" loading={validating}
                onClick={async () => {
                  setValidating(true);
                  try {
                    const { data: result, error: fnErr } = await supabase.functions.invoke("ai-validate-places", {
                      body: {
                        limit: 25,
                        ...(selectedCountry ? { countryFilter: selectedCountry } : {}),
                        ...(selectedCity ? { cityFilter: selectedCity } : {}),
                      },
                    });
                    if (fnErr) throw new Error(fnErr.message);
                    const r = typeof result === "string" ? JSON.parse(result) : result;
                    addToast({
                      variant: "success",
                      title: `Validated ${r.processed} places`,
                      description: `${r.approved} approved, ${r.rejected} rejected, ${r.failed} failed`,
                    });
                    fetchData();
                  } catch (err) {
                    addToast({ variant: "error", title: "Validation failed", description: err.message });
                  } finally {
                    setValidating(false);
                  }
                }}>
                Validate {Math.min(data.ai_pending_count, 25)} Pending Places
              </Button>
            )}
            {!activeJob && (
              <Button icon={RefreshCw} variant="ghost" size="sm" disabled={validating}
                onClick={() => {
                  if (!confirm(`Revalidate ALL ${data.active_places} places with AI? This will re-run validation on every place, including ones already validated.`)) return;
                  startJob(true);
                }}>
                Revalidate All Places
              </Button>
            )}
            {activeJob && (
              <Button icon={XCircle} variant="ghost" size="sm" onClick={cancelJob}>
                Cancel
              </Button>
            )}
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
  const [aiCard, setAiCard] = useState(null);
  const [editForm, setEditForm] = useState({ name: "", price_tier: "", seeding_category: "", is_active: true });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !place) return;
    setEditForm({
      name: place.name || "",
      price_tier: place.price_tier || "",
      seeding_category: place.seeding_category || "",
      is_active: place.is_active,
    });
    // Fetch AI card data
    supabase.from("card_pool")
      .select("ai_approved, ai_reason, ai_categories, ai_validated_at, categories, original_categories")
      .eq("place_pool_id", place.id)
      .eq("card_type", "single")
      .eq("is_active", true)
      .order("ai_validated_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setAiCard(data));
  }, [open, place]);

  if (!place) return null;

  const photos = place.stored_photo_urls || [];
  const types = place.types || [];
  const aiCats = place.ai_categories?.length > 0 ? place.ai_categories : aiCard?.ai_categories || [];
  const hasConflict = place.seeding_category && aiCats.length > 0 && place.seeding_category !== aiCats[0];

  const aiStatusBadge = () => {
    const approved = place.ai_approved ?? aiCard?.ai_approved;
    if (approved === true) return <Badge variant="success">Approved</Badge>;
    if (approved === false) return <Badge variant="error">Rejected</Badge>;
    return <Badge variant="outline">Pending</Badge>;
  };

  const handleSave = async () => {
    setSaving(true);
    const { error } = await supabase.rpc("admin_edit_place", {
      p_place_id: place.id,
      p_name: editForm.name || null,
      p_price_tier: editForm.price_tier || null,
      p_seeding_category: editForm.seeding_category || null,
      p_is_active: editForm.is_active,
    });
    if (error) addToast({ variant: "error", title: "Save failed", description: error.message });
    else { addToast({ variant: "success", title: "Place updated" }); onClose(); if (onSave) onSave(); }
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
                {photos.map((url, i) => <img key={i} src={url} alt="" className="w-32 h-32 rounded-lg object-cover shrink-0" />)}
              </div>
            ) : (
              <div className="text-sm text-[var(--color-text-tertiary)]">No stored photos</div>
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
                <span className="text-[var(--color-text-secondary)]">AI Status:</span> {aiStatusBadge()}
              </div>
              {aiCard?.ai_reason && aiCard?.ai_approved === false && (
                <div><span className="text-[var(--color-text-secondary)]">AI Reason:</span> <span className="text-[var(--color-error-600)]">{aiCard.ai_reason}</span></div>
              )}
            </div>
          </div>

          {/* Quality */}
          <div>
            <h4 className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2">Quality</h4>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div><span className="text-[var(--color-text-secondary)]">Rating:</span> {place.rating ? `★ ${place.rating}` : "—"} {place.review_count > 0 && `(${place.review_count} reviews)`}</div>
              <div><span className="text-[var(--color-text-secondary)]">Price Tier:</span> {place.price_tier ? <Badge variant="outline">{place.price_tier}</Badge> : "—"}</div>
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[var(--color-text-secondary)]">Price Tier</label>
                  <select className="block mt-1 w-full rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm"
                    value={editForm.price_tier} onChange={(e) => setEditForm((f) => ({ ...f, price_tier: e.target.value }))}>
                    <option value="">None</option>
                    {PRICE_TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
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
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={saving} onClick={handleSave}>Save</Button>
      </ModalFooter>
    </Modal>
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
      const msg = (err.message || "").toLowerCase();
      if (msg.includes("duplicate") || msg.includes("unique")) {
        alert("This city already exists in your pool. Select it from the dropdown instead.");
      } else {
        alert(err.message);
      }
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

function SeedTab({ city, tiles, onRefresh, onDeleteCity, onSeedingChange }) {
  const { addToast } = useToast();
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // Setup state (before run starts)
  const [selectedCats, setSelectedCats] = useState(new Set(ALL_CATEGORIES));
  const [preview, setPreview] = useState(null);
  const [coverage, setCoverage] = useState(null);

  // Run state (batch-by-batch execution)
  const [activeRun, setActiveRun] = useState(null);       // seeding_runs row
  const [batches, setBatches] = useState([]);              // all seeding_batches for run
  const [runningBatch, setRunningBatch] = useState(false); // currently executing a batch
  const [creating, setCreating] = useState(false);         // creating run
  const [retryingBatchId, setRetryingBatchId] = useState(null); // batch being retried
  const [autoRunning, setAutoRunning] = useState(false);   // "Run All" mode
  const stopAutoRef = useRef(false);                        // signal to stop auto-run

  // Ad-hoc search
  const [adHocOpen, setAdHocOpen] = useState(false);
  const [adHocQuery, setAdHocQuery] = useState("");
  const [adHocResults, setAdHocResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [adHocCategories, setAdHocCategories] = useState({});

  // Hydrate: check for active run on city change
  useEffect(() => {
    if (!city) { setActiveRun(null); setBatches([]); setCoverage(null); return; }
    let cancelled = false;

    (async () => {
      // Check for active run (includes preparing and ready states)
      const { data: runs } = await supabase
        .from("seeding_runs")
        .select("*")
        .eq("city_id", city.id)
        .in("status", ["preparing", "ready", "running", "paused"])
        .order("created_at", { ascending: false })
        .limit(1);

      if (cancelled) return;

      if (runs && runs.length > 0) {
        const run = runs[0];
        setActiveRun(run);
        onSeedingChange?.(true);
        // Load batches (skip if still preparing — no batches yet)
        if (run.status !== "preparing") {
          const { data: batchData } = await supabase
            .from("seeding_batches")
            .select("*")
            .eq("run_id", run.id)
            .order("batch_index");
          if (!cancelled) setBatches(batchData || []);
        }
      } else {
        setActiveRun(null);
        setBatches([]);
        onSeedingChange?.(false);
      }

      // Fetch coverage
      const { data: cov } = await supabase.functions.invoke("admin-seed-places", {
        body: { action: "coverage_check", cityId: city.id },
      });
      if (!cancelled && cov) setCoverage(cov);
    })();

    return () => { cancelled = true; };
  }, [city]);

  const toggleCat = (id) => {
    setSelectedCats((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectOnlyGaps = () => {
    if (!coverage?.coverage) return;
    const gaps = new Set(coverage.coverage.filter((c) => c.hasGap).map((c) => c.categoryId));
    setSelectedCats(gaps.size > 0 ? gaps : new Set(ALL_CATEGORIES));
  };

  // Preview cost (only when no active run)
  useEffect(() => {
    if (!city || activeRun) return;
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
  }, [city, selectedCats, activeRun]);

  // ── Run Actions ──

  const createRun = async () => {
    if (!city || creating) return;
    const cats = Array.from(selectedCats);
    if (cats.length === 0) return;

    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-seed-places", {
        body: { action: "create_run", cityId: city.id, categories: cats },
      });
      if (error) throw new Error(error.message || "Failed to prepare run");
      if (data?.error) throw new Error(data.error);

      addToast({ variant: "success", title: "Batches prepared", description: `${data.totalBatches} batches ready for approval` });

      // Hydrate the new run (now in 'ready' status)
      const { data: run } = await supabase
        .from("seeding_runs").select("*").eq("id", data.runId).single();
      const { data: batchData } = await supabase
        .from("seeding_batches").select("*").eq("run_id", data.runId).order("batch_index");

      if (mountedRef.current) {
        setActiveRun(run);
        setBatches(batchData || []);
        onSeedingChange?.(true);
      }
    } catch (err) {
      addToast({ variant: "error", title: "Preparation failed", description: err.message });
    } finally {
      setCreating(false);
    }
  };

  const runNextBatch = async () => {
    if (!activeRun || runningBatch) return;
    setRunningBatch(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-seed-places", {
        body: { action: "run_next_batch", runId: activeRun.id },
      });
      if (error) throw new Error(error.message || "Batch execution failed");
      if (data?.error) throw new Error(data.error);

      // Update local state
      if (mountedRef.current) {
        // Refresh batches from DB for accuracy
        const { data: batchData } = await supabase
          .from("seeding_batches").select("*").eq("run_id", activeRun.id).order("batch_index");
        setBatches(batchData || []);

        // Refresh run
        const { data: runData } = await supabase
          .from("seeding_runs").select("*").eq("id", activeRun.id).single();
        setActiveRun(runData);

        // Refresh parent data (stats, places, etc.) after every batch
        onRefresh();

        if (data.done) {
          addToast({ variant: "success", title: "Seeding complete", description: "All batches finished" });
          onSeedingChange?.(false);
        }
      }
    } catch (err) {
      addToast({ variant: "error", title: "Batch failed", description: err.message });
      // Refresh state anyway to show the failure
      const { data: batchData } = await supabase
        .from("seeding_batches").select("*").eq("run_id", activeRun.id).order("batch_index");
      if (mountedRef.current) setBatches(batchData || []);
      const { data: runData } = await supabase
        .from("seeding_runs").select("*").eq("id", activeRun.id).single();
      if (mountedRef.current) setActiveRun(runData);
    } finally {
      if (mountedRef.current) setRunningBatch(false);
    }
  };

  const runAll = async () => {
    if (!activeRun || autoRunning || runningBatch) return;
    setAutoRunning(true);
    stopAutoRef.current = false;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (stopAutoRef.current || !mountedRef.current) break;

      try {
        setRunningBatch(true);
        const { data, error } = await supabase.functions.invoke("admin-seed-places", {
          body: { action: "run_next_batch", runId: activeRun.id },
        });
        if (error) throw new Error(error.message || "Batch execution failed");
        if (data?.error) throw new Error(data.error);

        if (mountedRef.current) {
          const { data: batchData } = await supabase
            .from("seeding_batches").select("*").eq("run_id", activeRun.id).order("batch_index");
          setBatches(batchData || []);
          const { data: runData } = await supabase
            .from("seeding_runs").select("*").eq("id", activeRun.id).single();
          setActiveRun(runData);
          onRefresh();
        }

        if (mountedRef.current) setRunningBatch(false);

        if (data.done) {
          addToast({ variant: "success", title: "Seeding complete", description: "All batches finished" });
          onSeedingChange?.(false);
          break;
        }
      } catch (err) {
        // On error, stop auto-run and let user decide (retry/skip/continue)
        addToast({ variant: "error", title: "Batch failed — auto-run paused", description: err.message });
        if (mountedRef.current) {
          const { data: batchData } = await supabase
            .from("seeding_batches").select("*").eq("run_id", activeRun.id).order("batch_index");
          setBatches(batchData || []);
          const { data: runData } = await supabase
            .from("seeding_runs").select("*").eq("id", activeRun.id).single();
          setActiveRun(runData);
          onRefresh();
          setRunningBatch(false);
        }
        break;
      }
    }

    if (mountedRef.current) {
      setAutoRunning(false);
      setRunningBatch(false);
    }
  };

  const stopAutoRun = () => {
    stopAutoRef.current = true;
  };

  const skipBatch = async (batchId) => {
    if (!activeRun) return;
    try {
      const { data, error } = await supabase.functions.invoke("admin-seed-places", {
        body: { action: "skip_batch", runId: activeRun.id, batchId },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      // Refresh
      const { data: batchData } = await supabase
        .from("seeding_batches").select("*").eq("run_id", activeRun.id).order("batch_index");
      if (mountedRef.current) setBatches(batchData || []);
      const { data: runData } = await supabase
        .from("seeding_runs").select("*").eq("id", activeRun.id).single();
      if (mountedRef.current) setActiveRun(runData);
      onRefresh();
    } catch (err) {
      addToast({ variant: "error", title: "Skip failed", description: err.message });
    }
  };

  const cancelRun = async () => {
    if (!activeRun) return;
    if (!confirm("Cancel this run? All remaining batches will be skipped.")) return;
    try {
      const { data, error } = await supabase.functions.invoke("admin-seed-places", {
        body: { action: "cancel_run", runId: activeRun.id },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      addToast({ variant: "warning", title: "Run cancelled" });
      setActiveRun(null);
      setBatches([]);
      onSeedingChange?.(false);
      onRefresh();
    } catch (err) {
      addToast({ variant: "error", title: "Cancel failed", description: err.message });
    }
  };

  const retryBatch = async (batchId) => {
    if (!activeRun || retryingBatchId || runningBatch) return;
    setRetryingBatchId(batchId);
    try {
      const { data, error } = await supabase.functions.invoke("admin-seed-places", {
        body: { action: "retry_batch", runId: activeRun.id, batchId },
      });
      if (error) throw new Error(error.message || "Retry failed");
      if (data?.error) throw new Error(data.error);

      const verb = data.status === "completed" ? "succeeded" : "failed again";
      addToast({
        variant: data.status === "completed" ? "success" : "warning",
        title: `Retry ${verb}`,
        description: data.status === "completed"
          ? `${data.result?.newInserted || 0} new places from retried batch`
          : data.result?.error || "Check batch log for details",
      });

      // Refresh from DB
      if (mountedRef.current) {
        const { data: batchData } = await supabase
          .from("seeding_batches").select("*").eq("run_id", activeRun.id).order("batch_index");
        setBatches(batchData || []);
        const { data: runData } = await supabase
          .from("seeding_runs").select("*").eq("id", activeRun.id).single();
        setActiveRun(runData);
        onRefresh();
      }
    } catch (err) {
      addToast({ variant: "error", title: "Retry failed", description: err.message });
      // Refresh state anyway
      const { data: batchData } = await supabase
        .from("seeding_batches").select("*").eq("run_id", activeRun.id).order("batch_index");
      if (mountedRef.current) setBatches(batchData || []);
      const { data: runData } = await supabase
        .from("seeding_runs").select("*").eq("id", activeRun.id).single();
      if (mountedRef.current) setActiveRun(runData);
      onRefresh();
    } finally {
      if (mountedRef.current) setRetryingBatchId(null);
    }
  };

  // ── Ad-Hoc Search ──

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

  // ── Derived state for batch-by-batch view ──
  const nextPendingBatch = activeRun ? batches.find((b) => b.status === "pending") : null;
  const completedBatches = batches.filter((b) => ["completed", "failed", "skipped"].includes(b.status));
  const progressPct = activeRun ? Math.round(((activeRun.completed_batches + activeRun.failed_batches + (activeRun.skipped_batches || 0)) / activeRun.total_batches) * 100) : 0;
  const isRunDone = activeRun && ["completed", "cancelled"].includes(activeRun.status);
  const isPreparing = activeRun && activeRun.status === "preparing";
  const isReady = activeRun && activeRun.status === "ready";
  const isFailedPreparing = activeRun && activeRun.status === "failed_preparing";
  const isApprovable = activeRun && ["ready", "running", "paused"].includes(activeRun.status);
  const failedRetryable = batches.filter((b) => b.status === "failed");
  const queueDrainedWithFailures = isApprovable && !nextPendingBatch && failedRetryable.length > 0 && !isRunDone;

  return (
    <div className="space-y-6">
      {/* Tile Summary */}
      <SectionCard title="Tile Grid" subtitle={`${tiles.length} tiles · ${city.tile_radius_m}m radius`}
        action={<div className="flex gap-2">
          <Button size="sm" icon={RefreshCw} variant="secondary" onClick={async () => {
            await supabase.functions.invoke("admin-seed-places", { body: { action: "generate_tiles", cityId: city.id } });
            onRefresh();
          }} disabled={!!activeRun}>Regenerate</Button>
          {city.status === "draft" && onDeleteCity && !activeRun && (
            <Button size="sm" variant="secondary" className="text-[var(--color-error-700)]"
              onClick={() => { if (confirm(`Delete draft city "${city.name}"? This removes the city and its tiles. Places in the pool are not affected.`)) onDeleteCity(city); }}>
              Delete Draft
            </Button>
          )}
        </div>}>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Coverage: {city.coverage_radius_km}km radius · Spacing: {Math.round(city.tile_radius_m * 1.4)}m
        </p>
      </SectionCard>

      {/* ── Phase 1: Setup (no active run) ── */}
      {!activeRun && (
        <>
          {/* Category Pills with Coverage */}
          <SectionCard title="Categories"
            subtitle={coverage ? `${coverage.categoriesWithGaps} of 13 categories have gaps (<10 places)` : null}
            action={coverage?.categoriesWithGaps > 0 && (
              <Button size="sm" variant="secondary" icon={AlertTriangle} onClick={selectOnlyGaps}>
                Select Only Gaps
              </Button>
            )}>
            <div className="flex flex-wrap gap-2">
              {ALL_CATEGORIES.map((id) => {
                const catCoverage = coverage?.coverage?.find((c) => c.categoryId === id);
                const count = catCoverage?.placeCount ?? null;
                const hasGap = catCoverage?.hasGap;
                return (
                  <button key={id} onClick={() => toggleCat(id)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
                      selectedCats.has(id)
                        ? "text-white border-transparent"
                        : "bg-transparent border-[var(--gray-300)] text-[var(--color-text-secondary)]"
                    }`}
                    style={{
                      ...(selectedCats.has(id) ? { backgroundColor: CATEGORY_COLORS[id] } : {}),
                      ...(hasGap && !selectedCats.has(id) ? { borderColor: "#ef4444", borderWidth: 2 } : {}),
                    }}>
                    {CATEGORY_LABELS[id]}
                    {count !== null && (
                      <span className={`ml-1.5 inline-flex items-center justify-center min-w-[20px] px-1 py-0 rounded-full text-[10px] font-bold ${
                        selectedCats.has(id)
                          ? "bg-white/25 text-white"
                          : hasGap
                            ? "bg-[#fef2f2] text-[#ef4444]"
                            : "bg-[#f0fdf4] text-[#22c55e]"
                      }`}>
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </SectionCard>

          {/* Cost Preview + Start */}
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
                <Button variant="primary" icon={Play} loading={creating} onClick={createRun}
                  disabled={selectedCats.size === 0 || creating || preview.exceedsHardCap}>
                  {creating ? "Preparing batches..." : `Prepare ${preview.totalApiCalls} Batches`}
                </Button>
                <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
                  All batches are created first. You then approve and run each one individually.
                </p>
              </div>
            </SectionCard>
          )}
        </>
      )}

      {/* ── Phase 2: Active Run (preparing / ready / running / paused / done) ── */}
      {activeRun && (
        <>
          {/* Preparing State */}
          {isPreparing && (
            <SectionCard title="Preparing Batches">
              <div className="flex items-center gap-3 py-4">
                <Loader className="w-5 h-5 animate-spin text-[var(--color-brand-500)]" />
                <div>
                  <div className="text-sm font-medium">Creating {activeRun.total_batches} batch records...</div>
                  <div className="text-xs text-[var(--color-text-secondary)] mt-1">
                    {activeRun.total_tiles} tiles × {activeRun.selected_categories?.length || 0} categories. Batches must all be created before approval begins.
                  </div>
                </div>
              </div>
            </SectionCard>
          )}

          {/* Failed Preparing State */}
          {isFailedPreparing && (
            <SectionCard title="Preparation Failed">
              <div className="rounded-lg p-4 bg-[var(--color-error-50)] border border-[var(--color-error-200)]">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-[#ef4444] shrink-0 mt-0.5" />
                  <div>
                    <div className="text-sm font-medium text-[var(--color-error-700)]">Batch creation failed</div>
                    <div className="text-xs text-[var(--color-text-secondary)] mt-1">
                      Not all batches could be created. This run cannot be used for approval. Dismiss it and try again.
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-4">
                <Button variant="primary" onClick={() => {
                  setActiveRun(null);
                  setBatches([]);
                  onSeedingChange?.(false);
                  onRefresh();
                }}>Dismiss and Start Over</Button>
              </div>
            </SectionCard>
          )}

          {/* Ready State — show clear "ready for approval" banner */}
          {isReady && (
            <SectionCard title="Run Ready"
              subtitle={`${activeRun.total_batches} batches prepared · ${activeRun.selected_categories?.length || 0} categories · ${activeRun.total_tiles} tiles`}
              action={
                <div className="flex items-center gap-2">
                  <Badge variant="success">ready</Badge>
                  <Button size="sm" variant="secondary" icon={XCircle} onClick={cancelRun}>Cancel Run</Button>
                </div>
              }>
              <div className="rounded-lg p-4 bg-[var(--color-success-50)] border border-[var(--color-success-200)]">
                <div className="text-sm font-medium text-[var(--color-success-700)]">
                  All {activeRun.total_batches} batches are prepared and ready for approval.
                </div>
                <div className="text-xs text-[var(--color-text-secondary)] mt-1">
                  Click "Run This Batch" below to execute the first batch. Each batch runs one Google API call for one tile × category combination.
                </div>
              </div>
            </SectionCard>
          )}

          {/* Progress Bar (only once execution has started or run is done) */}
          {!isPreparing && !isFailedPreparing && !isReady && (
            <SectionCard title="Seeding Run"
              subtitle={`${activeRun.selected_categories?.length || 0} categories · ${activeRun.total_tiles} tiles`}
              action={
                <div className="flex items-center gap-2">
                  <Badge variant={activeRun.status === "paused" ? "warning" : activeRun.status === "running" ? "info" : "success"}>
                    {activeRun.status}
                  </Badge>
                  {!isRunDone && (
                    <Button size="sm" variant="secondary" icon={XCircle} onClick={cancelRun}>
                      Cancel Run
                    </Button>
                  )}
                </div>
              }>
              {/* Progress bar */}
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1 bg-[var(--gray-100)] rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full bg-[var(--color-brand-500)] transition-all duration-300"
                      style={{ width: `${progressPct}%` }} />
                  </div>
                  <span className="text-sm font-medium w-28 text-right">
                    {activeRun.completed_batches + activeRun.failed_batches + (activeRun.skipped_batches || 0)} / {activeRun.total_batches} ({progressPct}%)
                  </span>
                </div>

                {/* Auto-run indicator */}
                {autoRunning && (
                  <div className="flex items-center gap-2 text-sm text-[var(--color-brand-600)]">
                    <Zap className="w-4 h-4" />
                    <span className="font-medium">Auto-running — batches execute sequentially. Stops on error.</span>
                  </div>
                )}

                {/* Running totals */}
                <div className="grid grid-cols-4 gap-4 text-sm">
                  <div><span className="text-[var(--color-text-secondary)]">New places:</span> <strong className="text-[var(--color-success-700)]">{activeRun.total_places_new}</strong></div>
                  <div><span className="text-[var(--color-text-secondary)]">Duplicates:</span> <strong>{activeRun.total_places_duped}</strong></div>
                  <div><span className="text-[var(--color-text-secondary)]">Failed:</span> <strong className="text-[var(--color-error-700)]">{activeRun.failed_batches}</strong></div>
                  <div><span className="text-[var(--color-text-secondary)]">Cost:</span> <strong>{formatCost(activeRun.total_cost_usd)}</strong></div>
                </div>
              </div>
            </SectionCard>
          )}

          {/* Current / Next Batch (only when approvable) */}
          {nextPendingBatch && isApprovable && !isRunDone && (
            <SectionCard title="Next Batch">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="text-sm">
                    <span className="text-[var(--color-text-secondary)]">Batch {nextPendingBatch.batch_index + 1}:</span>{" "}
                    <strong>Tile #{nextPendingBatch.tile_index}</strong> × <span className="font-medium" style={{ color: CATEGORY_COLORS[nextPendingBatch.seeding_category] }}>
                      {CATEGORY_LABELS[nextPendingBatch.seeding_category] || nextPendingBatch.seeding_category}
                    </span>
                  </div>
                </div>
                <div className="flex gap-2">
                  {!autoRunning && (
                    <>
                      <Button variant="secondary" size="sm" icon={SkipForward}
                        onClick={() => skipBatch(nextPendingBatch.id)}
                        disabled={runningBatch || !!retryingBatchId}>
                        Skip
                      </Button>
                      <Button variant="primary" icon={Play} loading={runningBatch && !autoRunning} onClick={runNextBatch}
                        disabled={runningBatch || !!retryingBatchId}>
                        {runningBatch ? "Running..." : "Run This Batch"}
                      </Button>
                      <Button variant="primary" icon={Zap} onClick={runAll}
                        disabled={runningBatch || !!retryingBatchId}>
                        Run All
                      </Button>
                    </>
                  )}
                  {autoRunning && (
                    <Button variant="secondary" icon={XCircle} onClick={stopAutoRun}>
                      {runningBatch ? "Stopping after current batch..." : "Stop Auto-Run"}
                    </Button>
                  )}
                </div>
              </div>
            </SectionCard>
          )}

          {/* Queue drained but failed batches remain — prompt retry */}
          {queueDrainedWithFailures && (
            <SectionCard title="Queue Complete — Failed Batches Remain">
              <div className="rounded-lg p-4 bg-[var(--color-warning-50)] border border-[var(--color-warning-200)]">
                <div className="text-sm font-medium text-[var(--color-warning-700)]">
                  All {activeRun.total_batches} batches have been processed, but {failedRetryable.length} failed.
                </div>
                <div className="text-xs text-[var(--color-text-secondary)] mt-1">
                  Retry failed batches from the log below, or cancel to finish. The run will auto-complete once all failed batches are retried or skipped.
                </div>
              </div>
            </SectionCard>
          )}

          {/* Completion Card */}
          {isRunDone && (
            <SectionCard title={activeRun.status === "cancelled" ? "Run Cancelled" : "Run Complete"}>
              <div className="grid grid-cols-4 gap-4 text-sm mb-4">
                <div>Completed: <strong className="text-[var(--color-success-700)]">{activeRun.completed_batches}</strong></div>
                <div>Failed: <strong className="text-[var(--color-error-700)]">{activeRun.failed_batches}</strong></div>
                <div>Skipped: <strong>{activeRun.skipped_batches || 0}</strong></div>
                <div>Cost: <strong>{formatCost(activeRun.total_cost_usd)}</strong></div>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>New places: <strong className="text-[var(--color-success-700)]">{activeRun.total_places_new}</strong></div>
                <div>Duplicates: <strong>{activeRun.total_places_duped}</strong></div>
              </div>
              <div className="mt-4">
                <Button variant="primary" onClick={() => {
                  setActiveRun(null);
                  setBatches([]);
                  onSeedingChange?.(false);
                  onRefresh();
                }}>Prepare New Run</Button>
              </div>
            </SectionCard>
          )}

          {/* Batch Log (scrollable) */}
          {completedBatches.length > 0 && (
            <SectionCard title="Batch Log" subtitle={`${completedBatches.length} processed`}>
              <div className="max-h-80 overflow-y-auto space-y-1">
                {completedBatches.slice().reverse().map((b) => (
                  <div key={b.id} className={`flex items-center gap-2 text-xs px-2 py-1.5 rounded ${
                    b.status === "failed" ? "bg-[var(--color-error-50)]" : b.status === "skipped" ? "bg-[var(--gray-50)]" : ""
                  }`}>
                    {b.status === "completed" ? (
                      <CheckCircle className="w-3.5 h-3.5 text-[#22c55e] shrink-0" />
                    ) : b.status === "failed" ? (
                      <AlertTriangle className="w-3.5 h-3.5 text-[#ef4444] shrink-0" />
                    ) : (
                      <SkipForward className="w-3.5 h-3.5 text-[var(--color-text-secondary)] shrink-0" />
                    )}
                    <span className="text-[var(--color-text-secondary)] w-12">#{b.batch_index + 1}</span>
                    <span className="w-12">Tile {b.tile_index}</span>
                    <span className="w-28 truncate font-medium" style={{ color: CATEGORY_COLORS[b.seeding_category] }}>
                      {CATEGORY_LABELS[b.seeding_category] || b.seeding_category}
                    </span>
                    {b.retry_count > 0 && (
                      <span className="inline-flex items-center px-1.5 py-0 rounded-full text-[10px] font-bold bg-[var(--gray-100)] text-[var(--color-text-secondary)]" title={`Retried ${b.retry_count} time(s)`}>
                        <RotateCcw className="w-2.5 h-2.5 mr-0.5" />{b.retry_count}
                      </span>
                    )}
                    {b.status === "completed" ? (
                      <span className="text-[var(--color-text-secondary)]">
                        {b.places_new_inserted} new · {b.places_duplicate_skipped} dupes · {b.places_returned} found · {formatCost(b.estimated_cost_usd)}
                      </span>
                    ) : b.status === "failed" ? (
                      <>
                        <span className="text-[var(--color-error-700)] truncate flex-1">{b.error_message || "Unknown error"}</span>
                        {isApprovable && !isRunDone && (
                          <span className="inline-flex gap-1 shrink-0">
                            <button
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-[var(--color-error-100)] text-[var(--color-error-700)] hover:bg-[var(--color-error-200)] transition-colors cursor-pointer disabled:opacity-50"
                              onClick={() => retryBatch(b.id)}
                              disabled={!!retryingBatchId || runningBatch}
                              title="Re-run this failed batch only"
                            >
                              {retryingBatchId === b.id ? (
                                <Loader className="w-3 h-3 animate-spin" />
                              ) : (
                                <RotateCcw className="w-3 h-3" />
                              )}
                              {retryingBatchId === b.id ? "Retrying..." : "Retry"}
                            </button>
                            <button
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-[var(--gray-100)] text-[var(--color-text-secondary)] hover:bg-[var(--gray-200)] transition-colors cursor-pointer disabled:opacity-50"
                              onClick={() => skipBatch(b.id)}
                              disabled={!!retryingBatchId || runningBatch}
                              title="Skip this failed batch — give up on retry"
                            >
                              <SkipForward className="w-3 h-3" />
                              Skip
                            </button>
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-[var(--color-text-secondary)]">Skipped</span>
                    )}
                  </div>
                ))}
              </div>
            </SectionCard>
          )}
        </>
      )}

      {/* Ad-Hoc Search (always visible) */}
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

function MapTab({ selectedCountry, selectedCity, registeredCity, tiles, seedingOps }) {
  const [visibleCats, setVisibleCats] = useState(new Set(ALL_CATEGORIES));
  const [places, setPlaces] = useState([]);
  const [mapLoading, setMapLoading] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (!selectedCountry) { setPlaces([]); return; }
    setMapLoading(true);
    let q = supabase.from("place_pool")
      .select("id, name, lat, lng, rating, seeding_category, is_active, stored_photo_urls")
      .eq("is_active", true);
    if (selectedCity) q = q.eq("city", selectedCity).eq("country", selectedCountry);
    else q = q.eq("country", selectedCountry);
    q.limit(2000).then(({ data }) => {
      if (mountedRef.current) { setPlaces(data || []); setMapLoading(false); }
    });
    return () => { mountedRef.current = false; };
  }, [selectedCountry, selectedCity]);

  if (!selectedCountry) return <div className="text-center py-12 text-[var(--color-text-secondary)]">Select a country to view the map.</div>;
  if (mapLoading) return <div className="text-center py-12 text-[var(--color-text-secondary)]">Loading map data...</div>;
  if (places.length === 0) return <div className="text-center py-12 text-[var(--color-text-secondary)]">No places found to display.</div>;

  // Compute center from places average
  const validPlaces = places.filter((p) => p.lat && p.lng);
  const center = registeredCity
    ? [registeredCity.center_lat, registeredCity.center_lng]
    : validPlaces.length > 0
      ? [validPlaces.reduce((s, p) => s + p.lat, 0) / validPlaces.length, validPlaces.reduce((s, p) => s + p.lng, 0) / validPlaces.length]
      : [0, 0];

  const filteredPlaces = places.filter((p) => visibleCats.has(p.seeding_category));
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

          {/* City boundary (registered cities only) */}
          {registeredCity && (
            <Circle center={[registeredCity.center_lat, registeredCity.center_lng]} radius={registeredCity.coverage_radius_km * 1000}
              pathOptions={{ color: "#6b7280", dashArray: "8 4", fillOpacity: 0.03, weight: 2 }} />
          )}

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

function BrowseTab({ selectedCountry, selectedCity, onRefresh }) {
  const { addToast } = useToast();
  const [places, setPlaces] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ category: "", status: "active", photoStatus: "", priceTier: "", minRating: "", aiStatus: "", nameSearch: "" });
  const [detailPlace, setDetailPlace] = useState(null);
  const PAGE_SIZE = 20;

  const fetchPlaces = useCallback(async () => {
    setLoading(true);
    let q = supabase.from("place_pool").select("*", { count: "exact" });
    if (selectedCity) q = q.eq("city", selectedCity);
    else if (selectedCountry) q = q.eq("country", selectedCountry);
    if (filters.category) q = q.eq("seeding_category", filters.category);
    if (filters.status === "active") q = q.eq("is_active", true);
    else if (filters.status === "inactive") q = q.eq("is_active", false);
    if (filters.photoStatus === "has") q = q.not("stored_photo_urls", "is", null);
    else if (filters.photoStatus === "missing") q = q.or("stored_photo_urls.is.null,stored_photo_urls.eq.{}");
    if (filters.priceTier) q = q.eq("price_tier", filters.priceTier);
    if (filters.minRating) q = q.gte("rating", parseFloat(filters.minRating));
    if (filters.aiStatus === "validated") q = q.eq("ai_approved", true);
    else if (filters.aiStatus === "rejected") q = q.eq("ai_approved", false);
    else if (filters.aiStatus === "pending") q = q.is("ai_approved", null);
    if (filters.nameSearch) q = q.ilike("name", `%${filters.nameSearch}%`);
    q = q.order("created_at", { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
    const { data, count, error } = await q;
    if (error) { addToast({ variant: "error", title: "Failed to load places", description: error.message }); }
    else { setPlaces(data || []); setTotal(count || 0); }
    setLoading(false);
  }, [selectedCountry, selectedCity, filters, page, addToast]);

  useEffect(() => { fetchPlaces(); }, [fetchPlaces]);
  useEffect(() => { setPage(1); }, [selectedCountry, selectedCity]);

  const relativeTime = (dateStr) => {
    if (!dateStr) return "—";
    const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
    if (days === 0) return "Today";
    if (days < 30) return `${days}d ago`;
    return `${Math.floor(days / 30)}mo ago`;
  };

  const columns = [
    { key: "name", label: "Name", sortable: true, render: (_, r) => <button className="text-[var(--color-brand-500)] hover:underline cursor-pointer text-left" onClick={() => setDetailPlace(r)}>{r.name}</button> },
    { key: "seeding_category", label: "Category", render: (_, r) => r.seeding_category ? <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full text-white" style={{ backgroundColor: CATEGORY_COLORS[r.seeding_category] }}>{CATEGORY_LABELS[r.seeding_category]}</span> : "—" },
    { key: "address", label: "Address", render: (_, r) => <span className="text-xs max-w-[160px] truncate block">{r.address || "—"}</span> },
    { key: "rating", label: "Rating", sortable: true, render: (_, r) => r.rating ? `★ ${r.rating}` : "—" },
    { key: "review_count", label: "Reviews", sortable: true, render: (_, r) => r.review_count || "—" },
    { key: "price_tier", label: "Price", render: (_, r) => r.price_tier ? <Badge variant="outline">{r.price_tier}</Badge> : "—" },
    { key: "photos", label: "Photos", render: (_, r) => {
      const n = r.stored_photo_urls?.length || 0;
      return <Badge variant={n > 0 ? "success" : "error"}>{n}</Badge>;
    }},
    { key: "ai_approved", label: "AI Status", render: (_, r) => {
      if (r.ai_approved === true) return <Badge variant="success">Approved</Badge>;
      if (r.ai_approved === false) return <Badge variant="error">Rejected</Badge>;
      return <Badge variant="outline">Pending</Badge>;
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
          <label className="text-xs text-[var(--color-text-secondary)]">AI Status</label>
          <select className="block mt-1 rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm"
            value={filters.aiStatus} onChange={(e) => { setFilters((f) => ({ ...f, aiStatus: e.target.value })); setPage(1); }}>
            <option value="">All</option>
            <option value="validated">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="pending">Pending</option>
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

      <PlaceDetailModal place={detailPlace} open={!!detailPlace} onClose={() => setDetailPlace(null)} onSave={() => { fetchPlaces(); if (onRefresh) onRefresh(); }} />
    </div>
  );
}

// ── Tab 4: Photo Management ──────────────────────────────────────────────────

function PhotoTab({ selectedCountry, selectedCity }) {
  const { addToast } = useToast();
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [totalPlaces, setTotalPlaces] = useState(null);   // total active places
  const [withPhotos, setWithPhotos] = useState(null);      // places that have stored photos
  const [missingCount, setMissingCount] = useState(null);  // places needing backfill
  const [initialMissing, setInitialMissing] = useState(null);
  const [totalSucceeded, setTotalSucceeded] = useState(0);
  const [totalFailed, setTotalFailed] = useState(0);
  const stopRef = useRef(false);
  const pollRef = useRef(null);

  // Query actual DB counts via new text-based RPC
  const fetchCounts = async () => {
    if (!selectedCity) return;
    try {
      const { data } = await supabase.rpc("admin_place_photo_stats", {
        p_country: selectedCountry,
        p_city: selectedCity,
      });
      if (mountedRef.current && data) {
        const row = Array.isArray(data) ? data[0] : data;
        setTotalPlaces(Number(row.total_places) || 0);
        setWithPhotos(Number(row.with_photos) || 0);
        setMissingCount(Number(row.without_photos) || 0);
      }
    } catch { /* ignore */ }
  };

  // Initial load
  useEffect(() => {
    if (!selectedCity) { setTotalPlaces(null); setWithPhotos(null); setMissingCount(null); return; }
    setLoading(true);
    fetchCounts().then(() => { if (mountedRef.current) setLoading(false); });
  }, [selectedCountry, selectedCity]);

  // Poll DB every 5s while downloading — gives real-time progress within a batch
  useEffect(() => {
    if (downloading) {
      pollRef.current = setInterval(() => { fetchCounts(); }, 5000);
    } else {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [downloading]);

  const startDownload = async () => {
    if (downloading) return;
    stopRef.current = false;
    setDownloading(true);
    setTotalSucceeded(0);
    setTotalFailed(0);
    if (initialMissing == null) setInitialMissing(missingCount);

    // Log attempt (non-blocking)
    try {
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from("admin_backfill_log").insert({
        operation_type: "photo_backfill",
        triggered_by: user?.id,
        total_places: missingCount,
        estimated_cost_usd: missingCount * 5 * 0.007,
      });
    } catch { /* ignore */ }

    let runSucceeded = 0;
    let runFailed = 0;

    while (!stopRef.current && mountedRef.current) {
      try {
        const { data, error } = await supabase.functions.invoke("backfill-place-photos", {
          body: { batchSize: 50 },
        });

        if (error) break;
        if (data?.error) break;

        runSucceeded += data.succeeded || 0;
        runFailed += data.failed || 0;

        if (mountedRef.current) {
          setTotalSucceeded(runSucceeded);
          setTotalFailed(runFailed);
        }

        if ((data.processed || 0) === 0 || (data.remaining || 0) === 0) break;
      } catch { break; }
    }

    if (mountedRef.current) {
      setDownloading(false);
      setInitialMissing(null);
      await fetchCounts();
      addToast({
        variant: runFailed > 0 && runSucceeded === 0 ? "error" : runFailed > 0 ? "warning" : "success",
        title: stopRef.current ? "Photo download paused" : "Photo download complete",
        description: `${runSucceeded} succeeded, ${runFailed} failed`,
      });
    }
  };

  const stopDownload = () => { stopRef.current = true; };

  const photoPct = totalPlaces > 0 ? Math.round(((withPhotos ?? 0) / totalPlaces) * 100) : 0;
  const estimatedCost = (missingCount || 0) * 5 * 0.007;
  const downloaded = initialMissing != null && missingCount != null ? Math.max(0, initialMissing - missingCount) : totalSucceeded;
  const progressPct = initialMissing > 0 ? Math.min(100, Math.round((downloaded / initialMissing) * 100)) : 0;

  if (!selectedCity) return <div className="text-center py-12 text-[var(--color-text-secondary)]">Select a city to manage photos.</div>;

  return (
    <div className="space-y-6">
      {/* Stats — live-updating from DB */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard icon={Camera} label="With Photos" value={withPhotos ?? "—"} />
        <StatCard icon={ImageOff} label="Without Photos" value={missingCount ?? "—"} />
        <StatCard icon={Eye} label="Coverage" value={totalPlaces ? `${photoPct}%` : "—"} trend={photoPct >= 80 ? "Good" : photoPct >= 50 ? "Fair" : "Low"} trendUp={photoPct >= 80} />
      </div>

      {/* Download Section */}
      <SectionCard title="Download Photos"
        subtitle="Fetches photos from Google for places that have references but no stored images">

        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-[var(--color-text-secondary)]">
            <Loader className="w-4 h-4 animate-spin" /> Checking for places without photos...
          </div>
        ) : missingCount === 0 && !downloading ? (
          <div className="py-4">
            <div className="flex items-center gap-2 text-sm text-[var(--color-success-700)]">
              <CheckCircle className="w-4 h-4" /> All places have photos downloaded.
            </div>
            {totalSucceeded > 0 && (
              <div className="mt-2 text-xs text-[var(--color-text-secondary)]">
                Last run: {totalSucceeded} succeeded, {totalFailed} failed
              </div>
            )}
            <Button size="sm" variant="secondary" icon={RefreshCw} className="mt-3" onClick={fetchCounts}>
              Re-check
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Status / info */}
            <div className="rounded-lg p-4 bg-[var(--gray-50)]">
              <div className="text-sm space-y-2">
                <div><strong>{missingCount}</strong> places still need photos.</div>
                <div>Up to 5 photos per place. Estimated cost: <strong>{formatCost(estimatedCost)}</strong></div>
                <div className="text-xs text-[var(--color-text-secondary)]">
                  Downloads 50 places per batch. Stats update every 5 seconds from the database — you can leave and come back anytime.
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2">
              {!downloading ? (
                <Button variant="primary" icon={Download} onClick={startDownload}>
                  Download All Photos ({missingCount} places)
                </Button>
              ) : (
                <Button variant="secondary" icon={XCircle} onClick={stopDownload}>
                  Stop Download
                </Button>
              )}
              {!downloading && (
                <Button variant="secondary" icon={RefreshCw} onClick={fetchCounts} size="sm">
                  Re-check
                </Button>
              )}
            </div>

            {/* Progress — shows during and after download */}
            {(downloading || totalSucceeded > 0 || totalFailed > 0) && (
              <div className="space-y-3">
                {/* Progress bar */}
                {initialMissing > 0 && (
                  <div className="flex items-center gap-3">
                    <div className="flex-1 bg-[var(--gray-100)] rounded-full h-3 overflow-hidden">
                      <div className="h-full rounded-full bg-[var(--color-brand-500)] transition-all duration-500"
                        style={{ width: `${progressPct}%` }} />
                    </div>
                    <span className="text-sm font-medium w-20 text-right">{progressPct}%</span>
                  </div>
                )}

                {/* Counters */}
                <div className="flex gap-4 text-sm">
                  {downloading && <span className="flex items-center gap-1 text-[var(--color-brand-600)]"><Loader className="w-3.5 h-3.5 animate-spin" /> Running...</span>}
                  <span className="text-[var(--color-success-700)]">{totalSucceeded} downloaded</span>
                  {totalFailed > 0 && <span className="text-[var(--color-error-700)]">{totalFailed} failed</span>}
                  <span className="text-[var(--color-text-secondary)]">{missingCount} remaining</span>
                </div>
              </div>
            )}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ── AI Validation tab removed — absorbed into Overview stats + Browse modal ──

// (AI_STATUS_OPTIONS and AIValidationTab removed — functionality moved to
//  Overview tab AI summary + PlaceDetailModal per-place AI status)

const _AI_VALIDATION_REMOVED = true; // marker for git diff clarity
const AI_STATUS_OPTIONS = [
  { value: "", label: "All" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "pending", label: "Pending" },
  { value: "override_approved", label: "Override (Approved)" },
  { value: "override_rejected", label: "Override (Rejected)" },
];

function AIValidationTab() {
  const { addToast } = useToast();
  // Note: removed mounted.current pattern — broken in React 18 StrictMode dev mode.
  // React 18 silently no-ops setState on unmounted components.

  // ── Run Validation state ──
  const [runCategory, setRunCategory] = useState("");
  const [runLimit, setRunLimit] = useState(25);
  const [dryRun, setDryRun] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResults, setRunResults] = useState(null);
  const [progress, setProgress] = useState(null);

  // ── Browser state ──
  const [cards, setCards] = useState([]);
  const [browserTotal, setBrowserTotal] = useState(0);
  const [browserPage, setBrowserPage] = useState(1);
  const [browserLoading, setBrowserLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const BROWSER_PAGE_SIZE = 20;

  // ── Validation stats ──
  const [stats, setStats] = useState(null);

  const fetchStats = useCallback(async () => {
    const [totalRes, approvedRes, rejectedRes, pendingRes, overriddenRes] = await Promise.all([
      supabase.from("card_pool").select("id", { count: "exact", head: true })
        .eq("is_active", true).eq("card_type", "single"),
      supabase.from("card_pool").select("id", { count: "exact", head: true })
        .eq("is_active", true).eq("card_type", "single").eq("ai_approved", true).is("ai_override", null),
      supabase.from("card_pool").select("id", { count: "exact", head: true })
        .eq("is_active", true).eq("card_type", "single").eq("ai_approved", false).is("ai_override", null),
      supabase.from("card_pool").select("id", { count: "exact", head: true })
        .eq("is_active", true).eq("card_type", "single").is("ai_approved", null),
      supabase.from("card_pool").select("id", { count: "exact", head: true })
        .eq("is_active", true).eq("card_type", "single").not("ai_override", "is", null),
    ]);
    setStats({
      total: totalRes.count ?? 0,
      approved: approvedRes.count ?? 0,
      rejected: rejectedRes.count ?? 0,
      pending: pendingRes.count ?? 0,
      overridden: overriddenRes.count ?? 0,
      validated: (approvedRes.count ?? 0) + (rejectedRes.count ?? 0) + (overriddenRes.count ?? 0),
    });
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  // ── Restore last run from localStorage ──
  useEffect(() => {
    try {
      const saved = localStorage.getItem("ai_validation_last_run");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000) {
          setRunResults(parsed);
        } else {
          localStorage.removeItem("ai_validation_last_run");
        }
      }
    } catch { /* ignore parse errors */ }
  }, []);

  // ── Run AI Validation (micro-batch loop) ──
  const handleRunValidation = async () => {
    setRunning(true);
    setRunResults(null);
    setProgress({ processed: 0, approved: 0, rejected: 0, failed: 0, total: runLimit });

    let afterCreatedAt = null;
    let totalProcessed = 0;
    let totalApproved = 0;
    let totalRejected = 0;
    let totalFailed = 0;
    let totalCategoriesChanged = 0;
    let totalCost = 0;
    const allRejectedExamples = [];
    const allRecategorizedExamples = [];
    const MICRO_BATCH = 5;

    try {
      while (totalProcessed < runLimit) {
        const batchLimit = Math.min(MICRO_BATCH, runLimit - totalProcessed);
        const body = { limit: batchLimit, dryRun };
        if (runCategory) body.categorySlug = runCategory;
        if (afterCreatedAt) body.afterCreatedAt = afterCreatedAt;

        const { data: rawData, error } = await supabase.functions.invoke("ai-validate-cards", { body });
        if (error) throw error;
        const data = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
        totalProcessed += data.processed;
        totalApproved += data.approved;
        totalRejected += data.rejected;
        totalFailed += data.failed || 0;
        totalCategoriesChanged += data.categoriesChanged || 0;
        totalCost += data.costUsd || 0;
        if (data.rejectedExamples) allRejectedExamples.push(...data.rejectedExamples);
        if (data.recategorizedExamples) allRecategorizedExamples.push(...data.recategorizedExamples);

        setProgress({
          processed: totalProcessed,
          approved: totalApproved,
          rejected: totalRejected,
          failed: totalFailed,
          total: runLimit,
        });

        afterCreatedAt = data.continuation_token;
        if (data.processed < batchLimit || !data.continuation_token) break;
      }

      const finalResults = {
        processed: totalProcessed,
        approved: totalApproved,
        rejected: totalRejected,
        failed: totalFailed,
        categoriesChanged: totalCategoriesChanged,
        costUsd: Math.round(totalCost * 100) / 100,
        rejectedExamples: allRejectedExamples.slice(0, 10),
        recategorizedExamples: allRecategorizedExamples.slice(0, 10),
        dryRun,
        timestamp: Date.now(),
      };
      setRunResults(finalResults);
      localStorage.setItem("ai_validation_last_run", JSON.stringify(finalResults));
      addToast({ variant: "success", title: `Validated ${totalProcessed} cards` });
      fetchCards();
      fetchStats();
    } catch (err) {
      addToast({ variant: "error", title: "Validation failed", description: err.message });
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  // ── Fetch cards with AI status ──
  const fetchCards = useCallback(async () => {
    setBrowserLoading(true);
    let q = supabase.from("card_pool")
      .select(`
        id, categories, original_categories, ai_approved, ai_reason,
        ai_categories, ai_validated_at, ai_override, card_type,
        place_pool ( name, address )
      `, { count: "exact" })
      .eq("is_active", true)
      .eq("card_type", "single")
      .order("ai_validated_at", { ascending: false, nullsFirst: false });

    // Status filter
    if (statusFilter === "approved") { q = q.eq("ai_approved", true).is("ai_override", null); }
    else if (statusFilter === "rejected") { q = q.eq("ai_approved", false).is("ai_override", null); }
    else if (statusFilter === "pending") { q = q.is("ai_approved", null); }
    else if (statusFilter === "override_approved") { q = q.eq("ai_override", true); }
    else if (statusFilter === "override_rejected") { q = q.eq("ai_override", false); }

    if (catFilter) q = q.contains("categories", [catFilter]);

    q = q.range((browserPage - 1) * BROWSER_PAGE_SIZE, browserPage * BROWSER_PAGE_SIZE - 1);
    const { data, count, error } = await q;
    if (error) {
      console.error("AI browser fetch error:", error.message, error.details, error.hint);
    }
    if (!error) {
      setCards(data || []);
      setBrowserTotal(count ?? data?.length ?? 0);
    }
    setBrowserLoading(false);
  }, [statusFilter, catFilter, browserPage]);

  useEffect(() => { fetchCards(); }, [fetchCards]);

  // ── Auto-refresh browser during validation ──
  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => { fetchCards(); }, 30000);
    return () => clearInterval(interval);
  }, [running, fetchCards]);

  // ── Override handler ──
  const handleOverride = async (cardId, newValue) => {
    const { error } = await supabase
      .from("card_pool")
      .update({ ai_override: newValue })
      .eq("id", cardId);
    if (error) { addToast({ variant: "error", title: "Override failed", description: error.message }); return; }
    addToast({ variant: "success", title: newValue === null ? "Override cleared" : newValue ? "Force-approved" : "Force-rejected" });
    fetchCards();
    fetchStats();
  };

  const getStatusBadge = (card) => {
    if (card.ai_override === true) return <Badge variant="info">Override: Show</Badge>;
    if (card.ai_override === false) return <Badge variant="error">Override: Hide</Badge>;
    if (card.ai_approved === true) return <Badge variant="success">Approved</Badge>;
    if (card.ai_approved === false) return <Badge variant="error">Rejected</Badge>;
    return <Badge variant="outline">Pending</Badge>;
  };

  const totalPages = Math.ceil(browserTotal / BROWSER_PAGE_SIZE);

  const browserColumns = [
    { key: "name", label: "Place", render: (_, r) => r.place_pool?.name || "—" },
    { key: "original_categories", label: "Original", render: (_, r) => (r.original_categories || []).join(", ") || "—" },
    { key: "ai_categories", label: "AI Categories", render: (_, r) => (r.ai_categories || []).join(", ") || "—" },
    { key: "status", label: "Status", render: (_, r) => getStatusBadge(r) },
    { key: "ai_reason", label: "Reason", render: (_, r) => <span className="text-xs max-w-xs truncate block" title={r.ai_reason}>{r.ai_reason || "—"}</span> },
    { key: "ai_validated_at", label: "Validated", render: (_, r) => r.ai_validated_at ? new Date(r.ai_validated_at).toLocaleDateString() : "—" },
    { key: "actions", label: "Override", render: (_, r) => (
      <div className="flex gap-1">
        <button onClick={() => handleOverride(r.id, true)} title="Force approve"
          className="p-1 rounded hover:bg-green-100 dark:hover:bg-green-900/30 text-green-600 cursor-pointer">
          <CheckCircle className="w-4 h-4" />
        </button>
        <button onClick={() => handleOverride(r.id, false)} title="Force reject"
          className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500 cursor-pointer">
          <XCircle className="w-4 h-4" />
        </button>
        {r.ai_override !== null && (
          <button onClick={() => handleOverride(r.id, null)} title="Clear override"
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 cursor-pointer">
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    )},
  ];

  return (
    <div className="space-y-6 py-6">
      {/* ── Validation Overview ── */}
      {stats && (
        <SectionCard title="Validation Overview" subtitle={stats.pending > 0 ? `${stats.pending} cards need validation` : "All cards validated"}>
          <div className="flex gap-3 flex-wrap">
            <StatCard label="Total Cards" value={stats.total} className="flex-1 min-w-[100px]" />
            <StatCard label="Validated" value={stats.validated} className="flex-1 min-w-[100px]" />
            <StatCard label="Pending" value={stats.pending} className="flex-1 min-w-[100px]" />
            <StatCard label="Approved" value={stats.approved} className="flex-1 min-w-[100px]" />
            <StatCard label="Rejected" value={stats.rejected} className="flex-1 min-w-[100px]" />
            <StatCard label="Overridden" value={stats.overridden} className="flex-1 min-w-[100px]" />
          </div>
          <div className="mt-3">
            <div className="flex justify-between text-xs text-[var(--color-text-secondary)] mb-1">
              <span>{stats.validated} of {stats.total} cards validated ({stats.total > 0 ? Math.round(stats.validated / stats.total * 100) : 0}%)</span>
              <span>{stats.pending} remaining</span>
            </div>
            <div className="w-full h-2 bg-[var(--gray-200)] rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${stats.total > 0 ? (stats.validated / stats.total * 100) : 0}%`,
                  background: stats.validated > 0
                    ? `linear-gradient(to right, #22c55e ${Math.round(stats.approved / stats.validated * 100)}%, #ef4444 ${Math.round(stats.approved / stats.validated * 100)}%)`
                    : "var(--gray-300)"
                }}
              />
            </div>
            <div className="flex gap-4 mt-1 text-xs text-[var(--color-text-muted)]">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> Approved ({stats.approved})</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> Rejected ({stats.rejected})</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-300" /> Pending ({stats.pending})</span>
            </div>
          </div>
        </SectionCard>
      )}

      {/* ── Run Validation Panel ── */}
      <SectionCard title="Run AI Validation" subtitle="Validate cards using GPT-5.4-mini with web search">
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-48">
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Category</label>
            <select value={runCategory} onChange={e => setRunCategory(e.target.value)}
              className="w-full h-10 text-sm bg-[var(--color-background-primary)] text-[var(--color-text-primary)] border border-[var(--gray-300)] rounded-lg px-3 outline-none">
              <option value="">All Categories</option>
              {ALL_CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
            </select>
          </div>
          <div className="w-28">
            <Input label="Limit" type="number" value={runLimit} onChange={e => setRunLimit(Math.min(100, Math.max(1, parseInt(e.target.value) || 25)))} />
          </div>
          <Toggle label="Dry run" checked={dryRun} onChange={setDryRun} />
          <Button variant="primary" icon={Zap} loading={running} onClick={handleRunValidation}>
            {running ? "Validating..." : "Run AI Validation"}
          </Button>
        </div>

        {/* Progress bar during validation */}
        {progress && (
          <div className="mt-4 space-y-2">
            <div className="flex justify-between text-xs text-[var(--color-text-secondary)]">
              <span>Processing card {progress.processed} of {progress.total}...</span>
              <span>{progress.approved} approved · {progress.rejected} rejected · {progress.failed} failed</span>
            </div>
            <div className="w-full h-2 bg-[var(--gray-200)] rounded-full overflow-hidden">
              <div
                className="h-full bg-[var(--color-brand-500)] rounded-full transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(0, (progress.processed / progress.total) * 100) || 0)}%` }}
              />
            </div>
          </div>
        )}

        {/* Results summary */}
        {runResults && (
          <div className="mt-4 space-y-3">
            <div className="flex gap-3 flex-wrap">
              <StatCard label="Processed" value={runResults.processed} className="flex-1 min-w-[100px]" />
              <StatCard label="Approved" value={runResults.approved} className="flex-1 min-w-[100px]" />
              <StatCard label="Rejected" value={runResults.rejected} className="flex-1 min-w-[100px]" />
              <StatCard label="Recategorized" value={runResults.categoriesChanged} className="flex-1 min-w-[100px]" />
              <StatCard label="Est. Cost" value={`$${runResults.costUsd}`} className="flex-1 min-w-[100px]" />
            </div>
            {runResults.timestamp && (
              <p className="text-xs text-[var(--color-text-muted)]">
                Last run: {new Date(runResults.timestamp).toLocaleString()}{runResults.dryRun ? " (dry run)" : ""}
              </p>
            )}
            {runResults.dryRun && <p className="text-xs text-amber-500 font-medium">Dry run — no changes written to database</p>}

            {runResults.rejectedExamples?.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-[var(--color-text-primary)] mb-1">Rejected Examples</h4>
                <DataTable columns={[
                  { key: "name", label: "Place" },
                  { key: "originalCategory", label: "Category" },
                  { key: "reason", label: "Reason" },
                ]} rows={runResults.rejectedExamples} />
              </div>
            )}

            {runResults.recategorizedExamples?.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-[var(--color-text-primary)] mb-1">Recategorized Examples</h4>
                <DataTable columns={[
                  { key: "name", label: "Place" },
                  { key: "from", label: "From", render: (_, r) => r.from.join(", ") },
                  { key: "to", label: "To", render: (_, r) => r.to.join(", ") },
                  { key: "reason", label: "Reason" },
                ]} rows={runResults.recategorizedExamples} />
              </div>
            )}
          </div>
        )}
      </SectionCard>

      {/* ── AI Status Browser ── */}
      <SectionCard title="AI Status Browser" subtitle={`${browserTotal} cards`}>
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div className="w-44">
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">AI Status</label>
            <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setBrowserPage(1); }}
              className="w-full h-10 text-sm bg-[var(--color-background-primary)] text-[var(--color-text-primary)] border border-[var(--gray-300)] rounded-lg px-3 outline-none">
              {AI_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="w-44">
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Category</label>
            <select value={catFilter} onChange={e => { setCatFilter(e.target.value); setBrowserPage(1); }}
              className="w-full h-10 text-sm bg-[var(--color-background-primary)] text-[var(--color-text-primary)] border border-[var(--gray-300)] rounded-lg px-3 outline-none">
              <option value="">All</option>
              {ALL_CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
            </select>
          </div>
          <Button variant="ghost" icon={RefreshCw} onClick={fetchCards} loading={browserLoading}>Refresh</Button>
        </div>

        {browserLoading && cards.length === 0
          ? <div className="text-center py-8 text-[var(--color-text-muted)]"><Loader className="w-5 h-5 animate-spin mx-auto mb-2" />Loading...</div>
          : cards.length === 0
            ? <div className="text-center py-8 text-[var(--color-text-muted)]">No cards match filters</div>
            : <DataTable columns={browserColumns} rows={cards} />
        }

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-3">
            <span className="text-xs text-[var(--color-text-muted)]">Page {browserPage} of {totalPages}</span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" disabled={browserPage <= 1} onClick={() => setBrowserPage(p => p - 1)}>Previous</Button>
              <Button variant="ghost" size="sm" disabled={browserPage >= totalPages} onClick={() => setBrowserPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ── Tab 6: Stale Review ──────────────────────────────────────────────────────

function StaleTab({ selectedCountry, selectedCity }) {
  const { addToast } = useToast();
  const [stale, setStale] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    let q = supabase.from("place_pool").select("id, name, rating, seeding_category, city, country, last_detail_refresh, refresh_failures")
      .eq("is_active", true)
      .lt("last_detail_refresh", new Date(Date.now() - 7 * 86400000).toISOString())
      .order("last_detail_refresh", { ascending: true })
      .limit(100);
    if (selectedCity) q = q.eq("city", selectedCity);
    else if (selectedCountry) q = q.eq("country", selectedCountry);
    q.then(({ data }) => { setStale(data || []); setLoading(false); });
  }, [selectedCountry, selectedCity]);

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

function StatsTab({ city, stats, refreshKey }) {
  const [ops, setOps] = useState([]);
  const [loadingOps, setLoadingOps] = useState(false);
  const [runs, setRuns] = useState([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [expandedRun, setExpandedRun] = useState(null);
  const [runBatches, setRunBatches] = useState([]);
  const [loadingBatches, setLoadingBatches] = useState(false);

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

  // Category breakdown from stats
  const byCat = stats?.by_seeding_category || {};

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

// ── Seeding Tab Wrapper (self-contained city selector) ──────────────────────

function SeedingTabWrapper({ registeredCity, tiles, stats, seedingOps, refreshKey, onRefresh, onDeleteCity, onSeedingChange, onAddCity }) {
  const [cities, setCities] = useState([]);
  const [selectedSeedCity, setSelectedSeedCity] = useState(registeredCity);
  const [seedTiles, setSeedTiles] = useState(tiles || []);
  const [seedStats, setSeedStats] = useState(stats);
  const [seedOps, setSeedOps] = useState(seedingOps || []);
  const [loadingCity, setLoadingCity] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // Load all seeding cities
  useEffect(() => {
    supabase.from("seeding_cities").select("*").order("name")
      .then(({ data }) => { if (mountedRef.current) setCities(data || []); });
  }, [refreshKey]);

  // Sync with parent if registeredCity matches
  useEffect(() => {
    if (registeredCity) {
      setSelectedSeedCity(registeredCity);
      setSeedTiles(tiles || []);
      setSeedStats(stats);
      setSeedOps(seedingOps || []);
    }
  }, [registeredCity, tiles, stats, seedingOps]);

  // When user picks a city from the dropdown, load its data
  const handleSelectCity = useCallback((city) => {
    setSelectedSeedCity(city);
    if (!city) { setSeedTiles([]); setSeedStats(null); setSeedOps([]); return; }
    setLoadingCity(true);

    Promise.all([
      supabase.from("seeding_tiles").select("*").eq("city_id", city.id).order("tile_index"),
      supabase.rpc("admin_city_place_stats", { p_city_id: city.id }),
      supabase.from("seeding_operations").select("*").eq("city_id", city.id).order("created_at", { ascending: false }).limit(50),
    ]).then(([tilesRes, statsRes, opsRes]) => {
      if (!mountedRef.current) return;
      setSeedTiles(tilesRes.data || []);
      setSeedStats(statsRes.data);
      setSeedOps(opsRes.data || []);
      setLoadingCity(false);
    });
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <select
          className="flex-1 rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 py-2 text-sm"
          value={selectedSeedCity?.id || ""}
          onChange={(e) => {
            const city = cities.find((c) => c.id === e.target.value);
            handleSelectCity(city || null);
          }}
        >
          <option value="">Select a seeding city...</option>
          {cities.map((c) => (
            <option key={c.id} value={c.id}>{c.name}, {c.country} — {c.status}</option>
          ))}
        </select>
        <Button icon={Plus} size="sm" onClick={onAddCity}>Add City</Button>
      </div>

      {loadingCity && <div className="text-center py-8 text-[var(--color-text-secondary)]">Loading city data...</div>}

      {!loadingCity && selectedSeedCity && (
        <SeedingTab
          registeredCity={selectedSeedCity} tiles={seedTiles} stats={seedStats}
          seedingOps={seedOps} refreshKey={refreshKey} onRefresh={() => { onRefresh(); handleSelectCity(selectedSeedCity); }}
          onDeleteCity={(city) => { onDeleteCity(city); setSelectedSeedCity(null); }}
          onSeedingChange={onSeedingChange}
        />
      )}

      {!loadingCity && !selectedSeedCity && (
        <div className="text-center py-12 text-[var(--color-text-tertiary)]">
          Select a city above to manage seeding, or add a new city.
        </div>
      )}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function PlacePoolManagementPage({ onTabChange }) {
  const mountedRef = useRef(true);
  const { addToast } = useToast();
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Breadcrumb navigation state
  const [selectedCountry, setSelectedCountry] = useState(null);
  const [selectedCity, setSelectedCity] = useState(null);
  const [countries, setCountries] = useState([]);

  // Tab state
  const [activeTab, setActiveTab] = useState("overview");
  const [seedingActive, setSeedingActive] = useState(false);

  // Seeding state (loaded when registered city is selected)
  const [registeredCity, setRegisteredCity] = useState(null); // seeding_cities row
  const [tiles, setTiles] = useState([]);
  const [stats, setStats] = useState(null);
  const [seedingOps, setSeedingOps] = useState([]);
  const [addCityOpen, setAddCityOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Load country list on mount
  useEffect(() => {
    supabase.rpc("admin_place_country_overview").then(({ data }) => {
      if (mountedRef.current && data) setCountries(data.map((r) => r.country));
    });
  }, [refreshKey]);

  const selectCountry = useCallback((country) => {
    setSelectedCountry(country);
    setSelectedCity(null);
    setRegisteredCity(null);
  }, []);

  const selectCity = useCallback((cityName) => {
    setSelectedCity(cityName);
  }, []);

  const clearCountry = useCallback(() => {
    setSelectedCountry(null);
    setSelectedCity(null);
    setRegisteredCity(null);
  }, []);

  const clearCity = useCallback(() => {
    setSelectedCity(null);
    setRegisteredCity(null);
  }, []);

  // Check if selected city is registered in seeding_cities
  useEffect(() => {
    if (!selectedCity || !selectedCountry) { setRegisteredCity(null); setTiles([]); setStats(null); setSeedingOps([]); return; }

    supabase.from("seeding_cities").select("*")
      .eq("name", selectedCity).eq("country", selectedCountry)
      .maybeSingle()
      .then(({ data }) => {
        if (!mountedRef.current) return;
        setRegisteredCity(data || null);

        if (data) {
          // Load tiles
          supabase.from("seeding_tiles").select("*").eq("city_id", data.id).order("tile_index")
            .then(({ data: t }) => { if (mountedRef.current) setTiles(t || []); });
          // Load stats
          supabase.rpc("admin_city_place_stats", { p_city_id: data.id })
            .then(({ data: s }) => { if (mountedRef.current) setStats(s); });
          // Load seeding ops
          supabase.from("seeding_operations").select("*").eq("city_id", data.id)
            .then(({ data: ops }) => { if (mountedRef.current) setSeedingOps(ops || []); });
        } else {
          setTiles([]);
          setStats(null);
          setSeedingOps([]);
        }
      });
  }, [selectedCity, selectedCountry, refreshKey]);

  const isCityRegistered = !!registeredCity;

  // Dynamic tabs — Seeding always visible (has its own city selector inside)
  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "browse", label: "Browse Pool" },
    { id: "map", label: "Map View" },
    { id: "seeding", label: "Seeding" },
    { id: "photos", label: "Photo Management" },
    { id: "stale", label: "Stale Review" },
  ];

  // Reset to valid tab when tabs change
  useEffect(() => {
    if (!tabs.find((t) => t.id === activeTab)) setActiveTab("overview");
  }, [tabs, activeTab]);

  const handleAddCity = (city) => {
    refresh();
    // Select the new city
    setSelectedCountry(city.country);
    setSelectedCity(city.name);
  };

  const handleDeleteCity = async (city) => {
    try {
      const { error } = await supabase.from("seeding_cities").delete().eq("id", city.id);
      if (error) throw error;
      addToast({ variant: "success", title: `Deleted draft "${city.name}"` });
      setRegisteredCity(null);
      refresh();
    } catch (err) {
      addToast({ variant: "error", title: "Delete failed", description: err.message });
    }
  };

  return (
    <div className="space-y-4 py-6">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Place Pool Management</h2>
          <p className="text-sm text-[var(--color-text-secondary)]">Browse, manage, and seed places across all cities.</p>
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

      <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      <div className="mt-4" key={refreshKey}>
        {activeTab === "overview" && (
          <OverviewTab selectedCountry={selectedCountry} selectedCity={selectedCity}
            onSelectCountry={selectCountry} onSelectCity={selectCity} />
        )}
        {activeTab === "browse" && (
          <BrowseTab selectedCountry={selectedCountry} selectedCity={selectedCity} onRefresh={refresh} />
        )}
        {activeTab === "map" && (
          <MapTab selectedCountry={selectedCountry} selectedCity={selectedCity}
            registeredCity={registeredCity} tiles={tiles} seedingOps={seedingOps} />
        )}
        {activeTab === "seeding" && (
          <SeedingTabWrapper
            registeredCity={registeredCity} tiles={tiles} stats={stats} seedingOps={seedingOps}
            refreshKey={refreshKey} onRefresh={refresh} onDeleteCity={handleDeleteCity} onSeedingChange={setSeedingActive}
            onAddCity={() => setAddCityOpen(true)}
          />
        )}
        {activeTab === "photos" && (
          <PhotoTab selectedCountry={selectedCountry} selectedCity={selectedCity} />
        )}
        {activeTab === "stale" && (
          <StaleTab selectedCountry={selectedCountry} selectedCity={selectedCity} />
        )}
      </div>

      <AddCityModal open={addCityOpen} onClose={() => setAddCityOpen(false)} onSave={handleAddCity} />
    </div>
  );
}

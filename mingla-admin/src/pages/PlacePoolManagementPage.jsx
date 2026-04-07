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

const HARD_CAP_USD = 500;

// ── Helpers ──────────────────────────────────────────────────────────────────

function RecenterMap({ center, zoom }) {
  const map = useMap();
  useEffect(() => { if (center) map.setView(center, zoom); }, [center, zoom, map]);
  return null;
}

function formatCost(n) { return `$${(n || 0).toFixed(2)}`; }
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
                  <span className="text-xs text-[var(--color-text-tertiary)]">{(c.ai_approved_places || 0).toLocaleString()}</span>
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

        // Start the edge function call (don't await yet)
        const fnPromise = supabase.functions.invoke("ai-validate-places", {
          body: {
            jobId,
            limit: 25,
            revalidate: job.revalidate,
            ...(token ? { afterCreatedAt: token } : {}),
            ...(job.country_filter ? { countryFilter: job.country_filter } : {}),
            ...(job.city_filter ? { cityFilter: job.city_filter } : {}),
          },
        });

        // Poll the job row every 3s while the edge function is running
        let fnDone = false;
        let fnResult = null;
        fnPromise.then((r) => { fnResult = r; fnDone = true; });

        while (!fnDone && !jobCancelledRef.current) {
          await new Promise((r) => setTimeout(r, 3000));
          const { data: polled } = await supabase
            .from("ai_validation_jobs")
            .select("processed, approved, rejected, failed")
            .eq("id", jobId)
            .single();
          if (polled) {
            setActiveJob((prev) => ({ ...prev, ...polled }));
          }
        }

        if (jobCancelledRef.current) break;

        const resp = fnResult;
        if (resp.error) {
          const errMsg = resp.error?.message || resp.error?.context?.statusText || JSON.stringify(resp.error);
          throw new Error(errMsg);
        }

        const r = typeof resp.data === "string" ? JSON.parse(resp.data) : resp.data;
        if (!r || typeof r.processed !== "number") {
          throw new Error("Unexpected response: " + JSON.stringify(r));
        }

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
      country_filter: scopeCountryName || null,
      city_filter: scopeCityName || null,
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
            (job.country_filter || null) === (scopeCountryName || null) &&
            (job.city_filter || null) === (scopeCityName || null);
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

  const scopeLabel = selectedCity
    ? "City scope"
    : selectedCountry ? "Country scope" : "Global pool";

  const aiPct = data.active_places > 0 ? Math.round(((data.ai_approved_places || data.ai_approved_count || 0) / data.active_places) * 100) : 0;

  const isGlobal = !selectedCountry;
  const isCountryLevel = !!selectedCountry && !selectedCity;

  // Drill-down columns
  const countryDrillColumns = [
    { key: "country_name", label: "Country", sortable: true, render: (_, r) => (
      <button onClick={() => onSelectCountry(r.country_code)} className="text-[var(--color-brand-500)] hover:underline cursor-pointer font-medium text-left">
        {countryFlag(r.country_code)} {r.country_name}
      </button>
    )},
    { key: "ai_approved_places", label: "AI Approved", sortable: true, render: (_, r) => (r.ai_approved_places || 0).toLocaleString() },
    { key: "photo_pct", label: "Photo %", sortable: true, render: (_, r) => <Badge variant={pctColor(r.photo_pct || 0)}>{r.photo_pct || 0}%</Badge> },
    { key: "ai_validated_pct", label: "AI Validated %", sortable: true, render: (_, r) => <Badge variant={pctColor(r.ai_validated_pct || 0)}>{r.ai_validated_pct || 0}%</Badge> },
    { key: "category_coverage", label: "Categories", sortable: true, render: (_, r) => `${r.category_coverage || 0}/13` },
    { key: "city_count", label: "Cities", sortable: true },
  ];

  const cityDrillColumns = [
    { key: "city_name", label: "City", sortable: true, render: (_, r) => (
      <button onClick={() => onSelectCity(r.city_id)} className="text-[var(--color-brand-500)] hover:underline cursor-pointer font-medium text-left">{r.city_name}</button>
    )},
    { key: "ai_approved_places", label: "AI Approved", sortable: true, render: (_, r) => (r.ai_approved_places || 0).toLocaleString() },
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
    { key: "place_count", label: "AI Approved", sortable: true },
    { key: "photo_pct", label: "Photo %", sortable: true, render: (_, r) => <Badge variant={pctColor(r.photo_pct || 0)}>{r.photo_pct || 0}%</Badge> },
    { key: "avg_rating", label: "Avg Rating", sortable: true, render: (_, r) => r.avg_rating ? `★ ${r.avg_rating}` : "—" },
  ];

  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--color-text-secondary)]">Showing {scopeLabel}</p>

      <div className="grid grid-cols-4 gap-4">
        <StatCard icon={Globe} label="Active Places" value={data.active_places} />
        <StatCard icon={Camera} label="Photo Coverage" value={`${data.photo_pct}%`}
          trend={data.photo_pct >= 80 ? "Good" : data.photo_pct >= 50 ? "Fair" : "Low"} trendUp={data.photo_pct >= 80} />
        <StatCard icon={Eye} label="AI Validated" value={`${aiPct}%`}
          trend={`${data.ai_validated_count} of ${data.active_places}`} trendUp={aiPct >= 50} />
        <StatCard icon={Clock} label="Pending Review" value={data.ai_pending_count || 0}
          trend={data.ai_pending_count === 0 ? "All validated" : "Needs validation"} trendUp={data.ai_pending_count === 0} />
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
                        ...(scopeCountryName ? { countryFilter: scopeCountryName } : {}),
                        ...(scopeCityName ? { cityFilter: scopeCityName } : {}),
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
  const [expandedPhoto, setExpandedPhoto] = useState(null);
  const [editForm, setEditForm] = useState({
    name: "", price_tiers: [], seeding_category: "", is_active: true,
    ai_approved: null, ai_primary_identity: "", ai_categories: [], ai_reason: "", ai_confidence: null,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !place) return;
    setEditForm({
      name: place.name || "",
      price_tiers: place.price_tiers?.length ? place.price_tiers : (place.price_tier ? [place.price_tier] : []),
      seeding_category: place.seeding_category || "",
      is_active: place.is_active,
      ai_approved: place.ai_approved,
      ai_primary_identity: place.ai_primary_identity || "",
      ai_categories: place.ai_categories || [],
      ai_reason: place.ai_reason || "",
      ai_confidence: place.ai_confidence,
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

    // Save AI fields directly
    const { error: aiErr } = await supabase.from("place_pool").update({
      ai_approved: editForm.ai_approved,
      ai_primary_identity: editForm.ai_primary_identity || null,
      ai_categories: editForm.ai_categories.length > 0 ? editForm.ai_categories : null,
      ai_reason: editForm.ai_reason || null,
      ai_confidence: editForm.ai_confidence,
      ai_validated_at: new Date().toISOString(),
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

          {/* AI Override Controls */}
          <div>
            <h4 className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2">AI Classification Override</h4>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[var(--color-text-secondary)]">AI Status</label>
                  <select className="block mt-1 w-full rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm"
                    value={editForm.ai_approved === null ? "" : editForm.ai_approved ? "true" : "false"}
                    onChange={(e) => setEditForm((f) => ({ ...f, ai_approved: e.target.value === "" ? null : e.target.value === "true" }))}>
                    <option value="">Pending</option>
                    <option value="true">Approved</option>
                    <option value="false">Rejected</option>
                  </select>
                </div>
                <Input label="Primary Identity" value={editForm.ai_primary_identity} placeholder="e.g. restaurant, spa, museum"
                  onChange={(e) => setEditForm((f) => ({ ...f, ai_primary_identity: e.target.value }))} />
              </div>
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
              <Input label="AI Reason" value={editForm.ai_reason} placeholder="Why this classification"
                onChange={(e) => setEditForm((f) => ({ ...f, ai_reason: e.target.value }))} />
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

const TILE_RADIUS_OPTIONS = [
  { value: "1500", label: "1500m", desc: "Fine" },
  { value: "2000", label: "2000m", desc: "Standard" },
  { value: "2500", label: "2500m", desc: "Coarse" },
];

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
          ...(city && {
            lat: city.center_lat,
            lng: city.center_lng,
            radius: city.bbox_sw_lat && city.bbox_ne_lat
              ? Math.round(Math.sqrt(
                  Math.pow((city.bbox_ne_lat - city.bbox_sw_lat) * 111320, 2) +
                  Math.pow((city.bbox_ne_lng - city.bbox_sw_lng) * 111320 * Math.cos((city.center_lat * Math.PI) / 180), 2)
                ) / 2)
              : (city.coverage_radius_km || 10) * 1000,
          }),
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
      body: { action: "push", places, seedingCategory: category || null, cityId: city?.id || null },
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
      <SectionCard title="Tile Grid" subtitle={`${tiles.length} tiles${city.bbox_sw_lat ? ' in bounding box' : ''} · ${city.tile_radius_m}m tile radius`}
        action={<div className="flex gap-2">
          <Button size="sm" icon={RefreshCw} variant="secondary" onClick={async () => {
            await supabase.functions.invoke("admin-seed-places", { body: { action: "generate_tiles", cityId: city.id } });
            onRefresh();
          }} disabled={!!activeRun}>Regenerate</Button>
        </div>}>
        <p className="text-sm text-[var(--color-text-secondary)]">
          {city.bbox_sw_lat && city.bbox_ne_lat
            ? `Bbox: ${((city.bbox_ne_lat - city.bbox_sw_lat) * 111.32).toFixed(1)}km × ${((city.bbox_ne_lng - city.bbox_sw_lng) * 111.32 * Math.cos((city.center_lat * Math.PI) / 180)).toFixed(1)}km`
            : `Coverage: ${city.coverage_radius_km}km radius`
          } · Spacing: {Math.round(city.tile_radius_m * 1.4)}m
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
      .select("id, name, lat, lng, rating, ai_categories, seeding_category, is_active, stored_photo_urls, ai_approved")
      .eq("is_active", true)
      .eq("ai_approved", true)
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
  const [filters, setFilters] = useState({ category: "", status: "active", photoStatus: "", priceTier: "", priceLevel: "", minRating: "", aiStatus: "", nameSearch: "" });
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
    if (filters.aiStatus === "validated") q = q.eq("ai_approved", true);
    else if (filters.aiStatus === "rejected") q = q.eq("ai_approved", false);
    else if (filters.aiStatus === "pending") q = q.is("ai_approved", null);
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
          <label className="text-xs text-[var(--color-text-secondary)]">AI Status</label>
          <select className="block mt-1 rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm"
            value={filters.aiStatus} onChange={(e) => { setFilters((f) => ({ ...f, aiStatus: e.target.value })); setPage(0); }}>
            <option value="">All</option>
            <option value="validated">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="pending">Pending</option>
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
  // Text names for edge function calls (backfill-place-photos expects text, not UUID)
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
    if (error) throw new Error(error.message || "Edge function error");
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
    if (analysis.blockedByAiApproval > 0) parts.push(`${formatCount(analysis.blockedByAiApproval)} not AI-approved`);
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

  const fetchPreview = async () => {
    if (!selectedCity) return;
    try {
      const data = await invoke({
        action: "preview_run",
        city: cityTextName,
        country: countryTextName,
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

  const handleCreateRun = async () => {
    setCreating(true);
    try {
      const data = await invoke({
        action: "create_run",
        city: cityTextName,
        country: countryTextName,
      });

      if (data.status === "nothing_to_do") {
        const blockedDescription = formatPreviewBreakdown(data.analysis);
        addToast({
          variant: "info",
          title: data.analysis?.withoutStoredPhotos > 0
            ? `No downloadable photo candidates in ${selectedCity}`
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
        title: "Photo download run created",
        description: `${data.totalPlaces} places, ${data.totalBatches} batches, est. ${formatCost(data.estimatedCostUsd)}`,
      });
      await refreshPhotoState();
    } catch (err) {
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
        <StatCard icon={AlertTriangle} label="Not AI Approved" value={previewSummary ? formatCount(previewSummary.blockedByAiApproval) : "—"} />
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

          {missingCount === 0 ? (
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
              <div className="flex gap-2">
                {(downloadableCount === null || downloadableCount > 0) && (
                  <Button variant="primary" icon={Download} onClick={handleCreateRun} disabled={creating}>
                    {creating ? "Creating..." : `Start Photo Download (${formatCount(downloadableCount ?? missingCount)} places)`}
                  </Button>
                )}
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


// ── RejectedTab ─────────────────────────────────────────────────────────────

function RejectedTab({ scope, onRefresh }) {
  const { addToast } = useToast();
  const [places, setPlaces] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [approveModal, setApproveModal] = useState(null);
  const [selectedCat, setSelectedCat] = useState("");
  const [detailPlace, setDetailPlace] = useState(null);
  const PAGE_SIZE = 20;

  const fetchRejected = useCallback(async () => {
    setLoading(true);
    let q = supabase.from("place_pool")
      .select("*", { count: "exact" })
      .eq("is_active", true)
      .eq("ai_approved", false);
    if (scope.cityId) q = q.eq("city_id", scope.cityId);
    q = q.order("name").range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    const { data, count } = await q;
    setPlaces(data || []);
    setTotal(count || 0);
    setLoading(false);
  }, [scope.cityId, page]);

  useEffect(() => { fetchRejected(); }, [fetchRejected]);
  useEffect(() => { setPage(0); }, [scope.cityId]);

  const handleApprove = async () => {
    if (!approveModal || !selectedCat) return;
    const { error } = await supabase.from("place_pool").update({
      ai_approved: true,
      ai_categories: [selectedCat],
      ai_validated_at: new Date().toISOString(),
    }).eq("id", approveModal.id);
    if (error) { addToast({ variant: "error", title: "Approve failed", description: error.message }); return; }
    addToast({ variant: "success", title: `Approved "${approveModal.name}"` });
    setApproveModal(null);
    setSelectedCat("");
    fetchRejected();
    if (onRefresh) onRefresh();
  };

  const handleDelete = async (place) => {
    if (!confirm(`Delete "${place.name}"? This sets it to inactive.`)) return;
    const { error } = await supabase.from("place_pool").update({ is_active: false }).eq("id", place.id);
    if (error) { addToast({ variant: "error", title: "Delete failed", description: error.message }); return; }
    addToast({ variant: "success", title: `Deleted "${place.name}"` });
    fetchRejected();
    if (onRefresh) onRefresh();
  };

  const columns = [
    { key: "name", label: "Name", sortable: true, render: (_, r) => (
      <button className="text-[var(--color-brand-500)] hover:underline cursor-pointer text-left min-w-[200px]"
        onClick={() => setDetailPlace(r)}>{r.name}</button>
    )},
    { key: "address", label: "Address", render: (_, r) => <span className="text-xs max-w-[250px] truncate block">{r.address || "—"}</span> },
    { key: "ai_reason", label: "AI Reason", render: (_, r) => <span className="text-xs max-w-[250px] truncate block text-[var(--color-error-600)]">{r.ai_reason || "—"}</span> },
    { key: "seeding_category", label: "Discovered Via", render: (_, r) => r.seeding_category ? (
      <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full text-white/70" style={{ backgroundColor: CATEGORY_COLORS[r.seeding_category] || "#6b7280" }}>
        {CATEGORY_LABELS[r.seeding_category] || r.seeding_category}
      </span>
    ) : "—" },
    { key: "rating", label: "Rating", render: (_, r) => r.rating ? `★ ${r.rating}` : "—" },
    { key: "actions", label: "", render: (_, r) => (
      <div className="flex gap-1">
        <button onClick={() => { setApproveModal(r); setSelectedCat(""); }}
          className="p-1 rounded hover:bg-green-100 text-green-600 cursor-pointer" title="Override → Approve">
          <CheckCircle className="w-4 h-4" />
        </button>
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
        <StatCard icon={AlertTriangle} label="Total Rejected" value={total} />
      </div>

      <DataTable columns={columns} rows={places} loading={loading}
        emptyMessage="No rejected places" emptyIcon={CheckCircle}
        pagination={{ page, pageSize: PAGE_SIZE, total, onChange: setPage }} />

      {/* Approve modal */}
      <Modal open={!!approveModal} onClose={() => setApproveModal(null)} title={`Approve "${approveModal?.name || ""}"`} size="sm">
        <ModalBody>
          <p className="text-sm text-[var(--color-text-secondary)] mb-3">Pick a category for this place:</p>
          <div className="flex flex-wrap gap-2">
            {ALL_CATEGORIES.map((c) => (
              <button key={c} onClick={() => setSelectedCat(c)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
                  selectedCat === c ? "text-white border-transparent" : "bg-transparent border-[var(--gray-300)] text-[var(--color-text-secondary)]"
                }`}
                style={selectedCat === c ? { backgroundColor: CATEGORY_COLORS[c] } : {}}>
                {CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setApproveModal(null)}>Cancel</Button>
          <Button variant="primary" onClick={handleApprove} disabled={!selectedCat}>Approve</Button>
        </ModalFooter>
      </Modal>

      {/* Place detail modal — reuses the same modal as Browse tab */}
      <PlaceDetailModal place={detailPlace} open={!!detailPlace}
        onClose={() => setDetailPlace(null)} onSave={() => { fetchRejected(); if (onRefresh) onRefresh(); }} />
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

  const totalApproved = pickerCities.reduce((s, c) => s + (c.ai_approved_places || 0), 0);

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "browse", label: "Browse Pool" },
    { id: "map", label: "Map View" },
    { id: "seeding", label: "Seeding" },
    { id: "photos", label: "Photos" },
    { id: "rejected", label: "Rejected" },
  ];

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
    <div className="space-y-4 py-6">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Place Pool Management</h2>
            <p className="text-sm text-[var(--color-text-secondary)]">{scopeLabel} · {totalApproved.toLocaleString()} AI-approved places</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <CityPicker cities={pickerCities} scope={scope} onScopeChange={setScope} />
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
        {activeTab === "photos" && (
          scope.cityId ? (
            <PhotoTab scope={scope} registeredCity={registeredCity} onActiveRunsChange={setActivePhotoRuns} />
          ) : (
            <div className="text-center py-12 text-[var(--color-text-secondary)]">Select a city to manage photos.</div>
          )
        )}
        {activeTab === "rejected" && (
          <RejectedTab scope={scope} onRefresh={refresh} />
        )}
      </div>

      <AddCityModal open={addCityOpen} onClose={() => setAddCityOpen(false)} onSave={handleAddCity} />
    </div>
  );
}

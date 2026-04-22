/**
 * SIGNAL LIBRARY PAGE — ORCH-0588 + ORCH-0598.11
 *
 * List active signals; pick a city; run Bouncer + Scorer for that city; preview
 * top-50 places with score + contributions breakdown; cohort serving slider.
 *
 * Per-city as of ORCH-0598.11 — no longer Raleigh-hardcoded. City list comes
 * from the `admin_city_picker_data()` RPC (sourced from `seeding_cities`).
 *
 * Weight editing is still NOT in this version — admin tunes by inserting a new
 * signal_definition_versions row directly via SQL until a future editor ships.
 */

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity, ChevronRight, ChevronDown, RefreshCw, Play, AlertTriangle, Sparkles,
} from "lucide-react";
import { supabase, invokeWithRefresh } from "../lib/supabase";
import { useToast } from "../context/ToastContext";
import { SectionCard, AlertCard } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Spinner } from "../components/ui/Spinner";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatScore(s) {
  return s == null ? "—" : Number(s).toFixed(0);
}

function formatContribution(value) {
  if (typeof value === "number") {
    return value > 0 ? `+${value}` : String(value);
  }
  return String(value);
}

// ── Cohort slider ────────────────────────────────────────────────────────────

function CohortSlider({ signalId, onChange }) {
  const { showToast } = useToast();
  const [pct, setPct] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("admin_get_signal_serving_pct", {
        p_signal_id: signalId,
      });
      if (error) throw error;
      setPct(Number(data ?? 0));
    } catch (err) {
      showToast(`Couldn't load cohort pct: ${err.message}`, "error");
    } finally {
      setLoading(false);
    }
  }, [signalId, showToast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function setQuick(value) {
    if (saving) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc("admin_set_signal_serving_pct", {
        p_signal_id: signalId,
        p_pct: value,
      });
      if (error) throw error;
      setPct(value);
      showToast(`Cohort set to ${value}% (takes effect within 60s)`, "success");
      onChange?.(value);
    } catch (err) {
      showToast(`Couldn't save cohort pct: ${err.message}`, "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[--color-text-secondary]">
        <Spinner size="sm" /> Loading cohort…
      </div>
    );
  }

  const presets = [0, 5, 25, 50, 100];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-[--color-text-secondary]">
          Cohort serving: <span className="font-mono font-semibold text-[--color-text-primary]">{pct}%</span> of users on new path
        </div>
        {saving && <Spinner size="sm" />}
      </div>
      <div className="flex flex-wrap gap-2">
        {presets.map((p) => (
          <Button
            key={p}
            size="sm"
            variant={pct === p ? "primary" : "outline"}
            disabled={saving}
            onClick={() => setQuick(p)}
          >
            {p}%
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={refresh} disabled={saving}>
          <RefreshCw className="w-3 h-3" />
        </Button>
      </div>
      <div className="text-xs text-[--color-text-tertiary]">
        Edge fn caches for 60s — wait a minute after flipping before testing.
      </div>
    </div>
  );
}

// ── Run-bouncer trigger (city-wide; required before signal scoring) ──────────

function RunBouncerButton({ cityId, cityName, onComplete }) {
  const { showToast } = useToast();
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  async function trigger() {
    if (!cityId) {
      showToast("Pick a city first", "error");
      return;
    }
    setRunning(true);
    setLastResult(null);
    try {
      const { data, error } = await invokeWithRefresh("run-bouncer", {
        body: { city_id: cityId },
      });
      if (error) throw error;
      setLastResult(data);
      showToast(
        `Bouncer done: ${data?.pass_count ?? 0} pass, ${data?.reject_count ?? 0} reject (${data?.duration_ms ?? 0}ms)`,
        "success",
      );
      onComplete?.(data);
    } catch (err) {
      console.error("[RunBouncerButton]", err);
      showToast(`Bouncer failed: ${err.message}`, "error");
    } finally {
      setRunning(false);
    }
  }

  const label = cityName || "selected city";

  return (
    <div className="flex flex-col gap-2">
      <Button onClick={trigger} disabled={running || !cityId} size="sm">
        {running ? <Spinner size="sm" /> : <Play className="w-3 h-3" />}
        {running ? `Bouncing ${label}…` : `Run Bouncer for ${label}`}
      </Button>
      {lastResult && (
        <div className="text-xs text-[--color-text-tertiary] font-mono space-y-0.5">
          <div>pass={lastResult.pass_count} · reject={lastResult.reject_count} · written={lastResult.written}</div>
          <div className="opacity-70">
            A={lastResult.by_cluster?.A_COMMERCIAL?.pass}/{lastResult.by_cluster?.A_COMMERCIAL?.reject} ·
            B={lastResult.by_cluster?.B_CULTURAL?.pass}/{lastResult.by_cluster?.B_CULTURAL?.reject} ·
            C={lastResult.by_cluster?.C_NATURAL?.pass}/{lastResult.by_cluster?.C_NATURAL?.reject} ·
            X={lastResult.by_cluster?.EXCLUDED?.reject}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Run-scorer trigger ───────────────────────────────────────────────────────

function RunScorerButton({ cityId, cityName, signalId, onComplete }) {
  const { showToast } = useToast();
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  async function trigger() {
    if (!cityId) {
      showToast("Pick a city first", "error");
      return;
    }
    setRunning(true);
    setLastResult(null);
    try {
      const { data, error } = await invokeWithRefresh("run-signal-scorer", {
        body: { signal_id: signalId, city_id: cityId },
      });
      if (error) throw error;
      setLastResult(data);
      showToast(
        `Scorer done: ${data?.scored_count ?? 0} scored, ${data?.ineligible_count ?? 0} ineligible (${data?.duration_ms ?? 0}ms)`,
        "success",
      );
      onComplete?.(data);
    } catch (err) {
      console.error("[RunScorerButton]", err);
      showToast(`Scorer failed: ${err.message}`, "error");
    } finally {
      setRunning(false);
    }
  }

  const label = cityName || "selected city";

  return (
    <div className="flex flex-col gap-2">
      <Button onClick={trigger} disabled={running || !cityId} size="sm">
        {running ? <Spinner size="sm" /> : <Play className="w-3 h-3" />}
        {running ? `Scoring ${label}…` : `Run scorer for ${label}`}
      </Button>
      {lastResult && (
        <div className="text-xs text-[--color-text-tertiary] font-mono">
          Last: scored={lastResult.scored_count} · ineligible={lastResult.ineligible_count} ·
          dist={JSON.stringify(lastResult.score_distribution ?? {})}
        </div>
      )}
    </div>
  );
}

// ── Top-50 places preview ────────────────────────────────────────────────────

function TopPlacesPreview({ cityId, cityName, signalId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(new Set());

  const refresh = useCallback(async () => {
    if (!cityId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: queryError } = await supabase
        .from("place_scores")
        .select(`
          score,
          contributions,
          place_pool!inner (
            id, name, primary_type, rating, review_count, price_level,
            is_servable, city_id
          )
        `)
        .eq("signal_id", signalId)
        .eq("place_pool.city_id", cityId)
        .eq("place_pool.is_servable", true)
        .order("score", { ascending: false })
        .limit(50);
      if (queryError) throw queryError;
      setRows(data ?? []);
    } catch (err) {
      console.error("[TopPlacesPreview]", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [cityId, signalId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function toggle(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-[--color-text-secondary]">
        <Spinner /> Loading top 50…
      </div>
    );
  }

  if (error) {
    return (
      <AlertCard kind="error" icon={AlertTriangle} title="Couldn't load preview">
        {error}
      </AlertCard>
    );
  }

  if (rows.length === 0) {
    const cityLabel = cityName || "the selected city";
    return (
      <AlertCard kind="info" title="No scores yet">
        Run the Bouncer (above) for {cityLabel}, then click{" "}
        <strong>Run scorer for {cityLabel}</strong> to populate <code>place_scores</code>.
      </AlertCard>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm text-[--color-text-secondary]">
          Top {rows.length} {cityName || ""} places by <code>{signalId}</code> score
        </div>
        <Button size="sm" variant="ghost" onClick={refresh}>
          <RefreshCw className="w-3 h-3" />
        </Button>
      </div>
      <div className="space-y-1">
        {rows.map((row, idx) => {
          const place = row.place_pool;
          const isOpen = expanded.has(place.id);
          const contribs = row.contributions || {};
          return (
            <div
              key={place.id}
              className="rounded border border-[--color-border] bg-[--color-background-primary]"
            >
              <button
                type="button"
                onClick={() => toggle(place.id)}
                className="w-full flex items-center gap-3 p-3 text-left hover:bg-[--color-background-secondary]"
              >
                <span className="text-xs font-mono text-[--color-text-tertiary] w-6">
                  #{idx + 1}
                </span>
                <span className="font-mono text-sm font-bold w-12 text-right">
                  {formatScore(row.score)}
                </span>
                <span className="flex-1 text-sm font-medium">{place.name}</span>
                <Badge variant="default">{place.primary_type}</Badge>
                <span className="text-xs text-[--color-text-tertiary]">
                  {place.rating != null ? `★ ${place.rating}` : ""}
                  {place.review_count != null ? ` · ${place.review_count.toLocaleString()}` : ""}
                </span>
                {isOpen ? (
                  <ChevronDown className="w-4 h-4 text-[--color-text-tertiary]" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-[--color-text-tertiary]" />
                )}
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="overflow-hidden border-t border-[--color-border]"
                  >
                    <div className="p-3 grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-xs font-mono">
                      {Object.entries(contribs).map(([k, v]) => (
                        <div key={k} className="flex items-center justify-between gap-2">
                          <span className="text-[--color-text-tertiary] truncate">{k}</span>
                          <span
                            className={
                              typeof v === "number" && v < 0
                                ? "text-red-500 font-semibold"
                                : typeof v === "number" && v > 0
                                  ? "text-green-600 font-semibold"
                                  : ""
                            }
                          >
                            {formatContribution(v)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export function SignalLibraryPage() {
  const { showToast } = useToast();
  const [signals, setSignals] = useState([]);
  const [activeSignalId, setActiveSignalId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [previewKey, setPreviewKey] = useState(0); // bump to force preview refetch

  // ORCH-0598.11: per-city control. City list from admin_city_picker_data RPC.
  const [cities, setCities] = useState([]);
  const [citiesLoading, setCitiesLoading] = useState(true);
  const [citiesError, setCitiesError] = useState(null);
  const [selectedCityId, setSelectedCityId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error: queryError } = await supabase
          .from("signal_definitions")
          .select("id, label, kind, is_active, current_version_id, updated_at")
          .order("created_at", { ascending: true });
        if (queryError) throw queryError;
        if (cancelled) return;
        setSignals(data ?? []);
        if ((data ?? []).length > 0 && activeSignalId == null) {
          setActiveSignalId(data[0].id);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSignalId]);

  // ORCH-0598.11: load city list. Default to highest ai_approved_places city
  // (typically Raleigh today) so an admin opening the page sees something.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setCitiesLoading(true);
      setCitiesError(null);
      try {
        const { data, error: rpcError } = await supabase.rpc("admin_city_picker_data");
        if (rpcError) throw rpcError;
        if (cancelled) return;
        const sorted = (data ?? []).slice().sort(
          (a, b) => Number(b.ai_approved_places ?? 0) - Number(a.ai_approved_places ?? 0),
        );
        setCities(sorted);
        if (sorted.length > 0 && selectedCityId == null) {
          setSelectedCityId(sorted[0].city_id);
        }
      } catch (err) {
        console.error("[SignalLibraryPage] city list error:", err);
        if (!cancelled) {
          setCitiesError(err.message);
          showToast(`Couldn't load city list: ${err.message}`, "error");
        }
      } finally {
        if (!cancelled) setCitiesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCityId, showToast]);

  if (loading) {
    return (
      <div className="py-16 flex items-center justify-center">
        <Spinner /> <span className="ml-2 text-sm text-[--color-text-secondary]">Loading signals…</span>
      </div>
    );
  }

  if (error) {
    return (
      <AlertCard kind="error" icon={AlertTriangle} title="Couldn't load signal_definitions">
        {error}
      </AlertCard>
    );
  }

  if (signals.length === 0) {
    return (
      <div className="py-12">
        <AlertCard kind="info" icon={Sparkles} title="No signals defined yet">
          Add via the <code>signal_definitions</code> table. Slice 1 seeded only{" "}
          <code>fine_dining</code> — Slices 2-13 will add the rest.
        </AlertCard>
      </div>
    );
  }

  const active = signals.find((s) => s.id === activeSignalId) ?? signals[0];
  const selectedCity = cities.find((c) => c.city_id === selectedCityId) ?? null;
  const selectedCityName = selectedCity?.city_name ?? null;

  return (
    <div className="py-6 flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="w-6 h-6 text-[--color-accent]" />
          <div>
            <h1 className="text-2xl font-bold">Signal Library</h1>
            <p className="text-sm text-[--color-text-secondary]">
              Per-city Bouncer + signal scoring. Pick a city, run Bouncer, then run scorer for each signal.
            </p>
          </div>
        </div>
      </header>

      {/* ORCH-0598.11: city picker */}
      <SectionCard
        title="City"
        description="Select which city the Bouncer and Scorer will run against. Cities come from the seeding_cities table."
      >
        <div className="flex flex-col gap-2">
          {citiesLoading && (
            <div className="flex items-center gap-2 text-sm text-[--color-text-secondary]">
              <Spinner size="sm" /> Loading cities…
            </div>
          )}
          {citiesError && (
            <AlertCard kind="error" icon={AlertTriangle} title="Couldn't load cities">
              {citiesError}
            </AlertCard>
          )}
          {!citiesLoading && !citiesError && cities.length === 0 && (
            <AlertCard kind="info" title="No seeded cities yet">
              Seed a city via the Place Pool Management page first.
            </AlertCard>
          )}
          {!citiesLoading && !citiesError && cities.length > 0 && (
            <select
              className="w-full md:w-2/3 p-2 rounded border border-[--color-border] bg-[--color-background-primary] text-sm"
              value={selectedCityId ?? ""}
              onChange={(e) => setSelectedCityId(e.target.value || null)}
              aria-label="Select city for Bouncer and Scorer"
            >
              {cities.map((c) => (
                <option key={c.city_id} value={c.city_id}>
                  {c.city_name}, {c.country_name}
                  {" — "}
                  {Number(c.ai_approved_places ?? 0).toLocaleString()} approved /{" "}
                  {Number(c.total_active_places ?? 0).toLocaleString()} active
                  {c.city_status ? ` · ${c.city_status}` : ""}
                </option>
              ))}
            </select>
          )}
        </div>
      </SectionCard>

      {/* Global: Bouncer (city-scoped per ORCH-0598.11; required before signal scoring) */}
      <SectionCard
        title={`Bouncer v2 (${selectedCityName ?? "select a city"})`}
        description="Deterministic gate. Run this BEFORE scoring any signal — sets place_pool.is_servable for every active place in the selected city. Re-run after place_pool refreshes."
      >
        <div className="border border-[--color-border] rounded p-4">
          <div className="text-xs uppercase tracking-wide text-[--color-text-tertiary] mb-2">
            Bouncer pass for {selectedCityName ?? "selected city"}
          </div>
          <RunBouncerButton
            cityId={selectedCityId}
            cityName={selectedCityName}
            onComplete={() => setPreviewKey((k) => k + 1)}
          />
        </div>
      </SectionCard>

      {/* Signal selector */}
      <div className="flex flex-wrap gap-2">
        {signals.map((s) => (
          <Button
            key={s.id}
            size="sm"
            variant={s.id === active.id ? "primary" : "outline"}
            onClick={() => setActiveSignalId(s.id)}
          >
            {s.label}
            <Badge variant={s.is_active ? "success" : "default"}>{s.kind}</Badge>
          </Button>
        ))}
      </div>

      {/* Active signal panel */}
      <SectionCard
        title={active.label}
        description={`Signal ID: ${active.id} · Kind: ${active.kind}`}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div className="border border-[--color-border] rounded p-4">
            <div className="text-xs uppercase tracking-wide text-[--color-text-tertiary] mb-2">
              Cohort rollout
            </div>
            <CohortSlider signalId={active.id} />
          </div>
          <div className="border border-[--color-border] rounded p-4">
            <div className="text-xs uppercase tracking-wide text-[--color-text-tertiary] mb-2">
              Score {selectedCityName ?? "selected city"}
            </div>
            <RunScorerButton
              cityId={selectedCityId}
              cityName={selectedCityName}
              signalId={active.id}
              onComplete={() => setPreviewKey((k) => k + 1)}
            />
          </div>
        </div>

        <TopPlacesPreview
          key={`${active.id}-${selectedCityId}-${previewKey}`}
          cityId={selectedCityId}
          cityName={selectedCityName}
          signalId={active.id}
        />
      </SectionCard>
    </div>
  );
}

export default SignalLibraryPage;

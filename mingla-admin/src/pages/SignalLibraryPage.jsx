/**
 * SIGNAL LIBRARY PAGE — ORCH-0588 Slice 1
 *
 * Read-only v1: list active signals; click into a signal to see top-50 Raleigh
 * places with score + contributions breakdown; cohort serving slider 0-100%;
 * "Run scorer for Raleigh" trigger button.
 *
 * Weight editing is intentionally NOT in v1 — admin tunes by inserting a new
 * signal_definition_versions row directly via SQL until Slice 2+ adds an editor.
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

// Raleigh city_id — Slice 1 is Raleigh-only per ORCH-0550.1 readiness scope.
const RALEIGH_CITY_ID = "0ccfcf20-21a9-4d7b-805d-cbe629dcfd2b";

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

function RunBouncerButton({ onComplete }) {
  const { showToast } = useToast();
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  async function trigger() {
    setRunning(true);
    setLastResult(null);
    try {
      const { data, error } = await invokeWithRefresh("run-bouncer", {
        body: { city_id: RALEIGH_CITY_ID },
      });
      if (error) throw error;
      setLastResult(data);
      showToast(
        `Bouncer done: ${data?.pass_count ?? 0} pass, ${data?.reject_count ?? 0} reject (${data?.duration_ms ?? 0}ms)`,
        "success",
      );
      onComplete?.(data);
    } catch (err) {
      showToast(`Bouncer failed: ${err.message}`, "error");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button onClick={trigger} disabled={running} size="sm">
        {running ? <Spinner size="sm" /> : <Play className="w-3 h-3" />}
        {running ? "Bouncing Raleigh…" : "Run Bouncer for Raleigh"}
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

function RunScorerButton({ signalId, onComplete }) {
  const { showToast } = useToast();
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  async function trigger() {
    setRunning(true);
    setLastResult(null);
    try {
      const { data, error } = await invokeWithRefresh("run-signal-scorer", {
        body: { signal_id: signalId, city_id: RALEIGH_CITY_ID },
      });
      if (error) throw error;
      setLastResult(data);
      showToast(
        `Scorer done: ${data?.scored_count ?? 0} scored, ${data?.ineligible_count ?? 0} ineligible (${data?.duration_ms ?? 0}ms)`,
        "success",
      );
      onComplete?.(data);
    } catch (err) {
      showToast(`Scorer failed: ${err.message}`, "error");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button onClick={trigger} disabled={running} size="sm">
        {running ? <Spinner size="sm" /> : <Play className="w-3 h-3" />}
        {running ? "Scoring Raleigh…" : "Run scorer for Raleigh"}
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

function TopPlacesPreview({ signalId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(new Set());

  const refresh = useCallback(async () => {
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
        .eq("place_pool.city_id", RALEIGH_CITY_ID)
        .eq("place_pool.is_servable", true)
        .order("score", { ascending: false })
        .limit(50);
      if (queryError) throw queryError;
      setRows(data ?? []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [signalId]);

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
    return (
      <AlertCard kind="info" title="No scores yet">
        Click <strong>Run scorer for Raleigh</strong> above to populate <code>place_scores</code>.
      </AlertCard>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm text-[--color-text-secondary]">
          Top {rows.length} Raleigh places by <code>{signalId}</code> score
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

  return (
    <div className="py-6 flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="w-6 h-6 text-[--color-accent]" />
          <div>
            <h1 className="text-2xl font-bold">Signal Library</h1>
            <p className="text-sm text-[--color-text-secondary]">
              ORCH-0588 Slice 1 — read-only v1. Weight editing arrives in Slice 2+.
            </p>
          </div>
        </div>
      </header>

      {/* Global: Bouncer (city-wide; required before signal scoring) */}
      <SectionCard
        title="Bouncer v2 (Raleigh)"
        description="Deterministic gate. Run this BEFORE scoring any signal — sets place_pool.is_servable for every active Raleigh place. Re-run after place_pool refreshes."
      >
        <div className="border border-[--color-border] rounded p-4">
          <div className="text-xs uppercase tracking-wide text-[--color-text-tertiary] mb-2">
            Bouncer pass for Raleigh
          </div>
          <RunBouncerButton onComplete={() => setPreviewKey((k) => k + 1)} />
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
              Score Raleigh
            </div>
            <RunScorerButton
              signalId={active.id}
              onComplete={() => setPreviewKey((k) => k + 1)}
            />
          </div>
        </div>

        <TopPlacesPreview key={`${active.id}-${previewKey}`} signalId={active.id} />
      </SectionCard>
    </div>
  );
}

export default SignalLibraryPage;

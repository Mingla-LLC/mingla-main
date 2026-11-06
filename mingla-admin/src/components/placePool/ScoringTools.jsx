// Issue #4276 U1: the scoring tools from the retired Signal Library page, one signal at
// a time: its share of Explorers and a look at the top places in a city.
//
// There is deliberately no "score this city" or "score all cities" button. A city-wide
// score would blend in Intelligence results held back from live decks (the rescore
// backlog stays held until Seth releases it). Scores come from pipeline runs, which
// score only the places they evaluated.

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion"; // eslint-disable-line no-unused-vars -- motion.div is used as JSX
import { ChevronRight, ChevronDown, RefreshCw } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useToast } from "../../context/ToastContext";
import { SectionCard, AlertCard } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";

function formatScore(s) {
  return s == null ? "—" : Number(s).toFixed(0);
}

function formatContribution(value) {
  if (typeof value === "number") {
    return value > 0 ? `+${value}` : String(value);
  }
  return String(value);
}

function CohortSlider({ signalId, onChange }) {
  const { addToast } = useToast();
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
      addToast({ variant: "error", title: `Couldn't load the share: ${err.message}` });
    } finally {
      setLoading(false);
    }
  }, [signalId, addToast]);

  useEffect(() => {
    // A server read; its state changes happen when it answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
      addToast({ variant: "success", title: `Share set to ${value}%` });
      onChange?.(value);
    } catch (err) {
      addToast({ variant: "error", title: `Couldn't save the share: ${err.message}` });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[--color-text-secondary]">
        <Spinner size="sm" /> Loading…
      </div>
    );
  }

  const presets = [0, 5, 25, 50, 100];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-[--color-text-secondary]">
          <span className="font-mono font-semibold text-[--color-text-primary]">{pct}%</span> of Explorers get this signal
        </div>
        {saving && <Spinner size="sm" />}
      </div>
      <div className="flex flex-wrap gap-2">
        {presets.map((p) => (
          <Button
            key={p}
            size="sm"
            variant={pct === p ? "primary" : "secondary"}
            disabled={saving}
            onClick={() => setQuick(p)}
          >
            {p}%
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={refresh} disabled={saving} aria-label="Reload the share">
          <RefreshCw className="w-3 h-3" />
        </Button>
      </div>
      <div className="text-xs text-[--color-text-tertiary]">
        A change reaches Explorers within a minute.
      </div>
    </div>
  );
}

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
    // A server read; its state changes happen when it answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
      <AlertCard variant="error" title="Couldn't load the top places">
        {error}
      </AlertCard>
    );
  }

  if (rows.length === 0) {
    const cityLabel = cityName || "the selected city";
    return (
      <AlertCard variant="info" title="No scores yet">
        No place in {cityLabel} has a final score for this signal yet. A pipeline run scores
        the places it evaluates.
      </AlertCard>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm text-[--color-text-secondary]">
          Top {rows.length} {cityName || ""} places by <code>{signalId}</code> score
        </div>
        <Button size="sm" variant="ghost" onClick={refresh} aria-label="Reload the top places">
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

export function ScoringTools({ cityId, cityName }) {
  const [signals, setSignals] = useState(null);
  const [error, setError] = useState(null);
  const [activeId, setActiveId] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: queryError } = await supabase
      .from("signal_definitions")
      .select("id, label, kind, is_active")
      .order("created_at", { ascending: true });
    if (queryError) { setError(queryError.message); return; }
    setSignals(data ?? []);
    setActiveId((prev) => prev ?? data?.[0]?.id ?? null);
  }, []);

  // A server read; its state changes happen when it answers.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const active = signals?.find((s) => s.id === activeId) ?? null;

  return (
    <SectionCard
      title="Scoring tools"
      subtitle="One signal at a time: its share of Explorers and the top places in the city you picked above."
    >
      {error ? (
        <AlertCard variant="error" title="Couldn't load the signals" action={<Button size="sm" variant="secondary" onClick={load}>Try again</Button>}>{error}</AlertCard>
      ) : signals === null ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : signals.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)]">No signals are defined yet.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Signal">
            {signals.map((s) => (
              <Button key={s.id} size="sm" variant={s.id === activeId ? "primary" : "secondary"} onClick={() => setActiveId(s.id)} aria-pressed={s.id === activeId}>
                {s.label}
                <Badge variant={s.is_active ? "success" : "default"}>{s.kind}</Badge>
              </Button>
            ))}
          </div>
          {active && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <div className="rounded border border-[var(--color-border)] p-4">
                <div className="mb-2 text-xs font-medium text-[var(--color-text-tertiary)]">Share of Explorers</div>
                <CohortSlider key={active.id} signalId={active.id} />
              </div>
              <div className="min-w-0">
                {cityId ? (
                  <TopPlacesPreview key={`${active.id}-${cityId}`} cityId={cityId} cityName={cityName} signalId={active.id} />
                ) : (
                  <p className="text-sm text-[var(--color-text-secondary)]">Pick a city in the table above to see its top places.</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}

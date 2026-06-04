/**
 * DECK SCORE TUNER PAGE — ORCH-1066 [admin deck score tuner + card preview]
 *
 * Search any LIVE (is_servable=true) venue → tune its 16 category scores
 * (set / pin to top) → preview its deck card → read its LIVE (non-projected)
 * rank. Pending non-servable venues are tuned in the Venue Claims modal (where
 * the rank is projected). Both surfaces mount the SAME <ScoreTunerPanel>.
 *
 * Spec:   Mingla_Artifacts/specs/SPEC_ORCH-1066_DECK_SCORE_TUNER.md §3.9
 * Design: Mingla_Artifacts/reports/DESIGN_ORCH-1066_DECK_CARD_PREVIEW.md §B
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { SlidersHorizontal, Search } from "lucide-react";
import { SectionCard } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Spinner } from "../components/ui/Spinner";
import { useToast } from "../context/ToastContext";
import { ScoreTunerPanel } from "../components/ScoreTunerPanel";
import {
  searchServableVenues,
  getPlacePreviewCard,
  getActiveSignals,
  getPlaceScores,
} from "../services/deckTunerService";

export function DeckScoreTunerPage() {
  const { addToast } = useToast();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const [selectedId, setSelectedId] = useState(null);
  const [placeData, setPlaceData] = useState(null);
  const [scores, setScores] = useState([]);
  const [signals, setSignals] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Active-signal catalog once.
  useEffect(() => {
    (async () => {
      try {
        const sigs = await getActiveSignals();
        if (mounted.current) setSignals(sigs);
      } catch {
        if (mounted.current) setSignals([]);
      }
    })();
  }, []);

  // Debounced venue search.
  useEffect(() => {
    const q = query.trim();
    if (q.length === 0) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const rows = await searchServableVenues(q, 20);
        if (!cancelled && mounted.current) setResults(rows);
      } catch (e) {
        if (!cancelled && mounted.current) {
          setResults([]);
          addToast({ variant: "error", title: "Search failed", description: e?.message ?? String(e) });
        }
      } finally {
        if (!cancelled && mounted.current) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, addToast]);

  const loadDetail = useCallback(async (placePoolId) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const [card, sc] = await Promise.all([
        getPlacePreviewCard(placePoolId),
        getPlaceScores(placePoolId),
      ]);
      if (!mounted.current) return;
      setPlaceData(card);
      setScores(sc);
    } catch (e) {
      if (mounted.current) {
        setPlaceData(null);
        setScores([]);
        setDetailError(e?.message ?? String(e));
      }
    } finally {
      if (mounted.current) setDetailLoading(false);
    }
  }, []);

  const onPick = (row) => {
    setSelectedId(row.id);
    void loadDetail(row.id);
  };

  const refetchScores = useCallback(async () => {
    if (!selectedId) return;
    try {
      const sc = await getPlaceScores(selectedId);
      if (mounted.current) setScores(sc);
    } catch {
      /* tuner shows its own error toast on writes; rank degrades gracefully */
    }
  }, [selectedId]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <SlidersHorizontal className="text-[var(--color-brand-500)]" style={{ width: 22, height: 22 }} aria-hidden="true" />
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Deck tuner</h1>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Tune any live venue's category scores, preview its deck card, and see where it ranks.
          </p>
        </div>
      </div>

      <SectionCard>
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none"
            style={{ width: 16, height: 16 }}
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a live venue by name or address…"
            aria-label="Search live venues"
            className="!pl-9"
          />
        </div>

        {searching ? (
          <div className="flex items-center gap-2 py-3 text-sm text-[var(--color-text-secondary)]">
            <Spinner size="sm" /> Searching…
          </div>
        ) : results.length > 0 ? (
          <ul className="mt-3 divide-y divide-[var(--table-border)] max-h-[280px] overflow-auto">
            {results.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onPick(r)}
                  className={[
                    "w-full text-left px-3 py-2 min-h-[44px] rounded-lg transition-colors",
                    selectedId === r.id
                      ? "bg-[var(--color-brand-50)]"
                      : "hover:bg-[var(--gray-50)]",
                  ].join(" ")}
                >
                  <div className="text-sm font-medium text-[var(--color-text-primary)]">{r.name}</div>
                  <div className="text-xs text-[var(--color-text-tertiary)]">
                    {[r.address, r.city].filter(Boolean).join(" · ") || "No address"}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : query.trim().length > 0 ? (
          <p className="mt-3 text-sm text-[var(--color-text-tertiary)]">No live venues match "{query}".</p>
        ) : null}
      </SectionCard>

      {selectedId ? (
        <SectionCard>
          <ScoreTunerPanel
            placePoolId={selectedId}
            placeData={placeData}
            scores={scores}
            signals={signals}
            projected={false}
            density="page"
            loading={detailLoading}
            error={detailError}
            onAfterWrite={refetchScores}
            onRetry={() => loadDetail(selectedId)}
            addToast={addToast}
          />
        </SectionCard>
      ) : (
        <SectionCard>
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <Search style={{ width: 28, height: 28 }} className="text-[var(--color-text-muted)]" aria-hidden="true" />
            <p className="text-sm text-[var(--color-text-secondary)]">
              Search a live venue to tune its category scores.
            </p>
          </div>
        </SectionCard>
      )}
    </div>
  );
}

export default DeckScoreTunerPage;

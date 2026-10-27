// Issue #4130 (Wave 4b) — the score override (the retired Deck tuner page) on
// a place's own detail in Place pool › Browse and map.
//
// Only places Explorers can see are tuned here, as before (the Deck tuner
// searched visible venues only; pending ones are tuned in Venue claims). The
// tuner itself is the shared <ScoreTunerPanel>, unchanged. It loads only when
// asked, so opening a place stays fast.
import { useCallback, useEffect, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "../ui/Button";
import { ScoreTunerPanel } from "../ScoreTunerPanel";
import { useToast } from "../../context/ToastContext";
import { getActiveSignals, getPlacePreviewCard, getPlaceScores } from "../../services/deckTunerService";

export function PlaceScoreOverride({ place }) {
  const { addToast } = useToast();
  const [open, setOpen] = useState(false);
  const [placeData, setPlaceData] = useState(null);
  const [scores, setScores] = useState([]);
  const [signals, setSignals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const placeId = place?.id;
  const load = useCallback(async () => {
    if (!placeId) return;
    setLoading(true);
    setError(null);
    try {
      const [card, sc, sigs] = await Promise.all([getPlacePreviewCard(placeId), getPlaceScores(placeId), getActiveSignals()]);
      if (!mounted.current) return;
      setPlaceData(card);
      setScores(sc);
      setSignals(sigs);
    } catch (e) {
      if (mounted.current) setError(e?.message ?? String(e));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [placeId]);

  const refetchScores = useCallback(async () => {
    if (!placeId) return;
    try {
      const sc = await getPlaceScores(placeId);
      if (mounted.current) setScores(sc);
    } catch (e) {
      addToast({ variant: "error", title: "Couldn't reload the scores", description: e?.message ?? String(e) });
    }
  }, [placeId, addToast]);

  if (!place?.is_servable) {
    return (
      <section aria-label="Score override" className="mt-6 border-t border-[var(--gray-200)] pt-4">
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">Score override</h4>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Only places Explorers can see have scores to change. Places waiting on a claim are tuned in Venue claims.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Score override" className="mt-6 border-t border-[var(--gray-200)] pt-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">Score override</h4>
        {!open && (
          <Button
            size="sm"
            variant="secondary"
            icon={SlidersHorizontal}
            onClick={() => {
              setOpen(true);
              void load();
            }}
          >
            Change scores and preview the card
          </Button>
        )}
      </div>
      {open && (
        <ScoreTunerPanel
          placePoolId={place.id}
          placeData={placeData}
          scores={scores}
          signals={signals}
          projected={false}
          density="modal"
          loading={loading}
          error={error}
          onAfterWrite={refetchScores}
          onRetry={load}
          addToast={addToast}
        />
      )}
    </section>
  );
}

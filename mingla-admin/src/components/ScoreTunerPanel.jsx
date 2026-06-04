/**
 * ORCH-1066 — <ScoreTunerPanel>: the reusable per-category signal tuner. Mounts
 * BOTH inside the Venue Claims modal (ClaimsPage.jsx) AND on the standalone tuner
 * page (DeckScoreTunerPage.jsx). One component, two contexts; differences are
 * props (DESIGN §B.0), never forks.
 *
 * DESIGN: Mingla_Artifacts/reports/DESIGN_ORCH-1066_DECK_CARD_PREVIEW.md §B.
 * Honest data (Constitution #9): rank is never fabricated — "Rank unavailable" on
 * error, "Not ranked" when unscored. Explicit Set/Pin commit (no live-write to a
 * ranking-critical control). Every interactive control ≥44px.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { Sparkles, Check, ArrowUpToLine, AlertTriangle, RotateCw, Search } from "lucide-react";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { DeckCardPreview } from "./DeckCardPreview";
import {
  scorePlacePreview,
  setPlaceSignalScore,
  pinPlaceToTop,
  getPlaceDeckRank,
} from "../services/adminClaimsService";

const RADII = [
  { km: 8, m: 8000 },
  { km: 16, m: 16000 },
  { km: 40, m: 40000 },
];

function clampScore(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(200, n));
}

/** A single signal row: label + rank micro-line + dial + Set + Pin. */
function SignalRow({
  signal,
  committed,
  focused,
  onFocus,
  rank,
  projected,
  radiusKm,
  acting,
  onSet,
  onPin,
}) {
  const label = signal.label ?? signal.id;
  const [pending, setPending] = useState(
    committed != null ? String(Math.round(committed)) : "",
  );
  const [clampFlash, setClampFlash] = useState(false);

  // Keep the dial in sync when the committed score changes (after a write/refetch).
  // Render-phase "adjust state on prop change" (React-recommended; no effect).
  // Because the row is keyed by signal_id, only THIS row's committed changes here,
  // so an in-progress edit on another row is never clobbered (DESIGN §F.5).
  const [lastCommitted, setLastCommitted] = useState(committed);
  if (lastCommitted !== committed) {
    setLastCommitted(committed);
    setPending(committed != null ? String(Math.round(committed)) : "");
  }

  const pendingNum = pending === "" ? null : clampScore(pending);
  const edited = pendingNum != null && pendingNum !== (committed != null ? Math.round(committed) : null);

  const commitClamp = () => {
    if (pending === "") return;
    const c = clampScore(pending);
    if (c == null) return;
    if (String(c) !== pending) {
      setClampFlash(true);
      setTimeout(() => setClampFlash(false), 600);
    }
    setPending(String(c));
  };

  const rankLine = (() => {
    if (rank === "error") return <span className="text-[var(--color-text-muted)]">Rank unavailable</span>;
    if (rank == null) return <span className="text-[var(--color-text-tertiary)]">tap to check rank</span>;
    if (rank.rank == null) return <span className="text-[var(--color-text-tertiary)]">Not ranked for this category</span>;
    const core = `#${rank.rank} · ${rank.total} live`;
    if (projected) {
      return (
        <span className="inline-flex items-center gap-1 text-[var(--color-text-tertiary)]">
          <Badge variant="info" className="!text-[10px] !py-0">Projected</Badge>
          {`#${rank.rank} of ${rank.total}`}
        </span>
      );
    }
    return <span className="text-[var(--color-text-tertiary)]">{core}</span>;
  })();

  return (
    <div
      className={[
        "flex items-center gap-[var(--space-md)] py-[var(--space-sm)] px-[var(--space-sm)] rounded-[12px] hover:bg-[var(--gray-50)]",
        focused ? "border-l-2 border-l-[var(--color-brand-500)]" : "",
        edited && !focused ? "border-l-2 border-l-[var(--color-brand-500)]" : "",
      ].join(" ")}
      onFocus={() => onFocus(signal.id)}
    >
      {/* label + rank micro-line */}
      <div className="min-w-[96px] flex-1">
        <div className={`text-[14px] font-medium ${focused ? "text-[var(--color-brand-700)]" : "text-[var(--color-text-primary)]"}`}>
          {label}
        </div>
        <div className="text-[12px]">{rankLine}</div>
      </div>

      {/* committed score (mono); struck when edited */}
      <div className="w-[56px] text-right font-[var(--font-mono)] text-[15px] tabular-nums">
        {edited ? (
          <span>
            <span className="text-[var(--color-text-tertiary)] line-through">
              {committed != null ? Math.round(committed) : "—"}
            </span>{" "}
            <span className="text-[var(--color-brand-600)]">{pendingNum}</span>
          </span>
        ) : (
          <span className="text-[var(--color-text-primary)]">
            {committed != null ? Math.round(committed) : "—"}
          </span>
        )}
      </div>

      {/* dial: number + slider */}
      <div className="flex items-center gap-[var(--space-sm)] min-w-[180px]">
        <input
          type="number"
          min={0}
          max={200}
          step={1}
          inputMode="numeric"
          aria-label={`${label} score, 0 to 200`}
          value={pending}
          disabled={acting}
          onFocus={() => onFocus(signal.id)}
          onChange={(e) => setPending(e.target.value)}
          onBlur={commitClamp}
          className={[
            "w-[64px] h-11 text-center font-[var(--font-mono)] tabular-nums text-sm rounded-lg outline-none",
            "bg-[var(--color-background-primary)] text-[var(--color-text-primary)] border",
            clampFlash
              ? "border-[var(--color-warning-600)] ring-2 ring-[var(--color-warning-100)]"
              : "border-[var(--gray-300)] focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]",
          ].join(" ")}
        />
        <div className="h-11 flex items-center flex-1">
          <input
            type="range"
            min={0}
            max={200}
            step={1}
            aria-label={`${label} score slider, 0 to 200`}
            value={pendingNum ?? 0}
            disabled={acting}
            onFocus={() => onFocus(signal.id)}
            onChange={(e) => setPending(e.target.value)}
            className="w-full accent-[var(--color-brand-500)] cursor-pointer"
          />
        </div>
      </div>

      {clampFlash ? (
        <span className="text-[12px] text-[var(--color-text-tertiary)]">Max is 200.</span>
      ) : null}

      {/* Set */}
      <Button
        variant={edited ? "primary" : "secondary"}
        size="sm"
        icon={Check}
        className="!h-11"
        disabled={acting || !edited}
        aria-label={`Save ${label} score`}
        onClick={() => onSet(signal.id, pendingNum)}
      >
        Set
      </Button>

      {/* Pin */}
      <Button
        variant="ghost"
        size="sm"
        icon={ArrowUpToLine}
        className="!h-11"
        disabled={acting}
        aria-label={`Pin ${label} to top of the deck within ${radiusKm} km`}
        onClick={() => onPin(signal.id)}
      >
        Pin
      </Button>
    </div>
  );
}

/**
 * @param {{
 *   placePoolId: string,
 *   placeData: object | null,
 *   scores: Array<{ signal_id: string, score: number, contributions?: unknown }>,
 *   signals: Array<{ id: string, label: string }>,
 *   projected: boolean,
 *   density?: 'modal' | 'page',
 *   loading?: boolean,
 *   error?: string | null,
 *   onAfterWrite: () => Promise<void> | void,
 *   onRetry?: () => void,
 *   addToast: (t: object) => void,
 * }} props
 */
export function ScoreTunerPanel({
  placePoolId,
  placeData,
  scores,
  signals,
  projected,
  density = "page",
  loading = false,
  error = null,
  onAfterWrite,
  onRetry,
  addToast,
}) {
  const [radiusM, setRadiusM] = useState(16000);
  const [seeding, setSeeding] = useState(false);
  const [acting, setActing] = useState(false);
  const [focusedSignal, setFocusedSignal] = useState(null);
  const [ranks, setRanks] = useState({}); // signal_id -> rank obj | 'error'

  const radiusKm = useMemo(() => Math.round(radiusM / 1000), [radiusM]);

  const committedBySignal = useMemo(() => {
    const m = {};
    for (const s of scores ?? []) m[s.signal_id] = s.score;
    return m;
  }, [scores]);

  const scoredCount = useMemo(
    () => (signals ?? []).filter((s) => committedBySignal[s.id] != null).length,
    [signals, committedBySignal],
  );

  const needsSeed = (scores ?? []).length === 0;

  // Default the focused signal to the highest-scored one (or first signal).
  useEffect(() => {
    if (focusedSignal || needsSeed) return;
    const sorted = [...(signals ?? [])].sort(
      (a, b) => (committedBySignal[b.id] ?? -1) - (committedBySignal[a.id] ?? -1),
    );
    if (sorted[0]) setFocusedSignal(sorted[0].id);
  }, [signals, committedBySignal, focusedSignal, needsSeed]);

  // Fetch rank for one signal (lazy / on demand).
  const fetchRank = useCallback(
    async (signalId) => {
      if (!placePoolId || !signalId) return;
      try {
        const r = await getPlaceDeckRank(placePoolId, signalId, radiusM);
        setRanks((prev) => ({ ...prev, [signalId]: r }));
      } catch {
        setRanks((prev) => ({ ...prev, [signalId]: "error" }));
      }
    },
    [placePoolId, radiusM],
  );

  // Fetch all ranks once per (place, radius) load — single batched effect.
  useEffect(() => {
    if (needsSeed || !placePoolId) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        (signals ?? []).map(async (s) => {
          if (committedBySignal[s.id] == null) return [s.id, { rank: null, total: 0 }];
          try {
            const r = await getPlaceDeckRank(placePoolId, s.id, radiusM);
            return [s.id, r];
          } catch {
            return [s.id, "error"];
          }
        }),
      );
      if (!cancelled) setRanks(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placePoolId, radiusM, needsSeed, scores, signals]);

  const handleSeed = async () => {
    setSeeding(true);
    try {
      const res = await scorePlacePreview(placePoolId);
      const seeded = res?.result?.seeded_count ?? 0;
      addToast({
        variant: "info",
        title: "Seeded 16 categories — tune them below.",
        description: seeded === 0 ? "Already had scores." : undefined,
      });
      await onAfterWrite();
    } catch (e) {
      addToast({ variant: "error", title: "Couldn't seed scores", description: e?.message ?? String(e) });
    } finally {
      setSeeding(false);
    }
  };

  const handleSet = async (signalId, value) => {
    if (value == null) return;
    setActing(true);
    try {
      const res = await setPlaceSignalScore(placePoolId, signalId, value, null);
      const dir = res?.result?.direction ?? "updated";
      addToast({ variant: "info", title: `Score ${dir}`, description: `${signalId} → ${value}` });
      await onAfterWrite();
      await fetchRank(signalId);
    } catch (e) {
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      addToast({
        variant: "warning",
        title: offline ? "You're offline — couldn't save. Try again when you're back." : "Couldn't set score",
        description: offline ? undefined : (e?.message ?? String(e)),
      });
    } finally {
      setActing(false);
    }
  };

  const handlePin = async (signalId) => {
    setActing(true);
    try {
      const res = await pinPlaceToTop(placePoolId, signalId, radiusM);
      const r = res?.result ?? {};
      if (r.tie_warning) {
        addToast({
          variant: "warning",
          title: "Tied at max",
          description: "Already at the 200 cap — tie broken by review count.",
        });
      } else {
        addToast({ variant: "info", title: "Pinned", description: `${signalId} → ${r.new_score ?? "?"}` });
      }
      await onAfterWrite();
      await fetchRank(signalId);
    } catch (e) {
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      addToast({
        variant: "warning",
        title: offline ? "You're offline — couldn't save. Try again when you're back." : "Couldn't pin",
        description: offline ? undefined : (e?.message ?? String(e)),
      });
    } finally {
      setActing(false);
    }
  };

  const onRadius = (m) => {
    setRadiusM(m);
    setRanks({}); // force refetch under the new radius
  };

  const focusedLabel =
    (signals ?? []).find((s) => s.id === focusedSignal)?.label ??
    focusedSignal ??
    "category";
  const focusedRank = focusedSignal ? ranks[focusedSignal] : null;

  // ── error ───────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
        <AlertTriangle style={{ width: 28, height: 28 }} className="text-[var(--color-text-tertiary)]" aria-hidden="true" />
        <p className="text-[14px] text-[var(--color-text-secondary)]">
          Couldn't load this venue's scores: {error}
        </p>
        {onRetry ? (
          <Button variant="secondary" size="md" icon={RotateCw} onClick={onRetry}>
            Try again
          </Button>
        ) : null}
      </div>
    );
  }

  // ── loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true">
        <div className="h-5 w-40 rounded skeleton-shimmer bg-[var(--gray-200)]" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-5 flex-1 rounded skeleton-shimmer bg-[var(--gray-200)]" />
            <div className="h-11 w-16 rounded skeleton-shimmer bg-[var(--gray-200)]" />
            <div className="h-11 w-[72px] rounded skeleton-shimmer bg-[var(--gray-200)]" />
          </div>
        ))}
      </div>
    );
  }

  const RadiusSelector = (
    <div
      role="radiogroup"
      aria-label="Ranking radius"
      className="inline-flex rounded-[8px] border border-[var(--gray-300)] p-[2px] bg-[var(--color-background-primary)]"
    >
      {RADII.map((r) => {
        const selected = r.m === radiusM;
        return (
          <span key={r.m} className="min-h-[44px] flex items-center">
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onRadius(r.m)}
              className={[
                "h-9 px-[var(--space-sm)] text-[13px] font-medium rounded-[6px] transition-colors",
                selected
                  ? "bg-[var(--color-brand-500)] text-white"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)]",
              ].join(" ")}
            >
              {r.km} km
            </button>
          </span>
        );
      })}
    </div>
  );

  const Card = (
    <DeckCardPreview
      placeData={placeData}
      categoryLabel={focusedLabel}
      submitting={acting || seeding}
    />
  );

  const RankStrip = (
    <div
      aria-live="polite"
      className="flex items-baseline gap-[var(--space-sm)] mt-[var(--space-md)] p-[var(--space-md)] rounded-[12px] bg-[var(--gray-50)] border border-[var(--table-border)]"
    >
      {focusedRank === "error" ? (
        <span className="text-[14px] text-[var(--color-text-muted)]">Rank unavailable right now.</span>
      ) : focusedRank == null || focusedRank.rank == null ? (
        <span className="text-[14px] text-[var(--color-text-secondary)]">
          Not ranked for {focusedLabel} yet — set a score to see where it lands.
        </span>
      ) : (
        <>
          <span className="font-[var(--font-mono)] text-[20px] font-bold text-[var(--color-text-primary)] tabular-nums">
            #{focusedRank.rank}
          </span>
          <span className="text-[14px] text-[var(--color-text-secondary)]">
            {projected ? (
              <>
                Projected of {focusedRank.total} for {focusedLabel} within {radiusKm} km —{" "}
                <span className="text-[var(--color-info-700)]">goes live when you approve.</span>
              </>
            ) : (
              <>of {focusedRank.total} for {focusedLabel} within {radiusKm} km.</>
            )}
          </span>
        </>
      )}
    </div>
  );

  // ── empty / unscored — seed block (§B.2) ────────────────────────────────────
  if (needsSeed) {
    return (
      <div className={density === "modal" ? "" : "p-[var(--space-lg)]"}>
        <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
          <Sparkles style={{ width: 28, height: 28 }} className="text-[var(--color-brand-500)]" aria-hidden="true" />
          <p className="text-[14px] font-medium text-[var(--color-text-primary)]">Not scored yet.</p>
          <p className="text-[13px] text-[var(--color-text-secondary)] max-w-[40ch]">
            Seed all 16 categories at a neutral starting score, then tune each one.
          </p>
          <Button variant="primary" size="lg" icon={Sparkles} loading={seeding} onClick={handleSeed}>
            Score this venue now
          </Button>
        </div>
      </div>
    );
  }

  const List = (
    <div className="divide-y divide-[var(--table-border)]">
      {[...(signals ?? [])]
        .sort((a, b) => (committedBySignal[b.id] ?? -1) - (committedBySignal[a.id] ?? -1))
        .map((signal) => (
          <SignalRow
            key={signal.id}
            signal={signal}
            committed={committedBySignal[signal.id] ?? null}
            focused={focusedSignal === signal.id}
            onFocus={setFocusedSignal}
            rank={ranks[signal.id]}
            projected={projected}
            radiusKm={radiusKm}
            acting={acting}
            onSet={handleSet}
            onPin={handlePin}
          />
        ))}
    </div>
  );

  const Header = (
    <div className="flex items-center justify-between mb-[var(--space-md)]">
      <div className="flex items-center gap-2 text-[15px] font-semibold text-[var(--color-text-primary)]">
        Category scores
        <Badge variant="default">{scoredCount}/16</Badge>
      </div>
      {RadiusSelector}
    </div>
  );

  // ── populated ──────────────────────────────────────────────────────────────
  if (density === "modal") {
    return (
      <div>
        {Header}
        <div className="flex flex-col items-center">
          {Card}
          {RankStrip}
        </div>
        <div className="mt-[var(--space-md)]">{List}</div>
      </div>
    );
  }

  // page density — two-column on ≥1024px
  return (
    <div className="p-[var(--space-lg)]">
      {Header}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_372px] gap-[var(--space-xl)]">
        <div className="order-2 lg:order-1">{List}</div>
        <div className="order-1 lg:order-2 lg:sticky lg:top-[var(--space-lg)] lg:self-start">
          {Card}
          {RankStrip}
        </div>
      </div>
    </div>
  );
}

export { Search };
export default ScoreTunerPanel;

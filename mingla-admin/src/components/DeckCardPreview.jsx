/**
 * ORCH-1066 — <DeckCardPreview>: a faithful React-web replica of the consumer
 * swipe-card FRONT FACE (app-mobile SwipeableCards.tsx), used in the admin deck
 * score tuner. Shows an admin how this venue's card WILL render in the deck for
 * the category being tuned — using ONLY real venue data, never fabricated.
 *
 * DESIGN: Mingla_Artifacts/reports/DESIGN_ORCH-1066_DECK_CARD_PREVIEW.md §A.
 * Honest data (Constitution #9): distance/travel-time OMITTED (admin has no buyer
 * geo); missing hero → labeled "No photo yet" placeholder (never stock/AI art);
 * missing rating → badge HIDDEN (exact native rule). No fabricated rank here.
 */

import { useState } from "react";
import { Star, Tag, Sparkles, ImageOff, AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "./ui/Button";
import { priceLabel, showRating as showRatingRule, hasRealHero } from "../lib/deckCardPreviewRules";

// Native-fidelity card constant (DESIGN §A.2). 340px within the 320–360 envelope.
const CARD_W = 340;

/** A frosted-glass chip (web replica of native GlassBadge). DESIGN §A.3. */
function CardChip({ icon: Icon, label, fillStar = false }) {
  return (
    <span className="inline-flex items-center gap-[6px] h-[26px] px-[8px] rounded-full bg-white/[0.18] backdrop-blur-md border border-white/25">
      {Icon ? (
        <Icon
          style={{ width: 14, height: 14 }}
          className={`text-white ${fillStar ? "fill-white" : ""}`}
          aria-hidden="true"
        />
      ) : null}
      <span className="text-[12px] font-semibold text-white whitespace-nowrap [text-shadow:0_1px_2px_rgba(0,0,0,0.5)]">
        {label}
      </span>
    </span>
  );
}

/**
 * @param {{
 *   placeData: import("../services/deckTunerService").TunerPlaceData | null,
 *   categoryLabel: string,
 *   loading?: boolean,
 *   error?: string | null,
 *   onRetry?: () => void,
 *   submitting?: boolean,
 * }} props
 */
export function DeckCardPreview({
  placeData,
  categoryLabel,
  loading = false,
  error = null,
  onRetry,
  submitting = false,
}) {
  const [heroFailed, setHeroFailed] = useState(false);
  // Reset the runtime onError fallback when the venue changes — render-phase
  // "adjust state on prop change" pattern (React-recommended; no effect needed).
  const [lastPlaceId, setLastPlaceId] = useState(placeData?.id ?? null);
  if ((placeData?.id ?? null) !== lastPlaceId) {
    setLastPlaceId(placeData?.id ?? null);
    setHeroFailed(false);
  }

  const cardShell =
    "rounded-[24px] overflow-hidden shadow-[var(--shadow-lg)] relative bg-[var(--gray-100)]";

  // ── loading skeleton (§A.5) ─────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ width: CARD_W }} aria-busy="true" aria-label="Loading card preview">
        <div className={`${cardShell} aspect-[3/4]`}>
          <div className="absolute inset-0 skeleton-shimmer bg-[var(--gray-200)]" />
          <div className="absolute inset-x-0 bottom-0 p-[var(--space-md)] pb-[var(--space-lg)] flex flex-col gap-[var(--space-sm)]">
            <div className="h-[18px] w-[70%] rounded-md skeleton-shimmer bg-[var(--gray-300)]" />
            <div className="h-[13px] w-[45%] rounded-md skeleton-shimmer bg-[var(--gray-300)]" />
            <div className="flex gap-[var(--space-sm)]">
              <div className="h-[26px] w-[54px] rounded-full skeleton-shimmer bg-[var(--gray-300)]" />
              <div className="h-[26px] w-[44px] rounded-full skeleton-shimmer bg-[var(--gray-300)]" />
              <div className="h-[26px] w-[72px] rounded-full skeleton-shimmer bg-[var(--gray-300)]" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── error (§A.5) ────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div style={{ width: CARD_W }}>
        <div className={`${cardShell} aspect-[3/4] flex flex-col items-center justify-center gap-2 text-center px-4`}>
          <AlertTriangle style={{ width: 28, height: 28 }} className="text-[var(--color-text-tertiary)]" aria-hidden="true" />
          <p className="text-[13px] text-[var(--color-text-secondary)]">Couldn't load this card.</p>
          {onRetry ? (
            <Button variant="ghost" size="sm" icon={RotateCw} onClick={onRetry}>
              Retry
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  // ── empty / no venue (§A.5) — host shows its own empty state ─────────────────
  if (!placeData) return null;

  const name = (typeof placeData.name === "string" && placeData.name.trim()) || "Experience";
  const oneLiner =
    typeof placeData.generative_summary === "string" && placeData.generative_summary.trim()
      ? placeData.generative_summary.trim()
      : null;
  const rating = typeof placeData.rating === "number" ? placeData.rating : null;
  const showRating = showRatingRule(rating);
  const price = priceLabel(placeData);

  const photos = Array.isArray(placeData.stored_photo_urls) ? placeData.stored_photo_urls : [];
  const heroUrl = photos[0];
  const heroValid = !heroFailed && hasRealHero(photos);

  const ariaLabel =
    `Deck card preview for ${name}` +
    (showRating ? `, rated ${rating.toFixed(1)}` : "") +
    `, category ${categoryLabel}`;

  return (
    <div style={{ width: CARD_W }}>
      <div className={`${cardShell} aspect-[3/4]`} role="img" aria-label={ariaLabel}>
        {/* hero */}
        {heroValid ? (
          <img
            src={heroUrl}
            alt=""
            loading="lazy"
            draggable={false}
            onError={() => setHeroFailed(true)}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          // honest no-photo placeholder (§A.5) — flat neutral, never stock/AI art.
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[var(--gray-800)]">
            <ImageOff style={{ width: 32, height: 32 }} className="text-white/40" aria-hidden="true" />
            <span className="text-[12px] font-medium text-white/55">No photo yet</span>
          </div>
        )}

        {/* legibility scrim */}
        <div className="absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-t from-black/60 via-black/25 to-transparent pointer-events-none" />

        {/* submitting top-edge hint (§A.5) — no skeleton flash */}
        {submitting ? (
          <div className="absolute inset-x-0 top-0 h-[3px] bg-[var(--color-brand-500)] animate-pulse" />
        ) : null}

        {/* title + meta overlay */}
        <div className="absolute inset-x-0 bottom-0 p-[var(--space-md)] pb-[var(--space-lg)]">
          <h3 className="text-[20px] leading-[1.15] font-bold text-white line-clamp-2 [text-shadow:0_1px_3px_rgba(0,0,0,0.6)]">
            {name}
          </h3>
          {oneLiner ? (
            <p className="text-[13px] font-semibold text-white/95 line-clamp-1 mt-[var(--space-xs)] [text-shadow:0_1px_3px_rgba(0,0,0,0.6)]">
              {oneLiner}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-[var(--space-sm)] mt-[var(--space-sm)]">
            {showRating ? <CardChip icon={Star} label={rating.toFixed(1)} fillStar /> : null}
            {price ? <CardChip icon={Tag} label={price} /> : null}
            <CardChip icon={Sparkles} label={categoryLabel} />
          </div>
        </div>
      </div>

      {/* caption (outside the card) — prevents a false "missing fields" report. */}
      <p className="text-[12px] text-[var(--color-text-tertiary)] mt-[var(--space-sm)] max-w-[340px]">
        Distance &amp; travel time appear on the buyer's device, based on where they are.
      </p>
    </div>
  );
}

export default DeckCardPreview;

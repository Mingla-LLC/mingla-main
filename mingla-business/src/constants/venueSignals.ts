/**
 * Venue "Best for" signals — the real Mingla signal ids + friendly labels.
 *
 * Single source of truth shared by the venue creator wizard (the selectable
 * "Best for" chips) and the listing management page (rendering the per-signal
 * AI scores). Keeping one list prevents the wizard and the results view from
 * drifting on ids/labels. The ids must match the signal_id keys the pipeline
 * writes into place_pool.ai_signal_scores.
 */
export interface VenueSignal {
  id: string;
  label: string;
}

export const VENUE_SIGNALS: ReadonlyArray<VenueSignal> = [
  { id: "romantic", label: "Romantic" },
  { id: "lively", label: "Lively" },
  { id: "drinks", label: "Drinks" },
  { id: "brunch", label: "Brunch" },
  { id: "casual_food", label: "Casual food" },
  { id: "fine_dining", label: "Fine dining" },
  { id: "scenic", label: "Scenic" },
  { id: "nature", label: "Nature & outdoors" },
  { id: "creative_arts", label: "Creative & arts" },
  { id: "play", label: "Play" },
  { id: "theatre", label: "Theatre" },
  { id: "movies", label: "Movies" },
];

const LABEL_BY_ID: Record<string, string> = VENUE_SIGNALS.reduce(
  (acc, s) => {
    acc[s.id] = s.label;
    return acc;
  },
  {} as Record<string, string>,
);

/** Friendly label for a signal id; falls back to a title-cased id if unknown. */
export function venueSignalLabel(id: string): string {
  return (
    LABEL_BY_ID[id] ??
    id
      .split("_")
      .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
      .join(" ")
  );
}

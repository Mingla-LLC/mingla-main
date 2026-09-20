import type { BrandPlacePipelineState } from "../services/businessPlaceAuthoringService";

export type DeckReadinessFix =
  | "edit_address"
  | "edit_website"
  | "edit_hours"
  | "edit_cover"
  | "confirm_ai_outputs"
  | "review_pipeline";

export type DeckReadinessFocus =
  | "basics"
  | "website"
  | "hours"
  | "cover"
  | "confirm"
  | "review";

export const DECK_READINESS_FIX_TO_FOCUS: Record<
  DeckReadinessFix,
  DeckReadinessFocus
> = {
  edit_address: "basics",
  edit_website: "website",
  edit_hours: "hours",
  edit_cover: "cover",
  confirm_ai_outputs: "confirm",
  review_pipeline: "review",
};

export function normalizeDeckReadinessFix(fix: string): DeckReadinessFix {
  return fix in DECK_READINESS_FIX_TO_FOCUS
    ? (fix as DeckReadinessFix)
    : "review_pipeline";
}

export function routeForDeckReadinessFix(input: {
  brandId: string;
  placePoolId: string | null;
  fix: string;
  /** META-ORCH-1255 — the pipeline is venue-keyed; carried into the route. */
  venueId?: string | null;
}): string {
  const normalizedFix = normalizeDeckReadinessFix(input.fix);
  const params = new URLSearchParams({
    brand_id: input.brandId,
    focus: DECK_READINESS_FIX_TO_FOCUS[normalizedFix],
    fix: normalizedFix,
  });
  if (input.placePoolId !== null && input.placePoolId.length > 0) {
    params.set("place_pool_id", input.placePoolId);
  }
  if (input.venueId != null && input.venueId.length > 0) {
    params.set("venue_id", input.venueId);
  }
  return `/venue/deck-readiness?${params.toString()}`;
}

export function routeForPipelineStateFix(input: {
  brandId: string;
  state: BrandPlacePipelineState | null | undefined;
  fix: string;
}): string {
  return routeForDeckReadinessFix({
    brandId: input.brandId,
    placePoolId: input.state?.place_pool_id ?? null,
    venueId: input.state?.venue_id ?? null,
    fix: input.fix,
  });
}

/**
 * #3385 — where "Save changes" on the deck-readiness screen sends the host.
 *
 * It used to `router.replace("/(tabs)/hub/events")`: the host left the venue
 * they were editing and saw no sign the save worked. Now:
 *   - opened from the venue page (`from=venue`) with history → go BACK to it,
 *     so the host lands exactly where they were (the venue's Settings);
 *   - anything else (Home to-do, a refreshed web tab, a shared link) → open
 *     the venue's own page on Settings, where "Edit photos & details" lives;
 *   - no venue id (a malformed link) → back if possible, else the venue list.
 * Never the Events tab.
 */
export type DeckReadinessSaveDestination =
  | { kind: "back" }
  | { kind: "replace"; href: string };

export function deckReadinessSaveDestination(input: {
  venueId: string | null;
  from: string | null;
  canGoBack: boolean;
}): DeckReadinessSaveDestination {
  if (input.from === "venue" && input.canGoBack) return { kind: "back" };
  if (input.venueId !== null && input.venueId.length > 0) {
    return {
      kind: "replace",
      href: `/venue/${encodeURIComponent(input.venueId)}?module=settings`,
    };
  }
  if (input.canGoBack) return { kind: "back" };
  return { kind: "replace", href: "/(tabs)/hub/listing" };
}

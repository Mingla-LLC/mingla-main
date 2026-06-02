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
    fix: input.fix,
  });
}

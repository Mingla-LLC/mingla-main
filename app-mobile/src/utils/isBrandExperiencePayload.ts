/**
 * #1672 / #3281 Round 1 PR 1d — brand-authored experience discriminator.
 *
 * Same rule as `deckService.isExperiencePayload` (ORCH-1065 / ORCH-1072): an
 * explicit `cardType: 'experience'`, or structural recovery via non-empty
 * `brandId` + `eventId` + `stops[]` when the tag was lost. AI curated plans
 * carry stops but never brand attribution, so they are not matched.
 */
export function isBrandExperiencePayload(card: unknown): boolean {
  if (!card || typeof card !== "object") return false;
  const c = card as Record<string, unknown>;
  if (c.cardType === "experience") return true;
  return (
    c.cardType !== "curated" &&
    typeof c.brandId === "string" &&
    c.brandId.length > 0 &&
    typeof c.eventId === "string" &&
    c.eventId.length > 0 &&
    Array.isArray(c.stops)
  );
}

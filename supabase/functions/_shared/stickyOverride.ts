// ORCH-1066 — STICKY-THROUGH-APPROVAL pure helpers.
//
// An admin can SET / PIN a place's signal score (deck-score-tuner RPCs
// admin_set_place_signal_score / admin_pin_place_to_top) or override it
// (META-ORCH-1062 admin_apply_score_override). Those writes stamp
// place_scores.contributions with an admin marker. The approval re-score loop
// (admin-review-venue-claim → run-signal-scorer) must NOT clobber or delete such
// a row. These pure predicates are the single source of truth for "is this row
// admin-protected" so run-signal-scorer and the regression test share EXACTLY one
// definition (a behavioral test that fails on revert).
//
// Authority: I-1066-ADMIN-OVERRIDE-STICKY-THROUGH-RESCORE (DRAFT→ACTIVE on close).
// Constitution #2 (place_scores single coordinated write shape) — these markers
// are the agreed provenance keys across every admin write path.

// The provenance keys an admin write stamps onto place_scores.contributions.
// _admin_set  — admin_set_place_signal_score (ORCH-1066)
// _admin_pin  — admin_pin_place_to_top       (ORCH-1066)
// _admin_override — admin_apply_score_override (META-ORCH-1062)
export const ADMIN_OVERRIDE_MARKERS = [
  "_admin_set",
  "_admin_pin",
  "_admin_override",
] as const;

export type ContributionBag = Record<string, unknown> | null | undefined;

/** True when this place_scores row carries an admin-override marker. */
export function isAdminOverridden(contributions: ContributionBag): boolean {
  if (!contributions || typeof contributions !== "object") return false;
  const bag = contributions as Record<string, unknown>;
  return ADMIN_OVERRIDE_MARKERS.some((m) => bag[m] !== undefined);
}

/**
 * Given the existing place_scores rows for a single signal, return the set of
 * place_ids whose committed score is admin-protected (must survive a re-score).
 */
export function protectedPlaceIds(
  existingRows: Array<{ place_id: string; contributions: ContributionBag }>,
): Set<string> {
  const out = new Set<string>();
  for (const row of existingRows) {
    if (isAdminOverridden(row.contributions)) out.add(row.place_id);
  }
  return out;
}

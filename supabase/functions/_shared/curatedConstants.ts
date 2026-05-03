// ORCH-0707 — Single source of truth for curated-pipeline duration lookups.
// Keyed by combo slug (the canonical authority post-ORCH-0707).
//
// Imported by generate-curated-experiences/index.ts AND _shared/stopAlternatives.ts.
// Replaces the two duplicated definitions previously inlined in each consumer.
//
// Includes BOTH modern split slugs AND legacy bundled slugs during the
// ORCH-0700 sunset window. After ORCH-0700 sunset (2026-05-12/13), the
// legacy keys (brunch_lunch_casual, movies_theatre) will be removed by
// that ORCH cleanup pass.
export const CATEGORY_DURATION_MINUTES: Record<string, number> = {
  // Modern split slugs (post-ORCH-0597/0598)
  brunch: 60,
  casual_food: 60,
  movies: 120,
  theatre: 120,
  // Modern chip slugs (unchanged)
  upscale_fine_dining: 90,
  drinks_and_music: 60,
  icebreakers: 45,
  nature: 60,
  creative_arts: 90,
  play: 90,
  flowers: 15,
  groceries: 20,
  // Signal slug aliases (defensive: in case a caller passes the underlying signal id)
  fine_dining: 90,
  drinks: 60,
  // ORCH-0601 sub-category slugs (reuse signal but distinct duration semantics)
  hiking: 60,
  museum: 90,
  // Legacy bundled slugs — REMOVED at ORCH-0700 sunset (2026-05-12/13)
  brunch_lunch_casual: 60,
  movies_theatre: 120,
};

export const CATEGORY_DEFAULT_DURATION = 60;

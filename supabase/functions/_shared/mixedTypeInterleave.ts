/**
 * ORCH-0906: single<->intent mixed-type interleave logic.
 *
 * Pure function: given the 1-based position and aggregated session prefs,
 * returns the deterministic type and pill for that position. The caller owns
 * candidate generation and D7 graceful degradation when one side exhausts.
 */

export interface MixedTypeDecision {
  type: 'single' | 'curated';
  pill: string;
  singleIndex?: number;
  intentIndex?: number;
}

export function decideTypeAndPill(args: {
  position: number;
  categories: string[];
  intents: string[];
}): MixedTypeDecision | null {
  const { position, categories, intents } = args;
  if (position < 1) return null;

  const isCurated = position % 2 === 0;

  if (isCurated) {
    if (intents.length === 0) return null;
    const intentIndex = position / 2 - 1;
    const pill = intents[intentIndex % intents.length];
    return { type: 'curated', pill, intentIndex };
  }

  if (categories.length === 0) return null;
  const singleIndex = (position - 1) / 2;
  const pill = categories[singleIndex % categories.length];
  return { type: 'single', pill, singleIndex };
}

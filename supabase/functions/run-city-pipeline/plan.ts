// Issue #4276: a run that does only what a person picked.
//
// The Place pool screen lets a person pick gaps for one city. Without a stage list a run
// does every stage, as it always has (cron and every existing caller rely on that). With
// one, it does exactly those stages plus what each needs first, then stops.
//
// What a stage needs first is about the data, not the order of stages. Photos are only
// downloaded for places that passed the pre-check; the final check needs photos;
// Intelligence only runs on places that passed the final check, and its places are then
// scored, released and given thumbnails. A search is never added for you: it finds
// places not found yet, which no later stage needs.
//
// redoIntelligence re-runs Intelligence, with fresh reviews, for places Explorers can
// see that have none on record. It changes live decks, so it needs confirmRedo.

export const PICKABLE_STAGES = Object.freeze([
  "box", "fill", "split", "completeness", "pre_check", "photos", "final_check", "intelligence",
] as const);

export type PickableStage = typeof PICKABLE_STAGES[number];

export const ALL_STAGES = Object.freeze([
  "box", "fill", "split", "completeness", "pre_check", "photos",
  "final_check", "intelligence", "score", "release", "thumbnails",
] as const);

const NEEDS: Record<string, readonly string[]> = {
  photos: ["pre_check"],
  final_check: ["photos", "pre_check"],
  intelligence: ["final_check", "photos", "pre_check"],
};

// Stages that follow Intelligence on their own: scoring what this run evaluated,
// releasing the places it finished, and their thumbnails.
const FOLLOWS: Record<string, readonly string[]> = {
  intelligence: ["score", "release", "thumbnails"],
};

export class PlanError extends Error {}

export interface Plan {
  /** Every stage the run will do, in run order. */
  stages: string[];
  /** Re-run Intelligence for servable places with no reviews. */
  redo: boolean;
}

/**
 * The run's stages from a person's picks, or null when no stage list was given (the
 * run then does every stage, exactly as before). Throws PlanError on a bad list.
 */
export function planFromBody(body: Record<string, unknown>): Plan | null {
  const raw = body.stages;
  const redo = body.redoIntelligence === true;
  if (raw === undefined || raw === null) {
    if (redo) throw new PlanError("redoIntelligence needs a stage list");
    return null;
  }
  if (!Array.isArray(raw) || raw.length === 0) throw new PlanError("stages must be a non-empty list");
  const picked = new Set<string>();
  for (const s of raw) {
    if (typeof s !== "string" || !(PICKABLE_STAGES as readonly string[]).includes(s)) {
      throw new PlanError(`unknown stage: ${String(s)}`);
    }
    picked.add(s);
  }
  if (redo) picked.add("intelligence");
  const all = new Set(picked);
  for (const s of picked) {
    for (const n of NEEDS[s] ?? []) all.add(n);
    for (const f of FOLLOWS[s] ?? []) all.add(f);
  }
  return { stages: ALL_STAGES.filter((s) => all.has(s)), redo };
}

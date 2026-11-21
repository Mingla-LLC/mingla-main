/**
 * #4490 P1-8 — pure rules for spaces (no React): validation that mirrors the
 * server CHECKs, "Used for" tags, combination checks and the site-plan grid.
 */
import type {
  SpaceDraft,
  SpacePlanShape,
  VenueSpace,
  VenueSpaceCombination,
} from "../../../services/venueFeaturesService";
import type { VenueFeatureSet } from "../../../types/venueFeatures";

export interface SpaceDraftIssues {
  name: string | null;
  capacity: string | null;
  layouts: string | null;
}

export function spaceDraftIssues(
  draft: SpaceDraft,
  takenNames: readonly string[] = [],
): SpaceDraftIssues {
  const name = draft.name.trim();
  let nameIssue: string | null = null;
  if (name.length === 0) nameIssue = "Give this space a name guests will recognise.";
  else if (name.length > 80) nameIssue = "Keep the name to 80 characters.";
  else if (takenNames.some((n) => n.trim().toLowerCase() === name.toLowerCase())) {
    nameIssue = "You already have a space with that name.";
  }
  const capacityIssue =
    draft.capacityStanding === null && draft.capacitySeated === null
      ? "Set how many it fits standing, seated, or both."
      : null;
  const layoutsIssue =
    draft.layouts.length > 5 || new Set(draft.layouts.map((row) => row.layout)).size !== draft.layouts.length
      ? "Use each other layout once, up to five."
      : draft.layouts.some((row) => !Number.isInteger(row.capacity) || row.capacity < 1 || row.capacity > 100_000)
        ? "Set each layout capacity from 1 to 100,000."
        : null;
  return { name: nameIssue, capacity: capacityIssue, layouts: layoutsIssue };
}

/**
 * #4490 click-test D14 — a starter opens with the setting its name says:
 * "Outdoor area" and "Rooftop" are outdoor; everything else starts indoor.
 */
export function starterSetting(name: string): "indoor" | "covered" | "outdoor" {
  const n = name.trim().toLowerCase();
  if (/(outdoor|rooftop|garden|terrace|patio|courtyard|beach|lawn|deck)/.test(n)) return "outdoor";
  if (/(covered|veranda|verandah|canopy|gazebo|pavilion)/.test(n)) return "covered";
  return "indoor";
}

/** What a space is used for (P1: features scoped to it or to the whole venue). */
export function spaceUsedFor(
  spaceRow: Pick<VenueSpace, "id">,
  features: VenueFeatureSet | null,
): string[] {
  if (features === null) return [];
  const tags: string[] = [];
  const covers = (key: "table_reservations" | "events_here"): boolean =>
    features[key].enabled &&
    (features[key].spaceIds === null || features[key].spaceIds?.includes(spaceRow.id) === true);
  if (covers("events_here")) tags.push("Events");
  if (covers("table_reservations")) tags.push("Tables");
  return tags;
}

export interface CombinationIssues {
  name: string | null;
  parts: string | null;
}

export function combinationIssues(
  input: { name: string; spaceIds: readonly string[]; id?: string },
  existing: readonly VenueSpaceCombination[],
): CombinationIssues {
  const name = input.name.trim();
  const sameParts = (a: readonly string[], b: readonly string[]): boolean =>
    a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");
  return {
    name: name.length === 0 ? "Name the combination, like Whole Green Area." : name.length > 80 ? "Keep the name to 80 characters." : null,
    parts:
      input.spaceIds.length < 2
        ? "Pick at least two spaces."
        : input.spaceIds.length > 20
          ? "Pick at most 20 spaces."
          : existing.some((c) => c.id !== input.id && sameParts(c.spaceIds, input.spaceIds))
            ? "Those spaces are already combined."
            : null,
  };
}

/** Clamp a rectangle to the plan (percent units, at least 8% each way). */
export function clampShape(shape: SpacePlanShape): SpacePlanShape {
  const w = Math.min(100, Math.max(8, shape.w));
  const h = Math.min(100, Math.max(8, shape.h));
  return {
    x: Math.min(100 - w, Math.max(0, shape.x)),
    y: Math.min(100 - h, Math.max(0, shape.y)),
    w,
    h,
  };
}

/** Give every space without a shape a place on a tidy grid (arrange mode start). */
export function autoPlanShapes(spaces: readonly VenueSpace[]): Record<string, SpacePlanShape> {
  const out: Record<string, SpacePlanShape> = {};
  const unplaced = spaces.filter((s) => s.planShape === null);
  const cols = Math.max(1, Math.ceil(Math.sqrt(unplaced.length)));
  const rows = Math.max(1, Math.ceil(unplaced.length / cols));
  const cellW = 100 / cols;
  const cellH = 100 / rows;
  for (const s of spaces) if (s.planShape !== null) out[s.id] = clampShape(s.planShape);
  unplaced.forEach((s, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    out[s.id] = clampShape({
      x: col * cellW + 2,
      y: row * cellH + 2,
      w: cellW - 4,
      h: cellH - 4,
    });
  });
  return out;
}

/** Shapes that differ from what is stored (only these are written). */
export function changedShapes(
  spaces: readonly VenueSpace[],
  shapes: Record<string, SpacePlanShape>,
): Array<{ space: VenueSpace; shape: SpacePlanShape }> {
  const out: Array<{ space: VenueSpace; shape: SpacePlanShape }> = [];
  for (const s of spaces) {
    const next = shapes[s.id];
    if (next === undefined) continue;
    const rounded = {
      x: Math.round(next.x * 10) / 10,
      y: Math.round(next.y * 10) / 10,
      w: Math.round(next.w * 10) / 10,
      h: Math.round(next.h * 10) / 10,
    };
    const cur = s.planShape;
    if (
      cur === null ||
      cur.x !== rounded.x ||
      cur.y !== rounded.y ||
      cur.w !== rounded.w ||
      cur.h !== rounded.h
    ) {
      out.push({ space: s, shape: rounded });
    }
  }
  return out;
}

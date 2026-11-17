/**
 * #4453 milestone 10 (spec v2.1 §2.5) — the sample packs by format. Read ONLY
 * by the plan preview (planPreview.ts). Composer v2's real Build never imports
 * this module (I-SITES-SAMPLE-NEVER-PUBLISHED; pinned by
 * planPreview.issue4453.test.ts).
 */
import type { FormatKey } from "../../contracts/generated/formats.ts";
import type { PlanSampleListing } from "../../contracts/generated/planPreview.ts";
import { artSamples } from "./art";
import { eventsSamples } from "./events";
import { experiencesSamples } from "./experiences";
import { hotelsSamples } from "./hotels";
import { playSamples } from "./play";
import { restaurantsSamples } from "./restaurants";
import { tripsSamples } from "./trips";

export const SAMPLE_PACKS: Readonly<Record<FormatKey, readonly PlanSampleListing[]>> = {
  trips: tripsSamples,
  events: eventsSamples,
  experiences: experiencesSamples,
  hotels: hotelsSamples,
  restaurants: restaurantsSamples,
  play: playSamples,
  art: artSamples,
};

/**
 * The sample listings for a preview: only for a kind the brand has ZERO live
 * rows of (real rows are never mixed with samples of the same kind).
 */
export function samplesFor(format: FormatKey, liveKinds: ReadonlySet<string>): PlanSampleListing[] {
  return SAMPLE_PACKS[format].filter((row) => !liveKinds.has(row.kind)).slice(0, 6).map((row) => ({ ...row }));
}

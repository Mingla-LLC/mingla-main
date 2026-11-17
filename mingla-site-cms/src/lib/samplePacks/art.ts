/**
 * #4453 milestone 10 (spec v2.1 §2.5) — art: no sample listings. The venue
 * sections (menu, table times, sessions) need a verified Mingla venue; with
 * none, the plan preview leaves those sections out rather than showing
 * sample menus or times. N3 approved the 12 listings for trips, events,
 * experiences and rooms only (#4453 comment 6938754298).
 */
import type { PlanSampleListing } from "../../contracts/generated/planPreview.ts";

export const artSamples: readonly PlanSampleListing[] = [];

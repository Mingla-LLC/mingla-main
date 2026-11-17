/**
 * #4453 milestone 10 (spec v2.1 §2.5) — restaurants: no sample listings. The venue
 * sections (menu, table times, sessions) need a verified Mingla venue; with
 * none, the plan preview leaves those sections out rather than showing
 * sample menus or times (the most conservative reading until Seth approves
 * venue sample copy, N3).
 */
import type { PlanSampleListing } from "../../contracts/generated/planPreview.ts";

export const restaurantsSamples: readonly PlanSampleListing[] = [];

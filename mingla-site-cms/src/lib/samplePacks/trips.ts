/**
 * #4453 milestone 10 (spec v2.1 §2.5, N3) — the trips sample pack, used ONLY in
 * a plan preview when the brand has no live trips yet. Mingla-written words,
 * text only: no price, count, date, rating, review, person or photo.
 * The words are approved by Seth (N3, #4453 comment 6938754298) and ship as
 * written, text only.
 * [TRANSITIONAL] The product-licensed photo set is still open, so samples carry
 * no photo — exit: Seth approves the photo set.
 */
import type { PlanSampleListing } from "../../contracts/generated/planPreview.ts";

export const tripsSamples: readonly PlanSampleListing[] = [
  { sample: true, kind: "trip", title: "A long weekend by the sea", summary: "A small-group trip with a guide, planned and booked through Mingla." },
  { sample: true, kind: "trip", title: "Mountains in the spring", summary: "Days on the trails and evenings together, with everything arranged." },
  { sample: true, kind: "trip", title: "A city you have never seen", summary: "Walks, food and the places locals love, with your group." },
];

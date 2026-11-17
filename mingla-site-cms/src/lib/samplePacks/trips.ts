/**
 * #4453 milestone 10 (spec v2.1 §2.5, N3) — the trips sample pack, used ONLY in
 * a plan preview when the brand has no live trips yet. Mingla-written words,
 * text only: no price, count, date, rating, review, person or photo.
 * [TRANSITIONAL] Copy awaits Seth's approval (N3) and the product-licensed
 * photo set is not chosen yet — exit: Seth approves the words and the photos.
 */
import type { PlanSampleListing } from "../../contracts/generated/planPreview.ts";

export const tripsSamples: readonly PlanSampleListing[] = [
  { sample: true, kind: "trip", title: "A long weekend by the sea", summary: "A small-group trip with a guide, planned and booked through Mingla." },
  { sample: true, kind: "trip", title: "Mountains in the spring", summary: "Days on the trails and evenings together, with everything arranged." },
  { sample: true, kind: "trip", title: "A city you have never seen", summary: "Walks, food and the places locals love, with your group." },
];

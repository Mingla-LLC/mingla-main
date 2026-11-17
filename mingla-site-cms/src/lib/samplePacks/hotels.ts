/**
 * #4453 milestone 10 (spec v2.1 §2.5, N3) — the hotels sample pack, used ONLY in
 * a plan preview when the brand has no live rooms yet. Mingla-written words,
 * text only: no price, count, date, rating, review, person or photo.
 * [TRANSITIONAL] Copy awaits Seth's approval (N3) and the product-licensed
 * photo set is not chosen yet — exit: Seth approves the words and the photos.
 */
import type { PlanSampleListing } from "../../contracts/generated/planPreview.ts";

export const hotelsSamples: readonly PlanSampleListing[] = [
  { sample: true, kind: "stay", title: "A quiet double room", summary: "A calm room with a comfortable bed and a place to work." },
  { sample: true, kind: "stay", title: "A room with a view", summary: "Wake up to the view, with breakfast nearby." },
  { sample: true, kind: "stay", title: "A family room", summary: "Space for everyone, with room to spread out." },
];

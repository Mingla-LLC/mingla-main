/**
 * #4453 milestone 10 (spec v2.1 §2.5, N3) — the experiences sample pack, used ONLY in
 * a plan preview when the brand has no live experiences yet. Mingla-written words,
 * text only: no price, count, date, rating, review, person or photo.
 * [TRANSITIONAL] Copy awaits Seth's approval (N3) and the product-licensed
 * photo set is not chosen yet — exit: Seth approves the words and the photos.
 */
import type { PlanSampleListing } from "../../contracts/generated/planPreview.ts";

export const experiencesSamples: readonly PlanSampleListing[] = [
  { sample: true, kind: "experience", title: "A hands-on workshop", summary: "Learn the craft in a small group and take your work home." },
  { sample: true, kind: "experience", title: "A guided tasting", summary: "A host walks you through each pour and what makes it different." },
  { sample: true, kind: "experience", title: "A morning class", summary: "An unhurried session for beginners and regulars alike." },
];

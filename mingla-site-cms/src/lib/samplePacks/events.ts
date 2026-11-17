/**
 * #4453 milestone 10 (spec v2.1 §2.5, N3) — the events sample pack, used ONLY in
 * a plan preview when the brand has no live events yet. Mingla-written words,
 * text only: no price, count, date, rating, review, person or photo.
 * [TRANSITIONAL] Copy awaits Seth's approval (N3) and the product-licensed
 * photo set is not chosen yet — exit: Seth approves the words and the photos.
 */
import type { PlanSampleListing } from "../../contracts/generated/planPreview.ts";

export const eventsSamples: readonly PlanSampleListing[] = [
  { sample: true, kind: "event", title: "An evening of live music", summary: "Doors, a set list and a room full of people who came for it." },
  { sample: true, kind: "event", title: "A night market", summary: "Stalls, food and music under one roof for one night." },
  { sample: true, kind: "event", title: "A talk and drinks", summary: "A short talk, then time to meet everyone in the room." },
];

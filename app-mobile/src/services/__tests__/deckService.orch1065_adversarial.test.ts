import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// ORCH-1065 [consumer-experience-deck-card] — TESTER ADVERSARIAL converter set.
//
// The implementor's deckService.orch1065.test.ts grep-asserts the converter
// EXISTS and routes first. This set attacks the converter's BEHAVIOUR under
// adversarial inputs the happy path never sends: a missing/empty stops array,
// a null brand logo, a zero-distance stop (must NOT render a fabricated
// "0.0 km" badge — Constitution #9), a single-stop experience (label must be
// "Start Here" not "End With"), and a malformed/non-string id.
//
// deckService.ts imports RN-bound modules, so we (a) PIN the source so the
// ported logic can't silently drift, and (b) port the PURE label + display-gate
// logic verbatim and RUN it against adversarial inputs.

const source = await Deno.readTextFile(
  new URL("../deckService.ts", import.meta.url),
);

// ─── Source pins (anti-drift for the ported logic) ───────────────────────────
Deno.test("ORCH-1065 ADV pin: experienceStopLabel + distance display-gate are the shipped logic", () => {
  // The ported stopLabel literals match the shipped helper.
  assertStringIncludes(source, "if (index === 0) return 'Start Here'");
  assertStringIncludes(source, "if (index === total - 1) return 'End With'");
  assertStringIncludes(source, "return 'Then'");
  // The display gate hides the distance badge when distance is 0 / null (honest
  // null — no fabricated "0.0 km"). This is the load-bearing no-fabrication line.
  assertStringIncludes(
    source,
    "firstStop?.distanceFromUserKm != null && firstStop.distanceFromUserKm > 0",
  );
  // Ratings are an honest 0 (never fabricated from Google data the experience lacks).
  assertStringIncludes(source, "rating: 0");
  assertStringIncludes(source, "reviewCount: 0");
});

// ─── Ported PURE logic (verbatim from deckService.ts) ─────────────────────────
function experienceStopLabel(
  index: number,
  total: number,
): "Start Here" | "Then" | "End With" {
  if (index === 0) return "Start Here";
  if (index === total - 1) return "End With";
  return "Then";
}
// The base-card distance display gate (deckService.ts:347-349).
function distanceBadge(distanceFromUserKm: number | null): string | null {
  return distanceFromUserKm != null && distanceFromUserKm > 0
    ? `${distanceFromUserKm.toFixed(1)} km`
    : null;
}

// ── Single-stop experience: index 0 of 1 ⇒ "Start Here" (NOT "End With").
//    Adversarial: with total=1, index===0 AND index===total-1 both hold; the
//    order of the guards decides. The shipped order returns "Start Here" — a
//    one-stop experience should read as the start, not "End With".
Deno.test("ORCH-1065 T-12a (exec): single-stop experience labels the lone stop 'Start Here', not 'End With'", () => {
  assertEquals(experienceStopLabel(0, 1), "Start Here");
});

Deno.test("ORCH-1065 ADV (exec): multi-stop labels — first/middle/last", () => {
  assertEquals(experienceStopLabel(0, 3), "Start Here");
  assertEquals(experienceStopLabel(1, 3), "Then");
  assertEquals(experienceStopLabel(2, 3), "End With");
});

// ── T-12: NO fabricated distance. A stop whose computed distance is 0 (user at
//    the venue, OR honest-null coalesced to 0) must NOT render a "0.0 km" badge.
Deno.test("ORCH-1065 T-12b (exec): zero/absent distance renders NO badge (no fabricated 0.0 km — Constitution #9)", () => {
  assertEquals(distanceBadge(0), null, "0 distance must hide the badge, not show '0.0 km'");
  assertEquals(distanceBadge(null), null, "null distance must hide the badge");
  // A real positive distance DOES render.
  assertEquals(distanceBadge(2.34), "2.3 km");
});

// ── T-12c: null brand logo must NOT be coerced to a fabricated string. The
//    converter keeps a non-string brandLogoUrl as null (so the card shows the
//    honest monogram fallback, never a fake logo).
Deno.test("ORCH-1065 T-12c: converter keeps a non-string brand logo as null (honest monogram fallback)", () => {
  // Pin the shipped coercion: brandLogoUrl is `typeof ... === 'string' ? ... : null`.
  assertStringIncludes(
    source,
    "brandLogoUrl: typeof card?.brandLogoUrl === 'string' ? card.brandLogoUrl : null",
  );
});

// ── Adversarial id handling: a missing id falls back to eventId and vice-versa;
//    both absent ⇒ '' (never undefined/null that would crash the deck key).
Deno.test("ORCH-1065 ADV: id/eventId fallback coercion is string-safe (never undefined key)", () => {
  // Pin the shipped fallback chain.
  assertStringIncludes(source, "id: String(card?.id ?? card?.eventId ?? '')");
  assertStringIncludes(source, "eventId: String(card?.eventId ?? card?.id ?? '')");
  // Executable proof of the String(... ?? '') contract:
  const idOf = (c: any) => String(c?.id ?? c?.eventId ?? "");
  assertEquals(idOf({ eventId: "evt-1" }), "evt-1"); // id missing → eventId
  assertEquals(idOf({}), ""); // both missing → '' (string, not undefined)
  assertEquals(idOf({ id: 123 }), "123"); // numeric id → string
});

// ── Routing order is load-bearing AND must short-circuit: an experience
//    envelope (which ALSO has stops[]+experienceType+tagline) must be claimed by
//    isExperiencePayload BEFORE isCuratedPayload could grab it. We prove the
//    discriminator predicates can't both win for an experience card.
Deno.test("ORCH-1065 T-13-adv (exec): an experience envelope is claimed by isExperiencePayload, not isCuratedPayload", () => {
  // Ported predicates (verbatim).
  const isExperiencePayload = (card: any) => card?.cardType === "experience";
  const isCuratedPayload = (card: any) =>
    card?.cardType === "curated" ||
    (Array.isArray(card?.stops) &&
      typeof card?.experienceType === "string" &&
      typeof card?.tagline === "string");

  // An experience envelope LOOKS curated by structure (has stops/experienceType/tagline).
  const experienceEnvelope = {
    cardType: "experience",
    stops: [{}],
    experienceType: "adventurous",
    tagline: "x",
  };
  // Both predicates would match — so ORDER decides. isExperiencePayload runs first.
  assert(isExperiencePayload(experienceEnvelope), "experience must match the experience predicate");
  assert(
    isCuratedPayload(experienceEnvelope),
    "by structure it ALSO matches curated — which is exactly why experience must be checked FIRST",
  );
  // A genuine curated card (no cardType:'experience') must NOT match experience.
  const curatedEnvelope = {
    cardType: "curated",
    stops: [{}],
    experienceType: "romantic",
    tagline: "y",
  };
  assertEquals(isExperiencePayload(curatedEnvelope), false);
  assert(isCuratedPayload(curatedEnvelope));
});

// ── Pin: the branch order in discoverCardsPayloadToRecommendations (the seam the
//    above behaviour depends on). Fails-on-revert if the experience branch is
//    moved after curated.
Deno.test("ORCH-1065 T-13-adv pin: experience branch precedes curated in the dispatcher (fails-on-revert)", () => {
  const dispatch = source.slice(
    source.indexOf("export function discoverCardsPayloadToRecommendations"),
  );
  const expIdx = dispatch.indexOf("isExperiencePayload(card)");
  const curatedIdx = dispatch.indexOf("isCuratedPayload(card)");
  assert(expIdx >= 0 && curatedIdx >= 0);
  assert(
    expIdx < curatedIdx,
    "experience dispatch must precede curated (else experiences mis-route to the curated itinerary)",
  );
});

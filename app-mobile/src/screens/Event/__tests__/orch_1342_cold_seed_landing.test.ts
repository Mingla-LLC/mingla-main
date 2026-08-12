// @ts-nocheck — Deno-runtime suite (Deno globals + deno.land import); the
// app-mobile tsc sweep has no Deno types (house convention — see
// orch_1341_guest_list_sheet.test.ts).
//
// ORCH-1342 [web-see-whos-going-funnel] — implementor-owned guard suite for
// the app-side funnel half (SPEC §7 T-2/T-3 + §4.7/§4.8 structural pins;
// META-ORCH-1337 Leg 5). Deno source-structure suite in the 1341 house style
// (read source → strip comments → assert). Enforces:
//   - T-2: dispatchOneLinkDestination appends ?landing=guest-list at the ONE
//     path-composition point; the deferral object literal keeps the exact
//     {url, ts, router:true} shape; the DO-NOT-TOUCH replay block still
//     router.push-es the persisted url VERBATIM under the 24h TTL.
//   - T-3: all three consumer routes read `landing` via useLocalSearchParams,
//     EXACT-match validate ('guest-list' only), and pass it to the screen.
//   - §4.7: the event screen resolves a cold seed by slug (deck seed first),
//     shows the EXISTING loading sheet while resolving, keeps the cap as the
//     terminal state.
//   - §4.8: all three screens run the ONE-SHOT landing effect through the SAME
//     handleSeeWhosGoing the card uses, gated on settled socialProof +
//     privateGuestList === false + goingCount > 0 (D9/D2; T-A4/T-A5).
//
// FAILS-ON-REVERT (proven by true line deletion in the implementation report):
//   - delete the dispatcher's landing append → T-02 FAILS.
//   - delete the resolver's parse (covered by oneLinkResolver.orch1342.test.ts).
//   - delete a route's exact-match validation → T-04..T-06 FAIL.
//   - delete the screen's cold-seed query / derived seed → T-07/T-08 FAIL.
//   - delete the privateGuestList condition from the auto-open effect →
//     T-10..T-12 FAIL (the condition tokens are pinned per screen).

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = async (rel: string): Promise<string> =>
  await Deno.readTextFile(new URL(rel, import.meta.url));

const strip = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const indexSrc = strip(await read("../../../../app/index.tsx"));
const eRoute = strip(await read("../../../../app/e/[brandSlug]/[eventSlug].tsx"));
const tRoute = strip(await read("../../../../app/t/[brandSlug]/[tripSlug].tsx"));
const expRoute = strip(
  await read("../../../../app/exp/[brandSlug]/[experienceSlug].tsx"),
);
const eventScreen = strip(await read("../ConsumerEventDetailScreen.tsx"));
const tripScreen = strip(
  await read("../../Trip/ConsumerTripDetailScreen.tsx"),
);
const expScreen = strip(
  await read("../../Experience/ConsumerExperienceDetailScreen.tsx"),
);

// ── T-2: dispatcher composition + deferral shape + untouched replay ──────────

Deno.test("ORCH-1342 T-02: dispatcher appends ?landing=guest-list at the ONE composition point", () => {
  assertStringIncludes(indexSrc, "if (dest.landing === 'guest-list')");
  assertStringIncludes(indexSrc, "path = `${path}?landing=guest-list`;");
  // exactly ONE composition point (never a second append elsewhere).
  const occurrences = indexSrc.split("?landing=guest-list").length - 1;
  assertEquals(occurrences, 1);
});

Deno.test("ORCH-1342 T-02: deferral object literal keeps the exact {url, ts, router:true} shape", () => {
  assertStringIncludes(
    indexSrc,
    "JSON.stringify({ url: path, ts: Date.now(), router: true })",
  );
});

Deno.test("ORCH-1342 T-02: the DO-NOT-TOUCH replay block still pushes the persisted url verbatim under the 24h TTL", () => {
  assertStringIncludes(indexSrc, "const MAX_AGE_MS = 24 * 60 * 60 * 1000;");
  assertStringIncludes(indexSrc, "router.push(url as never);");
  assertStringIncludes(indexSrc, "const isRouterTarget = parsed.router === true;");
});

// ── T-3: route param validation (normalize array→first + EXACT match) ────────

const routeCases: Array<[string, string]> = [
  ["e", eRoute],
  ["t", tRoute],
  ["exp", expRoute],
];
for (const [name, src] of routeCases) {
  Deno.test(`ORCH-1342 T-0${4 + routeCases.findIndex(([n]) => n === name)}: /${name}/ route validates landing by EXACT match and passes it to the screen`, () => {
    assertStringIncludes(src, "landing?: string | string[]");
    assertStringIncludes(src, "Array.isArray(params.landing)");
    assertStringIncludes(
      src,
      'landingRaw === "guest-list" ? ("guest-list" as const) : undefined',
    );
    assertStringIncludes(src, "landing={landing}");
  });
}

// ── §4.7: cold seed resolution on the event screen ────────────────────────────

Deno.test("ORCH-1342 T-07: deck-first canonical bundle owns cold standard events; legacy is RSVP-only after settled NULL", () => {
  const compact = eventScreen.replace(/\s+/g, " ");
  assertStringIncludes(
    compact,
    "const canonicalQuery = usePublicEventBySlug( seedProp == null ? (brandSlug ?? null) : null, seedProp == null ? (eventSlug ?? null) : null, );",
  );
  assertStringIncludes(
    compact,
    "const coldReadPlan = directEventColdReadPlan( seedProp !== null, canonicalQuery, !!brandSlug && !!eventSlug, );",
  );
  assertStringIncludes(
    compact,
    'queryKey: ["publicEventSeed", brandSlug, eventSlug], enabled: coldReadPlan.allowLegacySeedRead',
  );
  assertStringIncludes(
    compact,
    "const candidate = await fetchPublicEventSeedBySlug( brandSlug as string, eventSlug as string, ); return acceptRsvpLegacySeed(candidate);",
  );
  assertStringIncludes(eventScreen, "const canonical = coldReadPlan.canonical;");
  assertStringIncludes(
    eventScreen,
    "const seed = seedProp ?? canonicalSeed ?? coldSeedQuery.data ?? null;",
  );
  assertStringIncludes(
    eventScreen,
    "coldReadPlan.allowLegacyTicketRead ? eventId : null",
  );
  assertStringIncludes(
    eventScreen,
    "const tickets = canonical?.event.tickets ?? ticketsQuery.data ?? [];",
  );
});

Deno.test("ORCH-1342 T-08: cold-resolving shows the EXISTING loading sheet; the cap is the terminal state", () => {
  const compact = eventScreen.replace(/\s+/g, " ");
  assertStringIncludes(
    compact,
    "seedProp == null && (canonicalQuery.isLoading || (canonicalQuery.isSuccess && canonicalQuery.data === null && coldSeedQuery.isLoading))",
  );
  // the cap early-return survives as the settled-null terminal state.
  assertStringIncludes(eventScreen, "if (seed === null)");
  assertStringIncludes(eventScreen, "Open this event from the app");
});

// ── §4.8: the one-shot landing auto-open effect, per screen ───────────────────

const screens: Array<[string, string]> = [
  ["ConsumerEventDetailScreen", eventScreen],
  ["ConsumerTripDetailScreen", tripScreen],
  ["ConsumerExperienceDetailScreen", expScreen],
];
let t = 10;
for (const [name, src] of screens) {
  Deno.test(`ORCH-1342 T-${t}: ${name} one-shot landing effect (D9/D2 gates pinned)`, () => {
    // the prop + the one-shot ref.
    assertStringIncludes(src, 'landing?: "guest-list"');
    assertStringIncludes(src, "const landingHandledRef = useRef<boolean>(false);");
    assertStringIncludes(
      src,
      'if (landing !== "guest-list" || landingHandledRef.current) return;',
    );
    // waits reactively for a SETTLED socialProof query (no timers).
    assertStringIncludes(
      src,
      "const settled = socialProofQuery.isSuccess || socialProofQuery.isError;",
    );
    // ref flips BEFORE the open decision — terminal on ANY outcome.
    assertStringIncludes(src, "landingHandledRef.current = true;");
    // the exact affordance conditions (T-A4 privateGuestList / T-A5 zero-going).
    assertStringIncludes(src, "sp.privateGuestList === false");
    assertStringIncludes(src, "sp.goingCount > 0");
    // the SAME handler the card's onSeeWhosGoing invokes — never a parallel path.
    assertStringIncludes(src, "handleSeeWhosGoing();");
    assert(!/setGuestSheetVisible\(true\);\s*\}\s*,\s*\[\s*landing/.test(src));
    // no timers / nav retries in the landing mechanism.
    assert(!/setTimeout\([^)]*landing/i.test(src));
  });
  t += 1;
}

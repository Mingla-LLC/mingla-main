// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4261 amendment 1 (spec 9.3) — Hermes-safe plan times, the Matches
// counter, "Added by" / "You", the place vote, link covers and link targets.
//
// FAILS-ON-REVERT:
// - restore the formatToParts-based partsOf/clockOf → with the Hermes-shaped
//   parts stub every label reads "undefined:00"; the Hermes case fails.
// - drop matchIndexForOffset / the onScroll wiring in PlanMatchesSheet → the
//   counter case fails.
// - "Added by {name}" for the creator, or the viewer not first as "You" → the
//   voters-line case fails.
// - leadingPlace ignoring votes or the original tie-break → the leader case fails.
// MINGLA-INVARIANT: I-4261-PLAN-TIMES-HERMES-SAFE | issue #4261 | Plan time labels never read the Intl parts API; each field comes from format() with a manual clock fallback, so no label reads "undefined".

import {
  applyPlaceVotePatch,
  blankPlanForm,
  canPostPlan,
  clockLabel,
  formatPlanTime,
  leadingPlace,
  lockLabelParts,
  lockPlaceOptionId,
  matchIndexForOffset,
  needsLinkPreviewRetry,
  needsMyVote,
  normalizeChatPlansPayload,
  optionVotersLine,
  parsePlanQuote,
  placeLinkTarget,
  planAddPlaceInput,
  planCreateInput,
  planErrorKey,
  planPhoto,
  planQuoteFallbackKey,
  planQuoteNote,
  shortPlanTime,
  viewerQuoteSnapshot,
} from "../planModel.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  expected ${e}\n  actual   ${a}`);
}

const ME = "me";
const plan = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  source: "chat",
  sessionId: null,
  savedCardId: null,
  messageId: `m-${id}`,
  messageVisible: true,
  createdBy: "ada",
  createdByName: "Ada",
  title: id,
  whereKind: "none",
  place: null,
  link: null,
  whenMode: "poll",
  openTimes: true,
  status: "deciding",
  scheduledAt: null,
  durationMinutes: null,
  lockedAt: null,
  lockedBy: null,
  note: null,
  createdAt: "2026-11-01T10:00:00Z",
  updatedAt: "2026-11-01T10:00:00Z",
  options: [],
  rsvps: { going: [], maybe: [], cant: [] },
  reactions: { up: [], down: [] },
  commentCount: 0,
  canLock: false,
  canEdit: false,
  canCancel: false,
  canAddTime: true,
  places: [],
  canAddPlace: false,
  ...over,
});
const placeOption = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  kind: "place",
  poolId: null,
  mapboxId: null,
  name: id,
  address: null,
  lat: null,
  lng: null,
  photoUrl: null,
  link: null,
  addedBy: "ada",
  isOriginal: false,
  voterIds: [],
  ...over,
});

const EN: Record<string, string> = {
  plan_quote_you_voted: "You voted {{times}}",
  plan_quote_you_picked: "you picked {{places}}",
  plan_quote_and: "{{list}} and {{last}}",
  plan_quote_going: "you're going",
  plan_quote_voting: "Voting on a time",
  plan_quote_voting_place: "Voting on a place",
  plan_voter_you: "You",
  plan_option_added_by: "Added by {{name}}",
  plan_place_option_added_by: "Suggested by {{name}}",
  plan_option_no_votes: "No votes yet",
};
const t = (key: string, params: Record<string, unknown> = {}) =>
  (EN[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_m, name) => String(params[name] ?? ""));
const names: Record<string, string> = { ada: "Ada", tobi: "Tobi", kemi: "Kemi" };
const nameOf = (id: string | null) => (id ? names[id] ?? "?" : "?");

const CLOCK = /\d{1,2}[:.]\d{2}/;
const clean = (label: string) => !/undefined|NaN/.test(label);

// ---------------------------------------------------------------------------
// B-1: Hermes-safe time labels
// ---------------------------------------------------------------------------

Deno.test("B-1: with Hermes-shaped formatToParts (no hour / minute / dayPeriod) labels stay whole", () => {
  const iso = "2026-11-06T20:00:00Z";
  const local = new Date(2026, 10, 6, 20, 0).toISOString();
  const before = {
    long: formatPlanTime(iso, "en-US", "UTC"),
    short: shortPlanTime(iso, "en-US", "UTC"),
    localLong: formatPlanTime(local, "en-US"),
    quote: planQuoteNote({ votedStartsAt: [iso], rsvp: null }, "en-US", "UTC", t),
  };
  const proto = Intl.DateTimeFormat.prototype;
  const original = proto.formatToParts;
  proto.formatToParts = function hermesShape() {
    return [
      { type: "weekday", value: "Fri" },
      { type: "literal", value: " " },
      { type: "day", value: "6" },
      { type: "literal", value: " " },
      { type: "month", value: "Nov" },
      { type: "literal", value: ", 8:00 PM" },
    ];
  };
  try {
    const long = formatPlanTime(iso, "en-US", "UTC");
    const short = shortPlanTime(iso, "en-US", "UTC");
    const localLong = formatPlanTime(local, "en-US");
    const quote = planQuoteNote({ votedStartsAt: [iso], rsvp: null }, "en-US", "UTC", t);
    for (const [label, value] of [["long", long], ["short", short], ["localLong", localLong], ["quote", quote]]) {
      assert(clean(value), `${label} has no undefined/NaN: ${value}`);
      assert(CLOCK.test(value), `${label} carries a clock: ${value}`);
    }
    assertEquals(long, "Fri 6 Nov · 8:00 PM", "long label");
    assertEquals(short, "Fri 8:00 PM", "short label");
    assertEquals({ long, short, localLong, quote }, before, "same as the unstubbed output");
  } finally {
    proto.formatToParts = original;
  }
});

Deno.test("B-1: when format() returns nothing for an hour, the manual clock follows the 12/24-hour setting", () => {
  const Real = Intl.DateTimeFormat;
  const local = new Date(2026, 10, 6, 20, 0).toISOString();
  const install = (hour12: boolean) => {
    // deno-lint-ignore no-explicit-any
    (Intl as any).DateTimeFormat = function Fake(locale: string, opts: Intl.DateTimeFormatOptions = {}) {
      const real = new Real(locale, opts);
      return {
        format: (at: Date) => ("hour" in opts ? "" : real.format(at)),
        resolvedOptions: () => ({ ...real.resolvedOptions(), hour12 }),
        formatToParts: (at: Date) => real.formatToParts(at),
      };
    };
  };
  try {
    install(true);
    const twelve = formatPlanTime(local, "en-US");
    assert(twelve.endsWith("· 8:00 PM"), `12-hour manual clock: ${twelve}`);
    assert(clean(twelve), "no undefined");
    assertEquals(clockLabel(new Date(2026, 10, 6, 0, 5), "en-US"), "12:05 AM", "midnight");
    install(false);
    assertEquals(clockLabel(new Date(2026, 10, 6, 20, 0), "en-GB"), "20:00", "24-hour manual clock");
    assertEquals(shortPlanTime(local, "en-GB").endsWith("20:00"), true, "short label, 24-hour");
    // An explicit time zone has no honest manual fallback: the clock is dropped, never faked.
    assertEquals(clockLabel(new Date(local), "en-US", "UTC"), "", "no fake clock in another zone");
  } finally {
    // deno-lint-ignore no-explicit-any
    (Intl as any).DateTimeFormat = Real;
  }
});

Deno.test("B-1: planModel never reads the parts API", async () => {
  const source = await Deno.readTextFile(new URL("../planModel.ts", import.meta.url));
  assert(!source.includes("formatToParts"), "planModel.ts must not contain formatToParts");
});

// ---------------------------------------------------------------------------
// B-2: Matches counter
// ---------------------------------------------------------------------------

Deno.test("B-2: matchIndexForOffset rounds and clamps", () => {
  assertEquals(matchIndexForOffset(0, 304, 4), 0, "start");
  assertEquals(matchIndexForOffset(304 * 1.6, 304, 4), 2, "mid-swipe rounds");
  assertEquals(matchIndexForOffset(304 * 9, 304, 4), 3, "past the end");
  assertEquals(matchIndexForOffset(-50, 304, 4), 0, "bounce before the start");
  assertEquals(matchIndexForOffset(NaN, 304, 4), 0, "NaN");
  assertEquals(matchIndexForOffset(500, 304, 0), 0, "no cards");
});

Deno.test("B-2: PlanMatchesSheet tracks the index on every scroll frame", async () => {
  const sheet = await Deno.readTextFile(new URL("../PlanMatchesSheet.tsx", import.meta.url));
  assert(/onScroll=\{trackIndex\}/.test(sheet), "onScroll wired");
  assert(/scrollEventThrottle=\{16\}/.test(sheet), "scrollEventThrottle 16");
  assert(/onScrollEndDrag=\{trackIndex\}/.test(sheet) && /onMomentumScrollEnd=\{trackIndex\}/.test(sheet), "finalisers");
  assert(/matchIndexForOffset\(/.test(sheet), "uses matchIndexForOffset");
});

// ---------------------------------------------------------------------------
// B-5: Added by / You
// ---------------------------------------------------------------------------

Deno.test("B-5: optionVotersLine hides the creator as adder and puts You first", () => {
  const p = plan("p", { createdBy: "ada" });
  assertEquals(optionVotersLine({ addedBy: "ada", voterIds: ["tobi", ME] }, p, ME, nameOf, t, "time"), "You, Tobi", "creator-added: voters only");
  assertEquals(
    optionVotersLine({ addedBy: "kemi", voterIds: ["tobi", ME] }, p, ME, nameOf, t, "time"),
    "Added by Kemi · You, Tobi",
    "another adder",
  );
  assertEquals(optionVotersLine({ addedBy: "kemi", voterIds: [] }, p, ME, nameOf, t, "time"), "Added by Kemi · No votes yet", "no voters");
  assertEquals(optionVotersLine({ addedBy: null, voterIds: [] }, p, ME, nameOf, t, "time"), "No votes yet", "no adder, no voters");
  assertEquals(optionVotersLine({ addedBy: ME, voterIds: [ME] }, plan("q", { createdBy: "ada" }), ME, nameOf, t, "place"), "Suggested by You · You", "place kind");
  assertEquals(
    optionVotersLine({ addedBy: ME, voterIds: ["tobi"] }, plan("r", { createdBy: ME }), ME, nameOf, t, "time"),
    "Tobi",
    "never 'Added by you' for the creator",
  );
});

// ---------------------------------------------------------------------------
// Place vote
// ---------------------------------------------------------------------------

Deno.test("leadingPlace: most votes; tie → the original, then list order", () => {
  const a = placeOption("a", { voterIds: ["ada"] });
  const b = placeOption("b", { voterIds: ["ada", "tobi"] });
  const orig = placeOption("o", { isOriginal: true, voterIds: ["kemi"] });
  assertEquals(leadingPlace([a, b, orig])?.id, "b", "most votes");
  assertEquals(leadingPlace([a, orig])?.id, "o", "tie goes to the original");
  assertEquals(leadingPlace([a, placeOption("c", { voterIds: ["x"] })])?.id, "a", "tie without original: list order");
  assertEquals(leadingPlace([]), null, "none");
});

Deno.test("needsMyVote counts an unvoted place vote; applyPlaceVotePatch toggles my vote", () => {
  const voted = plan("p", { whenMode: "set", reactions: { up: [ME], down: [] }, places: [placeOption("a", { voterIds: [ME] }), placeOption("b")] });
  const unvoted = plan("q", { whenMode: "set", reactions: { up: [ME], down: [] }, places: [placeOption("a"), placeOption("b")] });
  const single = plan("r", { whenMode: "set", reactions: { up: [ME], down: [] }, places: [placeOption("a")] });
  assertEquals(needsMyVote(voted, ME), false, "voted a place");
  assertEquals(needsMyVote(unvoted, ME), true, "place vote waiting on me");
  assertEquals(needsMyVote(single, ME), false, "one place is not a vote");
  const payload = { viewerId: ME, memberCount: 3, historyVisibleFrom: null, plans: [unvoted] };
  const on = applyPlaceVotePatch(payload, "b", ME, true);
  assertEquals(on.plans[0].places[1].voterIds, [ME], "vote on");
  const off = applyPlaceVotePatch(on, "b", ME, false);
  assertEquals(off.plans[0].places[1].voterIds, [], "vote off");
  assertEquals(applyPlaceVotePatch(payload, "nope", ME, true), payload, "unknown option untouched");
});

Deno.test("lock label and lock place id follow the shown leaders; deck plans send no place", () => {
  const p = plan("p", {
    options: [{ id: "t1", startsAt: "2026-11-06T20:00:00Z", addedBy: "ada", voterIds: [ME] }],
    places: [placeOption("o", { isOriginal: true, name: "Skyline" }), placeOption("b", { name: "Bar Ten", voterIds: ["ada", ME] })],
  });
  assertEquals(lockLabelParts(p, "en-US", "UTC"), { time: "Fri 8:00 PM", place: "Bar Ten" }, "time + place");
  assertEquals(lockLabelParts(plan("q", { options: p.options }), "en-US", "UTC").place, null, "no place vote");
  assertEquals(lockPlaceOptionId(p), "b", "the leader is sent");
  assertEquals(lockPlaceOptionId(plan("d", { source: "deck", places: p.places })), null, "deck: never");
  assertEquals(lockPlaceOptionId(plan("e")), null, "no places: null");
});

Deno.test("quote note and snapshot carry the picked places", () => {
  const p = plan("p", { places: [placeOption("a", { name: "Skyline", voterIds: [ME] }), placeOption("b", { name: null, link: { url: "https://x.com", domain: "x.com" }, voterIds: [ME] }), placeOption("c", { voterIds: ["ada"] })] });
  const snap = viewerQuoteSnapshot(p, ME);
  assertEquals(snap.votedPlaces, ["Skyline", "x.com"], "my picks, in order, domain for a link");
  assertEquals(planQuoteNote(snap, "en-US", "UTC", t), "You picked Skyline and x.com", "picked note");
  assertEquals(
    planQuoteNote({ votedStartsAt: ["2026-11-06T20:00:00Z"], rsvp: "going", votedPlaces: ["Skyline"] }, "en-US", "UTC", t),
    "You voted Fri 8:00 PM, you picked Skyline, you're going",
    "times, places, rsvp",
  );
  assertEquals(planQuoteFallbackKey(plan("q", { whenMode: "none", places: [placeOption("a"), placeOption("b")] })), "plan_quote_voting_place", "place-only vote");
  assertEquals(planQuoteFallbackKey(plan("r", { options: [{ id: "t", startsAt: "2026-11-06T20:00:00Z", addedBy: null, voterIds: [] }] })), "plan_quote_voting", "time vote");
  assertEquals(parsePlanQuote({ title: "x", votedStartsAt: [], rsvp: null, votedPlaces: ["A", 3] }).votedPlaces, ["A"], "parse");
  assertEquals(parsePlanQuote({ title: "x" }).votedPlaces, [], "old rows");
});

// ---------------------------------------------------------------------------
// Links: covers, the form, targets, payload parse, preview retry
// ---------------------------------------------------------------------------

Deno.test("planPhoto: pool photo first, then the link preview image", () => {
  assertEquals(planPhoto(plan("p", { place: { photoUrl: "https://pool/a.jpg" }, link: { imageUrl: "https://site/i.jpg" } })), "https://pool/a.jpg", "pool first");
  assertEquals(planPhoto(plan("q", { link: { url: "https://x.com", domain: "x.com", imageUrl: "https://site/i.jpg" } })), "https://site/i.jpg", "link image");
  assertEquals(planPhoto(plan("r")), null, "none");
});

Deno.test("the form: an invalid place link blocks Post; the link goes only with a non-Mingla place", () => {
  const mapbox = { source: "mapbox", name: "Skyline", area: "Lekki", mapboxId: "mb1", lat: 6.4, lng: 3.4 };
  const form = { ...blankPlanForm(), where: "place", place: mapbox, when: "poll", openTimes: true };
  assertEquals(canPostPlan({ ...form, placeLink: "" }), true, "no link: fine");
  assertEquals(canPostPlan({ ...form, placeLink: "not a link" }), false, "invalid link blocks");
  assertEquals(canPostPlan({ ...form, placeLink: "skyline.ng/menu" }), true, "valid link");
  const input = planCreateInput({ ...form, placeLink: "skyline.ng/menu" }, "c1", "k1");
  assertEquals([input.whereKind, input.linkUrl, input.place.mapboxId], ["place", "https://skyline.ng/menu", "mb1"], "mapbox + link");
  const typed = planCreateInput({ ...form, place: { source: "typed", name: "Mama's", area: null }, placeLink: "https://mamas.com" }, "c1", "k1");
  assertEquals([typed.whereKind, typed.linkUrl], ["address", "https://mamas.com"], "typed + link");
  const pool = planCreateInput({ ...form, place: { source: "pool", name: "Bar", area: null, poolId: "p1" }, placeLink: "https://bar.com" }, "c1", "k1");
  assertEquals([pool.whereKind, pool.linkUrl, pool.place], ["place", null, { poolId: "p1" }], "never a link on a Mingla place");
  const suggestion = planAddPlaceInput("plan1", mapbox, "skyline.ng");
  assertEquals(suggestion, { planId: "plan1", whereKind: "place", place: { mapboxId: "mb1", name: "Skyline", address: "Lekki", lat: 6.4, lng: 3.4 }, linkUrl: "https://skyline.ng" }, "suggestion input");
});

Deno.test("placeLinkTarget: Mingla card / own link / the map in Mingla", () => {
  const maps = ({ lat, lng, label }) => (lat != null ? `https://maps/?q=${lat},${lng}` : label ? `https://maps/?q=${label}` : null);
  assertEquals(placeLinkTarget({ poolId: "p1", name: "Bar", address: null, lat: 1, lng: 2, link: null }, maps), { kind: "mingla" }, "pool");
  assertEquals(
    placeLinkTarget({ poolId: null, name: "Skyline", address: null, lat: 1, lng: 2, link: { url: "https://skyline.ng", domain: "skyline.ng", title: "Skyline Menu" } }, maps),
    { kind: "link", url: "https://skyline.ng", label: "Skyline Menu" },
    "mapbox with its own link",
  );
  assertEquals(placeLinkTarget({ poolId: null, name: "Mama's", address: null, lat: null, lng: null, link: null }, maps), { kind: "maps", url: "https://maps/?q=Mama's" }, "typed, no link");
  assertEquals(placeLinkTarget({ poolId: null, name: null, address: null, lat: null, lng: null, link: null }, maps), null, "nothing to open");
});

Deno.test("payload parse defaults the amendment fields; preview retry rule", () => {
  const raw = { viewerId: ME, memberCount: 2, historyVisibleFrom: null, plans: [{ ...plan("p"), places: undefined, canAddPlace: undefined, link: { url: "https://x.com", domain: "x.com" } }] };
  const parsed = normalizeChatPlansPayload(raw);
  assertEquals(parsed.plans[0].places, [], "places []");
  assertEquals(parsed.plans[0].canAddPlace, false, "canAddPlace false");
  assertEquals(parsed.plans[0].link, { url: "https://x.com", domain: "x.com", title: null, imageUrl: null, siteName: null, fetchedAt: null }, "link fields null");
  const now = Date.parse("2026-11-01T10:05:00Z");
  assertEquals(needsLinkPreviewRetry(parsed.plans[0], now), true, "never tried, older than 60 s");
  assertEquals(needsLinkPreviewRetry(parsed.plans[0], Date.parse("2026-11-01T10:00:30Z")), false, "too new");
  assertEquals(needsLinkPreviewRetry({ ...parsed.plans[0], link: { ...parsed.plans[0].link, fetchedAt: "2026-11-01T10:01:00Z" } }, now), false, "already tried");
  assertEquals(planErrorKey("conflict_too_many_places", "addPlace"), "plan_too_many_places", "seventh place copy");
});

Deno.test("plan_lock / plan_cancel are literal rpc calls (gate #2305) and the lock sends the place", async () => {
  const service = await Deno.readTextFile(new URL("../../../services/chatPlansService.ts", import.meta.url));
  assert(/supabase\.rpc\('plan_lock',/.test(service), "literal plan_lock");
  assert(/supabase\.rpc\('plan_cancel',/.test(service), "literal plan_cancel");
  assert(/p_place_option_id: input\.placeOptionId \?\? null/.test(service), "p_place_option_id sent");
  const hooks = await Deno.readTextFile(new URL("../../../hooks/useChatPlans.ts", import.meta.url));
  assert(/placeOptionId: lockPlaceOptionId\(plan\)/.test(hooks), "useLockPlan passes the leading place");
});

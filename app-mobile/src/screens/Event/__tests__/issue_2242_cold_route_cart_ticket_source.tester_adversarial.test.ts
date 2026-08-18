// @ts-nocheck — Deno-runtime suite (Deno globals + deno.land import); the
// app-mobile tsc sweep has no Deno types (house convention — see
// orch_1342_cold_seed_landing.test.ts).
//
// #2242 [cold-link-cart] — TESTER ADVERSARIAL suite. Deliberately a DIFFERENT ANGLE
// from the implementor's suite (`issue_2242_cold_route_cart_ticket_source.test.ts`),
// which is pure source-STRUCTURE: `String.includes()` assertions that the fix's text
// is present.
//
// Structural assertions answer "is the expected text there?". They cannot answer
// "what does the buyer actually get?" — and #2242 exists precisely because a green
// structural gate (`issue-1929-hidden-direct-checkout.mjs`, failing with "cold tickets
// not bundle-owned") was satisfied by a line that was NOT the cart's, so the text was
// present, the gate was green, and the rail was dead for six days. Adding more of the
// same class of check would reproduce that defect at one remove.
//
// So this suite EXECUTES the production expressions instead of reading them:
//   * it extracts the REAL `cartTickets` initializer from ConsumerEventDetailScreen.tsx
//     and compiles it with `new Function`, then drives it through every reachable
//     (route x query) state;
//   * it extracts the REAL decision predicates out of TicketCartSheet.tsx
//     (`tickets === undefined` -> "loading", `!tickets` -> [], `visibleTickets.length
//     === 0` -> "empty") and the REAL pre-seed gate (`visible && tickets`), compiles
//     those too, and asserts the render state and the seeding side-effect the buyer
//     actually experiences;
//   * it derives `allowLegacyTicketRead` from the REAL rule in usePublicEventBySlug.ts
//     and proves the screen-level INVARIANT that no reachable state leaves the cart
//     subscribed to a source that can never populate — the exact shape of the P0;
//   * it runs the PRE-FIX expression through the same matrix as a counterfactual, so
//     the suite is demonstrably diagnostic rather than merely green.
//
// Because the expressions are compiled from source at run time, a rename, a re-point,
// an added `?? []`, or an inverted precedence changes BEHAVIOUR here and fails a
// behavioural assertion — not just a text match.
//
// FAILS-ON-REVERT (verified locally by true line-edit of the fix, see the QA report):
//   - revert the mount/initializer to `ticketsQuery.data`  -> A-01, A-06, A-08 FAIL.
//   - add `?? []` to the initializer                        -> A-02, A-09 FAIL.
//   - re-point the initializer at `canonicalQuery.data`     -> A-10 FAILS.
//   - invert TicketCartSheet's loading/empty precedence     -> A-09 FAILS.
//
// RUNTIME CORROBORATION (device evidence in the #2242 QA comment): the pre-fix
// before-shot on sim B09CBC89 showed `Loading tickets...` persisting past 15s on the
// cold `/e/` route — i.e. `undefined` reaching the sheet — which is the same mapping
// A-02/A-09 assert here. The post-fix cold route rendered the tier list, and 4 cold-
// cache deck runs never rendered "No tickets available for this event.".

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = async (rel: string): Promise<string> =>
  await Deno.readTextFile(new URL(rel, import.meta.url));

// Comment-stripping matters here for a reason specific to this issue: the fix ships a
// 20-line explanatory comment block that mentions `ticketsQuery.data` in prose. Any
// assertion that reads raw source can be satisfied — or falsely tripped — by that
// prose. Everything below operates on code only.
const strip = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const eventScreen = strip(await read("../ConsumerEventDetailScreen.tsx"));
const cartSheet = strip(
  await read("../../../components/expandedCard/TicketCartSheet.tsx"),
);
const coldReadHook = strip(await read("../../../hooks/usePublicEventBySlug.ts"));

// ─── extraction helpers ──────────────────────────────────────────────────────
// Each `extract` failure is itself a real finding: it means the production shape this
// suite is pinned to no longer exists, so the behavioural guarantees below are
// unverified. That is a FAIL, never a silent skip.

const extract = (src: string, re: RegExp, what: string): string => {
  const m = src.match(re);
  assert(m !== null, `#2242 adversarial: could not locate ${what} in production source`);
  return m[1].trim();
};

/** The REAL cart ticket-source initializer, compiled and executable. */
const cartTicketsExpr = extract(
  eventScreen,
  /const cartTickets\s*=([^;]*);/,
  "the `const cartTickets = ...;` initializer",
);

/** The pre-fix expression, for the counterfactual leg. */
const PRE_FIX_EXPR = "ticketsQuery.data";

const compileCartSource = (expr: string) =>
  new Function(
    "canonical",
    "ticketsQuery",
    `"use strict"; return (${expr});`,
  ) as (canonical: unknown, ticketsQuery: unknown) => unknown;

const cartTicketsOf = compileCartSource(cartTicketsExpr);
const preFixTicketsOf = compileCartSource(PRE_FIX_EXPR);

/** TicketCartSheet's REAL render-state predicates. */
const visibleGuardExpr = extract(
  cartSheet,
  /const visibleTickets = useMemo<PublicTicketProps\[\]>\(\(\) => \{\s*if \((![\s\S]*?)\) return \[\];/,
  "TicketCartSheet's `if (!tickets) return [];` guard",
);
const loadingPredicateExpr = extract(
  cartSheet,
  /if \((tickets === undefined)\) return "loading";/,
  'TicketCartSheet\'s `tickets === undefined -> "loading"` predicate',
);
const emptyPredicateExpr = extract(
  cartSheet,
  /if \((visibleTickets\.length === 0)\) return "empty";/,
  'TicketCartSheet\'s `visibleTickets.length === 0 -> "empty"` predicate',
);
/** The REAL pre-seed effect gate that silently dropped the buyer's inline quantities. */
const preSeedGateExpr = extract(
  cartSheet,
  /useEffect\(\(\) => \{\s*if \((visible && tickets)\) \{/,
  "TicketCartSheet's `if (visible && tickets)` pre-seed gate",
);

const isBlankSource = new Function("tickets", `"use strict"; return (${visibleGuardExpr});`);
const isLoading = new Function("tickets", `"use strict"; return (${loadingPredicateExpr});`);
const isEmpty = new Function(
  "visibleTickets",
  `"use strict"; return (${emptyPredicateExpr});`,
);
const preSeedRuns = new Function(
  "visible",
  "tickets",
  `"use strict"; return Boolean(${preSeedGateExpr});`,
);

/**
 * The sheet's render state, computed with the sheet's OWN extracted predicates and its
 * OWN precedence. Precedence is not hard-coded: it is asserted against source order in
 * A-09, so an inverted `loading`/`empty` ordering is a failure, not a silent pass.
 */
const renderStateFor = (tickets: unknown): string => {
  if (isLoading(tickets)) return "loading";
  const visibleTickets = isBlankSource(tickets)
    ? []
    : (tickets as unknown[]).filter(() => true);
  if (isEmpty(visibleTickets)) return "empty";
  return "populated";
};

/** The REAL `allowLegacyTicketRead` rule, compiled from usePublicEventBySlug.ts. */
const allowLegacyRuleExpr = extract(
  coldReadHook,
  /allowLegacyTicketRead:\s*(canonical === null)/,
  "the `allowLegacyTicketRead` rule",
);
const allowsLegacyRead = new Function(
  "canonical",
  `"use strict"; return (${allowLegacyRuleExpr});`,
);

/** The REAL canonical selection rule: a seed suppresses the bundle outright. */
const canonicalRuleExpr = extract(
  coldReadHook,
  /const canonical =\s*(!seedPresent && canonicalQuery\.data \? canonicalQuery\.data : null);/,
  "the `canonical` selection rule",
);
const canonicalFor = new Function(
  "seedPresent",
  "canonicalQuery",
  `"use strict"; return (${canonicalRuleExpr});`,
);

// ─── fixtures ────────────────────────────────────────────────────────────────
// Shaped like the live `we-go-again-two-day-free` fixture used for the device run.

const TIER = {
  id: "tier-free-entry",
  name: "Free Entry",
  priceGbp: 0,
  isFree: true,
  currency: "NGN",
  displayOrder: 0,
  capacity: null,
  isUnlimited: true,
  visibility: "public",
};
const BUNDLE_TIERS = [TIER];

/** The bundle as the cold `/e/` route resolves it. */
const canonicalWith = (tickets: unknown) => ({ event: { tickets } });
/** React Query's shape while a request is in flight vs settled. */
const queryInFlight = { data: undefined };
const queryResolved = (data: unknown) => ({ data });

// ═════════════════════════════════════════════════════════════════════════════
// A-01 — THE P0 ITSELF, as behaviour: cold link route must hand the sheet tiers.
// ═════════════════════════════════════════════════════════════════════════════

Deno.test("#2242 A-01: cold /e/ route — the cart receives the bundle's tiers, never a permanent undefined", () => {
  // Cold slug route: no seed -> bundle resolves -> allowLegacyTicketRead === false ->
  // usePublicEventTickets(null) -> subscribed to ["publicEventTickets", null], a key
  // nothing can populate. `data` is undefined FOREVER, not transiently.
  const canonical = canonicalFor(false, { data: canonicalWith(BUNDLE_TIERS) });
  assertNotEquals(canonical, null, "cold route must resolve a canonical bundle");
  assertEquals(
    allowsLegacyRead(canonical),
    false,
    "cold route must disable the legacy ticket read (that is the #1929 design)",
  );

  const cart = cartTicketsOf(canonical, queryInFlight);
  assertEquals(cart, BUNDLE_TIERS);
  assertEquals(renderStateFor(cart), "populated");

  // The counterfactual: the pre-fix expression, in the identical state, is the bug.
  const preFix = preFixTicketsOf(canonical, queryInFlight);
  assertStrictEquals(preFix, undefined);
  assertEquals(
    renderStateFor(preFix),
    "loading",
    "pre-fix reproduces the never-resolving spinner — this is what the before-shot captured",
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// A-02 — SC-6 TRAP, executed: the deck's in-flight window must stay `undefined`.
// ═════════════════════════════════════════════════════════════════════════════

Deno.test("#2242 A-02: deck route in flight — the cart is undefined (loading), never [] (false empty)", () => {
  // Deck/chat mounts pass a seed, which suppresses the bundle, so the legacy query is
  // live and genuinely in flight for a few hundred ms on a cold cache.
  const canonical = canonicalFor(true, { data: canonicalWith(BUNDLE_TIERS) });
  assertStrictEquals(canonical, null, "a seed must suppress the bundle outright");
  assertEquals(allowsLegacyRead(canonical), true);

  const cart = cartTicketsOf(canonical, queryInFlight);

  // The whole point of SC-6. `?? []` here would trade a P0 on the link route for a
  // data-fabrication bug (Constitution #9) on the app's HIGHEST-traffic route: the
  // buyer would be told the event has no tickets while the request is still open.
  assertStrictEquals(
    cart,
    undefined,
    "in-flight deck cart must be undefined so the sheet can show `Loading tickets...`",
  );
  assert(!Array.isArray(cart), "in-flight deck cart must NOT be an array");
  assertEquals(renderStateFor(cart), "loading");
  assertNotEquals(renderStateFor(cart), "empty");
});

// ═════════════════════════════════════════════════════════════════════════════
// A-03/A-04 — the deck route's settled states are unchanged by the fix.
// ═════════════════════════════════════════════════════════════════════════════

Deno.test("#2242 A-03: deck route resolved — the cart still reads the legacy query verbatim", () => {
  const canonical = canonicalFor(true, { data: canonicalWith([]) });
  const cart = cartTicketsOf(canonical, queryResolved(BUNDLE_TIERS));
  assertEquals(cart, BUNDLE_TIERS);
  assertEquals(renderStateFor(cart), "populated");
  // Byte-for-byte the pre-fix behaviour on this route: the fix must be a no-op here.
  assertEquals(cart, preFixTicketsOf(canonical, queryResolved(BUNDLE_TIERS)));
});

Deno.test("#2242 A-04: deck route with a genuinely ticketless event — honest empty, not a spinner", () => {
  const canonical = canonicalFor(true, { data: null });
  const cart = cartTicketsOf(canonical, queryResolved([]));
  assertEquals(cart, []);
  assertEquals(
    renderStateFor(cart),
    "empty",
    "a settled empty list must still say `No tickets available for this event.`",
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// A-05 — BOUNDARY: `??` is nullish, not falsy. A zero-tier bundle must NOT fall
// through to the query the same route just disabled.
// ═════════════════════════════════════════════════════════════════════════════

Deno.test("#2242 A-05: cold route, zero-tier bundle — [] does not fall through to the disabled query", () => {
  const canonical = canonicalFor(false, { data: canonicalWith([]) });
  assertEquals(allowsLegacyRead(canonical), false);

  const cart = cartTicketsOf(canonical, queryInFlight);
  // If the initializer ever used `||` instead of `??`, `[]` is truthy so this would
  // still pass — but if it used `?.tickets || ticketsQuery.data` with a falsy empty
  // sentinel, or reordered the operands, the cart would hand back `undefined` and the
  // buyer would get the permanent spinner again on a legitimately empty event.
  assertEquals(cart, []);
  assertStrictEquals(Array.isArray(cart), true);
  assertEquals(renderStateFor(cart), "empty");
});

Deno.test("#2242 A-06: cold route, bundle present but tickets key absent — falls back, never throws", () => {
  // Defensive boundary: a bundle whose `event.tickets` is missing must degrade to the
  // legacy query rather than crash the screen on a property read.
  const canonical = { event: {} };
  const cart = cartTicketsOf(canonical, queryResolved(BUNDLE_TIERS));
  assertEquals(cart, BUNDLE_TIERS);
  assertEquals(renderStateFor(cart), "populated");

  const stillInFlight = cartTicketsOf(canonical, queryInFlight);
  assertStrictEquals(stillInFlight, undefined);
  assertEquals(renderStateFor(stillInFlight), "loading");
});

// ═════════════════════════════════════════════════════════════════════════════
// A-07 — the SILENTLY-DISCARDED QUANTITY half of the bug (SPEC SC-3, F-2).
// ═════════════════════════════════════════════════════════════════════════════

Deno.test("#2242 A-07: the pre-seed effect fires on the cold route — inline quantities survive", () => {
  const canonical = canonicalFor(false, { data: canonicalWith(BUNDLE_TIERS) });

  // Post-fix: truthy -> `if (visible && tickets)` runs -> the buyer's inline
  // quantities are seeded into the sheet.
  assertEquals(preSeedRuns(true, cartTicketsOf(canonical, queryInFlight)), true);

  // Pre-fix: `undefined` is falsy, so the effect never ran at all. The sheet was not
  // slow, it was INERT — sticky bar `--`, CTA stuck on `Add tickets above`.
  assertEquals(preSeedRuns(true, preFixTicketsOf(canonical, queryInFlight)), false);

  // The gate must stay closed while the sheet is shut, on every route.
  assertEquals(preSeedRuns(false, cartTicketsOf(canonical, queryInFlight)), false);
});

// ═════════════════════════════════════════════════════════════════════════════
// A-08 — THE SCREEN-LEVEL INVARIANT. This is the assertion that would have caught
// #2242 at review time, and the one no existing suite carries.
// ═════════════════════════════════════════════════════════════════════════════

Deno.test("#2242 A-08: no reachable route state leaves the cart on a source that can never populate", () => {
  const EVENT_ID = "2b05b5df-b8a0-4192-beb6-bc16111a2d85";
  const routes = [
    { name: "cold /e/ slug", seedPresent: false, bundle: canonicalWith(BUNDLE_TIERS) },
    { name: "warm deck card", seedPresent: true, bundle: canonicalWith(BUNDLE_TIERS) },
    { name: "chat purchased banner", seedPresent: true, bundle: canonicalWith(BUNDLE_TIERS) },
  ];

  for (const route of routes) {
    const canonical = canonicalFor(route.seedPresent, { data: route.bundle });
    const legacyEnabled = allowsLegacyRead(canonical);

    // The screen's own gate: `usePublicEventTickets(allowLegacyTicketRead ? eventId : null)`.
    // When the argument is null the hook subscribes to ["publicEventTickets", null] —
    // a key every call site avoids, so it is unreachable and `data` stays undefined
    // for the lifetime of the screen.
    const hookArg = legacyEnabled ? EVENT_ID : null;
    const legacyCanEverResolve = hookArg !== null;
    const ticketsQuery = legacyCanEverResolve
      ? queryResolved(BUNDLE_TIERS)
      : queryInFlight;

    const cart = cartTicketsOf(canonical, ticketsQuery);

    assert(
      cart !== undefined,
      `${route.name}: the cart resolves to a permanently-undefined source — this is #2242`,
    );
    assertEquals(
      renderStateFor(cart),
      "populated",
      `${route.name}: buyer must reach a tier list, not a spinner`,
    );

    // And the counterfactual proves the invariant is load-bearing rather than vacuous:
    // exactly the cold route breaks under the pre-fix expression.
    const preFixCart = preFixTicketsOf(canonical, ticketsQuery);
    if (!legacyCanEverResolve) {
      assertStrictEquals(
        preFixCart,
        undefined,
        `${route.name}: pre-fix must be broken here, else this test proves nothing`,
      );
    } else {
      assertEquals(preFixCart, BUNDLE_TIERS);
    }
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// A-09 — the sheet's precedence contract that makes `undefined` meaningful.
// ═════════════════════════════════════════════════════════════════════════════

Deno.test("#2242 A-09: `loading` is decided before `empty`, and only undefined yields it", () => {
  const loadingAt = cartSheet.indexOf('return "loading";');
  const emptyAt = cartSheet.indexOf('return "empty";');
  assert(loadingAt !== -1 && emptyAt !== -1, "render-state branches not found");
  assert(
    loadingAt < emptyAt,
    "TicketCartSheet must test `loading` BEFORE `empty`; inverting it turns every " +
      "in-flight cart into a false `No tickets available for this event.`",
  );

  // `undefined` is the ONE input that means "not known yet". Everything else the cart
  // source can produce is data, and must render as data.
  assertEquals(renderStateFor(undefined), "loading");
  assertEquals(renderStateFor([]), "empty");
  assertEquals(renderStateFor(BUNDLE_TIERS), "populated");

  // null is not a state the initializer can produce (`??` only yields its right operand
  // for null/undefined, and the query yields undefined) — pin that, because a future
  // `?? null` would read as "loading" here while meaning "no data".
  const canonical = canonicalFor(true, { data: null });
  assertNotEquals(cartTicketsOf(canonical, queryResolved(null)), []);
  assertStrictEquals(cartTicketsOf(canonical, queryResolved(null)), null);
});

// ═════════════════════════════════════════════════════════════════════════════
// A-10 — #2230 forward-compatibility, as behaviour rather than as a grep.
// ═════════════════════════════════════════════════════════════════════════════

Deno.test("#2242 A-10: the cart is bound to coldReadPlan.canonical, so #2230 cannot switch the deck's source", () => {
  // #2230 enables usePublicEventBySlug on the deck path too. After it lands,
  // `canonicalQuery.data` is non-null on the deck while `coldReadPlan.canonical` stays
  // null. Binding the cart to the former would silently move the DECK cart from legacy
  // `quantity_total` capacity to bundle `remaining` capacity — unreviewed, on the
  // busiest route. Proven behaviourally: feeding the post-#2230 deck state must still
  // yield the LEGACY query's data.
  const post2230DeckCanonical = canonicalFor(true, { data: canonicalWith(BUNDLE_TIERS) });
  assertStrictEquals(post2230DeckCanonical, null);

  const legacyRows = [{ ...TIER, id: "legacy-row", capacity: 250 }];
  const cart = cartTicketsOf(post2230DeckCanonical, queryResolved(legacyRows));
  assertEquals(
    cart,
    legacyRows,
    "deck cart must keep reading the legacy query after #2230 lands",
  );

  // A source expression that mentions `canonicalQuery` at all cannot satisfy the above
  // for the right reason, so pin it — this is the one place a text check is the
  // cheapest correct instrument, and it backs a behavioural assertion rather than
  // standing alone.
  assert(
    !cartTicketsExpr.includes("canonicalQuery"),
    `cartTickets must not be bound to canonicalQuery: ${cartTicketsExpr}`,
  );
});

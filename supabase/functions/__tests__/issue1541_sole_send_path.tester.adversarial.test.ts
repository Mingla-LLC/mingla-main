// Issue #1541 — TESTER ADVERSARIAL: STOP-footer composition and the waitlist
// release's write scope.
//
// ===========================================================================
// A DIFFERENT ANGLE FROM THE IMPLEMENTOR'S SUITE.
// ===========================================================================
// `issue_1541_sms_sole_send_path.test.ts` drives the four handlers and asserts
// on captured provider HTTP. It proves the ROUTE. It does not attack the BODY,
// and its one footer assertion (A-2) checks a single well-behaved venue name
// ("Smoke & Rhythm") — a fixture chosen to pass.
//
// This file attacks the composition itself, because the STOP footer is the one
// place where #1541 deliberately CHANGES a delivered message on three paths
// while promising byte-identity on the fourth. Both halves of that promise are
// hostile-fixture territory:
//
//   - the LOCKED venue copy must not gain a SECOND footer, and must not be
//     truncated past a segment boundary;
//   - the three migrated bodies must gain EXACTLY ONE.
//
// It also pins the write scope of the OQ-1 waitlist release, which is the
// mechanism the whole "a gated skip consumes nothing" guarantee rests on.
//
// PROOFS are properties the code genuinely has.
// PINS are characterizations of a CURRENT gap, labelled with the finding id.
//   *** IF A PIN FAILS, THE CODE GOT BETTER — update the pin, never the code
//       back. *** Each pin names what would close it.
//
// Run:
//   deno test --allow-env --allow-net --allow-read --no-check \
//     supabase/functions/__tests__/issue1541_sole_send_path.tester.adversarial.test.ts

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  composeSmsBody,
  computeSegments,
} from "../_shared/adapters/smsAdapter.ts";

const test = (name: string, fn: () => void | Promise<void>) =>
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });

const FOOTER = "Reply STOP to opt out.";

/** Byte-for-byte reproduction of send-venue-sms's LOCKED copy (index.ts:56). */
const tableReadyCopy = (venueName: string): string =>
  `Your table's ready at ${venueName}. Reply STOP to opt out.`;

const countFooters = (s: string): number =>
  s.split(FOOTER).length - 1;

// ===========================================================================
// PROOF ADV-1 — the locked venue copy never gains a second footer.
// ===========================================================================
// The suppression rule is `/reply stop/i` over the WHOLE body. The attack is a
// venue NAME that perturbs the body around that test: casing, punctuation the
// GSM-7 sanitizer rewrites, a name that itself looks like a footer, a name long
// enough to cross a segment boundary, and the empty name.
test("ADV-1 PROOF: the locked venue copy carries exactly one STOP footer, for every hostile venue name", () => {
  const venues = [
    "Smoke & Rhythm",
    "",                                   // empty name — degenerate template
    "  ",                                 // whitespace-only
    "Reply Stop Lounge",                  // name collides with the guard's regex
    "REPLY STOP TO OPT OUT.",             // name IS the footer, upper-cased
    "Café Naïve",                         // non-ASCII, sanitizer touches nothing here
    "The Bar — Downtown",                 // em dash, sanitizer rewrites to '-'
    "Joe’s Place",                   // curly apostrophe → straight
    "A".repeat(200),                      // forces a multi-segment body
    "Bar\nWithNewline",                   // embedded newline
  ];
  assert(venues.length >= 8, "vacuity: the hostile fixture set went empty");

  let exercisedSuppression = 0;
  for (const venue of venues) {
    const raw = tableReadyCopy(venue);
    const composed = composeSmsBody(raw);

    // The guard must have fired for every one of these — the template always
    // ends in the footer, so the adapter must never append another.
    assert(
      /reply stop/i.test(raw),
      `fixture ${JSON.stringify(venue)} did not even contain the footer — bad fixture`,
    );
    exercisedSuppression += 1;

    const before = countFooters(raw);
    const after = countFooters(composed);
    assertEquals(
      after,
      before,
      `venue ${JSON.stringify(venue)}: the adapter changed the footer count ` +
        `${before} -> ${after}. Composed: ${JSON.stringify(composed)}`,
    );

    // The delivered body must never end with the footer twice over.
    assert(
      !composed.endsWith(`${FOOTER} ${FOOTER}`),
      `venue ${JSON.stringify(venue)}: double footer at the tail`,
    );
    assert(
      !/reply stop to opt out\.\s*reply stop to opt out\./i.test(composed),
      `venue ${JSON.stringify(venue)}: adjacent duplicate footer`,
    );
  }

  // #1529 discipline applied to this suite: a sweep that never reached the
  // branch it claims to test proves nothing.
  assertEquals(
    exercisedSuppression,
    venues.length,
    "vacuity: no fixture actually exercised the footer-suppression branch",
  );
});

// ===========================================================================
// PROOF ADV-2 — nothing is ever truncated, at any length.
// ===========================================================================
// The dispatch asked specifically whether the migration can truncate a message
// past a segment boundary. It cannot: `composeSmsBody` only appends and
// character-maps, and `computeSegments` is observational — it counts, it never
// cuts. Proven across the GSM-7 (160/153) and UCS-2 (70/67) boundaries.
test("ADV-2 PROOF: composition never truncates, and segmentation is observational only", () => {
  const lengths = [1, 69, 70, 71, 152, 153, 159, 160, 161, 306, 918];
  let crossedMulti = 0;

  for (const n of lengths) {
    const venue = "A".repeat(n);
    const raw = tableReadyCopy(venue);
    const composed = composeSmsBody(raw);

    // Every character of the venue name survives.
    assertStringIncludes(composed, venue);
    // The template's own text survives on both sides of the name.
    assertStringIncludes(composed, "Your table's ready at ");
    assertStringIncludes(composed, FOOTER);
    // Length is never reduced (the sanitizer maps 1:1 or expands "…"→"...").
    assert(
      composed.length >= raw.length,
      `n=${n}: body SHRANK ${raw.length} -> ${composed.length} — truncation`,
    );

    const segs = computeSegments(composed);
    assert(segs >= 1, `n=${n}: segment count must be >= 1`);
    if (segs > 1) crossedMulti += 1;
  }

  assert(
    crossedMulti > 0,
    "vacuity: no fixture ever crossed a segment boundary, so this proved nothing",
  );

  // A UCS-2 body (non-GSM-7 char) is likewise counted, never cut.
  const emoji = composeSmsBody(`Your table's ready at 🎉Bar. ${FOOTER}`);
  assertStringIncludes(emoji, "🎉Bar");
  assert(computeSegments(emoji) >= 1);
});

// ===========================================================================
// PROOF ADV-3 — the three migrated bodies gain EXACTLY ONE footer.
// ===========================================================================
// SPEC §4.0 accepts this as an intended delta. It is only correct if it happens
// once, and only once, on each body.
test("ADV-3 PROOF: ticket / invite / pair bodies each gain exactly one footer", () => {
  const bodies = [
    "Mingla: your 2 tickets for Rooftop Sessions are confirmed. Order ABC123.",
    "Ada invited you to Mingla! Plan experiences together. Download now: https://mingla.app/invite",
    "Ada wants to pair with you on Mingla! Download the app to connect: https://mingla.app",
    "Mingla: A GA spot just opened for Rooftop Sessions. Claim within 24h: https://mingla.app/checkout/x?wl=y",
  ];
  assert(bodies.length === 4, "vacuity: the migrated-body fixture set changed");

  for (const raw of bodies) {
    assertEquals(
      countFooters(raw),
      0,
      `fixture already had a footer, so it cannot prove one is ADDED: ${raw}`,
    );
    const composed = composeSmsBody(raw);
    assertEquals(
      countFooters(composed),
      1,
      `expected exactly one footer, got ${countFooters(composed)}: ${composed}`,
    );
    assert(
      composed.endsWith(FOOTER),
      `the footer must land at the tail: ${composed}`,
    );
    // Single-space join (transactional form), not the marketing own-line form.
    assertStringIncludes(composed, ` ${FOOTER}`);
    assert(!composed.includes(`\n\n${FOOTER}`), "transactional sends must not use the own-line form");
    // The URL in the body is intact — a footer append must not eat the link.
    const url = /https:\/\/\S+/.exec(raw);
    if (url) assertStringIncludes(composed, url[0]);
  }
});

// ===========================================================================
// PROOF ADV-4 — tester finding T-1541-FOOTER-SUPPRESSION (P3), NOW CLOSED.
// ===========================================================================
// Converted from a pin during #1541 IMPLEMENT REWORK; the attack is unchanged
// and only the expectation flipped. The suppression guard used to be a
// substring test over the WHOLE body, so a message whose own CONTENT happened
// to contain "reply stop" shipped with NO opt-out line. Post-#1541 that is
// reachable from user-controlled text: an event title, a ticket-type name or a
// venue name flows into these bodies, so an ordinary band called "Reply Stop"
// stripped the CTIA affordance off a real transactional send.
//
// #1537 has merged, so smsAdapter.ts was no longer off-limits. The guard is now
// end-anchored — /reply stop to opt out\.\s*$/i — which asks the question it
// always meant: does this body ALREADY END with the footer? A mid-body mention
// is content, not compliance. #1537 never touched composeSmsBody, so the fix is
// self-contained and does not reach into its shipped behaviour.
test("ADV-4 PROOF: an incidental 'reply stop' in user text still gets the real footer", () => {
  const hostile =
    "Mingla: your 2 tickets for Reply Stop (the band) are confirmed. Order ABC123.";
  const composed = composeSmsBody(hostile);

  assertEquals(
    countFooters(composed),
    1,
    "REGRESSION: a body that merely MENTIONS 'reply stop' is being treated as " +
      "already carrying the footer, so this transactional SMS ships with no " +
      "opt-out affordance. The guard has lost its end-anchor.",
  );
  assert(
    composed.endsWith(FOOTER),
    "the opt-out line must be at the tail of the delivered body",
  );
  // The user's own text is preserved verbatim — the fix appends, never rewrites.
  assertStringIncludes(composed, "Reply Stop (the band)");

  // And the genuine end-of-body case is still suppressed: no double footer.
  const alreadyFootered = `Your table's ready at The Bar. ${FOOTER}`;
  assertEquals(
    countFooters(composeSmsBody(alreadyFootered)),
    1,
    "a body that ALREADY ends with the footer must not gain a second one",
  );
});

// ===========================================================================
// PROOF ADV-5 — tester finding T-1541-WAITLIST-RELEASE-SCOPE (P2), NOW CLOSED.
// Converted from a pin during #1541 IMPLEMENT REWORK. The release now carries
// `.eq("notification_id", notificationId)` — a compare-and-set — so a stale or
// duplicate worker matches ZERO rows and takes the existing
// `waitlist_release_matched_no_rows` throw instead of clobbering a live
// invitation. The seat can no longer be offered twice.
// ===========================================================================
// The OQ-1 guarantee is "a gated skip consumes nothing". Its mechanism is
// release-first-then-record in `releaseWaitlistEntryToPool`
// (ticket-confirmation-dispatch/index.ts:293-341). The implementor proved it
// under four FAILURE shapes (E-2..E-4) but not under CONCURRENCY, which the
// dispatch asked for — and `handleWaitlistNotificationDispatch` (:497-538)
// claims the notification row with an UNCONDITIONAL update, with no
// `.eq("status", …)` compare-and-set, so two dispatches of the same
// notification both proceed to deliver.
//
// The release UPDATE is scoped by ENTRY ID ALONE. It carries no predicate
// binding it to the invitation THIS notification represents. So a slow/duplicate
// worker finishing after the seat has already been re-offered will release an
// invitation it does not own: entry back to 'waiting' while a live notification
// for the NEXT guest is already in flight — the same seat offered twice.
//
// Live exposure today is ZERO: waitlist_entries.email is NOT NULL in production
// (verified read-only, 2026-08-04), so the drain trigger always takes the email
// arm and an SMS waitlist_spot_open row cannot be enqueued at all. This is a
// latent gap in new code, not an active harm — hence a pin and a P2, not a P0.
//
// WHAT WOULD CLOSE IT: add `.eq("notification_id", notification.id)` (or
// `.eq("status","invited")`) to the release UPDATE, so a stale worker matches
// zero rows and takes the existing `waitlist_release_matched_no_rows` throw
// instead of clobbering a live invitation.
test("ADV-5 PROOF: the waitlist release carries an ownership predicate", async () => {
  const src = await Deno.readTextFile(
    new URL("../ticket-confirmation-dispatch/index.ts", import.meta.url),
  );

  // Vacuity guard: locate the real function body before asserting anything
  // about it. A lookup that matched nothing must fail, not pass (#1529).
  const start = src.indexOf("async function releaseWaitlistEntryToPool");
  assert(
    start > 0,
    "vacuity: releaseWaitlistEntryToPool not found — this test is asserting nothing",
  );
  const end = src.indexOf("\nasync function deliverWaitlistSpotOpenNotification", start);
  assert(end > start, "vacuity: could not bound the release function body");
  const body = src.slice(start, end);

  // The release genuinely exists and restores all four fields (the part that IS
  // correct, and must stay correct).
  assertStringIncludes(body, '.from("waitlist_entries")');
  assertStringIncludes(body, 'status: "waiting"');
  assertStringIncludes(body, "invited_at: null");
  assertStringIncludes(body, "notified_at: null");
  assertStringIncludes(body, "notification_id: null");

  // …and it is bound to the entry only.
  assertStringIncludes(body, '.eq("id", waitlistEntryId)');

  const ownershipPredicate = /\.eq\(\s*"(notification_id|status)"/.test(body);
  assertEquals(
    ownershipPredicate,
    true,
    "REGRESSION: the release lost its ownership predicate. Scoped by entry id " +
      "alone, a stale or duplicate dispatch will clobber an invitation it does " +
      "not own and the same seat gets offered twice — the inverse of the harm " +
      "the release exists to prevent.",
  );
  // The predicate must bind to THIS notification, not merely to any column.
  assertStringIncludes(
    body,
    '.eq("notification_id", notificationId)',
    "the compare-and-set must bind the release to the invitation this " +
      "notification represents",
  );
  // …and the zero-row path must still REFUSE rather than proceed — that is what
  // turns a lost race into a retry instead of a clobber.
  assertStringIncludes(body, "waitlist_release_matched_no_rows");
});

// ===========================================================================
// PROOF ADV-6 — tester finding T-1541-ROLLUP-VACUITY (P3), NOW CLOSED.
// Converted from a pin during #1541 IMPLEMENT REWORK.
// ===========================================================================
// The order rollup (ticket-confirmation-dispatch/index.ts:1540-1545) is
//     failed ? (sent ? "partial" : "failed") : "sent"
// over the outcomes of THIS dispatch pass. #1541 correctly makes a market skip
// count as neither failed nor sent (SC-6). But the expression's default arm is
// "sent", so an outcome set containing NO successful send still stamps the
// order `notification_status='sent'`:
//   - every outcome `skipped` → "sent"  (newly reachable: #1541 introduced the
//     first SMS `skipped` outcome on this path)
//   - ZERO outcomes, because the `.in(["pending","failed_retryable"])` query at
//     :1196-1200 selected nothing → "sent" (pre-existing, widened here)
// A dispatch that sent nothing reports full success. Constitution rule 3.
//
// HOW IT WAS CLOSED: the else-arm now requires a positive send, and an EMPTY
// outcome set writes nothing at all.
//
// NOTE ON VOCABULARY — the tester's suggested `"skipped"` literal is NOT
// available: `orders_notification_status_check` permits exactly
// not_required | pending | sent | partial | failed (verified against production
// pg_constraint), so writing "skipped" would throw at runtime. `not_required`
// is the existing term for "this leg had nothing to deliver", which is exactly
// a fully-gated dispatch — nothing sent, nothing failed, nothing awaiting retry
// (the sweeper never selects `skipped`).
test("ADV-6 PROOF: an all-skipped pass reports honestly and an empty pass asserts nothing", async () => {
  const src = await Deno.readTextFile(
    new URL("../ticket-confirmation-dispatch/index.ts", import.meta.url),
  );

  const idx = src.indexOf("notification_status: failed");
  assert(
    idx > 0,
    "vacuity: the rollup expression was not found — this test is asserting nothing",
  );
  const expr = src.slice(idx, idx + 160);

  // The fixed shape: the else-arm is CONDITIONAL on a positive send.
  assertStringIncludes(expr, '? (sent ? "partial" : "failed")');
  assertStringIncludes(expr, ': (sent ? "sent" : "not_required")');
  assert(
    !/:\s*"sent",/.test(expr),
    "REGRESSION: the rollup's else-arm is an unconditional \"sent\" again — a " +
      "dispatch pass that sent nothing would report full success",
  );

  // The empty set must not reach the write at all.
  const guardIdx = src.indexOf("if (outcomes.length === 0) {");
  assert(
    guardIdx > 0 && guardIdx < idx,
    "REGRESSION: the empty-outcome guard is gone or no longer precedes the " +
      "rollup write — a pass that observed nothing would stamp a verdict",
  );

  // Reproduce the SHIPPED predicate and prove every case.
  const rollup = (outcomes: Array<{ status: string }>): string | null => {
    if (outcomes.length === 0) return null; // no write
    const failed = outcomes.some((r) => r.status.startsWith("failed"));
    const sent = outcomes.some((r) => r.status === "sent");
    return failed ? (sent ? "partial" : "failed") : (sent ? "sent" : "not_required");
  };

  // SC-6 and its neighbours must NOT regress.
  assertEquals(rollup([{ status: "sent" }, { status: "skipped" }]), "sent");
  assertEquals(rollup([{ status: "sent" }, { status: "failed_terminal" }]), "partial");
  assertEquals(rollup([{ status: "failed_terminal" }]), "failed");

  // The two cases that used to lie.
  assertEquals(
    rollup([{ status: "skipped" }, { status: "skipped" }]),
    "not_required",
    "an all-skipped pass must not claim a send it never made",
  );
  assertEquals(
    rollup([]),
    null,
    "a pass that observed no notification rows must write no verdict at all",
  );

  // Whatever it writes must be a member of the CHECK constraint's vocabulary.
  const allowed = new Set(["not_required", "pending", "sent", "partial", "failed"]);
  for (
    const set of [
      [{ status: "sent" }],
      [{ status: "skipped" }],
      [{ status: "failed_terminal" }],
      [{ status: "sent" }, { status: "failed_terminal" }],
    ]
  ) {
    const v = rollup(set);
    assert(
      v !== null && allowed.has(v),
      `rollup produced ${JSON.stringify(v)}, which orders_notification_status_check would reject`,
    );
  }
});

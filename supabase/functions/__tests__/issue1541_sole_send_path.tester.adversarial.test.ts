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
// PIN ADV-4 — tester finding T-1541-FOOTER-SUPPRESSION (P3).
// ===========================================================================
// The suppression guard is a substring test over the WHOLE body, so a message
// whose own CONTENT happens to contain "reply stop" silently ships with NO
// opt-out line. Post-#1541 this is reachable from user-controlled text: an
// event title, a ticket-type name, or a venue name flows into these bodies.
// Live exposure is negligible, and the fix belongs in smsAdapter.ts, which
// #1541 is forbidden to touch (#1537 collision) — so it is pinned, not fixed.
//
// WHAT WOULD CLOSE IT: anchor the guard to the END of the body
// (/reply stop to opt out\.\s*$/i) instead of testing anywhere in it.
test("ADV-4 PIN: an incidental 'reply stop' in user text suppresses the real footer (KNOWN GAP)", () => {
  const hostile =
    "Mingla: your 2 tickets for Reply Stop (the band) are confirmed. Order ABC123.";
  const composed = composeSmsBody(hostile);

  assertEquals(
    countFooters(composed),
    0,
    "PIN BROKEN (good news): the footer guard is now end-anchored, so a body " +
      "that merely mentions 'reply stop' still gets its opt-out line. " +
      "Delete this pin and close tester finding T-1541-FOOTER-SUPPRESSION.",
  );
  // Recording the consequence explicitly: this transactional SMS ships with no
  // opt-out affordance at all.
  assert(!composed.endsWith(FOOTER));
});

// ===========================================================================
// PIN ADV-5 — tester finding T-1541-WAITLIST-RELEASE-SCOPE (P2).
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
test("ADV-5 PIN: the waitlist release is scoped by entry id alone (KNOWN GAP)", async () => {
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
    false,
    "PIN BROKEN (good news): the release now carries an ownership predicate, so " +
      "a stale worker can no longer clobber a live invitation. Delete this pin " +
      "and close tester finding T-1541-WAITLIST-RELEASE-SCOPE.",
  );
});

// ===========================================================================
// PIN ADV-6 — tester finding T-1541-ROLLUP-VACUITY (P3).
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
// WHAT WOULD CLOSE IT: require a positive send —
//     outcomes.length === 0 ? <unchanged> : failed ? (sent ? "partial" : "failed")
//       : sent ? "sent" : "skipped"
test("ADV-6 PIN: an all-skipped or empty outcome set still reports 'sent' (KNOWN GAP)", async () => {
  const src = await Deno.readTextFile(
    new URL("../ticket-confirmation-dispatch/index.ts", import.meta.url),
  );

  const idx = src.indexOf("notification_status: failed");
  assert(
    idx > 0,
    "vacuity: the rollup expression was not found — this test is asserting nothing",
  );
  const expr = src.slice(idx, idx + 120);

  // The shipped shape: the ternary's else-arm is an unconditional "sent".
  assertStringIncludes(expr, 'failed ? (sent ? "partial" : "failed") : "sent"');

  // Reproduce the exact predicate and show the two dishonest cases.
  const rollup = (outcomes: Array<{ status: string }>) => {
    const failed = outcomes.some((r) => r.status.startsWith("failed"));
    const sent = outcomes.some((r) => r.status === "sent");
    return failed ? (sent ? "partial" : "failed") : "sent";
  };

  // Correct behaviours that must NOT regress (this is SC-6, re-derived).
  assertEquals(rollup([{ status: "sent" }, { status: "skipped" }]), "sent");
  assertEquals(rollup([{ status: "sent" }, { status: "failed_terminal" }]), "partial");
  assertEquals(rollup([{ status: "failed_terminal" }]), "failed");

  // The gap, pinned.
  assertEquals(
    rollup([{ status: "skipped" }, { status: "skipped" }]),
    "sent",
    "PIN BROKEN (good news): an all-skipped pass no longer reports 'sent'. " +
      "Delete this pin and close tester finding T-1541-ROLLUP-VACUITY.",
  );
  assertEquals(
    rollup([]),
    "sent",
    "PIN BROKEN (good news): an empty outcome set no longer reports 'sent'. " +
      "Delete this pin.",
  );
});

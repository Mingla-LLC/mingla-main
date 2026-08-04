// ORCH-1289 fix #3 — TESTER adversarial: STOP-footer wire↔preview PARITY.
//
// Different angle than the implementor's orch1289MmsMultiselect suite: that
// suite tests the client `bodyWithFooter` executably and only SOURCE-GREPS the
// server `composeSmsBody`. It never RUNS both together, so a future edit that
// changes one side's separator (or its idempotency/sanitize order) but not the
// other would pass the implementor's greps while the DELIVERED marketing SMS
// silently diverges from the composer PREVIEW — the exact "preview lies" class
// ORCH-1289 fix #3 exists to kill.
//
// This test EXECUTES the real server wire composer (composeSmsBody, the module
// marketing-send/index.ts actually calls with stopFooterOwnLine:true) AND the
// real client preview composer (bodyWithFooter, the module the composer +
// SmsPreviewPane render) and asserts they produce BYTE-IDENTICAL bodies for the
// marketing route across a range of reachable inputs.
//
// FAILS-ON-REVERT (dual-module): reverting EITHER side's `\n\n` back to a single
// space breaks the byte-equality in `wire == preview`. The transactional pin
// below FAILS if the default (transactional) footer is ever moved to its own
// line (an unintended wire change to every OTP/receipt SMS).
//
// Runtime ceiling: pure-function execution of both shipped modules — no Twilio,
// no browser. This is the true "delivered == previewed" guarantee, not a grep.

import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

// The SERVER wire body composer (what marketing-send/index.ts calls).
import { composeSmsBody } from "../_shared/adapters/smsAdapter.ts";
// The CLIENT preview body composer (what the composer + SmsPreviewPane render).
// smsCost.ts is a pure, import-free TS module, so it loads directly under Deno.
import { bodyWithFooter } from "../../../mingla-business/src/utils/smsCost.ts";

const STOP = "Reply STOP to opt out.";

// Reachable marketing bodies (non-empty; a plain-GSM-7 set so the wire's
// sanitizeGsm7 is a no-op and the ONLY variable under test is the STOP-line
// separator — the thing fix #3 changed). Empty body is intentionally excluded:
// the composer BLOCKS an empty send and shows the empty preview state, so the
// composeSmsBody-prepends-vs-bodyWithFooter-returns-empty divergence on "" is
// unreachable and not a contract.
const MARKETING_BODIES = [
  "Come to our summer show tonight!",
  "Lantern & Vine: 2-for-1 cocktails this Friday. Tap to reserve.",
  "New drop just landed - see it here: https://usemingla.com/m/abc123",
  "Last call: only 3 seats left for the rooftop dinner.",
  "A", // single char boundary
];

Deno.test("ORCH-1289 #3 — marketing WIRE body == composer PREVIEW body, byte-for-byte", () => {
  for (const body of MARKETING_BODIES) {
    const wire = composeSmsBody(body, true); // marketing route: own-line footer
    const preview = bodyWithFooter(body); // composer + preview pane
    assertEquals(
      wire,
      preview,
      `delivered marketing SMS must equal the preview for input: ${JSON.stringify(body)}`,
    );
    // And the STOP line must actually be on its OWN line (blank line before it).
    assert(
      wire.endsWith(`\n\n${STOP}`),
      `wire must end with a blank line + STOP line, got: ${JSON.stringify(wire)}`,
    );
    // Negative: the old single-space form must NOT be present.
    assert(
      !wire.includes(` ${STOP}`),
      `wire must not use the old single-space footer, got: ${JSON.stringify(wire)}`,
    );
  }
});

Deno.test("ORCH-1289 #3 — transactional footer is UNCHANGED (single space) — regression pin", () => {
  // Default (no stopFooterOwnLine) is the path every OTP/receipt SMS takes via
  // notifyV2. It MUST stay single-space, byte-identical to pre-ORCH-1289.
  const body = "Lantern & Vine: your table for 4 is confirmed for 7:30 PM.";
  const txnWire = composeSmsBody(body); // default false
  assertEquals(txnWire, `${body} ${STOP}`);
  // A transactional send must NOT match the own-line preview form.
  assertNotEquals(txnWire, bodyWithFooter(body));
  assert(!txnWire.includes(`\n\n${STOP}`), "transactional footer must not be on its own line");
});

// RECONCILED by issue #1556 [sms cost preview]. This test asserted the PRE-#1541
// contract — that a body containing "reply stop" ANYWHERE never gains a footer —
// using an input that MENTIONS the phrase at the START and does not end with it:
//
//   "Reply STOP to opt out. Come see us."
//
// #1541 deliberately reversed that. Its guard is now end-anchored
// (`/reply stop to opt out\.\s*$/i`), because a mid-body mention is CONTENT, not
// compliance: an event or band called "Reply Stop" was stripping the CTIA
// opt-out line off real transactional sends (#1541 ADV-4). So this body now
// correctly gains a footer at the tail, and the old `!/reply stop.*reply stop/i`
// assertion has been FAILING on main since #1541 merged — undetected, because
// this file was wired into no workflow. It is registered in
// supabase-migrations-and-stripe-deno.yml as of #1556 so it cannot go dark again.
//
// What the test asserts now is the property that actually holds and that
// ORCH-1289 fix #3 exists to protect: PARITY. Suppression fires only for a body
// that ALREADY ENDS with the footer, it fires identically on both modules, and
// the footer lands exactly once at the tail.
Deno.test("ORCH-1289 #3 — suppression is end-anchored and identical on both modules (post-#1541)", () => {
  // (a) MENTIONS the footer but does not end with it -> BOTH sides append one,
  //     at the tail, and agree byte-for-byte.
  const mentions = "Reply STOP to opt out. Come see us.";
  const wire = composeSmsBody(mentions, true);
  const preview = bodyWithFooter(mentions);
  assertEquals(wire, preview, "mention-only bodies must still match preview==wire");
  assert(wire.endsWith(`\n\n${STOP}`), "the opt-out line must land at the tail");
  assertEquals(
    wire.split(STOP).length - 1,
    2,
    "the user's own text is preserved verbatim AND the footer is appended once",
  );

  // (b) ALREADY ENDS with the footer -> BOTH sides suppress, no second footer.
  const alreadyFootered = `Come see us.\n\n${STOP}`;
  const wire2 = composeSmsBody(alreadyFootered, true);
  const preview2 = bodyWithFooter(alreadyFootered);
  assertEquals(wire2, preview2, "already-footered bodies must match preview==wire");
  assertEquals(
    wire2.split(STOP).length - 1,
    1,
    "a body that already ends with the footer must not gain a second one",
  );

  // Re-running the client composer over its own output is a fixed point.
  assertEquals(bodyWithFooter(preview), preview, "bodyWithFooter must be a fixed point");
  assertEquals(bodyWithFooter(preview2), preview2, "bodyWithFooter must be a fixed point");
});

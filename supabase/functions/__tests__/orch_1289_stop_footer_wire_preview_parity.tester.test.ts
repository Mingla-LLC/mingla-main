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

Deno.test("ORCH-1289 #3 — idempotent on both modules (no double-append; parity holds)", () => {
  // A body that already carries a STOP line must not gain a second footer on
  // EITHER module, and the two must still agree.
  const withStop = "Reply STOP to opt out. Come see us.";
  const wire = composeSmsBody(withStop, true);
  const preview = bodyWithFooter(withStop);
  assert(!/reply stop[\s\S]*reply stop/i.test(wire), "wire must not double-append STOP");
  assertEquals(wire, preview, "idempotent bodies must still match preview==wire");

  // Re-running the client composer over its own output is a fixed point.
  assertEquals(bodyWithFooter(preview), preview, "bodyWithFooter must be a fixed point");
});

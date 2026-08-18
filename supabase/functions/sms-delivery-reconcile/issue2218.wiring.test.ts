// ===========================================================================
// #2218 T-8 — THE RECONCILER'S WIRING CONTRACT.
// ===========================================================================
// index.ts calls `serve()` at module scope, so its loop cannot be imported and
// executed; the decision logic that CAN be is in ./logic.ts and is exercised by
// issue2218.reconcile.test.ts. What is left over is the wiring, and the wiring
// is where this whole class of bug lives: a sweep that selects the wrong rows,
// or forgets to tell anyone, is indistinguishable from a sweep that is working.
//
// These are source assertions, in the same style the ticket dispatcher's
// neighbouring suite uses for the same structural reason. They are deliberately
// about the PREDICATES and the ALARM, not about wording.
import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

const SOURCE = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("#2218 T-8z: the source was actually read", () => {
  assert(SOURCE.length > 3_000, "a short read would make every check below vacuous");
});

Deno.test("#2218 T-8a: it is service-role only", () => {
  assertMatch(
    SOURCE,
    /req\.headers\.get\("authorization"\) !== `Bearer \$\{serviceKey\}`/,
    "same gate notification-retry-sweeper uses; this function can flip a buyer's " +
      "notification to failed_terminal and must not be callable by anyone else",
  );
  assertStringIncludes(SOURCE, 'jsonResponse({ error: "forbidden" }, 403)');
});

Deno.test("#2218 T-8b: it selects ONLY rows that claim a send and carry no confirmation", () => {
  // Each predicate is load-bearing and each has a distinct failure mode if
  // dropped: without `status='sent'` it would terminate `deferred` rows the
  // retry sweeper still owns; without `delivered_at is null` it would re-judge
  // messages already confirmed on a handset; without the deadline it would call
  // a message undelivered before the carrier had a chance to report.
  // COUNTED, NOT MERELY PRESENT. There are TWO scans — one per ledger — and an
  // `assertMatch` for a predicate that appears twice stays green when ONE of
  // them is deleted. A check that cannot fail on the change it exists to catch
  // is the "carries no information" family, and writing one inside #2218 of all
  // issues would be its own small joke. So each shared predicate is asserted at
  // exactly 2 occurrences.
  const countOf = (re: RegExp): number => (SOURCE.match(re) ?? []).length;
  // 4: one per scan, plus the two mirror-writes the ticket pass makes into the
  // shared ledger, which key on provider_message_id + channel exactly as the
  // delivery webhooks do.
  assertEquals(countOf(/\.eq\("channel", "sms"\)/g), 4, "channel filter, every touch");
  assertEquals(
    countOf(/\.eq\("status", "sent"\)/g),
    2,
    "both ledgers must be swept: ticket_order_notifications carries buyer " +
      "confirmations and notification_deliveries carries everything notifyV2 " +
      "sends — sweeping one leaves the other able to rest at `sent` forever",
  );
  assertEquals(
    countOf(/\.is\("delivered_at", null\)/g),
    2,
    "without this on EITHER scan, the sweep re-judges messages already " +
      "confirmed on a handset",
  );
  // The deadline predicate differs per table because the two name their
  // timestamp differently, so these are one occurrence each.
  assertEquals(countOf(/\.lt\("sent_at", deadlineIso\)/g), 1);
  assertEquals(countOf(/\.lt\("attempt_at", deadlineIso\)/g), 1);
});

Deno.test("#2218 T-8c: a terminal verdict is written to BOTH tables, and named", () => {
  assertMatch(
    SOURCE,
    /status: "failed_terminal",\s*\n\s*last_error: reason,/,
    "the buyer's row must carry the REASON, not merely stop saying `sent`",
  );
  assertMatch(
    SOURCE,
    /status: "undelivered",\s*\n\s*failed_reason: reason,/,
    "the shared ledger's word for the same fact",
  );
});

Deno.test("#2218 T-8d: a human is told, once, and only when there is something to tell", () => {
  assertMatch(
    SOURCE,
    /const surfaced = failedOut \+ unreconcilable \+ ledgerTerminal;/,
  );
  assertMatch(
    SOURCE,
    /if \(surfaced > 0\) \{/,
    "a clean sweep must send NOTHING — an alarm that fires every 15 minutes " +
      "stops being read, and then the next #2218 is invisible again",
  );
  assertStringIncludes(SOURCE, 'emailTo: "ops@mingla.app"');
  assertStringIncludes(SOURCE, 'type: "sms.delivery_unconfirmed"');
  assertMatch(
    SOURCE,
    /idempotencyKey: `sms\.delivery_unconfirmed:\$\{dayKey\}:\$\{surfaced\}`/,
    "keyed per day and per shape, so a bad night is one message rather than a hundred",
  );
  assertMatch(
    SOURCE,
    /catch \(err\) \{[\s\S]{0,400}?console\.error\(\s*\n?\s*"\[sms-delivery-reconcile\] ops alert dispatch failed"/,
    "an alarm that cannot be sent must still be loud somewhere",
  );
});

Deno.test("#2218 T-8e: a lookup failure is never a delivery verdict", () => {
  // Three separate bail-outs in askTermiiHistory, all returning `pending`. Any
  // one of them returning `delivered` or `failed` instead would put a guess
  // into the ledger — which is the entire defect this function exists to end.
  const pendings = SOURCE.match(/return \{ kind: "pending" \};/g);
  assert(
    pendings !== null && pendings.length >= 4,
    `askTermiiHistory must fail to PENDING on missing config, non-2xx, an ` +
      `unmatched id and a thrown fetch; found ${pendings?.length ?? 0} pending returns`,
  );
  assertMatch(
    SOURCE,
    /if \(askable\) verdict = await askTermiiHistory\(messageId\);/,
    "only a reconcilable numeric Termii id is ever looked up — asking about " +
      "a `sig_` id would be a request that cannot succeed",
  );
});

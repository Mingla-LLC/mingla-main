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
  assertMatch(SOURCE, /\.eq\("channel", "sms"\)/);
  assertMatch(SOURCE, /\.eq\("status", "sent"\)/);
  assertMatch(SOURCE, /\.is\("delivered_at", null\)/);
  assertMatch(SOURCE, /\.lt\("sent_at", deadlineIso\)/);
  // And the same four on the shared ledger, which keys its timestamp differently.
  assertMatch(SOURCE, /\.lt\("attempt_at", deadlineIso\)/);
  const staleQueries = SOURCE.match(/\.eq\("status", "sent"\)/g);
  assert(
    staleQueries !== null && staleQueries.length === 2,
    `both ledgers must be swept; found ${staleQueries?.length ?? 0}. ` +
      "ticket_order_notifications carries buyer confirmations and " +
      "notification_deliveries carries everything notifyV2 sends — sweeping " +
      "one leaves the other able to rest at `sent` forever.",
  );
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

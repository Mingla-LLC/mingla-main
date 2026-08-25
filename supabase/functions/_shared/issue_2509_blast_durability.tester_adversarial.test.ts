/**
 * #2509 adversarial regression.
 *
 * # Adversarial angle
 * The happy-path file proves the durability machinery is PRESENT. This file
 * attacks the three ways it silently becomes a double-send or a new wedge:
 *
 *   1. RECLAIM WITHOUT HEARTBEAT. The 10-minute reclaim predicate is only safe
 *      because a live run keeps touching `updated_at`. Delete the heartbeat and
 *      the predicate starts stealing campaigns from healthy long runs — which
 *      re-sends to everyone the running pass has not yet reached.
 *   2. RESUME WITHOUT SKIP. If a resumed pass stops skipping already-reached
 *      recipients, it re-emails them. That is precisely the 189-person
 *      double-send this issue exists to prevent.
 *   3. BUDGET WITHOUT HANDBACK. Stopping on the budget but leaving the campaign
 *      at `sending` reproduces the original wedge with extra steps.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { boundedRetryAfterSeconds } from "../marketing-send/index.ts";

const SOURCE = await Deno.readTextFile(
  new URL("../marketing-send/index.ts", import.meta.url),
);
const MIGRATION = await Deno.readTextFile(
  new URL(
    "../../migrations/20270525002509_issue_2509_blast_durability.sql",
    import.meta.url,
  ),
);
const flat = SOURCE.replace(/\s+/g, " ");

Deno.test("adversarial: reclaim is paired with a heartbeat, or it steals live runs", () => {
  // Vacuity guard — both halves must exist for this pairing to mean anything.
  assertStringIncludes(MIGRATION, "mkt_heartbeat_campaign");
  assertStringIncludes(MIGRATION, "inner_mc.updated_at < now() - v_stale");
  assertStringIncludes(SOURCE, "mkt_heartbeat_campaign");
  // The heartbeat must fire INSIDE the recipient loop, not once per campaign.
  const loopStart = SOURCE.indexOf("for (const contact of resolved.rows)");
  const loopEnd = SOURCE.indexOf("writeBlastIntoEventChat", loopStart);
  assert(loopStart > -1 && loopEnd > loopStart);
  assertStringIncludes(
    SOURCE.slice(loopStart, loopEnd),
    "mkt_heartbeat_campaign",
  );
});

Deno.test("adversarial: the stale window is wider than the runtime's own ceiling", () => {
  // Both 2026-08-24 runs died at ~196s. A window at or below that would let a
  // merely-slow pass be reclaimed while it is still sending.
  const m = /interval '(\d+) minutes'/.exec(MIGRATION);
  assert(m !== null, "stale window must be declared as a minutes interval");
  assert(Number(m[1]) >= 5, `stale window ${m[1]}m is too tight to be safe`);
});

Deno.test("adversarial: a resumed pass cannot re-email a reached recipient", () => {
  assertStringIncludes(flat, "RESUME_TERMINAL_STATUSES");
  // The skip must be a `continue` guarding the loop body, not advisory.
  assertStringIncludes(
    flat,
    "alreadyHandled.has(contact.raw_email.toLowerCase()) ) continue;",
  );
  // And `sent` must be in the terminal set, or the skip covers nothing.
  const setStart = SOURCE.indexOf("RESUME_TERMINAL_STATUSES = new Set");
  const setBody = SOURCE.slice(setStart, SOURCE.indexOf("]", setStart));
  for (const status of ["sent", "delivered", "clicked", "bounced", "failed"]) {
    assertStringIncludes(setBody, `"${status}"`);
  }
});

Deno.test("adversarial: queued and deferred are NOT terminal, or resume does nothing", () => {
  const setStart = SOURCE.indexOf("RESUME_TERMINAL_STATUSES = new Set");
  const setBody = SOURCE.slice(setStart, SOURCE.indexOf("]", setStart));
  assert(!setBody.includes('"queued"'), "queued must remain resumable");
  assert(!setBody.includes('"deferred"'), "deferred must remain resumable");
});

Deno.test("adversarial: a budget stop hands the campaign back, never leaves it sending", () => {
  const idx = SOURCE.indexOf("if (budgetExhausted)");
  assert(idx > -1, "budget handback block must exist");
  const block = SOURCE.slice(idx, idx + 400);
  assertStringIncludes(block, 'status: "scheduled"');
  assert(!block.includes('status: "sending"'), "must not re-wedge");
});

Deno.test("adversarial: a resumed recipient reuses its row instead of inserting a second", () => {
  // A second INSERT for the same (campaign, email) is the double-send, and the
  // new unique index would now reject it — turning a silent duplicate into a
  // thrown campaign. Reuse is what keeps the resume working at all.
  assertStringIncludes(
    flat,
    "const messageId = priorRow?.id ?? crypto.randomUUID();",
  );
  assertStringIncludes(flat, "if (priorRow === undefined) {");
});

Deno.test("adversarial: a quota 429 does not burn the run's whole budget", () => {
  // Campaign 8a54fc7c spent 180s of a ~196s budget retrying a quota that could
  // not clear, and sent zero emails. A quota must return immediately.
  assertStringIncludes(flat, 'if (kind !== "rate_limit") {');
  const idx = flat.indexOf('if (kind !== "rate_limit") {');
  assertStringIncludes(flat.slice(idx, idx + 260), "retryable: true");
});

Deno.test("adversarial: retry-after bounds hold at every edge", () => {
  assertEquals(boundedRetryAfterSeconds(""), null);
  assertEquals(boundedRetryAfterSeconds("NaN"), null);
  assertEquals(boundedRetryAfterSeconds("1e9"), 21_600);
  assertEquals(boundedRetryAfterSeconds("1"), 1);
  // Never returns 0 — a zero wait is a busy loop against a provider.
  for (const raw of ["0", "0.0", "0.1"]) {
    const v = boundedRetryAfterSeconds(raw);
    assert(v === null || v >= 1, `${raw} produced ${v}`);
  }
});

Deno.test("adversarial: both channels are constrained, not just email", () => {
  // An SMS blast wedges and replays exactly the same way.
  assertStringIncludes(MIGRATION, "issue_2509_one_sms_row_per_campaign");
  assertStringIncludes(MIGRATION, "channel = 'sms'");
});

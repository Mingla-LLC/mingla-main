/**
 * #2509 happy-path regression — a blast that is interrupted must finish.
 *
 * On 2026-08-24 two `We Go Again` campaigns died mid-send and wedged at
 * `status='sending'` forever: 21 recipients burned, 2 never attempted, no path
 * back for any of them. Both runs terminated at ~196s — the runtime killing the
 * isolate, not the work completing.
 *
 * FAILS ON REVERT: drop `boundedRetryAfterSeconds` or the retryable flag and
 * the classification assertions below go red.
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

Deno.test("#2509 retry-after is honoured, not ignored", () => {
  assertEquals(boundedRetryAfterSeconds("30"), 30);
  assertEquals(boundedRetryAfterSeconds(" 12 "), 12);
  assertEquals(boundedRetryAfterSeconds("0.4"), 1, "sub-second rounds up to 1");
});

Deno.test("#2509 a hostile retry-after cannot park a campaign forever", () => {
  // 6h ceiling: an event being advertised must not be out-waited by a header.
  assertEquals(boundedRetryAfterSeconds("999999"), 21_600);
  assertEquals(boundedRetryAfterSeconds("0"), 1, "zero cannot busy-loop");
});

Deno.test("#2509 a missing or junk retry-after yields null, not a crash", () => {
  assertEquals(boundedRetryAfterSeconds(null), null);
  assertEquals(boundedRetryAfterSeconds("soon"), null);
  assertEquals(boundedRetryAfterSeconds("-5"), null);
});

Deno.test("#2509 a 429 is classified, not blanket-labelled rate-limited", () => {
  // The old label pointed every reader at the wrong cause: on 2026-08-24 the
  // real reason was the free plan's 100/day cap, at a send rate of 1.9/s
  // against a documented 10 req/s allowance.
  assertStringIncludes(SOURCE, "daily_quota_exceeded");
  assertStringIncludes(SOURCE, "monthly_quota_exceeded");
  assertStringIncludes(SOURCE, "x-resend-daily-quota");
  assertStringIncludes(SOURCE, "resend_429:");
  assert(
    !SOURCE.includes('lastError = "resend_rate_limited";'),
    "the blanket label must be gone",
  );
});

Deno.test("#2509 a rate-limited recipient is DEFERRED, never burned", () => {
  assertStringIncludes(SOURCE, 'status: "deferred"');
  assertStringIncludes(SOURCE, "next_attempt_at: new Date(Date.now()");
  assertStringIncludes(SOURCE, "attempt_count: priorAttempts + 1");
});

Deno.test("#2509 a pass stops on its own budget and hands the campaign back", () => {
  assertStringIncludes(SOURCE, "SEND_BUDGET_MS");
  assertStringIncludes(SOURCE, "budgetExhausted = true");
  // Handed back as `scheduled` so the every-minute cron resumes it in <60s.
  assertStringIncludes(SOURCE, 'status: "scheduled"');
});

Deno.test("#2509 a resumed pass skips recipients already reached", () => {
  assertStringIncludes(SOURCE, "RESUME_TERMINAL_STATUSES");
  assertStringIncludes(SOURCE, "alreadyHandled");
  assertStringIncludes(SOURCE, "reusable.get");
});

Deno.test("#2509 the dispatcher heartbeats so a live run is not reclaimed", () => {
  assertStringIncludes(SOURCE, "mkt_heartbeat_campaign");
  assertStringIncludes(SOURCE, "HEARTBEAT_EVERY");
});

Deno.test("#2509 uniqueness is real now, not just claimed in a comment", () => {
  assertStringIncludes(MIGRATION, "issue_2509_one_email_row_per_campaign");
  assertStringIncludes(MIGRATION, "issue_2509_one_sms_row_per_campaign");
  assertStringIncludes(MIGRATION, "CREATE UNIQUE INDEX");
  // The false claim must not survive UNQUALIFIED.
  //
  // The first cut of this assertion searched for the sentence as one line and
  // passed vacuously — the comment is wrapped across two lines, so the needle
  // could never match and the check carried no information either way. Exactly
  // the class catalogued in `feedback_unfalsifiable_test_bug_class.md`.
  // Collapse whitespace first, then require the claim to appear only alongside
  // the index that finally makes it true.
  const flat = SOURCE.replace(/\s+/g, " ");
  // Anchor on the durable phrase, not on tense or line wrapping — the first
  // cut of this check broke the moment the comment was reworded.
  assert(
    flat.includes("provider-idempotent"),
    "vacuity guard: the claim must be findable, or this test proves nothing",
  );
  assertStringIncludes(flat, "THAT WAS NOT TRUE");
  assertStringIncludes(flat, "issue_2509_one_email_row_per_campaign");
});

Deno.test("#2509 a stalled campaign becomes claimable again", () => {
  assertStringIncludes(MIGRATION, "inner_mc.status = 'sending'");
  assertStringIncludes(MIGRATION, "inner_mc.updated_at < now() - v_stale");
  assertStringIncludes(MIGRATION, "FOR UPDATE SKIP LOCKED");
});

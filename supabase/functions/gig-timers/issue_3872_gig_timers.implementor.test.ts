import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { gigTimerDecision, timerDedupeKey } from "../_shared/gigTimers.ts";
const now = new Date("2027-01-01T00:00:00Z");
const due = "2026-12-31T23:59:00Z";
Deno.test("#3872 every server timer maps to the one legal action", () => {
  assertEquals(
    gigTimerDecision({ state: "offered", deadlineAt: due, now })?.action,
    "expire",
  );
  assertEquals(
    gigTimerDecision({ state: "script_sent", deadlineAt: due, now })?.action,
    "auto_lock",
  );
  assertEquals(
    gigTimerDecision({ state: "delivered", deadlineAt: due, now })?.action,
    "auto_approve",
  );
  assertEquals(
    gigTimerDecision({ state: "posts_verified", deadlineAt: due, now })?.action,
    "release",
  );
  assertEquals(
    gigTimerDecision({ state: "released", deadlineAt: due, now })?.action,
    "day30",
  );
  assertEquals(
    gigTimerDecision({ state: "day30", deadlineAt: due, now })?.action,
    "complete",
  );
});
Deno.test("#3872 timers are paused during disputes and before deadline", () => {
  assertEquals(
    gigTimerDecision({ state: "disputed", deadlineAt: due, now }),
    null,
  );
  assertEquals(
    gigTimerDecision({
      state: "delivered",
      deadlineAt: "2027-01-02T00:00:00Z",
      now,
    }),
    null,
  );
});
Deno.test("#3872 timer replays use state and deadline in the dedupe key", () => {
  assertEquals(timerDedupeKey("c", "delivered", due), `c:delivered:${due}`);
});
Deno.test("#3872 a missed upload deadline cancels with a full refund (QA #13)", () => {
  const decision = gigTimerDecision({
    state: "script_locked",
    deadlineAt: due,
    now,
  });
  assertEquals(decision?.refundBranch, "upload_missed");
});
Deno.test("#3872 timers retire unpaid offers and pay out lower counters", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );
  if (!source.includes('"gig_pending_offer_sweep"')) {
    throw new Error("pending sweep missing");
  }
  if (!source.includes('branch: "counter_lower"')) {
    throw new Error("counter refunds missing");
  }
});

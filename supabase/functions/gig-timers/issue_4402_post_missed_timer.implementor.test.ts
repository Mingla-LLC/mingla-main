// #4402: posting deadline. An approved video that is not posted by the post
// deadline is cancelled with a full host refund through gig-refund
// (branch post_missed). posts_submitted never has a timer: Admin reviews it.
//
// MINGLA-INVARIANT: I-4402-POST-2 | issue #4402 | approved/posting/posts_failed map to the post_missed refund; posts_submitted has no timer action
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { gigTimerDecision } from "../_shared/gigTimers.ts";
import { gigRefund } from "../_shared/gigMoney.ts";

const now = new Date("2027-01-01T00:00:00Z");
const due = "2026-12-31T23:59:00Z";

Deno.test("#4402 approved, posting and posts_failed past the deadline refund as post_missed", () => {
  for (const state of ["approved", "posting", "posts_failed"]) {
    const decision = gigTimerDecision({ state, deadlineAt: due, now });
    assertEquals(decision?.action, "cancel_missed_post", state);
    assertEquals(decision?.refundBranch, "post_missed", state);
    assertEquals(decision?.analytics, "gig_post_missed", state);
  }
});

Deno.test("#4402 the posting states wait until the deadline", () => {
  for (const state of ["approved", "posting", "posts_failed"]) {
    assertEquals(
      gigTimerDecision({ state, deadlineAt: "2027-01-02T00:00:00Z", now }),
      null,
    );
  }
});

Deno.test("#4402 posts_submitted has no timer (Admin review queue owns it)", () => {
  assertEquals(
    gigTimerDecision({ state: "posts_submitted", deadlineAt: due, now }),
    null,
  );
});

Deno.test("#4402 post_missed refunds the host in full and pays the creator nothing (OQ-2)", () => {
  assertEquals(
    gigRefund({
      branch: "post_missed",
      feeMinor: 500000,
      bookingFeeMinor: 75000,
    }),
    { hostRefundMinor: 575000, creatorFeeMinor: 0 },
  );
});

Deno.test("#4402 gig-refund accepts post_missed only as a timer branch", async () => {
  const source = await Deno.readTextFile(
    new URL("../gig-refund/handler.ts", import.meta.url),
  );
  const machine = source.slice(source.indexOf("const machineBranches"));
  const user = source.slice(
    source.indexOf("const userBranches"),
    source.indexOf("const machineBranches"),
  );
  assert(machine.slice(0, machine.indexOf("]);")).includes('"post_missed"'));
  assert(!user.includes('"post_missed"'));
});

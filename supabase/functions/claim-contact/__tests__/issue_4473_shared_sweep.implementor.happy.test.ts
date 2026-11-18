import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  runPurchaseClaimSweep,
  type SweepRpc,
} from "../../_shared/purchaseClaimSweep.ts";

// MINGLA-INVARIANT: I-4473-SWEEP-SHARES-AFTER-CLAIMING | issue #4473 | After a contact is proved, unowned purchases attach first, sent tickets second, and purchases another account owns are shared last; only shared entries carry sharedWithAnotherAccount=true.

const USER_ID = "44730000-0000-4000-8000-0000000000aa";

function rpcWith(
  overrides: Record<string, { data: unknown; error: { message?: string } | null }>,
  calls: string[],
): SweepRpc {
  return (name) => {
    calls.push(name);
    if (name in overrides) return Promise.resolve(overrides[name]);
    if (name === "begin_attendance_claim_attempt") {
      return Promise.resolve({ data: { allowed: true }, error: null });
    }
    return Promise.resolve({ data: { claimed: [], more: false }, error: null });
  };
}

Deno.test("#4473 sweep order and shared flags", async () => {
  const calls: string[] = [];
  const outcome = await runPurchaseClaimSweep(
    rpcWith({
      claim_attendance_by_verified_identity: {
        data: { claimed: [{ kind: "rsvp", id: "r1" }], more: false },
        error: null,
      },
      issue_4063_claim_offered_tickets: {
        data: { claimed: [{ kind: "ticket", id: "t1" }], more: false },
        error: null,
      },
      issue_4473_share_purchases_by_verified_identity: {
        data: { claimed: [{ kind: "venue_order", id: "v1" }], more: true },
        error: null,
      },
    }, calls),
    USER_ID,
    "pepper",
  );
  assertEquals(calls, [
    "begin_attendance_claim_attempt",
    "claim_attendance_by_verified_identity",
    "issue_4063_claim_offered_tickets",
    "issue_4473_share_purchases_by_verified_identity",
  ]);
  assertEquals(outcome.result?.count, 3);
  assertEquals(outcome.result?.more, true);
  assertEquals(outcome.result?.claimed, [
    { kind: "rsvp", id: "r1", sharedWithAnotherAccount: false },
    { kind: "ticket", id: "t1", sharedWithAnotherAccount: false },
    { kind: "venue_order", id: "v1", sharedWithAnotherAccount: true },
  ]);
});

Deno.test("#4473 a failed share pass fails the sweep instead of hiding it", async () => {
  const outcome = await runPurchaseClaimSweep(
    rpcWith({
      issue_4473_share_purchases_by_verified_identity: {
        data: null,
        error: { message: "boom" },
      },
    }, []),
    USER_ID,
    "pepper",
  );
  assertEquals(outcome, { result: null, limited: false });
});

Deno.test("#4473 an exhausted sweep budget runs nothing", async () => {
  const calls: string[] = [];
  const outcome = await runPurchaseClaimSweep(
    rpcWith({
      begin_attendance_claim_attempt: { data: { allowed: false }, error: null },
    }, calls),
    USER_ID,
    "pepper",
  );
  assertEquals(outcome, { result: null, limited: true });
  assertEquals(calls, ["begin_attendance_claim_attempt"]);
});

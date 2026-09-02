const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
const migration = await Deno.readTextFile(
  new URL(
    "../../../migrations/20270614002987_issue_2979_attendance_claim_secret_continuity.sql",
    import.meta.url,
  ),
);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sliceBetween(
  text: string,
  startToken: string,
  endToken: string,
): string {
  const start = text.indexOf(startToken);
  const end = text.indexOf(endToken, start + startToken.length);
  assert(start >= 0 && end > start, `missing boundary: ${startToken}`);
  return text.slice(start, end);
}

Deno.test("#2979 tester: recovery cannot widen, hardcode the snapshot, or bypass governed delivery", () => {
  const recovery = sliceBetween(
    source,
    'body.mode === "issue_2979_recovery"',
    "const rsvpPepper",
  );
  assert(
    !recovery.includes("enqueue_attendance_claim_deliveries"),
    "recovery entered the broad backfill",
  );
  assert(
    !/\b235\b|\b244\b|\b249\b/.test(recovery),
    "live counts were hardcoded",
  );
  assert(
    source.includes('current.generation !== "governed_v2"') &&
      recovery.includes("runIssue2979RecoveryWhenGoverned"),
    "recovery can mint a legacy replacement",
  );
  assert(
    recovery.includes("retryOnNetworkAmbiguity: false"),
    "recovery email can retry an ambiguous provider call",
  );
  assert(
    recovery.includes("smsAdapter.send({"),
    "SMS fallback bypasses the shared adapter",
  );
  assert(
    !/api\.twilio\.com|api\.termii\.com/.test(recovery),
    "raw SMS provider egress found",
  );
});

Deno.test("#2979 tester: provider completion cannot resurrect a claimed item", () => {
  const completion = sliceBetween(
    migration,
    "CREATE OR REPLACE FUNCTION public.complete_issue_2979_attendance_claim_delivery(",
    "CREATE OR REPLACE FUNCTION public.finalize_issue_2979_attendance_claim_recovery(",
  );
  const deliverySafeWrite = completion.indexOf("SET state = 'delivery_safe'");
  const claimedGuard = completion.indexOf("state = 'claimed'");
  const safeUpdateStart = completion.lastIndexOf(
    "UPDATE public.attendance_claim_recovery_items",
    deliverySafeWrite,
  );
  const safeUpdateEnd = completion.indexOf(";", deliverySafeWrite);
  const safeUpdate = completion.slice(safeUpdateStart, safeUpdateEnd + 1);
  assert(deliverySafeWrite >= 0, "delivery-safe transition missing");
  assert(
    claimedGuard >= 0 && claimedGuard < deliverySafeWrite,
    "provider completion can overwrite the terminal claimed state",
  );
  assert(
    !/WHERE order_id = p_order_id\s*;/.test(safeUpdate),
    "delivery-safe update is unconditional on the current recovery state",
  );
});

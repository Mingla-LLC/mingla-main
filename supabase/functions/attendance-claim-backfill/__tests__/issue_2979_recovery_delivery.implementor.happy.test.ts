const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("#2979 recovery drains only its exact ledger with governed proofs", () => {
  const start = source.indexOf('body.mode === "issue_2979_recovery"');
  const end = source.indexOf("const orderPepper", start);
  const recovery = source.slice(start, end);
  assert(start > 0 && end > start, "explicit recovery branch");
  assert(
    recovery.includes("claim_issue_2979_attendance_claim_recovery_batch"),
    "exact batch",
  );
  assert(
    recovery.includes("preview_issue_2979_attendance_claim_recovery"),
    "legacy continuity preflight",
  );
  assert(
    recovery.includes("recovery_temporarily_unavailable"),
    "missing legacy reader fails closed",
  );
  assert(
    !recovery.includes("enqueue_attendance_claim_deliveries"),
    "no broad enqueue",
  );
  assert(
    recovery.includes("issue_order_attendance_claim_proof_v2"),
    "governed issuance",
  );
  assert(
    recovery.includes("pepperRing.current.generation"),
    "generation label",
  );
  assert(
    recovery.includes("complete_issue_2979_attendance_claim_delivery"),
    "monotonic completion",
  );
  assert(
    recovery.includes("mark_issue_2979_attendance_claim_provider_attempt"),
    "durable provider boundary",
  );
  assert(
    recovery.includes("beforeProviderIo"),
    "mark runs before provider I/O",
  );
});

Deno.test("#2979 secondary delivery uses the approved copy and adapter", () => {
  assert(source.includes("smsAdapter.send({"), "shared SMS adapter");
  assert(
    source.includes(
      '"Your tickets are confirmed. You can open the app and sign in with your "',
    ),
    "approved sentence",
  );
  assert(
    source.includes("checkout email or phone. ${claimWebUrl}"),
    "approved ending and same link",
  );
});

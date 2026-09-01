const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("#2979 confirmation issuance is ownership-strict and governed", () => {
  const fetchStart = source.indexOf("const { data: orderRaw");
  const fetchEnd = source.indexOf(".maybeSingle();", fetchStart);
  const liveOrderFetch = source.slice(fetchStart, fetchEnd);
  assert(fetchStart > 0 && fetchEnd > fetchStart, "live order fetch exists");
  assert(
    liveOrderFetch.includes("buyer_user_id,"),
    "live order fetch selects owner",
  );
  assert(source.includes("resolveAttendanceClaimPepperRing()"), "ring reader");
  assert(
    source.includes('"issue_order_attendance_claim_proof_v2"'),
    "v2 issuance",
  );
  assert(
    source.includes("p_generation: pepperRing.current.generation"),
    "label",
  );
  assert(source.includes("p_allow_retry_rotation: false"), "replay safe");
});

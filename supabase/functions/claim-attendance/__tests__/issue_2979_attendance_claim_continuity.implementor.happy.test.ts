const source = await Deno.readTextFile(
  new URL("../index.ts", import.meta.url),
);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("#2979 order claims derive two candidates and use one locked RPC", () => {
  assert(source.includes("resolveAttendanceClaimPepperRing()"), "ring reader");
  assert(source.includes("pepperRing.current.secret"), "current candidate");
  assert(source.includes("pepperRing.previous.secret"), "legacy candidate");
  assert(
    source.includes('admin.rpc("claim_attendance_internal_v2"'),
    "v2 claim RPC",
  );
  assert(
    (source.match(/claim_attendance_internal_v2/g) ?? []).length === 1,
    "one claim decision call",
  );
  assert(source.includes("p_current_proof_digest"), "current digest argument");
  assert(source.includes("p_legacy_proof_digest"), "legacy digest argument");
  assert(
    source.includes("legacyProof = proof"),
    "legacy-only mode supplies its sole verifier",
  );
  assert(
    source.includes("claim_temporarily_unavailable"),
    "missing previous reader fails closed while legacy remains",
  );
});

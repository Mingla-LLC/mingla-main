import { resolveAttendanceClaimPepperRing } from "../governedAdSecret.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("#2979 resolves the three approved attendance pepper ring states", () => {
  const legacyOnly = resolveAttendanceClaimPepperRing((name) =>
    name === "ATTENDANCE_CLAIM_PEPPER" ? "direct-value" : undefined
  );
  assert(legacyOnly?.current.generation === "legacy_v1", "legacy is current");
  assert(legacyOnly.previous === null, "legacy-only has no previous slot");

  const dual = resolveAttendanceClaimPepperRing((name) =>
    name === "AD_CONVERSION_TOKENS"
      ? JSON.stringify({ ATTENDANCE_CLAIM_PEPPER: "bundle-value" })
      : name === "ATTENDANCE_CLAIM_PEPPER"
      ? "direct-value"
      : undefined
  );
  assert(dual?.current.generation === "governed_v2", "bundle is current");
  assert(dual.previous?.generation === "legacy_v1", "direct is previous");

  const governedOnly = resolveAttendanceClaimPepperRing((name) =>
    name === "AD_CONVERSION_TOKENS"
      ? JSON.stringify({ ATTENDANCE_CLAIM_PEPPER: "bundle-value" })
      : undefined
  );
  assert(
    governedOnly?.current.generation === "governed_v2",
    "bundle-only remains current",
  );
  assert(governedOnly.previous === null, "bundle-only has no previous slot");
});

Deno.test("#2979 fails closed when neither approved source exists", () => {
  assert(
    resolveAttendanceClaimPepperRing(() => undefined) === undefined,
    "missing ring must not invent a secret",
  );
});

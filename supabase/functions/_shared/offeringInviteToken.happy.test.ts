import {
  deriveOfferingInviteToken,
  hashOfferingInviteToken,
  OfferingInviteTokenPepperError,
  parseOfferingInviteTokenPepper,
  pepperReadiness,
} from "./offeringInviteToken.ts";

Deno.test("issue #1770 derives opaque HMAC-only invite tokens and reports value-blind readiness", async () => {
  const pepper = await parseOfferingInviteTokenPepper("ab".repeat(32));
  const first = await deriveOfferingInviteToken(pepper, {
    tokenId: "00000000-0000-4000-8000-000000000011",
    inviteId: "00000000-0000-4000-8000-000000000012",
    deliveryAttemptId: "00000000-0000-4000-8000-000000000013",
  });
  const second = await hashOfferingInviteToken(first.opaqueToken, pepper.bytes);
  if (first.opaqueToken === first.tokenHash) {
    throw new Error("raw token was persisted as its hash");
  }
  if (!/^[0-9a-f]{64}$/.test(first.tokenHash)) {
    throw new Error("HMAC shape drifted");
  }
  if (second !== first.tokenHash) {
    throw new Error("HMAC validation is not idempotent");
  }
  const readiness = pepperReadiness(pepper);
  if (
    !readiness.configured || readiness.format !== "hex" ||
    !readiness.minBytesSatisfied
  ) {
    throw new Error("redacted readiness contract drifted");
  }
});

Deno.test("issue #1770 pepper parser fails closed without exposing secret material", async () => {
  for (const value of [undefined, "", "short", "%".repeat(64)]) {
    let failed = false;
    try {
      await parseOfferingInviteTokenPepper(value);
    } catch (error) {
      failed = error instanceof OfferingInviteTokenPepperError &&
        error.message === "offering_invite_token_pepper_unavailable";
    }
    if (!failed) throw new Error("malformed pepper did not fail closed");
  }
});

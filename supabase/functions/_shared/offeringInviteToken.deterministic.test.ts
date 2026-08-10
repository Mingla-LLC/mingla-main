import {
  constantTimeTokenHashEquals,
  deriveOfferingInviteToken,
  offeringInviteDeriveInput,
  offeringInviteLookupInput,
  parseOfferingInviteTokenPepper,
} from "./offeringInviteToken.ts";

const context = {
  tokenId: "00000000-0000-4000-8000-000000000001",
  inviteId: "00000000-0000-4000-8000-000000000002",
  deliveryAttemptId: "00000000-0000-4000-8000-000000000003",
};

Deno.test("issue #1770 exact cross-runtime deterministic token vector", async () => {
  // [TEST-MOD-APPROVED #1770] Generate the public 00..1f byte sequence so the
  // deterministic fixture cannot be mistaken for a stored credential.
  const syntheticPepperHex = Array.from(
    { length: 32 },
    (_, byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const pepper = await parseOfferingInviteTokenPepper(syntheticPepperHex);
  const deriveInput = offeringInviteDeriveInput(context);
  const result = await deriveOfferingInviteToken(pepper, context);
  const lookupInput = offeringInviteLookupInput(result.opaqueToken);
  if (deriveInput.byteLength !== 143 || lookupInput.byteLength !== 76) {
    throw new Error("domain-separated input length drifted");
  }
  const zeroPositions = Array.from(deriveInput.entries()).flatMap(
    ([index, value]) => value === 0 ? [index] : [],
  );
  if (zeroPositions.join(",") !== "32,69,106") {
    throw new Error(`derive separator positions drifted: ${zeroPositions}`);
  }
  if (lookupInput[32] !== 0 || lookupInput.at(-1) === 0) {
    throw new Error("lookup separator drifted");
  }
  if (result.opaqueToken !== "V9W0SvIlbJH8zEZdGQORC9LXwP14LpxsIhq5CG8xIDw") {
    throw new Error("opaque token vector drifted");
  }
  const expected =
    "eeba954e4b6ddd70398092199f2161cec470c078ebff4e11f72530efff8241bc";
  if (!constantTimeTokenHashEquals(expected, result.tokenHash)) {
    throw new Error("lookup hash vector drifted");
  }
});

Deno.test("issue #1770 token construction rejects noncanonical contexts", async () => {
  const pepper = await parseOfferingInviteTokenPepper("ab".repeat(32));
  for (
    const changed of [
      { ...context, tokenId: "00000000-0000-4000-8000-00000000000A" },
      { ...context, inviteId: context.inviteId.replaceAll("-", "") },
      { ...context, deliveryAttemptId: `${context.deliveryAttemptId}\\0` },
    ]
  ) {
    await deriveOfferingInviteToken(pepper, changed).then(
      () => {
        throw new Error("noncanonical token context was accepted");
      },
      (error) => {
        if (error.message !== "offering_invite_token_context_invalid") {
          throw error;
        }
      },
    );
  }
  if (constantTimeTokenHashEquals("A".repeat(64), "a".repeat(64))) {
    throw new Error("noncanonical hash compared equal");
  }
});

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("issue #1770 marketing send injects tokens only at provider point-of-no-return", () => {
  for (
    const required of [
      '"biz_prepare_offering_invite_delivery"',
      '"biz_claim_offering_invite_provider_io"',
      "deriveOfferingInviteToken",
      "constantTimeTokenHashEquals",
      "beforeProviderIo",
      "provider_outcome_unknown",
      "__MINGLA_OFFERING_INVITE_URL_V1__",
      "replaceSingleMarker",
    ]
  ) {
    if (!source.includes(required)) {
      throw new Error(`missing JIT delivery boundary: ${required}`);
    }
  }
  if (
    source.indexOf("prepareOfferingLink(") >
      source.lastIndexOf("claimOfferingProviderIo(")
  ) {
    throw new Error("provider claim precedes deterministic token preparation");
  }
  for (
    const forbidden of ["opaqueToken:", ".insert({ token_hash", "console.log("]
  ) {
    if (source.includes(forbidden)) {
      throw new Error(`token persistence/logging seam detected: ${forbidden}`);
    }
  }
});

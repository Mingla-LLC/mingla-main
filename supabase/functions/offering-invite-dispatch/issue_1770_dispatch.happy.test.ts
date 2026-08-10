import { handler } from "./index.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("issue #1770 preview is provider-dark and confirm reuses shared send owners", () => {
  const previewIndex = source.indexOf('if (body.mode === "preview")');
  const marketingSendIndex = source.indexOf("/functions/v1/marketing-send");
  const pushIndex = source.indexOf("dispatchV2(service");
  if (
    previewIndex < 0 || marketingSendIndex < 0 || pushIndex < 0 ||
    previewIndex > marketingSendIndex || previewIndex > pushIndex
  ) {
    throw new Error("preview/provider-owner ordering drifted");
  }
  for (
    const forbidden of [
      "api.resend.com",
      "api.twilio.com",
      "api.termii.com",
      "onesignal.com/api",
    ]
  ) {
    if (source.includes(forbidden)) {
      throw new Error(`direct provider call forbidden: ${forbidden}`);
    }
  }
  for (
    const token of [
      "resolveOfferingInviteTokenPepper",
      "OfferingInviteTokenPepperError",
      '"biz_offering_send_quote_candidates"',
      '"biz_seal_offering_execution_snapshot"',
      '"biz_execute_offering_send_group"',
      '"biz_preflight_offering_push_provider_io"',
      "persisted_offering_push: claimed.pushPayload",
      "internal_provider_claim_key: claimed.internalProviderClaimKey",
      "onesignal_idempotency_key: claimed.oneSignalIdempotencyKey",
      'error: "group_status_persistence_unproven"',
      "authoritativeStatus",
      "p_actor_id: actorId",
      'category_key: "offering_invitation"',
    ]
  ) {
    if (!source.includes(token)) {
      throw new Error(`missing token readiness boundary: ${token}`);
    }
  }
  if (source.includes("quoted.snapshot.campaigns.push")) {
    throw new Error("push dispatch read transient quote instead of DB claim");
  }
  if (
    source.includes("if (claimError) continue") ||
    !source.includes("if (preflightError || !preflightData)") ||
    !source.includes("if (!result.success)")
  ) {
    throw new Error("dispatch failure persistence became silent");
  }
  for (const spoofed of ['"actorId"', '"createdBy"', '"requestedBy"']) {
    if (source.includes(spoofed)) {
      throw new Error(
        `spoofed actor field entered request allowlist: ${spoofed}`,
      );
    }
  }
});

// [TEST-MOD-APPROVED #1770] Exercise the actual handler because a browser
// preflight fails before auth when x-client-info is absent from this response.
Deno.test("issue #1770 dispatch browser preflight allows Supabase client headers", async () => {
  const response = await handler(
    new Request("https://edge.test/offering-invite-dispatch", {
      method: "OPTIONS",
    }),
  );
  if (response.status !== 200) {
    throw new Error("OPTIONS preflight did not succeed");
  }
  const allowed = response.headers.get("Access-Control-Allow-Headers") ?? "";
  if (!allowed.includes("x-client-info")) {
    throw new Error("Supabase browser x-client-info header was rejected");
  }
  const methods = response.headers.get("Access-Control-Allow-Methods") ?? "";
  if (!methods.includes("POST")) {
    throw new Error("dispatch preflight omitted POST");
  }
  if (response.headers.get("Cache-Control") !== "no-store") {
    throw new Error("preflight lost no-store policy");
  }
});

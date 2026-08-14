// @ts-nocheck
// ORCH-1318 [appsflyer-onelink-deferred-deeplinking] — buildReferralLink
// regression (SPEC §E.6). oneLinkShare.ts has NO top-level native import (it
// lazily + defensively requires the SDK), so its full contract runs headless
// under Deno with a MOCKED generateInviteLink injected via the test seam.
//
// Run:
//   deno test --no-check app-mobile/src/services/__tests__/oneLinkShare.orch1318.test.ts
//
// FAILS-ON-REVERT: if buildReferralLink stops passing deep_link_value /
// deep_link_sub1 / deep_link_sub2 / af_sub1 into generateInviteLink, or stops
// returning the SDK URL, the capture assertions fail. If the error/absent
// fallback is removed, the non-empty install-capable assertions fail.
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  buildReferralLink,
  buildInviteUserParams,
  buildFallbackShareUrl,
  __setInviteSdkForTest,
  ONELINK_BRAND_DOMAIN,
} from "../oneLinkShare.ts";

// ── §E.6 primary: passes the §B.1 payload into a mocked generateInviteLink ────
Deno.test("ORCH-1318 buildReferralLink passes deep_link_value/sub1/sub2/af_sub1 + brandDomain into generateInviteLink and returns its URL", async () => {
  let captured: any = null;
  __setInviteSdkForTest({
    generateInviteLink: (params: any, ok: (r?: unknown) => unknown) => {
      captured = params;
      ok("https://go.usemingla.com/abc123");
    },
  });

  const url = await buildReferralLink({
    channel: "copy_link",
    entity: { type: "event", brandSlug: "sunset-collective", entitySlug: "rooftop-nye" },
    referralCode: "SETH-8Q2",
  });

  assertEquals(url, "https://go.usemingla.com/abc123");
  assert(captured, "generateInviteLink must have been called");
  assertEquals(captured.channel, "copy_link");
  assertEquals(captured.campaign, "referral");
  assertEquals(captured.brandDomain, ONELINK_BRAND_DOMAIN); // 'go.usemingla.com'
  assertEquals(captured.userParams.deep_link_value, "event");
  assertEquals(captured.userParams.deep_link_sub1, "sunset-collective");
  assertEquals(captured.userParams.deep_link_sub2, "rooftop-nye");
  assertEquals(captured.userParams.af_sub1, "SETH-8Q2");
});

// ── §E.6 adversarial: errorC fires → non-empty install-capable fallback ───────
Deno.test("ORCH-1318 buildReferralLink returns a non-empty install-capable URL when generateInviteLink errorCB fires (never a dead clipboard)", async () => {
  __setInviteSdkForTest({
    generateInviteLink: (_params: any, _ok: unknown, err: (e?: unknown) => unknown) => {
      err(new Error("simulated SDK failure"));
    },
  });

  const url = await buildReferralLink({
    channel: "whatsapp",
    entity: { type: "trip", brandSlug: "b", entitySlug: "e" },
    referralCode: "C",
  });

  assert(url.length > 0, "fallback URL must be non-empty");
  assert(/^https?:\/\//.test(url), "fallback URL must be install-capable (http[s])");
});

// ── §E.4.4: native module absent → non-empty install-capable fallback ─────────
Deno.test("ORCH-1318 buildReferralLink returns a non-empty branded fallback when the native SDK is absent", async () => {
  __setInviteSdkForTest(null);
  const url = await buildReferralLink({ channel: "copy_link", referralCode: "SETH-8Q2" });
  assert(url.length > 0);
  assertStringIncludes(url, ONELINK_BRAND_DOMAIN);
});

// ── Pure helper: userParams assembly (SPEC §B.1) ──────────────────────────────
Deno.test("ORCH-1318 buildInviteUserParams: entity event + referral", () => {
  assertEquals(
    buildInviteUserParams({
      channel: "x",
      entity: { type: "event", brandSlug: "b", entitySlug: "e" },
      referralCode: "C",
    }),
    { deep_link_value: "event", deep_link_sub1: "b", deep_link_sub2: "e", af_sub1: "C" },
  );
});

Deno.test("ORCH-1318 buildInviteUserParams: referral-only (no entity)", () => {
  assertEquals(buildInviteUserParams({ channel: "x", referralCode: "C" }), {
    deep_link_value: "referral",
    deep_link_sub1: "C",
    af_sub1: "C",
  });
});

Deno.test("ORCH-1318 buildInviteUserParams: event missing entitySlug degrades to brand (never /e/brand/undefined)", () => {
  assertEquals(buildInviteUserParams({ channel: "x", entity: { type: "event", brandSlug: "b" } }), {
    deep_link_value: "brand",
    deep_link_sub1: "b",
  });
});

// ── Pure helper: static fallback URLs are always non-empty + install-capable ──
Deno.test("ORCH-1318 buildFallbackShareUrl: entity/referral/universal all non-empty", () => {
  assertEquals(
    buildFallbackShareUrl({ channel: "x", entity: { type: "event", brandSlug: "b", entitySlug: "e" } }),
    "https://host.usemingla.com/e/b/e",
  );
  assertEquals(
    buildFallbackShareUrl({ channel: "x", referralCode: "C" }),
    `https://${ONELINK_BRAND_DOMAIN}/invite/C`,
  );
  assertEquals(buildFallbackShareUrl({ channel: "x" }), `https://${ONELINK_BRAND_DOMAIN}`);
});

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { decideBankFirstInviteNext } from "../../../../mingla-business/src/utils/bankFirstPartnerInvite.ts";
import { buildInviteEmail } from "../../_shared/brandInviteEmail.ts";

Deno.env.set(
  "MINGLA_LOGO_URL",
  "https://usemingla.com/brand/email/mingla-wordmark-email.png",
);

const baseResult = {
  brandId: "brand-948",
  role: "brand_owner" as const,
  partnerSetup: true,
  stripeChargesEnabled: false,
  paystackSubaccountCode: null,
};

for (
  const fixture of [
    {
      name: "partner transfer without bank",
      patch: { transferred: true },
      kind: "connect",
    },
    {
      name: "partner no-transfer without bank",
      patch: { transferred: false },
      kind: "connect",
    },
    {
      name: "already-connected partner",
      patch: { stripeChargesEnabled: true },
      kind: "download",
    },
    {
      name: "standard scanner/team invite",
      patch: { partnerSetup: false, role: "scanner" as const },
      kind: "inline",
    },
  ] as const
) {
  Deno.test(`#948 W3 implementor — ${fixture.name}`, () => {
    const decision = decideBankFirstInviteNext({
      ...baseResult,
      ...fixture.patch,
    });
    assertEquals(decision.kind, fixture.kind);
    if (fixture.kind === "connect") {
      assertEquals(decision, {
        kind: "connect",
        href: "/brand/brand-948/connect",
      });
    } else if (fixture.kind === "download") {
      assertEquals(decision, { kind: "download" });
    }
  });
}

for (
  const fixture of [
    {
      partnerSetup: true,
      htmlLabel: "Claim &amp; add your bank",
      textLabel: "Claim & add your bank:",
    },
    {
      partnerSetup: false,
      htmlLabel: "Accept invitation",
      textLabel: "Accept your invitation:",
    },
  ]
) {
  Deno.test(`#948 W3 implementor — partnerSetup=${fixture.partnerSetup} has one role-correct email CTA`, () => {
    const payload = buildInviteEmail({
      inviteeName: "Amara",
      inviteeEmail: "amara@example.com",
      brandName: "Zuri Kitchen",
      inviterName: "David",
      role: fixture.partnerSetup ? "brand_owner" : "scanner",
      acceptUrl:
        "https://host.usemingla.com/accept-brand-invitation?token=W3_TOKEN",
      from: "Mingla <noreply@usemingla.com>",
      partnerSetup: fixture.partnerSetup,
    });

    assertStringIncludes(payload.html, fixture.htmlLabel);
    assertStringIncludes(payload.text, fixture.textLabel);
    assertStringIncludes(payload.html, "token=W3_TOKEN");
    assertStringIncludes(payload.text, "token=W3_TOKEN");
    assert(!payload.html.includes("business/download"));
    assert(!payload.text.includes("business/download"));
    assert(!payload.html.includes("Get the Mingla Host app"));
  });
}

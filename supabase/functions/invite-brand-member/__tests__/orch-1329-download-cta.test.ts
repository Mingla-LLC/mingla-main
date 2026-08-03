// ORCH-1329 / #948 W3 [single invite CTA + AA button contrast] — happy-path
// regression.
//
// Fails-on-revert: BOTH email variants have one primary CTA only; partner setup
// says "Claim & add your bank", standard stays "Accept invitation", and the
// accept URL/token plus AA-safe fill remain intact.
//
// Restoring the retired download secondary or the old partner CTA fails.
//
// Run: deno test --allow-env --allow-net \
//   supabase/functions/invite-brand-member/__tests__/orch-1329-download-cta.test.ts

import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { buildInviteEmail } from "../index.ts";

const PRIMARY_FILL = "background:#C4471A"; // AA-safe primary button fill

function build(partnerSetup: boolean) {
  return buildInviteEmail({
    inviteeName: "Amara",
    inviteeEmail: "amara@example.com",
    brandName: "Zuri Kitchen",
    inviterName: "David Okon",
    role: "event_manager",
    acceptUrl:
      "https://business.usemingla.com/accept-brand-invitation?token=abc.def",
    from: "Mingla <noreply@usemingla.com>",
    partnerSetup,
    personalNote: partnerSetup ? "Take it live!" : null,
  });
}

Deno.test("#948 W3 — partner-setup variant has one bank-first CTA (html + text)", () => {
  const p = build(true);
  assertStringIncludes(p.html, "Claim &amp; add your bank");
  assertStringIncludes(p.text, "Claim & add your bank:");
  assertStringIncludes(p.html, PRIMARY_FILL);
  assert(!p.html.includes("business/download"));
  assert(!p.text.includes("business/download"));
  assert(!p.html.includes("Get the Mingla Business app"));
  // No white-text button remains on the failing #FF6B2C fill.
  assert(
    !p.html.includes("background:#FF6B2C"),
    "no CTA button fill may remain on #FF6B2C (fails WCAG AA)",
  );
  // Designer polish: numbered steps + elevated Stripe trust note.
  assertStringIncludes(p.html, "Connect your bank");
  assertStringIncludes(p.html, "You're live");
  assertStringIncludes(p.html, "Bank-secure.");
  assertStringIncludes(p.text, "Bank-secure:");
  // Accept URL present in both bodies.
  assertStringIncludes(p.html, "token=abc.def");
  assertStringIncludes(p.text, "token=abc.def");
});

Deno.test("#948 W3 — standard team-invite keeps Accept invitation and no secondary", () => {
  const p = build(false);
  assertStringIncludes(p.html, "Accept invitation");
  assertStringIncludes(p.text, "Accept your invitation:");
  assertStringIncludes(p.html, PRIMARY_FILL);
  assert(!p.html.includes("business/download"));
  assert(!p.text.includes("business/download"));
  assert(!p.html.includes("Get the Mingla Business app"));
  assert(
    !p.html.includes("background:#FF6B2C"),
    "no CTA button fill may remain on #FF6B2C (fails WCAG AA)",
  );
  // Role-clarity line (what an event manager can do).
  assertStringIncludes(
    p.html,
    "you can create and run events, and manage tickets and guests",
  );
  assertStringIncludes(p.text, "Accept your invitation:");
  assertStringIncludes(p.text, "token=abc.def");
});

Deno.test("#948 W3 — both variants preserve the accept URL/token as the only destination", () => {
  for (const partnerSetup of [true, false]) {
    const p = build(partnerSetup);
    assertStringIncludes(
      p.html,
      "https://business.usemingla.com/accept-brand-invitation?token=abc.def",
    );
    assertStringIncludes(p.text, "token=abc.def");
  }
});

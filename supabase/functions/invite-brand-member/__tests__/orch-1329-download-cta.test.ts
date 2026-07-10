// ORCH-1329 [partner-invite email polish + "Get the Mingla Business app"
// download CTA + AA button-contrast fix] — happy-path regression.
//
// CLOSE Step-0.5 (fails-on-revert): asserts that BOTH email variants
// (partner-setup + standard team invite) carry, in BOTH the HTML body and the
// plain-text fallback, the secondary "Get the Mingla Business app" CTA pointing
// at the static /business/download smart-redirect route; and that the primary
// CTA button fill is the AA-safe #C4471A token (white-on-fill 4.93:1) while the
// secondary stays an outlined ghost (border #FF6B2C) so the one-filled-button
// hierarchy can't silently collapse to two fills.
//
// Fails on revert: delete the secondaryCta fragment / DOWNLOAD_URL line from
// buildInviteEmail, or restore the primary fill to #FF6B2C, and these assertions
// FAIL. Restore → PASS.
//
// Run: deno test --allow-env --allow-net \
//   supabase/functions/invite-brand-member/__tests__/orch-1329-download-cta.test.ts

import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { buildInviteEmail } from "../index.ts";

const DOWNLOAD_URL = "usemingla.com/business/download";
const PRIMARY_FILL = "background:#C4471A"; // AA-safe primary button fill
const SECONDARY_OUTLINE = "border:1.5px solid #FF6B2C"; // outlined ghost

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

Deno.test("ORCH-1329 — partner-setup variant carries the download CTA (html + text)", () => {
  const p = build(true);
  // Secondary "Get the Mingla Business app" CTA → static /business/download.
  assertStringIncludes(p.html, DOWNLOAD_URL);
  assertStringIncludes(p.text, DOWNLOAD_URL);
  assertStringIncludes(p.html, "Get the Mingla Business app");
  // Primary CTA is the AA-safe filled button; secondary stays an outline.
  assertStringIncludes(p.html, PRIMARY_FILL);
  assertStringIncludes(p.html, SECONDARY_OUTLINE);
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

Deno.test("ORCH-1329 — standard team-invite variant carries the download CTA (html + text)", () => {
  const p = build(false);
  assertStringIncludes(p.html, DOWNLOAD_URL);
  assertStringIncludes(p.text, DOWNLOAD_URL);
  assertStringIncludes(p.html, "Get the Mingla Business app");
  assertStringIncludes(p.html, PRIMARY_FILL);
  assertStringIncludes(p.html, SECONDARY_OUTLINE);
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

Deno.test("ORCH-1329 — download URL is the exact business smart-redirect literal", () => {
  for (const partnerSetup of [true, false]) {
    const p = build(partnerSetup);
    assertStringIncludes(p.html, "https://usemingla.com/business/download");
    assertStringIncludes(p.text, "https://usemingla.com/business/download");
  }
});

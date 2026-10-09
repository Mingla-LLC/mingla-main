/**
 * #3682 Wave 2.4 — consent names Follow + You're in Undo card (surfaces b + c).
 *
 * fails-on-revert:
 *   - strip follow clause from CONSENT_VISIBLE_FOLLOW_* → FAIL
 *   - remove YoureInFollowCard from confirm.tsx → FAIL
 *   - drop RSVP helper follow line → FAIL
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

const ROOT = join(__dirname, "../../../..");

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("#3682 Wave 2.4 — checkout consent names Follow (surface b)", () => {
  test("consentDisclosure exports brand-filled suffix + version bump", () => {
    const src = read("src/constants/consentDisclosure.ts");
    expect(src).toContain('DISCLOSURE_VERSION = "2026-10-08"');
    expect(src).toContain("CONSENT_VISIBLE_FOLLOW_BEFORE");
    expect(src).toContain("to follow ");
    expect(src).toContain("Unfollow anytime.");
    expect(src).toContain("function consentDisclosureText");
    expect(src).toContain("function rsvpFollowHelperLine");
  });

  test("buyer checkout emphasizes brand phrase and records filled disclosure", () => {
    const src = read("app/checkout/[eventId]/buyer.tsx");
    expect(src).toContain("consentDisclosureText(brand?.displayName)");
    expect(src).toContain("CONSENT_VISIBLE_FOLLOW_BEFORE");
    expect(src).toContain("checkboxFollowBrand");
    expect(src).toContain("resolveConsentBrandName(brand?.displayName)");
    // Guest path must not promise Follow (auto-follow skips null buyer_user_id).
    expect(src).toContain("GUEST_CHECKOUT_CONSENT_DISCLOSURE_TEXT");
    expect(src).toContain("GUEST_CHECKOUT_VISIBLE_LABEL_SUFFIX");
    // Auth must resolve before consent can be accepted (no guest-copy→Follow race).
    expect(src).toContain("authReady");
    expect(src).toContain("acceptedGrantRef");
  });

  test("trip and experience buyer routes share the Follow disclosure contract", () => {
    for (const rel of [
      "app/checkout-trip/[tripEventId]/buyer.tsx",
      "app/checkout-experience/[experienceEventId]/buyer.tsx",
    ]) {
      const src = read(rel);
      expect(src).toContain("CONSENT_VISIBLE_FOLLOW_BEFORE");
      expect(src).toContain("GUEST_CHECKOUT_CONSENT_DISCLOSURE_TEXT");
      expect(src).toContain("recordConsent");
      expect(src).toContain("acceptedGrantRef");
    }
  });

  test("Explorer TicketCartSheet records Follow disclosure for signed-in buyers", () => {
    const src = readFileSync(
      join(ROOT, "../app-mobile/src/components/expandedCard/TicketCartSheet.tsx"),
      "utf8",
    );
    expect(src).toContain("CONSENT_VISIBLE_FOLLOW_BEFORE");
    expect(src).toContain("GUEST_CHECKOUT_CONSENT_DISCLOSURE_TEXT");
    expect(src).toContain("recordConsent");
    expect(src).toContain("buyerUserId");
    expect(src).toContain("eventId");
    expect(src).toMatch(
      /const\s*\[\s*marketingOptIn\s*,\s*setMarketingOptIn\s*\]\s*=\s*useState<\s*boolean\s*>\s*\(\s*false\s*\)/,
    );
    expect(src).toContain("consentTermsBody");
    expect(src).toContain("setTermsSheetVisible(true)");
  });

  test("Explorer mirror matches Host DISCLOSURE_VERSION", () => {
    const host = read("src/constants/consentDisclosure.ts");
    const explorer = readFileSync(
      join(ROOT, "../app-mobile/src/constants/consentDisclosure.ts"),
      "utf8",
    );
    const hostVer = /DISCLOSURE_VERSION = "([^"]+)"/.exec(host)?.[1];
    const explorerVer = /DISCLOSURE_VERSION = "([^"]+)"/.exec(explorer)?.[1];
    expect(hostVer).toBe("2026-10-08");
    expect(explorerVer).toBe(hostVer);
    expect(explorer).toContain("follow {Brand} on Mingla");
  });

  test("RSVP contact helper names follow only when signed in", () => {
    const src = readFileSync(
      join(ROOT, "../packages/offering-rendering/RsvpOfferingBody.tsx"),
      "utf8",
    );
    expect(src).toContain("you'll follow");
    expect(src).toContain("Unfollow anytime.");
    expect(src).toContain("We'll only use this to update you about this event.");
    expect(src).toContain("isLoggedIn");
  });
});

describe("#3682 Wave 2.4 — You're in follow card (surface c)", () => {
  test("confirm mounts YoureInFollowCard between QR and DownloadMinglaCta", () => {
    const src = read("app/checkout/[eventId]/confirm.tsx");
    expect(src).toContain("YoureInFollowCard");
    const followIdx = src.indexOf("<YoureInFollowCard");
    const downloadIdx = src.indexOf("<DownloadMinglaCta");
    expect(followIdx).toBeGreaterThan(0);
    expect(downloadIdx).toBeGreaterThan(followIdx);
  });

  test("trip and experience confirms mount the same follow card", () => {
    for (const rel of [
      "app/checkout-trip/[tripEventId]/confirm.tsx",
      "app/checkout-experience/[experienceEventId]/confirm.tsx",
    ]) {
      const src = read(rel);
      expect(src).toContain("YoureInFollowCard");
      expect(src.indexOf("<YoureInFollowCard")).toBeLessThan(
        src.indexOf("<DownloadMinglaCta"),
      );
    }
  });

  test("card implements Undo / already / offer modes without AuthProvider", () => {
    const src = read("src/components/checkout/YoureInFollowCard.tsx");
    expect(src).toContain("You're now following");
    expect(src).toContain("You follow");
    expect(src).toContain("Want new dates from");
    expect(src).toContain("Undo");
    expect(src).toContain("getFollowMeta");
    expect(src).toContain("accessibilityLiveRegion");
    expect(src).toContain("createdAtMs");
    // Pin call sites, not prose: a comment naming the hooks must not red CI.
    expect(src).not.toMatch(/\buseAuth\s*\(/);
    expect(src).not.toMatch(/\buseBrandFollow\s*\(/);
    expect(src).not.toMatch(/from\s+["'][^"']*AuthContext["']/);
  });

  test("brandFollowsService exposes getFollowMeta for Undo gating", () => {
    const src = read("src/services/brandFollowsService.ts");
    expect(src).toContain("getFollowMeta");
    expect(src).toContain("source");
    expect(src).toContain("created_at");
  });
});

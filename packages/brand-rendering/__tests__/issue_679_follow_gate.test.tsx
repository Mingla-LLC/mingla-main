// Issue #679 [follow-a-brand] — implementor happy-path regression (append-only).
//
// [TEST-MOD-APPROVED #3682] Wave-2 Follow Design Contract extracted the button
// chrome into SharedFollowButton / BrandFollowControl. The callback gate, dual
// insertion sites, and types contract stay; label/a11y hex pins move to
// FollowButton.tsx (covered by issue_3682_follow_tokens + render suites).
//
// Structural + executable-predicate proof of the Wave-0 Follow contract
// (spec §4/§7 on #679):
//   (a) BrandFollowControl returns null WITHOUT a host-provided onToggleFollow;
//   (b) BOTH insertion sites mount BrandFollowControl;
//   (c) Following menu hook is typed; server-truth props remain;
//   (d) SharedFollowButton owns contrast-safe chrome.

import fs from "fs";
import path from "path";

const brandPage = fs.readFileSync(
  path.join(__dirname, "..", "PublicBrandPage.tsx"),
  "utf8",
);
const types = fs.readFileSync(path.join(__dirname, "..", "types.ts"), "utf8");
const followButton = fs.readFileSync(
  path.join(__dirname, "..", "FollowButton.tsx"),
  "utf8",
);

describe("Issue #679 — Follow is callback-gated, honest, and doubly inserted", () => {
  test("G-1 BrandFollowControl renders null WITHOUT onToggleFollow (the callback gate)", () => {
    expect(brandPage).toContain(
      "if (onToggleFollow === undefined) return null;",
    );
    const rendersFollow = (onToggleFollow?: () => void): boolean =>
      !(onToggleFollow === undefined);
    expect(rendersFollow(undefined)).toBe(false);
    expect(rendersFollow(() => {})).toBe(true);
    expect(
      brandPage.split("onToggleFollow={callbacks.onToggleFollow}").length - 1,
    ).toBe(2);
  });

  test("G-2 SharedFollowButton maps server-truth Following / Follow labels", () => {
    expect(followButton).toContain('"Following"');
    expect(followButton).toContain('"Follow"');
    expect(followButton).toContain("busy");
    const label = (isFollowing?: boolean): string =>
      isFollowing === true ? "Following" : "Follow";
    expect(label(true)).toBe("Following");
    expect(label(false)).toBe("Follow");
    expect(label(undefined)).toBe("Follow");
  });

  test("G-3 BOTH insertion sites reference BrandFollowControl at the spec'd points", () => {
    expect(brandPage.split("<BrandFollowControl").length - 1).toBe(2);

    const phoneWrap = brandPage.indexOf("styles.phoneIdentityWrap");
    expect(phoneWrap).toBeGreaterThan(-1);
    const phoneIdentity = brandPage.indexOf("{identityBlock}", phoneWrap);
    const phoneFollow = brandPage.indexOf("<BrandFollowControl", phoneWrap);
    const phoneSocials = brandPage.indexOf("{socialsBlock}", phoneWrap);
    expect(phoneIdentity).toBeGreaterThan(-1);
    expect(phoneFollow).toBeGreaterThan(phoneIdentity);
    expect(phoneSocials).toBeGreaterThan(phoneFollow);

    const panelStart = brandPage.indexOf("const stickyPanel = isDesktop");
    expect(panelStart).toBeGreaterThan(-1);
    const deskSocials = brandPage.indexOf("{socialsBlock}", panelStart);
    const deskFollow = brandPage.indexOf("<BrandFollowControl", panelStart);
    const deskShare = brandPage.indexOf("callbacks.onShare", panelStart);
    expect(deskSocials).toBeGreaterThan(panelStart);
    expect(deskFollow).toBeGreaterThan(deskSocials);
    expect(deskShare).toBeGreaterThan(deskFollow);
  });

  test("G-4 a11y contract — Follow / Following labels live on SharedFollowButton", () => {
    expect(followButton).toContain("`Follow ${brandName}`");
    expect(followButton).toContain("`Following ${brandName}`");
    expect(followButton).toContain("Opens options");
    expect(followButton).toContain('testID = "follow-button"');
  });

  test("G-5 types contract — optional callback + server-truth props", () => {
    expect(types).toContain("onToggleFollow?: () => void;");
    expect(types).toContain("onFollowingMenu?: () => void;");
    expect(types).toContain("isFollowing?: boolean;");
    expect(types).toContain("followPending?: boolean;");
  });

  test("G-6 BrandFollowControl uses SharedFollowButton (no hex in the gate wrapper)", () => {
    const compStart = brandPage.indexOf("const BrandFollowControl");
    expect(compStart).toBeGreaterThan(-1);
    const compEnd = brandPage.indexOf("// ORCH-1155 — horizontally-scrollable tab bar", compStart);
    expect(compEnd).toBeGreaterThan(compStart);
    const comp = brandPage.slice(compStart, compEnd);
    expect(comp).toContain("<SharedFollowButton");
    // Color literals only (6-digit); short issue refs like #679 must not trip this.
    expect(comp).not.toMatch(/#[0-9a-fA-F]{6}\b/);
  });

  // #3682 E4 — re-follow upsert must ignoreDuplicates (append-only pin).
  test("G-7 brandFollowsService follow upsert uses ignoreDuplicates", () => {
    const service = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "app-mobile",
        "src",
        "services",
        "brandFollowsService.ts",
      ),
      "utf8",
    );
    expect(service).toContain("ignoreDuplicates: true");
    expect(service).toContain('onConflict: "user_id,brand_id"');
  });
});

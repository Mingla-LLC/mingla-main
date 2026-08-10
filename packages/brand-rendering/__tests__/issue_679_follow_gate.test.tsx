// Issue #679 [follow-a-brand] — implementor happy-path regression (append-only).
//
// Structural + executable-predicate proof of the Wave-0 Follow contract
// (spec §4/§7 on #679):
//   (a) FollowButton returns null WITHOUT a host-provided onToggleFollow —
//       THE gate that keeps buyer-web and the business in-app preview free of
//       any follow surface (I-PROPOSED-679-FOLLOW-CALLBACK-GATED);
//   (b) BOTH spec'd insertion sites reference the gated button — phone between
//       identityBlock and socialsBlock, desktop panel between socialsBlock and
//       the Share Pressable;
//   (c) the label is the server-truth ternary, disabled while pending, with
//       the spec'd a11y labels/state;
//   (d) the types contract (optional callback + server-truth props) holds.
//
// fails-on-revert: TRUE LINE-DELETION of the renderer gate
// (`if (onToggleFollow === undefined) return null;`) fails G-1 and the
// adversarial panel test; deleting either <FollowButton mount fails G-3;
// dropping the a11y labels fails G-4; removing the types additions fails G-5.
// See the #679 implementation report for the verified commit hash.
//
// Source-as-text harness (no react-native / RTL import) — same node-env
// constraint the orch_1155 siblings document. The tester writes the SECOND,
// adversarial WEB-RENDER test (real RNW mount) on a different angle.

import fs from "fs";
import path from "path";

const brandPage = fs.readFileSync(
  path.join(__dirname, "..", "PublicBrandPage.tsx"),
  "utf8",
);
const types = fs.readFileSync(path.join(__dirname, "..", "types.ts"), "utf8");

describe("Issue #679 — Follow is callback-gated, honest, and doubly inserted", () => {
  test("G-1 FollowButton renders null WITHOUT onToggleFollow (the callback gate)", () => {
    expect(brandPage).toContain(
      "if (onToggleFollow === undefined) return null;",
    );
    // Executable predicate — the exact gate the source expresses: a host that
    // passes no callback gets NO follow surface.
    const rendersFollow = (onToggleFollow?: () => void): boolean =>
      !(onToggleFollow === undefined);
    expect(rendersFollow(undefined)).toBe(false);
    expect(rendersFollow(() => {})).toBe(true);
    // The mounts feed the gate from the HOST's callbacks object — both of them.
    expect(
      brandPage.split("onToggleFollow={callbacks.onToggleFollow}").length - 1,
    ).toBe(2);
  });

  test("G-2 label is the server-truth ternary; disabled while pending", () => {
    expect(brandPage).toContain(
      '{isFollowing === true ? "Following" : "Follow"}',
    );
    expect(brandPage).toContain("disabled={followPending === true}");
    // Executable predicate mirroring the source ternary: unknown/anon state
    // reads as NOT following — the renderer never invents a Following state.
    const label = (isFollowing?: boolean): string =>
      isFollowing === true ? "Following" : "Follow";
    expect(label(true)).toBe("Following");
    expect(label(false)).toBe("Follow");
    expect(label(undefined)).toBe("Follow");
  });

  test("G-3 BOTH insertion sites reference the button at the spec'd points", () => {
    // exactly two mounts — phone flow + desktop sticky panel
    expect(brandPage.split("<FollowButton").length - 1).toBe(2);

    // phone: identityBlock → FollowButton → socialsBlock inside phoneIdentityWrap
    const phoneWrap = brandPage.indexOf("styles.phoneIdentityWrap");
    expect(phoneWrap).toBeGreaterThan(-1);
    const phoneIdentity = brandPage.indexOf("{identityBlock}", phoneWrap);
    const phoneFollow = brandPage.indexOf("<FollowButton", phoneWrap);
    const phoneSocials = brandPage.indexOf("{socialsBlock}", phoneWrap);
    expect(phoneIdentity).toBeGreaterThan(-1);
    expect(phoneFollow).toBeGreaterThan(phoneIdentity);
    expect(phoneSocials).toBeGreaterThan(phoneFollow);

    // desktop panel: socialsBlock → FollowButton → the Share Pressable
    const panelStart = brandPage.indexOf("const stickyPanel = isDesktop");
    expect(panelStart).toBeGreaterThan(-1);
    const deskSocials = brandPage.indexOf("{socialsBlock}", panelStart);
    const deskFollow = brandPage.indexOf("<FollowButton", panelStart);
    const deskShare = brandPage.indexOf("callbacks.onShare", panelStart);
    expect(deskSocials).toBeGreaterThan(panelStart);
    expect(deskFollow).toBeGreaterThan(deskSocials);
    expect(deskShare).toBeGreaterThan(deskFollow);
  });

  test("G-4 a11y contract — role, state, and the spec'd labels", () => {
    expect(brandPage).toContain("`Unfollow ${brand.displayName}`");
    expect(brandPage).toContain("`Follow ${brand.displayName}`");
    expect(brandPage).toContain("selected: isFollowing === true");
    expect(brandPage).toContain("disabled: followPending === true");
  });

  test("G-5 types contract — optional callback + server-truth props", () => {
    expect(types).toContain("onToggleFollow?: () => void;");
    expect(types).toContain("isFollowing?: boolean;");
    expect(types).toContain("followPending?: boolean;");
  });

  test("G-6 palette tokens only — no hex literals inside FollowButton", () => {
    const compStart = brandPage.indexOf("const FollowButton");
    expect(compStart).toBeGreaterThan(-1);
    const compEnd = brandPage.indexOf("const TabBar", compStart);
    expect(compEnd).toBeGreaterThan(compStart);
    const comp = brandPage.slice(compStart, compEnd);
    expect(comp).toContain("palette.accent");
    expect(comp).toContain("palette.accentText");
    expect(comp).toContain("palette.primaryText");
    expect(comp).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

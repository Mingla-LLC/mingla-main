/**
 * ORCH-1128 [public offering-page polish] — IMPLEMENTOR happy-path regression.
 *
 * Two follow-up tweaks to ORCH-1117 (floating Buy bar) + ORCH-1124 (mute pill
 * → bottomRight), reported by Seth on the buyer-web public offering page:
 *
 *   ITEM 1 — FREE-TICKET CTA FULL WIDTH. On the floating bar a PAID ticket
 *     shows price (flex:1 column) + button sharing the row; a FREE / waitlist
 *     ticket has no price, so the sole CTA must span the FULL bar width rather
 *     than hugging content on the right of an empty flex:1 placeholder column.
 *     Fix: render the price column ONLY for kind==="buy"; for the non-buy
 *     tappable kinds the button gets `buttonFull` (flex:1, marginLeft:0). The
 *     paid price-left / button-right split is unchanged. Mirrored on web
 *     (mingla-business) AND native consumer (app-mobile) — both shared the
 *     identical empty-placeholder defect.
 *
 *   ITEM 2 — MUTE PILL BOTTOM CLEARANCE. The shared EventCoverMedia bottomRight
 *     Sound/Mute pill sat at bottom:14, flush on the cover seam, bleeding into
 *     the details section that begins immediately below the public hero. Raised
 *     to bottom:22 (8px clearance). Single shared value → web public page AND
 *     native gallery both inherit it; native gallery pill simply moves up 8px,
 *     still safely within the cover. The ORCH-1124 bottomRight POSITION (right
 *     edge, bottom anchor) is preserved — NOT reverted to topRight.
 *
 * Source-assertion style (the repo Jest harness runs in Node without
 * react-test-renderer — see PublicBrandPage.closeButton.test.tsx harness note),
 * matching the sibling ORCH-1117 / ORCH-1124 source tests.
 *
 * fails-on-revert (verified by true line-deletion of the fix, NOT comment-out):
 *   ITEM 1 web    — delete `styles.buttonFull` style or the `buttonFull` apply  → fails.
 *   ITEM 1 native — same in app-mobile FloatingOfferingBar                       → fails.
 *   ITEM 2        — restore `bottom: 14` in audioControlBottomRight             → fails.
 */

import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const businessBar = (): string =>
  readFileSync(
    path.resolve(__dirname, "../FloatingOfferingBar.tsx"),
    "utf8",
  );

const nativeBar = (): string =>
  readFileSync(
    path.resolve(
      __dirname,
      "../../../../../app-mobile/src/components/offering/FloatingOfferingBar.tsx",
    ),
    "utf8",
  );

const coverMedia = (): string =>
  readFileSync(
    path.resolve(
      __dirname,
      "../../../../../packages/event-rendering/EventCoverMedia.tsx",
    ),
    "utf8",
  );

describe("ORCH-1128 item 1 — free / waitlist CTA spans the full floating bar", () => {
  // For BOTH bars: there must be a `buttonFull` style with flex:1 + marginLeft:0,
  // and the sole-CTA branch must apply it only for the non-"buy" kinds.
  const assertFullWidthFreeCta = (src: string): void => {
    // The empty flex:1 placeholder column is GONE — non-buy no longer renders a
    // sibling that would steal half the row.
    expect(src).not.toMatch(/\) : \(\s*<View style={styles\.priceCol} \/>\s*\)/);
    // A full-width style exists with flex:1 (fills the bar) and no left margin
    // (the margin only ever separated the button from the price column).
    expect(src).toMatch(/buttonFull:\s*{[^}]*flex:\s*1/);
    expect(src).toMatch(/buttonFull:\s*{[^}]*marginLeft:\s*0/);
    // It is applied to the Pressable ONLY for the non-buy tappable kinds.
    expect(src).toMatch(/cta\.kind !== "buy" && styles\.buttonFull/);
    // The paid "buy" split is preserved: the price column still renders for buy.
    expect(src).toMatch(/cta\.kind === "buy" \?\s*\(?\s*<View style={styles\.priceCol}>/);
  };

  test("mingla-business (buyer web) floating bar makes the free CTA full-width", () => {
    assertFullWidthFreeCta(businessBar());
  });

  test("app-mobile (consumer native) floating bar makes the free CTA full-width", () => {
    assertFullWidthFreeCta(nativeBar());
  });
});

describe("ORCH-1128 item 2 — cover mute pill clears the details below", () => {
  test("audioControlBottomRight bottom offset is raised to 22 (clearance from details)", () => {
    const src = coverMedia();
    const idx = src.indexOf("audioControlBottomRight:");
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 400);
    // The bottom offset is the bumped value, not the flush ORCH-1124 default.
    expect(block).toMatch(/bottom:\s*22/);
    expect(block).not.toMatch(/bottom:\s*14\b/);
    // ORCH-1124 position contract preserved: still bottom-right (right anchor),
    // NOT reverted to a top position.
    expect(block).toMatch(/right:\s*14/);
  });

  test("the public page still inherits the bottomRight default (no topRight regression)", () => {
    const src = coverMedia();
    expect(src).toContain('audioControlPosition = "bottomRight"');
  });
});

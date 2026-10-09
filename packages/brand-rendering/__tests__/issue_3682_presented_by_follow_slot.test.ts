// #3682 Follow contract (a) — Presented-by identity Pressable + sibling Follow slot.
import fs from "fs";
import path from "path";

const eventBody = fs.readFileSync(
  path.join(__dirname, "../../offering-rendering/EventOfferingBody.tsx"),
  "utf8",
);
const rsvpBody = fs.readFileSync(
  path.join(__dirname, "../../offering-rendering/RsvpOfferingBody.tsx"),
  "utf8",
);

describe("issue_3682_presented_by_follow_slot", () => {
  for (const [name, src] of [
    ["EventOfferingBody", eventBody],
    ["RsvpOfferingBody", rsvpBody],
  ] as const) {
    test(`${name} accepts presentedByFollow and renders it outside the identity Pressable`, () => {
      expect(src).toContain("presentedByFollow?: React.ReactNode");
      expect(src).toContain("styles.brandFollowSlot");
      expect(src).toContain("{presentedByFollow}");
      const cardStart = src.indexOf('testID="presented-by-card"');
      expect(cardStart).toBeGreaterThan(-1);
      const cardSlice = src.slice(cardStart, cardStart + 3200);
      const pressableClose = cardSlice.indexOf("</Pressable>");
      const followSlot = cardSlice.indexOf("styles.brandFollowSlot");
      expect(pressableClose).toBeGreaterThan(-1);
      expect(followSlot).toBeGreaterThan(pressableClose);
    });

    test(`${name} does not import @mingla/brand-rendering (no package cycle)`, () => {
      expect(src).not.toContain("@mingla/brand-rendering");
    });
  }
});

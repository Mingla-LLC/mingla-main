/**
 * #3040 T-A15 [A-15] — every cover button names the picker it opens.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

import { coverKindOf, resolveCoverActions } from "../coverPickerActionLabels";

const strip = (actions: ReturnType<typeof resolveCoverActions>["actions"]) =>
  actions.map(({ label, opens, primary }) => (primary ? { label, opens, primary } : { label, opens }));

describe("#3040 T-A15 — outcome-named cover actions", () => {
  test("video cover: Replace video (primary) then Use photo instead", () => {
    expect(strip(resolveCoverActions("video", false, false).actions)).toEqual([
      { label: "Replace video", opens: "video", primary: true },
      { label: "Use photo instead", opens: "image" },
    ]);
  });

  test("photo cover: reversed — Replace photo (primary) then Use video instead", () => {
    expect(strip(resolveCoverActions("photo", false, false).actions)).toEqual([
      { label: "Replace photo", opens: "image", primary: true },
      { label: "Use video instead", opens: "video" },
    ]);
  });

  test("empty: Add a video (primary) then Add a photo (Seth, Q2)", () => {
    expect(strip(resolveCoverActions("empty", false, false).actions)).toEqual([
      { label: "Add a video", opens: "video", primary: true },
      { label: "Add a photo", opens: "image" },
    ]);
  });

  test("Remove cover stays during an active job and hides in needs-action states and on empty", () => {
    expect(resolveCoverActions("video", true, false).showRemove).toBe(true);
    expect(resolveCoverActions("video", true, false).showActions).toBe(false);
    expect(resolveCoverActions("video", false, true).showRemove).toBe(false);
    expect(resolveCoverActions("empty", false, false).showRemove).toBe(false);
  });

  test("ad video sheet is video-only", () => {
    expect(resolveCoverActions("empty", false, false, true).actions.map((a) => a.label)).toEqual(["Add ad video"]);
    expect(resolveCoverActions("video", false, false, true).removeLabel).toBe("Remove video");
  });

  test("cover kind follows the saved media type", () => {
    expect(coverKindOf(null, null)).toBe("empty");
    expect(coverKindOf("u", "video")).toBe("video");
    expect(coverKindOf("u", "gif")).toBe("photo");
  });

  test("the cover primary uses dark ink (canvas.depth) on the flat orange", () => {
    const picker = readFileSync(join(__dirname, "..", "CoverPicker.tsx"), "utf8");
    expect(picker).toMatch(/darkInkLabel:\s*\{\s*color:\s*canvas\.depth,?\s*\}/);
    expect(picker).toContain("coverAction.primary ? { accentColor: accent.warm, labelStyle: styles.darkInkLabel }");
    // The old mislabelled pair is gone.
    expect(picker).not.toContain('label={hasCover ? "Replace" : "Image"}');
  });
});

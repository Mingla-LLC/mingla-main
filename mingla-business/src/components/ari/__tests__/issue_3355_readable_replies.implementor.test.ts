/**
 * #3355 — readable Ari replies: no raw Markdown punctuation; typed segments.
 */
import {
  ariTextLeaksMarkdown,
  parseInlineRuns,
  toAccessibleText,
  toSegments,
} from "../ariBubbleSegments";

/** Production-shaped ad reply that leaked *** / ### / ** / backticks on Host web. */
const LEAKY_AD_REPLY = [
  "### Your Meta ad is ready",
  "",
  "Review the **LAUNCH HOST AD** card below, then type `LAUNCH`.",
  "",
  "***",
  "",
  "1. Add a video",
  "2. Check the budget",
  "3. Confirm the destination",
  "",
  "- Campaign: Lantern Room",
  "- Platform: Meta",
].join("\n");

describe("#3355 readable Ari replies", () => {
  test("leaky ad reply exposes no hash, asterisk, backtick, or rule markers", () => {
    expect(ariTextLeaksMarkdown(LEAKY_AD_REPLY)).toBe(false);
    const spoken = toAccessibleText(LEAKY_AD_REPLY);
    expect(spoken).not.toMatch(/[#*`]/);
    expect(spoken).toMatch(/Your Meta ad is ready/);
    expect(spoken).toMatch(/LAUNCH HOST AD/);
    expect(spoken).toMatch(/Add a video/);
  });

  test("headings become section_label segments without hashes", () => {
    expect(toSegments("### Budget\n\nYou are on track.")).toEqual([
      { kind: "section_label", text: "Budget" },
      { kind: "paragraph", text: "You are on track." },
    ]);
  });

  test("numbered steps and bullets are typed blocks", () => {
    const segments = toSegments("Next:\n1. Draft the reminder\n2. Send it\n- Keep it short");
    expect(segments).toEqual([
      { kind: "paragraph", text: "Next:" },
      { kind: "numbered", text: "Draft the reminder", n: 1 },
      { kind: "numbered", text: "Send it", n: 2 },
      { kind: "bullet", text: "Keep it short" },
    ]);
  });

  test("inline emphasis parses without leaving asterisks", () => {
    const runs = parseInlineRuns("Type **LAUNCH** when ready");
    expect(runs).toEqual([
      { kind: "plain", text: "Type " },
      { kind: "strong", text: "LAUNCH" },
      { kind: "plain", text: " when ready" },
    ]);
  });

  test("malformed markup falls back to clean plain text", () => {
    const spoken = toAccessibleText("Oops **unclosed and ###hashes `ticks");
    expect(spoken).not.toMatch(/[*#`]/);
    expect(ariTextLeaksMarkdown("Oops **unclosed and ###hashes `ticks")).toBe(false);
  });

  test("#3429 bullet split still holds", () => {
    expect(toSegments("Pick one:\n- A\n- B\nEither works.")).toEqual([
      { kind: "paragraph", text: "Pick one:" },
      { kind: "bullet", text: "A" },
      { kind: "bullet", text: "B" },
      { kind: "paragraph", text: "Either works." },
    ]);
  });
});

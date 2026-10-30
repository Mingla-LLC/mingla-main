/**
 * #3355 — readable Ari replies: no raw Markdown punctuation; typed segments.
 */
import {
  ariTextLeaksMarkdown,
  parseInlineRuns,
  toAccessibleText,
  toSegments,
} from "../ariBubbleSegments";
import {
  ariUserFacingReplyText,
  parseAriRendition,
} from "../renditions/ariRenditionProtocol";
import fs from "node:fs";
import path from "node:path";

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
  test("approval, cancellation, choice, and retry UI never renders raw backend exception text", () => {
    const screen = fs.readFileSync(
      path.resolve(__dirname, "../../../screens/ari/AriChatScreen.tsx"),
      "utf8",
    );
    const card = fs.readFileSync(
      path.resolve(__dirname, "../ToolProposalCard.tsx"),
      "utf8",
    );

    expect(screen).toContain("const message = ariChatErrorCopy(result.code)");
    expect(screen).toContain("setLocalError(ariChatErrorCopy(result.code))");
    expect(screen).not.toContain("setLocalError(result.message)");
    expect(screen).not.toMatch(/setLocalError\([\s\S]{0,100}error\.message/);
    expect(card).not.toMatch(/setProposalError\([\s\S]{0,100}error\.message/);
  });

  test("persisted replies cannot expose diagnostic slugs, tool names, or UUID routes", () => {
    const publicText = ariUserFacingReplyText(
      "Search public sources: RESEARCH_NOT_CONFIGURED. Create it using the tool create_site_draft, then open /brand/33550000-0000-4000-a000-000000000001/website.",
    );
    expect(publicText).not.toMatch(
      /RESEARCH_NOT_CONFIGURED|create_site_draft|33550000-0000-4000-a000-000000000001/,
    );
    expect(publicText).toContain("Public research is temporarily unavailable");
    expect(publicText).toContain("website draft");
    expect(publicText).toContain("Website screen");
  });

  test("persisted replies fail closed for unknown internal code slugs", () => {
    const publicText = ariUserFacingReplyText(
      "The step returned EVENT_GRAPH_STALE and DATE_WINDOW_AMBIGUOUS.",
    );
    expect(publicText).not.toMatch(/EVENT_GRAPH_STALE|DATE_WINDOW_AMBIGUOUS/);
    expect(publicText).toContain("This step needs attention");
  });

  test("persisted receipts hide legacy database slugs and identifiers", () => {
    const rendition = parseAriRendition({
      schema_version: 2,
      rendition_id: "receipt:legacy",
      kind: "receipt",
      title: "Create Event",
      body: "Saved in Mingla.",
      blocks: [
        {
          type: "key_value",
          version: 1,
          id: "facts",
          rows: [
            { label: "Title", value: "Autumn Table" },
            { label: "Slug", value: "draft-85ac85b6d8e84325" },
            {
              label: "Created By",
              value: "edbf610d-b15f-4778-a7d8-b9a8c21419a8",
            },
            { label: "Created At", value: "2026-10-29T18:51:38.201809+00:00" },
          ],
        },
      ],
    });
    expect(rendition).not.toBeNull();
    expect(JSON.stringify(rendition)).toContain("Autumn Table");
    expect(JSON.stringify(rendition)).not.toMatch(
      /draft-85ac85b6d8e84325|edbf610d|Created At|Created By/,
    );
  });

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
    const segments = toSegments(
      "Next:\n1. Draft the reminder\n2. Send it\n- Keep it short",
    );
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
    expect(spoken).not.toMatch(/`/);
    expect(spoken).not.toMatch(/\*\*/);
    expect(ariTextLeaksMarkdown("Oops **unclosed and ###hashes `ticks")).toBe(
      false,
    );
  });

  test("literal email underscores and URL fragments survive", () => {
    const spoken = toAccessibleText(
      "Email jane_doe@example.com or open https://usemingla.com/#pricing",
    );
    expect(spoken).toContain("jane_doe@example.com");
    expect(spoken).toContain("#pricing");
    expect(ariTextLeaksMarkdown(spoken)).toBe(false);
  });

  test("paired underscores inside emails are not emphasis", () => {
    const spoken = toAccessibleText(
      "Reach jane_doe_sales@example.com and also bob_ops@example.com today",
    );
    expect(spoken).toContain("jane_doe_sales@example.com");
    expect(spoken).toContain("bob_ops@example.com");
    expect(ariTextLeaksMarkdown(spoken)).toBe(false);
  });

  test("nested code inside strong does not leak backticks", () => {
    const runs = parseInlineRuns("**Type `LAUNCH` to confirm**");
    expect(runs).toEqual([{ kind: "strong", text: "Type LAUNCH to confirm" }]);
    const spoken = toAccessibleText("**Type `LAUNCH` to confirm**");
    expect(spoken).toBe("Type LAUNCH to confirm");
    expect(spoken).not.toMatch(/`/);
  });

  test("markdown links keep the destination in spoken and segment text", () => {
    const raw = "Open [your site](https://usemingla.com/lantern)";
    expect(toSegments(raw)).toEqual([
      {
        kind: "paragraph",
        text: "Open your site (https://usemingla.com/lantern)",
      },
    ]);
    expect(toAccessibleText(raw)).toContain("https://usemingla.com/lantern");
  });

  test("heading bodies keep inline emphasis for the renderer", () => {
    expect(toSegments("### **Budget**")).toEqual([
      { kind: "section_label", text: "**Budget**" },
    ]);
    expect(parseInlineRuns("**Budget**")).toEqual([
      { kind: "strong", text: "Budget" },
    ]);
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

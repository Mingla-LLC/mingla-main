/** #3355 — Ari feedback is explicit, compact, and independent of icon shims. */
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
  path.join(__dirname, "../MessageList.tsx"),
  "utf8",
);
const settingsSource = fs.readFileSync(
  path.join(__dirname, "../../../screens/ari/AriSettingsScreen.tsx"),
  "utf8",
);
const proposalSource = fs.readFileSync(
  path.join(__dirname, "../ToolProposalCard.tsx"),
  "utf8",
);
const responseCardSource = fs.readFileSync(
  path.join(__dirname, "../ResponseCard.tsx"),
  "utf8",
);

describe("#3355 Ari reply feedback controls", () => {
  test("names the decision and both actions in visible text", () => {
    expect(source).toContain("Was this useful?");
    expect(source).toMatch(/>\s*Yes\s*<\/Text>/);
    expect(source).toMatch(/>\s*Improve\s*<\/Text>/);
  });

  test("does not depend on thumbs icons that degrade to question marks on web", () => {
    expect(source).not.toMatch(/ThumbsUp|ThumbsDown/);
    expect(source).toContain('accessibilityLabel="This Ari reply was helpful"');
    expect(source).toContain(
      'accessibilityLabel="This Ari reply needs improvement"',
    );
  });

  test("keeps a compact visual control with a 44px effective hit target", () => {
    expect(source).toMatch(/feedbackButton:\s*\{[\s\S]*?minHeight: 34/);
    expect(source.match(/hitSlop=\{5\}/g)).toHaveLength(2);
  });

  test("does not render generic tool-completion badges", () => {
    expect(source).toContain("!toolResultNeedsThreadRow(m.tool_results)");
    expect(source).not.toContain('let label = "Done"');
    expect(responseCardSource).not.toContain(">Done</Text>");
    expect(proposalSource).toContain('accessibilityLabel="View result"');
    expect(proposalSource).not.toContain('accessibilityLabel="Done"');
  });

  test("keeps saved-task diagnostic codes out of host settings", () => {
    expect(settingsSource).toContain("jobErrorCopy(job.last_error_code)");
    expect(settingsSource).toContain(
      'return "This step needs attention before it can continue."',
    );
    expect(settingsSource).not.toContain(
      "Needs attention: {job.last_error_code}",
    );
  });

  test("exposes memory and durable-task controls as named buttons", () => {
    for (const label of [
      'accessibilityLabel="Cancel memory edit"',
      "accessibilityLabel={`Edit ${labelForMemoryKind(note.kind)} memory`}",
      "accessibilityLabel={`Forget ${labelForMemoryKind(note.kind)} memory`}",
      "accessibilityLabel={`Resume ${job.goal_summary}`}",
      "accessibilityLabel={`Pause ${job.goal_summary}`}",
      "accessibilityLabel={`Cancel ${job.goal_summary}`}",
    ]) {
      expect(settingsSource).toContain(label);
    }
    expect(settingsSource).toContain('accessibilityRole="button"');
    expect(settingsSource).toContain("accessibilityState={{");
  });

  test("proposal summaries show the selected brand name, never a UUID fragment", () => {
    expect(proposalSource).toContain(
      'value: brandNamesById[args.brand_id] ?? "Selected brand"',
    );
    expect(proposalSource).not.toContain(
      'value: String(args.brand_id).slice(0, 8) + "…"',
    );
  });
});

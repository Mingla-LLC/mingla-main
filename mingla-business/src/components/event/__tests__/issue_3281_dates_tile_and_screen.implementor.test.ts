/**
 * #3281 PR6 fold-in — Host Dates tile gates on multi_date + calendar icon;
 * Dates screen keeps pull-to-refresh and past read-only.
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../../../");

describe("issue_3281 Host Dates tile + screen (Seth 2026-10-21 fold)", () => {
  test("event home Dates tile is calendar + multi_date only", () => {
    const src = fs.readFileSync(
      path.join(root, "app/event/[id]/index.tsx"),
      "utf8",
    );
    expect(src).toMatch(/whenMode === ["']multi_date["']/);
    expect(src).toMatch(/icon=["']calendar["'][\s\S]{0,80}label=["']Dates["']/);
  });

  test("Dates screen has RefreshControl and past-date read-only", () => {
    const src = fs.readFileSync(
      path.join(root, "app/event/[id]/dates.tsx"),
      "utf8",
    );
    expect(src).toMatch(/RefreshControl/);
    expect(src).toMatch(/isPastEnd/);
    expect(src).toMatch(/editable=\{!\s*past/);
  });
});

import fs from "node:fs";
import path from "node:path";

import {
  contractNoticeKey,
  shootWindowWords,
  workspaceShootWindow,
} from "../contractCopy";

// #3872 — the contract workspace sends the gig's shoot window as
// {shoot_window:{start,end}}; the host contract read flat fields that are not
// there and showed "Shoot dates:  to ." with an unbounded day picker.
describe("host contract shoot window", () => {
  it("reads the workspace's nested window", () => {
    expect(
      workspaceShootWindow({ shoot_window: { start: "2026-11-09", end: "2026-11-09" } }),
    ).toEqual({ start: "2026-11-09", end: "2026-11-09" });
    expect(workspaceShootWindow({ shoot_window: null })).toBeNull();
    expect(workspaceShootWindow(undefined)).toBeNull();
  });

  it("never shows blank dates", () => {
    expect(shootWindowWords({ start: "2026-11-09", end: "2026-11-09" })).toMatch(/^Shoot day: \S/);
    expect(shootWindowWords({ start: "2026-11-09", end: "2026-11-12" })).toMatch(/^Shoot dates: \S.* to \S/);
    expect(shootWindowWords(null)).not.toMatch(/ to \./);
  });

  it("the contract screen uses the helper for the line and the day picker", () => {
    const page = fs.readFileSync(
      path.resolve(__dirname, "../../../../app/brand/[id]/creators/contract/[contractId].tsx"),
      "utf8",
    );
    expect(page).toContain("workspaceShootWindow(gig)");
    expect(page).toContain("shootWindowWords(shootWindow)");
    expect(page).not.toContain("gig?.shoot_window_start");
  });
});

describe("host contract notices", () => {
  const base = {
    contract: { id: "c", state: "accepted", state_deadline_at: null, fix_rounds_used: 0, current_terms_version: 1 },
    proposals: [{ id: "p1", status: "pending" }],
  } as never;
  it("a notice goes stale when the request is answered, even if the step stays the same", () => {
    const sent = contractNoticeKey(base);
    const answered = contractNoticeKey({
      contract: { id: "c", state: "accepted", state_deadline_at: null, fix_rounds_used: 0, current_terms_version: 2 },
      proposals: [{ id: "p1", status: "accepted" }],
    } as never);
    expect(answered).not.toEqual(sent);
    expect(contractNoticeKey(base)).toEqual(sent);
  });
});

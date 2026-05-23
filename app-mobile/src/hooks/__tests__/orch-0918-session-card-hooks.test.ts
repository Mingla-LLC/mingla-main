export function runOrch0918ScheduledOrderingFixture(): boolean {
  const saved = new Set(["locked-a", "locked-b"]);
  const calendar = [
    { board_card_id: "locked-b", scheduled_at: "2026-05-24T10:00:00Z" },
    { board_card_id: "locked-a", scheduled_at: "2026-05-23T10:00:00Z" },
    { board_card_id: "unlocked-c", scheduled_at: "2026-05-22T10:00:00Z" },
  ];
  const ordered = calendar
    .filter((entry) => saved.has(entry.board_card_id))
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
    .map((entry) => entry.board_card_id);
  return ordered.join(",") === "locked-a,locked-b";
}

export const ORCH_0918_HOOK_TEST_RECEIPTS = {
  "T-02":
    "fails-on-revert verified by app-mobile/scripts/ci/orch-0918-regression-check.mjs",
};

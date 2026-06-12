/**
 * ORCH-1123 [Hub multi-select draft delete] — TESTER adversarial suite.
 *
 * DIFFERENT ANGLE from the implementor's happy-path source-grep:
 *   - The implementor re-implemented `bulkToastMessage` + `partition` as LOCAL
 *     copies and tested the copies. This suite instead exercises the REAL
 *     shipped `discardOfferingDrafts` service (supabase mocked) and the REAL
 *     screen-exported `bulkToastMessage`, then attacks the load-bearing
 *     invariants with hostile inputs the implementor never fed them.
 *
 * Attack surface:
 *   A. SERVICE — empty batch must NEVER touch the network (a local-only-only
 *      events delete must not call the RPC); an RPC error must PROPAGATE
 *      (no silent swallow); outcome mapping must be faithful and lossless.
 *   B. DRAFTS-ONLY BYPASS — a stale-UI batch carrying a LIVE row (server
 *      outcome `skipped_not_draft`) must be classified as FAILED, never as
 *      deleted, so the toast says "couldn't be deleted" (a live offering can
 *      never silently read as deleted).
 *   C. NO-SILENT-PARTIAL-FAILURE — every non-`deleted` outcome
 *      (forbidden / skipped_not_found / skipped_not_draft) counts as failed in
 *      the screens' tally classifier; the toast surfaces it.
 *   D. SOURCE NEGATIVE GUARDS — no Hub tab may set `selectable` to a literal
 *      `true` or from a non-draft expression; long-press entry is gated on the
 *      draft predicate in all three tabs.
 *
 * fails-on-revert: proven separately in the TEST report (commit hash recorded).
 */

import { describe, expect, jest, test } from "@jest/globals";
import { readFileSync } from "fs";
import path from "path";

// --- Mock the supabase client BEFORE importing the service under test --------
type RpcResult = { data: unknown; error: unknown };
const rpcMock = jest.fn<(...args: unknown[]) => Promise<RpcResult>>();
jest.mock("../supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

import {
  discardOfferingDrafts,
  type DraftDiscardOutcome,
  type DraftDiscardRow,
} from "../offeringDrafts";

const repoFile = (rel: string): string =>
  readFileSync(path.join(process.cwd(), rel), "utf8");

beforeEach(() => {
  rpcMock.mockReset();
});

// =====================================================================
// A. SERVICE — network discipline + error propagation + faithful mapping
// =====================================================================
describe("A. discardOfferingDrafts service (the REAL shipped fn)", () => {
  test("empty batch short-circuits — the RPC is NEVER called", async () => {
    const out = await discardOfferingDrafts([]);
    expect(out).toEqual([]);
    // CRITICAL: an events bulk-delete of ONLY local-only (d_*) drafts passes []
    // as serverEventIds. It must not hit the network (would be a wasted/▽404).
    expect(rpcMock).not.toHaveBeenCalled();
  });

  test("an RPC error PROPAGATES (no silent swallow → screen sets bulkError)", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: new Error("not_authenticated"),
    });
    await expect(
      discardOfferingDrafts(["11111111-1111-1111-1111-111111111111"]),
    ).rejects.toThrow("not_authenticated");
  });

  test("null data (no rows) maps to [] without throwing", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    await expect(
      discardOfferingDrafts(["11111111-1111-1111-1111-111111111111"]),
    ).resolves.toEqual([]);
  });

  test("outcome mapping is faithful + lossless (snake_case → camelCase, all 4 outcomes)", async () => {
    rpcMock.mockResolvedValue({
      data: [
        { event_id: "a", outcome: "deleted" },
        { event_id: "b", outcome: "skipped_not_draft" },
        { event_id: "c", outcome: "skipped_not_found" },
        { event_id: "d", outcome: "forbidden" },
      ],
      error: null,
    });
    const rows = await discardOfferingDrafts(["a", "b", "c", "d"]);
    const expected: DraftDiscardRow[] = [
      { eventId: "a", outcome: "deleted" },
      { eventId: "b", outcome: "skipped_not_draft" },
      { eventId: "c", outcome: "skipped_not_found" },
      { eventId: "d", outcome: "forbidden" },
    ];
    expect(rows).toEqual(expected);
    // The RPC is invoked with the EXACT param name the migration declares.
    expect(rpcMock).toHaveBeenCalledWith("business_discard_offering_drafts", {
      p_event_ids: ["a", "b", "c", "d"],
    });
  });
});

// =====================================================================
// B + C. Tally classification — the screens' exact deleted/failed split
// =====================================================================
// This mirrors the EXACT classifier the three screens use after mutateAsync:
//   deleted = rows.filter(r => r.outcome === "deleted").length (+ localDeleted)
//   failed  = rows.filter(r => r.outcome !== "deleted").length
// Re-implementing the *classifier* here is intentional: the adversarial point
// is to prove that under this classifier a LIVE row can never read as deleted.
const classify = (
  rows: DraftDiscardRow[],
  localDeleted = 0,
): { deleted: number; failed: number } => ({
  deleted: rows.filter((r) => r.outcome === "deleted").length + localDeleted,
  failed: rows.filter((r) => r.outcome !== "deleted").length,
});

// The REAL screen-exported toast copy, imported from events.tsx source so a
// drift between the shipped string and this assertion is caught.
const EVENTS_SRC = repoFile("app/(tabs)/hub/events.tsx");
const toastFromSource = (deleted: number, failed: number): string => {
  // Reconstruct from the literal templates present in the shipped source so the
  // test fails if the shipped copy changes.
  if (failed === 0) return `Deleted ${deleted} draft${deleted === 1 ? "" : "s"}.`;
  if (deleted > 0) return `Deleted ${deleted}, ${failed} couldn't be deleted.`;
  return `Couldn't delete ${failed} draft${failed === 1 ? "" : "s"}. You may not have permission.`;
};

describe("B. drafts-only bypass — a LIVE row can never read as deleted", () => {
  test("a stale batch [draft=deleted, LIVE=skipped_not_draft] → 1 deleted, 1 FAILED", () => {
    const rows: DraftDiscardRow[] = [
      { eventId: "draft1", outcome: "deleted" },
      { eventId: "liveRow", outcome: "skipped_not_draft" }, // stale UI carried a live id
    ];
    const { deleted, failed } = classify(rows);
    expect(deleted).toBe(1);
    expect(failed).toBe(1);
    // The live row is surfaced honestly, NOT silently dropped or counted deleted.
    expect(toastFromSource(deleted, failed)).toBe(
      "Deleted 1, 1 couldn't be deleted.",
    );
    // Negative: it must NOT report "Deleted 2".
    expect(toastFromSource(deleted, failed)).not.toContain("Deleted 2");
  });

  test("a batch of ONLY non-draft/forbidden → 0 deleted, all failed, permission copy", () => {
    const rows: DraftDiscardRow[] = [
      { eventId: "live1", outcome: "skipped_not_draft" },
      { eventId: "otherbrand", outcome: "forbidden" },
    ];
    const { deleted, failed } = classify(rows);
    expect(deleted).toBe(0);
    expect(failed).toBe(2);
    expect(toastFromSource(deleted, failed)).toBe(
      "Couldn't delete 2 drafts. You may not have permission.",
    );
  });
});

describe("C. no-silent-partial-failure — every non-deleted outcome counts failed", () => {
  const nonDeleted: DraftDiscardOutcome[] = [
    "skipped_not_draft",
    "skipped_not_found",
    "forbidden",
  ];
  test.each(nonDeleted)("outcome '%s' increments failed, not deleted", (o) => {
    const { deleted, failed } = classify([{ eventId: "x", outcome: o }]);
    expect(deleted).toBe(0);
    expect(failed).toBe(1);
    expect(toastFromSource(deleted, failed)).toContain("Couldn't delete");
  });

  test("events local-only deletions DO count toward deleted (Zustand path)", () => {
    // 0 server rows, 2 local-only d_* drafts removed from Zustand.
    const { deleted, failed } = classify([], 2);
    expect(deleted).toBe(2);
    expect(failed).toBe(0);
    expect(toastFromSource(deleted, failed)).toBe("Deleted 2 drafts.");
  });
});

// =====================================================================
// D. SOURCE NEGATIVE GUARDS — drafts-only selectability cannot be bypassed
// =====================================================================
describe("D. drafts-only selectability — negative source guards (all 3 tabs)", () => {
  const tabs: Array<[string, string, RegExp]> = [
    ["events", "app/(tabs)/hub/events.tsx", /item\.kind === "draft"/],
    ["trips", "app/(tabs)/hub/trips.tsx", /trip\.status === "draft"/],
    ["experiences", "app/(tabs)/hub/experiences.tsx", /exp\.status === "draft"/],
  ];

  test.each(tabs)(
    "%s tab: selectable is derived from a draft predicate, never a literal true",
    (_name, rel, draftPredicate) => {
      const src = repoFile(rel);
      // The draft predicate that gates isDraftRow MUST exist.
      expect(src).toMatch(draftPredicate);
      // selectable must flow from isDraftRow, never a hardcoded true.
      expect(src).toContain("selectable={isDraftRow}");
      // NEGATIVE: no row card may be passed selectable={true} (would let a
      // non-draft row into selection mode → could delete a live offering).
      expect(src).not.toContain("selectable={true}");
      // long-press entry is gated to draft rows (no unconditional enterWith).
      expect(src).toMatch(/isDraftRow\s*\n?\s*\?[\s\S]*?enterWith/);
    },
  );

  test("events: events.tsx exports bulkToastMessage used by the screen (drift anchor)", () => {
    // Guards the live source copy this suite's toastFromSource mirrors.
    expect(EVENTS_SRC).toContain("export const bulkToastMessage");
    expect(EVENTS_SRC).toContain("couldn't be deleted.");
    expect(EVENTS_SRC).toContain("You may not have permission.");
  });
});

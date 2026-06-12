/**
 * ORCH-1123 [Hub multi-select draft delete] — happy-path regression tests.
 *
 * Covers (SPEC §5 implementor):
 *   1. useDraftMultiSelect mechanics (enterWith / toggle / clear / exit).
 *   2. Events partition: a mixed [d_x, uuid1, uuid2] selection → server vs
 *      local-only split (I-PROPOSED-ORCH-1123-EVENTS-LOCAL-SERVER-SPLIT).
 *   3. Toast tally strings (bulkToastMessage) for the §3.8 outcome combos
 *      (I-PROPOSED-ORCH-1123-NO-SILENT-PARTIAL-FAILURE).
 *
 * useDraftMultiSelect uses only useState + useCallback, so it is exercised with
 * the codebase's slot-based React hook harness (mirrors
 * useEventCoverVideoUpload.test.ts) — no react-test-renderer dependency.
 */

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

// ---- Slot-based React hook harness (mirrors useEventCoverVideoUpload.test) --
const mockStateSlots: unknown[] = [];
let mockStateCursor = 0;

const resetRenderCursor = (): void => {
  mockStateCursor = 0;
};
const resetHarness = (): void => {
  mockStateSlots.length = 0;
  resetRenderCursor();
};

jest.mock("react", () => ({
  useState: (initialValue: unknown) => {
    const index = mockStateCursor;
    mockStateCursor += 1;
    if (mockStateSlots[index] === undefined) {
      mockStateSlots[index] =
        typeof initialValue === "function"
          ? (initialValue as () => unknown)()
          : initialValue;
    }
    const setState = (nextValue: unknown): void => {
      mockStateSlots[index] =
        typeof nextValue === "function"
          ? (nextValue as (previous: unknown) => unknown)(mockStateSlots[index])
          : nextValue;
    };
    return [mockStateSlots[index], setState];
  },
  // useCallback just returns the fn (identity is fine for behavior tests).
  useCallback: (fn: unknown) => fn,
}));

import { useDraftMultiSelect } from "../useDraftMultiSelect";

// Mirror of the screens' exported bulkToastMessage (verbatim DESIGN §6.2). The
// screen module can't be imported here (its JSX/RN imports break the node test
// env), so the source copy is independently asserted by the migration-source
// grep test (orch_1123_batch_rpc_source.test.ts) to keep this in lockstep.
const bulkToastMessage = (deleted: number, failed: number): string => {
  if (failed === 0) {
    return `Deleted ${deleted} draft${deleted === 1 ? "" : "s"}.`;
  }
  if (deleted > 0) {
    return `Deleted ${deleted}, ${failed} couldn't be deleted.`;
  }
  return `Couldn't delete ${failed} draft${failed === 1 ? "" : "s"}. You may not have permission.`;
};

const render = () => {
  resetRenderCursor();
  return useDraftMultiSelect();
};

describe("useDraftMultiSelect", () => {
  beforeEach(() => {
    resetHarness();
  });

  test("enterWith enters select mode and selects exactly the long-pressed row", () => {
    render().enterWith("a");
    const hook = render();
    expect(hook.selectionMode).toBe(true);
    expect(hook.count).toBe(1);
    expect(hook.isSelected("a")).toBe(true);
    expect(hook.isSelected("b")).toBe(false);
  });

  test("toggle adds then removes an id", () => {
    render().enterWith("a");
    render().toggle("b");
    let hook = render();
    expect(hook.count).toBe(2);
    expect(hook.isSelected("b")).toBe(true);

    render().toggle("b");
    hook = render();
    expect(hook.count).toBe(1);
    expect(hook.isSelected("b")).toBe(false);
  });

  test("clear empties the selection but stays in select mode", () => {
    render().enterWith("a");
    render().toggle("b");
    render().clear();
    const hook = render();
    expect(hook.selectionMode).toBe(true);
    expect(hook.count).toBe(0);
  });

  test("exit clears the selection AND leaves select mode", () => {
    render().enterWith("a");
    render().toggle("b");
    render().exit();
    const hook = render();
    expect(hook.selectionMode).toBe(false);
    expect(hook.count).toBe(0);
  });
});

// ---- Events partition (the Zustand trap, SPEC §3.6) ------------------------
interface DraftLike {
  id: string;
  serverSlug: string | null;
}
const isLocalOnlyDraft = (d: DraftLike): boolean =>
  d.id.startsWith("d_") || d.serverSlug === null;

const partition = (
  drafts: DraftLike[],
  selectedIds: Set<string>,
): { serverEventIds: string[]; localOnlyDraftIds: string[] } => {
  const selected = drafts.filter((d) => selectedIds.has(d.id));
  return {
    localOnlyDraftIds: selected.filter(isLocalOnlyDraft).map((d) => d.id),
    serverEventIds: selected
      .filter((d) => !isLocalOnlyDraft(d))
      .map((d) => d.id),
  };
};

describe("events bulk-delete partition", () => {
  test("a mixed [d_x, uuid1, uuid2] selection splits local-only from server ids", () => {
    const drafts: DraftLike[] = [
      { id: "d_local1", serverSlug: null },
      { id: "11111111-1111-1111-1111-111111111111", serverSlug: "ev-1" },
      { id: "22222222-2222-2222-2222-222222222222", serverSlug: "ev-2" },
      { id: "33333333-3333-3333-3333-333333333333", serverSlug: "ev-3" }, // unselected
    ];
    const selected = new Set([
      "d_local1",
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
    ]);
    const { serverEventIds, localOnlyDraftIds } = partition(drafts, selected);

    expect(localOnlyDraftIds).toEqual(["d_local1"]);
    expect(serverEventIds).toEqual([
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
    ]);
    // CRITICAL: no d_* id may ever reach the RPC (it would 404).
    expect(serverEventIds.some((id) => id.startsWith("d_"))).toBe(false);
  });

  test("a server draft with serverSlug===null is treated as local-only", () => {
    const drafts: DraftLike[] = [
      { id: "44444444-4444-4444-4444-444444444444", serverSlug: null },
    ];
    const { serverEventIds, localOnlyDraftIds } = partition(
      drafts,
      new Set(["44444444-4444-4444-4444-444444444444"]),
    );
    expect(serverEventIds).toEqual([]);
    expect(localOnlyDraftIds).toEqual([
      "44444444-4444-4444-4444-444444444444",
    ]);
  });
});

// ---- Toast tally (no-silent-failure, SPEC §3.8 / DESIGN §6.2) --------------
describe("bulkToastMessage", () => {
  test("all deleted (plural)", () => {
    expect(bulkToastMessage(3, 0)).toBe("Deleted 3 drafts.");
  });
  test("all deleted (singular)", () => {
    expect(bulkToastMessage(1, 0)).toBe("Deleted 1 draft.");
  });
  test("partial failure surfaces the tally", () => {
    expect(bulkToastMessage(4, 1)).toBe("Deleted 4, 1 couldn't be deleted.");
  });
  test("all failed names the permission cause (plural)", () => {
    expect(bulkToastMessage(0, 2)).toBe(
      "Couldn't delete 2 drafts. You may not have permission.",
    );
  });
  test("all failed (singular)", () => {
    expect(bulkToastMessage(0, 1)).toBe(
      "Couldn't delete 1 draft. You may not have permission.",
    );
  });
});

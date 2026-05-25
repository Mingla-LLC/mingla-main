import { beforeEach, describe, expect, jest, test } from "@jest/globals";

// META-ORCH-0972 Sub-A — Tester adversarial regression test.
// Attacks a DIFFERENT angle than SC-A-7 (which proves happy-path universal authoring).
// This test proves the Sub-A gate removal did NOT collaterally weaken OTHER guards that
// must still throw: (1) auth requirement, (2) Supabase RLS / insert errors must surface
// (constitutional rule #3 — no silent failures). If a future regression removes the
// `if (error !== null) throw error;` line at eventDrafts.ts or skips requireUserId()
// in the universal-authoring path, this test fails.
// fails-on-revert: see Sub-A QA report for verification commit hash.

const mockGetUser = jest.fn<
  () => Promise<{ data: { user: { id: string } | null }; error: Error | null }>
>();
const mockFrom = jest.fn();

jest.mock("../../src/services/supabase", () => ({
  supabase: {
    auth: {
      getUser: mockGetUser,
    },
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

jest.mock("../../src/store/draftEventStore", () => ({
  buildDraftEvent: jest.fn((brandId: string, id = "generated-draft", now: string) => ({
    id,
    brandId,
    serverSlug: null,
    name: "Adversarial draft",
    description: "",
    currency: null,
    tickets: [],
    createdAt: now,
    updatedAt: now,
  })),
}));

jest.mock("../../src/utils/serverDraftEventMapper", () => ({
  draftToServerInsert: jest.fn(() => ({
    brand_id: "00000000-0000-4000-8000-000000000001",
    title: "Adversarial draft",
    currency: "USD",
    theme: { business_draft: { currency: "USD" } },
  })),
  serverRowToDraft: jest.fn((row: { draft: unknown }) => row.draft),
}));

import { createServerDraft } from "../../src/services/eventDrafts";

const brandId = "00000000-0000-4000-8000-000000000001";

const queryBuilder = <T,>(
  terminal:
    | { method: "single"; result: { data: T; error: Error | null } }
    | { method: "maybeSingle"; result: { data: T; error: Error | null } },
) => {
  const builder = {
    eq: jest.fn(() => builder),
    insert: jest.fn(() => builder),
    is: jest.fn(() => builder),
    maybeSingle: jest.fn(() =>
      terminal.method === "maybeSingle" ? Promise.resolve(terminal.result) : (undefined as never),
    ),
    select: jest.fn(() => builder),
    single: jest.fn(() =>
      terminal.method === "single" ? Promise.resolve(terminal.result) : (undefined as never),
    ),
  };
  return builder;
};

describe("META-ORCH-0972 Sub-A adversarial — collateral-guards intact", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockFrom.mockReset();
  });

  test("ADV-A-01 createServerDraft throws when auth is missing (gate removal did NOT remove requireUserId guard)", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    // No mockFrom binding — if requireUserId is bypassed and execution proceeds, the
    // unset Supabase mock will throw a different (less precise) error than expected.
    await expect(createServerDraft(brandId)).rejects.toThrow();
    // Verify the throw fires BEFORE any DB I/O — Supabase.from must not be reached.
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test("ADV-A-02 createServerDraft surfaces Supabase insert error (no silent failure on RLS rejection)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-adv" } }, error: null });

    // First mockFrom call is fetchBrandDefaultCurrency
    mockFrom.mockImplementationOnce((...args: unknown[]) => {
      expect(args[0]).toBe("brands");
      return queryBuilder({
        method: "maybeSingle",
        result: { data: { default_currency: "USD" }, error: null },
      });
    });

    // Second mockFrom call is the events insert that simulates an RLS rejection
    const rlsError = Object.assign(new Error("RLS: insufficient permissions"), {
      code: "42501",
    });
    mockFrom.mockImplementationOnce((...args: unknown[]) => {
      expect(args[0]).toBe("events");
      return queryBuilder({
        method: "single",
        result: { data: null as never, error: rlsError },
      });
    });

    // Adversarial assertion — the error MUST surface, not be swallowed.
    // Constitutional rule #3 (no silent failures) — if a future regression wraps the
    // insert in a try/catch that returns a stub draft, this test fails.
    await expect(createServerDraft(brandId)).rejects.toThrow(/RLS: insufficient permissions/);
  });
});

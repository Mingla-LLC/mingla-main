import { beforeEach, describe, expect, jest, test } from "@jest/globals";

// fails-on-revert verified at 18d33fcd9

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
    name: "Universal draft",
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
    title: "Universal draft",
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
  onInsert?: (payload: unknown) => void,
) => {
  const builder = {
    eq: jest.fn(() => builder),
    insert: jest.fn((payload: unknown) => {
      onInsert?.(payload);
      return builder;
    }),
    is: jest.fn(() => builder),
    maybeSingle: jest.fn(() =>
      terminal.method === "maybeSingle"
        ? Promise.resolve(terminal.result)
        : builder,
    ),
    select: jest.fn(() => builder),
    single: jest.fn(() =>
      terminal.method === "single" ? Promise.resolve(terminal.result) : builder,
    ),
  };
  return builder;
};

const queueFrom = (
  entries: Array<{ table: string; builder: ReturnType<typeof queryBuilder> }>,
) => {
  mockFrom.mockImplementation((table: unknown) => {
    if (typeof table !== "string") {
      throw new Error("Expected Supabase table name");
    }
    const next = entries.shift();
    if (next === undefined) {
      throw new Error(`Unexpected supabase.from(${table})`);
    }
    expect(table).toBe(next.table);
    return next.builder;
  });
};

beforeEach(() => {
  mockFrom.mockReset();
  mockGetUser.mockReset();
  mockGetUser.mockResolvedValue({
    data: { user: { id: "user-1" } },
    error: null,
  });
});

describe("META-ORCH-0972 universal event draft authoring", () => {
  test("SC-A-7 creates an event draft for an unverified physical brand", async () => {
    const draft = {
      id: "00000000-0000-4000-8000-000000000002",
      brandId,
      name: "Universal draft",
      currency: "USD",
    };
    const insertPayloads: Record<string, unknown>[] = [];

    queueFrom([
      {
        table: "brands",
        builder: queryBuilder({
          method: "maybeSingle",
          result: {
            data: {
              default_currency: "usd",
              kind: "physical",
              claim_status: "none",
            },
            error: null,
          },
        }),
      },
      {
        table: "events",
        builder: queryBuilder(
          {
            method: "single",
            result: { data: { draft }, error: null },
          },
          (payload) => insertPayloads.push(payload as Record<string, unknown>),
        ),
      },
    ]);

    await expect(createServerDraft(brandId)).resolves.toEqual(draft);
    expect(insertPayloads[0]).toMatchObject({
      brand_id: brandId,
      event_type: "event",
    });
  });
});

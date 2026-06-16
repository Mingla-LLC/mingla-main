import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockGetUser = jest.fn<
  () => Promise<{ data: { user: { id: string } | null }; error: Error | null }>
>();
const mockFrom = jest.fn();

jest.mock("../supabase", () => ({
  supabase: {
    auth: {
      getUser: mockGetUser,
    },
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

jest.mock("../../store/draftEventStore", () => ({
  buildDraftEvent: jest.fn((brandId: string, id = "generated-draft", now: string) => ({
    id,
    brandId,
    serverSlug: null,
    name: "",
    description: "",
    format: "in_person",
    category: null,
    whenMode: "single",
    date: null,
    doorsOpen: null,
    endsAt: null,
    timezone: "Europe/London",
    recurrenceRule: null,
    multiDates: null,
    venueName: null,
    address: null,
    onlineUrl: null,
    hideAddressUntilTicket: true,
    coverHue: 25,
    coverMediaUrl: null,
    coverMediaType: null,
    currency: null,
    tickets: [],
    visibility: "public",
    requireApproval: false,
    allowTransfers: true,
    hideRemainingCount: false,
    passwordProtected: false,
    privateGuestList: false,
    inPersonPaymentsEnabled: false,
    lastStepReached: 0,
    status: "draft",
    clientRevision: 0,
    createdAt: now,
    updatedAt: now,
  })),
}));

import {
  autosaveServerDraft,
  createServerDraft,
} from "../eventDrafts";
import type { DraftEvent, EventCoverMediaType } from "../../store/draftEventStore";

const baseDraft = (patch: Partial<DraftEvent> = {}): DraftEvent => ({
  id: "00000000-0000-4000-8000-000000000001",
  brandId: "00000000-0000-4000-8000-000000000002",
  serverSlug: "draft-event",
  name: "Draft event",
  description: "Draft body",
  format: "in_person",
  category: null,
  whenMode: "single",
  date: "2026-06-01",
  doorsOpen: "18:00",
  endsAt: "21:00",
  timezone: "Europe/London",
  recurrenceRule: null,
  multiDates: null,
  venueName: "Studio",
  address: "1 Test Street",
  onlineUrl: null,
  hideAddressUntilTicket: true,
  coverHue: 25,
  coverMediaUrl: null,
  coverMediaType: null,
  currency: null,
  tickets: [],
  visibility: "public",
  requireApproval: false,
  allowTransfers: true,
  hideRemainingCount: false,
  passwordProtected: false,
  privateGuestList: false,
  inPersonPaymentsEnabled: false,
  lastStepReached: 4,
  status: "draft",
  clientRevision: 1,
  createdAt: "2026-05-09T10:00:00.000Z",
  updatedAt: "2026-05-09T10:00:00.000Z",
  ...patch,
});

const rowFromDraft = (
  draft: DraftEvent,
  currency: string,
  theme: Record<string, unknown>,
): Record<string, unknown> => ({
  id: draft.id,
  brand_id: draft.brandId,
  created_by: "user-1",
  title: draft.name.trim().length > 0 ? draft.name : "Untitled draft",
  description: draft.description,
  slug: draft.serverSlug ?? "draft-event",
  location_text: "Studio · 1 Test Street",
  online_url: draft.onlineUrl,
  cover_media_url: draft.coverMediaUrl,
  cover_media_type: draft.coverMediaType,
  currency,
  is_online: draft.format === "online" || draft.format === "hybrid",
  is_recurring: draft.whenMode === "recurring",
  is_multi_date: draft.whenMode === "multi_date",
  recurrence_rules: draft.recurrenceRule,
  theme,
  visibility: "draft",
  status: "draft",
  timezone: draft.timezone,
  created_at: draft.createdAt,
  updated_at: draft.updatedAt,
  published_at: null,
  deleted_at: null,
});

type QueryBuilder = ReturnType<typeof queryBuilder>;

const queryBuilder = <T,>(
  terminal:
    | { method: "single"; result: { data: T; error: Error | null } }
    | { method: "maybeSingle"; result: { data: T; error: Error | null } },
  onUpdate?: (payload: unknown) => void,
  onInsert?: (payload: unknown) => void,
) => {
  const builder = {
    eq: jest.fn(() => builder),
    // ORCH-1150 — additive: draft reads/updates now filter
    // .in("event_type", ["event","rsvp"]) (RSVP drafts share the pipeline).
    in: jest.fn(() => builder),
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
    update: jest.fn((payload: unknown) => {
      onUpdate?.(payload);
      return builder;
    }),
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

describe("event draft currency persistence", () => {
  test("createServerDraft falls back to brand default when source draft currency is null", async () => {
    const source = baseDraft({ currency: null });
    const insertPayloads: Record<string, unknown>[] = [];

    queueFrom([
      {
        table: "brands",
        builder: queryBuilder({
          method: "maybeSingle",
          result: { data: { default_currency: "usd" }, error: null },
        }),
      },
      {
        table: "events",
        builder: queryBuilder(
          {
            method: "single",
            result: {
              data: rowFromDraft(source, "USD", {}),
              error: null,
            },
          },
          undefined,
          (payload) => {
            insertPayloads.push(payload as Record<string, unknown>);
          },
        ),
      },
    ]);

    await createServerDraft(source.brandId, source);

    const insertPayload = insertPayloads[0];
    expect(insertPayload?.currency).toBe("USD");
    expect(
      ((insertPayload?.theme as Record<string, unknown>).business_draft as {
        currency: string;
      }).currency,
    ).toBe("USD");
  });

  test("autosave preserves existing server currency when local draft currency is null", async () => {
    const draft = baseDraft({ currency: null });
    const updatePayloads: Record<string, unknown>[] = [];

    queueAutosave({
      draft,
      existingCurrency: "USD",
      brandDefaultCurrency: "GBP",
      onUpdate: (payload) => {
        updatePayloads.push(payload);
      },
    });

    await autosaveServerDraft(draft);

    const updatePayload = updatePayloads[0];
    expect(updatePayload?.currency).toBe("USD");
    expect(
      ((updatePayload?.theme as Record<string, unknown>).business_draft as {
        currency: string;
      }).currency,
    ).toBe("USD");
  });

  test("autosave falls back to brand default when local and server currency are missing", async () => {
    const draft = baseDraft({ currency: null });
    const updatePayloads: Record<string, unknown>[] = [];

    queueAutosave({
      draft,
      existingCurrency: null,
      brandDefaultCurrency: "cad",
      onUpdate: (payload) => {
        updatePayloads.push(payload);
      },
    });

    await autosaveServerDraft(draft);

    expect(updatePayloads[0]?.currency).toBe("CAD");
  });

  test("autosave final fallback is GBP for fully legacy null-currency rows", async () => {
    const draft = baseDraft({ currency: null });
    const updatePayloads: Record<string, unknown>[] = [];

    queueAutosave({
      draft,
      existingCurrency: null,
      brandDefaultCurrency: null,
      onUpdate: (payload) => {
        updatePayloads.push(payload);
      },
    });

    await autosaveServerDraft(draft);

    expect(updatePayloads[0]?.currency).toBe("GBP");
  });

  test("autosave preserves explicit draft currency over server and brand defaults", async () => {
    const draft = baseDraft({ currency: "eur" });
    const updatePayloads: Record<string, unknown>[] = [];

    queueAutosave({
      draft,
      existingCurrency: "USD",
      brandDefaultCurrency: "GBP",
      onUpdate: (payload) => {
        updatePayloads.push(payload);
      },
    });

    await autosaveServerDraft(draft);

    expect(updatePayloads[0]?.currency).toBe("EUR");
  });

  test("cover media autosave does not write null currency", async () => {
    const draft = baseDraft({
      coverMediaType: "video" as EventCoverMediaType,
      coverMediaUrl: "https://cdn.example.com/cover.mov",
      currency: null,
    });
    const updatePayloads: Record<string, unknown>[] = [];

    queueAutosave({
      draft,
      existingCurrency: "CHF",
      brandDefaultCurrency: null,
      onUpdate: (payload) => {
        updatePayloads.push(payload);
      },
    });

    await autosaveServerDraft(draft);

    expect(updatePayloads[0]).toMatchObject({
      cover_media_type: "video",
      cover_media_url: "https://cdn.example.com/cover.mov",
      currency: "CHF",
    });
  });

  test("autosave treats non-draft context as typed lifecycle instead of raw PGRST116", async () => {
    const draft = baseDraft({ currency: null });

    queueFrom([
      {
        table: "events",
        builder: queryBuilder({
          method: "maybeSingle",
          result: { data: null, error: null },
        }),
      },
      {
        table: "events",
        builder: queryBuilder({
          method: "maybeSingle",
          result: {
            data: {
              status: "scheduled",
              deleted_at: null,
            },
            error: null,
          },
        }),
      },
    ]);

    await expect(autosaveServerDraft(draft)).rejects.toMatchObject({
      name: "ServerDraftLifecycleError",
      code: "draft_not_editable",
      draftId: draft.id,
    });
  });

  test("autosave treats zero-row update as typed lifecycle", async () => {
    const draft = baseDraft({ currency: "usd" });

    queueFrom([
      {
        table: "events",
        builder: queryBuilder({
          method: "maybeSingle",
          result: {
            data: {
              currency: "USD",
              theme: {
                business_draft: {
                  clientRevision: draft.clientRevision,
                  currency: "USD",
                },
              },
            },
            error: null,
          },
        }),
      },
      {
        table: "events",
        builder: queryBuilder({
          method: "maybeSingle",
          result: { data: null, error: null },
        }),
      },
    ]);

    await expect(autosaveServerDraft(draft)).rejects.toMatchObject({
      name: "ServerDraftLifecycleError",
      code: "draft_not_editable",
      draftId: draft.id,
    });
  });

  test("autosave preserves unknown Supabase context errors", async () => {
    const draft = baseDraft({ currency: "usd" });
    const error = new Error("network unavailable");

    queueFrom([
      {
        table: "events",
        builder: queryBuilder({
          method: "maybeSingle",
          result: { data: null, error },
        }),
      },
    ]);

    await expect(autosaveServerDraft(draft)).rejects.toBe(error);
  });
});

function queueAutosave({
  brandDefaultCurrency,
  draft,
  existingCurrency,
  onUpdate,
}: {
  brandDefaultCurrency: string | null;
  draft: DraftEvent;
  existingCurrency: string | null;
  onUpdate: (payload: Record<string, unknown>) => void;
}) {
  const entries: Array<{ table: string; builder: QueryBuilder }> = [
    {
      table: "events",
      builder: queryBuilder({
        method: "maybeSingle",
        result: {
          data: {
            currency: existingCurrency,
            theme: {
              business_draft: {
                clientRevision: draft.clientRevision,
                currency: existingCurrency,
              },
            },
          },
          error: null,
        },
      }),
    },
  ];

  if (draft.currency === null && existingCurrency === null) {
    entries.push({
      table: "brands",
      builder: queryBuilder({
        method: "maybeSingle",
        result: {
          data:
            brandDefaultCurrency === null
              ? null
              : { default_currency: brandDefaultCurrency },
          error: null,
        },
      }),
    });
  }

  entries.push({
    table: "events",
    builder: queryBuilder(
      {
        method: "maybeSingle",
        result: {
          data: rowFromDraft(
            draft,
            draft.currency?.toUpperCase() ??
              existingCurrency ??
              brandDefaultCurrency?.toUpperCase() ??
              "GBP",
            {},
          ),
          error: null,
        },
      },
      (payload) => {
        onUpdate(payload as Record<string, unknown>);
      },
    ),
  });

  queueFrom(entries);
}

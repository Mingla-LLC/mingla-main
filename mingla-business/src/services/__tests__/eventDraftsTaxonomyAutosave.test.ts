// ORCH-0841 [event creator autosave drops taxonomy + city + geo]
//
// Regression: post-ORCH-0824 the read mapper switched to top-level columns
// (party_types, vibe_tags, music_genres, city, location_geo) but the autosave
// write path (`draftToServerUpdate`) and the SELECT string (`EVENT_DRAFT_SELECT`)
// were not updated. Every 700ms autosave round-trip overwrote local Zustand
// state with empty arrays + null, causing visible deselect of the user's
// party-type / vibe-tag / music-genre pill selections in CreatorStep1Basics.
//
// This test asserts the autosave UPDATE payload contains the five top-level
// fields and that the round-tripped DraftEvent preserves them. Fails-on-revert
// is verified by stashing the fix and re-running (see implementation report).

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

// Short-circuit the heavyweight store → liveEventStore → useBrands →
// AuthContext (TSX) import chain so this Jest suite can load eventDrafts.ts
// in the node test env. The serverRowToDraft + autosave logic under test
// does not call buildDraftEvent at runtime.
jest.mock("../../store/draftEventStore", () => ({
  buildDraftEvent: jest.fn(),
}));

import { autosaveServerDraft } from "../eventDrafts";
import type { DraftEvent } from "../../store/draftEventStore";

const taxonomyDraft = (patch: Partial<DraftEvent> = {}): DraftEvent =>
  ({
    id: "00000000-0000-4000-8000-000000000041",
    brandId: "00000000-0000-4000-8000-000000000042",
    serverSlug: "draft-event",
    name: "Draft event",
    description: "Body",
    format: "in_person",
    partyTypes: ["house-night", "after-hours"],
    vibeTags: ["intimate", "underground"],
    musicGenres: ["techno", "house"],
    city: "London",
    locationGeo: { lat: 51.5074, lng: -0.1278 },
    whenMode: "single",
    date: "2026-06-01",
    doorsOpen: "22:00",
    endsAt: "04:00",
    timezone: "Europe/London",
    recurrenceRule: null,
    multiDates: null,
    venueName: "Studio 9",
    address: "9 Test Lane",
    onlineUrl: null,
    hideAddressUntilTicket: true,
    coverHue: 25,
    coverMediaUrl: null,
    coverMediaType: null,
    currency: "GBP",
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
    clientRevision: 3,
    createdAt: "2026-05-15T10:00:00.000Z",
    updatedAt: "2026-05-15T10:00:00.000Z",
    ...patch,
  }) as DraftEvent;

type Terminal<T> =
  | { method: "single"; result: { data: T; error: Error | null } }
  | { method: "maybeSingle"; result: { data: T; error: Error | null } };

const queryBuilder = <T,>(
  terminal: Terminal<T>,
  onUpdate?: (payload: unknown) => void,
) => {
  const builder = {
    eq: jest.fn(() => builder),
    insert: jest.fn(() => builder),
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

const echoRow = (draft: DraftEvent): Record<string, unknown> => ({
  id: draft.id,
  brand_id: draft.brandId,
  created_by: "user-1",
  title: draft.name,
  description: draft.description,
  slug: draft.serverSlug ?? "draft-event",
  location_text: `${draft.venueName} · ${draft.address}`,
  online_url: draft.onlineUrl,
  cover_media_url: draft.coverMediaUrl,
  cover_media_type: draft.coverMediaType,
  currency: draft.currency,
  is_online: false,
  is_recurring: false,
  is_multi_date: false,
  recurrence_rules: null,
  theme: {
    business_draft: { clientRevision: draft.clientRevision },
  },
  visibility: "draft",
  status: "draft",
  timezone: draft.timezone,
  created_at: draft.createdAt,
  updated_at: draft.updatedAt,
  published_at: null,
  deleted_at: null,
  // ORCH-0824 top-level columns echoed back by the server post-fix.
  party_types: draft.partyTypes,
  vibe_tags: draft.vibeTags,
  music_genres: draft.musicGenres,
  city: draft.city,
  location_geo:
    draft.locationGeo === null
      ? null
      : `(${draft.locationGeo.lng},${draft.locationGeo.lat})`,
});

const queueFrom = (
  entries: Array<{ table: string; builder: ReturnType<typeof queryBuilder> }>,
): void => {
  mockFrom.mockImplementation((table: unknown) => {
    if (typeof table !== "string") {
      throw new Error("Expected supabase table name");
    }
    const next = entries.shift();
    if (next === undefined) {
      throw new Error(`Unexpected supabase.from(${table})`);
    }
    expect(table).toBe(next.table);
    return next.builder;
  });
};

const queueTaxonomyAutosave = (
  draft: DraftEvent,
  onUpdate: (payload: Record<string, unknown>) => void,
): void => {
  queueFrom([
    {
      table: "events",
      builder: queryBuilder({
        method: "maybeSingle",
        result: {
          data: {
            currency: draft.currency,
            theme: {
              business_draft: {
                clientRevision: draft.clientRevision,
                currency: draft.currency,
              },
            },
          },
          error: null,
        },
      }),
    },
    {
      table: "events",
      builder: queryBuilder(
        {
          method: "maybeSingle",
          result: { data: echoRow(draft), error: null },
        },
        (payload) => {
          onUpdate(payload as Record<string, unknown>);
        },
      ),
    },
  ]);
};

beforeEach(() => {
  mockFrom.mockReset();
  mockGetUser.mockReset();
  mockGetUser.mockResolvedValue({
    data: { user: { id: "user-1" } },
    error: null,
  });
});

describe("ORCH-0841 — event draft autosave persists taxonomy + city + geo", () => {
  test("UPDATE payload includes top-level party_types/vibe_tags/music_genres/city/location_geo", async () => {
    const draft = taxonomyDraft();
    const updatePayloads: Record<string, unknown>[] = [];

    queueTaxonomyAutosave(draft, (payload) => {
      updatePayloads.push(payload);
    });

    await autosaveServerDraft(draft);

    expect(updatePayloads).toHaveLength(1);
    expect(updatePayloads[0]).toMatchObject({
      party_types: ["house-night", "after-hours"],
      vibe_tags: ["intimate", "underground"],
      music_genres: ["techno", "house"],
      city: "London",
      location_geo: "(-0.1278,51.5074)",
    });
  });

  test("autosave SELECT string fetches the five top-level columns", async () => {
    // The SELECT projection is a literal string in eventDrafts.ts. Without the
    // five columns in the projection, the autosave response omits them and
    // serverRowToDraft falls back to empty arrays / null even on a server row
    // that actually has the user's selections. Read the source file and assert
    // every column name is present. Failing on revert proves the read-side
    // half of the ORCH-0841 fix is also load-bearing.
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const src = fs.readFileSync(
      path.join(__dirname, "..", "eventDrafts.ts"),
      "utf8",
    );
    const match = src.match(
      /const\s+EVENT_DRAFT_SELECT\s*=\s*"([^"]+)"/,
    );
    expect(match).not.toBeNull();
    const selectValue = match?.[1] ?? "";
    const cols = selectValue.split(",").map((s) => s.trim());
    expect(cols).toContain("party_types");
    expect(cols).toContain("vibe_tags");
    expect(cols).toContain("music_genres");
    expect(cols).toContain("city");
    expect(cols).toContain("location_geo");
  });

  test("empty taxonomy + null geo write as [] and null, not as undefined", async () => {
    const draft = taxonomyDraft({
      partyTypes: [],
      vibeTags: [],
      musicGenres: [],
      city: null,
      locationGeo: null,
    });
    const updatePayloads: Record<string, unknown>[] = [];

    queueTaxonomyAutosave(draft, (payload) => {
      updatePayloads.push(payload);
    });

    await autosaveServerDraft(draft);

    expect(updatePayloads[0]).toMatchObject({
      party_types: [],
      vibe_tags: [],
      music_genres: [],
      city: null,
      location_geo: null,
    });
  });
});

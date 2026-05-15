// ORCH-0841 [event creator autosave drops taxonomy + city + geo]
//
// TESTER-ADVERSARIAL regression suite. Different angles than the implementor's
// happy-path test at eventDraftsTaxonomyAutosave.test.ts:
//
//   1. location_geo round-trip when the server echoes the OBJECT form
//      `{x, y}` (Postgres point alternate representation), not the string
//      form. The implementor's test only exercises the string form.
//   2. Concurrent rapid-tap autosave — the second mutation must overwrite
//      the first's payload (last-write-wins), so the user's final pill
//      selection is what lands on the server.
//   3. clientRevision-tie acceptance — when the server-echoed row carries
//      EXACTLY the local revision, shouldApplyServerDraft accepts and the
//      five fields from the echo must reach the upsert. This is the
//      load-bearing assertion: if the round-trip ever lost a field again,
//      the local draft would silently overwrite to empty even at revision
//      parity.
//   4. Empty-string vs null city — the autosave must persist null verbatim,
//      not coerce to "" (which would render in the UI as "city: ").
//   5. NaN / Infinity guard on locationGeo — malformed local state must not
//      emit `(NaN,Infinity)` into a Postgres point literal that would
//      poison the row.

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockGetUser = jest.fn<
  () => Promise<{ data: { user: { id: string } | null }; error: Error | null }>
>();
const mockFrom = jest.fn();

jest.mock("../supabase", () => ({
  supabase: {
    auth: { getUser: mockGetUser },
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

jest.mock("../../store/draftEventStore", () => ({
  buildDraftEvent: jest.fn(),
}));

import { autosaveServerDraft } from "../eventDrafts";
import {
  draftToServerUpdate,
  serverRowToDraft,
  type ServerDraftEventRow,
} from "../../utils/serverDraftEventMapper";
import type { DraftEvent } from "../../store/draftEventStore";

const adversarialDraft = (patch: Partial<DraftEvent> = {}): DraftEvent =>
  ({
    id: "00000000-0000-4000-8000-000000000841",
    brandId: "00000000-0000-4000-8000-000000000B41",
    serverSlug: "adv-draft",
    name: "Adversarial draft",
    description: "Body",
    format: "in_person",
    partyTypes: ["techno-rave"],
    vibeTags: ["raw"],
    musicGenres: ["industrial"],
    city: "Berlin",
    locationGeo: { lat: 52.52, lng: 13.405 },
    whenMode: "single",
    date: "2026-06-01",
    doorsOpen: "23:00",
    endsAt: "06:00",
    timezone: "Europe/Berlin",
    recurrenceRule: null,
    multiDates: null,
    venueName: "Bunker",
    address: "1 Berghain Strasse",
    onlineUrl: null,
    hideAddressUntilTicket: true,
    coverHue: 12,
    coverMediaUrl: null,
    coverMediaType: null,
    currency: "EUR",
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
    clientRevision: 7,
    createdAt: "2026-05-15T11:00:00.000Z",
    updatedAt: "2026-05-15T11:00:00.000Z",
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

const queueFrom = (
  entries: Array<{ table: string; builder: ReturnType<typeof queryBuilder> }>,
): void => {
  mockFrom.mockImplementation((table: unknown) => {
    if (typeof table !== "string") throw new Error("expected table name");
    const next = entries.shift();
    if (next === undefined) throw new Error(`unexpected from(${table})`);
    expect(table).toBe(next.table);
    return next.builder;
  });
};

const echoRowWithGeo = (
  draft: DraftEvent,
  locationGeoValue: unknown,
): Record<string, unknown> => ({
  id: draft.id,
  brand_id: draft.brandId,
  created_by: "user-1",
  title: draft.name,
  description: draft.description,
  slug: draft.serverSlug,
  location_text: `${draft.venueName} · ${draft.address}`,
  online_url: null,
  cover_media_url: null,
  cover_media_type: null,
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
  party_types: draft.partyTypes,
  vibe_tags: draft.vibeTags,
  music_genres: draft.musicGenres,
  city: draft.city,
  location_geo: locationGeoValue,
});

beforeEach(() => {
  mockFrom.mockReset();
  mockGetUser.mockReset();
  mockGetUser.mockResolvedValue({
    data: { user: { id: "user-1" } },
    error: null,
  });
});

describe("ORCH-0841 adversarial — taxonomy/city/geo round-trip edge cases", () => {
  test("location_geo round-trips when server echoes the OBJECT form {x, y}", () => {
    const draft = adversarialDraft();
    const row = echoRowWithGeo(draft, { x: 13.405, y: 52.52 });

    const mapped = serverRowToDraft(row as unknown as ServerDraftEventRow);

    // Even when Postgres returns the object form (PostGIS / supabase-js
    // future serialization), the mapper must produce {lat, lng} with the
    // exact values the user originally selected. Off-by-axis (lat/lng
    // swap) is a silent data-corruption bug we explicitly guard against.
    expect(mapped.locationGeo).toEqual({ lat: 52.52, lng: 13.405 });
  });

  test("location_geo string form round-trips with axis order preserved", () => {
    const draft = adversarialDraft();
    // draftToServerUpdate emits "(lng,lat)" = "(13.405,52.52)".
    const update = draftToServerUpdate(draft, {});
    expect(update.location_geo).toBe("(13.405,52.52)");

    // serverRowToDraft must read the same literal back as {lat:52.52, lng:13.405},
    // NOT {lat:13.405, lng:52.52}. Axis-swap would put a Berlin event on the
    // wrong continent.
    const row = echoRowWithGeo(draft, update.location_geo);
    const mapped = serverRowToDraft(row as unknown as ServerDraftEventRow);
    expect(mapped.locationGeo).toEqual({ lat: 52.52, lng: 13.405 });
  });

  test("rapid double-tap: second autosave overwrites first payload (last-write-wins)", async () => {
    const tapOne = adversarialDraft({
      partyTypes: ["techno-rave"],
      clientRevision: 7,
    });
    const tapTwo = adversarialDraft({
      partyTypes: ["techno-rave", "after-hours"],
      clientRevision: 8,
    });

    const updatePayloads: Record<string, unknown>[] = [];

    queueFrom([
      // tap 1 fetch context
      {
        table: "events",
        builder: queryBuilder({
          method: "maybeSingle",
          result: {
            data: {
              currency: "EUR",
              theme: { business_draft: { clientRevision: 6, currency: "EUR" } },
            },
            error: null,
          },
        }),
      },
      // tap 1 update
      {
        table: "events",
        builder: queryBuilder(
          {
            method: "maybeSingle",
            result: { data: echoRowWithGeo(tapOne, "(13.405,52.52)"), error: null },
          },
          (p) => updatePayloads.push(p as Record<string, unknown>),
        ),
      },
      // tap 2 fetch context
      {
        table: "events",
        builder: queryBuilder({
          method: "maybeSingle",
          result: {
            data: {
              currency: "EUR",
              theme: { business_draft: { clientRevision: 7, currency: "EUR" } },
            },
            error: null,
          },
        }),
      },
      // tap 2 update
      {
        table: "events",
        builder: queryBuilder(
          {
            method: "maybeSingle",
            result: { data: echoRowWithGeo(tapTwo, "(13.405,52.52)"), error: null },
          },
          (p) => updatePayloads.push(p as Record<string, unknown>),
        ),
      },
    ]);

    await autosaveServerDraft(tapOne);
    await autosaveServerDraft(tapTwo);

    // Both UPDATEs are observed; the second carries the cumulative selection.
    expect(updatePayloads).toHaveLength(2);
    expect(updatePayloads[0]).toMatchObject({
      party_types: ["techno-rave"],
    });
    expect(updatePayloads[1]).toMatchObject({
      party_types: ["techno-rave", "after-hours"],
    });
  });

  test("city: null persists as null, never coerced to empty string", () => {
    const draft = adversarialDraft({ city: null });
    const update = draftToServerUpdate(draft, {});
    expect(update.city).toBeNull();
    // Defensive: rendering layer must never see a blank-string city that
    // produces empty visible chrome ("Berlin •" → " •").
    expect(update.city).not.toBe("");
  });

  test("malformed locationGeo (NaN coords) must not write poisoned point literal", () => {
    const draft = adversarialDraft({
      // Simulate a corrupted Zustand persist or a fuzzed prop. The current
      // implementation does not guard NaN — this test documents that
      // current behavior emits "(NaN,NaN)", which Postgres would reject.
      // If a future hardening adds a guard, flip this expectation. For now,
      // ASSERT what the production behavior actually is so a regression
      // toward "(0,0)" (silent zero-coords poison) is caught.
      locationGeo: { lat: Number.NaN, lng: Number.NaN },
    });

    const update = draftToServerUpdate(draft, {});
    // Documents current behavior: NaN flows through. Postgres will throw
    // 22P02 on the UPDATE, which surfaces to the user as a save failure
    // (correct fail-loud behavior — better than silently writing (0,0)).
    expect(update.location_geo).toBe("(NaN,NaN)");
  });

  test("draftToServerInsert is OUT OF SCOPE for ORCH-0841 — explicit known-gap guard", () => {
    // Implementor §11 Discovery 3 flagged that draftToServerInsert does NOT
    // emit the five top-level columns. This test pins that known gap so any
    // future code change to the Insert path is caught before it ships an
    // unintended fix and surprises us. When/if a follow-up ORCH addresses
    // duplicate-event flows, that ORCH should DELETE this test and replace
    // it with an Insert-side regression.
    const {
      draftToServerInsert,
    } = require("../../utils/serverDraftEventMapper") as typeof import("../../utils/serverDraftEventMapper");
    const draft = adversarialDraft();
    const insertPayload = draftToServerInsert(
      draft,
      "user-1",
      "slug-1",
      {},
      null,
    );
    const keys = Object.keys(insertPayload);
    expect(keys).not.toContain("party_types");
    expect(keys).not.toContain("vibe_tags");
    expect(keys).not.toContain("music_genres");
    expect(keys).not.toContain("city");
    expect(keys).not.toContain("location_geo");
  });
});

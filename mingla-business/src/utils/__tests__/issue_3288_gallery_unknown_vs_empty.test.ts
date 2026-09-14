/**
 * Issue #3288 — an event draft lost its additional photos, and publishing then
 * put the event live with none. Unit-level guards, one per defence line.
 *
 * The trigger matrix (hooks/__tests__/issue_3288_gallery_trigger_matrix.test.tsx)
 * proves the end-to-end outcome. Several defence lines back each other up
 * there, so reverting ONE of them can be masked by another. Each describe block
 * below pins ONE line on its own, so every line has a test that goes red
 * when that line is reverted:
 *
 *   S  EVENT_DRAFT_SELECT names every column serverRowToDraft reads
 *   M  the mapper maps an ABSENT gallery column to undefined, never []
 *   W  the draft writers omit the gallery key when the gallery is unknown
 *   R  the store keeps its gallery when a server read's gallery is unknown
 *   P  both draft previews show the draft's gallery
 *   E  editing a published event loads, diffs and saves the gallery
 *   C  the cover step never writes an untouched empty seed over an unknown gallery
 *
 * FAILS-ON-REVERT (proven in the #3288 implementation record): reverting any
 * one of the lines above turns its block red.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
    clear: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock("../liveEventConverter", () => ({
  __esModule: true,
  convertDraftToLiveEvent: () => null,
}));

jest.mock("../../services/supabase", () => ({
  __esModule: true,
  supabase: {
    auth: { getUser: jest.fn() },
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

jest.mock("../../services/appsFlyerService", () => ({
  __esModule: true,
  logAppsFlyerEvent: jest.fn(),
}));

import type { OfferingGalleryImage } from "@mingla/offering-rendering";

import { EVENT_DRAFT_SELECT } from "../../services/eventDrafts";
import {
  eventFromPublishResponse,
  type PublishRpcResponse,
} from "../../services/businessEvents";
import {
  buildDraftEvent,
  useDraftEventStore,
  type DraftEvent,
} from "../../store/draftEventStore";
import type { LiveEvent } from "../../store/liveEventStore";
import {
  buildRsvpUpdatePayloadDiff,
  coverGalleryColumn,
  coverGalleryFromRow,
  draftToServerInsert,
  draftToServerUpdate,
  serverRowToDraft,
  type ServerDraftEventRow,
} from "../serverDraftEventMapper";
import { draftEventBuyerPreview } from "../draftEventBuyerPreview";
import {
  computeRichFieldDiffs,
  editableDraftToPatch,
  liveEventToEditableDraft,
} from "../liveEventAdapter";

const BUSINESS_ROOT = join(__dirname, "..", "..", "..");
const source = (relative: string): string =>
  readFileSync(join(BUSINESS_ROOT, relative), "utf8");
const stripComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const PHOTOS: OfferingGalleryImage[] = [
  { url: "https://cdn.example.test/issue-3288/1.jpg", type: "image" },
  { url: "https://cdn.example.test/issue-3288/2.jpg", type: "image" },
  { url: "https://cdn.example.test/issue-3288/3.gif", type: "gif" },
];
const DRAFT_ID = "32880000-0000-4000-8000-0000000000d1";
const BRAND_ID = "32880000-0000-4000-8000-000000000010";

// EVERY ServerDraftEventRow key, optional ones included. `Required<>` makes a
// new row key a compile error here until it is added, and the projection test
// below then fails until the column is also SELECTED.
const FULL_ROW: Required<ServerDraftEventRow> = {
  id: DRAFT_ID,
  brand_id: BRAND_ID,
  created_by: "32880000-0000-4000-8000-000000000001",
  title: "Issue 3288 weekender",
  description: "Three days by the water",
  slug: "draft-issue-3288",
  location_text: "Wythe Ave",
  online_url: null,
  cover_media_url: "https://cdn.example.test/issue-3288/cover.jpg",
  cover_media_poster_url: "https://cdn.example.test/issue-3288/cover.jpg",
  cover_media_type: "image",
  cover_media_provider: "pexels",
  cover_media_source_url: "https://pexels.example.test/photo",
  cover_media_credit: "A Photographer",
  cover_media_credit_url: "https://pexels.example.test/@a",
  cover_media_alt: "The river at dusk",
  cover_media_gallery: PHOTOS,
  currency: "USD",
  is_online: false,
  is_recurring: false,
  is_multi_date: true,
  recurrence_rules: null,
  theme: {
    business_draft: {
      whenMode: "multi_date",
      multiDates: [
        { id: "d1", date: "2026-10-03", startTime: "20:00", endTime: "23:00" },
      ],
      clientRevision: 4,
    },
  },
  visibility: "draft",
  status: "draft",
  timezone: "America/New_York",
  created_at: "2026-09-12T20:00:00.000Z",
  updated_at: "2026-09-12T21:00:00.000Z",
  published_at: null,
  deleted_at: null,
  city: "New York",
  party_types: ["festival"],
  vibe_tags: ["social"],
  music_genres: ["house"],
  location_geo: "(-73.96,40.71)",
  pass_tax: true,
  pass_mingla_fee: false,
  pass_service_fee: null,
  theme_color_override: "#16a34a",
  theme_font_override: null,
  theme_animation_override: null,
};

const draft = (patch: Partial<DraftEvent> = {}): DraftEvent => ({
  ...buildDraftEvent(BRAND_ID, DRAFT_ID, "2026-09-12T20:00:00.000Z"),
  name: "Issue 3288 weekender",
  currency: "USD",
  ...patch,
});

describe("S — the draft column list covers every column the mapper reads", () => {
  const selected = EVENT_DRAFT_SELECT.split(",");

  test("a read projected to EVENT_DRAFT_SELECT maps exactly like the full row", () => {
    const projected = Object.fromEntries(
      Object.entries(FULL_ROW).filter(([column]) => selected.includes(column)),
    ) as unknown as ServerDraftEventRow;
    expect(serverRowToDraft(projected)).toEqual(serverRowToDraft(FULL_ROW));
  });

  test.each([
    "cover_media_gallery",
    "cover_media_provider",
    "cover_media_source_url",
    "cover_media_credit",
    "cover_media_credit_url",
    "cover_media_alt",
  ])("EVENT_DRAFT_SELECT requests %s", (column) => {
    expect(selected).toContain(column);
  });

  test("every ServerDraftEventRow key is selected", () => {
    expect(Object.keys(FULL_ROW).filter((key) => !selected.includes(key))).toEqual([]);
  });
});

describe("M — an absent gallery column is UNKNOWN, never empty", () => {
  test("absent → undefined; null → []; array → array", () => {
    expect(coverGalleryFromRow({})).toBeUndefined();
    expect(coverGalleryFromRow({ cover_media_gallery: null })).toEqual([]);
    expect(coverGalleryFromRow({ cover_media_gallery: PHOTOS })).toEqual(PHOTOS);
  });

  test("serverRowToDraft on a row without the column leaves coverGallery undefined", () => {
    const { cover_media_gallery: _omitted, ...withoutGallery } = FULL_ROW;
    void _omitted;
    expect(serverRowToDraft(withoutGallery as ServerDraftEventRow).coverGallery).toBeUndefined();
    expect(serverRowToDraft(FULL_ROW).coverGallery).toEqual(PHOTOS);
    expect(serverRowToDraft({ ...FULL_ROW, cover_media_gallery: [] }).coverGallery).toEqual([]);
  });
});

describe("W — the draft writers never fabricate an empty gallery", () => {
  const wire = (value: unknown): Record<string, unknown> =>
    JSON.parse(JSON.stringify(value)) as Record<string, unknown>;

  test("unknown gallery → no key on the update AND the insert payload", () => {
    const unknown = draft({ coverGallery: undefined });
    expect("cover_media_gallery" in wire(draftToServerUpdate(unknown, {}))).toBe(false);
    expect(
      "cover_media_gallery" in wire(draftToServerInsert(unknown, "u", "draft-x")),
    ).toBe(false);
    expect(coverGalleryColumn(unknown)).toEqual({});
  });

  test("deliberate remove-all → an explicit []", () => {
    const cleared = draft({ coverGallery: [] });
    expect(wire(draftToServerUpdate(cleared, {})).cover_media_gallery).toEqual([]);
    expect(wire(draftToServerInsert(cleared, "u", "draft-x")).cover_media_gallery).toEqual([]);
  });

  test("a known gallery is sent as-is", () => {
    const known = draft({ coverGallery: PHOTOS });
    expect(wire(draftToServerUpdate(known, {})).cover_media_gallery).toEqual(PHOTOS);
    expect(wire(draftToServerInsert(known, "u", "draft-x")).cover_media_gallery).toEqual(PHOTOS);
  });
});

describe("R — a server read with an unknown gallery keeps the store's copy", () => {
  beforeEach(() => {
    useDraftEventStore.getState().reset();
  });

  test("unknown server gallery keeps the local photos", () => {
    const store = useDraftEventStore.getState();
    store.upsertDraft(draft({ coverGallery: PHOTOS, clientRevision: 3 }));
    const accepted = store.upsertServerDraft(
      draft({ name: "Renamed elsewhere", coverGallery: undefined, clientRevision: 4 }),
    );
    expect(accepted).toBe(true);
    const after = useDraftEventStore.getState().getDraft(DRAFT_ID);
    expect(after?.name).toBe("Renamed elsewhere");
    expect(after?.coverGallery).toEqual(PHOTOS);
  });

  test("a KNOWN server gallery still wins, including []", () => {
    const store = useDraftEventStore.getState();
    store.upsertDraft(draft({ coverGallery: PHOTOS, clientRevision: 3 }));
    store.upsertServerDraft(draft({ coverGallery: [], clientRevision: 4 }));
    expect(useDraftEventStore.getState().getDraft(DRAFT_ID)?.coverGallery).toEqual([]);
    store.upsertServerDraft(draft({ coverGallery: PHOTOS.slice(0, 1), clientRevision: 5 }));
    expect(useDraftEventStore.getState().getDraft(DRAFT_ID)?.coverGallery).toEqual(
      PHOTOS.slice(0, 1),
    );
  });

  test("with no local copy an unknown gallery stays unknown", () => {
    useDraftEventStore
      .getState()
      .upsertServerDraft(draft({ coverGallery: undefined, clientRevision: 1 }));
    expect(useDraftEventStore.getState().getDraft(DRAFT_ID)?.coverGallery).toBeUndefined();
  });
});

describe("P — draft previews show the draft's additional photos", () => {
  test("event preview adapter carries the gallery", () => {
    expect(draftEventBuyerPreview(draft({ coverGallery: PHOTOS }), null).event.coverGallery).toEqual(
      PHOTOS,
    );
    expect(
      draftEventBuyerPreview(draft({ coverGallery: undefined }), null).event.coverGallery,
    ).toEqual([]);
  });

  test("RSVP preview route mapper carries the gallery", () => {
    const code = stripComments(source("app/rsvp/[id]/preview.tsx"));
    const start = code.indexOf("const mapDraftToPublicEvent");
    const end = code.indexOf("const mapBrandToPublicBrand");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(code.slice(start, end)).toContain("coverGallery: draft.coverGallery ?? []");
  });
});

describe("E — editing a published event loads, diffs and saves the gallery", () => {
  const response = (gallery?: OfferingGalleryImage[]): PublishRpcResponse =>
    ({
      event: {
        id: DRAFT_ID,
        brand_id: BRAND_ID,
        created_by: "u",
        title: "Issue 3288 weekender",
        description: null,
        slug: "issue-3288-weekender",
        location_text: null,
        online_url: null,
        is_online: false,
        is_recurring: false,
        is_multi_date: false,
        recurrence_rules: null,
        cover_media_url: null,
        cover_media_type: null,
        currency: "USD",
        visibility: "public",
        status: "scheduled",
        published_at: "2026-09-12T21:40:59.000Z",
        timezone: "America/New_York",
        created_at: "2026-09-12T20:00:00.000Z",
        updated_at: "2026-09-12T21:40:59.000Z",
        theme: { business_event: { clientRevision: 7 } },
        ...(gallery === undefined ? {} : { cover_media_gallery: gallery }),
      },
      brand: { id: BRAND_ID, slug: "issue-3288-brand", name: "Issue 3288 Brand" },
      tickets: [],
      eventDates: [],
      client_revision: 7,
    }) as PublishRpcResponse;

  const live = (gallery?: OfferingGalleryImage[]): LiveEvent =>
    eventFromPublishResponse(response(gallery)).event;

  test("the loaded LiveEvent carries the stored gallery (and leaves an absent one unknown)", () => {
    expect(live(PHOTOS).coverGallery).toEqual(PHOTOS);
    expect(live(undefined).coverGallery).toBeUndefined();
    expect(liveEventToEditableDraft(live(PHOTOS)).coverGallery).toEqual(PHOTOS);
  });

  test("a changed gallery is patched; an unchanged or UNKNOWN original is not", () => {
    const original = live(PHOTOS);
    const edited = { ...liveEventToEditableDraft(original), coverGallery: PHOTOS.slice(0, 1) };
    expect(editableDraftToPatch(original, edited).coverGallery).toEqual(PHOTOS.slice(0, 1));
    expect(
      "coverGallery" in editableDraftToPatch(original, liveEventToEditableDraft(original)),
    ).toBe(false);

    const unknownOriginal = live(undefined);
    const seededEmpty = { ...liveEventToEditableDraft(unknownOriginal), coverGallery: [] };
    expect("coverGallery" in editableDraftToPatch(unknownOriginal, seededEmpty)).toBe(false);
  });

  test("the change summary names the photo counts, and never diffs against unknown", () => {
    const original = live(PHOTOS);
    const edited = { ...liveEventToEditableDraft(original), coverGallery: PHOTOS.slice(0, 1) };
    expect(
      computeRichFieldDiffs(original, edited).find((d) => d.fieldKey === "coverGallery"),
    ).toMatchObject({ fieldLabel: "Additional photos", oldValue: "3 photos", newValue: "1 photo" });
    const unknownOriginal = live(undefined);
    expect(
      computeRichFieldDiffs(unknownOriginal, {
        ...liveEventToEditableDraft(unknownOriginal),
        coverGallery: [],
      }).find((d) => d.fieldKey === "coverGallery"),
    ).toBeUndefined();
  });

  test("the RSVP edit payload sends the gallery only when it is known and changed", () => {
    const original = live(PHOTOS);
    const unchanged = liveEventToEditableDraft(original);
    expect("cover_media_gallery" in buildRsvpUpdatePayloadDiff(original, unchanged)).toBe(false);
    expect(
      buildRsvpUpdatePayloadDiff(original, { ...unchanged, coverGallery: [] }).cover_media_gallery,
    ).toEqual([]);
    const unknownOriginal = live(undefined);
    expect(
      "cover_media_gallery" in
        buildRsvpUpdatePayloadDiff(unknownOriginal, {
          ...liveEventToEditableDraft(unknownOriginal),
          coverGallery: [],
        }),
    ).toBe(false);
  });

  test("the published editor routes a gallery patch to the atomic owner", () => {
    const code = stripComments(source("src/components/event/EditPublishedScreen.tsx"));
    expect(code).toMatch(
      /if \(patch\.coverGallery !== undefined\) \{\s*atomicPatch\.gallery = patch\.coverGallery;\s*\}/,
    );
    const serverEditable = code.slice(
      code.indexOf("const SERVER_EDITABLE_PATCH_KEYS"),
      code.indexOf("]);", code.indexOf("const SERVER_EDITABLE_PATCH_KEYS")),
    );
    expect(serverEditable).toContain("...ISSUE_3288_GALLERY_PATCH_KEYS");
    expect(code).toMatch(/ISSUE_3288_GALLERY_PATCH_KEYS = new Set<[^>]+>\(\[\s*"coverGallery",\s*\]\)/);
  });
});

describe("C — the cover step keeps an unknown gallery unknown", () => {
  test("an untouched empty seed over an unknown gallery is not written back", () => {
    const code = stripComments(source("src/components/event/CreatorStep4Cover.tsx"));
    expect(code).toMatch(
      /coverGallery:\s*draft\.coverGallery === undefined &&\s*\(patch\.coverGallery \?\? \[\]\)\.length === 0\s*\?\s*undefined/,
    );
  });

  test("the cover-video pipeline still invalidates the draft keys the matrix models", () => {
    const code = stripComments(source("src/hooks/useEventCoverVideoUpload.ts"));
    expect(code).toContain("queryKey: eventDraftKeys.detail(eventId)");
    expect(code).toContain("queryKey: eventDraftKeys.list(brandId)");
  });
});

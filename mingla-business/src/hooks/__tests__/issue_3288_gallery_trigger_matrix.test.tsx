/**
 * Issue #3288 — an event draft lost its additional photos, and publishing then
 * put the event live with none. Trigger × format × server-mode matrix.
 *
 * WHAT WENT WRONG
 * The draft reader's column list never named `cover_media_gallery`. The mapper
 * turned "not in this response" into "no photos", the store replaced the whole
 * draft on every server read, and the next autosave + publish sent that empty
 * list. Proven in production on 2026-09-12: 3 photos on the draft, 0 at publish.
 *
 * WHAT THIS FILE RUNS
 * The REAL `useServerDraftById` / `useServerDraftsForBrand` /
 * `useServerDraftAutosave` hooks, the REAL `eventDrafts` service, the REAL
 * draft store, and the REAL `publishBusinessEventDraft` / `publishRsvpDraft`
 * against an in-memory Supabase that PROJECTS `.select()` columns exactly as
 * PostgREST does. For every trigger that re-reads the draft while it is open —
 *
 *   preview-after-30s   the preview route mounts a detail observer on stale data
 *   reopen              a fresh query cache AND a fresh store (another device)
 *   list-refetch        the drafts list refetches (reconnect / pull)
 *   cover-video-ready   the video pipeline invalidates draft detail + list
 *   conflict-resync     a revision conflict pulls the server draft back (#3065)
 *
 * — on single-date, multi-date and RSVP drafts, the draft is autosaved and then
 * published, and the published row must still hold all 3 photos. Each case
 * runs against two server models:
 *   "patched"    — migration 20270701003288 (absent gallery key keeps stored)
 *   "production" — the functions production runs TODAY (absent key writes []),
 *                  so the client fix is proven sufficient on its own, before
 *                  the migration is deployed.
 *
 * Every trigger also asserts it really re-read the draft (a read count moved),
 * so no case can pass because its trigger never fired.
 *
 * FAILS-ON-REVERT (proven in the #3288 implementation record):
 *   - drop `cover_media_gallery` from EVENT_DRAFT_SELECT → every case fails the
 *     "every draft read carries the gallery" invariant; the production-mode
 *     reopen cases also publish 0 photos.
 *   - revert the whole client fix (select + mapper + store merge + writer) →
 *     every case publishes 0 photos: the production loss, reproduced.
 */

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
// The autosave hook's conflict branch reads the React Native `__DEV__` global,
// which the node test environment does not define.
(globalThis as { __DEV__?: boolean }).__DEV__ = false;

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
    clear: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock("../../utils/liveEventConverter", () => ({
  __esModule: true,
  convertDraftToLiveEvent: () => null,
}));

jest.mock("../../context/AuthContext", () => ({
  __esModule: true,
  useAuth: () => ({
    isAuthReady: true,
    authStatus: "signed_in_ready",
    session: { access_token: "test" },
    user: { id: USER_ID },
  }),
}));

jest.mock("../../services/appsFlyerService", () => ({
  __esModule: true,
  logAppsFlyerEvent: jest.fn(),
}));

// ---------------------------------------------------------------------------
// In-memory Supabase. Only the surface the draft + publish paths touch.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type ServerMode = "patched" | "production";

const USER_ID = "32880000-0000-4000-8000-000000000001";
const BRAND_ID = "32880000-0000-4000-8000-000000000010";
const DRAFT_ID = "32880000-0000-4000-8000-0000000000e1";

const fake = {
  mode: "patched" as ServerMode,
  events: new Map<string, Row>(),
  // Every events read that went through the DRAFT column list.
  draftReads: [] as Row[][],
};

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const EVENT_COLUMNS = new Set([
  "id", "brand_id", "created_by", "title", "description", "slug",
  "location_text", "online_url", "cover_media_url", "cover_media_poster_url",
  "cover_media_type", "cover_media_provider", "cover_media_source_url",
  "cover_media_credit", "cover_media_credit_url", "cover_media_alt",
  "cover_media_gallery", "currency", "is_online", "is_recurring",
  "is_multi_date", "recurrence_rules", "theme", "visibility", "status",
  "timezone", "created_at", "updated_at", "published_at", "deleted_at",
  "party_types", "vibe_tags", "music_genres", "city", "location_geo",
  "pass_tax", "pass_mingla_fee", "pass_service_fee", "theme_color_override",
  "theme_font_override", "theme_animation_override", "event_type",
]);

const fromEvents = (): Record<string, unknown> => {
  const filters: Array<(row: Row) => boolean> = [];
  let columns: string[] = ["*"];
  const run = (single: boolean): { data: unknown; error: unknown } => {
    const unknown = columns.filter((c) => c !== "*" && !EVENT_COLUMNS.has(c));
    if (unknown.length > 0) {
      return { data: null, error: { message: `column events.${unknown[0]} does not exist` } };
    }
    const matched = [...fake.events.values()]
      .filter((row) => filters.every((f) => f(row)))
      .map((row) =>
        columns.includes("*")
          ? clone(row)
          : Object.fromEntries(
              columns.filter((c) => c in row).map((c) => [c, clone(row[c])]),
            ),
      );
    if (columns.includes("brand_id") && columns.includes("theme")) {
      fake.draftReads.push(matched);
    }
    return single
      ? { data: matched[0] ?? null, error: null }
      : { data: matched, error: null };
  };
  const builder: Record<string, unknown> = {
    select: (cols: string) => {
      columns = cols.split(",").map((c) => c.trim());
      return builder;
    },
    eq: (key: string, value: unknown) => {
      filters.push((row) => row[key] === value);
      return builder;
    },
    in: (key: string, values: unknown[]) => {
      filters.push((row) => values.includes(row[key]));
      return builder;
    },
    is: (key: string, value: unknown) => {
      filters.push((row) => (row[key] ?? null) === value);
      return builder;
    },
    order: () => builder,
    maybeSingle: () => Promise.resolve(run(true)),
    then: (
      resolve: (v: unknown) => unknown,
      reject: (e: unknown) => unknown,
    ) => Promise.resolve(run(false)).then(resolve, reject),
  };
  return builder;
};

const businessDraftOf = (row: Row): Record<string, unknown> =>
  ((row.theme as Row | null)?.business_draft as Record<string, unknown>) ?? {};

const COPIED_PAYLOAD_COLUMNS = [
  "title", "description", "location_text", "online_url", "cover_media_url",
  "cover_media_poster_url", "cover_media_type", "cover_media_provider",
  "cover_media_source_url", "cover_media_credit", "cover_media_credit_url",
  "cover_media_alt", "currency", "is_online", "is_recurring", "is_multi_date",
  "recurrence_rules", "timezone", "party_types", "vibe_tags", "music_genres",
  "city", "pass_tax", "pass_mingla_fee", "pass_service_fee",
];

// The gallery rule under test. "patched" = migration 20270701003288;
// "production" = the definitions production runs today.
const galleryAfterWrite = (row: Row, payload: Row): unknown => {
  if (fake.mode === "patched" && !("cover_media_gallery" in payload)) {
    return row.cover_media_gallery;
  }
  return payload.cover_media_gallery ?? [];
};

const brandGraph = { id: BRAND_ID, slug: "issue-3288-brand", name: "Issue 3288 Brand" };

const rpc = (
  name: string,
  args: Record<string, unknown>,
): Promise<{ data: unknown; error: unknown }> => {
  const row = fake.events.get(args.p_event_id as string);
  if (row === undefined) {
    return Promise.resolve({ data: null, error: { message: `${name}: not found` } });
  }
  const now = new Date().toISOString();
  switch (name) {
    // business_update_event_draft — reject a writer BEHIND the stored revision.
    case "business_update_event_draft": {
      const payload = args.p_payload as Row;
      const revision = args.p_client_revision as number;
      if (revision < ((businessDraftOf(row).clientRevision as number) ?? 0)) {
        return Promise.resolve({ data: null, error: { message: "stale_client_revision" } });
      }
      for (const column of COPIED_PAYLOAD_COLUMNS) {
        if (column in payload) row[column] = clone(payload[column]);
      }
      row.cover_media_gallery = clone(galleryAfterWrite(row, payload));
      const theme = clone((payload.theme as Row) ?? {});
      (theme.business_draft as Row).clientRevision = revision;
      row.theme = theme;
      row.updated_at = now;
      return Promise.resolve({
        data: { event: clone(row), client_revision: revision },
        error: null,
      });
    }
    // business_update_rsvp_graph (draft branch) — keyed writes in BOTH modes.
    case "business_update_rsvp_graph": {
      const payload = clone(args.p_payload as Row);
      const expected = payload.__expectedClientRevision as number;
      delete payload.__expectedClientRevision;
      if (expected < ((businessDraftOf(row).clientRevision as number) ?? 0)) {
        return Promise.resolve({ data: null, error: { message: "rsvp_revision_conflict" } });
      }
      for (const column of COPIED_PAYLOAD_COLUMNS) {
        if (column in payload) row[column] = clone(payload[column]);
      }
      if ("cover_media_gallery" in payload) {
        row.cover_media_gallery = clone(payload.cover_media_gallery);
      }
      row.theme = {
        ...((payload.theme as Row) ?? {}),
        business_draft: {
          ...businessDraftOf(row),
          ...(((payload.theme as Row)?.business_draft as Row) ?? {}),
          clientRevision: expected,
        },
      };
      row.updated_at = now;
      return Promise.resolve({
        data: { event: clone(row), brand: brandGraph, eventDates: [], tickets: [] },
        error: null,
      });
    }
    // issue_1719_publish_event_with_poster → business_publish_event_draft.
    case "issue_1719_publish_event_with_poster": {
      const payload = args.p_draft_payload as Row;
      for (const column of COPIED_PAYLOAD_COLUMNS) {
        if (column in payload) row[column] = clone(payload[column]);
      }
      row.cover_media_gallery = clone(galleryAfterWrite(row, payload));
      row.status = "scheduled";
      row.visibility = "public";
      row.slug = "issue-3288-weekender";
      row.published_at = now;
      row.theme = { business_event: businessDraftOf({ theme: payload.theme }) };
      return Promise.resolve({
        data: {
          event: clone(row),
          brand: brandGraph,
          tickets: [],
          eventDates: [],
          client_revision: args.p_client_revision,
        },
        error: null,
      });
    }
    // business_publish_rsvp_graph — builds its payload from the STORED row
    // (issue_1977_current_rsvp_publish_payload always carries the gallery).
    case "business_publish_rsvp_graph": {
      row.status = "scheduled";
      row.visibility = "public";
      row.slug = "issue-3288-rsvp";
      row.published_at = now;
      return Promise.resolve({
        data: {
          event: clone(row),
          brand: { ...brandGraph, currency: "GBP" },
          eventDates: [],
          tickets: [],
          clientRevision: businessDraftOf(row).clientRevision ?? 0,
          replayed: false,
        },
        error: null,
      });
    }
    default:
      return Promise.resolve({ data: null, error: { message: `unexpected rpc ${name}` } });
  }
};

jest.mock("../../services/supabase", () => ({
  __esModule: true,
  supabase: {
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: USER_ID } }, error: null }),
    },
    from: (table: string) => {
      if (table === "events") return fromEvents();
      if (table === "brands") {
        const brands: Record<string, unknown> = {};
        const self = (): Record<string, unknown> => brands;
        brands.select = self;
        brands.eq = self;
        brands.is = self;
        brands.maybeSingle = () =>
          Promise.resolve({ data: { default_currency: "GBP" }, error: null });
        return brands;
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: (name: string, args: Record<string, unknown>) => rpc(name, args),
  },
}));

import {
  eventDraftKeys,
  useServerDraftAutosave,
  useServerDraftById,
  useServerDraftsForBrand,
} from "../useServerDraftEvents";
import {
  buildDraftEvent,
  useDraftEventStore,
  type DraftEvent,
} from "../../store/draftEventStore";
import { publishBusinessEventDraft } from "../../services/businessEvents";
import { publishRsvpDraft } from "../../services/rsvpEvents";
import type { OfferingGalleryImage } from "@mingla/offering-rendering";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const TestRenderer = require("react-test-renderer") as {
  create: (el: React.ReactElement) => {
    update: (el: React.ReactElement) => void;
    unmount: () => void;
  };
  act: (cb: () => Promise<void> | void) => Promise<void>;
};

const PHOTOS: OfferingGalleryImage[] = [
  { url: "https://cdn.example.test/issue-3288/1.jpg", type: "image" },
  { url: "https://cdn.example.test/issue-3288/2.jpg", type: "image" },
  { url: "https://cdn.example.test/issue-3288/3.gif", type: "gif" },
];

type Format = "single" | "multi_date" | "rsvp";
type Trigger =
  | "preview-after-30s"
  | "reopen"
  | "list-refetch"
  | "cover-video-ready"
  | "conflict-resync";

const FORMATS: Format[] = ["single", "multi_date", "rsvp"];
const TRIGGERS: Trigger[] = [
  "preview-after-30s",
  "reopen",
  "list-refetch",
  "cover-video-ready",
  "conflict-resync",
];
const MODES: ServerMode[] = ["patched", "production"];

const localDraftFor = (format: Format): DraftEvent => ({
  ...buildDraftEvent(BRAND_ID, DRAFT_ID, "2026-09-12T20:00:00.000Z"),
  name: "Issue 3288 weekender",
  currency: "GBP",
  partyTypes: ["festival"],
  date: "2026-10-03",
  doorsOpen: "20:00",
  endsAt: "23:00",
  timezone: "Europe/London",
  ...(format === "multi_date"
    ? {
        whenMode: "multi_date" as const,
        multiDates: [
          { id: "day-1", date: "2026-10-03", startTime: "20:00", endTime: "23:00" },
          { id: "day-2", date: "2026-10-04", startTime: "20:00", endTime: "23:00" },
        ],
      }
    : {}),
  ...(format === "rsvp" ? { isRsvp: true, whenMode: "single" as const } : {}),
  coverGallery: [],
  // Ahead of the freshly created server row (revision 0), exactly like a
  // wizard that has already been typed into.
  clientRevision: 1,
} as DraftEvent);

const seedServerRow = (format: Format): void => {
  fake.events.set(DRAFT_ID, {
    id: DRAFT_ID,
    brand_id: BRAND_ID,
    created_by: USER_ID,
    title: "Issue 3288 weekender",
    description: null,
    slug: "draft-issue-3288",
    location_text: null,
    online_url: null,
    cover_media_url: null,
    cover_media_poster_url: null,
    cover_media_type: null,
    cover_media_provider: null,
    cover_media_source_url: null,
    cover_media_credit: null,
    cover_media_credit_url: null,
    cover_media_alt: null,
    cover_media_gallery: [],
    currency: "GBP",
    is_online: false,
    is_recurring: false,
    is_multi_date: format === "multi_date",
    recurrence_rules: null,
    theme: { business_draft: { clientRevision: 0, isRsvp: format === "rsvp" } },
    visibility: "draft",
    status: "draft",
    timezone: "Europe/London",
    created_at: "2026-09-12T20:00:00.000Z",
    updated_at: "2026-09-12T20:00:00.000Z",
    published_at: null,
    deleted_at: null,
    party_types: ["festival"],
    vibe_tags: [],
    music_genres: [],
    city: null,
    location_geo: null,
    pass_tax: null,
    pass_mingla_fee: null,
    pass_service_fee: null,
    theme_color_override: null,
    theme_font_override: null,
    theme_animation_override: null,
    event_type: format === "rsvp" ? "rsvp" : "event",
  });
};

const autosaveApi: { save: ((d: DraftEvent) => Promise<DraftEvent>) | null } = {
  save: null,
};

/** The edit route: reads the draft by id and owns the autosave mutation. */
const EditRoute: React.FC = () => {
  useServerDraftById(DRAFT_ID);
  autosaveApi.save = useServerDraftAutosave().saveDraftAsync;
  return null;
};
/** The preview route's own detail observer. */
const PreviewRoute: React.FC = () => {
  useServerDraftById(DRAFT_ID);
  return null;
};
/** Home to-dos / Hub / search — list observers mounted behind the wizard. */
const DraftsList: React.FC = () => {
  useServerDraftsForBrand(BRAND_ID);
  return null;
};

const flush = async (): Promise<void> => {
  await TestRenderer.act(async () => {
    for (let i = 0; i < 6; i += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  });
};

let clock = Date.parse("2026-09-12T21:00:00.000Z");
let queryClient: QueryClient;
let tree: ReturnType<typeof TestRenderer.create> | null = null;

const newQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

const render = async (children: React.ReactElement[]): Promise<void> => {
  const element = (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  await TestRenderer.act(async () => {
    if (tree === null) tree = TestRenderer.create(element);
    else tree.update(element);
  });
  await flush();
};

const unmount = async (): Promise<void> => {
  if (tree === null) return;
  await TestRenderer.act(async () => {
    tree?.unmount();
  });
  tree = null;
};

const storeDraft = (): DraftEvent => {
  const draft = useDraftEventStore.getState().getDraft(DRAFT_ID);
  if (draft === null) throw new Error("draft missing from the store");
  return draft;
};

const serverRevision = (): number =>
  (businessDraftOf(fake.events.get(DRAFT_ID) as Row).clientRevision as number) ?? 0;

const save = async (draft: DraftEvent): Promise<void> => {
  if (autosaveApi.save === null) throw new Error("autosave not mounted");
  const run = autosaveApi.save;
  await TestRenderer.act(async () => {
    await run(draft).catch(() => undefined);
  });
  await flush();
};

const runTrigger = async (trigger: Trigger): Promise<void> => {
  const readsBefore = fake.draftReads.length;
  switch (trigger) {
    case "preview-after-30s":
      clock += 31_000;
      await render([<EditRoute key="edit" />, <PreviewRoute key="preview" />]);
      break;
    case "reopen":
      await unmount();
      queryClient.clear();
      queryClient = newQueryClient();
      useDraftEventStore.getState().reset();
      await render([<EditRoute key="edit" />]);
      break;
    case "list-refetch":
      await render([<EditRoute key="edit" />, <DraftsList key="list" />]);
      await TestRenderer.act(async () => {
        await queryClient.invalidateQueries({ queryKey: eventDraftKeys.list(BRAND_ID) });
      });
      await flush();
      break;
    case "cover-video-ready":
      // Exactly the draft keys useEventCoverVideoUpload.invalidate() hits.
      await render([<EditRoute key="edit" />, <DraftsList key="list" />]);
      await TestRenderer.act(async () => {
        await queryClient.invalidateQueries({ queryKey: eventDraftKeys.detail(DRAFT_ID) });
        await queryClient.invalidateQueries({ queryKey: eventDraftKeys.list(BRAND_ID) });
      });
      await flush();
      break;
    case "conflict-resync": {
      // Another device saved ahead (same content), so this device's next
      // save is BEHIND and the service pulls the server draft back.
      const row = fake.events.get(DRAFT_ID) as Row;
      (businessDraftOf(row) as Row).clientRevision = serverRevision() + 5;
      const stale = storeDraft();
      await save({ ...stale, clientRevision: (stale.clientRevision ?? 0) + 1 });
      break;
    }
  }
  // The trigger really re-read the draft — never a vacuous pass.
  expect(fake.draftReads.length).toBeGreaterThan(readsBefore);
};

beforeEach(() => {
  jest.spyOn(Date, "now").mockImplementation(() => clock);
  fake.events.clear();
  fake.draftReads = [];
  useDraftEventStore.getState().reset();
  queryClient = newQueryClient();
  autosaveApi.save = null;
});

afterEach(async () => {
  await unmount();
  queryClient.clear();
  jest.restoreAllMocks();
});

describe("issue #3288 — additional photos survive every draft re-read, autosave and publish", () => {
  for (const mode of MODES) {
    for (const format of FORMATS) {
      for (const trigger of TRIGGERS) {
        test(`${mode} server · ${format} · ${trigger} → autosave → publish keeps 3 photos`, async () => {
          fake.mode = mode;
          seedServerRow(format);
          useDraftEventStore.getState().upsertDraft(localDraftFor(format));
          await render([<EditRoute key="edit" />]);

          // The organiser adds three photos; the wizard autosaves them.
          await save({ ...storeDraft(), coverGallery: PHOTOS, clientRevision: 2 });
          expect(fake.events.get(DRAFT_ID)?.cover_media_gallery).toEqual(PHOTOS);

          await runTrigger(trigger);

          // The open draft still holds the photos after the re-read.
          expect(storeDraft().coverGallery).toEqual(PHOTOS);

          // An unrelated edit autosaves.
          const current = storeDraft();
          await save({
            ...current,
            name: "Issue 3288 weekender (final)",
            clientRevision: Math.max(current.clientRevision ?? 0, serverRevision()) + 1,
          });
          expect(fake.events.get(DRAFT_ID)?.title).toBe("Issue 3288 weekender (final)");

          // Publish the draft the wizard holds.
          const toPublish = storeDraft();
          await TestRenderer.act(async () => {
            if (format === "rsvp") await publishRsvpDraft(toPublish);
            else await publishBusinessEventDraft(toPublish, toPublish.clientRevision ?? 0);
          });

          const published = fake.events.get(DRAFT_ID) as Row;
          expect(published.status).toBe("scheduled");
          expect(published.cover_media_gallery).toEqual(PHOTOS);

          // Root cause: no draft read may come back without the gallery column.
          const readsMissingGallery = fake.draftReads
            .flat()
            .filter((row) => !Array.isArray(row.cover_media_gallery));
          expect(readsMissingGallery).toEqual([]);
        });
      }
    }
  }

  test("deliberately removing every photo still saves and publishes an empty gallery", async () => {
    fake.mode = "patched";
    seedServerRow("single");
    useDraftEventStore.getState().upsertDraft(localDraftFor("single"));
    await render([<EditRoute key="edit" />]);
    await save({ ...storeDraft(), coverGallery: PHOTOS, clientRevision: 2 });
    expect(fake.events.get(DRAFT_ID)?.cover_media_gallery).toEqual(PHOTOS);

    await save({ ...storeDraft(), coverGallery: [], clientRevision: 3 });
    expect(fake.events.get(DRAFT_ID)?.cover_media_gallery).toEqual([]);

    await runTrigger("preview-after-30s");
    const toPublish = storeDraft();
    expect(toPublish.coverGallery).toEqual([]);
    await TestRenderer.act(async () => {
      await publishBusinessEventDraft(toPublish, toPublish.clientRevision ?? 0);
    });
    expect(fake.events.get(DRAFT_ID)?.cover_media_gallery).toEqual([]);
  });
});

/**
 * A cover video that finishes after its Cover sheet closed lands on the draft.
 *
 * THE BUG (RSVP draft 6efa617e, production, 2026-09-15): the host picked a 13s
 * video, read "You can close this sheet—we'll finish automatically", closed the
 * sheet and changed settings for ~10 minutes, each change autosaving. Bunny
 * finished at 10:14:52 and cover_video_apply_once wrote the video onto the
 * events row (a job only reaches 'applied' when that UPDATE hits one row). The
 * next autosave, 10:16:31, returned the row with cover_media_url NULL: the
 * wizard's local draft still had no cover and the owner wrote it back. The Step
 * 4 card and Preview kept the striped placeholder, because the picker that
 * would have copied the video into the draft unmounted with the sheet.
 *
 * Two halves, both pinned here (the SQL half by
 * supabase/migrations/__tests__/draft_autosave_keeps_applied_cover.test.sql):
 *   1. the autosave sends `__coverBase` — the cover this session last received —
 *      so the owner keeps a server-applied cover the client never saw;
 *   2. the wizard reads the server cover (step change, foreground, and a poll
 *      while a video was processing) and adopts it unless the host changed the
 *      cover since that base.
 *
 * FAILS-ON-REVERT (measured): dropping `recordServerCoverBase` from
 * upsertServerDraft and `coverBasePayload` from autosaveServerDraft fails B-1,
 * S-1 and S-2. A-1..A-5 assert the adoption decision and W-1 / W-2 the wizard
 * and route wiring directly. The adversarial rows (A-3, A-4, B-2, S-3) stop a
 * fix that simply always adopts or always sends a base.
 */

import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
    clear: jest.fn(() => Promise.resolve()),
  },
}));
jest.mock("../../../utils/liveEventConverter", () => ({
  __esModule: true,
  convertDraftToLiveEvent: () => null,
}));
jest.mock("react-native", () => ({
  AppState: { addEventListener: () => ({ remove: () => undefined }) },
}));

const mockRpc = jest.fn<(...args: unknown[]) => Promise<{ data: unknown; error: unknown }>>();
const mockFrom = jest.fn();
jest.mock("../../../services/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

import {
  buildDraftEvent,
  useDraftEventStore,
  type DraftEvent,
} from "../../../store/draftEventStore";
import { autosaveServerDraft } from "../../../services/eventDrafts";
import { draftToServerUpdate } from "../../../utils/serverDraftEventMapper";
import {
  forgetServerCoverBase,
  recordServerCoverBase,
  serverCoverBaseFor,
  shouldAdoptServerCover,
  type ServerDraftCover,
} from "../../../utils/draftCoverBase";
import { checkServerCoverOnce } from "../../../hooks/useServerCoverAdoption";

const BRAND_ID = "5f0e2c1a-3b4d-4e6f-8a9b-0c1d2e3f4a5b";
const DRAFT_ID = "6efa617e-d4bd-4389-909d-be9db1763a75";
const VIDEO = "https://vz-a16fce08-6c6.b-cdn.net/d157fcaa/play_720p.mp4";
const PHOTO = "https://images.example.test/steak.jpg";

const draft = (patch: Partial<DraftEvent> = {}): DraftEvent => ({
  ...buildDraftEvent(BRAND_ID, DRAFT_ID, "2026-09-15T09:47:06.000Z"),
  name: "Harmattan Club",
  isRsvp: true,
  whenMode: "single",
  currency: "USD",
  clientRevision: 244,
  ...patch,
});

const videoCover = (): ServerDraftCover => ({
  coverMediaUrl: VIDEO,
  coverMediaPosterUrl: VIDEO.replace("play_720p.mp4", "thumbnail.jpg"),
  coverMediaType: "video",
  coverMediaProvider: null,
  coverMediaSourceUrl: null,
  coverMediaCredit: null,
  coverMediaCreditUrl: null,
  coverMediaAlt: null,
});

// A PostgREST builder that resolves every terminal to `result`.
const builder = (result: { data: unknown; error: unknown }) => {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "is"]) {
    chain[method] = () => chain;
  }
  chain.maybeSingle = () => Promise.resolve(result);
  chain.single = () => Promise.resolve(result);
  return chain;
};

// The events row an owner returns for `source`, with the server's cover.
const rowFor = (source: DraftEvent, coverUrl: string | null) => ({
  ...draftToServerUpdate(source, {}),
  cover_media_url: coverUrl,
  cover_media_type: coverUrl === null ? null : "video",
  id: source.id,
  brand_id: source.brandId,
  created_by: "user-1",
  slug: "draft-harmattan",
  created_at: source.createdAt,
  updated_at: source.updatedAt,
  published_at: null,
  deleted_at: null,
});

beforeEach(() => {
  forgetServerCoverBase();
  useDraftEventStore.setState({ drafts: [], draftEditMeta: {} });
  mockRpc.mockReset();
  mockFrom.mockReset();
  mockFrom.mockImplementation(() =>
    builder({ data: { theme: {}, currency: "USD" }, error: null }),
  );
});

describe("adoption decision", () => {
  test("A-1 a server cover lands on a draft that has none and never had one from this session", () => {
    expect(shouldAdoptServerCover({ serverUrl: VIDEO, baseUrl: undefined, localUrl: null })).toBe(true);
  });

  test("A-2 with a known base, the server moved and the host did not: adopt", () => {
    expect(shouldAdoptServerCover({ serverUrl: VIDEO, baseUrl: null, localUrl: null })).toBe(true);
    expect(shouldAdoptServerCover({ serverUrl: VIDEO, baseUrl: PHOTO, localUrl: PHOTO })).toBe(true);
  });

  test("A-3 a cover the host changed since the base is never overwritten", () => {
    // Picked a photo after the video started.
    expect(shouldAdoptServerCover({ serverUrl: VIDEO, baseUrl: null, localUrl: PHOTO })).toBe(false);
    // Removed a video it had already adopted.
    expect(shouldAdoptServerCover({ serverUrl: VIDEO, baseUrl: VIDEO, localUrl: null })).toBe(false);
    // No base and a local cover: do not guess.
    expect(shouldAdoptServerCover({ serverUrl: VIDEO, baseUrl: undefined, localUrl: PHOTO })).toBe(false);
  });

  test("A-4 nothing to do when server and local agree", () => {
    expect(shouldAdoptServerCover({ serverUrl: VIDEO, baseUrl: null, localUrl: VIDEO })).toBe(false);
    expect(shouldAdoptServerCover({ serverUrl: null, baseUrl: undefined, localUrl: null })).toBe(false);
  });

  test("A-5 one check: adopts the applied video, records it as the base, and survives a failed read", async () => {
    recordServerCoverBase(DRAFT_ID, null);
    const adopted: ServerDraftCover[] = [];
    await expect(
      checkServerCoverOnce({
        draftId: DRAFT_ID,
        fetchServerCover: async () => videoCover(),
        getLocalCoverUrl: () => null,
        onAdopt: (cover) => adopted.push(cover),
      }),
    ).resolves.toBe(true);
    expect(adopted).toEqual([videoCover()]);
    expect(serverCoverBaseFor(DRAFT_ID)).toBe(VIDEO);

    await expect(
      checkServerCoverOnce({
        draftId: DRAFT_ID,
        fetchServerCover: async () => {
          throw new Error("offline");
        },
        getLocalCoverUrl: () => null,
        onAdopt: (cover) => adopted.push(cover),
      }),
    ).resolves.toBe(false);
    expect(adopted).toHaveLength(1);
  });
});

describe("cover base bookkeeping", () => {
  test("B-1 an accepted autosave echo records the server's cover as the base", () => {
    const store = useDraftEventStore.getState();
    store.upsertDraft(draft());
    expect(serverCoverBaseFor(DRAFT_ID)).toBeUndefined();

    const accepted = store.upsertServerDraft(draft({ coverMediaUrl: VIDEO, coverMediaType: "video" }));
    expect(accepted).toBe(true);
    expect(serverCoverBaseFor(DRAFT_ID)).toBe(VIDEO);
    expect(useDraftEventStore.getState().getDraft(DRAFT_ID)?.coverMediaUrl).toBe(VIDEO);
  });

  test("B-2 a rejected (stale) echo does not move the base", () => {
    const store = useDraftEventStore.getState();
    store.upsertDraft(draft({ clientRevision: 250 }));
    store.markDraftDirty(DRAFT_ID, 250);
    recordServerCoverBase(DRAFT_ID, null);

    const accepted = store.upsertServerDraft(
      draft({ clientRevision: 245, coverMediaUrl: VIDEO, coverMediaType: "video" }),
    );
    expect(accepted).toBe(false);
    expect(serverCoverBaseFor(DRAFT_ID)).toBeNull();
  });
});

describe("the autosave carries the base", () => {
  test("S-1 RSVP: the owner is told the cover this session last received", async () => {
    const source = draft();
    recordServerCoverBase(DRAFT_ID, null);
    mockRpc.mockResolvedValueOnce({ data: { event: rowFor(source, VIDEO) }, error: null });

    const echoed = await autosaveServerDraft(source);

    const [name, args] = mockRpc.mock.calls[0] as [string, { p_payload: Record<string, unknown> }];
    expect(name).toBe("business_update_rsvp_graph");
    expect(Object.prototype.hasOwnProperty.call(args.p_payload, "__coverBase")).toBe(true);
    expect(args.p_payload.__coverBase).toBeNull();
    expect(args.p_payload.cover_media_url).toBeNull();
    // The owner kept the video; the echo hands it to the wizard.
    expect(echoed.coverMediaUrl).toBe(VIDEO);
  });

  test("S-2 ticketed: the same base rides business_update_event_draft", async () => {
    const source = draft({ isRsvp: false });
    recordServerCoverBase(DRAFT_ID, PHOTO);
    mockRpc.mockResolvedValueOnce({ data: { event: rowFor(source, VIDEO) }, error: null });

    await autosaveServerDraft(source);

    const [name, args] = mockRpc.mock.calls[0] as [string, { p_payload: Record<string, unknown> }];
    expect(name).toBe("business_update_event_draft");
    expect(args.p_payload.__coverBase).toBe(PHOTO);
  });

  test("S-3 no base known this session: the key is omitted, never sent as a guess", async () => {
    const source = draft();
    mockRpc.mockResolvedValueOnce({ data: { event: rowFor(source, null) }, error: null });

    await autosaveServerDraft(source);

    const [, args] = mockRpc.mock.calls[0] as [string, { p_payload: Record<string, unknown> }];
    expect(Object.prototype.hasOwnProperty.call(args.p_payload, "__coverBase")).toBe(false);
  });
});

describe("the wizards and routes are wired", () => {
  const ROOT = path.resolve(__dirname, "../../../..");
  const read = (rel: string): string =>
    fs.readFileSync(path.join(ROOT, rel), "utf8");

  test.each([
    "src/components/rsvp/RsvpCreatorWizard.tsx",
    "src/components/event/EventCreatorWizard.tsx",
  ])("W-1 %s adopts the server cover while mounted and while a video processes", (rel) => {
    const src = read(rel);
    expect(src).toContain("useServerCoverAdoption({");
    expect(src).toContain("fetchServerCover,");
    expect(src).toContain("localCoverUrl: liveDraft.coverMediaUrl ?? null");
    expect(src).toContain("watching: coverVideoProcessing");
    expect(src).toContain("pulse: currentStep");
    // Adoption goes through the wizard's own update path (store + autosave).
    expect(src).toMatch(/handleAdoptServerCover = useCallback\(\s*\(cover: ServerDraftCover\): void => \{\s*handleUpdate\(\{ \.\.\.cover \}\);/);
  });

  test.each(["app/rsvp/[id]/edit.tsx", "app/event/[id]/edit.tsx"])(
    "W-2 %s gives the wizard the server cover reader",
    (rel) => {
      const src = read(rel);
      expect(src).toContain('import { fetchServerDraftCover } from "../../../src/services/eventDrafts";');
      expect(src).toContain("fetchServerCover={fetchServerDraftCover}");
    },
  );
});

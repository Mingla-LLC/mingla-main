/**
 * draftPromotion.orch0976 — issue #976 [event-name-focus] happy-path
 * regression suite for the single-flight d_*→server promotion registry
 * (SPEC §4.1 / §8.1).
 *
 * PROVES (fails-on-revert):
 *   - Registry: two concurrent promoteLegacyDraftOnce calls for one d_* id →
 *     EXACTLY ONE createServerDraft; a post-resolve call returns the resolved
 *     draft with ZERO further service calls (reverting the registry to
 *     per-caller inline createServerDraft makes both assertions fail —
 *     the 3-duplicate-rows-per-typing-session bug, I-PROPOSED-0976-SINGLE-
 *     DRAFT-PROMOTION-OWNER).
 *   - Rejection clears in-flight + arms the 15 s backoff (isPromotionBackedOff),
 *     and a retry after the failure fires a NEW request.
 *   - Discard-mid-flight: no replaceDraft resurrection; the ghost server row is
 *     soft-discarded via discardServerDraft.
 *   - Merge: the live draft wins every user-authored field by spread — text
 *     typed AFTER the promotion snapshot survives; rsvpContributionEnabled /
 *     pricingSwitches / visibility survive (the exact fields the old enumerated
 *     merges dropped); server identity fields + legacyLocalDraftId + the
 *     currency fallback hold; liveDraft === null returns the identical object
 *     (I-PROPOSED-0976-PROMOTION-PRESERVES-LIVE-KEYSTROKES).
 *
 * Runs under the stock mingla-business/jest.config.cjs (node env, no RN
 * renderer): the registry is a pure TS module driven against the REAL
 * draftEventStore (zustand) and a REAL @tanstack/react-query QueryClient.
 * Wired into CI by .github/workflows/orch-0976-draft-promotion-tests.yml.
 */

import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { QueryClient } from "@tanstack/react-query";

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

const createServerDraftMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const discardServerDraftMock = jest.fn<(...args: unknown[]) => Promise<void>>();
jest.mock("../../services/eventDrafts", () => ({
  __esModule: true,
  createServerDraft: (...args: unknown[]) => createServerDraftMock(...args),
  discardServerDraft: (...args: unknown[]) => discardServerDraftMock(...args),
}));

// The registry only needs the key factory from the hooks module — mock it with
// the real factory shapes so the cache-write assertions below are meaningful,
// without dragging the full hook module (AuthContext → supabase) into node env.
jest.mock("../../hooks/useServerDraftEvents", () => ({
  __esModule: true,
  eventDraftKeys: {
    all: ["event-drafts"] as const,
    lists: () => ["event-drafts", "list"] as const,
    list: (brandId: string) => ["event-drafts", "list", brandId] as const,
    details: () => ["event-drafts", "detail"] as const,
    detail: (draftId: string) => ["event-drafts", "detail", draftId] as const,
  },
}));

import {
  __resetDraftPromotionRegistryForTests,
  isPromotionBackedOff,
  mergeLiveDraftIntoServerDraft,
  promoteLegacyDraftOnce,
  PromotionSourceMissingError,
} from "../draftPromotion";
import {
  buildDraftEvent,
  useDraftEventStore,
  type DraftEvent,
} from "../../store/draftEventStore";

const BRAND_ID = "brand_0976";
const SERVER_ID = "0f976000-aaaa-bbbb-cccc-000000000976";

type ServerDraftWithLegacy = DraftEvent & { legacyLocalDraftId?: string };

const serverEchoOf = (source: DraftEvent): ServerDraftWithLegacy => ({
  ...source,
  id: SERVER_ID,
  serverSlug: "draft-orch0976",
  legacyLocalDraftId: source.id,
  currency: source.currency ?? "USD",
  createdAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:01.000Z",
});

const mintLocalDraft = (): DraftEvent =>
  useDraftEventStore.getState().createDraft(BRAND_ID);

describe("issue #976 — promoteLegacyDraftOnce single-flight registry", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    __resetDraftPromotionRegistryForTests();
    useDraftEventStore.getState().reset();
    createServerDraftMock.mockReset();
    discardServerDraftMock.mockReset();
    discardServerDraftMock.mockResolvedValue(undefined);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  afterEach(() => {
    queryClient.clear();
    jest.useRealTimers();
  });

  test("two concurrent calls for one d_* id → exactly one createServerDraft; both resolve to the same merged draft", async () => {
    const draft = mintLocalDraft();
    useDraftEventStore.getState().updateDraft(draft.id, { name: "Z" });

    let resolveInsert: (value: ServerDraftWithLegacy) => void = () => undefined;
    createServerDraftMock.mockImplementation(
      (_brandId: unknown, source: unknown) =>
        new Promise((resolve) => {
          resolveInsert = () => resolve(serverEchoOf(source as DraftEvent));
        }),
    );

    const first = promoteLegacyDraftOnce({
      queryClient,
      brandId: BRAND_ID,
      draftId: draft.id,
    });
    const second = promoteLegacyDraftOnce({
      queryClient,
      brandId: BRAND_ID,
      draftId: draft.id,
    });

    expect(createServerDraftMock).toHaveBeenCalledTimes(1);

    resolveInsert(serverEchoOf(draft));
    const [a, b] = await Promise.all([first, second]);

    expect(createServerDraftMock).toHaveBeenCalledTimes(1);
    expect(a.id).toBe(SERVER_ID);
    expect(b).toBe(a);
    // Store swap landed: d_* gone, server id present.
    expect(useDraftEventStore.getState().getDraft(draft.id)).toBeNull();
    expect(useDraftEventStore.getState().getDraft(SERVER_ID)?.id).toBe(SERVER_ID);
    // Cache writes: list dedupe-insert (merged first) + detail entry.
    const list = queryClient.getQueryData<DraftEvent[]>([
      "event-drafts",
      "list",
      BRAND_ID,
    ]);
    expect(list?.[0]?.id).toBe(SERVER_ID);
    expect(list?.filter((d) => d.id === SERVER_ID)).toHaveLength(1);
    expect(
      queryClient.getQueryData<DraftEvent>([
        "event-drafts",
        "detail",
        SERVER_ID,
      ])?.id,
    ).toBe(SERVER_ID);
  });

  test("post-resolve call returns the resolved draft with NO second service call", async () => {
    const draft = mintLocalDraft();
    useDraftEventStore.getState().updateDraft(draft.id, { name: "Z" });
    createServerDraftMock.mockImplementation(
      (_brandId: unknown, source: unknown) =>
        Promise.resolve(serverEchoOf(source as DraftEvent)),
    );

    const merged = await promoteLegacyDraftOnce({
      queryClient,
      brandId: BRAND_ID,
      draftId: draft.id,
    });
    const again = await promoteLegacyDraftOnce({
      queryClient,
      brandId: BRAND_ID,
      draftId: draft.id,
    });

    expect(createServerDraftMock).toHaveBeenCalledTimes(1);
    expect(again).toBe(merged);
  });

  test("live keystrokes typed DURING the in-flight insert survive the swap (merge re-reads the store at resolve time)", async () => {
    const draft = mintLocalDraft();
    useDraftEventStore.getState().updateDraft(draft.id, { name: "Z", clientRevision: 1 });

    let resolveInsert: () => void = () => undefined;
    createServerDraftMock.mockImplementation(
      (_brandId: unknown, source: unknown) =>
        new Promise((resolve) => {
          resolveInsert = () => resolve(serverEchoOf(source as DraftEvent));
        }),
    );

    const promotion = promoteLegacyDraftOnce({
      queryClient,
      brandId: BRAND_ID,
      draftId: draft.id,
    });
    // Burst typing lands in Zustand against the d_* id while the insert flies.
    useDraftEventStore
      .getState()
      .updateDraft(draft.id, { name: "ZZDIAG976B", clientRevision: 9 });

    resolveInsert();
    const merged = await promotion;

    expect(merged.name).toBe("ZZDIAG976B");
    expect(useDraftEventStore.getState().getDraft(SERVER_ID)?.name).toBe(
      "ZZDIAG976B",
    );
  });

  test("rejection clears in-flight, arms the 15 s backoff, and a retry fires a NEW request", async () => {
    jest.useFakeTimers();
    const draft = mintLocalDraft();
    useDraftEventStore.getState().updateDraft(draft.id, { name: "Z" });
    createServerDraftMock.mockImplementation(() =>
      Promise.reject(new Error("offline")),
    );

    await expect(
      promoteLegacyDraftOnce({ queryClient, brandId: BRAND_ID, draftId: draft.id }),
    ).rejects.toThrow("offline");

    expect(isPromotionBackedOff(draft.id)).toBe(true);
    jest.advanceTimersByTime(15_000);
    expect(isPromotionBackedOff(draft.id)).toBe(false);

    // In-flight was cleared on rejection → a retry is a NEW createServerDraft.
    createServerDraftMock.mockImplementation(
      (_brandId: unknown, source: unknown) =>
        Promise.resolve(serverEchoOf(source as DraftEvent)),
    );
    const merged = await promoteLegacyDraftOnce({
      queryClient,
      brandId: BRAND_ID,
      draftId: draft.id,
    });
    expect(createServerDraftMock).toHaveBeenCalledTimes(2);
    expect(merged.id).toBe(SERVER_ID);
  });

  test("discard-mid-flight: no store resurrection, ghost server row soft-discarded, raw server draft resolved", async () => {
    const draft = mintLocalDraft();
    useDraftEventStore.getState().updateDraft(draft.id, { name: "Z" });

    let resolveInsert: () => void = () => undefined;
    createServerDraftMock.mockImplementation(
      (_brandId: unknown, source: unknown) =>
        new Promise((resolve) => {
          resolveInsert = () => resolve(serverEchoOf(source as DraftEvent));
        }),
    );

    const promotion = promoteLegacyDraftOnce({
      queryClient,
      brandId: BRAND_ID,
      draftId: draft.id,
    });
    // User discards the d_* draft while the insert is in flight.
    useDraftEventStore.getState().deleteDraft(draft.id);

    resolveInsert();
    const settled = await promotion;

    expect(settled.id).toBe(SERVER_ID);
    // NOT resurrected into the store; no cache writes.
    expect(useDraftEventStore.getState().getDraft(SERVER_ID)).toBeNull();
    expect(
      queryClient.getQueryData<DraftEvent[]>(["event-drafts", "list", BRAND_ID]),
    ).toBeUndefined();
    // Ghost row soft-retired.
    expect(discardServerDraftMock).toHaveBeenCalledTimes(1);
    expect(discardServerDraftMock).toHaveBeenCalledWith(SERVER_ID);
  });

  test("missing source or non-d_* id rejects with PromotionSourceMissingError and never calls the service", async () => {
    await expect(
      promoteLegacyDraftOnce({
        queryClient,
        brandId: BRAND_ID,
        draftId: "d_never_minted",
      }),
    ).rejects.toBeInstanceOf(PromotionSourceMissingError);

    const serverBacked = buildDraftEvent(BRAND_ID, SERVER_ID);
    useDraftEventStore.getState().upsertDraft(serverBacked);
    await expect(
      promoteLegacyDraftOnce({ queryClient, brandId: BRAND_ID, draftId: SERVER_ID }),
    ).rejects.toBeInstanceOf(PromotionSourceMissingError);

    expect(createServerDraftMock).not.toHaveBeenCalled();
  });
});

describe("issue #976 — mergeLiveDraftIntoServerDraft (live wins by spread)", () => {
  const liveBase = (): DraftEvent => ({
    ...buildDraftEvent(BRAND_ID, "d_orch0976live"),
    name: "Full live text",
    description: "typed during flight",
    visibility: "private",
    rsvpContributionEnabled: true,
    rsvpContributionSuggestedCents: 2500,
    rsvpContributionMinCents: 500,
    pricingSwitches: { passTax: true, passMinglaFee: null, passServiceFee: false },
    lastStepReached: 3,
    clientRevision: 7,
    currency: null,
  });

  const serverSnapshot = (): ServerDraftWithLegacy => ({
    ...buildDraftEvent(BRAND_ID, SERVER_ID),
    name: "Z",
    serverSlug: "draft-orch0976",
    legacyLocalDraftId: "d_orch0976live",
    currency: "NGN",
    lastStepReached: 1,
    clientRevision: 2,
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:01.000Z",
  });

  test("liveDraft === null returns the identical server-draft object", () => {
    const server = serverSnapshot();
    expect(mergeLiveDraftIntoServerDraft(server, null)).toBe(server);
  });

  test("live text typed after the snapshot survives; server keeps identity/issued fields + legacyLocalDraftId", () => {
    const merged = mergeLiveDraftIntoServerDraft(serverSnapshot(), liveBase());
    expect(merged.name).toBe("Full live text");
    expect(merged.description).toBe("typed during flight");
    expect(merged.id).toBe(SERVER_ID);
    expect(merged.brandId).toBe(BRAND_ID);
    expect(merged.serverSlug).toBe("draft-orch0976");
    expect(merged.legacyLocalDraftId).toBe("d_orch0976live");
    expect(merged.status).toBe("draft");
    expect(merged.createdAt).toBe("2026-07-20T00:00:00.000Z");
    expect(merged.updatedAt).toBe("2026-07-20T00:00:01.000Z");
  });

  test("the fields the old enumerated merges dropped survive: rsvpContribution* + pricingSwitches + visibility", () => {
    const merged = mergeLiveDraftIntoServerDraft(serverSnapshot(), liveBase());
    expect(merged.rsvpContributionEnabled).toBe(true);
    expect(merged.rsvpContributionSuggestedCents).toBe(2500);
    expect(merged.rsvpContributionMinCents).toBe(500);
    expect(merged.pricingSwitches).toEqual({
      passTax: true,
      passMinglaFee: null,
      passServiceFee: false,
    });
    expect(merged.visibility).toBe("private");
  });

  test("currency: local unset → server (brand-default) wins; local set → live wins", () => {
    const localUnset = mergeLiveDraftIntoServerDraft(serverSnapshot(), liveBase());
    expect(localUnset.currency).toBe("NGN");
    const localSet = mergeLiveDraftIntoServerDraft(serverSnapshot(), {
      ...liveBase(),
      currency: "GBP",
    });
    expect(localSet.currency).toBe("GBP");
  });

  test("lastStepReached and clientRevision take Math.max of live and server", () => {
    const merged = mergeLiveDraftIntoServerDraft(serverSnapshot(), liveBase());
    expect(merged.lastStepReached).toBe(3);
    expect(merged.clientRevision).toBe(7);
    const serverAhead = mergeLiveDraftIntoServerDraft(
      { ...serverSnapshot(), lastStepReached: 5, clientRevision: 11 },
      liveBase(),
    );
    expect(serverAhead.lastStepReached).toBe(5);
    expect(serverAhead.clientRevision).toBe(11);
  });
});

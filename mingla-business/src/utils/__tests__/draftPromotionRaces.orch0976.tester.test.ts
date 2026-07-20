/**
 * draftPromotionRaces.orch0976.tester — issue #976 [event-name-focus]
 * TESTER ADVERSARIAL regression suite (SPEC §8, tester half).
 *
 * DIFFERENT ANGLE than the implementor's suites (draftPromotion.orch0976 unit,
 * useServerDraftEvents.orch0976.activeDraft, *RouteKeystrokeSurvives): this
 * file attacks the registry's RACE surface with test-controlled out-of-order
 * promise resolution:
 *
 *   T1 — OUT-OF-ORDER DUAL-DRAFT RACE: two different d_* drafts promote
 *        concurrently (d_A from two callers, d_B from one) and d_B's insert
 *        resolves FIRST. Exactly 2 service calls; each swap lands its OWN
 *        live text (no cross-contamination); the REAL react-query list cache
 *        ends with both rows exactly once (dedupe-insert correct under
 *        out-of-order resolution).
 *   T2 — DISCARD-TRAP: discard d_A while its insert is in flight → resolve →
 *        no store resurrection, ghost row soft-discarded, the list cache is
 *        NEVER touched; a LATER promotion call for d_A is trapped by the
 *        resolved map (zero new service calls, still zero cache writes) — no
 *        second orphan row can ever be minted for a discarded draft.
 *   T3 — SWAP-TICK KEYSTROKES: keystrokes applied synchronously AFTER the
 *        service promise is resolved but BEFORE the registry's .then microtask
 *        runs (the exact replaceDraft swap tick) MUST survive the swap —
 *        proves the live re-read happens at resolve-execution time, and zero
 *        characters are dropped across the d_*→server identity boundary.
 *   T4 — ABANDON-MID-FLIGHT (E4): the wizard exits (endDraftEdit) while the
 *        insert is in flight; the swap still lands, and a loop-style re-call
 *        after resolution joins the resolved map — exactly ONE row ever.
 *
 * Fails-on-revert (tester-verified, procedure in the #976 QA report):
 *   - deleting the in-flight join in promoteLegacyDraftOnce → T1/T4 fail
 *     (duplicate createServerDraft calls);
 *   - replacing the live-merge swap with the pre-#976 raw snapshot
 *     replaceDraft(draftId, serverDraft) → T1/T3 fail (typed text destroyed).
 *
 * Append-only: NEW file; no existing test file modified. Runs under the stock
 * mingla-business/jest.config.cjs; wired into CI by
 * .github/workflows/orch-0976-draft-promotion-tests.yml.
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

// The registry only needs the key factory from the hooks module — mocked with
// the real factory shapes (same minimal seam the implementor's unit suite
// uses) so cache assertions run against a REAL QueryClient in node env.
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
  promoteLegacyDraftOnce,
} from "../draftPromotion";
import {
  useDraftEventStore,
  type DraftEvent,
} from "../../store/draftEventStore";

const BRAND_ID = "brand_0976_races";
const SERVER_ID_A = "0f976aaa-0000-0000-0000-00000000000a";
const SERVER_ID_B = "0f976bbb-0000-0000-0000-00000000000b";

type ServerDraftWithLegacy = DraftEvent & { legacyLocalDraftId?: string };
type Deferred = {
  resolve: () => void;
  reject: (e: Error) => void;
};

const listKey = ["event-drafts", "list", BRAND_ID] as const;

/**
 * Deferred service double: each createServerDraft call parks until the test
 * releases it, echoing the CALL-TIME source snapshot (exactly what the real
 * service does) under a caller-chosen server id.
 */
const armDeferredInserts = (
  serverIdByLocalId: Record<string, string>,
): Map<string, Deferred> => {
  const gates = new Map<string, Deferred>();
  createServerDraftMock.mockImplementation(
    (_brandId: unknown, source: unknown) =>
      new Promise((resolve, reject) => {
        const src = source as DraftEvent;
        gates.set(src.id, {
          resolve: () =>
            resolve({
              ...src,
              id: serverIdByLocalId[src.id],
              serverSlug: `slug-${serverIdByLocalId[src.id]}`,
              legacyLocalDraftId: src.id,
              currency: src.currency ?? "USD",
              createdAt: "2026-07-20T00:00:00.000Z",
              updatedAt: "2026-07-20T00:00:01.000Z",
            } satisfies ServerDraftWithLegacy),
          reject,
        });
      }),
  );
  return gates;
};

const flushMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
};

describe("issue #976 tester adversarial — registry race surface", () => {
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
  });

  test("T1 — two drafts racing, second insert resolves first: no cross-contamination, both cached exactly once, 2 service calls total", async () => {
    const store = useDraftEventStore.getState();
    const draftA = store.createDraft(BRAND_ID);
    const draftB = store.createDraft(BRAND_ID);
    store.updateDraft(draftA.id, { name: "AAA-first", clientRevision: 1 });
    store.updateDraft(draftB.id, { name: "BBB-first", clientRevision: 1 });
    const gates = armDeferredInserts({
      [draftA.id]: SERVER_ID_A,
      [draftB.id]: SERVER_ID_B,
    });

    // d_A promotion requested by TWO surfaces (route + loop); d_B by one.
    const pA1 = promoteLegacyDraftOnce({ queryClient, brandId: BRAND_ID, draftId: draftA.id });
    const pA2 = promoteLegacyDraftOnce({ queryClient, brandId: BRAND_ID, draftId: draftA.id });
    const pB = promoteLegacyDraftOnce({ queryClient, brandId: BRAND_ID, draftId: draftB.id });
    expect(createServerDraftMock).toHaveBeenCalledTimes(2); // single-flight per id

    // The user keeps typing into BOTH drafts while the inserts are in flight.
    useDraftEventStore.getState().updateDraft(draftA.id, { name: "AAA-full-live-text", clientRevision: 5 });
    useDraftEventStore.getState().updateDraft(draftB.id, { name: "BBB-full-live-text", clientRevision: 5 });

    // OUT OF ORDER: d_B's insert lands before d_A's.
    (gates.get(draftB.id) as Deferred).resolve();
    await flushMicrotasks();
    (gates.get(draftA.id) as Deferred).resolve();
    await flushMicrotasks();

    const [mergedA1, mergedA2, mergedB] = (await Promise.all([
      pA1,
      pA2,
      pB,
    ])) as ServerDraftWithLegacy[];

    // Joined callers share one resolved object; ids landed on the right rows.
    expect(mergedA1).toBe(mergedA2);
    expect(mergedA1.id).toBe(SERVER_ID_A);
    expect(mergedB.id).toBe(SERVER_ID_B);
    // Each swap carried its OWN live text — no cross-contamination.
    expect(mergedA1.name).toBe("AAA-full-live-text");
    expect(mergedB.name).toBe("BBB-full-live-text");
    const state = useDraftEventStore.getState();
    expect(state.getDraft(SERVER_ID_A)?.name).toBe("AAA-full-live-text");
    expect(state.getDraft(SERVER_ID_B)?.name).toBe("BBB-full-live-text");
    expect(state.getDraft(draftA.id)).toBeNull();
    expect(state.getDraft(draftB.id)).toBeNull();

    // Real list cache: both rows present EXACTLY once despite out-of-order
    // resolution (dedupe-insert correctness).
    const cached = queryClient.getQueryData<DraftEvent[]>(listKey) ?? [];
    expect(cached.filter((d) => d.id === SERVER_ID_A)).toHaveLength(1);
    expect(cached.filter((d) => d.id === SERVER_ID_B)).toHaveLength(1);
    expect(cached).toHaveLength(2);
    // Exactly 2 rows ever created for the whole double-draft session.
    expect(createServerDraftMock).toHaveBeenCalledTimes(2);
  });

  test("T2 — discard-trap: mid-flight discard never resurrects, never caches, and traps ALL later promotion attempts for that id", async () => {
    const store = useDraftEventStore.getState();
    const draftA = store.createDraft(BRAND_ID);
    store.updateDraft(draftA.id, { name: "doomed", clientRevision: 1 });
    const gates = armDeferredInserts({ [draftA.id]: SERVER_ID_A });

    const p = promoteLegacyDraftOnce({ queryClient, brandId: BRAND_ID, draftId: draftA.id });
    expect(createServerDraftMock).toHaveBeenCalledTimes(1);

    // The user discards the draft while the insert is in flight.
    useDraftEventStore.getState().deleteDraft(draftA.id);
    expect(useDraftEventStore.getState().getDraft(draftA.id)).toBeNull();

    (gates.get(draftA.id) as Deferred).resolve();
    const resolved = (await p) as ServerDraftWithLegacy;
    await flushMicrotasks();

    // No resurrection under either id; ghost row soft-discarded.
    expect(useDraftEventStore.getState().getDraft(draftA.id)).toBeNull();
    expect(useDraftEventStore.getState().getDraft(SERVER_ID_A)).toBeNull();
    expect(discardServerDraftMock).toHaveBeenCalledWith(SERVER_ID_A);
    expect(resolved.id).toBe(SERVER_ID_A);
    // The list cache was NEVER touched — the ghost must not haunt the Drafts
    // list or Home to-do counts.
    expect(queryClient.getQueryData<DraftEvent[]>(listKey)).toBeUndefined();

    // A LATER promotion attempt (stale loop closure, route retry) is trapped
    // by the resolved map: zero new service calls, zero cache writes, no
    // second orphan row.
    const again = (await promoteLegacyDraftOnce({
      queryClient,
      brandId: BRAND_ID,
      draftId: draftA.id,
    })) as ServerDraftWithLegacy;
    expect(again.id).toBe(SERVER_ID_A);
    expect(createServerDraftMock).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData<DraftEvent[]>(listKey)).toBeUndefined();
    expect(useDraftEventStore.getState().getDraft(SERVER_ID_A)).toBeNull();
  });

  test("T3 — keystrokes landing on the exact swap tick (after service resolve, before the registry microtask) survive; zero characters lost", async () => {
    const store = useDraftEventStore.getState();
    const draftA = store.createDraft(BRAND_ID);
    store.updateDraft(draftA.id, { name: "Z", clientRevision: 1 });
    const gates = armDeferredInserts({ [draftA.id]: SERVER_ID_A });

    const p = promoteLegacyDraftOnce({ queryClient, brandId: BRAND_ID, draftId: draftA.id });

    // Typing during flight...
    useDraftEventStore.getState().updateDraft(draftA.id, { name: "ZZDIAG976", clientRevision: 4 });

    // ...the insert resolves — and MORE keystrokes land in the SAME
    // synchronous turn, before the registry's .then microtask can run.
    (gates.get(draftA.id) as Deferred).resolve();
    useDraftEventStore.getState().updateDraft(draftA.id, {
      name: "ZZDIAG976-SWAPTICK",
      clientRevision: 6,
    });

    await p;
    await flushMicrotasks();

    // The swap re-read the live draft at resolve-execution time: the
    // swap-tick keystrokes are in the promoted row. Zero characters lost.
    const promoted = useDraftEventStore.getState().getDraft(SERVER_ID_A);
    expect(promoted?.name).toBe("ZZDIAG976-SWAPTICK");
    expect(useDraftEventStore.getState().getDraft(draftA.id)).toBeNull();
    const cached = queryClient.getQueryData<DraftEvent[]>(listKey) ?? [];
    expect(cached.filter((d) => d.id === SERVER_ID_A)).toHaveLength(1);
    expect((cached[0] as DraftEvent).name).toBe("ZZDIAG976-SWAPTICK");
  });

  test("T4 — wizard exits mid-flight (endDraftEdit): the swap still lands once, and a loop-style re-call joins the resolved map (E4)", async () => {
    const store = useDraftEventStore.getState();
    const draftA = store.createDraft(BRAND_ID);
    store.beginDraftEdit(draftA.id);
    store.updateDraft(draftA.id, { name: "typed-then-left", clientRevision: 2 });
    const gates = armDeferredInserts({ [draftA.id]: SERVER_ID_A });

    const p = promoteLegacyDraftOnce({ queryClient, brandId: BRAND_ID, draftId: draftA.id });

    // The user exits the wizard while the insert is in flight.
    useDraftEventStore.getState().endDraftEdit(draftA.id);
    expect(useDraftEventStore.getState().activeDraftId).toBeNull();

    (gates.get(draftA.id) as Deferred).resolve();
    await p;
    await flushMicrotasks();

    // Swap landed with the typed text intact.
    expect(useDraftEventStore.getState().getDraft(SERVER_ID_A)?.name).toBe(
      "typed-then-left",
    );

    // The abandoned draft is now loop-eligible — but the loop's promotion
    // request joins the resolved map: no second row.
    const again = (await promoteLegacyDraftOnce({
      queryClient,
      brandId: BRAND_ID,
      draftId: draftA.id,
    })) as ServerDraftWithLegacy;
    expect(again.id).toBe(SERVER_ID_A);
    expect(createServerDraftMock).toHaveBeenCalledTimes(1);
    const cached = queryClient.getQueryData<DraftEvent[]>(listKey) ?? [];
    expect(cached.filter((d) => d.id === SERVER_ID_A)).toHaveLength(1);
  });
});

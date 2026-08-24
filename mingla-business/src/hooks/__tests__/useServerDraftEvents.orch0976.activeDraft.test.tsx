/**
 * useServerDraftEvents.orch0976.activeDraft — issue #976 [event-name-focus]
 * happy-path regression suite for the legacy-migration-loop active-draft
 * suppression + registry single-flight (SPEC §4.2 / §8.2).
 *
 * PROVES (fails-on-revert): with TWO armed useServerDraftsForBrand instances
 * (cached list data — the configuration that fired duplicate promotions from
 * behind the wizard on the physical Samsung) and a dirty d_* draft:
 *   - while the draft is actively being edited (activeDraftId === draft.id via
 *     beginDraftEdit/markDraftDirty) → ZERO promotions fire;
 *   - after endDraftEdit (wizard unmount) → EXACTLY ONE promotion fires across
 *     both instances (registry single-flight — per-instance refs used to fire
 *     one each);
 *   - with two dirty d_* drafts, one active → only the ABANDONED one migrates.
 * Reverting the `draft.id !== activeDraftId` filter predicate (SPEC §4.2)
 * makes the zero-promotions assertions fail
 * (I-PROPOSED-0976-NO-BACKGROUND-PROMOTION-OF-ACTIVE-DRAFT).
 *
 * Bare react-test-renderer harness under the stock mingla-business
 * jest.config.cjs (NO RTL / .orch1118-testdeps overlay — #976 SPEC §8
 * CI-truth preamble). Wired into CI by
 * ci-batch:orch-0976-draft-promotion-tests.
 */

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

// React 19: opt this node-env suite into the act() testing environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

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
    user: { id: "user_0976" },
  }),
}));

const createServerDraftMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock("../../services/eventDrafts", () => ({
  __esModule: true,
  createServerDraft: (...args: unknown[]) => createServerDraftMock(...args),
  discardServerDraft: jest.fn(() => Promise.resolve()),
  autosaveServerDraft: jest.fn(() => Promise.reject(new Error("not used"))),
  fetchDraftById: jest.fn(() => Promise.resolve(null)),
  fetchDraftsForBrand: jest.fn(() => Promise.resolve([])),
  isServerDraftLifecycleError: () => false,
}));

import {
  eventDraftKeys,
  useServerDraftsForBrand,
} from "../useServerDraftEvents";
import {
  useDraftEventStore,
  type DraftEvent,
} from "../../store/draftEventStore";
import { __resetDraftPromotionRegistryForTests } from "../../utils/draftPromotion";

// react-test-renderer ships no bundled types; CJS-require it the way the #976
// investigation probe did (proven under this stock config).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const TestRenderer = require("react-test-renderer") as {
  create: (el: React.ReactElement) => { unmount: () => void };
  act: (cb: () => Promise<void> | void) => Promise<void> | void;
};

const BRAND_ID = "brand_0976";
const SERVER_ID = "0f976000-aaaa-bbbb-cccc-000000000976";

const serverEchoOf = (source: DraftEvent): DraftEvent & { legacyLocalDraftId?: string } => ({
  ...source,
  id: SERVER_ID,
  serverSlug: "draft-orch0976",
  legacyLocalDraftId: source.id,
});

/** A backgrounded list-hook surface (Home to-dos / Hub layout / search). */
const ArmedListHook: React.FC = () => {
  useServerDraftsForBrand(BRAND_ID);
  return null;
};

const flush = async (): Promise<void> => {
  await TestRenderer.act(async () => {
    for (let i = 0; i < 8; i += 1) {
      await Promise.resolve();
    }
  });
};

describe("issue #976 — legacy loop never promotes the actively-edited draft (two armed instances)", () => {
  let queryClient: QueryClient;
  let tree: { unmount: () => void } | null = null;

  beforeEach(() => {
    __resetDraftPromotionRegistryForTests();
    useDraftEventStore.getState().reset();
    createServerDraftMock.mockReset();
    createServerDraftMock.mockImplementation(
      (_brandId: unknown, source: unknown) =>
        Promise.resolve(serverEchoOf(source as DraftEvent)),
    );
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    // Armed: cached list data present (query.data defined on first render) —
    // the always-true condition during create (Home/Hub stay mounted behind
    // the wizard with a warm drafts list).
    queryClient.setQueryData(eventDraftKeys.list(BRAND_ID), []);
  });

  afterEach(() => {
    if (tree !== null) {
      TestRenderer.act(() => {
        tree?.unmount();
      });
      tree = null;
    }
    queryClient.clear();
  });

  const mountTwoInstances = async (): Promise<void> => {
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <ArmedListHook />
          <ArmedListHook />
        </QueryClientProvider>,
      );
    });
    await flush();
  };

  test("activeDraftId === draft.id → ZERO promotions; after endDraftEdit → EXACTLY ONE across both instances", async () => {
    const store = useDraftEventStore.getState();
    const draft = store.createDraft(BRAND_ID);
    // The wizard opens the draft, the user types the first letter.
    store.beginDraftEdit(draft.id);
    store.updateDraft(draft.id, { name: "Z", clientRevision: 1 });
    store.markDraftDirty(draft.id, 1);

    await mountTwoInstances();

    // Both instances are armed on a dirty d_* draft — and neither may fire.
    expect(createServerDraftMock).toHaveBeenCalledTimes(0);

    // More keystrokes re-run the migration effect (drafts dependency) — still zero.
    await TestRenderer.act(async () => {
      useDraftEventStore
        .getState()
        .updateDraft(draft.id, { name: "ZZDIAG", clientRevision: 2 });
      useDraftEventStore.getState().markDraftDirty(draft.id, 2);
    });
    await flush();
    expect(createServerDraftMock).toHaveBeenCalledTimes(0);

    // Wizard unmounts → the draft is ABANDONED dirty → the loop's legitimate
    // job resumes: exactly ONE promotion across BOTH instances (single-flight).
    await TestRenderer.act(async () => {
      useDraftEventStore.getState().endDraftEdit(draft.id);
    });
    await flush();

    expect(createServerDraftMock).toHaveBeenCalledTimes(1);
    // The swap landed with live-merge semantics: server id in, d_* out.
    expect(useDraftEventStore.getState().getDraft(SERVER_ID)?.name).toBe("ZZDIAG");
    expect(useDraftEventStore.getState().getDraft(draft.id)).toBeNull();
  });

  test("two dirty d_* drafts, one being edited → only the abandoned one migrates (E8)", async () => {
    const store = useDraftEventStore.getState();
    const abandoned = store.createDraft(BRAND_ID);
    store.updateDraft(abandoned.id, { name: "Abandoned draft", clientRevision: 1 });
    const active = store.createDraft(BRAND_ID);
    store.updateDraft(active.id, { name: "Being typed", clientRevision: 1 });
    store.beginDraftEdit(active.id);
    store.markDraftDirty(active.id, 1);

    await mountTwoInstances();

    expect(createServerDraftMock).toHaveBeenCalledTimes(1);
    const [, promotedSource] = createServerDraftMock.mock.calls[0] as [
      string,
      DraftEvent,
    ];
    expect(promotedSource.id).toBe(abandoned.id);
    // The active draft is untouched — still the d_* id, still in the store.
    expect(useDraftEventStore.getState().getDraft(active.id)?.name).toBe(
      "Being typed",
    );
  });
});

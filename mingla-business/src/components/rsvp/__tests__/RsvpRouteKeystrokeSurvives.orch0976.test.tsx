/**
 * RsvpRouteKeystrokeSurvives.orch0976 — issue #976 [event-name-focus]
 * happy-path route-level regression suite (SPEC §8.3, RSVP wizard).
 *
 * Reproduces the EXACT armed configuration that dropped focus on the physical
 * Samsung: a fresh d_* draft open in the wizard at /rsvp/[id]/edit, a SECOND
 * useServerDraftsForBrand instance mounted behind it with cached list data
 * (Home to-dos / Hub layout), first dirty keystroke, promotion resolving 1-3 s
 * later. PROVES:
 *   - the legacy loop does NOT fire on the first dirty keystroke of the
 *     actively-edited draft (zero createServerDraft before the wizard's own
 *     debounced autosave — reverting the §4.2 activeDraftId predicate makes
 *     this fail);
 *   - the wizard NEVER remounts (wizardMounts === 1) and zero router.replace
 *     fire across the promotion (the keyboard-drop mechanism);
 *   - EXACTLY ONE server row is created (registry single-flight);
 *   - the store draft's name equals the FULL live text typed during the
 *     in-flight insert — not the first-keystroke snapshot
 *     (I-PROPOSED-0976-PROMOTION-PRESERVES-LIVE-KEYSTROKES).
 *
 * Bare react-test-renderer harness (NO RTL / overlay — #976 SPEC §8 CI-truth
 * preamble), modeled on the investigation's runtime-proven probe. Runs under
 * the stock mingla-business/jest.config.cjs; wired into CI by
 * .github/workflows/orch-0976-draft-promotion-tests.yml.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// ── Navigation harness (probe pattern): replace() re-keys the host (screen
//    remount, as expo-router does when [id] changes); setParams() only patches
//    params in place (no remount). ──────────────────────────────────────────
type RouteState = { key: string; params: Record<string, string> };
const nav: { state: RouteState; keyCounter: number; rerender: () => void } = {
  state: { key: "k0", params: {} },
  keyCounter: 0,
  rerender: () => undefined,
};
const replaceCalls: string[] = [];
const setParamsCalls: Array<Record<string, string>> = [];

const parseEditHref = (href: string): Record<string, string> | null => {
  const m = /\/(?:rsvp|event)\/([^/?]+)\/edit/.exec(href);
  if (m === null) return null;
  const params: Record<string, string> = { id: m[1] };
  const step = /[?&]step=([^&]+)/.exec(href);
  if (step !== null) params.step = step[1];
  return params;
};

const navigationObject = { isFocused: (): boolean => true };

jest.mock("react-native", () => ({
  __esModule: true,
  Platform: {
    OS: "ios",
    select: (o: Record<string, unknown>) => o.ios ?? o.default,
  },
  StyleSheet: { create: <T,>(s: T): T => s },
  View: "View",
  Text: "Text",
}));

jest.mock("expo-router", () => {
  const ReactActual = require("react") as typeof React;
  return {
    __esModule: true,
    useLocalSearchParams: () => nav.state.params,
    useNavigation: () => navigationObject,
    useFocusEffect: (cb: () => void | (() => void)) => {
      // Harness: the route is always focused while mounted.
      ReactActual.useEffect(cb, [cb]);
    },
    useRouter: () => ({
      replace: (href: string) => {
        replaceCalls.push(href);
        const params = parseEditHref(href);
        nav.state = {
          key: `k${++nav.keyCounter}`,
          params: params ?? { ...nav.state.params },
        };
        nav.rerender();
      },
      push: jest.fn(),
      setParams: (p: Record<string, string>) => {
        setParamsCalls.push(p);
        nav.state = { key: nav.state.key, params: { ...nav.state.params, ...p } };
        nav.rerender();
      },
    }),
  };
});

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
    clear: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock("react-native-safe-area-context", () => ({
  __esModule: true,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// One fake query client shared by the route and the armed list hook — the
// registry only calls setQueryData/getQueriesData-style methods on it.
const fakeQueryClient = {
  setQueryData: jest.fn(),
  getQueriesData: jest.fn(() => [] as unknown[]),
  removeQueries: jest.fn(),
  invalidateQueries: jest.fn(),
};
jest.mock("@tanstack/react-query", () => ({
  __esModule: true,
  useQueryClient: () => fakeQueryClient,
  // Key-discriminated: LIST queries are ARMED (cached list data present — the
  // always-true condition during create on the device, which is what fires the
  // legacy loop); detail/disabled queries stay unsettled.
  useQuery: (opts: { queryKey?: readonly unknown[] }) =>
    opts.queryKey?.[1] === "list"
      ? { data: [], isLoading: false, isFetching: false, isError: false }
      : { data: undefined, isLoading: true, isFetching: true, isError: false },
  useMutation: () => ({
    mutate: jest.fn(),
    mutateAsync: jest.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
}));

jest.mock("../../../context/AuthContext", () => ({
  __esModule: true,
  useAuth: () => ({
    isAuthReady: true,
    authStatus: "signed_in_ready",
    session: { access_token: "test" },
    user: { id: "user_0976" },
  }),
}));

// The wizard mock mirrors the REAL RsvpCreatorWizard's draft-edit lifecycle
// (beginDraftEdit on mount / endDraftEdit on unmount, keyed on the draft id —
// RsvpCreatorWizard.tsx:242-246): that lifecycle is what arms the #976
// activeDraftId suppression while the user types.
jest.mock("../RsvpCreatorWizard", () => {
  const ReactActual = require("react") as typeof React;
  const { useDraftEventStore: store } =
    require("../../../store/draftEventStore") as typeof import("../../../store/draftEventStore");
  const g = globalThis as Record<string, unknown>;
  return {
    __esModule: true,
    RsvpCreatorWizard: (props: {
      draft: { id: string; name: string };
      onAutosaveDraft: (d: unknown) => void;
    }) => {
      ReactActual.useEffect(() => {
        g.__wizardMounts = ((g.__wizardMounts as number) ?? 0) + 1;
      }, []);
      ReactActual.useEffect(() => {
        store.getState().beginDraftEdit(props.draft.id);
        return (): void => {
          store.getState().endDraftEdit(props.draft.id);
        };
      }, [props.draft.id]);
      g.__lastOnAutosave = props.onAutosaveDraft;
      g.__lastDraftName = props.draft.name;
      return null;
    },
  };
});

jest.mock("../../ui/Spinner", () => ({ __esModule: true, Spinner: (): null => null }));
jest.mock("../../ui/Toast", () => ({ __esModule: true, Toast: (): null => null }));
jest.mock("../../ui/Button", () => ({ __esModule: true, Button: (): null => null }));
jest.mock("../../event/EditPublishedScreen", () => ({
  __esModule: true,
  EditPublishedScreen: (): null => null,
}));

jest.mock("../../../store/currentBrandStore", () => ({
  __esModule: true,
  useBrandList: () => [{ id: "brand_0976", slug: "brand-0976", displayName: "T" }],
}));
jest.mock("../../../store/liveEventStore", () => ({
  __esModule: true,
  useLiveEventStore: () => null,
}));
jest.mock("../../../hooks/useBusinessEvents", () => ({
  __esModule: true,
  useBusinessEventById: () => ({
    data: undefined,
    isLoading: false,
    isFetching: false,
    isError: false,
  }),
}));
jest.mock("../../../hooks/useRsvpEvents", () => ({
  __esModule: true,
  usePublishRsvpDraft: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

jest.mock("../../../utils/liveEventConverter", () => ({
  __esModule: true,
  convertDraftToLiveEvent: () => null,
}));

// Deferred service mock — resolution is test-controlled so keystrokes can land
// DURING the in-flight insert, exactly like the 1-3 s device round-trip.
const createServerDraftMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock("../../../services/eventDrafts", () => ({
  __esModule: true,
  createServerDraft: (...args: unknown[]) => createServerDraftMock(...args),
  discardServerDraft: jest.fn(() => Promise.resolve()),
  autosaveServerDraft: jest.fn(() => Promise.reject(new Error("not used"))),
  fetchDraftById: jest.fn(() => Promise.resolve(null)),
  fetchDraftsForBrand: jest.fn(() => Promise.resolve([])),
  isServerDraftLifecycleError: () => false,
}));

// The hooks module is REAL (useServerDraftsForBrand — the second armed
// instance under test — plus eventDraftKeys, which the registry dereferences
// at swap time; a factory mock here would break the benign
// draftPromotion↔hooks module cycle). Its network edges are the mocked
// services + the key-discriminated useQuery above.

import RsvpEditRoute from "../../../../app/rsvp/[id]/edit";
import { useServerDraftsForBrand } from "../../../hooks/useServerDraftEvents";
import {
  useDraftEventStore,
  type DraftEvent,
} from "../../../store/draftEventStore";
import { __resetDraftPromotionRegistryForTests } from "../../../utils/draftPromotion";

// react-test-renderer ships no bundled types; CJS-require it the way the #976
// investigation probe did (proven under this stock config).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const TestRenderer = require("react-test-renderer") as {
  create: (el: React.ReactElement) => { unmount: () => void };
  act: (cb: () => Promise<void> | void) => Promise<void> | void;
};

const BRAND_ID = "brand_0976";
const SERVER_ID = "0f976000-aaaa-bbbb-cccc-000000000976";

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

describe("issue #976 — RSVP route: first-keystroke promotion never remounts the wizard nor loses text", () => {
  let tree: { unmount: () => void } | null = null;
  const g = globalThis as Record<string, unknown>;

  beforeEach(() => {
    __resetDraftPromotionRegistryForTests();
    useDraftEventStore.getState().reset();
    createServerDraftMock.mockReset();
    fakeQueryClient.setQueryData.mockClear();
    fakeQueryClient.getQueriesData.mockClear();
    replaceCalls.length = 0;
    setParamsCalls.length = 0;
    nav.keyCounter = 0;
    g.__wizardMounts = 0;
    g.__lastOnAutosave = undefined;
    g.__lastDraftName = null;
  });

  afterEach(() => {
    if (tree !== null) {
      TestRenderer.act(() => {
        tree?.unmount();
      });
      tree = null;
    }
  });

  test("armed second list-hook instance + burst typing across the in-flight insert: 1 mount, 0 replace, 1 row, full live text", async () => {
    const draft = useDraftEventStore.getState().createRsvpDraft(BRAND_ID);
    const dId = draft.id;
    nav.state = { key: "k0", params: { id: dId, step: "0" } };

    let resolveInsert: () => void = () => undefined;
    createServerDraftMock.mockImplementation(
      (_brandId: unknown, source: unknown) =>
        new Promise((resolve) => {
          resolveInsert = () =>
            resolve({
              ...(source as DraftEvent),
              id: SERVER_ID,
              serverSlug: "draft-orch0976",
              legacyLocalDraftId: (source as DraftEvent).id,
            });
        }),
    );

    const RouteHost: React.FC = () => {
      const [, setTick] = React.useState(0);
      nav.rerender = () => setTick((t) => t + 1);
      return (
        <React.Fragment key={nav.state.key}>
          <ArmedListHook />
          <RsvpEditRoute />
        </React.Fragment>
      );
    };

    await TestRenderer.act(async () => {
      tree = TestRenderer.create(<RouteHost />);
    });
    await flush();

    expect(g.__wizardMounts).toBe(1);
    expect(typeof g.__lastOnAutosave).toBe("function");
    // Wizard mount armed the edit session.
    expect(useDraftEventStore.getState().activeDraftId).toBe(dId);

    // ── First dirty keystroke ("Z"). The armed list hook's migration effect
    //    re-runs — and MUST NOT fire a promotion (activeDraftId suppression).
    await TestRenderer.act(async () => {
      useDraftEventStore.getState().updateDraft(dId, { name: "Z", clientRevision: 1 });
      useDraftEventStore.getState().markDraftDirty(dId, 1);
    });
    await flush();
    expect(createServerDraftMock).toHaveBeenCalledTimes(0);

    // ── The wizard's own debounced autosave fires with the queue-time
    //    snapshot (name "Z") — the route promotes through the registry.
    const snapshot = useDraftEventStore.getState().getDraft(dId);
    expect(snapshot).not.toBeNull();
    await TestRenderer.act(async () => {
      (g.__lastOnAutosave as (d: DraftEvent) => void)({ ...(snapshot as DraftEvent) });
    });
    expect(createServerDraftMock).toHaveBeenCalledTimes(1);

    // ── Burst typing lands DURING the in-flight insert.
    await TestRenderer.act(async () => {
      useDraftEventStore
        .getState()
        .updateDraft(dId, { name: "ZZDIAG976B", clientRevision: 9 });
      useDraftEventStore.getState().markDraftDirty(dId, 9);
    });
    await flush();
    // Still exactly one insert (single-flight; loop still suppressed).
    expect(createServerDraftMock).toHaveBeenCalledTimes(1);

    // ── The insert resolves (the device's 1-3 s later).
    await TestRenderer.act(async () => {
      resolveInsert();
      await Promise.resolve();
    });
    await flush();

    // EXACTLY ONE server row; the wizard NEVER remounted; zero router.replace.
    expect(createServerDraftMock).toHaveBeenCalledTimes(1);
    expect(g.__wizardMounts).toBe(1);
    expect(replaceCalls).toEqual([]);
    // The store swap landed the FULL live text — not the "Z" snapshot.
    expect(useDraftEventStore.getState().getDraft(SERVER_ID)?.name).toBe(
      "ZZDIAG976B",
    );
    // URL reconciled in place onto the server id.
    expect(setParamsCalls).toContainEqual({ id: SERVER_ID, step: "0" });
    expect(useDraftEventStore.getState().getDraft(dId)).toBeNull();
    // Exactly one draft for the brand remains (no duplicates).
    expect(
      useDraftEventStore
        .getState()
        .drafts.filter((d) => d.brandId === BRAND_ID),
    ).toHaveLength(1);
    // The wizard is now rendering the promoted draft with the live text.
    expect(g.__lastDraftName).toBe("ZZDIAG976B");
  });
});

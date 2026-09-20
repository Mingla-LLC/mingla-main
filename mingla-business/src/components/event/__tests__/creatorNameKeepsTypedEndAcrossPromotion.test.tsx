/**
 * Creator name field keeps the END of what the host typed across the d_*→server
 * promotion (host report 2026-09-17: "Record Launch: Room + Stream" was left as
 * "Record Launch"; an RSVP "Members' Table" was left as "Members'").
 *
 * WHAT HAPPENED
 * A new event or RSVP starts on a client-only `d_*` id. The first autosave
 * creates the server row and swaps the store entry to the server id
 * (`replaceDraft`). The route only re-renders the wizard against that id in a
 * LATER scheduler task (`setPromotedServerId` is a default-priority update),
 * while the keystrokes already queued behind the swap are handled first. Their
 * update callback still carried the `d_*` id: `updateDraft(d_*)` matched
 * nothing, the letters were dropped, and the field was set back to the swapped
 * copy — so the whole tail typed during that window was lost.
 *
 * WHAT THIS PINS
 *   - the REAL edit routes + REAL wizards + REAL Step 1 name `Input` keep every
 *     letter typed between the store swap and the route's promotion render, and
 *     the field never shows a shorter value than was typed;
 *   - the store itself: a write addressed to a promoted `d_*` id lands on the
 *     server draft, while `getDraft(d_*)` keeps its raw null (the promotion
 *     registry relies on it) and nothing is resurrected after a discard.
 *
 * MODEL OF THE DEVICE ORDERING
 * A concurrent root on the mock scheduler, so the test decides which React work
 * runs. The store swap's re-render is sync-lane work (a microtask on React
 * Native; an immediate scheduler task here) and is flushed; the route's
 * `setPromotedServerId` render is default-lane work and is held back. The
 * keystrokes are fired in between — where queued native text events land.
 *
 * FAILS ON REVERT (each checked against origin/main's draftEventStore.ts)
 *   - whole store change reverted → all three go red; both routes end on
 *     "Record Launch", the host's exact report;
 *   - only the `useDraftById` redirect dropped → both route tests go red (the
 *     wizard stays on the pre-swap copy and the field goes backwards);
 *   - only the `updateDraft` redirect dropped → the store test goes red (a write
 *     from a callback still holding the `d_*` id is lost again).
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// The test decides when React's scheduler tasks run (see header).
jest.mock("scheduler", () =>
  jest.requireActual<Record<string, unknown>>("scheduler/unstable_mock"),
);

// ── Navigation harness: setParams patches params in place (no remount). ──
type RouteState = { key: string; params: Record<string, string> };
const mockNav: { state: RouteState; rerender: () => void } = {
  state: { key: "k0", params: {} },
  rerender: () => undefined,
};
const mockNavigationObject = { isFocused: (): boolean => true };

jest.mock("expo-router", () => {
  const ReactActual = require("react") as typeof React;
  return {
    __esModule: true,
    useLocalSearchParams: () => mockNav.state.params,
    useNavigation: () => mockNavigationObject,
    useFocusEffect: (cb: () => void | (() => void)) => {
      ReactActual.useEffect(cb, [cb]);
    },
    useRouter: () => ({
      replace: jest.fn(),
      push: jest.fn(),
      back: jest.fn(),
      canGoBack: () => true,
      setParams: (p: Record<string, string>) => {
        mockNav.state = {
          key: mockNav.state.key,
          params: { ...mockNav.state.params, ...p },
        };
        mockNav.rerender();
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

const mockQueryClient = {
  setQueryData: jest.fn(),
  getQueryData: jest.fn(() => undefined),
  getQueriesData: jest.fn(() => [] as unknown[]),
  removeQueries: jest.fn(),
  invalidateQueries: jest.fn(),
};
jest.mock("@tanstack/react-query", () => ({
  __esModule: true,
  useQueryClient: () => mockQueryClient,
  useQuery: () => ({
    data: undefined,
    isLoading: false,
    isFetching: false,
    isError: false,
  }),
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
    user: { id: "user_typed_end" },
  }),
}));

// Deferred insert: the test decides when the server row "comes back".
const mockCreateServerDraft = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock("../../../services/eventDrafts", () => ({
  __esModule: true,
  createServerDraft: (...args: unknown[]) => mockCreateServerDraft(...args),
  discardServerDraft: jest.fn(() => Promise.resolve()),
  autosaveServerDraft: jest.fn(() => new Promise(() => undefined)),
  fetchDraftById: jest.fn(() => Promise.resolve(null)),
  fetchDraftsForBrand: jest.fn(() => Promise.resolve([])),
  fetchServerDraftCover: jest.fn(() => Promise.resolve(null)),
  isServerDraftLifecycleError: () => false,
  isDraftRevisionConflictError: () => false,
}));

jest.mock("../../../hooks/useBusinessRecent", () => ({
  __esModule: true,
  discardBusinessRecentDraft: jest.fn(),
  promoteBusinessRecentDraft: jest.fn(),
  useSuccessfulBusinessRecentOpen: jest.fn(),
}));
jest.mock("../../../store/currentBrandStore", () => ({
  __esModule: true,
  useBrandList: () => [
    { id: "brand_typed_end", slug: "brand-typed-end", displayName: "Brand" },
  ],
  useCurrentBrand: () => null,
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
  usePublishBusinessEventDraft: () => ({ publishDraft: jest.fn(), isPending: false }),
}));
jest.mock("../../../hooks/useRsvpEvents", () => ({
  __esModule: true,
  usePublishRsvpDraft: () => ({ publishDraft: jest.fn(), isPending: false }),
  usePublishBusinessRsvpDraft: () => ({ publishDraft: jest.fn(), isPending: false }),
}));
jest.mock("../../../utils/liveEventConverter", () => ({
  __esModule: true,
  convertDraftToLiveEvent: () => null,
}));

// Visual leaves and the other steps — not part of the name field's value flow.
jest.mock("../../ui/Spinner", () => ({ __esModule: true, Spinner: (): null => null }));
jest.mock("../../ui/Toast", () => ({ __esModule: true, Toast: (): null => null }));
jest.mock("../../ui/Button", () => ({ __esModule: true, Button: (): null => null }));
jest.mock("../../ui/Icon", () => ({ __esModule: true, Icon: (): null => null }));
jest.mock("../../ui/IconChrome", () => ({ __esModule: true, IconChrome: (): null => null }));
jest.mock("@mingla/brand-assets", () => ({
  __esModule: true,
  MINGLA_BUSINESS_LOGO: 1,
  MINGLA_WORDMARK: 1,
  MINGLA_APP_ICON: 1,
}));
jest.mock("../../intel/createDeferredTurnoutIntelProvider", () => ({
  __esModule: true,
  createDeferredTurnoutIntelProvider:
    () =>
    ({ children }: { children?: React.ReactNode }) =>
      children ?? null,
}));
jest.mock("../../intel/useTurnoutFocusTarget", () => ({
  __esModule: true,
  useTurnoutFocusTarget: () => false,
}));
jest.mock("../../ui/Sheet", () => ({ __esModule: true, Sheet: (): null => null }));
jest.mock("../../ui/TopBar", () => ({ __esModule: true, TopBar: (): null => null }));
jest.mock("../../ui/Stepper", () => ({ __esModule: true, Stepper: (): null => null }));
jest.mock("../../ui/ConfirmDialog", () => ({
  __esModule: true,
  ConfirmDialog: (): null => null,
}));
jest.mock("../../ui/GlassCard", () => ({
  __esModule: true,
  GlassCard: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
jest.mock("../EditPublishedScreen", () => ({
  __esModule: true,
  EditPublishedScreen: (): null => null,
}));
jest.mock("../PublishErrorsSheet", () => ({
  __esModule: true,
  PublishErrorsSheet: (): null => null,
}));
jest.mock("../../rsvp/RsvpStep5Setup", () => ({ __esModule: true, RsvpStep5Setup: (): null => null }));
jest.mock("../../rsvp/RsvpStep7Preview", () => ({ __esModule: true, RsvpStep7Preview: (): null => null }));
jest.mock("../../../hooks/useBrandStripeStatus", () => ({
  __esModule: true,
  useBrandStripeStatus: () => ({ data: undefined, isLoading: false, isError: false }),
}));
jest.mock("../CreatorStep2When", () => ({ __esModule: true, CreatorStep2When: (): null => null }));
jest.mock("../CreatorStep3Where", () => ({ __esModule: true, CreatorStep3Where: (): null => null }));
jest.mock("../CreatorStep4Cover", () => ({ __esModule: true, CreatorStep4Cover: (): null => null }));
jest.mock("../CreatorStep5Tickets", () => ({ __esModule: true, CreatorStep5Tickets: (): null => null }));
jest.mock("../CreatorStep6Settings", () => ({ __esModule: true, CreatorStep6Settings: (): null => null }));
jest.mock("../CreatorStep7Preview", () => ({ __esModule: true, CreatorStep7Preview: (): null => null }));
jest.mock("../../../wrappers/SmartScrollView", () => {
  const ReactActual = require("react") as typeof React;
  return {
    __esModule: true,
    ScrollView: ReactActual.forwardRef(
      (props: { children?: React.ReactNode }, ref: React.Ref<unknown>) =>
        ReactActual.createElement("ScrollView", { ...props, ref }, props.children),
    ),
  };
});
jest.mock("../../../wrappers/useKeyboardIsVisible", () => ({
  __esModule: true,
  useKeyboardIsVisible: () => false,
}));

import EventEditRoute from "../../../../app/event/[id]/edit";
import RsvpEditRoute from "../../../../app/rsvp/[id]/edit";
import {
  useDraftEventStore,
  type DraftEvent,
} from "../../../store/draftEventStore";
import { __resetDraftPromotionRegistryForTests } from "../../../utils/draftPromotion";

type HostNode = { type: unknown; props: Record<string, unknown> };
type Tree = {
  root: { findAll: (predicate: (node: HostNode) => boolean) => HostNode[] };
  unmount: () => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Scheduler = require("scheduler") as {
  unstable_flushExpired: () => void;
  unstable_flushAllWithoutAsserting: () => boolean;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (
    element: React.ReactElement,
    options?: { unstable_isConcurrent?: boolean },
  ) => Tree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

const BRAND_ID = "brand_typed_end";
const SERVER_ID = "0e0d0000-aaaa-bbbb-cccc-00000000e0d0";
const TYPED = "Record Launch: Room + Stream";
const BEFORE_SWAP = "Record Launch";

const nameField = (tree: Tree): HostNode => {
  const fields = tree.root.findAll(
    (n) => n.type === "TextInput" && n.props.accessibilityLabel === "Event name",
  );
  expect(fields).toHaveLength(1);
  return fields[0];
};

/**
 * Types "Record Launch" into the REAL Step 1 name field of the REAL route, lets
 * the wizard's own autosave promote the draft, then types ": Room + Stream" in
 * the window between the store swap and the route's promotion render.
 */
const typeAcrossPromotion = async (
  Route: React.ComponentType,
  kind: "event" | "rsvp",
): Promise<{ tree: Tree; shown: string[]; localId: string }> => {
  const store = useDraftEventStore.getState();
  const local =
    kind === "rsvp" ? store.createRsvpDraft(BRAND_ID) : store.createDraft(BRAND_ID);
  mockNav.state = { key: "k0", params: { id: local.id, step: "0" } };

  let resolveInsert: () => void = () => undefined;
  mockCreateServerDraft.mockImplementation(
    (_brandId: unknown, source: unknown) =>
      new Promise((resolve) => {
        resolveInsert = () =>
          resolve({
            ...(source as DraftEvent),
            id: SERVER_ID,
            serverSlug: "draft-typed-end",
            legacyLocalDraftId: (source as DraftEvent).id,
          });
      }),
  );

  const RouteHost: React.FC = () => {
    const [, setTick] = React.useState(0);
    mockNav.rerender = () => setTick((t) => t + 1);
    return <Route />;
  };

  let tree!: Tree;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(<RouteHost />, { unstable_isConcurrent: true });
  });

  // Type the first part; the wizard's own 700 ms autosave then promotes.
  for (let i = 1; i <= BEFORE_SWAP.length; i += 1) {
    await TestRenderer.act(async () => {
      (nameField(tree).props.onChangeText as (v: string) => void)(
        TYPED.slice(0, i),
      );
    });
  }
  await TestRenderer.act(async () => {
    await new Promise((r) => setTimeout(r, 800));
  });
  expect(mockCreateServerDraft).toHaveBeenCalledTimes(1);

  // Start the window from a quiet scheduler.
  Scheduler.unstable_flushAllWithoutAsserting();

  // The server row comes back. Run microtasks only until the registry has
  // swapped the store entry — the route's own promotion callback sits a few
  // promise hops later and has not run.
  resolveInsert();
  for (
    let i = 0;
    i < 10 && useDraftEventStore.getState().getDraft(local.id) !== null;
    i += 1
  ) {
    await Promise.resolve();
  }
  expect(useDraftEventStore.getState().getDraft(local.id)).toBeNull();
  // The swap's own sync re-render (a microtask on React Native).
  Scheduler.unstable_flushExpired();

  // The keystrokes queued behind the swap are handled back to back, each
  // followed by its sync re-render, with no promise hop in between — so the
  // route has still not moved the wizard onto the server id by itself.
  const shown: string[] = [];
  for (let i = BEFORE_SWAP.length + 1; i <= TYPED.length; i += 1) {
    (nameField(tree).props.onChangeText as (v: string) => void)(
      TYPED.slice(0, i),
    );
    Scheduler.unstable_flushExpired();
    shown.push(nameField(tree).props.value as string);
  }

  // Now let the promotion render and everything else settle.
  await TestRenderer.act(async () => {
    Scheduler.unstable_flushAllWithoutAsserting();
    await new Promise((r) => setTimeout(r, 50));
  });
  return { tree, shown, localId: local.id };
};

/** Every prefix typed after the swap, in order. */
const EXPECTED_SHOWN = Array.from(
  { length: TYPED.length - BEFORE_SWAP.length },
  (_, k) => TYPED.slice(0, BEFORE_SWAP.length + k + 1),
);

describe("creator name keeps the typed end across the d_*→server promotion", () => {
  let mounted: Tree | null = null;

  beforeEach(() => {
    __resetDraftPromotionRegistryForTests();
    useDraftEventStore.getState().reset();
    mockCreateServerDraft.mockReset();
  });

  afterEach(async () => {
    if (mounted !== null) {
      const tree = mounted;
      await TestRenderer.act(() => {
        tree.unmount();
      });
      mounted = null;
    }
  });

  test("store: a write addressed to a promoted d_* id lands on the server draft", () => {
    const store = useDraftEventStore.getState();
    const local = store.createDraft(BRAND_ID);
    store.updateDraft(local.id, { name: BEFORE_SWAP, clientRevision: 13 });
    store.replaceDraft(local.id, {
      ...(store.getDraft(local.id) as DraftEvent),
      id: SERVER_ID,
    });

    useDraftEventStore.getState().updateDraft(local.id, {
      name: TYPED,
      clientRevision: 28,
    });

    const state = useDraftEventStore.getState();
    expect(state.getDraft(SERVER_ID)?.name).toBe(TYPED);
    expect(state.getDraft(SERVER_ID)?.clientRevision).toBe(28);
    // Raw lookups keep their meaning — the promotion registry depends on it.
    expect(state.getDraft(local.id)).toBeNull();
    expect(state.drafts).toHaveLength(1);

    // A discarded server draft is never resurrected by a late write.
    state.deleteDraft(SERVER_ID);
    useDraftEventStore.getState().updateDraft(local.id, { name: "late" });
    expect(useDraftEventStore.getState().drafts).toHaveLength(0);

    // Sign-out (reset) forgets where old ids went.
    const other = useDraftEventStore.getState().createDraft(BRAND_ID);
    useDraftEventStore.getState().replaceDraft(other.id, { ...other, id: "srv-2" });
    useDraftEventStore.getState().reset();
    useDraftEventStore.setState({ drafts: [{ ...other, id: "srv-2", name: "kept" }] });
    useDraftEventStore.getState().updateDraft(other.id, { name: "must not land" });
    expect(useDraftEventStore.getState().getDraft("srv-2")?.name).toBe("kept");
  });

  test("event route: every letter typed across the promotion stays, and the field never goes backwards", async () => {
    const { tree, shown } = await typeAcrossPromotion(EventEditRoute, "event");
    mounted = tree;

    expect(shown).toEqual(EXPECTED_SHOWN);
    expect(useDraftEventStore.getState().getDraft(SERVER_ID)?.name).toBe(TYPED);
    expect(nameField(tree).props.value).toBe(TYPED);
    expect(useDraftEventStore.getState().drafts).toHaveLength(1);
  });

  test("RSVP route: every letter typed across the promotion stays, and the field never goes backwards", async () => {
    const { tree, shown } = await typeAcrossPromotion(RsvpEditRoute, "rsvp");
    mounted = tree;

    expect(shown).toEqual(EXPECTED_SHOWN);
    const promoted = useDraftEventStore.getState().getDraft(SERVER_ID);
    expect(promoted?.isRsvp).toBe(true);
    expect(promoted?.name).toBe(TYPED);
    expect(nameField(tree).props.value).toBe(TYPED);
    expect(useDraftEventStore.getState().drafts).toHaveLength(1);
  });
});

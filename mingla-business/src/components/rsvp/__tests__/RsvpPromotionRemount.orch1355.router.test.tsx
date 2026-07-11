/**
 * ORCH-1355 — RSVP draft-promotion route-remount PROOF (symptom 1, name-field
 * keyboard drop). Event route: EventPromotionRemount.orch1355.router.test.tsx
 * (byte-identical trigger; one mount per file — this RTL build does not tear a
 * react-test-renderer tree down between mounts in a single file, which suppresses
 * a second mount's effects, so each route lives in its own file for isolation).
 *
 * Seth: "when I click the field to enter the event name, after entering like a
 * letter, it enters and the keyboard goes away." The investigation (§11)
 * source-proved the TRIGGER but could NOT get the JS-level remount proof: the
 * FIRST dirty keystroke promotes the client `d_<ts36>` draft to a server draft
 * and the route called `router.replace('/rsvp/<serverId>/edit')`, changing the
 * `[id]` dynamic segment → expo-router replaces the screen instance → the name
 * `TextInput` remounts → the keyboard drops (~700 ms after the first char).
 *
 * THIS test delivers the JS-level proof the investigation was blocked on (the
 * real `expo-router/testing-library` harness was unstable under the worktree's
 * symlinked node_modules). It MOCKS expo-router with a faithful model of
 * React-Navigation screen identity:
 *
 *   - `router.replace(href)` to a NEW `[id]` → a NEW screen (new route key) →
 *     the route host is re-keyed → the mounted subtree REMOUNTS. This is exactly
 *     what a real Stack navigator does when the dynamic path segment changes.
 *   - `router.setParams(p)` → an in-place `SET_PARAMS` on the SAME focused route
 *     (route key unchanged) → the mounted subtree is preserved → NO remount.
 *     This is exactly what React-Navigation core guarantees for setParams.
 *
 * The route host is keyed by the modeled route key; a mount-counting probe
 * occupies the wizard/name-input slot. The test mounts the REAL production route
 * (`app/rsvp/[id]/edit.tsx`), seeds a real `draftEventStore` client draft, fires
 * the real first-edit autosave → real `handleAutosaveDraft` promotion, and
 * measures whether the name input remounts.
 *
 * INVARIANT under test: I-PROPOSED-1355-DRAFT-PROMOTION-NO-REMOUNT — promoting a
 * client draft to a server draft during an active wizard session MUST NOT remount
 * the wizard subtree and MUST NOT call `router.replace` to a new draft id
 * mid-session (the URL is reconciled in place via `router.setParams`).
 *
 * PRE-FIX (eager `router.replace`): mountCount 1→2 + `router.replace` called →
 * this test FAILS (the failure IS the remount proof).
 * POST-FIX (`setParams` + route-state activeDraftId): mountCount stays 1 +
 * `router.replace` NOT called → this test PASSES. Fails-on-revert: restore the
 * eager `router.replace` → mountCount 1→2 → FAIL again.
 *
 * Run: npx jest --config jest.orch1355.promotion.cjs --runInBand
 */

import React from "react";
import { View } from "react-native";
import { act, render } from "@testing-library/react-native";

// ---------------------------------------------------------------------------
// Faithful expo-router model. A module-level "navigation state" holds the route
// key + params. `replace` to a new [id] mints a NEW key (screen remount);
// `setParams` keeps the key (in-place param update, no remount). A registered
// host re-renders whenever the state changes.
// ---------------------------------------------------------------------------
type RouteState = { key: string; params: Record<string, string> };
const nav: { state: RouteState; keyCounter: number; rerender: () => void } = {
  state: { key: "k0", params: {} },
  keyCounter: 0,
  rerender: () => {},
};
const replaceCalls: string[] = [];
const setParamsCalls: Array<Record<string, string>> = [];

const parseEditHref = (href: string): Record<string, string> | null => {
  const m = /\/(?:rsvp|event)\/([^/?]+)\/edit/.exec(href);
  if (m === null) return null;
  const params: Record<string, string> = { id: m[1] };
  const step = /[?&]step=([^&]+)/.exec(href);
  if (step !== null) params.step = step[1];
  const mode = /[?&]mode=([^&]+)/.exec(href);
  if (mode !== null) params.mode = mode[1];
  return params;
};

jest.mock("expo-router", () => ({
  __esModule: true,
  useLocalSearchParams: () => nav.state.params,
  useRouter: () => ({
    replace: (href: string) => {
      replaceCalls.push(href);
      const params = parseEditHref(href);
      // New dynamic-segment path → NEW screen instance (new route key).
      nav.state = {
        key: `k${++nav.keyCounter}`,
        params: params ?? { ...nav.state.params },
      };
      nav.rerender();
    },
    push: jest.fn(),
    setParams: (p: Record<string, string>) => {
      setParamsCalls.push(p);
      // In-place SET_PARAMS on the SAME focused route → key UNCHANGED.
      nav.state = { key: nav.state.key, params: { ...nav.state.params, ...p } };
      nav.rerender();
    },
  }),
}));

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

jest.mock("@tanstack/react-query", () => ({
  __esModule: true,
  useQueryClient: () => ({
    setQueryData: jest.fn(),
    getQueriesData: jest.fn(() => []),
    removeQueries: jest.fn(),
    invalidateQueries: jest.fn(),
  }),
}));

jest.mock("../../../context/AuthContext", () => ({
  __esModule: true,
  useAuth: () => ({ isAuthReady: true }),
}));

// The wizard is the INSTRUMENT: a mount-counting probe that captures the route's
// onAutosaveDraft so the test can fire the first-edit autosave.
jest.mock("../RsvpCreatorWizard", () => {
  const React2 = require("react");
  const { View: V } = require("react-native");
  const g: any = globalThis;
  return {
    __esModule: true,
    RsvpCreatorWizard: (props: any) => {
      React2.useEffect(() => {
        g.__wizardMounts = (g.__wizardMounts ?? 0) + 1;
      }, []);
      g.__lastOnAutosave = props.onAutosaveDraft;
      g.__lastDraftName = props.draft?.name ?? null;
      return <V testID="wizard-probe" />;
    },
  };
});

jest.mock("../../ui/Spinner", () => {
  const { View: V } = require("react-native");
  return { __esModule: true, Spinner: () => <V /> };
});
jest.mock("../../ui/Toast", () => {
  const { View: V } = require("react-native");
  return { __esModule: true, Toast: () => <V /> };
});
jest.mock("../../ui/Button", () => {
  const { View: V } = require("react-native");
  return { __esModule: true, Button: () => <V /> };
});
jest.mock("../../event/EditPublishedScreen", () => {
  const { View: V } = require("react-native");
  return { __esModule: true, EditPublishedScreen: () => <V /> };
});

jest.mock("../../../store/currentBrandStore", () => ({
  __esModule: true,
  useBrandList: () => [{ id: "brand_1355", slug: "brand-1355", name: "Test" }],
}));

jest.mock("../../../store/liveEventStore", () => ({
  __esModule: true,
  useLiveEventStore: () => null,
}));

jest.mock("../../../hooks/useServerDraftEvents", () => ({
  __esModule: true,
  eventDraftKeys: {
    detail: (id: string) => ["event-draft", "detail", id],
    list: (brandId: string) => ["event-draft", "list", brandId],
    lists: () => ["event-draft", "list"],
  },
  useServerDraftById: () => ({
    data: undefined,
    isLoading: true,
    isFetching: true,
    isError: false,
  }),
  useServerDraftAutosave: () => ({
    saveDraft: jest.fn(),
    isSaving: false,
    hasError: false,
    lastSavedAt: null,
  }),
  useDiscardServerDraft: () => ({ discardDraft: jest.fn(), isPending: false }),
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
  usePublishRsvpDraft: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

const SERVER_ID = "srv_ORCH1355";
jest.mock("../../../services/eventDrafts", () => ({
  __esModule: true,
  createServerDraft: jest.fn((_brandId: string, incoming: any) =>
    Promise.resolve({
      ...incoming,
      id: SERVER_ID,
      serverSlug: "srv-slug",
      legacyLocalDraftId: incoming.id,
    }),
  ),
}));

jest.mock("../../../utils/liveEventConverter", () => ({
  __esModule: true,
  convertDraftToLiveEvent: () => null,
}));

import RsvpEditRoute from "../../../../app/rsvp/[id]/edit";
import { useDraftEventStore } from "../../../store/draftEventStore";

// The route host models the navigator: keyed by the route key so a router.replace
// (new key) remounts the subtree, while a setParams (same key) preserves it.
const RouteHost: React.FC = () => {
  const [, setTick] = React.useState(0);
  nav.rerender = () => setTick((t) => t + 1);
  return (
    <View key={nav.state.key}>
      <RsvpEditRoute />
    </View>
  );
};

describe("ORCH-1355 — RSVP draft-promotion route remount (symptom 1)", () => {
  test("RSVP create: first-edit promotion does NOT remount the wizard", async () => {
    const g: any = globalThis;
    useDraftEventStore.getState().reset();
    g.__wizardMounts = 0;
    g.__lastOnAutosave = undefined;
    g.__lastDraftName = null;
    replaceCalls.length = 0;
    setParamsCalls.length = 0;
    nav.keyCounter = 0;

    const draft = useDraftEventStore.getState().createRsvpDraft("brand_1355");
    const id = draft.id;
    nav.state = { key: "k0", params: { id, step: "0" } };

    await act(async () => {
      render(<RouteHost />);
    });

    // Wizard mounted exactly once at initial render.
    expect(g.__wizardMounts).toBe(1);
    expect(typeof g.__lastOnAutosave).toBe("function");

    // First keystroke: the name field gets its first character → the draft goes
    // dirty in the store → the wizard's debounced autosave fires onAutosaveDraft.
    act(() => {
      useDraftEventStore
        .getState()
        .updateDraft(id, { name: "S", clientRevision: 1 });
    });
    const dirty = useDraftEventStore.getState().getDraft(id);
    expect(dirty?.name).toBe("S");

    // Fire the real first-edit autosave → real handleAutosaveDraft promotion.
    // createServerDraft + its .then (replaceDraft + setParams/replace) settle
    // inside this awaited act so the tree is stable before we assert.
    await act(async () => {
      g.__lastOnAutosave(dirty);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // eslint-disable-next-line no-console
    console.log(
      `[ORCH-1355 promotion rsvp] wizardMounts=${g.__wizardMounts} ` +
        `router.replace calls=${JSON.stringify(replaceCalls)} ` +
        `router.setParams calls=${JSON.stringify(setParamsCalls)} ` +
        `resolvedName=${g.__lastDraftName}`,
    );

    // The promotion actually happened: the store swapped the client draft for
    // the server draft.
    expect(useDraftEventStore.getState().getDraft(SERVER_ID)?.id).toBe(SERVER_ID);
    expect(useDraftEventStore.getState().getDraft(id)).toBeNull();

    // THE VERDICT (I-PROPOSED-1355-DRAFT-PROMOTION-NO-REMOUNT):
    //  1. the route did NOT call router.replace to a new draft id mid-session
    //     (the URL is reconciled in place via setParams), and
    //  2. the wizard/name-input did NOT remount on promotion (mount stays 1).
    const replacedToServer = replaceCalls.some((h) => h.includes(SERVER_ID));
    expect(replacedToServer).toBe(false);
    expect(g.__wizardMounts).toBe(1);
  });
});

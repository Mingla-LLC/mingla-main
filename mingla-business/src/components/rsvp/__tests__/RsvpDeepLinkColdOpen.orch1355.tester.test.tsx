/**
 * ORCH-1355 — SYMPTOM 1 regression guard: DEEP-LINK / RESUME-AFTER-KILL cold open.
 *
 * The symptom-1 fix decouples the rendered draft id from the URL
 * (`effectiveDraftId = promotedServerId ?? idParam`). This guards the OTHER half
 * of the contract: a COLD open straight at a SERVER draft id (a deep link, or a
 * relaunch after the app was killed — which, thanks to the fix, now lands the URL
 * on the server id) must still resolve and render the wizard WITHOUT any
 * promotion churn, because `promotedServerId` starts null so
 * `effectiveDraftId === idParam === serverId`.
 *
 * Asserts, for a cold mount at `/rsvp/<serverId>/edit`:
 *   1. the wizard mounts once and resolves the server draft (name visible),
 *   2. NO createServerDraft (no re-promotion of an already-server draft),
 *   3. NO router.replace and NO router.setParams on open,
 *   4. a subsequent dirty edit autosaves via the server-id path
 *      (autosave.saveDraft), NOT via createServerDraft, with NO replace/setParams
 *      and NO remount — i.e. a resumed draft edits normally, keyboard-safe.
 *
 * This is a POSITIVE/regression guard (proves the fix did not break deep-linking
 * / resume), complementary to the promotion fails-on-revert guards.
 *
 * Run: npx jest --config jest.orch1355.tester.cjs --runInBand
 */

import React from "react";
import { View } from "react-native";
import { act, render } from "@testing-library/react-native";

type RouteState = { key: string; params: Record<string, string> };
const nav: { state: RouteState; keyCounter: number; rerender: () => void } = {
  state: { key: "k0", params: {} },
  keyCounter: 0,
  rerender: () => {},
};
const replaceCalls: string[] = [];
const setParamsCalls: Array<Record<string, string>> = [];
const mockSaveDraft = jest.fn();

jest.mock("expo-router", () => ({
  __esModule: true,
  useLocalSearchParams: () => nav.state.params,
  useRouter: () => ({
    replace: (href: string) => {
      replaceCalls.push(href);
      nav.state = { key: `k${++nav.keyCounter}`, params: { ...nav.state.params } };
      nav.rerender();
    },
    push: jest.fn(),
    setParams: (p: Record<string, string>) => {
      setParamsCalls.push(p);
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
  return { __esModule: true, Spinner: () => <V testID="spinner" /> };
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
  // A resumed server draft has already loaded — data present, not loading.
  useServerDraftById: () => ({
    data: { id: "srv_ORCH1355" },
    isLoading: false,
    isFetching: false,
    isError: false,
  }),
  useServerDraftAutosave: () => ({
    saveDraft: mockSaveDraft,
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
    Promise.resolve({ ...incoming, id: SERVER_ID }),
  ),
}));

jest.mock("../../../utils/liveEventConverter", () => ({
  __esModule: true,
  convertDraftToLiveEvent: () => null,
}));

import RsvpEditRoute from "../../../../app/rsvp/[id]/edit";
import { useDraftEventStore } from "../../../store/draftEventStore";
import { createServerDraft } from "../../../services/eventDrafts";

const RouteHost: React.FC = () => {
  const [, setTick] = React.useState(0);
  nav.rerender = () => setTick((t) => t + 1);
  return (
    <View key={nav.state.key}>
      <RsvpEditRoute />
    </View>
  );
};

describe("ORCH-1355 symptom 1 — deep-link / resume cold open (server id)", () => {
  test("cold open at a server draft id resolves the wizard with no promotion, no replace, no setParams; a later edit autosaves via the server path without remount", async () => {
    const g: any = globalThis;
    useDraftEventStore.getState().reset();
    g.__wizardMounts = 0;
    g.__lastOnAutosave = undefined;
    g.__lastDraftName = null;
    replaceCalls.length = 0;
    setParamsCalls.length = 0;
    mockSaveDraft.mockClear();
    (createServerDraft as jest.Mock).mockClear();
    nav.keyCounter = 0;

    // Seed a SERVER-id RSVP draft directly in the store (as a resume/deep-link
    // landing would have hydrated it). Built from a real createRsvpDraft base so
    // isRsvp === true (the route bounces non-RSVP drafts to the event route).
    const base = useDraftEventStore.getState().createRsvpDraft("brand_1355");
    useDraftEventStore
      .getState()
      .replaceDraft(base.id, { ...base, id: SERVER_ID, name: "Resumed Party" });

    nav.state = { key: "k0", params: { id: SERVER_ID, step: "0" } };

    await act(async () => {
      render(<RouteHost />);
    });

    // eslint-disable-next-line no-console
    console.log(
      `[ORCH-1355 tester deeplink] mounts=${g.__wizardMounts} ` +
        `name=${g.__lastDraftName} replace=${JSON.stringify(replaceCalls)} ` +
        `setParams=${JSON.stringify(setParamsCalls)} ` +
        `createServerDraft=${(createServerDraft as jest.Mock).mock.calls.length}`,
    );

    // 1. Wizard mounted once, resolving the SERVER draft.
    expect(g.__wizardMounts).toBe(1);
    expect(g.__lastDraftName).toBe("Resumed Party");
    // 2. No re-promotion of an already-server draft.
    expect((createServerDraft as jest.Mock).mock.calls.length).toBe(0);
    // 3. No URL churn on cold open.
    expect(replaceCalls).toEqual([]);
    expect(setParamsCalls).toEqual([]);

    // 4. A later dirty edit on the server-id draft autosaves via the server path
    //    (branch a), NOT via createServerDraft, and does not remount or re-route.
    const keyBefore = nav.state.key;
    act(() => {
      useDraftEventStore
        .getState()
        .updateDraft(SERVER_ID, { name: "Resumed Party!", clientRevision: 3 });
    });
    const edited = useDraftEventStore.getState().getDraft(SERVER_ID);
    await act(async () => {
      g.__lastOnAutosave(edited);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
    expect((createServerDraft as jest.Mock).mock.calls.length).toBe(0);
    expect(replaceCalls).toEqual([]);
    expect(setParamsCalls).toEqual([]);
    expect(nav.state.key).toBe(keyBefore);
    expect(g.__wizardMounts).toBe(1);
  });
});

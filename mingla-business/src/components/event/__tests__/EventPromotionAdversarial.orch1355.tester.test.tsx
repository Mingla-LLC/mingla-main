/**
 * ORCH-1355 — SYMPTOM 1 (create-wizard name-field keyboard drop) TESTER
 * ADVERSARIAL guard, EVENT route (create-flow-wide; the fix is byte-identical to
 * the RSVP route). DIFFERENT ANGLE from the implementor's happy-path
 * EventPromotionRemount.orch1355.router.test.tsx (which asserts only "no
 * router.replace to the server id" + mount 1):
 *
 *   1. NO router.replace fires AT ALL during promotion (replaceCalls === []).
 *   2. The navigator ROUTE KEY is UNCHANGED across promotion (k0 → k0).
 *   3. The wizard mount counter stays 1.
 *   4. The URL/route params reconcile to the SERVER id in place
 *      (nav.state.params.id === SERVER_ID) — resume/kill lands on the real id.
 *
 * Fails-on-revert (PRODUCT code, c4a50bc81): restore the eager
 * `router.replace('/event/<serverId>/edit')` in app/event/[id]/edit.tsx →
 * replaceCalls non-empty + route key changes + mount 1→2 → FAILS.
 *
 * ONE mount per file (RTL build suppresses a second mount's effects).
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

const parseEditHref = (href: string): Record<string, string> | null => {
  const m = /\/(?:rsvp|event)\/([^/?]+)\/edit/.exec(href);
  if (m === null) return null;
  const params: Record<string, string> = { id: m[1] };
  const step = /[?&]step=([^&]+)/.exec(href);
  if (step !== null) params.step = step[1];
  return params;
};

jest.mock("expo-router", () => ({
  __esModule: true,
  useLocalSearchParams: () => nav.state.params,
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

jest.mock("../EventCreatorWizard", () => {
  const React2 = require("react");
  const { View: V } = require("react-native");
  const g: any = globalThis;
  return {
    __esModule: true,
    EventCreatorWizard: (props: any) => {
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
jest.mock("../EditPublishedScreen", () => {
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

import EventEditRoute from "../../../../app/event/[id]/edit";
import { useDraftEventStore } from "../../../store/draftEventStore";

const RouteHost: React.FC = () => {
  const [, setTick] = React.useState(0);
  nav.rerender = () => setTick((t) => t + 1);
  return (
    <View key={nav.state.key}>
      <EventEditRoute />
    </View>
  );
};

describe("ORCH-1355 symptom 1 — EVENT promotion tester adversarial", () => {
  test("EVENT promotion fires NO router.replace, keeps the route key, does NOT remount, and reconciles the URL to the server id", async () => {
    const g: any = globalThis;
    useDraftEventStore.getState().reset();
    g.__wizardMounts = 0;
    g.__lastOnAutosave = undefined;
    g.__lastDraftName = null;
    replaceCalls.length = 0;
    setParamsCalls.length = 0;
    nav.keyCounter = 0;

    const draft = useDraftEventStore.getState().createDraft("brand_1355");
    const id = draft.id;
    nav.state = { key: "k0", params: { id, step: "0" } };

    await act(async () => {
      render(<RouteHost />);
    });

    expect(g.__wizardMounts).toBe(1);
    expect(typeof g.__lastOnAutosave).toBe("function");
    const keyBefore = nav.state.key;

    act(() => {
      useDraftEventStore
        .getState()
        .updateDraft(id, { name: "S", clientRevision: 1 });
    });
    const dirty = useDraftEventStore.getState().getDraft(id);
    expect(dirty?.name).toBe("S");

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
      `[ORCH-1355 tester event] wizardMounts=${g.__wizardMounts} ` +
        `keyBefore=${keyBefore} keyAfter=${nav.state.key} ` +
        `replace=${JSON.stringify(replaceCalls)} ` +
        `setParams=${JSON.stringify(setParamsCalls)} ` +
        `paramId=${nav.state.params.id}`,
    );

    expect(useDraftEventStore.getState().getDraft(SERVER_ID)?.id).toBe(SERVER_ID);
    expect(useDraftEventStore.getState().getDraft(id)).toBeNull();

    // 1. NO router.replace AT ALL.
    expect(replaceCalls).toEqual([]);
    // 2. Route key unchanged.
    expect(nav.state.key).toBe(keyBefore);
    // 3. No remount.
    expect(g.__wizardMounts).toBe(1);
    // 4. URL reconciled to the server id in place.
    expect(nav.state.params.id).toBe(SERVER_ID);
    expect(setParamsCalls).toContainEqual({ id: SERVER_ID, step: "0" });
  });
});

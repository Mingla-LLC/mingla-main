/**
 * ORCH-1355 — EVENT draft-promotion route-remount PROOF (symptom 1, name-field
 * keyboard drop). Sibling of the RSVP proof
 * (src/components/rsvp/__tests__/RsvpPromotionRemount.orch1355.router.test.tsx);
 * separate file because this RTL build does not tear a react-test-renderer tree
 * down between two mounts in one file (a second mount's effects never fire), so
 * each route gets its own isolated file.
 *
 * The event create flow is BYTE-IDENTICAL to the RSVP one in the promotion path
 * (investigation §11.3): the first dirty keystroke promotes the client
 * `d_<ts36>` draft to a server draft; PRE-FIX the route called
 * `router.replace('/event/<serverId>/edit')`, changing the `[id]` dynamic
 * segment → expo-router replaces the screen → the name TextInput remounts → the
 * keyboard drops. The fix decouples the rendered draft id from the URL (route-
 * state activeDraftId) and reconciles the URL in place via `router.setParams`.
 *
 * expo-router is MOCKED with a faithful React-Navigation screen-identity model:
 * `router.replace` to a new [id] → new route key → REMOUNT; `router.setParams`
 * → in-place SET_PARAMS, same key → NO remount.
 *
 * INVARIANT: I-PROPOSED-1355-DRAFT-PROMOTION-NO-REMOUNT (applies to BOTH create
 * routes). PRE-FIX: mount 1→2 + router.replace → FAIL. POST-FIX: mount stays 1 +
 * no router.replace → PASS. Fails-on-revert: restore eager router.replace →
 * mount 1→2 → FAIL.
 *
 * Run: npx jest --config jest.orch1355.promotion.cjs --runInBand
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

describe("ORCH-1355 — EVENT draft-promotion route remount (symptom 1)", () => {
  test("EVENT create: first-edit promotion does NOT remount the wizard", async () => {
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
      `[ORCH-1355 promotion event] wizardMounts=${g.__wizardMounts} ` +
        `router.replace calls=${JSON.stringify(replaceCalls)} ` +
        `router.setParams calls=${JSON.stringify(setParamsCalls)} ` +
        `resolvedName=${g.__lastDraftName}`,
    );

    expect(useDraftEventStore.getState().getDraft(SERVER_ID)?.id).toBe(SERVER_ID);
    expect(useDraftEventStore.getState().getDraft(id)).toBeNull();

    const replacedToServer = replaceCalls.some((h) => h.includes(SERVER_ID));
    expect(replacedToServer).toBe(false);
    expect(g.__wizardMounts).toBe(1);
  });
});

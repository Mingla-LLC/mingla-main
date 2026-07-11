/**
 * ORCH-1355 — SYMPTOM 1 (create-wizard name-field keyboard drop) TESTER
 * ADVERSARIAL guard, RSVP route.
 *
 * DIFFERENT ANGLE from the implementor's happy-path router-mock
 * (RsvpPromotionRemount.orch1355.router.test.tsx), which asserts only that no
 * router.replace fires *to the server id* and that the mount counter stays 1.
 * This suite hardens the SAME promotion sequence from stricter/hostile angles:
 *
 *   1. NO router.replace fires AT ALL during promotion (replaceCalls === []),
 *      not merely "none to the server id" — the fix must never re-key the screen.
 *   2. The navigator ROUTE KEY is UNCHANGED across promotion (k0 → k0). This is
 *      the navigator-level no-remount proof (a router.replace mints a new key;
 *      setParams preserves it), complementary to the mount-counter.
 *   3. The wizard mount counter stays 1 (name TextInput never remounts).
 *   4. RESUME-AFTER-KILL: the URL/route params are reconciled to the SERVER id in
 *      place (nav.state.params.id === SERVER_ID) so a cold relaunch lands on the
 *      real draft (the deep-link resolution of that id is proven by
 *      RsvpDeepLinkColdOpen.orch1355.tester.test.tsx).
 *   5. HOSTILE — the user keeps typing WHILE the promotion is in flight: a second
 *      keystroke ("S" → "Se") lands on the d_* draft between createServerDraft and
 *      its resolve. The newer text MUST survive the d_*→server merge (ORCH-0893
 *      race-guard) AND the promotion still must NOT remount.
 *
 * Fails-on-revert (PRODUCT code, c4a50bc81): restore the eager
 * `router.replace('/rsvp/<serverId>/edit')` in app/rsvp/[id]/edit.tsx's
 * handleAutosaveDraft → replaceCalls is non-empty + the route key changes +
 * mount 1→2 → assertions 1/2/3 FAIL. Verified by true line deletion (TEST report).
 *
 * ONE mount per file (this RTL build suppresses a second mount's effects in a
 * single file — see RsvpPromotionRemount header); every angle is asserted about
 * the single promotion sequence.
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

const RouteHost: React.FC = () => {
  const [, setTick] = React.useState(0);
  nav.rerender = () => setTick((t) => t + 1);
  return (
    <View key={nav.state.key}>
      <RsvpEditRoute />
    </View>
  );
};

describe("ORCH-1355 symptom 1 — RSVP promotion tester adversarial", () => {
  test("promotion fires NO router.replace, keeps the route key, does NOT remount, reconciles the URL to the server id, and preserves keystrokes typed mid-promotion", async () => {
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

    expect(g.__wizardMounts).toBe(1);
    expect(typeof g.__lastOnAutosave).toBe("function");
    const keyBefore = nav.state.key;

    // First keystroke lands on the d_* draft → dirty.
    act(() => {
      useDraftEventStore
        .getState()
        .updateDraft(id, { name: "S", clientRevision: 1 });
    });
    const dirty = useDraftEventStore.getState().getDraft(id);
    expect(dirty?.name).toBe("S");

    // HOSTILE: the autosave fires (promotion in flight), and the user keeps
    // typing ("S" → "Se") into the d_* draft BEFORE createServerDraft resolves.
    await act(async () => {
      g.__lastOnAutosave(dirty);
      useDraftEventStore
        .getState()
        .updateDraft(id, { name: "Se", clientRevision: 2 });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // eslint-disable-next-line no-console
    console.log(
      `[ORCH-1355 tester rsvp] wizardMounts=${g.__wizardMounts} ` +
        `keyBefore=${keyBefore} keyAfter=${nav.state.key} ` +
        `replace=${JSON.stringify(replaceCalls)} ` +
        `setParams=${JSON.stringify(setParamsCalls)} ` +
        `paramId=${nav.state.params.id} resolvedName=${g.__lastDraftName} ` +
        `serverName=${useDraftEventStore.getState().getDraft(SERVER_ID)?.name}`,
    );

    // Promotion actually happened (store swapped d_* → server).
    expect(useDraftEventStore.getState().getDraft(SERVER_ID)?.id).toBe(SERVER_ID);
    expect(useDraftEventStore.getState().getDraft(id)).toBeNull();

    // 1. NO router.replace AT ALL.
    expect(replaceCalls).toEqual([]);
    // 2. Route key unchanged (navigator-level no-remount).
    expect(nav.state.key).toBe(keyBefore);
    // 3. Wizard/name-input never remounted.
    expect(g.__wizardMounts).toBe(1);
    // 4. RESUME-AFTER-KILL: URL/route params reconciled to the server id in place.
    expect(nav.state.params.id).toBe(SERVER_ID);
    expect(setParamsCalls).toContainEqual({ id: SERVER_ID, step: "0" });
    // 5. HOSTILE: the keystroke typed mid-promotion survives the merge.
    expect(useDraftEventStore.getState().getDraft(SERVER_ID)?.name).toBe("Se");
    expect(g.__lastDraftName).toBe("Se");
  });
});

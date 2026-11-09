/**
 * #4334 R3-1 — the LAST hop: the URL the opener actually hands to the OS / the
 * browser carries the picked Google place id.
 *
 * Earlier #4334 tests stopped at `selectVenueMapsTarget` (the target carried the
 * id) while `openMapsTarget` rebuilt the URL from `geo` + `label` only, so the
 * link people tapped had no `query_place_id`. Here only `Linking.openURL` /
 * `canOpenURL` and `Platform.OS` are fakes; the real opener, the real gate
 * (`selectVenueMapsTarget`), the real builders and the real chooser hook
 * (`useVenueMapsActions`) run.
 *
 *   L-1 web, nothing asked: the opened URL is `query=<lat>,<lng>&query_place_id=<id>`
 *   L-2 web chooser: the hook's Google row carries the id, and choosing Google
 *       opens that URL; choosing Apple opens Apple's link (no Google id)
 *   L-3 iOS chooser, Google chosen: the opened https link carries the id
 *   L-4 Android, nothing asked: the `geo:` intent is unchanged (spec: Android
 *       unchanged); its https fallback carries the id
 *   L-5 hidden address: nothing opens, and no URL anywhere holds the id
 *   L-6 a pre-#4334 row (no id): byte-identical to the old coordinate link
 *
 * FAILS-ON-REVERT: drop `googlePlaceId` from either builder call in
 * `src/utils/openMapsTarget.ts` (L-1/L-3/L-4) or from the `listMapsAppChoices`
 * call in `packages/offering-rendering/VenueMapsActions.tsx` (L-2).
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockOpenURL = jest.fn((_url: string) => Promise.resolve(true));
const mockCanOpenURL = jest.fn((_url: string) => Promise.resolve(true));
const mockPlatform = { OS: "web" as string };

jest.mock("react-native", () => ({
  Linking: {
    openURL: (url: string) => mockOpenURL(url),
    canOpenURL: (url: string) => mockCanOpenURL(url),
  },
  Platform: mockPlatform,
  AccessibilityInfo: { announceForAccessibility: () => undefined },
  Modal: "Modal",
  Pressable: "Pressable",
  StyleSheet: { create: (s: unknown) => s },
  Text: "Text",
  View: "View",
}));
jest.mock("../../../../packages/offering-rendering/LucideIcons", () => ({
  Check: "Check",
  Copy: "Copy",
  MapPin: "MapPin",
}));
jest.mock("@mingla/offering-rendering", () =>
  jest.requireActual("../../../../packages/offering-rendering/mapsDeepLink"),
);

/* eslint-disable import/first */
import React from "react";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (el: React.ReactElement) => unknown;
  act: (fn: () => void) => void;
};
const act = TestRenderer.act;
import { openMapsTarget } from "../openMapsTarget";
import {
  selectVenueMapsTarget,
  type MapsOpenTarget,
} from "../../../../packages/offering-rendering/mapsDeepLink";
import {
  useVenueMapsActions,
  type VenueMapsActionsState,
} from "../../../../packages/offering-rendering/VenueMapsActions";
/* eslint-enable import/first */

const ID = "ChIJS9Q72lL0OxARKJ3cGrQfM0c";
const PIN = { lat: 6.4478093, lng: 3.4723495 };

const target = (patch: Partial<Parameters<typeof selectVenueMapsTarget>[0]> = {}) =>
  selectVenueMapsTarget({
    venueName: "Didi Museum",
    address: "175 Akin Adesola St",
    addressHidden: false,
    locationGeo: PIN,
    googlePlaceId: ID,
    ...patch,
  });

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const opened = (): string[] => mockOpenURL.mock.calls.map((c) => String(c[0]));

let state: VenueMapsActionsState | null = null;
function Probe(props: { target: MapsOpenTarget | null; platform: string }) {
  state = useVenueMapsActions({
    target: props.target,
    platform: props.platform as "ios" | "android" | "web",
    onOpenMaps: (t, app) => openMapsTarget(t, { app }),
  });
  return null;
}
const mount = (t: MapsOpenTarget | null, platform: string) => {
  mockPlatform.OS = platform;
  act(() => {
    TestRenderer.create(<Probe target={t} platform={platform} />);
  });
  if (state === null) throw new Error("hook did not run");
  return state;
};

beforeEach(() => {
  mockOpenURL.mockClear();
  mockCanOpenURL.mockClear();
  state = null;
  mockPlatform.OS = "web";
});

describe("#4334 R3-1 — the URL actually opened carries query_place_id", () => {
  test("L-1 web, nothing asked: the opened link is the coordinate plus the place id", async () => {
    openMapsTarget(target());
    await flush();
    expect(opened()).toEqual([
      `https://www.google.com/maps/search/?api=1&query=6.4478093,3.4723495&query_place_id=${ID}`,
    ]);
  });

  test("L-2 web chooser: the Google row carries the id and choosing it opens that link", async () => {
    const actions = mount(target(), "web");
    expect(actions.choices.map((c) => c.id)).toEqual(["google", "apple"]);
    expect(actions.choices[0].url).toContain(`&query_place_id=${ID}`);
    act(() => actions.chooseApp("google"));
    await flush();
    expect(opened()[0]).toContain(`query=6.4478093,3.4723495&query_place_id=${ID}`);
    mockOpenURL.mockClear();
    act(() => actions.chooseApp("apple"));
    await flush();
    expect(opened()[0]).toMatch(/^https:\/\/maps\.apple\.com\/\?ll=6\.4478093,3\.4723495/);
    expect(opened()[0]).not.toContain(ID);
  });

  test("L-3 iOS, Google chosen: the opened https link carries the id", async () => {
    const actions = mount(target(), "ios");
    expect(actions.choices.map((c) => c.id)).toEqual(["apple", "google"]);
    act(() => actions.chooseApp("google"));
    await flush();
    expect(opened()[0]).toBe(
      `https://www.google.com/maps/search/?api=1&query=6.4478093,3.4723495&query_place_id=${ID}`,
    );
  });

  test("L-4 Android, nothing asked: the geo: intent is unchanged and its fallback carries the id", async () => {
    mockPlatform.OS = "android";
    mockOpenURL.mockImplementationOnce(() => Promise.reject(new Error("no maps app")));
    openMapsTarget(target());
    await flush();
    await flush();
    expect(opened()[0]).toBe("geo:6.4478093,3.4723495?q=6.4478093,3.4723495(Didi%20Museum%2C%20175%20Akin%20Adesola%20St)");
    expect(opened()[1]).toContain(`query_place_id=${ID}`);
  });

  test("L-5 hidden address: nothing opens and no link holds the id", async () => {
    const hidden = target({ addressHidden: true });
    expect(hidden).toBeNull();
    const onUnavailable = jest.fn();
    openMapsTarget(hidden, { onUnavailable });
    await flush();
    expect(mockOpenURL).not.toHaveBeenCalled();
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    const actions = mount(hidden, "web");
    expect(actions.choices).toEqual([]);
    act(() => actions.requestOpenMaps());
    await flush();
    expect(mockOpenURL).not.toHaveBeenCalled();
  });

  test("L-6 a row with no Google id opens the old coordinate link byte for byte", async () => {
    openMapsTarget(target({ googlePlaceId: null }));
    await flush();
    expect(opened()).toEqual(["https://www.google.com/maps/search/?api=1&query=6.4478093,3.4723495"]);
  });
});

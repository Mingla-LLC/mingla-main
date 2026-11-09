/**
 * #4334 — the shared address field on Google (matrix R-SRCH-4, R-SRCH-5,
 * R-SRCH-6, R-RETIRE-1, attribution D5), driven through the REAL shared field
 * with an injected invoke (no network).
 *
 * Invariant I-4334-PROVIDER-ERRORS-ARE-LOUD (client half): a search outage is
 * the "unavailable" row with retry, never "No matches".
 *
 * Fails-on-revert:
 *   F-1 `if (!result.ok)` branch deleted (outage treated as rows)     → red
 *   F-2 handleRetry no longer re-runs the query                        → red
 *   F-3 the Google Maps logo Image removed or swapped for text          → red
 *   F-3 the logo row moved back below the suggestions (N-2)             → red
 *   F-4 `code === "provider_id_retired"` → onClear() deleted           → red
 *   F-5 limit / types / country sent in the suggest body               → red
 *   F-6 errorCodeFromInvokeError returning message instead of body code→ red
 *   F-7 Host wrapper stops forwarding onSearchUnavailable              → red
 *   F-8 the logo row's height no longer reserved through computeDropdownMaxHeight → red
 */
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

import { StyleSheet } from "react-native";
import {
  AddressInput as SharedField,
  computeDropdownMaxHeight,
  GOOGLE_MAPS_ATTRIBUTION_ROW_HEIGHT,
  GOOGLE_MAPS_LOGO,
} from "../../../../../packages/location-input/src/AddressInput";
import {
  autocompleteAddress,
  createThrottledReporter,
  errorCodeFromInvokeError,
  type InvokeFn,
  type PlaceDetails,
} from "../../../../../packages/location-input/src/placesService";
import type { LocationInputTokens } from "../../../../../packages/location-input/src/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type HostNode = { type: unknown; props: Record<string, unknown>; children?: unknown[] };
type Tree = {
  root: { findAll: (p: (n: HostNode) => boolean) => HostNode[] };
  unmount: () => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (el: React.ReactElement) => Tree;
  act: (cb: () => Promise<void> | void) => Promise<void>;
};

const tokens: LocationInputTokens = {
  field: { bg: "#111", bgFocused: "#111", border: "#333", borderFocused: "#eb7825", borderError: "#f00", radius: 12, hasBorder: true, paddingHorizontal: 12, paddingVertical: 8, focusBorderWidth: 1 },
  text: { input: "#fff", placeholder: "#999" },
  icon: { leading: "#aaa", clear: "#aaa" },
  spinner: "#eb7825",
  dropdown: { mode: "card", bg: "#111", border: "#333", radius: 12, maxHeight: 300, hasShadow: false },
  row: { pressBg: "#222", textPrimary: "#fff", textSecondary: "#aaa", divider: "#333", style: "flat", primaryFontSize: 16, primaryLineHeight: 20, primaryWeight: "400", secondaryFontSize: 12, secondaryLineHeight: 16, paddingVertical: 10, paddingHorizontal: 12 },
  status: { text: "#aaa", fontSize: 12, lineHeight: 16 },
  error: { text: "#f00", fontSize: 12, lineHeight: 16 },
  attribution: { variant: "dark" },
};
const copy = {
  minLengthHint: "Type more",
  searching: "Searching",
  noResults: "No matches",
  unavailable: "Address search isn't working right now. Tap to try again.",
  pickError: "Pick failed",
};
const Icon = (): null => null;

/** A supabase-js FunctionsHttpError look-alike: the code is in the body. */
const httpError = (code: string) => ({
  message: "Edge Function returned a non-2xx status code",
  context: new Response(JSON.stringify({ error: code }), { status: 502 }),
});

async function mount(invoke: InvokeFn, extra: Record<string, unknown> = {}) {
  const onPick = jest.fn<(d: PlaceDetails, label?: string) => void>();
  const onClear = jest.fn();
  const onSearchUnavailable = jest.fn<(code: string) => void>();
  let tree!: Tree;
  await TestRenderer.act(() => {
    tree = TestRenderer.create(
      <SharedField
        value=""
        onChangeText={() => undefined}
        onPick={onPick}
        onClear={onClear}
        tokens={tokens}
        IconComponent={Icon}
        invoke={invoke}
        copy={copy}
        onSearchUnavailable={onSearchUnavailable}
        {...extra}
      />,
    );
  });
  const type = async (text: string) => {
    const input = tree.root.findAll((n) => n.props.accessibilityRole === "combobox")[0];
    await TestRenderer.act(async () => {
      (input.props.onChangeText as (v: string) => void)(text);
      jest.advanceTimersByTime(300);
      for (let i = 0; i < 6; i += 1) await Promise.resolve();
    });
  };
  const texts = () =>
    tree.root.findAll((n) => typeof n.props.children === "string").map((n) => n.props.children as string);
  return { tree, onPick, onClear, onSearchUnavailable, type, texts };
}

describe("#4334 — loud search failures (R-SRCH-5)", () => {
  test("F-1/F-6 an outage shows the unavailable row (not 'No matches'), reports the proxy code, and closes with the attribution", async () => {
    jest.useFakeTimers();
    const invoke: InvokeFn = async () => ({ data: null, error: httpError("provider_quota") });
    const f = await mount(invoke);
    await f.type("Didi Museum");
    expect(f.texts()).toContain(copy.unavailable);
    expect(f.texts()).not.toContain(copy.noResults);
    expect(f.onSearchUnavailable).toHaveBeenCalledWith("provider_quota");
    expect(f.tree.root.findAll((n) => n.props.testID === "powered-by-google").length).toBeGreaterThan(0);
    jest.useRealTimers();
  });

  test("an honest empty answer is 'No matches' and is never reported", async () => {
    jest.useFakeTimers();
    const f = await mount(async () => ({ data: { suggestions: [] }, error: null }));
    await f.type("zzzzzz");
    expect(f.texts()).toContain(copy.noResults);
    expect(f.onSearchUnavailable).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  test("F-2 tapping the unavailable row re-runs the same query", async () => {
    jest.useFakeTimers();
    const queries: string[] = [];
    let fail = true;
    const invoke: InvokeFn = async (_fn, o) => {
      queries.push(String(o.body.query));
      return fail
        ? { data: null, error: httpError("provider_unavailable") }
        : { data: { suggestions: [{ placeId: "ChIJdidi000001", displayName: "Didi Museum", fullAddress: "Lagos", provider: "google" }] }, error: null };
    };
    const f = await mount(invoke);
    await f.type("Didi Museum");
    fail = false;
    const retry = f.tree.root.findAll((n) => n.props.accessibilityLabel === copy.unavailable && typeof n.props.onPress === "function")[0];
    await TestRenderer.act(async () => {
      (retry.props.onPress as () => void)();
      jest.advanceTimersByTime(300);
      for (let i = 0; i < 6; i += 1) await Promise.resolve();
    });
    expect(queries).toEqual(["Didi Museum", "Didi Museum"]);
    expect(f.texts()).toContain("Didi Museum");
    jest.useRealTimers();
  });
});

describe("#4334 — retired ids and attribution", () => {
  test("F-3 Google's own Maps logo sits beneath the field, before the rows (unmodified file, 98×18, clear space, labelled, not tappable)", async () => {
    jest.useFakeTimers();
    const f = await mount(async () => ({
      data: { suggestions: [{ placeId: "ChIJdidi000001", displayName: "Didi Museum", fullAddress: "Akin Adesola St, Lagos", provider: "google" }] },
      error: null,
    }));
    await f.type("Didi");
    const logos = f.tree.root.findAll((n) => n.props.testID === "google-maps-logo" && n.props.source !== undefined);
    expect(logos.length).toBeGreaterThan(0);
    const logo = logos[0];
    expect(logo.props.accessibilityLabel).toBe("Google Maps");
    // the Host field sits on a dark sheet → the White (non-outlined) logo
    expect(logo.props.source).toBe(GOOGLE_MAPS_LOGO.dark);
    expect(logo.props.style).toEqual({ width: 98, height: 18 });
    expect(logo.props.resizeMode).toBe("contain");
    expect(logo.props.onPress).toBeUndefined();
    const row = f.tree.root.findAll((n) => n.props.testID === "powered-by-google" && n.props.style !== undefined)[0];
    const style = StyleSheet.flatten(row.props.style);
    expect(style).toMatchObject({ paddingTop: 10, paddingBottom: 5, paddingHorizontal: 10 });
    // #4334 retest N-2 — the logo sits directly beneath the field, BEFORE the
    // suggestions (in render order), so the keyboard can never cover it.
    const order = f.tree.root.findAll(() => true);
    const logoAt = order.findIndex((n) => n.props.testID === "google-maps-logo");
    const firstRowAt = order.findIndex(
      (n) => n.type === "Text" && JSON.stringify(n.props.children ?? "").includes("Didi Museum"),
    );
    expect(logoAt).toBeGreaterThanOrEqual(0);
    expect(firstRowAt).toBeGreaterThan(logoAt);
    jest.useRealTimers();
  });

  test("F-4 R-RETIRE-1: a retired id fails the pick loudly and clears the stale selection", async () => {
    jest.useFakeTimers();
    const invoke: InvokeFn = async (_fn, o) =>
      o.body.action === "suggest"
        ? { data: { suggestions: [{ placeId: "dXJuOm1ieHBvaTpkaWRp", displayName: "Didi Museum", fullAddress: "Lagos" }] }, error: null }
        : { data: null, error: { message: "x", context: new Response(JSON.stringify({ error: "provider_id_retired" }), { status: 410 }) } };
    const f = await mount(invoke);
    await f.type("Didi");
    const row = f.tree.root.findAll((n) => n.props.accessibilityRole === "button" && String(n.props.accessibilityLabel ?? "").includes("Didi Museum"))[0];
    await TestRenderer.act(async () => {
      await (row.props.onPress as () => Promise<void>)();
      for (let i = 0; i < 6; i += 1) await Promise.resolve();
    });
    expect(f.onPick).not.toHaveBeenCalled();
    expect(f.onClear).toHaveBeenCalledTimes(1);
    expect(f.onSearchUnavailable).toHaveBeenCalledWith("provider_id_retired");
    expect(f.texts()).toContain(copy.pickError);
    jest.useRealTimers();
  });
});

describe("#4334 — the request (R-SRCH-4, R-SRCH-6)", () => {
  test("F-5 Host suggest sends no limit, no types and no country — only query, session, optional proximity", async () => {
    const bodies: Record<string, unknown>[] = [];
    const invoke: InvokeFn = async (fn, o) => {
      expect(fn).toBe("mapbox-geocode");
      bodies.push(o.body);
      return { data: { suggestions: [] }, error: null };
    };
    await autocompleteAddress("Lagos, Nigeria", "session-4334", { invoke }, { proximity: "3.38,6.45" });
    expect(bodies[0]).toEqual({ action: "suggest", query: "Lagos, Nigeria", session_token: "session-4334", proximity: "3.38,6.45" });
  });

  test("the same session token is used for suggest and for the retrieve that ends it", async () => {
    jest.useFakeTimers();
    const tokensSeen: string[] = [];
    const invoke: InvokeFn = async (_fn, o) => {
      tokensSeen.push(String(o.body.session_token));
      return o.body.action === "suggest"
        ? { data: { suggestions: [{ placeId: "ChIJdidi000001", displayName: "Didi Museum", fullAddress: "Lagos" }] }, error: null }
        : { data: { details: { placeId: "ChIJdidi000001", formattedAddress: "Didi Museum, Lagos", city: "Lagos", region: "Lagos", regionCode: "LA", regionCodeFull: "NG-LA", countryCode: "NG", location: { lat: 6.43, lng: 3.42 }, featureType: "poi" } }, error: null };
    };
    const f = await mount(invoke);
    await f.type("Didi");
    const row = f.tree.root.findAll((n) => n.props.accessibilityRole === "button" && String(n.props.accessibilityLabel ?? "").includes("Didi Museum"))[0];
    await TestRenderer.act(async () => {
      await (row.props.onPress as () => Promise<void>)();
      for (let i = 0; i < 6; i += 1) await Promise.resolve();
    });
    expect(f.onPick).toHaveBeenCalledTimes(1);
    expect(tokensSeen.length).toBe(2);
    expect(tokensSeen[0]).toBe(tokensSeen[1]);
    expect(tokensSeen[0]).toMatch(/^[0-9a-f-]{36}$/);
    jest.useRealTimers();
  });

  test("error codes come from the response body; an unreadable body is 'network'", async () => {
    expect(await errorCodeFromInvokeError(httpError("provider_denied"))).toBe("provider_denied");
    expect(await errorCodeFromInvokeError({ message: "boom" })).toBe("network");
    expect(await errorCodeFromInvokeError({ message: "x", context: new Response("not json", { status: 500 }) })).toBe("network");
  });

  test("Sentry reporting is throttled: one event per code per minute", () => {
    let now = 0;
    const sent: string[] = [];
    const report = createThrottledReporter((c) => sent.push(c), 60_000, () => now);
    report("provider_quota");
    report("provider_quota");
    report("network");
    now = 61_000;
    report("provider_quota");
    expect(sent).toEqual(["provider_quota", "network", "provider_quota"]);
  });
});

describe("#4334 N-2 — the logo row's height is reserved inside the one pure cap", () => {
  test("F-8 reservedHeight comes off the #1027 cap, defaults to 0, keeps the #1027 floor", () => {
    const base = { keyboardScreenY: 600, cardTopY: 200, tokenMaxHeight: 320, isIOS: false };
    const plain = computeDropdownMaxHeight(base);
    expect(computeDropdownMaxHeight({ ...base, reservedHeight: 0 })).toBe(plain);
    expect(computeDropdownMaxHeight({ ...base, reservedHeight: GOOGLE_MAPS_ATTRIBUTION_ROW_HEIGHT })).toBe(
      plain - GOOGLE_MAPS_ATTRIBUTION_ROW_HEIGHT,
    );
    // keyboard hidden: the token minus the row
    expect(
      computeDropdownMaxHeight({ ...base, keyboardScreenY: Number.NaN, reservedHeight: 33 }),
    ).toBe(320 - 33);
    // keyboard up: a reservation larger than the space keeps the #1027 minimum (96);
    // keyboard hidden: it floors at 0
    expect(computeDropdownMaxHeight({ ...base, reservedHeight: 10_000 })).toBe(96);
    expect(computeDropdownMaxHeight({ ...base, keyboardScreenY: Number.NaN, reservedHeight: 10_000 })).toBe(0);
    expect(GOOGLE_MAPS_ATTRIBUTION_ROW_HEIGHT).toBe(33);
  });
});

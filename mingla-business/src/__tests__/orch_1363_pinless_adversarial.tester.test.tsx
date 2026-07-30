/**
 * Issue #1363 — tester-owned adversarial regression.
 *
 * Different angle from the implementor suites: malformed boundary responses,
 * provider/context mismatch guards, transport-vs-needs-context separation,
 * rendered keyboard/a11y selected-pill behavior, pinless/default-off isolation,
 * and a real delayed-retrieve race where X must invalidate the old completion.
 */

import React from "react";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, jest, test } from "@jest/globals";
import { MapboxAddressInput } from "../../../packages/location-input/src/MapboxAddressInput";
import {
  forwardHierarchyMapbox,
  type InvokeFn,
} from "../../../packages/location-input/src/mapboxGeocodeService";
import type { LocationInputTokens } from "../../../packages/location-input/src/types";
import { resolveFreeTextLocation } from "../utils/resolveApproxLocation";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type HostNode = { props: Record<string, unknown> };
type Tree = {
  root: { findAll: (p: (n: HostNode) => boolean) => HostNode[] };
  unmount: () => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (el: React.ReactElement) => Tree;
  act: (cb: () => Promise<void> | void) => Promise<void>;
};

const ROOT = path.resolve(__dirname, "../../..");
const edgeSource = fs.readFileSync(
  path.resolve(ROOT, "supabase/functions/mapbox-geocode/index.ts"),
  "utf8",
);
const sharedSource = fs.readFileSync(
  path.resolve(ROOT, "packages/location-input/src/MapboxAddressInput.tsx"),
  "utf8",
);

const tokens: LocationInputTokens = {
  field: {
    bg: "#111111",
    bgFocused: "#111111",
    border: "#333333",
    borderFocused: "#eb7825",
    borderError: "#ff0000",
    radius: 12,
    hasBorder: true,
    paddingHorizontal: 12,
    paddingVertical: 8,
    focusBorderWidth: 1,
  },
  text: { input: "#ffffff", placeholder: "#999999" },
  icon: { leading: "#aaaaaa", clear: "#aaaaaa" },
  spinner: "#eb7825",
  dropdown: {
    mode: "card",
    bg: "#111111",
    border: "#333333",
    radius: 12,
    maxHeight: 300,
    hasShadow: false,
  },
  row: {
    pressBg: "#222222",
    textPrimary: "#ffffff",
    textSecondary: "#aaaaaa",
    divider: "#333333",
    style: "flat",
    primaryFontSize: 16,
    primaryLineHeight: 20,
    primaryWeight: "400",
    secondaryFontSize: 12,
    secondaryLineHeight: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  status: { text: "#aaaaaa", fontSize: 12, lineHeight: 16 },
  error: { text: "#ff0000", fontSize: 12, lineHeight: 16 },
  action: { text: "#eb7825" },
};

const copy = {
  minLengthHint: "Type more",
  searching: "Searching",
  noResults: "No matches",
  offline: "Offline",
  pickError: "Pick failed",
};

const Icon = (): null => null;

function findOne(
  tree: Tree,
  predicate: (node: HostNode) => boolean,
): HostNode {
  const matches = tree.root.findAll(predicate);
  expect(matches.length).toBeGreaterThan(0);
  return matches[0];
}

describe("Issue #1363 tester adversarial — boundary honesty", () => {
  test("malformed hierarchy payloads are rejected while needs_context stays data and transport stays an error", async () => {
    const malformedInvoke: InvokeFn = async () => ({
      data: {
        details: {
          lat: "4.8156",
          lng: 7.0498,
          city: "Port Harcourt",
          region: "Rivers",
          countryCode: "NG",
        },
        matchLevel: "place",
        matchedQuery: "Port Harcourt",
      },
      error: null,
    });
    await expect(
      resolveFreeTextLocation("Port Harcourt, Nigeria", {}, {
        forwardHierarchy: (query, savedContext) =>
          forwardHierarchyMapbox(query, savedContext, {
            invoke: malformedInvoke,
          }),
      }),
    ).resolves.toEqual({ status: "needs_context" });

    const noMatchInvoke: InvokeFn = async () => ({
      data: { details: null, reason: "needs_context" },
      error: null,
    });
    await expect(
      forwardHierarchyMapbox("nonsense", {}, { invoke: noMatchInvoke }),
    ).resolves.toEqual({ details: null, reason: "needs_context" });

    const transportInvoke: InvokeFn = async () => ({
      data: null,
      error: { message: "provider unavailable" },
    });
    await expect(
      forwardHierarchyMapbox("Lagos, Nigeria", {}, { invoke: transportInvoke }),
    ).rejects.toThrow("provider unavailable");
  });

  test("ISO/locality acceptance is tied to structured context, never a matching street name", () => {
    expect(edgeSource).toContain(
      "countryCode !== requiredCountryIso.toUpperCase()",
    );
    expect(edgeSource).toContain(
      "adminNames.has(normalizeHierarchyName(candidate))",
    );
    expect(edgeSource).toContain(
      "featureAdministrativeNames(feature)",
    );
    expect(edgeSource).not.toContain(
      "feature.properties?.name.includes(candidate)",
    );
  });
});

describe("Issue #1363 tester adversarial — selected pill and isolation", () => {
  test("selected pill exposes keyboard/a11y action semantics and a 44-point X target", async () => {
    const onChangeSelected = jest.fn();
    let tree: Tree | undefined;
    await TestRenderer.act(() => {
      tree = TestRenderer.create(
        <MapboxAddressInput
          value="1 Fortune Avenue, Port Harcourt"
          onChangeText={() => undefined}
          onPick={() => undefined}
          onClear={() => undefined}
          tokens={tokens}
          IconComponent={Icon}
          invoke={async () => ({ data: null, error: null })}
          copy={copy}
          selectionState="selected"
          selectedLabel="1 Fortune Avenue, Port Harcourt"
          onChangeSelected={onChangeSelected}
        />,
      );
    });
    const change = findOne(
      tree as Tree,
      (node) => node.props.accessibilityLabel === "Change address",
    );
    expect(change.props.accessibilityRole).toBe("button");
    expect(change.props.accessibilityHint).toBe(
      "Returns to address search.",
    );
    expect(sharedSource).toContain("minWidth: 44");
    expect(sharedSource).toContain("minHeight: 44");
    await TestRenderer.act(() => {
      (change.props.onPress as () => void)();
    });
    expect(onChangeSelected).toHaveBeenCalledTimes(1);
    await TestRenderer.act(() => {
      (tree as Tree).unmount();
    });
  });

  test("final authoring tree is pinless and consumer mode remains default-off", () => {
    for (const removed of [
      "mingla-business/src/components/location/PinDropSheet.tsx",
      "mingla-business/src/utils/pinDropMapStyle.ts",
      "mingla-business/src/utils/staticMapPixelToLngLat.ts",
    ]) {
      expect(fs.existsSync(path.resolve(ROOT, removed))).toBe(false);
    }
    expect(sharedSource).not.toContain("onOpenPinDrop");
    expect(sharedSource).not.toContain("Drop a pin");
    expect(sharedSource).not.toContain("satellite");
    expect(sharedSource).toContain("allowFreeText = false");

    const consumerFiles = [
      "app-mobile/src/components/OnboardingFlow.tsx",
      "app-mobile/src/components/PreferencesSheet.tsx",
      "app-mobile/src/components/discover/CityPickerSheet.tsx",
      "app-mobile/src/components/location/MapboxAddressInput.tsx",
    ];
    for (const file of consumerFiles) {
      const source = fs.readFileSync(path.resolve(ROOT, file), "utf8");
      expect(source).not.toContain("allowFreeText");
      expect(source).not.toContain("selectionState");
      expect(source).not.toContain("onFreeText");
    }
  });
});

describe("Issue #1363 tester adversarial — stale completion", () => {
  test("X during suggestion retrieval invalidates the old completion even though the label is unchanged", async () => {
    jest.useFakeTimers();
    let finishRetrieve:
      | ((value: { data: unknown; error: null }) => void)
      | undefined;
    const invoke: InvokeFn = async (_fn, options) => {
      if (options.body.action === "suggest") {
        return {
          data: {
            suggestions: [
              {
                placeId: "mapbox.lagos",
                displayName: "Lagos",
                fullAddress: "Lagos, Nigeria",
              },
            ],
          },
          error: null,
        };
      }
      return new Promise((resolve) => {
        finishRetrieve = resolve;
      });
    };
    const onPick = jest.fn();
    const onChangeSelected = jest.fn();
    let tree: Tree | undefined;
    await TestRenderer.act(() => {
      tree = TestRenderer.create(
        <MapboxAddressInput
          value="Lagos"
          onChangeText={() => undefined}
          onPick={onPick}
          onClear={() => undefined}
          tokens={tokens}
          IconComponent={Icon}
          invoke={invoke}
          copy={copy}
          allowFreeText
          onFreeText={() => undefined}
          onChangeSelected={onChangeSelected}
        />,
      );
    });
    const input = findOne(
      tree as Tree,
      (node) => node.props.accessibilityRole === "combobox",
    );
    await TestRenderer.act(async () => {
      (input.props.onChangeText as (value: string) => void)("Lagos");
      jest.advanceTimersByTime(300);
      await Promise.resolve();
      await Promise.resolve();
    });
    const suggestion = findOne(
      tree as Tree,
      (node) => node.props.accessibilityLabel === "Lagos, Nigeria",
    );
    await TestRenderer.act(async () => {
      void (suggestion.props.onPress as () => Promise<void>)();
      await Promise.resolve();
    });
    const change = findOne(
      tree as Tree,
      (node) => node.props.accessibilityLabel === "Change address",
    );
    await TestRenderer.act(() => {
      (change.props.onPress as () => void)();
    });
    expect(onChangeSelected).toHaveBeenCalledTimes(1);

    await TestRenderer.act(async () => {
      finishRetrieve?.({
        data: {
          details: {
            placeId: "mapbox.lagos",
            formattedAddress: "Lagos, Nigeria",
            city: "Lagos",
            region: "Lagos",
            regionCode: null,
            regionCodeFull: null,
            countryCode: "NG",
            location: { lat: 6.455, lng: 3.384 },
          },
        },
        error: null,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    // Binding Amendment 2 SC-10: X invalidates the in-flight completion.
    expect(onPick).not.toHaveBeenCalled();
    await TestRenderer.act(() => {
      (tree as Tree).unmount();
    });
    jest.useRealTimers();
  });
});

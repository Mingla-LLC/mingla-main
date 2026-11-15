/**
 * #4420 Graphite Glass — `Material` is the one glass owner, and it chooses the
 * platform recipe (spec §2 "How the platform is chosen", §8 test plan):
 *
 *   Android                         → solid, alpha 1, NO BlurView
 *   Reduce Transparency (iOS/web)   → solid, NO BlurView (onPhoto → solid control)
 *   phone web (< 768)               → solid, NO BlurView
 *   desktop web with backdrop-filter→ glass fill + CSS backdrop-filter, NO BlurView
 *   iOS                             → BlurView, intensity 24, systemChromeMaterialDark
 *
 * FAILS ON REVERT: drop the Android branch (Android would draw a BlurView over a
 * translucent fill), drop the reduce-transparency branch, or stop routing web
 * through `shouldUseRealBlur` (phone web would paint a see-through panel).
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

let mockOS = "ios";
let mockReduce = false;
let mockWidth = 390;

jest.mock("react-native", () => {
  const RN = jest.requireActual("react-native") as Record<string, unknown>;
  return {
    ...RN,
    Platform: {
      get OS() {
        return mockOS;
      },
      select: (spec: Record<string, unknown>) => (spec[mockOS] !== undefined ? spec[mockOS] : spec.default),
    },
    useWindowDimensions: () => ({ width: mockWidth, height: 800, scale: 2, fontScale: 1 }),
    AccessibilityInfo: {
      isReduceTransparencyEnabled: () => Promise.resolve(mockReduce),
      addEventListener: () => ({ remove() {} }),
    },
  };
});
jest.mock("expo-blur", () => ({ BlurView: "BlurView" }));

import { StyleSheet } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { Material, resolveMaterial } from "../Material";
import { materials } from "../../../constants/designSystem";
import type { MaterialKind } from "../../../constants/designSystem";

const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => {
    root: {
      findAll: (predicate: (node: { type: unknown; props: Record<string, unknown> }) => boolean) => {
        type: unknown;
        props: Record<string, unknown>;
      }[];
    };
    unmount: () => void;
  };
  act: (callback: () => void | Promise<void>) => Promise<void> | void;
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KINDS = Object.keys(materials) as MaterialKind[];

const OPAQUE_HEX = /^#[0-9a-f]{6}$/i;

type Rendered = ReturnType<typeof TestRenderer.create>;

const mount = async (kind: MaterialKind): Promise<Rendered> => {
  let renderer!: Rendered;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(<Material kind={kind} radius={24} testID="mat" />);
    // let the AccessibilityInfo promise settle
    await Promise.resolve();
  });
  return renderer;
};

const blurViews = (renderer: Rendered) => renderer.root.findAll((node) => node.type === "BlurView");
const surfaceStyle = (renderer: Rendered): Record<string, unknown> => {
  // The host View carrying the testID (not the <Material> element itself).
  const [surface] = renderer.root.findAll((node) => node.type === "View" && node.props.testID === "mat");
  return StyleSheet.flatten(surface.props.style as StyleProp<ViewStyle>) as Record<string, unknown>;
};

afterEach(() => {
  mockOS = "ios";
  mockReduce = false;
  mockWidth = 390;
});

describe("#4420 Material — the platform recipe", () => {
  test("every solid fill is opaque (alpha 1), except onPhoto's deliberate .84", () => {
    for (const kind of KINDS) {
      if (kind === "onPhoto") {
        expect(materials.onPhoto.solidFill).toBe("rgba(24, 24, 27, 0.84)");
        expect(materials.onPhoto.reducedFill).toMatch(OPAQUE_HEX);
        continue;
      }
      expect(materials[kind].solidFill).toMatch(OPAQUE_HEX);
      expect(materials[kind].reducedFill).toMatch(OPAQUE_HEX);
    }
  });

  test.each(KINDS)("Android draws %s solid with no BlurView", async (kind) => {
    mockOS = "android";
    const renderer = await mount(kind);
    expect(blurViews(renderer)).toHaveLength(0);
    expect(surfaceStyle(renderer).backgroundColor).toBe(materials[kind].solidFill);
    renderer.unmount();
  });

  test.each(KINDS)("iOS Reduce Transparency draws %s solid with no BlurView", async (kind) => {
    mockOS = "ios";
    mockReduce = true;
    const renderer = await mount(kind);
    expect(blurViews(renderer)).toHaveLength(0);
    expect(surfaceStyle(renderer).backgroundColor).toBe(materials[kind].reducedFill);
    expect(surfaceStyle(renderer).backgroundColor).toMatch(OPAQUE_HEX);
    renderer.unmount();
  });

  test("Reduce Transparency puts on-photo controls on the solid control fill", () => {
    expect(resolveMaterial("onPhoto", { platform: "ios", reduceTransparency: true, realBlur: false }).fill).toBe(
      materials.control.solidFill,
    );
  });

  test.each(KINDS)("phone web (390) draws %s solid with no BlurView", async (kind) => {
    mockOS = "web";
    mockWidth = 390;
    const renderer = await mount(kind);
    expect(blurViews(renderer)).toHaveLength(0);
    const style = surfaceStyle(renderer);
    expect(style.backgroundColor).toBe(materials[kind].solidFill);
    expect(style.backdropFilter).toBeUndefined();
    renderer.unmount();
  });

  test("desktop web with backdrop-filter uses the glass fill + CSS blur, never a BlurView", () => {
    const pane = resolveMaterial("pane", { platform: "web", reduceTransparency: false, realBlur: true });
    expect(pane).toEqual({
      mode: "webBlur",
      fill: materials.pane.glassFill,
      blur: null,
      backdropFilter: "blur(10px) saturate(20%)",
    });
    const sheet = resolveMaterial("sheet", { platform: "web", reduceTransparency: false, realBlur: true });
    expect(sheet.backdropFilter).toBe("blur(24px) saturate(20%)");
  });

  test("web without real blur falls back to solid", () => {
    const pane = resolveMaterial("pane", { platform: "web", reduceTransparency: false, realBlur: false });
    expect(pane.mode).toBe("solid");
    expect(pane.fill).toBe(materials.pane.solidFill);
  });

  test("iOS draws a BlurView at intensity 24 with the dark chrome material under the glass fill", async () => {
    mockOS = "ios";
    for (const kind of ["pane", "control", "chrome", "sheet"] as const) {
      const renderer = await mount(kind);
      const blurs = blurViews(renderer);
      expect(blurs).toHaveLength(1);
      expect(blurs[0].props.intensity).toBe(24);
      expect(blurs[0].props.tint).toBe("systemChromeMaterialDark");
      const overlay = renderer.root.findAll(
        (node) =>
          node.type === "View" &&
          (StyleSheet.flatten(node.props.style as StyleProp<ViewStyle>) as Record<string, unknown> | undefined)?.backgroundColor ===
            materials[kind].glassFill,
      );
      expect(overlay.length).toBeGreaterThanOrEqual(1);
      renderer.unmount();
    }
  });

  test("iOS liquid and onPhoto use their own intensities; selected has no blur", async () => {
    mockOS = "ios";
    const liquid = await mount("liquid");
    expect(blurViews(liquid)[0].props.intensity).toBe(34);
    liquid.unmount();
    const onPhoto = await mount("onPhoto");
    expect(blurViews(onPhoto)[0].props.intensity).toBe(43);
    onPhoto.unmount();
    const selected = await mount("selected");
    expect(blurViews(selected)).toHaveLength(0);
    selected.unmount();
  });

  test("Android keeps the same rim as iOS (the layer still shows)", async () => {
    mockOS = "android";
    const renderer = await mount("liquid");
    const rimTop = renderer.root.findAll(
      (node) =>
        node.type === "View" &&
        (StyleSheet.flatten(node.props.style as StyleProp<ViewStyle>) as Record<string, unknown> | undefined)?.backgroundColor ===
          materials.liquid.rim.top,
    );
    expect(rimTop.length).toBe(1);
    renderer.unmount();
  });
});

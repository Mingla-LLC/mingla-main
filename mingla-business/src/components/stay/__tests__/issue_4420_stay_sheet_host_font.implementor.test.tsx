// @ts-nocheck -- the test supplies a minimal host-component RN runtime.
// issue #4420 — in the Host Stay "Add reservation" sheet the Rooms / Places
// tabs and the price pills rendered in a serif fallback on web: the sheet
// handed the shared Stay booking parts the default GUEST theme, whose face
// (Inter) only themed guest pages load. The sheet now passes the Host chrome
// theme, whose face is the app's own ("System").
//
// WHAT THIS FILE PROVES (the REAL shared GlassTabs, rendered as web)
//   HF-1 with the Host chrome theme every tab label draws in "System".
//   HF-2 the Host chrome theme keeps the default guest colours.
//   HF-3 control: the default guest theme names a theme font, the face the
//        Host app never loads (why the serif appeared).
//
// FAILS-ON-REVERT: make stayHostChromeTheme return resolveTheme(null, null)
// and HF-1 goes red.
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("react-native", () => {
  const ReactLocal = require("react");
  const host = (name: string) =>
    ReactLocal.forwardRef((props: any, ref: any) =>
      ReactLocal.createElement(name, { ...props, ref }, props.children),
    );
  return {
    View: host("View"),
    Text: host("Text"),
    ScrollView: host("ScrollView"),
    Pressable: host("Pressable"),
    StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {}, absoluteFillObject: {}, hairlineWidth: 0.5 },
    Platform: { OS: "web", select: (options: any) => options.web ?? options.default },
  };
});
jest.mock("@mingla/offering-rendering/OfferingGlassContext", () => ({
  OfferingGlassBackdrop: () => null,
}));

import { createThemePalette, resolveTheme } from "@mingla/offering-rendering";
import { GlassTabs } from "@mingla/brand-rendering/GlassTabs";
import { stayHostChromeTheme } from "../stayHostChromeTheme";

const flatten = (style: any): Record<string, unknown> =>
  Array.isArray(style)
    ? style.reduce((acc, item) => ({ ...acc, ...flatten(item) }), {})
    : style && typeof style === "object" ? style : {};

const labelFonts = (theme: any): unknown[] => {
  let tree: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <GlassTabs
        items={[{ key: "room", label: "Rooms" }, { key: "place", label: "Places" }]}
        activeKey="room"
        onSelect={() => undefined}
        palette={createThemePalette(theme)}
        theme={theme}
        size="sm"
      />,
    );
  });
  return tree!.root
    .findAll((node) => node.type === "Text" && (node.props.children?.[0] === "Rooms" || node.props.children?.[0] === "Places"))
    .map((node) => flatten(node.props.style).fontFamily);
};

describe("#4420 the Host Stay sheet draws its pills in the app's face", () => {
  test("HF-1 every tab label uses System with the Host chrome theme", () => {
    const fonts = labelFonts(stayHostChromeTheme());
    expect(fonts).toHaveLength(2);
    expect(fonts.every((font) => font === "System")).toBe(true);
  });

  test("HF-2 the Host chrome theme keeps the default guest colours", () => {
    const host = stayHostChromeTheme();
    const guest = resolveTheme(null, null);
    expect(host.color).toBe(guest.color);
    expect(host.color2).toBe(guest.color2);
  });

  test("HF-3 the default guest theme names a theme font the Host app never loads", () => {
    const fonts = labelFonts(resolveTheme(null, null));
    expect(fonts.every((font) => typeof font === "string" && font !== "System")).toBe(true);
  });
});

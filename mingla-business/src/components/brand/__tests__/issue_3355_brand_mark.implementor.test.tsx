/**
 * #3355 bug 17 — the brand switcher showed only the first letter of each
 * brand, and the TopBar brand chip showed no logo, even when the brand had an
 * uploaded logo. Both now show the logo Brand Edit saves (`brand.photo`) and
 * fall back to the first letter (no photo, a video photo, or a failed load).
 */
import fs from "fs";
import path from "path";
import React from "react";

type Node = { type: unknown; props: Record<string, unknown> };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  act: (callback: () => void) => void;
  create: (node: React.ReactElement) => {
    root: { findAll: (predicate: (node: Node) => boolean) => Node[] };
    unmount: () => void;
  };
};

jest.mock("react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  const host = (name: string) => ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactModule.createElement(name, props, children);
  return {
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Text: host("text"),
    View: host("view"),
    Image: host("image"),
  };
});
jest.mock("../../../constants/designSystem", () => ({
  glass: { border: { profileBase: "grey" } },
  text: { primary: "white" },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { BrandMark, brandMarkPhotoUrl } = require("../BrandMark") as typeof import("../BrandMark");

function render(brand: { displayName: string; photo?: string; profilePhotoType?: "image" | "video" | "gif" }) {
  let r!: ReturnType<typeof TestRenderer.create>;
  TestRenderer.act(() => {
    r = TestRenderer.create(<BrandMark brand={brand} size={40} testID="mark" />);
  });
  return r;
}

describe("#3355 BrandMark", () => {
  test("a brand with an uploaded logo shows the logo", () => {
    const r = render({ displayName: "Coast Walks", photo: "https://cdn.test/logo.png", profilePhotoType: "image" });
    const images = r.root.findAll((n) => n.type === "image");
    expect(images).toHaveLength(1);
    expect(images[0].props.source).toEqual({ uri: "https://cdn.test/logo.png" });
    expect(r.root.findAll((n) => n.type === "text")).toHaveLength(0);
    r.unmount();
  });

  test("no logo: the first letter", () => {
    const r = render({ displayName: "coast walks" });
    expect(r.root.findAll((n) => n.type === "image")).toHaveLength(0);
    const text = r.root.findAll((n) => n.type === "text")[0];
    expect(text.props.children).toBe("C");
    r.unmount();
  });

  test("a video profile photo or a failed image load falls back to the first letter", () => {
    expect(brandMarkPhotoUrl({ displayName: "A", photo: "https://cdn.test/a.mp4", profilePhotoType: "video" })).toBeNull();
    expect(brandMarkPhotoUrl({ displayName: "A", photo: "   " })).toBeNull();
    const r = render({ displayName: "Bay", photo: "https://cdn.test/broken.png" });
    const image = r.root.findAll((n) => n.type === "image")[0];
    TestRenderer.act(() => (image.props.onError as () => void)());
    expect(r.root.findAll((n) => n.type === "image")).toHaveLength(0);
    expect(r.root.findAll((n) => n.type === "text")[0].props.children).toBe("B");
    r.unmount();
  });
});

describe("#3355 the switcher and the TopBar chip use the brand's logo", () => {
  const read = (rel: string): string =>
    fs.readFileSync(path.resolve(__dirname, rel), "utf8");

  test("the brand switcher renders BrandMark for each brand, not a letter-only avatar", () => {
    const sheet = read("../BrandSwitcherSheet.tsx");
    expect(sheet).toMatch(/<BrandMark\s+brand=\{brand\}/);
    expect(sheet).not.toMatch(/brand\.displayName\.charAt\(0\)/);
  });

  test("the TopBar brand chip renders the logo when the current brand has one", () => {
    // #4389 AB — the chip moved, unchanged, into the shared BrandChip.
    expect(read("../../ui/TopBar.tsx")).toContain("<BrandChip ");
    const chip = read("../../ui/BrandChip.tsx");
    expect(chip).toMatch(/brandMarkPhotoUrl\(currentBrand\) !== null \? \(\s*<BrandMark/);
  });
});

import React from "react";

// `react-dom/server` ships no bundled types here (@types/react-dom not a dep),
// so require it (matches the sibling web-shim require style) to keep ts-jest
// happy without adding a dev dependency outside the SPEC allowlist.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (el: React.ReactElement) => string;
};

/**
 * ORCH-1137 — the business-web lucide shim renders REAL lucide-react icons and
 * NEVER returns undefined for any name. Do not restore the `() => null`
 * null-stub: it blanks every web glyph (Ari + chrome) and crashes any web Ari
 * conversation that mounts an icon name outside the old 12-entry list.
 *
 * This suite `require`s the resolved web shim directly (the same module
 * metro.config.js aliases `lucide-react-native` to on web) and asserts the
 * fix contract from SPEC_ORCH-1137 §7 (T-1..T-5):
 *   - T-1: a used icon resolves to a render-capable component (NOT () => null,
 *          NOT undefined) whose render output is a real <svg> with the glyph path.
 *   - T-2: all 11 live in-app icon names resolve to real components.
 *   - T-3: an unknown icon name returns a real fallback component, never
 *          undefined, never a throw (kills the F-3 "type is invalid" crash).
 *   - T-4: the `then` key stays undefined (Promise/thenable guard).
 *   - T-5: default + __esModule interop is sane (default-import works).
 *
 * fails-on-revert: deleting the real-icon shim body and restoring the
 * `const IconStub = () => null` 12-entry map flips T-1 (Plus renders an SVG
 * path) and T-3 (unknown name) RED. Re-applying the real shim flips them GREEN.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const shim = require("../lucideReactNativeWebStub.js");

// The 11 lucide icon names imported across mingla-business/src (per the
// ORCH-1137 investigation live audit). All MUST resolve to real components.
const LIVE_ICON_NAMES = [
  "AlertTriangle",
  "ArrowUp",
  "Check",
  "CheckSquare",
  "Menu",
  "Pencil",
  "Play",
  "Plus",
  "Settings",
  "Square",
  "X",
] as const;

const isRenderable = (v: unknown): boolean =>
  typeof v === "function" || (typeof v === "object" && v !== null);

describe("ORCH-1137 · T-1 — a used icon resolves to a real rendering component", () => {
  it("shim.Plus is render-capable (NOT () => null, NOT undefined)", () => {
    expect(shim.Plus).toBeDefined();
    expect(isRenderable(shim.Plus)).toBe(true);
  });

  it("rendering shim.Plus yields a real <svg> with the Plus glyph paths", () => {
    const html = renderToStaticMarkup(
      React.createElement(shim.Plus, {
        size: 13,
        color: "#111111",
        strokeWidth: 2.25,
      }),
    );
    // Real lucide Plus SVG path signatures — present in lucide-react, ABSENT in
    // the old `() => null` null-stub (which rendered nothing).
    expect(html).toContain("<svg");
    expect(html).toContain("M5 12h14");
    expect(html).toContain("M12 5v14");
    // Props pass straight through (the Ari code passes size/color/strokeWidth).
    expect(html).toContain('width="13"');
    expect(html).toContain('stroke="#111111"');
    expect(html).toContain('stroke-width="2.25"');
  });
});

describe("ORCH-1137 · T-2 — all 11 live in-app icon names resolve to real components", () => {
  for (const name of LIVE_ICON_NAMES) {
    it(`shim.${name} is a real render-capable component`, () => {
      const icon = (shim as Record<string, unknown>)[name];
      expect(icon).toBeDefined();
      expect(isRenderable(icon)).toBe(true);
    });
  }

  it("every live name renders a real <svg> (none blank, none crash)", () => {
    for (const name of LIVE_ICON_NAMES) {
      const Icon = (shim as Record<string, unknown>)[name] as React.ElementType;
      const html = renderToStaticMarkup(
        React.createElement(Icon, { size: 18, color: "#000000", strokeWidth: 2 }),
      );
      expect(html).toContain("<svg");
    }
  });
});

describe("ORCH-1137 · T-3 — unknown icon name never returns undefined / never throws", () => {
  it("shim.ThisIconDoesNotExist1137 returns a real fallback component", () => {
    let icon: unknown;
    expect(() => {
      icon = (shim as Record<string, unknown>).ThisIconDoesNotExist1137;
    }).not.toThrow();
    expect(icon).toBeDefined();
    expect(icon).not.toBeUndefined();
    expect(isRenderable(icon)).toBe(true);
  });

  it("rendering the unknown-name fallback does not throw", () => {
    const Icon = (shim as Record<string, unknown>)
      .SomeFutureOnlyIconName as React.ElementType;
    expect(() => {
      renderToStaticMarkup(React.createElement(Icon, { size: 16 }));
    }).not.toThrow();
  });
});

describe("ORCH-1137 · T-4 — Promise/thenable guard", () => {
  it("shim.then is undefined (module is not mistaken for a thenable)", () => {
    expect(shim.then).toBeUndefined();
  });
});

describe("ORCH-1137 · T-5 — default + __esModule interop", () => {
  it("shim.default resolves (default-import works) and is render-routable", () => {
    expect(shim.default).toBeDefined();
    // default-import access of an icon flows through the same Proxy.
    expect(isRenderable(shim.default.Plus)).toBe(true);
  });

  it("__esModule is truthy and not coerced into a fake icon", () => {
    expect(shim.__esModule).toBe(true);
  });
});

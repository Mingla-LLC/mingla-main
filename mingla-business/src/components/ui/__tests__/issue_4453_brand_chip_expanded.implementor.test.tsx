/**
 * #4453 — the brand chip never told a screen reader on web whether its menu
 * was open: react-native-web reads `aria-expanded`, not `accessibilityState`,
 * so the rendered chip carried neither state nor "opens a menu".
 *
 * This renders the REAL BrandChip through react-native-web (the DOM the web
 * build emits) and reads the markup, then checks the props a phone gets.
 *
 * FAILS-ON-REVERT: hand the chip only `accessibilityState` again (as the
 * switcher did) and "the real switcher's chip..." fails: no aria-expanded
 * attribute at all in the markup.
 *
 *   cd mingla-business && npx jest --maxWorkers=2 \
 *     src/components/ui/__tests__/issue_4453_brand_chip_expanded.implementor.test.tsx
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */

import { describe, expect, jest, test } from "@jest/globals";
import React from "react";

jest.mock("react-native", () => jest.requireActual("react-native-web"));
jest.mock("../../../hooks/useCurrentBrand", () => ({ useCurrentBrand: () => null }));
jest.mock("../../../store/currentBrandStore", () => ({
  useCurrentBrandStore: (sel: (s: { currentBrandId: string | null; hasHydrated: boolean }) => unknown) =>
    sel({ currentBrandId: null, hasHydrated: true }),
}));
jest.mock("../../../hooks/useResponsiveLayout", () => ({ useResponsiveLayout: () => ({ isWideDesktop: true }) }));
jest.mock("../../../hooks/useWorkspaceBrand", () => ({
  useWorkspaceBrand: () => ({ brand: { id: "brand-gameland", displayName: "Gameland Lagos" }, pending: false }),
}));
jest.mock("../../brand/BrandSwitcherSheet", () => ({ WorkspaceBrandMenu: () => null }));
jest.mock("../../brand/BrandMark", () => ({ BrandMark: () => null }));
jest.mock("../Icon", () => ({ Icon: () => null }));

import { BrandChip } from "../BrandChip";
import { WorkspaceBrandSwitcher } from "../../brand/WorkspaceBrandSwitcher";
import type { Brand } from "../../../types/brand";

const ReactDOMServer = require("react-dom/server") as {
  renderToStaticMarkup: (el: React.ReactElement) => string;
};
const GAMELAND = { id: "brand-gameland", displayName: "Gameland Lagos" } as unknown as Brand;

const chipTag = (el: React.ReactElement): string =>
  /<button\b[^>]*>/.exec(ReactDOMServer.renderToStaticMarkup(el))?.[0] ?? "";
const menu = (expanded: boolean) =>
  ({ accessibilityState: { expanded }, "aria-expanded": expanded, "aria-haspopup": "menu" }) as const;

describe("#4453 the brand chip says whether its menu is open", () => {
  test("the real switcher's chip is a button that opens a menu, and starts closed", () => {
    const closed = chipTag(<WorkspaceBrandSwitcher brandId={GAMELAND.id} />);
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).toContain('aria-haspopup="menu"');
    expect(closed).toContain('aria-label="Brand: Gameland Lagos. Switch brand"');
    expect(closed).toContain('role="button"');
  });

  test("open and closed are in the markup", () => {
    const open = chipTag(<BrandChip brand={GAMELAND} menuState={menu(true)} />);
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain('aria-haspopup="menu"');
    expect(chipTag(<BrandChip brand={GAMELAND} menuState={menu(false)} />)).toContain('aria-expanded="false"');
  });

  test("a chip that is not a switcher's (it opens a sheet of its host's) claims neither", () => {
    const bare = chipTag(<BrandChip brand={GAMELAND} />);
    expect(bare).toContain('aria-label="Brand: Gameland Lagos. Switch brand"');
    expect(bare).not.toContain("aria-expanded");
    expect(bare).not.toContain("aria-haspopup");
  });

  test("a phone gets the same state through accessibilityState", () => {
    // The element the chip hands to the platform: both spellings ride along,
    // so native reads accessibilityState and web reads aria-expanded.
    const Chip = BrandChip as unknown as (p: Record<string, unknown>) => React.ReactElement<Record<string, unknown>>;
    const el = Chip({ brand: GAMELAND, menuState: menu(true) });
    expect(el.props.accessibilityRole).toBe("button");
    expect(el.props.accessibilityState).toEqual({ expanded: true });
    expect(el.props["aria-expanded"]).toBe(true);
  });
});

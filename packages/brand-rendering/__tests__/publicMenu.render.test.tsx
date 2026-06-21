// ORCH-1186-C [venue-menu] — public Menu tab render contract (append-only).
//
// fails-on-revert: reverting the MenuTab branch / the visibleTabs menu gate /
// the formatMenuPrice null-omit out of PublicBrandPage.tsx fails T-PUB-1/2 +
// T-INV-1 here. Verified by TRUE LINE-DELETION of the fix (not a comment-out) —
// see the implementation report's Regression Test section for the commit hash.
//
// Structural (source-as-text) test, mirroring the existing brand-page tests
// (orch_1155_brand_redesign.test.tsx): the package has no react-native / RTL
// overlay, so render assertions are made against the component source + types.
// The tester writes the SECOND, adversarial RTL/data-driven render test.

import fs from "fs";
import path from "path";

const brandPage = fs.readFileSync(
  path.join(__dirname, "..", "PublicBrandPage.tsx"),
  "utf8",
);
const types = fs.readFileSync(path.join(__dirname, "..", "types.ts"), "utf8");
const indexTs = fs.readFileSync(path.join(__dirname, "..", "index.ts"), "utf8");

// The MenuTab component block (for scoped display-only assertions).
const menuTabStart = brandPage.indexOf("const MenuTab");
const menuTabBlock =
  menuTabStart === -1
    ? ""
    : (() => {
        const rest = brandPage.slice(menuTabStart);
        const next = rest.slice(20).search(/\n(?:const|function) [A-Za-z]/);
        return next === -1 ? rest : rest.slice(0, next + 20);
      })();

describe("ORCH-1186-C public Menu tab", () => {
  test("T-PUB-1 — MenuTab renders stacked category sections with currency-formatted prices", () => {
    expect(menuTabBlock.length).toBeGreaterThan(0);
    // Renders a section per group + the group's items.
    expect(menuTabBlock).toContain("groups.map");
    expect(menuTabBlock).toContain("group.items.map");
    // Currency-formatted price via the package-local formatter.
    expect(menuTabBlock).toContain("formatMenuPrice(item.priceCents, item.currency)");
    // Section header is an a11y header; price uses primaryText (not accent).
    expect(menuTabBlock).toContain('accessibilityRole="header"');
  });

  test("T-PUB-1b — formatMenuPrice is package-local, Intl-based, never GBP-defaulted (SC-9)", () => {
    expect(brandPage).toContain("const formatMenuPrice");
    expect(brandPage).toContain("new Intl.NumberFormat(undefined,");
    // null price → null (the price column is omitted, never "£0").
    expect(brandPage).toMatch(/if \(priceCents === null\) return null;/);
    // The package must NOT import mingla-business currency utils (cross-package).
    expect(brandPage).not.toContain("utils/currency");
    // The catch fallback echoes the stored currency — never hardcodes GBP.
    expect(brandPage).not.toMatch(/formatMenuPrice[\s\S]{0,400}"GBP"/);
  });

  test("T-PUB-1c — null price omits the price column (no $0 / no 'price on request' on public page)", () => {
    // The price column only renders when price !== null.
    expect(menuTabBlock).toContain("price !== null ?");
    // No "Price on request" literal on the public page (that copy is builder-only).
    expect(menuTabBlock).not.toMatch(/price on request/i);
  });

  test("T-PUB-2 — Menu tab appears ONLY when there is >=1 available item, immediately after About", () => {
    // visibleTabs seeds About then pushes menu when there are items.
    expect(brandPage).toContain('const tabs: Tab[] = ["about"];');
    expect(brandPage).toContain('if (menuItemCount > 0) tabs.push("menu");');
    // menu push comes BEFORE the offering pushes (right after about).
    const menuPush = brandPage.indexOf('tabs.push("menu")');
    const upcomingPush = brandPage.indexOf('tabs.push("upcoming")');
    expect(menuPush).toBeGreaterThan(0);
    expect(upcomingPush).toBeGreaterThan(menuPush);
    // menuItemCount sums available items across groups.
    expect(brandPage).toContain("menu.reduce((sum, group) => sum + group.items.length, 0)");
  });

  test("T-INV-1 — the MenuTab block carries NO buyable control (display-only, SC-7)", () => {
    expect(menuTabBlock).not.toMatch(/add to order/i);
    expect(menuTabBlock).not.toMatch(/order now/i);
    expect(menuTabBlock).not.toMatch(/\bcheckout\b/i);
    expect(menuTabBlock).not.toMatch(/\bcart\b/i);
    expect(menuTabBlock).not.toMatch(/\bquantity\b/i);
    // public rows are static <View>, not Pressable (no dead tap).
    expect(menuTabBlock).not.toContain("Pressable");
    expect(menuTabBlock).not.toContain("onPress");
  });

  test("menu types + Tab union are wired", () => {
    expect(types).toContain("export interface PublicMenuGroup");
    expect(types).toContain("export interface PublicMenuItem");
    expect(types).toContain("menu?: PublicMenuGroup[];");
    expect(indexTs).toContain("PublicMenuGroup");
    expect(brandPage).toMatch(/\|\s*"menu"/);
    expect(brandPage).toContain('menu: "Menu"');
  });
});

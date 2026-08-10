// ORCH-1186-C [venue-menu] — public Menu tab render contract (append-only).
//
// fails-on-revert: reverting the MenuTab branch / the visibleTabs menu gate /
// the formatMenuPrice null-omit fails T-PUB-1/2 + T-INV-1 here. Verified by
// TRUE LINE-DELETION of the fix (not a comment-out) — see the implementation
// report's Regression Test section for the commit hash.
//
// META-ORCH-1255(R2) [TEST-MOD-APPROVED META-ORCH-1255] pin supersession: the
// MenuTab renderer + formatMenuPrice moved VERBATIM from PublicBrandPage.tsx
// to PublicMenuSections.tsx (ORCH-1083 web bundle budget — the shared venue
// page import was hoisting the whole brand page into the eager __common
// chunk). Every assertion is UNCHANGED; only the file each block is read from
// follows the move. The visibleTabs menu gate stays in PublicBrandPage.tsx.
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
// [TEST-MOD-APPROVED ORCH-1365] Public menus now belong to the exact public
// venue page. Preserve the display-only menu contract here and retarget the tab
// ownership assertions from PublicBrandPage to PublicVenueTabs.
// META-ORCH-1255(R2): the menu renderer's own module (moved verbatim).
const menuSections = fs.readFileSync(
  path.join(__dirname, "..", "PublicMenuSections.tsx"),
  "utf8",
);
const venueTabs = fs.readFileSync(
  path.join(__dirname, "..", "PublicVenueTabs.tsx"),
  "utf8",
);
const types = fs.readFileSync(path.join(__dirname, "..", "types.ts"), "utf8");
const indexTs = fs.readFileSync(path.join(__dirname, "..", "index.ts"), "utf8");

// [TEST-MOD-APPROVED #1789] #1767 Phase 1 — I-PROPOSED-1186-MENU-DISPLAY-ONLY is
// AMENDED, not deleted (SPEC #1788 P-62). The venue menu becomes an ordering
// surface, so T-INV-1's five buyable-control assertions are RE-POINTED from the
// public MenuTab block to the SET-A surfaces that stay display-only FOREVER —
// the builder sheets and the marketing venue-preview sales-demo skin. Deleting
// those five assertions instead of re-pointing them is forbidden: it would leave
// the marketing skin unguarded.
const repoRoot = path.join(__dirname, "..", "..", "..");
const readSetA = (rel: string): string =>
  fs.readFileSync(path.join(repoRoot, rel), "utf8");
const SET_A_FILES = [
  "mingla-business/src/components/venue/MenuItemSheet.tsx",
  "mingla-business/src/components/venue/MenuCategorySheet.tsx",
  "mingla-marketing/app/venue-preview/page.tsx",
  "mingla-marketing/app/venue-preview/VenuePreviewClient.tsx",
  "mingla-marketing/app/venue-preview/venueSkins.tsx",
];
// Comments are stripped exactly as the strict-grep gate strips them, so the
// prose contracts that NAME these tokens ("NO cart/checkout control here") never
// trip the assertion.
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

// The MenuTab component block (for scoped display-only assertions).
const menuTabStart = menuSections.indexOf("const MenuTab");
const menuTabBlock =
  menuTabStart === -1
    ? ""
    : (() => {
        const rest = menuSections.slice(menuTabStart);
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
    expect(menuTabBlock).toContain(
      "formatMenuPrice(item.priceCents, item.currency)",
    );
    // Section header is an a11y header; price uses primaryText (not accent).
    expect(menuTabBlock).toContain('accessibilityRole="header"');
  });

  test("T-PUB-1b — formatMenuPrice is package-local, Intl-based, never GBP-defaulted (SC-9)", () => {
    expect(menuSections).toContain("const formatMenuPrice");
    expect(menuSections).toContain("new Intl.NumberFormat(undefined,");
    // null price → null (the price column is omitted, never "£0").
    expect(menuSections).toMatch(/if \(priceCents === null\) return null;/);
    // The package must NOT import mingla-business currency utils (cross-package).
    expect(menuSections).not.toContain("utils/currency");
    expect(brandPage).not.toContain("utils/currency");
    // The catch fallback echoes the stored currency — never hardcodes GBP.
    expect(menuSections).not.toMatch(/formatMenuPrice[\s\S]{0,400}"GBP"/);
  });

  test("T-PUB-1c — null price omits the price column (no $0 / no 'price on request' on public page)", () => {
    // The price column only renders when price !== null.
    expect(menuTabBlock).toContain("price !== null ?");
    // No "Price on request" literal on the public page (that copy is builder-only).
    expect(menuTabBlock).not.toMatch(/price on request/i);
  });

  test("T-PUB-2 — Venue Menu appears only with items, between Overview and Reservations", () => {
    expect(venueTabs).toContain("const tabs: PublicVenueTab[] = hasMenu");
    expect(venueTabs).toContain('["overview", "menu", "reservations"]');
    expect(venueTabs).toContain('["overview", "reservations"]');
    const menuIndex = venueTabs.indexOf('"menu", "reservations"');
    expect(menuIndex).toBeGreaterThan(0);

    // Brand pages no longer aggregate venue-owned menus.
    expect(brandPage).not.toContain('tabs.push("menu")');
    expect(brandPage).not.toContain('activeTab === "menu"');
  });

  test("T-INV-1 — the SET-A surfaces carry NO buyable control (display-only FOREVER, #1789 re-point)", () => {
    // [TEST-MOD-APPROVED #1789] Re-pointed per SPEC #1788 P-62. Same five
    // assertions, aimed at the surfaces the amended invariant still protects.
    expect(SET_A_FILES.length).toBe(5);
    for (const rel of SET_A_FILES) {
      const src = stripComments(readSetA(rel));
      expect(src.length).toBeGreaterThan(0);
      expect(src).not.toMatch(/add to order/i);
      expect(src).not.toMatch(/order now/i);
      expect(src).not.toMatch(/\bcheckout\b/i);
      expect(src).not.toMatch(/\bcart\b/i);
      expect(src).not.toMatch(/\bquantity\b/i);
    }
    // public rows are static <View>, not Pressable (no dead tap). Unchanged —
    // #1789 ships no cart on the public menu (that is #1793).
    expect(menuTabBlock).not.toContain("Pressable");
    expect(menuTabBlock).not.toContain("onPress");
  });

  test("menu types + Tab union are wired", () => {
    expect(types).toContain("export interface PublicMenuGroup");
    expect(types).toContain("export interface PublicMenuItem");
    expect(types).toContain("menu?: PublicMenuGroup[];");
    expect(indexTs).toContain("PublicMenuGroup");
    expect(venueTabs).toContain("export type PublicVenueTab =");
    expect(venueTabs).toMatch(/\|\s*"menu"/);
    expect(venueTabs).toContain('menu: "Menu"');
    expect(indexTs).toContain("PublicVenueTabs");
  });
});

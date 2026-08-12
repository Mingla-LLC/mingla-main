// PublicMenuSections — ORCH-1186-C [venue-menu] DISPLAY-ONLY public menu pane.
//
// META-ORCH-1255(R2) [web bundle budget] — extracted VERBATIM from
// PublicBrandPage.tsx into its own module. The venue public page
// (/b/{brand}/v/{venue}) reuses the brand page's Menu composition as an
// in-page section (DESIGN §6.6). While the renderer lived inside
// PublicBrandPage.tsx, that WHOLE ~27 KB module was statically shared by the
// /b/{brand} route chunk AND the venue route chunk, so Metro hoisted it into
// the EAGER `__common` boot chunk — breaching the ORCH-1083 initial-bundle
// budget. As its own module, only THIS small renderer is shared; the brand
// page bulk stays in its route chunk. Consumers:
//   • PublicBrandPage.tsx (same package, Menu tab)
//   • mingla-business PublicVenuePage.tsx via the DEEP specifier
//     "@mingla/brand-rendering/PublicMenuSections" (NOT the barrel — the
//     barrel re-exports PublicBrandPage, which would drag the bulk back).
//
// Stacked category sections, each a surface.card panel; item rows are
// name-left / price-right; null price omits the price column (no "£0"). Rows
// are STATIC <View> (NOT Pressable) — there is no detail/buy/expand, so a
// tappable-looking dead row never ships. NO order/cart/checkout control
// anywhere (SC-7, strict-grep gate).

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type {
  offeringSurfaceStyles,
  ResolvedTheme,
  ThemePalette,
} from "@mingla/offering-rendering";

import type { PublicMenuGroup } from "./types";

type Surface = ReturnType<typeof offeringSurfaceStyles>;

// ORCH-1186-C SC-9: currency-aware price formatting. Prices are stored in the
// currency's MINOR unit (cents/pence), but zero-decimal currencies (JPY, KRW,
// XOF, …) store the MAJOR unit directly, per the Stripe minor-unit
// convention. Dividing unconditionally by 100 would render ¥1250 as "¥13", so
// the minor-unit factor is currency-aware (mirrors mingla-business
// ZERO_DECIMAL_CURRENCIES without importing it — cross-package boundary).
const MENU_ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX",
  "VND", "VUV", "XAF", "XOF", "XPF",
]);

const menuMinorFactor = (currency: string): number =>
  MENU_ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 1 : 100;

// Issue #1793 — EXPORTED (was file-local) so the #1767 Phase 4 ordering
// renderers under `venueOrdering/` render money in exactly the formatter this
// menu already uses. A second formatter is how a cart line comes to read
// "¥13" beside a menu row reading "¥1,250" — the very bug the zero-decimal
// factor above exists to prevent. The declaration is unchanged.
export const formatMenuPrice = (
  priceCents: number | null,
  currency: string,
): string | null => {
  if (priceCents === null) return null;
  const major = priceCents / menuMinorFactor(currency);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(major);
  } catch {
    return `${currency} ${major.toFixed(2)}`;
  }
};

// ORCH-1186-C — DISPLAY-ONLY public menu pane: stacked category sections, each a
// surface.card panel; item rows are name-left / price-right; null price omits the
// price column (no "£0"). Rows are STATIC <View> (NOT Pressable) — there is no
// detail/buy/expand, so a tappable-looking dead row never ships. NO order/cart/
// checkout control anywhere (SC-7, strict-grep gate).
const MenuTab: React.FC<{
  groups: PublicMenuGroup[];
  palette: ThemePalette;
  surface: Surface;
  theme: ResolvedTheme;
}> = ({ groups, palette, surface, theme }) => (
  <View style={styles.menuWrap}>
    {groups.map((group) => (
      <View key={group.menuId} style={styles.menuSection}>
        <Text
          accessibilityRole="header"
          style={[
            styles.menuSectionName,
            { fontFamily: theme.fontFamilyValue, color: palette.primaryText },
          ]}
        >
          {group.menuName}
        </Text>
        {group.menuDescription !== null ? (
          <Text style={[styles.menuSectionDesc, { color: palette.tertiaryText }]}>
            {group.menuDescription}
          </Text>
        ) : null}
        <View style={[styles.menuCard, surface.card]}>
          {group.items.map((item, index) => {
            const price = formatMenuPrice(item.priceCents, item.currency);
            return (
              <View
                key={item.id}
                accessibilityLabel={
                  price !== null
                    ? `${item.name}. ${item.description ?? ""} ${price}.`
                    : `${item.name}. ${item.description ?? ""}`
                }
                style={[
                  styles.menuItemRow,
                  index > 0 && {
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: palette.panelBorder,
                  },
                ]}
              >
                <View style={styles.menuItemLeft}>
                  <Text
                    style={[styles.menuItemName, { color: palette.primaryText }]}
                  >
                    {item.name}
                  </Text>
                  {item.description !== null ? (
                    <Text
                      numberOfLines={3}
                      style={[
                        styles.menuItemDesc,
                        { color: palette.tertiaryText },
                      ]}
                    >
                      {item.description}
                    </Text>
                  ) : null}
                </View>
                {price !== null ? (
                  <View style={styles.menuItemPriceCol}>
                    <Text
                      style={[
                        styles.menuItemPrice,
                        { color: palette.primaryText },
                      ]}
                    >
                      {price}
                    </Text>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      </View>
    ))}
  </View>
);

const styles = StyleSheet.create({
  // ---- menu (ORCH-1186-C, DISPLAY-ONLY) ----
  menuWrap: {
    gap: 24,
  },
  menuSection: {
    gap: 8,
  },
  menuSectionName: {
    fontSize: 17,
    lineHeight: 21,
    fontWeight: "800",
  },
  menuSectionDesc: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 2,
  },
  menuCard: {
    borderRadius: 16,
    overflow: "hidden",
    padding: 14,
  },
  menuItemRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 10,
  },
  menuItemLeft: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  menuItemName: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "700",
  },
  menuItemDesc: {
    fontSize: 14,
    lineHeight: 19,
  },
  menuItemPriceCol: {
    alignItems: "flex-end",
  },
  menuItemPrice: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "800",
  },
});

// META-ORCH-1255(C) — the venue public page (/b/{brand}/v/{venue}) reuses the
// brand page's Menu composition VERBATIM as an in-page section (DESIGN §6.6:
// currency-aware incl. zero-decimal currencies; one owner for the menu render).
export { MenuTab as PublicMenuSections };

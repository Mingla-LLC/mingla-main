// ===========================================================================
// Issue #1793 — the ORDERABLE menu.
//
// SET-B (SPEC #1788 P-61): this file may carry a basket, a quantity stepper and
// an "Add to order" button. It may never import a provider SDK, name a payment
// sheet, or compute a fee. It renders two kinds of number and no others:
//   * MENU FACTS — an item's own price, an option's own ± delta — formatted by
//     `formatMenuPrice`, the SAME formatter the display-only menu uses, so a
//     zero-decimal currency can never read one way in the list and another in
//     the basket;
//   * COUNTS — how many of a line are in the basket.
// It multiplies nothing. Every total the guest ever sees was computed by
// `venue-order-create` (P-20).
//
// WHY THIS IS A SECOND RENDERER AND NOT A FLAG ON `PublicMenuSections`.
// The display-only pane is a list of static <View> rows with no press target at
// all — deliberately, and pinned by
// `packages/brand-rendering/__tests__/publicMenu.render.test.tsx`, which asserts
// the `MenuTab` block contains no `Pressable` and no `onPress`. That pin is the
// live guarantee that a venue with ordering OFF (which is every venue by
// default, P-16) never grows a tappable-looking dead row. So ordering gets its
// own renderer, exactly where SPEC P-61 SET-B says ordering renderers live, and
// the Menu tab mounts one or the other. Nothing is forked: the two share the
// formatter and the data shape.
//
// NO NESTED PRESSABLES. A row's tap target and its stepper are SIBLINGS, never
// parent and child — nesting them flattens the accessibility subtree and a
// screen reader loses the inner control entirely.
// ===========================================================================

// The package-local React bridge (see PublicVenueTabs.tsx): files under
// packages/ cannot discover the app's React peer, so importing "react"
// directly here would emit unresolved-peer diagnostics in both apps'
// isolated typecheck sandboxes. One bridge, reused by every shared renderer.
import { BrandRenderingReact as React } from "../PublicVenueTabs";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type {
  offeringSurfaceStyles,
  ResolvedTheme,
  ThemePalette,
} from "@mingla/offering-rendering";

import { formatMenuPrice } from "../PublicMenuSections";
import type { PublicMenuItem } from "../types";
import type {
  VenueOrderCartLine,
  VenueOrderModifierGroup,
} from "./venueOrderingTypes";
import {
  type VenueOrderingMenuGroupView,
  venueOrderCartLineKey,
  venueOrderingItemOrderable,
  venueOrderingModifierFailure,
  venueOrderingModifierMessage,
} from "./venueOrderingRules";

type Surface = ReturnType<typeof offeringSurfaceStyles>;

export interface VenueOrderingMenuListProps {
  groups: VenueOrderingMenuGroupView[];
  modifiersByItemId: Record<string, VenueOrderModifierGroup[] | undefined>;
  cart: VenueOrderCartLine[];
  palette: ThemePalette;
  surface: Surface;
  theme: ResolvedTheme;
  /** The item whose options panel is open, if any. One at a time, by design. */
  openItemId: string | null;
  onToggleItem: (itemId: string | null) => void;
  onAdd: (line: {
    menuItemId: string;
    itemName: string;
    modifierIds: string[];
    modifierNames: string[];
    notes: string | null;
  }) => void;
  onSetQuantity: (key: string, quantity: number) => void;
}

/** "Available 07:00–11:00" — why an item a guest can read cannot be ordered. */
const windowLine = (group: VenueOrderingMenuGroupView): string | null => {
  if (group.orderable) return null;
  if (group.window.start === null || group.window.end === null) return null;
  const trim = (value: string): string => value.slice(0, 5);
  return `Orderable ${trim(group.window.start)}–${trim(group.window.end)}`;
};

export const VenueOrderingMenuList: React.FC<VenueOrderingMenuListProps> = ({
  groups,
  modifiersByItemId,
  cart,
  palette,
  surface,
  theme,
  openItemId,
  onToggleItem,
  onAdd,
  onSetQuantity,
}) => (
  <View style={styles.wrap}>
    {groups.map((group) => {
      const closed = windowLine(group);
      return (
        <View key={group.menuId} style={styles.section}>
          <Text
            accessibilityRole="header"
            style={[
              styles.sectionName,
              { fontFamily: theme.fontFamilyValue, color: palette.primaryText },
            ]}
          >
            {group.menuName}
          </Text>
          {group.menuDescription !== null ? (
            <Text style={[styles.sectionDesc, { color: palette.tertiaryText }]}>
              {group.menuDescription}
            </Text>
          ) : null}
          {closed === null ? null : (
            <Text style={[styles.sectionDesc, { color: palette.tertiaryText }]}>
              {closed}
            </Text>
          )}
          <View style={[styles.card, surface.card]}>
            {group.items.map((item, index) => (
              <VenueOrderingMenuRow
                key={item.id}
                item={item}
                first={index === 0}
                groupOrderable={group.orderable}
                optionGroups={modifiersByItemId[item.id] ?? []}
                cart={cart}
                palette={palette}
                open={openItemId === item.id}
                onToggleItem={onToggleItem}
                onAdd={onAdd}
                onSetQuantity={onSetQuantity}
              />
            ))}
          </View>
        </View>
      );
    })}
  </View>
);

const VenueOrderingMenuRow: React.FC<{
  item: PublicMenuItem;
  first: boolean;
  groupOrderable: boolean;
  optionGroups: VenueOrderModifierGroup[];
  cart: VenueOrderCartLine[];
  palette: ThemePalette;
  open: boolean;
  onToggleItem: (itemId: string | null) => void;
  onAdd: VenueOrderingMenuListProps["onAdd"];
  onSetQuantity: (key: string, quantity: number) => void;
}> = ({
  item,
  first,
  groupOrderable,
  optionGroups,
  cart,
  palette,
  open,
  onToggleItem,
  onAdd,
  onSetQuantity,
}) => {
  const price = formatMenuPrice(item.priceCents, item.currency);
  const orderable = venueOrderingItemOrderable(item, groupOrderable);
  const needsChoice = optionGroups.length > 0;
  // The PLAIN line — this item with no options and no note. It is the only line
  // a stepper on the list can safely address; anything with options is edited
  // where its options are visible.
  const plainKey = venueOrderCartLineKey({
    menuItemId: item.id,
    modifierIds: [],
    notes: null,
  });
  const plain = cart.find((line) => line.key === plainKey) ?? null;

  return (
    <View
      style={[
        styles.row,
        !first && {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: palette.panelBorder,
        },
      ]}
    >
      <View style={styles.rowTop}>
        <View style={styles.rowLeft}>
          <Text style={[styles.itemName, { color: palette.primaryText }]}>
            {item.name}
          </Text>
          {item.description !== null ? (
            <Text
              numberOfLines={3}
              style={[styles.itemDesc, { color: palette.tertiaryText }]}
            >
              {item.description}
            </Text>
          ) : null}
        </View>
        <View style={styles.rowRight}>
          {price !== null ? (
            <Text style={[styles.itemPrice, { color: palette.primaryText }]}>
              {price}
            </Text>
          ) : null}
          {!orderable ? null : needsChoice ? (
            <Pressable
              onPress={() => onToggleItem(open ? null : item.id)}
              accessibilityRole="button"
              accessibilityLabel={`Choose options for ${item.name}`}
              style={[styles.addBtn, { borderColor: palette.accent }]}
            >
              <Text style={[styles.addLabel, { color: palette.accent }]}>
                {open ? "Close" : "Choose"}
              </Text>
            </Pressable>
          ) : plain === null ? (
            <Pressable
              onPress={() =>
                onAdd({
                  menuItemId: item.id,
                  itemName: item.name,
                  modifierIds: [],
                  modifierNames: [],
                  notes: null,
                })}
              accessibilityRole="button"
              accessibilityLabel={`Add ${item.name} to your order`}
              style={[styles.addBtn, { backgroundColor: palette.accent }]}
            >
              <Text style={[styles.addLabel, { color: palette.accentText }]}>
                Add
              </Text>
            </Pressable>
          ) : (
            // SIBLING controls inside a plain <View>. Wrapping the trio in a
            // Pressable would swallow all three for a screen reader.
            <View style={styles.stepper}>
              <Pressable
                onPress={() => onSetQuantity(plain.key, plain.quantity - 1)}
                accessibilityRole="button"
                accessibilityLabel={`One fewer ${item.name}`}
                style={[styles.stepBtn, { borderColor: palette.panelBorder }]}
              >
                <Text style={[styles.stepGlyph, { color: palette.primaryText }]}>
                  −
                </Text>
              </Pressable>
              <Text
                style={[styles.stepCount, { color: palette.primaryText }]}
                accessibilityLabel={`${plain.quantity} in your order`}
              >
                {plain.quantity}
              </Text>
              <Pressable
                onPress={() => onSetQuantity(plain.key, plain.quantity + 1)}
                accessibilityRole="button"
                accessibilityLabel={`One more ${item.name}`}
                style={[styles.stepBtn, { borderColor: palette.panelBorder }]}
              >
                <Text style={[styles.stepGlyph, { color: palette.primaryText }]}>
                  +
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
      {open && orderable && needsChoice ? (
        <VenueOrderItemOptions
          item={item}
          optionGroups={optionGroups}
          palette={palette}
          onAdd={(chosen) => {
            onAdd({
              menuItemId: item.id,
              itemName: item.name,
              modifierIds: chosen.ids,
              modifierNames: chosen.names,
              notes: null,
            });
            onToggleItem(null);
          }}
        />
      ) : null}
    </View>
  );
};

/**
 * The option groups for one item, expanded INLINE inside the row.
 *
 * Inline rather than a sub-sheet on purpose. A sheet raised from inside the page
 * would have to be a descendant of the page's own sheet on native (sibling
 * native modals compete at the OS root layer and the second one mounted is
 * simply invisible), and it would put a scrolling list behind a keyboard on a
 * surface that has no keyboard-aware host. An expanding panel has neither
 * problem, behaves identically on web and native, and keeps the guest's place in
 * the menu.
 *
 * No free text here: a line's note is written in the review step, where the
 * container is keyboard-safe on both surfaces.
 */
const VenueOrderItemOptions: React.FC<{
  item: PublicMenuItem;
  optionGroups: VenueOrderModifierGroup[];
  palette: ThemePalette;
  onAdd: (chosen: { ids: string[]; names: string[] }) => void;
}> = ({ item, optionGroups, palette, onAdd }) => {
  const [chosen, setChosen] = React.useState<string[]>([]);
  const failure = venueOrderingModifierFailure(optionGroups, chosen);

  const toggle = (group: VenueOrderModifierGroup, id: string): void => {
    setChosen((current: string[]) => {
      const inGroup = new Set(group.modifiers.map((modifier) => modifier.id));
      if (current.includes(id)) {
        return current.filter((value: string) => value !== id);
      }
      // A single-choice group REPLACES rather than accumulates — otherwise a
      // guest can select two sizes and the server rejects the order after the
      // fact, which is a worse way to learn the same thing.
      if (group.selectionMode === "single" || group.maxSelect === 1) {
        return [...current.filter((value: string) => !inGroup.has(value)), id];
      }
      return [...current, id];
    });
  };

  return (
    <View style={styles.options}>
      {optionGroups.map((group) => (
        <View key={group.id} style={styles.optionGroup}>
          <Text
            accessibilityRole="header"
            style={[styles.optionGroupName, { color: palette.secondaryText }]}
          >
            {group.name}
            {group.minSelect > 0 ? " · required" : ""}
          </Text>
          {group.modifiers.map((modifier) => {
            const selected = chosen.includes(modifier.id);
            const delta = modifier.priceDeltaCents === 0
              ? null
              : formatMenuPrice(modifier.priceDeltaCents, modifier.currency);
            return (
              <Pressable
                key={modifier.id}
                onPress={() => toggle(group, modifier.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={
                  delta === null
                    ? modifier.name
                    : `${modifier.name}, plus ${delta}`
                }
                style={[
                  styles.optionRow,
                  {
                    borderColor: selected ? palette.accent : palette.panelBorder,
                  },
                ]}
              >
                <Text
                  style={[styles.optionName, { color: palette.primaryText }]}
                >
                  {selected ? "✓ " : ""}
                  {modifier.name}
                </Text>
                {delta === null ? null : (
                  <Text
                    style={[styles.optionDelta, { color: palette.tertiaryText }]}
                  >
                    +{delta}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
      {failure === null ? null : (
        <Text style={[styles.optionError, { color: palette.secondaryText }]}>
          {venueOrderingModifierMessage(failure)}
        </Text>
      )}
      <Pressable
        onPress={() => {
          if (failure !== null) return;
          onAdd({
            ids: chosen,
            names: optionGroups.flatMap((group) =>
              group.modifiers
                .filter((modifier) => chosen.includes(modifier.id))
                .map((modifier) => modifier.name)
            ),
          });
        }}
        accessibilityRole="button"
        accessibilityState={{ disabled: failure !== null }}
        accessibilityLabel={`Add ${item.name} to your order`}
        style={[
          styles.optionConfirm,
          {
            backgroundColor: failure === null
              ? palette.accent
              : palette.panelBorder,
          },
        ]}
      >
        <Text
          style={[
            styles.optionConfirmLabel,
            { color: failure === null ? palette.accentText : palette.tertiaryText },
          ]}
        >
          Add to order
        </Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { gap: 24 },
  section: { gap: 8 },
  sectionName: { fontSize: 17, lineHeight: 21, fontWeight: "800" },
  sectionDesc: { fontSize: 14, lineHeight: 20, marginTop: 2 },
  card: { borderRadius: 16, overflow: "hidden", padding: 14 },
  row: { paddingVertical: 10, gap: 10 },
  rowTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  rowLeft: { flex: 1, minWidth: 0, gap: 2 },
  rowRight: { alignItems: "flex-end", gap: 8 },
  itemName: { fontSize: 16, lineHeight: 21, fontWeight: "700" },
  itemDesc: { fontSize: 14, lineHeight: 19 },
  itemPrice: { fontSize: 16, lineHeight: 21, fontWeight: "800" },
  addBtn: {
    minHeight: 34,
    minWidth: 74,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  addLabel: { fontSize: 14, fontWeight: "800" },
  stepper: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stepGlyph: { fontSize: 18, lineHeight: 22, fontWeight: "800" },
  stepCount: { fontSize: 16, fontWeight: "800", minWidth: 18, textAlign: "center" },
  options: { gap: 12, paddingTop: 4 },
  optionGroup: { gap: 6 },
  optionGroupName: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    minHeight: 42,
  },
  optionName: { fontSize: 15, fontWeight: "600", flexShrink: 1 },
  optionDelta: { fontSize: 14, fontWeight: "700" },
  optionError: { fontSize: 13, lineHeight: 18 },
  optionConfirm: {
    minHeight: 44,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  optionConfirmLabel: { fontSize: 15, fontWeight: "900" },
});

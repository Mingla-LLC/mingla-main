/**
 * Issue #1793 (#1767 Phase 4) — the consumer app's ordering surfaces.
 *
 * Four host components, each a thin bridge between
 * `useConsumerVenueOrdering` (state + network + the payment step) and the
 * shared renderers under `@mingla/brand-rendering/venueOrdering` (the pixels).
 * Nothing here draws anything itself; nothing here computes a price.
 *
 * WHY THE REVIEW STEP IS A SHEET ON THIS SURFACE, AND A PANE ON THE WEB.
 * The venue page's body is a plain ScrollView inside a parallax shell with no
 * keyboard-aware host. A name / email / phone form rendered inline in it would
 * sit under the keyboard on a phone the moment the guest tapped it — and
 * "keyboard never blocks input" is not a preference here, it is the difference
 * between an order and an abandoned one. `BaseBottomSheet` is the app's ONE
 * sheet primitive, it owns keyboard behaviour, and it re-exports the
 * keyboard-aware text input the fields need. Buyer web has neither problem and
 * renders the identical pane inline.
 *
 * The sheet is raised from the page frame (`overlays`), NOT from inside another
 * sheet — there is no parent sheet on this page — so the sub-sheet-inside-parent
 * rule is satisfied by there being no nesting at all.
 */

import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import type {
  offeringSurfaceStyles,
  ResolvedTheme,
  ThemePalette,
} from "@mingla/offering-rendering";

import { PublicMenuSections } from "@mingla/brand-rendering/PublicMenuSections";
import type { PublicMenuGroup } from "@mingla/brand-rendering";
import {
  isoDayFromMondayZero,
  venueOrderingCanOrder,
  venueOrderingMenuGroups,
  venueOrderingNotice,
} from "@mingla/brand-rendering/venueOrdering";
import { venueLocalClock } from "@mingla/brand-rendering/venueOpenState";
import { VenueOrderingMenuList } from "@mingla/brand-rendering/venueOrdering/VenueOrderingMenuList";
import {
  VenueOrderingNoticeCard,
  VenueOrderingSpotChip,
} from "@mingla/brand-rendering/venueOrdering/VenueOrderingNoticeCard";
import { VenueOrderingStickyBar } from "@mingla/brand-rendering/venueOrdering/VenueOrderingStickyBar";
import { VenueOrderReviewPane } from "@mingla/brand-rendering/venueOrdering/VenueOrderReviewPane";
import { VenueOrderStatusPane } from "@mingla/brand-rendering/venueOrdering/VenueOrderStatusPane";

import {
  BaseBottomSheet,
  BottomSheetTextInput,
} from "../ui/BaseBottomSheet";
import { useConsumerVenueOrdering } from "./useConsumerVenueOrdering";
import type { ConsumerVenueOrdering } from "./useConsumerVenueOrdering";

type Surface = ReturnType<typeof offeringSurfaceStyles>;

export interface ConsumerVenueOrderingSlotProps {
  ordering: ConsumerVenueOrdering;
  palette: ThemePalette;
  surface: Surface;
  theme: ResolvedTheme;
}

/** The venue's OWN clock — never the visitor's — resolved for the menu windows. */
function localClock(timezone: string | null): {
  isoDayOfWeek: number;
  minutesSinceMidnight: number;
} | null {
  const clock = venueLocalClock(new Date(), timezone);
  if (clock === null) return null;
  return {
    isoDayOfWeek: isoDayFromMondayZero(clock.weekday),
    minutesSinceMidnight: clock.minutes,
  };
}

/**
 * THE ONE ENTRY POINT this app mounts, and the reason it is one.
 *
 * `useConsumerVenueOrdering` reaches `@mingla/payments-native` →
 * `@stripe/stripe-react-native` — a NATIVE-ONLY module. A hook cannot be lazily
 * imported, so a ROUTE that calls it drags that chain into its own module
 * scope, and the venue route is mounted by web render suites that resolve
 * modules through a web sandbox where the native package does not exist. The
 * whole route then fails to load and every assertion in those suites reports
 * zero calls — which is the exact web-render regression #1789 already paid for
 * once in this programme.
 *
 * So the hook lives HERE, behind the host's lazy boundary, and the route imports
 * nothing of ordering at module scope. Buyer web collapsed to one component for
 * a different reason (its boot payload is measured); the two surfaces ending up
 * the same shape is a good sign rather than a coincidence.
 */
export const ConsumerVenueOrderingSurface: React.FC<{
  palette: ThemePalette;
  surface: Surface;
  theme: ResolvedTheme;
  brandSlug: string;
  venueSlug: string;
  spotCode: string | null;
  entrySource: string | null;
  menu: PublicMenuGroup[];
  menuWindows: Record<
    string,
    { start: string | null; end: string | null; days: number[] | null }
  >;
  timezone: string | null;
}> = ({
  palette,
  surface,
  theme,
  brandSlug,
  venueSlug,
  spotCode,
  entrySource,
  menu,
  menuWindows,
  timezone,
}) => {
  const ordering = useConsumerVenueOrdering({
    brandSlug,
    venueSlug,
    spotCode,
    entrySource,
    menu,
    // Someone who scanned the card on their table is owed an explanation when
    // they cannot order. Someone reading the menu out of curiosity is not.
    scanned: spotCode !== null || entrySource === "qr",
  });
  const notesAllowedByItemId = React.useMemo<
    Record<string, boolean | undefined>
  >(() => {
    const map: Record<string, boolean | undefined> = {};
    for (const group of menu) {
      for (const item of group.items) map[item.id] = item.allowsNotes === true;
    }
    return map;
  }, [menu]);
  const slotProps = { ordering, palette, surface, theme };

  const notice = venueOrderingNotice(ordering.config, {
    scanned: ordering.scanned,
  });
  const canOrder = venueOrderingCanOrder(ordering.config);
  // Nothing honest to say and nothing to sell: hand the pane back to the shared
  // screen's display-only renderer, which is the page this venue already had.
  if (notice === null && !canOrder) return null;

  return (
    <View style={styles.surface}>
      <ConsumerVenueOrderingNotice {...slotProps} />
      <ConsumerVenueOrderingBar {...slotProps} />
      {canOrder ? (
        <ConsumerVenueOrderingMenu
          {...slotProps}
          menu={menu}
          menuWindows={menuWindows}
          timezone={timezone}
        />
      ) : (
        <PublicMenuSections
          groups={menu}
          palette={palette}
          surface={surface}
          theme={theme}
        />
      )}
      <ConsumerVenueOrderingSheet
        {...slotProps}
        notesAllowedByItemId={notesAllowedByItemId}
      />
    </View>
  );
};

/** The honest state, or the spot chip. Null when there is nothing honest to say. */
export const ConsumerVenueOrderingNotice: React.FC<
  ConsumerVenueOrderingSlotProps
> = ({ ordering, palette, surface }) => {
  const notice = venueOrderingNotice(ordering.config, {
    scanned: ordering.scanned,
  });
  if (notice !== null) {
    return (
      <VenueOrderingNoticeCard
        notice={notice}
        palette={palette}
        surface={surface}
      />
    );
  }
  if (!venueOrderingCanOrder(ordering.config)) return null;
  return (
    <VenueOrderingSpotChip
      label={ordering.config.spotState === "ok" &&
          ordering.config.spot?.label !== null &&
          ordering.config.spot?.label !== undefined
        ? `Ordering for ${ordering.config.spot.label}`
        : "Order & collect from the counter"}
      palette={palette}
    />
  );
};

/**
 * The ORDERABLE menu — or the display-only one, unchanged, when this guest
 * cannot order here. Returning null hands the pane back to the shared screen's
 * own display-only renderer.
 */
export const ConsumerVenueOrderingMenu: React.FC<
  ConsumerVenueOrderingSlotProps & {
    menu: PublicMenuGroup[];
    menuWindows: Record<
      string,
      { start: string | null; end: string | null; days: number[] | null }
    >;
    timezone: string | null;
  }
> = ({
  ordering,
  palette,
  surface,
  theme,
  menu,
  menuWindows,
  timezone,
}) => {
  if (!venueOrderingCanOrder(ordering.config)) return null;
  const groups = venueOrderingMenuGroups({
    groups: menu,
    windowsByMenuId: menuWindows,
    servingMenuId: ordering.config.spot?.servingMenuId ?? null,
    local: localClock(timezone),
    orderingOn: true,
  });
  if (groups.length === 0) {
    // A spot pinned to a menu that has no public items: render the venue's menu
    // read-only rather than an empty pane, and say nothing that is not true.
    return (
      <PublicMenuSections
        groups={menu}
        palette={palette}
        surface={surface}
        theme={theme}
      />
    );
  }
  return (
    <VenueOrderingMenuList
      groups={groups}
      modifiersByItemId={ordering.modifiersByItemId}
      cart={ordering.cart.state.lines}
      palette={palette}
      surface={surface}
      theme={theme}
      openItemId={ordering.cart.state.openItemId}
      onToggleItem={ordering.cart.openItem}
      onAdd={ordering.cart.add}
      onSetQuantity={ordering.cart.setQuantity}
    />
  );
};

/** The bottom bar. Null unless there is something in the basket to look at. */
export const ConsumerVenueOrderingBar: React.FC<
  ConsumerVenueOrderingSlotProps
> = ({ ordering, palette }) => {
  if (ordering.cart.count === 0) return null;
  if (ordering.cart.state.view !== "browse") return null;
  return (
    <VenueOrderingStickyBar
      count={ordering.cart.count}
      totalCents={ordering.previewStatus === "ready" && ordering.preview !== null
        ? ordering.preview.totalCents
        : null}
      currency={ordering.preview?.currency ?? null}
      palette={palette}
      onPress={() => ordering.cart.setView("review")}
    />
  );
};

/**
 * The review step and the live order card, in the app's one sheet primitive.
 *
 * `keyboardBehavior="interactive"` plus the sheet's own `BottomSheetTextInput`
 * are what keep the three contact fields above the keyboard. The sheet's
 * `onClose` is the SINGLE dismissal owner (pan-down, backdrop and the code path
 * all arrive there), so a guest can never end up with an invisible sheet still
 * believing itself open.
 */
export const ConsumerVenueOrderingSheet: React.FC<
  ConsumerVenueOrderingSlotProps & {
    notesAllowedByItemId: Record<string, boolean | undefined>;
  }
> = ({ ordering, palette, surface, notesAllowedByItemId }) => {
  const view = ordering.cart.state.view;
  const visible = view === "review" || view === "status";
  return (
    <BaseBottomSheet
      visible={visible}
      onClose={() => ordering.cart.setView("browse")}
      snapPoints={["88%"]}
      theme="dark"
      scrollMode="scroll"
      hidesBottomNav
      keyboardBehavior="interactive"
      backgroundStyle={{ backgroundColor: palette.page }}
      accessibilityLabel={view === "status" ? "Your order" : "Review your order"}
      scrollProps={{ contentContainerStyle: styles.sheetBody }}
    >
      {view === "status" && ordering.live !== null ? (
        <VenueOrderStatusPane
          palette={palette}
          surface={surface}
          live={ordering.live}
          buyerName={ordering.cart.state.buyer.name}
          actionPending={ordering.actionPending}
          actionError={ordering.actionError}
          onCancel={ordering.cancelOrder}
          onRequestRefund={ordering.requestRefund}
          onOrderMore={ordering.orderMore}
        />
      ) : view === "status" ? (
        <View style={styles.pending}>
          <ActivityIndicator />
          <Text style={[styles.pendingText, { color: palette.secondaryText }]}>
            Confirming your order…
          </Text>
        </View>
      ) : (
        <VenueOrderReviewPane
          palette={palette}
          surface={surface}
          config={ordering.config}
          cart={ordering.cart.state.lines}
          notesAllowedByItemId={notesAllowedByItemId}
          preview={ordering.preview}
          previewStatus={ordering.previewStatus}
          previewError={ordering.previewError}
          tip={ordering.cart.state.tip}
          tipRemembered={ordering.tipRemembered}
          onTipChange={ordering.cart.setTip}
          partySize={ordering.cart.state.partySize}
          askPartySize={ordering.askPartySize}
          onPartySizeChange={ordering.cart.setPartySize}
          buyer={ordering.cart.state.buyer}
          onBuyerChange={ordering.cart.patchBuyer}
          onSetQuantity={ordering.cart.setQuantity}
          onSetNotes={ordering.cart.setNotes}
          submitting={ordering.submitting}
          submitError={ordering.submitError}
          onSubmit={ordering.submit}
          onBack={() => ordering.cart.setView("browse")}
          TextInputComponent={BottomSheetTextInput}
        />
      )}
    </BaseBottomSheet>
  );
};

const styles = StyleSheet.create({
  surface: { gap: 16 },
  sheetBody: { paddingHorizontal: 16, paddingBottom: 40, paddingTop: 8 },
  pending: { alignItems: "center", gap: 12, paddingVertical: 48 },
  pendingText: { fontSize: 15 },
});

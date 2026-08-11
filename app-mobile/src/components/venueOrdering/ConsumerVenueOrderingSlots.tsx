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
  sheetBody: { paddingHorizontal: 16, paddingBottom: 40, paddingTop: 8 },
  pending: { alignItems: "center", gap: 12, paddingVertical: 48 },
  pendingText: { fontSize: 15 },
});

/**
 * Issue #1793 (#1767 Phase 4) — buyer web's ordering surfaces.
 *
 * The same four slots the consumer app fills, filled differently in exactly one
 * place: the review step renders INLINE here rather than in a bottom sheet.
 * There is no keyboard to hide behind on the web and no sheet primitive to
 * fight, so a pane in the page is both simpler and better — the guest keeps
 * their scroll position and the browser's own autofill works on the contact
 * fields.
 *
 * Nothing here draws a control or computes a price. It is a bridge between
 * `useBuyerVenueOrdering` (state, network, the hosted redirect) and the shared
 * renderers under `@mingla/brand-rendering/venueOrdering`.
 */

import React from "react";
import { StyleSheet, View } from "react-native";
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

import type { BuyerVenueOrdering } from "./useBuyerVenueOrdering";

type Surface = ReturnType<typeof offeringSurfaceStyles>;

export interface BuyerVenueOrderingSlotProps {
  ordering: BuyerVenueOrdering;
  palette: ThemePalette;
  surface: Surface;
  theme: ResolvedTheme;
}

/** The venue's OWN clock — never the visitor's. */
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
export const BuyerVenueOrderingNotice: React.FC<BuyerVenueOrderingSlotProps> = ({
  ordering,
  palette,
  surface,
}) => {
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
  const label = ordering.config.spotState === "ok" &&
      ordering.config.spot?.label !== null &&
      ordering.config.spot?.label !== undefined
    ? `Ordering for ${ordering.config.spot.label}`
    : "Order & collect from the counter";
  return <VenueOrderingSpotChip label={label} palette={palette} />;
};

/**
 * The Menu pane's body: the review step, the live order, or the orderable menu —
 * in that order of precedence, because whichever one the guest is in the middle
 * of is the one they came back for.
 *
 * Returning null hands the pane back to the shared screen's display-only
 * renderer, which is what a venue with ordering off gets: the page it had.
 */
export const BuyerVenueOrderingMenu: React.FC<
  BuyerVenueOrderingSlotProps & {
    menu: PublicMenuGroup[];
    menuWindows: Record<
      string,
      { start: string | null; end: string | null; days: number[] | null }
    >;
    timezone: string | null;
    notesAllowedByItemId: Record<string, boolean | undefined>;
  }
> = ({
  ordering,
  palette,
  surface,
  theme,
  menu,
  menuWindows,
  timezone,
  notesAllowedByItemId,
}) => {
  if (!venueOrderingCanOrder(ordering.config)) return null;

  if (ordering.cart.state.view === "status" && ordering.live !== null) {
    return (
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
    );
  }

  if (ordering.cart.state.view === "review") {
    return (
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
      />
    );
  }

  const groups = venueOrderingMenuGroups({
    groups: menu,
    windowsByMenuId: menuWindows,
    servingMenuId: ordering.config.spot?.servingMenuId ?? null,
    local: localClock(timezone),
    orderingOn: true,
  });
  if (groups.length === 0) {
    // A spot pinned to a menu with no public items: show the venue's menu
    // read-only rather than an empty pane, and claim nothing.
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
    <View style={styles.menuWrap}>
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
    </View>
  );
};

/** The bottom bar. Null unless there is a basket to look at, on the browse step. */
export const BuyerVenueOrderingBar: React.FC<BuyerVenueOrderingSlotProps> = ({
  ordering,
  palette,
}) => {
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

const styles = StyleSheet.create({
  menuWrap: { gap: 24 },
});

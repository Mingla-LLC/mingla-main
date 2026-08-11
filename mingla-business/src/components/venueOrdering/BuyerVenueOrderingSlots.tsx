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

import { useBuyerVenueOrdering } from "./useBuyerVenueOrdering";
import type { BuyerVenueOrdering } from "./useBuyerVenueOrdering";

/**
 * The transport, RE-EXPORTED from this module on purpose.
 *
 * `/o/venue/[orderId]` needs exactly two of these functions, and it must reach
 * them through the SAME dynamic-import specifier the venue page uses. Two
 * different dynamic imports produce two async chunks, and a module two async
 * chunks share is hoisted straight into `__common` — the payload every visitor
 * downloads before anything renders. That is not a theory here: it is the
 * measured difference between +18 KB and this file (ORCH-1083, 12 KB per PR).
 * One specifier, one chunk, downloaded only by someone actually ordering.
 */
export {
  fetchVenueOrderStatus,
  venueOrderGuestAction,
} from "../../services/venueOrderingService";

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

/**
 * THE ONE ENTRY POINT buyer web mounts.
 *
 * Why one component rather than the three slots the consumer app uses: on web
 * the boot payload is MEASURED, and `useBuyerVenueOrdering` is a hook — a hook
 * cannot be lazily imported, so a route that calls it drags the cart reducer,
 * the rules and the sitting into that route's chunk at module scope. The venue
 * page and the order page are two chunks, both would carry them, and Metro
 * hoists anything two chunks share into `__common` — the bundle every visitor
 * downloads before anything renders, ordering venue or not. Measured: +31 KB,
 * over the 12 KB a single PR may add (ORCH-1083).
 *
 * So the hook lives HERE, inside the one lazily-imported module, and the route
 * imports nothing of ordering at module scope. The bar that carries a guest
 * from browsing to paying rides at the top of the pane instead of the bottom of
 * the viewport, which is the one visible difference from the native surface and
 * a cheap price for a boot payload that does not grow for people who will never
 * order anything.
 */
export const BuyerVenueOrderingSurface: React.FC<{
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
  notesAllowedByItemId: Record<string, boolean | undefined>;
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
  notesAllowedByItemId,
}) => {
  const ordering = useBuyerVenueOrdering({
    brandSlug,
    venueSlug,
    spotCode,
    entrySource,
    menu,
    // Someone who scanned the card on their table is owed an explanation when
    // they cannot order. Someone reading the menu out of curiosity is not.
    scanned: spotCode !== null || entrySource === "qr",
  });
  const slotProps = { ordering, palette, surface, theme };
  return (
    <View style={styles.surface}>
      <BuyerVenueOrderingNotice {...slotProps} />
      <BuyerVenueOrderingBar {...slotProps} />
      <BuyerVenueOrderingMenu
        {...slotProps}
        menu={menu}
        menuWindows={menuWindows}
        timezone={timezone}
        notesAllowedByItemId={notesAllowedByItemId}
      />
    </View>
  );
};

/**
 * The order page's body, exported from THIS module on purpose.
 *
 * `/o/venue/[orderId]` and the venue page are different routes, so a status
 * card imported by both from two different modules is a module two chunks
 * share — and a module two chunks share is a module in `__common`. Pointing
 * both at one lazily-imported module keeps the whole ordering surface in one
 * async chunk that only a guest who is actually ordering ever downloads.
 */
export const BuyerVenueOrderStatusView: React.FC<{
  palette: ThemePalette;
  surface: Surface;
  live: import("@mingla/brand-rendering/venueOrdering").VenueOrderLiveStatus;
  actionPending: boolean;
  actionError: string | null;
  onCancel: () => void;
  onRequestRefund: () => void;
}> = ({ palette, surface, live, actionPending, actionError, onCancel, onRequestRefund }) => (
  <VenueOrderStatusPane
    palette={palette}
    surface={surface}
    live={live}
    buyerName=""
    actionPending={actionPending}
    actionError={actionError}
    onCancel={onCancel}
    onRequestRefund={onRequestRefund}
    onOrderMore={null}
  />
);

/** The action bar. Null unless there is a basket to look at, on the browse step. */
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
  surface: { gap: 16 },
  menuWrap: { gap: 24 },
});

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

import { VENUE_ORDER_COUNTER_TITLE } from "@mingla/brand-rendering/venueOrdering/VenueOrderingStickyBar";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
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
  venueOrderingIsCounterPickup,
  venueOrderingMenuGroups,
  venueOrderingNotice,
  venueOrderingOwnsBottomEdge,
  venueOrderingSheetView,
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

import { usePublicMenuBundle } from "../../hooks/usePublicMenuBundle";
// issue #3380 — pure phone helpers only at module scope. The picker component
// is required where the review step renders it (see renderPhoneField), so the
// menu mounts without loading the phone field's native keyboard stack.
import {
  buyerOrderPhoneFailure,
  buyerOrderPhoneStartCountry,
} from "./buyerOrderPhone";
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
  resumeVenueOrderPayment,
  venueOrderGuestAction,
} from "../../services/venueOrderingService";

type Surface = ReturnType<typeof offeringSurfaceStyles>;

/** Stable, so an empty window map does not churn the memo below it. */
const EMPTY_WINDOWS: Record<
  string,
  { start: string | null; end: string | null; days: number[] | null }
> = {};

export interface BuyerVenueOrderingSlotProps {
  ordering: BuyerVenueOrdering;
  palette: ThemePalette;
  surface: Surface;
  theme: ResolvedTheme;
  /** issue #3380 — the venue's country; the guest's phone picker starts here. */
  countryCode?: string | null;
}

/** issue #4420 D-V2 — where the basket bar docks, from the screen's slot context. */
export interface BuyerVenueOrderingBarPlacement {
  isDesktop?: boolean;
  bottomInset?: number;
  onBottomBarChange?: (owned: boolean) => void;
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
export const BuyerVenueOrderingNotice: React.FC<
  BuyerVenueOrderingSlotProps
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
  const label =
    ordering.config.spotState === "ok" &&
    // #4490 07-D — a counter order at a scanned spot names the counter.
    !venueOrderingIsCounterPickup(ordering.config, ordering.pickup) &&
    ordering.config.spot?.label !== null &&
    ordering.config.spot?.label !== undefined
      ? `Ordering for ${ordering.config.spot.label}`
      : // #4490 fix 2 (N91): the same words as the order bar with no table.
        VENUE_ORDER_COUNTER_TITLE;
  const counterPath = ordering.counterOrderPath ?? null;
  if (counterPath === null) {
    return <VenueOrderingSpotChip label={label} palette={palette} />;
  }
  // N145 (#4490): a pickup order placed from this table keeps its own status
  // page; the table stays orderable and links to it.
  return (
    <View style={counterStyles.row}>
      <VenueOrderingSpotChip label={label} palette={palette} />
      <Pressable
        accessibilityRole="link"
        accessibilityLabel="See your pickup order"
        onPress={() => openCounterOrder(counterPath)}
        hitSlop={8}
      >
        <Text style={[counterStyles.link, { color: palette.primaryText }]}>
          Your pickup order · See status
        </Text>
      </Pressable>
    </View>
  );
};

function openCounterOrder(path: string): void {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.location.assign(path);
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { router } = require("expo-router") as typeof import("expo-router");
  router.push(path as never);
}

const counterStyles = StyleSheet.create({
  row: { gap: 8 },
  link: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
    textDecorationLine: "underline",
  },
});

/**
 * issue #4420 — the order review's frame: the app's bottom sheet on phone (a
 * 560 dialog on desktop web), loaded on the first review rather than at module
 * scope, the same as the phone field below: the sheet's animation stack would
 * otherwise ride every menu visit (and every suite that mounts the menu). Once
 * opened it stays mounted, so closing animates and reopening is instant.
 */
const BuyerVenueOrderReviewSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  background: string;
  children: React.ReactNode;
}> = ({ open, onClose, background, children }) => {
  const [mounted, setMounted] = React.useState<boolean>(open);
  React.useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  if (!mounted && !open) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Sheet } = require("../ui/Sheet") as typeof import("../ui/Sheet");
  return (
    <Sheet
      visible={open}
      onClose={onClose}
      snapPoint="full"
      presentation="modal"
      panelBackground={background}
      testID="issue-4420-venue-order-review-sheet"
    >
      {children}
    </Sheet>
  );
};

/** The review body scrolls; "Pay {total}" stays pinned in the sheet's footer. */
const ReviewSheetLayout: React.FC<{
  footer: React.ReactNode;
  children: React.ReactNode;
}> = ({ footer, children }) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { SheetScrollLayout } = require("../ui/SheetScrollLayout") as typeof import("../ui/SheetScrollLayout");
  return (
    <SheetScrollLayout keyboardAware footer={footer}>
      {children}
    </SheetScrollLayout>
  );
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
  countryCode = null,
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
        onRetryPayment={ordering.retryPayment}
        retryPaymentPending={ordering.retryPending}
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
  // issue #4420 — the review is a sheet over the menu: close or the scrim
  // returns to browsing, and the menu stays where the guest left it.
  const reviewOpen = ordering.cart.state.view === "review";
  const reviewSheet = (
    <BuyerVenueOrderReviewSheet
      open={reviewOpen}
      onClose={() => ordering.cart.setView("browse")}
      background={palette.page}
    >
      {reviewOpen ? (
          <VenueOrderReviewPane
            palette={palette}
            surface={surface}
            config={ordering.config}
            cart={ordering.cart.state.lines}
            notesAllowedByItemId={notesAllowedByItemId}
            preview={ordering.preview}
            previewStatus={ordering.previewStatus}
            previewError={ordering.previewError}
            discountCode={ordering.discountCode ?? ""}
            onDiscountCodeChange={ordering.setDiscountCode ?? (() => undefined)}
            tip={ordering.cart.state.tip}
            tipRemembered={ordering.tipRemembered}
            onTipChange={ordering.cart.setTip}
            partySize={ordering.cart.state.partySize}
            askPartySize={ordering.askPartySize}
            onPartySizeChange={ordering.cart.setPartySize}
            buyer={ordering.cart.state.buyer}
            onBuyerChange={ordering.cart.patchBuyer}
            pickup={ordering.pickup}
            onPickupChange={ordering.setPickup}
            onSetQuantity={ordering.cart.setQuantity}
            onSetNotes={ordering.cart.setNotes}
            // issue #3380 — the country picker instead of a free-text box.
            renderPhoneField={(args) => {
              // Required here, not at module scope: only the review step needs the
              // picker, and a module-scope import would load its keyboard stack for
              // every menu visit (and every suite that mounts the menu).
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const { BuyerVenueOrderPhoneField } = require("./BuyerVenueOrderPhoneField") as typeof import("./BuyerVenueOrderPhoneField");
              return (
                <BuyerVenueOrderPhoneField
                  args={args}
                  palette={palette}
                  theme={theme}
                  countryCode={countryCode}
                />
              );
            }}
            phoneFailure={
              buyerOrderPhoneFailure(
                ordering.cart.state.buyer.phone,
                ordering.cart.state.buyer.phoneCountryIso ??
                  buyerOrderPhoneStartCountry(countryCode),
              )?.message ?? null
            }
            submitting={ordering.submitting}
            submitError={ordering.submitError}
            onSubmit={ordering.submit}
            onBack={() => ordering.cart.setView("browse")}
            // issue #4420 — a bottom sheet on phone (a 560 dialog on desktop)
            // with "Pay {total}" pinned in its footer; contents unchanged.
            layout={(body, payButton) => (
              <ReviewSheetLayout footer={payButton}>{body}</ReviewSheetLayout>
            )}
          />
      ) : null}
    </BuyerVenueOrderReviewSheet>
  );
  return (
    <View style={styles.menuWrap}>
      {reviewSheet}
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
  timezone: string | null;
  /** issue #3380 — the venue's country, for the guest's phone picker. */
  countryCode?: string | null;
} & BuyerVenueOrderingBarPlacement> = ({
  palette,
  surface,
  theme,
  brandSlug,
  venueSlug,
  spotCode,
  entrySource,
  menu,
  timezone,
  countryCode = null,
  isDesktop = false,
  bottomInset = 0,
  onBottomBarChange,
}) => {
  /**
   * The service WINDOWS are read HERE rather than by the route, and that is not
   * a style choice.
   *
   * The route already reads the public menu through the shipped
   * `usePublicMenus`, and it is mounted by render suites that provide no
   * QueryClient because every hook it calls is mocked by module path. Adding a
   * SECOND query to it would mean editing those suites to mock a new module —
   * a change to a pinned test for the convenience of an implementor, which is
   * exactly the trade the append-only posture exists to refuse.
   *
   * This component is behind a lazy boundary and never mounts in those suites
   * (it suspends to `null`), so the query belongs here. It rides the same
   * `public_menus_view` read and is served from the same React Query cache.
   */
  const bundle = usePublicMenuBundle(brandSlug, venueSlug);
  const menuWindows = bundle.data?.windows ?? EMPTY_WINDOWS;
  const notesAllowedByItemId = React.useMemo<
    Record<string, boolean | undefined>
  >(() => {
    const map: Record<string, boolean | undefined> = {};
    for (const group of menu) {
      for (const item of group.items) map[item.id] = item.allowsNotes === true;
    }
    return map;
  }, [menu]);

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
  const slotProps = { ordering, palette, surface, theme, countryCode };
  const notice = venueOrderingNotice(ordering.config, {
    scanned: ordering.scanned,
  });
  const canOrder = venueOrderingCanOrder(ordering.config);
  // #2735 — this lazy surface is a TOTAL menu renderer. Returning null here
  // cannot hand control back across the route's Suspense boundary: React would
  // remove the display-menu fallback and commit an empty body. An ordinary
  // ordering-off visit therefore settles to the same real display menu.
  if (notice === null && !canOrder) {
    return (
      <View style={styles.surface}>
        <PublicMenuSections
          groups={menu}
          palette={palette}
          surface={surface}
          theme={theme}
        />
      </View>
    );
  }

  // #4490 fix 2 (N93): on desktop the bar comes after the menu and sticks to
  // the bottom of the screen inside the menu's column (never over the cover).
  const bar = (
    <BuyerVenueOrderingBar
      {...slotProps}
      isDesktop={isDesktop}
      bottomInset={bottomInset}
      onBottomBarChange={onBottomBarChange}
    />
  );
  return (
    <View style={styles.surface}>
      <BuyerVenueOrderingNotice {...slotProps} />
      {isDesktop ? null : bar}
      {canOrder ? (
        <BuyerVenueOrderingMenu
          {...slotProps}
          menu={menu}
          menuWindows={menuWindows}
          timezone={timezone}
          notesAllowedByItemId={notesAllowedByItemId}
        />
      ) : (
        <PublicMenuSections
          groups={menu}
          palette={palette}
          surface={surface}
          theme={theme}
        />
      )}
      {isDesktop ? bar : null}
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
  onRetryPayment?: () => void;
  retryPaymentPending?: boolean;
}> = ({
  palette,
  surface,
  live,
  actionPending,
  actionError,
  onCancel,
  onRequestRefund,
  onRetryPayment,
  retryPaymentPending,
}) => (
  <VenueOrderStatusPane
    palette={palette}
    surface={surface}
    live={live}
    buyerName={live.buyerName}
    actionPending={actionPending}
    actionError={actionError}
    onCancel={onCancel}
    onRequestRefund={onRequestRefund}
    onOrderMore={null}
    onRetryPayment={onRetryPayment}
    retryPaymentPending={retryPaymentPending}
  />
);

/**
 * The basket bar, on the browse step while the venue takes orders.
 *
 * issue #4420 D-V2 — on web it docks at the bottom of the screen (the flyer
 * column on desktop), like every offering page's glass bar, and tells the
 * screen it owns that edge so the reserve bar steps aside on the Menu tab.
 * An empty basket still shows the bar ("Order from your table · Add
 * something to start", no button), so the guest knows ordering is open.
 */
export const BuyerVenueOrderingBar: React.FC<
  BuyerVenueOrderingSlotProps & BuyerVenueOrderingBarPlacement
> = ({ ordering, palette, isDesktop = false, bottomInset = 0, onBottomBarChange }) => {
  const canOrder = venueOrderingCanOrder(ordering.config);
  const shown = canOrder && ordering.cart.state.view === "browse";
  // #4490 W3 fix 4 (W3-N36): ordering keeps the Menu tab's bottom edge while
  // the review or the order status is open too, so the venue's lead bar
  // ("Buy entry") never comes back over an open order.
  const owned =
    Platform.OS === "web" &&
    venueOrderingOwnsBottomEdge({
      canOrder,
      sheetView: venueOrderingSheetView({
        view: ordering.cart.state.view,
        lineCount: ordering.cart.state.lines.length,
      }),
    });
  React.useEffect(() => {
    if (onBottomBarChange === undefined) return undefined;
    onBottomBarChange(owned);
    return () => onBottomBarChange(false);
  }, [owned, onBottomBarChange]);
  if (!shown) return null;
  const spotLabel =
    ordering.config.spotState === "ok" && !venueOrderingIsCounterPickup(ordering.config, ordering.pickup)
      ? ordering.config.spot?.label ?? null
      : null;
  return (
    <VenueOrderingStickyBar
      count={ordering.cart.count}
      totalCents={
        ordering.previewStatus === "ready" && ordering.preview !== null
          ? ordering.preview.totalCents
          : null
      }
      currency={ordering.preview?.currency ?? null}
      palette={palette}
      onPress={() => ordering.cart.setView("review")}
      spotLabel={spotLabel}
      placement="screen"
      isDesktop={isDesktop}
      bottomInset={bottomInset}
    />
  );
};

const styles = StyleSheet.create({
  surface: { gap: 16 },
  menuWrap: { gap: 24 },
});

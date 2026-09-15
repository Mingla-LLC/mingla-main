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
import { Pressable, StyleSheet, Text, View } from "react-native";
import type {
  offeringSurfaceStyles,
  ResolvedTheme,
  ThemePalette,
} from "@mingla/offering-rendering";

import {
  PhoneInput,
  getCountryByCode,
  type PhoneInputIconName,
} from "@mingla/phone-input";
import {
  parsePhoneEntry,
  resolvePhoneStartCountry,
} from "@mingla/phone-input/phoneNumber";
import type { VenueOrderPhoneFieldArgs } from "@mingla/brand-rendering/venueOrdering";

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

import { usePublicMenuBundle } from "../../hooks/usePublicMenuBundle";
import { devicePhoneRegion } from "../../utils/devicePhoneRegion";
import { businessRsvpPhoneTheme } from "../event/useBusinessRsvpPhoneField";
import { Icon } from "../ui/Icon";
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

const phoneCountryKnown = (iso: string): boolean => {
  try {
    return getCountryByCode(iso) !== undefined;
  } catch {
    return false;
  }
};

/** issue #3380 — venue country, then the visitor's browser region. */
export const buyerOrderPhoneStartCountry = (
  venueCountry: string | null | undefined,
): string | null =>
  resolvePhoneStartCountry([venueCountry, devicePhoneRegion()], phoneCountryKnown);

/**
 * issue #3380 — the verdict on the guest's number, in words, or null. Mobile
 * rules, because the order's "it's ready" message is a text.
 */
export const buyerOrderPhoneFailure = (
  phone: string,
  countryIso: string | null,
): { message: string; suggestedCountryIso: string | null } | null => {
  if (phone.replace(/\D/g, "").length === 0) return null;
  const result = parsePhoneEntry(phone, {
    countryIso,
    dialCode:
      countryIso === null ? null : (getCountryByCode(countryIso)?.dialCode ?? null),
    mode: "mobile",
  });
  return result.ok
    ? null
    : { message: result.message, suggestedCountryIso: result.suggestedCountryIso };
};

/**
 * issue #3380 — "Who's ordering?" phone, with the country picker.
 *
 * Replaces the free-text "Phone, with country code" box. Starts on the venue's
 * country and writes that country into the draft straight away, so the order
 * carries it even if the guest never touches the flag.
 */
export const BuyerVenueOrderPhoneField: React.FC<{
  args: VenueOrderPhoneFieldArgs;
  palette: ThemePalette;
  theme: ResolvedTheme;
  countryCode: string | null;
}> = ({ args, palette, theme, countryCode }) => {
  const { onChange, phone, phoneCountryIso } = args;
  const [touched, setTouched] = React.useState(false);
  const start = buyerOrderPhoneStartCountry(countryCode);
  const chosen = React.useRef(false);
  React.useEffect(() => {
    if (chosen.current || start === null) return;
    if (phoneCountryIso !== start && phone.replace(/\D/g, "").length === 0) {
      onChange({ phoneCountryIso: start });
    }
  }, [onChange, phone, phoneCountryIso, start]);
  const countryIso = phoneCountryIso ?? start;
  const failure = buyerOrderPhoneFailure(phone, countryIso);
  const suggested =
    touched && failure?.suggestedCountryIso != null
      ? getCountryByCode(failure.suggestedCountryIso)
      : undefined;
  const phoneTheme = React.useMemo(
    () => businessRsvpPhoneTheme(palette, theme),
    [palette, theme],
  );
  return (
    <View>
      <PhoneInput
        smartEntry
        required
        pickerPresentation="overlay"
        value={phone}
        countryCode={countryIso}
        onChangePhone={(next: string) => {
          if (next.length > 0) chosen.current = true;
          // The country is NOT re-sent here: a pasted "+44 …" has just switched
          // it through onChangeCountry, and this closure still holds the old one.
          onChange({ phone: next });
        }}
        onChangeCountry={(iso: string) => {
          chosen.current = true;
          onChange({ phoneCountryIso: iso });
        }}
        onBlur={() => setTouched(true)}
        error={touched && failure !== null ? failure.message : null}
        disabled={args.disabled}
        testID="venue-order-buyer-phone"
        iconRenderer={(
          name: PhoneInputIconName,
          iconProps: { size: number; color: string },
        ) => (
          <Icon
            name={
              name === "chevronDown"
                ? "chevD"
                : name === "checkmark"
                  ? "check"
                  : name === "close"
                    ? "close"
                    : "search"
            }
            size={iconProps.size}
            color={iconProps.color}
          />
        )}
        labels={{
          phonePlaceholder: "Mobile number",
          countryButtonAccessibilityLabel: (name: string) =>
            `Country code, ${name}, tap to change`,
          phoneInputAccessibilityLabel: "Mobile number for order updates",
          doneButton: "Done",
          pickerTitle: "Select country",
          pickerSearchPlaceholder: "Search country or dial code",
          pickerCloseAccessibilityLabel: "Close country picker",
          pickerNoResults: "No countries found",
        }}
        theme={phoneTheme}
      />
      {suggested !== undefined ? (
        <Pressable
          onPress={() => {
            chosen.current = true;
            onChange({ phoneCountryIso: suggested.code });
          }}
          accessibilityRole="button"
          accessibilityLabel={`Switch the country code to ${suggested.name} ${suggested.dialCode}`}
          hitSlop={8}
          style={styles.phoneSwitch}
        >
          <Text style={[styles.phoneSwitchText, { color: palette.accent }]}>
            {`Switch to ${suggested.flag} ${suggested.name} (${suggested.dialCode})`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
};

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
        // issue #3380 — the country picker instead of a free-text box.
        renderPhoneField={(args) => (
          <BuyerVenueOrderPhoneField
            args={args}
            palette={palette}
            theme={theme}
            countryCode={countryCode}
          />
        )}
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
  timezone: string | null;
  /** issue #3380 — the venue's country, for the guest's phone picker. */
  countryCode?: string | null;
}> = ({
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

  return (
    <View style={styles.surface}>
      <BuyerVenueOrderingNotice {...slotProps} />
      <BuyerVenueOrderingBar {...slotProps} />
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
    buyerName=""
    actionPending={actionPending}
    actionError={actionError}
    onCancel={onCancel}
    onRequestRefund={onRequestRefund}
    onOrderMore={null}
    onRetryPayment={onRetryPayment}
    retryPaymentPending={retryPaymentPending}
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
      totalCents={
        ordering.previewStatus === "ready" && ordering.preview !== null
          ? ordering.preview.totalCents
          : null
      }
      currency={ordering.preview?.currency ?? null}
      palette={palette}
      onPress={() => ordering.cart.setView("review")}
    />
  );
};

const styles = StyleSheet.create({
  surface: { gap: 16 },
  menuWrap: { gap: 24 },
  phoneSwitch: { alignSelf: "flex-start", paddingVertical: 4, marginTop: 4 },
  phoneSwitchText: { fontSize: 14, fontWeight: "600" },
});

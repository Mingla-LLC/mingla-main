/**
 * #4490 Explorer W2 — the three venue detail bodies in Purchases (spec 06 §3
 * W2): a booking with its pass, a plan with its member pass, a waitlist place.
 *
 * Server state only: the list row (React Query, purchase keys) draws at once;
 * the owner's live read (pass QR included) loads beside it under
 * `purchaseKeys.venueLive`. Every action is the server's (cancel preview then
 * cancel, guest change preview then change, plan actions, Renew on the web
 * payment page, leave the waitlist) and refreshes the purchase keys when done.
 * Loading, error with Retry, and every state of each kind render; a failed
 * live read keeps the booking on screen with its own Retry.
 */
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "react-native-qrcode-svg";
import * as WebBrowser from "expo-web-browser";
import {
  guestChangeWords,
  type GuestChangeSummary,
} from "@mingla/brand-rendering/venueOffers/packageModel";
import {
  guestsText,
  refundPreviewWords,
  venueOfferErrorCopy,
  type EntryCancelPreview,
} from "@mingla/brand-rendering/venueOffers/entryModel";

import { fontWeights, radius, spacing, typography } from "../../constants/designSystem";
import { purchaseKeys } from "../../hooks/queryKeys";
import type { PurchaseTicket } from "../../services/purchasesService";
import {
  actOnVenueMember,
  cancelVenueBooking,
  changeVenueGuests,
  confirmVenueMemberPayment,
  getVenueBooking,
  getVenueMember,
  leaveVenueWaitlist,
  openVenueMemberPayment,
  previewVenueCancel,
  previewVenueGuestChange,
  venueActionKey,
  VenuePurchaseError,
  type VenueMemberAction,
} from "../../services/venuePurchaseService";
import { withKnownCurrencySymbol } from "../../utils/programFormat";
import type { PurchaseTimelineItem } from "../../utils/purchaseTimeline";
import { CalendarPlanMessageButton } from "../brandEnquiry/CalendarPlanMessageButton";
import type { CalendarPlanMessageTarget } from "../brandEnquiry/calendarPlanMessage";
import { toastManager } from "../ui/Toast";
import { DoorModeModal } from "./DoorModeModal";
import { PURCHASE_SHEET_COLORS as C } from "./purchaseSheetTheme";
import { VenueOnTheDay } from "./VenueOnTheDay";
import { VenueOfferCheckoutSheet, type VenueCheckoutOpen } from "../venueOffers/VenueOfferCheckoutSheet";
import { takeVenueCheckout, type VenueCheckoutSnapshot } from "../venueOffers/venueCheckoutResume";
import { venueMoneyText } from "../venueOffers/venueMoneyText";
import {
  isOpenWaitlistPlace,
  memberCodeWords,
  memberDay,
  venueBookingDoorPass,
  venueBookingExtraRows,
  venueBookingGuests,
  venueBookingMoneyRows,
  venueBookingPayAction,
  venueBookingPlaceLine,
  venueBookingProgress,
  venueBookingStateLabel,
  venueBookingWhenLine,
  venueGuestChangeLabel,
  venueGuestsCanDecrease,
  venueMemberCanRenew,
  venueMemberErrorCopy,
  venueMemberState,
  venueWaitlistState,
  type VenueBooking,
  type VenueMember,
  type VenueWaitlistPlace,
} from "./venuePurchaseModel";

/** §5 accessibility: the pass QR's label. */
export const VENUE_PASS_QR_LABEL = "Your pass. Show this at the door.";

/** W2-N9: what a screen reader says for the guest stepper's − and + (the
 * Discover guests stepper's existing words, discover:guests.*_a11y). */
export const VENUE_GUEST_STEPPER_LABELS = { fewer: "Remove a guest", more: "Add a guest" } as const;

const errorCode = (e: unknown): string | null => (e instanceof VenuePurchaseError ? e.code : null);

function doorTicket(id: string, qrCode: string, name: string, holder: string | null): PurchaseTicket {
  return {
    id,
    ticketTypeId: "venue_pass",
    ticketTypeName: name,
    qrCode,
    status: "valid",
    attendeeName: holder,
    attendeeEmail: null,
    eventDateIds: [],
    ticketIndex: 1,
    transferState: "none",
    holderFirstName: null,
  };
}

function Row({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function Action({
  label,
  accessibilityLabel,
  onPress,
  busy = false,
  disabled = false,
  primary = false,
  testID,
}: {
  label: string;
  /** Spoken name when the visible label is a symbol (the stepper's − and +). */
  accessibilityLabel?: string;
  onPress: () => void;
  busy?: boolean;
  /** Shown dimmed and not tappable (e.g. "−" at one guest). */
  disabled?: boolean;
  primary?: boolean;
  testID: string;
}): React.ReactElement {
  const off = busy || disabled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ busy, disabled: off }}
      disabled={off}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.action,
        primary && styles.actionPrimary,
        disabled && styles.actionDisabled,
        pressed && styles.pressed,
      ]}
    >
      {busy ? <ActivityIndicator color={C.text} /> : <Text style={styles.actionText}>{label}</Text>}
    </Pressable>
  );
}

function PassCard({
  qrPayload,
  caption,
  onShow,
  testID,
}: {
  qrPayload: string;
  caption: string | null;
  onShow: () => void;
  testID: string;
}): React.ReactElement {
  const { width } = useWindowDimensions();
  const size = Math.max(160, Math.min(width - spacing.xxl * 2, 280));
  return (
    <View style={styles.pass} testID={testID}>
      <View accessible accessibilityLabel={VENUE_PASS_QR_LABEL} accessibilityRole="image" style={styles.qr}>
        <QRCode value={qrPayload} size={size} />
      </View>
      {caption !== null ? <Text style={styles.caption}>{caption}</Text> : null}
      <Action label="Show at the door" onPress={onShow} primary testID={`${testID}-door`} />
    </View>
  );
}

function LiveError({ message, onRetry, testID }: { message: string; onRetry: () => void; testID: string }): React.ReactElement {
  return (
    <View style={styles.notice} testID={testID}>
      <Text style={styles.noticeText}>{message}</Text>
      <Action label="Try again" onPress={onRetry} testID={`${testID}-retry`} />
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Booking (a pass)
// ═══════════════════════════════════════════════════════════════════════════

function BookingBody({ item, userId, openDoor }: { item: PurchaseTimelineItem; userId: string; openDoor: boolean }): React.ReactElement {
  const queryClient = useQueryClient();
  const listed = item.raw as VenueBooking;
  const live = useQuery({
    queryKey: purchaseKeys.venueLive(userId, "venue_booking", item.id),
    queryFn: () => getVenueBooking(item.id),
    staleTime: 30_000,
    retry: false,
  });
  const booking = live.data ?? listed;
  const [doorVisible, setDoorVisible] = useState(openDoor);
  const [busy, setBusy] = useState<"cancel_preview" | "cancel" | "change_preview" | "change" | null>(null);
  const [preview, setPreview] = useState<EntryCancelPreview | null>(null);
  const [cancelKey] = useState(() => venueActionKey("cancel"));
  const [changeKey, setChangeKey] = useState(() => venueActionKey("change"));
  const [guests, setGuests] = useState<number | null>(null);
  const [summary, setSummary] = useState<GuestChangeSummary | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: purchaseKeys.all });
  };
  const door = venueBookingDoorPass(booking);
  const when = venueBookingWhenLine(booking);
  const progress = venueBookingProgress(booking);
  const placeLine = venueBookingPlaceLine(booking);
  const payAction = venueBookingPayAction(booking);
  // #4490 W4: "Pay to hold your date" / "Pay the rest" open the native
  // checkout sheet straight at Pay (the server's amounts only).
  const [checkout, setCheckout] = useState<VenueCheckoutOpen | null>(null);
  // #4490 06-W4 fix 1 (W4-N4): back after signing in again as the same
  // account: reopen the Pay sheet this booking had open when the session ended.
  const [resume, setResume] = useState<VenueCheckoutSnapshot | null>(null);
  useEffect(() => {
    const kept = takeVenueCheckout(userId, `pay:${booking.groupId}`);
    if (kept === null) return;
    setResume(kept);
    setCheckout(kept.open);
  }, [booking.groupId, userId]);
  const checkoutKind = (["entry", "group_package", "private_hire", "by_the_hour"] as const).find((k) => k === booking.offerKind) ?? "entry";
  const openPay = (): void => {
    if (payAction === null) return;
    setCheckout({
      from: "purchases",
      kind: checkoutKind,
      booking: {
        id: booking.groupId,
        version: booking.version,
        state: booking.state,
        totalMinor: booking.totalMinor,
        amountDueNowMinor: payAction.amountMinor,
        holdUntil: booking.holdUntil,
      },
      payOptions: payAction.payOptions,
      fullNowReason: payAction.fullNowReason,
      venueId: booking.venue.id ?? "",
      venueName: booking.venue.name,
      currencyCode: booking.currencyCode,
      exponent: booking.exponent,
      timezone: booking.venue.timezone,
    });
  };
  const now = venueBookingGuests(booking);
  const isLive = booking.state === "confirmed" || booking.state === "partially_cancelled";
  const canCancel = isLive || booking.state === "request_pending" || booking.state === "approved_payment_required";
  const canChange =
    booking.state === "confirmed" &&
    booking.canChangeGuests &&
    (booking.guestChangeUntil === null || Date.parse(booking.guestChangeUntil) > Date.now());
  const pass = booking.passes[0];

  const startCancel = async (): Promise<void> => {
    setBusy("cancel_preview");
    setActionError(null);
    try {
      setPreview(await previewVenueCancel(booking.groupId));
    } catch (e) {
      setActionError(venueOfferErrorCopy(errorCode(e)));
    } finally {
      setBusy(null);
    }
  };
  const confirmCancel = async (): Promise<void> => {
    if (preview === null) return;
    setBusy("cancel");
    setActionError(null);
    try {
      await cancelVenueBooking(booking.groupId, preview, cancelKey);
      setPreview(null);
      toastManager.success("Your booking is cancelled.", 3000);
      await refresh();
    } catch (e) {
      setActionError(venueOfferErrorCopy(errorCode(e)));
    } finally {
      setBusy(null);
    }
  };
  const stepGuests = async (next: number): Promise<void> => {
    if (next < 1) return;
    setGuests(next);
    setSummary(null);
    setChangeKey(venueActionKey("change"));
    if (next === now) return;
    setBusy("change_preview");
    setActionError(null);
    try {
      setSummary(await previewVenueGuestChange(booking.groupId, next));
    } catch (e) {
      setActionError(venueOfferErrorCopy(errorCode(e)));
    } finally {
      setBusy(null);
    }
  };
  const applyChange = async (): Promise<void> => {
    if (guests === null || summary === null) return;
    setBusy("change");
    setActionError(null);
    try {
      await changeVenueGuests({
        groupId: booking.groupId,
        guests,
        expectedVersion: summary.groupVersion ?? booking.version,
        idempotencyKey: changeKey,
      });
      setGuests(null);
      setSummary(null);
      toastManager.success("Your booking is updated.", 3000);
      await refresh();
    } catch (e) {
      setActionError(venueOfferErrorCopy(errorCode(e)));
    } finally {
      setBusy(null);
    }
  };

  const messageTarget: CalendarPlanMessageTarget | null =
    booking.venue.brandSlug === null
      ? null
      : {
          brandId: null,
          brandSlug: booking.venue.brandSlug,
          brandName: booking.venue.brandName ?? booking.venue.name,
          // W2-N23: spec 06 §6 "Message {venue}" (button and sheet).
          displayName: booking.venue.name,
          prefill: {
            contextKind: "stay",
            contextId: booking.groupId,
            plan: {
              kind: "stay",
              id: booking.groupId,
              title: booking.offer.name || booking.venue.name,
              startsAt: item.startsAt,
              summary: booking.reference,
              isUpcoming: isLive,
              canCancel: false,
              canCancelUrl: null,
              canRequestRefund: false,
            },
          },
        };

  return (
    <View testID="venue-booking-detail">
      <Text style={styles.eyebrow}>Pass</Text>
      <Text style={styles.title}>{booking.venue.name}</Text>
      {booking.offer.name ? <Text style={styles.subtitle}>{booking.offer.name}</Text> : null}
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{venueBookingStateLabel(booking.state)}</Text>
      </View>

      {live.isLoading ? (
        <View style={styles.notice} testID="venue-booking-pass-loading">
          <ActivityIndicator color={C.accent} />
        </View>
      ) : door !== null ? (
        <PassCard
          qrPayload={door.qrPayload}
          caption={progress}
          onShow={() => setDoorVisible(true)}
          testID="venue-booking-pass"
        />
      ) : live.isError ? (
        <LiveError
          message="We couldn't load your pass. Check your connection and try again."
          onRetry={() => void live.refetch()}
          testID="venue-booking-pass-error"
        />
      ) : null}

      <View style={styles.facts}>
        {when !== null ? <Row label="When" value={when} /> : null}
        <Row label="Guests" value={guestsText(now)} />
        {placeLine !== null ? <Row label="Place" value={placeLine} /> : null}
        {pass?.idCheckLabel ? <Row label="ID" value={pass.idCheckLabel} /> : null}
        {booking.reference ? <Row label="Reference" value={booking.reference} /> : null}
      </View>

      {/* #4490 W7 (d): the weather, the drive and when to leave, for a held booking. */}
      {isLive ? <VenueOnTheDay booking={booking} /> : null}

      {venueBookingExtraRows(booking).length > 0 ? (
        <View style={styles.facts} testID="venue-booking-extras">
          {venueBookingExtraRows(booking).map((r) => (
            <Row key={r.label} label={r.label} value={r.value} />
          ))}
        </View>
      ) : null}
      <View style={styles.facts} testID="venue-booking-money">
        {venueBookingMoneyRows(booking).map((r) => (
          <Row key={r.label} label={r.label} value={r.value} />
        ))}
      </View>
      {payAction !== null ? (
        <Action
          label={`${payAction.label} · ${venueMoneyText(payAction.amountMinor, booking.currencyCode, booking.exponent)}`}
          onPress={openPay}
          primary
          testID="venue-booking-pay"
        />
      ) : null}
      <VenueOfferCheckoutSheet
        open={checkout}
        resume={resume}
        onClose={() => {
          setResume(null);
          setCheckout(null);
          void refresh();
        }}
      />
      {booking.policyText !== null ? <Text style={styles.caption}>{booking.policyText}</Text> : null}

      {actionError !== null ? (
        <Text style={styles.error} accessibilityLiveRegion="polite" testID="venue-booking-error">
          {actionError}
        </Text>
      ) : null}

      {guests !== null ? (
        <View style={styles.panel} testID="venue-booking-change-panel">
          <View style={styles.stepper}>
            <Action
              label="−"
              accessibilityLabel={VENUE_GUEST_STEPPER_LABELS.fewer}
              disabled={!venueGuestsCanDecrease(guests)}
              onPress={() => void stepGuests(guests - 1)}
              testID="venue-booking-guests-minus"
            />
            <Text style={styles.stepValue} accessibilityLiveRegion="polite">
              {guestsText(guests)}
            </Text>
            <Action
              label="+"
              accessibilityLabel={VENUE_GUEST_STEPPER_LABELS.more}
              onPress={() => void stepGuests(guests + 1)}
              testID="venue-booking-guests-plus"
            />
          </View>
          {busy === "change_preview" ? <ActivityIndicator color={C.accent} /> : null}
          {summary !== null ? (
            <Text style={styles.caption}>
              {withKnownCurrencySymbol(
                `${guestChangeWords(summary, booking.exponent).title}. ${guestChangeWords(summary, booking.exponent).body}`,
                summary.currencyCode,
              )}
            </Text>
          ) : null}
          {/* #4490 W4: a change that costs more is applied, then paid with "Pay the rest". */}
          {summary !== null ? (
            <Action label={venueGuestChangeLabel(guests)} onPress={() => void applyChange()} busy={busy === "change"} primary testID="venue-booking-change-apply" />
          ) : null}
          <Action label="Keep my booking" onPress={() => { setGuests(null); setSummary(null); }} testID="venue-booking-change-close" />
        </View>
      ) : null}

      {preview !== null ? (
        <View style={styles.panel} testID="venue-booking-cancel-panel">
          <Text style={styles.caption}>
            {withKnownCurrencySymbol(refundPreviewWords(preview, booking.exponent, booking.venue.name), preview.currencyCode)}
          </Text>
          <Action label="Cancel booking" onPress={() => void confirmCancel()} busy={busy === "cancel"} primary testID="venue-booking-cancel-confirm" />
          <Action label="Keep my booking" onPress={() => setPreview(null)} testID="venue-booking-cancel-keep" />
        </View>
      ) : null}

      <View style={styles.actions}>
        {canChange && guests === null && preview === null ? (
          // "Change" is the guest-count change (spec 06 W2 deviation 7); a
          // change that costs more is paid in the app with "Pay the rest" (W4).
          <Action label="Change" onPress={() => void stepGuests(now)} testID="venue-booking-change" />
        ) : null}
        {canCancel && preview === null && guests === null ? (
          <Action label="Cancel booking" onPress={() => void startCancel()} busy={busy === "cancel_preview"} testID="venue-booking-cancel" />
        ) : null}
        {messageTarget !== null ? <CalendarPlanMessageButton target={messageTarget} testID="venue-booking-message" /> : null}
      </View>

      {door !== null ? (
        <DoorModeModal
          unit="pass"
          visible={doorVisible}
          onClose={() => setDoorVisible(false)}
          source={openDoor ? "push" : "button"}
          title={booking.venue.name}
          subtitle={when ?? booking.offer.name}
          tickets={[doorTicket(door.passId, door.qrPayload, booking.offer.name || "Pass", pass?.holderName ?? null)]}
        />
      ) : null}
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Plan (membership)
// ═══════════════════════════════════════════════════════════════════════════

const MEMBER_DONE: Readonly<Record<VenueMemberAction, string>> = {
  membership_leave: "Done. You're leaving at the end of the paid period.",
  membership_stay: "You're staying on. Your next payment email comes as usual.",
  membership_pause: "Done. Your plan pauses after this period.",
  membership_resume: "You won't pause. Your next payment email comes as usual.",
};

function MembershipBody({ item, userId }: { item: PurchaseTimelineItem; userId: string }): React.ReactElement {
  const queryClient = useQueryClient();
  const listed = item.raw as VenueMember;
  const live = useQuery({
    queryKey: purchaseKeys.venueLive(userId, "venue_membership", item.id),
    queryFn: () => getVenueMember(item.id),
    staleTime: 30_000,
    retry: false,
  });
  const member = live.data ?? listed;
  const [doorVisible, setDoorVisible] = useState(false);
  const [busy, setBusy] = useState<VenueMemberAction | "renew" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const state = venueMemberState(member);
  const code = memberCodeWords(member.memberCode);
  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: purchaseKeys.all });
  };

  const act = (action: VenueMemberAction): void => {
    const run = async (): Promise<void> => {
      setBusy(action);
      setError(null);
      try {
        await actOnVenueMember(member.subscriptionId, action, venueActionKey(action));
        toastManager.success(MEMBER_DONE[action], 3000);
        await refresh();
      } catch (e) {
        setError(venueMemberErrorCopy(errorCode(e)));
      } finally {
        setBusy(null);
      }
    };
    if (action === "membership_leave" || action === "membership_pause") {
      const title = action === "membership_leave" ? (member.status === "pending" ? "Cancel joining" : "Leave") : `Pause after this ${member.period}`;
      Alert.alert(title, state.line, [
        { text: "Keep my membership", style: "cancel" },
        { text: title, style: "destructive", onPress: () => void run() },
      ]);
      return;
    }
    void run();
  };
  const renew = async (): Promise<void> => {
    setBusy("renew");
    setError(null);
    try {
      const url = await openVenueMemberPayment(member.subscriptionId, venueActionKey("renew"));
      await WebBrowser.openBrowserAsync(url);
      await confirmVenueMemberPayment(member.subscriptionId).catch(() => undefined);
      await refresh();
    } catch (e) {
      setError(venueMemberErrorCopy(errorCode(e)));
    } finally {
      setBusy(null);
    }
  };
  const messageTarget: CalendarPlanMessageTarget | null =
    member.venue.brandSlug === null || member.venue.id === null
      ? null
      : {
          brandId: null,
          brandSlug: member.venue.brandSlug,
          brandName: member.venue.brandName ?? member.venue.name,
          displayName: member.venue.name,
          prefill: { contextKind: "venue", contextId: member.venue.id },
        };

  return (
    <View testID="venue-membership-detail">
      <Text style={styles.eyebrow}>Plan</Text>
      <Text style={styles.title}>{member.planName}</Text>
      <Text style={styles.subtitle}>{member.venue.name}</Text>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{state.label}</Text>
      </View>
      <Text style={styles.headline}>{state.title}</Text>
      <Text style={styles.caption}>{state.line}</Text>

      {live.isLoading ? (
        <View style={styles.notice} testID="venue-membership-pass-loading">
          <ActivityIndicator color={C.accent} />
        </View>
      ) : member.pass !== null && member.pass.valid ? (
        <PassCard qrPayload={member.pass.qrPayload} caption={null} onShow={() => setDoorVisible(true)} testID="venue-membership-pass" />
      ) : live.isError ? (
        <LiveError
          message="We couldn't load your member pass. Check your connection and try again."
          onRetry={() => void live.refetch()}
          testID="venue-membership-pass-error"
        />
      ) : null}

      <View style={styles.facts}>
        {code !== null ? <Row label="Member code" value={code} /> : null}
        {member.assignedSpace !== null ? <Row label="Your desk" value={member.assignedSpace} /> : null}
        {member.activeUntil !== null ? <Row label="Paid until" value={memberDay(member.activeUntil, member) ?? ""} /> : null}
        {member.renewsOn !== null && member.leavingOn === null ? <Row label="Renews" value={memberDay(member.renewsOn, member) ?? ""} /> : null}
      </View>

      {error !== null ? (
        <Text style={styles.error} accessibilityLiveRegion="polite" testID="venue-membership-error">
          {error}
        </Text>
      ) : null}

      <View style={styles.actions}>
        {venueMemberCanRenew(member) ? (
          <Action label="Renew" onPress={() => void renew()} busy={busy === "renew"} primary testID="venue-membership-renew" />
        ) : null}
        {member.canStay ? <Action label="Stay on" onPress={() => act("membership_stay")} busy={busy === "membership_stay"} testID="venue-membership-stay" /> : null}
        {member.canResume ? (
          <Action label={member.status === "paused" ? "Start again" : "Don't pause"} onPress={() => act("membership_resume")} busy={busy === "membership_resume"} testID="venue-membership-resume" />
        ) : null}
        {member.canPause ? (
          <Action label={`Pause after this ${member.period}`} onPress={() => act("membership_pause")} busy={busy === "membership_pause"} testID="venue-membership-pause" />
        ) : null}
        {member.canLeave ? (
          <Action label={member.status === "pending" ? "Cancel joining" : "Leave"} onPress={() => act("membership_leave")} busy={busy === "membership_leave"} testID="venue-membership-leave" />
        ) : null}
        {messageTarget !== null ? <CalendarPlanMessageButton target={messageTarget} testID="venue-membership-message" /> : null}
      </View>

      {member.pass !== null && member.pass.valid ? (
        <DoorModeModal
          unit="pass"
          visible={doorVisible}
          onClose={() => setDoorVisible(false)}
          title={member.venue.name}
          subtitle={code !== null ? `${member.planName} · ${code}` : member.planName}
          tickets={[doorTicket(member.subscriptionId, member.pass.qrPayload, member.planName, null)]}
        />
      ) : null}
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Waitlist place
// ═══════════════════════════════════════════════════════════════════════════

function WaitlistBody({ item }: { item: PurchaseTimelineItem }): React.ReactElement {
  const queryClient = useQueryClient();
  const place = item.raw as VenueWaitlistPlace;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = venueWaitlistState(place);
  const leave = (): void => {
    Alert.alert("Leave the waitlist", `${place.venueName} won't contact you about this one.`, [
      { text: "Stay on the waitlist", style: "cancel" },
      {
        text: "Leave the waitlist",
        style: "destructive",
        onPress: () => {
          void (async () => {
            setBusy(true);
            setError(null);
            try {
              await leaveVenueWaitlist(place.id);
              toastManager.success("You left the waitlist.", 3000);
              await queryClient.invalidateQueries({ queryKey: purchaseKeys.all });
            } catch (e) {
              setError(venueMemberErrorCopy(errorCode(e)));
            } finally {
              setBusy(false);
            }
          })();
        },
      },
    ]);
  };
  const messageTarget: CalendarPlanMessageTarget | null =
    place.brandSlug === null || place.venueId === null
      ? null
      : {
          brandId: null,
          brandSlug: place.brandSlug,
          brandName: place.venueName,
          displayName: place.venueName,
          prefill: { contextKind: "venue", contextId: place.venueId },
        };
  const day = place.startsAt !== null ? memberDay(place.startsAt, { period: "month", venue: { id: null, name: place.venueName, slug: null, brandSlug: null, brandName: null, timezone: place.timezone } }) : null;
  return (
    <View testID="venue-waitlist-detail">
      <Text style={styles.eyebrow}>Waitlist</Text>
      <Text style={styles.title}>{place.venueName}</Text>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{state.label}</Text>
      </View>
      <Text style={styles.headline} accessibilityLiveRegion="polite">
        {state.title}
      </Text>
      <Text style={styles.caption}>{state.line}</Text>
      <View style={styles.facts}>
        <Row label="Party" value={`Party of ${place.partySize}`} />
        {day !== null ? <Row label="Day" value={day} /> : null}
        {place.desiredFrom !== null && place.desiredTo !== null ? <Row label="Time" value={`${place.desiredFrom} to ${place.desiredTo}`} /> : null}
      </View>
      {error !== null ? (
        <Text style={styles.error} accessibilityLiveRegion="polite" testID="venue-waitlist-error">
          {error}
        </Text>
      ) : null}
      <View style={styles.actions}>
        {isOpenWaitlistPlace(place.status) ? <Action label="Leave the waitlist" onPress={leave} busy={busy} testID="venue-waitlist-leave" /> : null}
        {messageTarget !== null ? <CalendarPlanMessageButton target={messageTarget} testID="venue-waitlist-message" /> : null}
      </View>
    </View>
  );
}

export function VenuePurchaseDetail({
  item,
  userId,
  openDoor = false,
}: {
  item: PurchaseTimelineItem;
  userId: string;
  openDoor?: boolean;
}): React.ReactElement | null {
  switch (item.kind) {
    case "venue_booking":
      return <BookingBody item={item} userId={userId} openDoor={openDoor} />;
    case "venue_membership":
      return <MembershipBody item={item} userId={userId} />;
    case "venue_waitlist":
      return <WaitlistBody item={item} />;
    default:
      return null;
  }
}

export const isVenuePurchaseKind = (kind: string | null): kind is "venue_booking" | "venue_membership" | "venue_waitlist" =>
  kind === "venue_booking" || kind === "venue_membership" || kind === "venue_waitlist";

const styles = StyleSheet.create({
  eyebrow: { color: C.accent, ...typography.xs, fontWeight: fontWeights.bold, marginTop: spacing.lg },
  title: { color: C.text, ...typography.xxl, fontWeight: fontWeights.bold, marginTop: spacing.xs },
  subtitle: { color: C.textSecondary, ...typography.md, marginTop: spacing.xs },
  headline: { color: C.text, ...typography.lg, fontWeight: fontWeights.bold, marginTop: spacing.md },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: C.accentTint,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginTop: spacing.sm,
  },
  badgeText: { color: C.accent, ...typography.xs, fontWeight: fontWeights.bold },
  pass: {
    alignItems: "center",
    backgroundColor: C.card,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: C.border,
    padding: spacing.md,
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  qr: { backgroundColor: C.text, borderRadius: radius.lg, padding: spacing.md },
  facts: {
    backgroundColor: C.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.md,
  },
  row: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md, paddingVertical: spacing.xs },
  rowLabel: { color: C.textMeta, ...typography.sm, flexShrink: 0 },
  rowValue: { color: C.text, ...typography.sm, fontWeight: fontWeights.semibold, flexShrink: 1, textAlign: "right" },
  caption: { color: C.textSecondary, ...typography.sm, marginTop: spacing.sm },
  error: { color: C.error, ...typography.sm, marginTop: spacing.md },
  notice: {
    alignItems: "center",
    backgroundColor: C.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  noticeText: { color: C.textSecondary, ...typography.sm, textAlign: "center" },
  panel: {
    backgroundColor: C.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: C.borderStrong,
    padding: spacing.md,
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  stepValue: { color: C.text, ...typography.lg, fontWeight: fontWeights.bold },
  actions: { marginTop: spacing.lg, gap: spacing.sm },
  action: {
    minHeight: spacing.xxl - spacing.xs,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: C.borderStrong,
    paddingHorizontal: spacing.md,
  },
  actionPrimary: { backgroundColor: C.accent, borderColor: C.accent },
  actionDisabled: { opacity: 0.4 },
  actionText: { color: C.text, ...typography.sm, fontWeight: fontWeights.bold },
  pressed: { opacity: 0.7 },
});

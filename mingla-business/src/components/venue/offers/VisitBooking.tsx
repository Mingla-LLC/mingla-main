/**
 * #4490 P2 — `/visit/<groupId>`: the guest's booking page and pass.
 *
 * Opened three ways, all without an account:
 *   - back from the secure payment page: `/visit/<id>?paid=1`. The page asks
 *     the server to confirm the payment (`confirm_return`) and polls every 2 s
 *     for 30 s while it is still in flight; after that it says "We're checking
 *     your payment" with Check again (the provider's webhook is the backstop);
 *   - from an email or the venue's pay code: `/visit/<id>#t=<token>`. The token
 *     is kept on this device and scrubbed from the address bar;
 *   - again later on the same device (the token is found here).
 * A wrong or missing token is "We couldn't find this booking", never a hint
 * that the booking exists.
 *
 * States: pay now (on hold until <time>, live countdown; also the gate's pay
 * code), hold ran out, confirming, we're checking your payment, payment failed,
 * the pass (one QR for the party, the day and gate window, the ID line, the
 * receipt line, directions, add to calendar, tell your guests, cancel with the
 * refund in plain words), cancelled (with what comes back).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import {
  createThemePalette,
  resolveTheme,
  type ResolvedTheme,
  type ThemePalette,
} from "@mingla/offering-rendering";
import { boldFontFamily, neutralHair, statusOn } from "@mingla/offering-rendering/themePalette";
import { themeBoldFace } from "@mingla/offering-rendering/themeAccentStyle";
import { formatVenueMoney } from "@mingla/brand-rendering/venueFeaturePage";
import {
  cancelledMoneyLine,
  currencyExponent,
  impliedVatRatePct,
  countdownText,
  entryDateLabel,
  holdSecondsLeft,
  holdUntilText,
  passHeadline,
  passIdLine,
  passWindowLine,
  refundPreviewWords,
  orderLinesByOptions,
  summaryLines,
  venueAddressLine,
  venueOfferErrorCopy,
  visitViewFor,
  type EntryBooking,
  type EntryCancelPreview,
} from "@mingla/brand-rendering/venueOffers/entryModel";

import { radius, size, space, type } from "../../../constants/designSystem";
import { usePublicVenueBySlug } from "../../../hooks/usePublicEvents";
import {
  VenueOfferGuestError,
  venueOfferGuestService,
} from "../../../services/venueOfferGuestService";
import { useThemeFont } from "../../../theme/useThemeFont";
import { openMapsTarget } from "../../../utils/openMapsTarget";
import { addOfferingToCalendar } from "../../../utils/offeringCalendarAction";
import { randomId } from "../../../utils/randomId";
import {
  adoptFragmentToken,
  readVenueOfferBookingToken,
  recallVenueOfferPayUrl,
  rememberVenueOfferPayUrl,
  scrubVisitAddress,
} from "../../../utils/venueOfferBookingTokens";
import { ScrollView } from "../../../wrappers/SmartScrollView";
import { SecurePaymentHandoff } from "../../offering/LazyPublicParts";
import { Icon, type IconName } from "../../ui/Icon";
import {
  EntryButton,
  EntryNote,
  EntryProblem,
  EntrySummaryRows,
  entryStyles,
} from "./EntryUi";
import { VenueOfferPassQr } from "./VenueOfferPassQr";

const POLL_MS = 2000;
const POLL_WINDOW_MS = 30_000;
const WIDE = 1024;

type Load =
  | { status: "loading" }
  | { status: "not_found" }
  | { status: "error"; code: string }
  | { status: "ready"; booking: EntryBooking };

export interface VisitBookingProps {
  groupId: string;
  paidReturn: boolean;
  safeTop: number;
  safeBottom: number;
}

export function VisitBooking({ groupId, paidReturn, safeTop, safeBottom }: VisitBookingProps): React.ReactElement {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [confirm, setConfirm] = useState<"idle" | "polling" | "timed_out" | "failed">(
    paidReturn ? "polling" : "idle",
  );
  const [now, setNow] = useState(() => Date.now());
  const [handoffUrl, setHandoffUrl] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [preview, setPreview] = useState<EntryCancelPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [shared, setShared] = useState<string | null>(null);
  // A payment already opened (the guest stepped back from the payment page).
  const [inFlight, setInFlight] = useState<{ resumeUrl: string | null } | null>(null);

  // ── the token: the fragment first, then this device ────────────────────
  useEffect(() => {
    const fromFragment = adoptFragmentToken(groupId);
    setToken(fromFragment ?? readVenueOfferBookingToken(groupId));
  }, [groupId]);

  const read = useCallback(async (): Promise<void> => {
    if (token === undefined) return;
    try {
      const booking = await venueOfferGuestService.get({ groupId, token });
      setLoad({ status: "ready", booking });
    } catch (caught) {
      const code = caught instanceof VenueOfferGuestError ? caught.code : "offer_request_failed";
      setLoad(
        code === "offer_booking_not_found" || code === "booking_token_required" || code === "invalid_request"
          ? { status: "not_found" }
          : { status: "error", code },
      );
    }
  }, [groupId, token]);

  // ── back from paying: confirm, then poll while it is in flight ──────────
  const startedAt = useRef<number>(Date.now());
  const confirmOnce = useCallback(async (): Promise<"done" | "pending"> => {
    if (token === undefined) return "pending";
    try {
      const result = await venueOfferGuestService.confirmReturn({ groupId, token });
      if (result.booking !== null) setLoad({ status: "ready", booking: result.booking });
      if (result.outcome === "pending") return "pending";
      if (result.outcome === "failed") setConfirm("failed");
      else setConfirm("idle");
      return "done";
    } catch (caught) {
      const code = caught instanceof VenueOfferGuestError ? caught.code : "offer_request_failed";
      if (code === "offer_booking_not_found" || code === "booking_token_required") {
        setLoad({ status: "not_found" });
        setConfirm("idle");
        return "done";
      }
      return "pending";
    }
  }, [groupId, token]);

  useEffect(() => {
    if (token === undefined) return undefined;
    if (!paidReturn) {
      void read();
      return undefined;
    }
    // Drop `?paid=1&reference=…` from the address so a reload or a shared
    // address never looks like a return (confirming twice is harmless anyway).
    scrubVisitAddress({ dropQuery: true });
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    startedAt.current = Date.now();
    const tick = async (): Promise<void> => {
      const outcome = await confirmOnce();
      if (stopped || outcome === "done") return;
      if (Date.now() - startedAt.current >= POLL_WINDOW_MS) {
        setConfirm("timed_out");
        void read();
        return;
      }
      timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, paidReturn]);

  const booking = load.status === "ready" ? load.booking : null;

  // ── theme from the venue ───────────────────────────────────────────────
  const venueQuery = usePublicVenueBySlug(booking?.venue.brandSlug ?? null, booking?.venue.slug ?? null);
  const theme: ResolvedTheme = useMemo(
    () => resolveTheme(venueQuery.data?.theme ?? null, null),
    [venueQuery.data?.theme],
  );
  const palette: ThemePalette = useMemo(() => createThemePalette(theme), [theme]);
  useThemeFont(boldFontFamily(theme));
  const tones = statusOn(palette);
  const hair = neutralHair(palette);
  const exponent = currencyExponent(booking?.currencyCode ?? "NGN");
  const money = (minor: number): string => formatVenueMoney(minor, booking?.currencyCode ?? "NGN", exponent);

  // #4490 H5: the booking lists its lines by when they were written; show them in the
  // offer's own price order, the order checkout showed. Best effort: if the offer
  // cannot be read, the order from the booking stays.
  const [optionOrder, setOptionOrder] = useState<readonly string[]>([]);
  const orderBrandSlug = booking?.venue.brandSlug ?? null;
  const orderVenueSlug = booking?.venue.slug ?? null;
  const orderOfferId = booking?.offer.id ?? null;
  const hasManyLines = (booking?.lines.length ?? 0) > 1;
  useEffect(() => {
    if (!hasManyLines || orderBrandSlug === null || orderVenueSlug === null || orderOfferId === null) return undefined;
    let stopped = false;
    venueOfferGuestService
      .offer({ brandSlug: orderBrandSlug, venueSlug: orderVenueSlug, offeringId: orderOfferId })
      .then(
        (detail) => {
          if (!stopped) setOptionOrder(detail.options.map((o) => o.id));
        },
        () => undefined,
      );
    return () => {
      stopped = true;
    };
  }, [hasManyLines, orderBrandSlug, orderVenueSlug, orderOfferId]);

  const view = booking === null ? null : visitViewFor(booking, now);
  useEffect(() => {
    if (view?.kind !== "pay") return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [view?.kind]);
  // A confirming booking refreshes itself for a short while too.
  useEffect(() => {
    if (view?.kind !== "confirming" || confirm === "polling") return undefined;
    const timer = setTimeout(() => void read(), POLL_MS * 2);
    return () => clearTimeout(timer);
  }, [view?.kind, confirm, read, booking?.version]);

  const venuePath =
    booking?.venue.brandSlug && booking.venue.slug
      ? `/b/${booking.venue.brandSlug}/v/${booking.venue.slug}`
      : null;

  const pay = async (): Promise<void> => {
    if (booking === null || paying) return;
    setPaying(true);
    setActionError(null);
    try {
      const payment = await venueOfferGuestService.pay({
        groupId,
        token: token ?? null,
        expectedVersion: booking.version,
        idempotencyKey: `venue-offer:pay:${randomId()}`,
      });
      rememberVenueOfferPayUrl(groupId, payment.authorizationUrl);
      setInFlight(null);
      setHandoffUrl(payment.authorizationUrl);
    } catch (caught) {
      const code = caught instanceof VenueOfferGuestError ? caught.code : "offer_request_failed";
      if (code === "offer_payment_already_pending") {
        // Only one payment may be open at a time: continue that one, or check it.
        setInFlight({ resumeUrl: recallVenueOfferPayUrl(groupId) });
      } else {
        setActionError(venueOfferErrorCopy(code));
      }
      void read();
    } finally {
      setPaying(false);
    }
  };

  const checkPayment = async (): Promise<void> => {
    if (paying) return;
    setPaying(true);
    setActionError(null);
    try {
      const outcome = await confirmOnce();
      if (outcome === "pending") {
        setActionError("We haven't heard back about that payment yet. If you finished paying, check again in a minute.");
      }
    } finally {
      setPaying(false);
    }
  };

  const askCancel = async (): Promise<void> => {
    if (previewBusy) return;
    setPreviewBusy(true);
    setActionError(null);
    try {
      setPreview(await venueOfferGuestService.cancelPreview({ groupId, token: token ?? null }));
      if (Platform.OS === "web" && typeof document !== "undefined") {
        setTimeout(() => {
          document
            .querySelector('[data-testid="issue-4490-visit-cancel-preview"]')
            ?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 50);
      }
    } catch (caught) {
      setActionError(venueOfferErrorCopy(caught instanceof VenueOfferGuestError ? caught.code : null));
    } finally {
      setPreviewBusy(false);
    }
  };

  const doCancel = async (): Promise<void> => {
    if (preview === null || cancelling) return;
    setCancelling(true);
    setActionError(null);
    try {
      await venueOfferGuestService.cancel({
        groupId,
        token: token ?? null,
        previewIds: preview.previewIds,
        previewHash: preview.previewHash,
        idempotencyKey: `venue-offer:cancel:${randomId()}`,
      });
      setPreview(null);
      await read();
    } catch (caught) {
      const code = caught instanceof VenueOfferGuestError ? caught.code : null;
      setActionError(venueOfferErrorCopy(code));
      if (code === "offer_cancel_preview_invalid") setPreview(null);
    } finally {
      setCancelling(false);
    }
  };

  const tellGuests = async (): Promise<void> => {
    if (booking === null) return;
    const message = `${booking.venue.name}: ${passHeadline(booking)}. Booking ${booking.reference}. We go in together with one pass.`;
    try {
      if (Platform.OS === "web" && typeof navigator !== "undefined") {
        const nav = navigator as Navigator & { share?: (data: { text: string }) => Promise<void> };
        if (typeof nav.share === "function") {
          await nav.share({ text: message });
          return;
        }
        await nav.clipboard?.writeText(message);
        setShared("Copied. Paste it into your group chat.");
        return;
      }
      await Share.share({ message });
    } catch {
      setShared("Couldn't open sharing on this device.");
    }
  };

  const openDirections = (): void => {
    if (booking === null) return;
    const label = [booking.venue.name, venueAddressLine(booking.venue.address, booking.venue.city)].filter(Boolean).join(", ");
    openMapsTarget(
      {
        label,
        geo:
          booking.venue.lat !== null && booking.venue.lng !== null
            ? { lat: booking.venue.lat, lng: booking.venue.lng }
            : null,
      },
      { onUnavailable: () => setShared("We couldn't open maps for this venue.") },
    );
  };

  const addToCalendar = (): void => {
    if (booking === null || booking.window === null) return;
    const startMs = Date.parse(booking.window.startsAt);
    const endMs = Date.parse(booking.window.endsAt);
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) return;
    addOfferingToCalendar(
      {
        title: `${booking.offer.name} at ${booking.venue.name}`,
        startMs,
        endMs,
        location: venueAddressLine(booking.venue.address, booking.venue.city),
        url: null,
        details: `Booking ${booking.reference}. Show your pass at the gate.`,
      },
      `venue-booking-${booking.groupId}`,
    );
  };

  // ── render ───────────────────────────────────────────────────────────────
  const shell = (children: React.ReactNode): React.ReactElement => (
    <View style={[styles.host, { backgroundColor: palette.page }]} testID="issue-4490-visit">
      <ScrollView
        style={styles.host}
        contentContainerStyle={[
          styles.content,
          { paddingTop: safeTop + space[6], paddingBottom: safeBottom + space[8] },
        ]}
      >
        {booking !== null ? (
          <Text style={[styles.eyebrow, { color: palette.tertiaryText }]}>
            {`${booking.venue.name}${booking.reference ? ` · ${booking.reference}` : ""}`.toUpperCase()}
          </Text>
        ) : null}
        {children}
      </ScrollView>
    </View>
  );

  if (load.status === "loading" || token === undefined || (confirm === "polling" && booking === null)) {
    return shell(
      <View style={styles.center} accessibilityLiveRegion="polite" testID="issue-4490-visit-loading">
        <ActivityIndicator color={palette.primaryText} />
        <Text style={[styles.body, { color: palette.secondaryText }]}>
          {paidReturn ? "Confirming your payment…" : "Opening your booking…"}
        </Text>
      </View>,
    );
  }
  if (load.status === "not_found") {
    return shell(
      <View style={styles.hero} testID="issue-4490-visit-not-found">
        <Text style={[styles.title, themeBoldFace(theme), { color: palette.primaryText }]} accessibilityRole="header">
          We couldn&apos;t find this booking
        </Text>
        <Text style={[styles.body, { color: palette.secondaryText }]}>
          The link may be wrong or out of date, or it was opened on a different device. Open it from the link in your
          booking email.
        </Text>
        <EntryButton palette={palette} theme={theme} variant="secondary" label="Try again" onPress={() => void read()} />
      </View>,
    );
  }
  if (load.status === "error" || booking === null || view === null) {
    return shell(
      <EntryProblem
        palette={palette}
        theme={theme}
        title="This booking couldn't load"
        body={venueOfferErrorCopy(load.status === "error" ? load.code : null)}
        actionLabel="Try again"
        onAction={() => void read()}
        testID="issue-4490-visit-error"
      />,
    );
  }

  if (handoffUrl !== null) {
    return shell(
      <SecurePaymentHandoff
        url={handoffUrl}
        palette={palette}
        holdLine={
          booking.holdUntil !== null
            ? `Your places are held until ${holdUntilText(booking.holdUntil, booking.venue.timezone).replace(/^On hold until /, "")}.`
            : null
        }
        onBack={() => setHandoffUrl(null)}
        testID="issue-4490-visit-secure-payment"
      />,
    );
  }

  const summary = (
    <View
      style={[entryStyles.card, { backgroundColor: palette.card, borderColor: palette.panelBorder }]}
      testID="issue-4490-visit-summary"
    >
      <Text style={[styles.cardTitle, themeBoldFace(theme), { color: palette.primaryText }]}>
        {booking.offer.name}
      </Text>
      {booking.window !== null ? (
        <Text style={[styles.small, { color: palette.secondaryText }]}>{entryDateLabel(booking.window.localDate)}</Text>
      ) : null}
      <View style={[styles.rule, { backgroundColor: hair }]} />
      <EntrySummaryRows
        palette={palette}
        theme={theme}
        lines={summaryLines(orderLinesByOptions(booking.lines, optionOrder), {
          currencyCode: booking.currencyCode,
          exponent,
          taxMinor: booking.taxMinor,
          feeMinor: booking.feeMinor,
          totalMinor: booking.totalMinor,
          vatMode: booking.vatMode,
          vatRatePct: impliedVatRatePct(booking),
        })}
      />
      {view.kind === "confirmed" && booking.paidMinor > 0 && booking.guest.email !== null ? (
        <Text style={[styles.small, { color: palette.secondaryText }]} testID="issue-4490-visit-receipt">
          {`Paid · receipt sent to ${booking.guest.email}`}
        </Text>
      ) : view.kind === "confirmed" && booking.paymentCollection === "property" ? (
        <Text style={[styles.small, { color: palette.secondaryText }]}>Paid at the venue</Text>
      ) : null}
    </View>
  );

  const errorNote =
    actionError !== null ? (
      <EntryNote palette={palette} icon="flag" tone="error" testID="issue-4490-visit-action-error">
        {actionError}
      </EntryNote>
    ) : null;

  let main: React.ReactNode;
  switch (view.kind) {
    case "pay": {
      const left = holdSecondsLeft(view.holdUntil, now);
      main = (
        <View style={styles.column} testID="issue-4490-visit-pay">
          <Text style={[styles.title, themeBoldFace(theme), { color: palette.primaryText }]} accessibilityRole="header">
            {confirm === "failed" ? "Your payment didn't go through" : "Pay to confirm"}
          </Text>
          {confirm === "failed" ? (
            <EntryNote palette={palette} icon="flag" tone="error" testID="issue-4490-visit-payment-failed">
              Nothing was taken. Your places are still held, so you can try again.
            </EntryNote>
          ) : null}
          <EntryNote palette={palette} icon="clock" tone="warning" testID="issue-4490-visit-hold">
            <Text style={[styles.small, { color: tones.warning.text }]}>
              <Text style={themeBoldFace(theme)}>{holdUntilText(view.holdUntil as string, booking.venue.timezone)}</Text>
              {` · ${countdownText(left)}. Pay before then to keep your places.`}
            </Text>
          </EntryNote>
          {errorNote}
          {inFlight !== null ? (
            <View style={styles.column} testID="issue-4490-visit-in-flight">
              <EntryNote palette={palette} icon="clock" testID="issue-4490-visit-in-flight-note">
                {inFlight.resumeUrl !== null
                  ? "You've already started paying for this booking. Carry on with that payment, or check whether it went through."
                  : "A payment for this booking was started somewhere else. If you finished it, check now; your places stay held until the time above."}
              </EntryNote>
              {inFlight.resumeUrl !== null ? (
                <EntryButton
                  palette={palette}
                  theme={theme}
                  label="Continue your payment"
                  onPress={() => setHandoffUrl(inFlight.resumeUrl)}
                  testID="issue-4490-visit-resume-payment"
                />
              ) : null}
              <EntryButton
                palette={palette}
                theme={theme}
                variant="secondary"
                label="I've paid: check now"
                onPress={() => void checkPayment()}
                busy={paying}
                testID="issue-4490-visit-check-payment"
              />
            </View>
          ) : (
            <EntryButton
              palette={palette}
              theme={theme}
              label={paying ? "Opening payment…" : `Pay ${money(view.amountMinor)}`}
              onPress={() => void pay()}
              busy={paying}
              testID="issue-4490-visit-pay-button"
            />
          )}
          <Text style={[styles.caption, { color: palette.tertiaryText }]}>
            Card, bank transfer or USSD on the secure payment page.
          </Text>
        </View>
      );
      break;
    }
    case "hold_expired":
      main = (
        <View style={styles.column} testID="issue-4490-visit-hold-expired">
          <Text style={[styles.title, themeBoldFace(theme), { color: palette.primaryText }]} accessibilityRole="header">
            Your hold ran out
          </Text>
          <Text style={[styles.body, { color: palette.secondaryText }]}>
            Nothing was charged, and the places went back on sale. You can start again in a minute.
          </Text>
          {venuePath !== null ? (
            <EntryButton
              palette={palette}
              theme={theme}
              label="Start again"
              onPress={() => router.replace(`${venuePath}?tab=entry` as never)}
            />
          ) : null}
        </View>
      );
      break;
    case "confirming":
      main = (
        <View style={styles.center} testID="issue-4490-visit-confirming" accessibilityLiveRegion="polite">
          <ActivityIndicator color={palette.primaryText} />
          <Text style={[styles.title, themeBoldFace(theme), { color: palette.primaryText }]}>Confirming your payment</Text>
          <Text style={[styles.body, { color: palette.secondaryText }]}>This usually takes a few seconds.</Text>
        </View>
      );
      break;
    case "checking":
      main = (
        <View style={styles.column} testID="issue-4490-visit-checking">
          <Text style={[styles.title, themeBoldFace(theme), { color: palette.primaryText }]} accessibilityRole="header">
            We&apos;re checking your payment
          </Text>
          <Text style={[styles.body, { color: palette.secondaryText }]}>
            Your payment needs a quick check before your pass is ready. We&apos;ll email you as soon as it&apos;s done.
            If money left your account and the booking isn&apos;t confirmed, it comes back to you.
          </Text>
          <EntryButton palette={palette} theme={theme} variant="secondary" label="Check again" onPress={() => void read()} />
        </View>
      );
      break;
    case "confirmed": {
      const pass = booking.passes.find((p) => p.status === "valid") ?? booking.passes[0];
      const windowLine = passWindowLine(booking);
      const idLine = passIdLine(pass);
      const allIn = pass !== undefined && pass.admittedCount >= pass.admits && pass.admits > 0;
      main = (
        <View style={styles.column} testID="issue-4490-visit-pass">
          <Text style={[styles.title, themeBoldFace(theme), { color: palette.primaryText }]} accessibilityRole="header">
            You&apos;re in
          </Text>
          <View
            style={[entryStyles.card, styles.passCard, { backgroundColor: palette.card, borderColor: palette.panelBorder }]}
          >
            {pass?.qrPayload ? (
              <VenueOfferPassQr payload={pass.qrPayload} size={wide ? 200 : 220} testID="issue-4490-visit-qr" />
            ) : (
              <Text style={[styles.small, { color: palette.secondaryText }]}>
                Your pass code is being prepared. Reload in a moment.
              </Text>
            )}
            <Text style={[styles.cardTitle, themeBoldFace(theme), { color: palette.primaryText }]}>
              {passHeadline(booking)}
            </Text>
            {windowLine !== null ? (
              <Text style={[styles.small, styles.centerText, { color: palette.secondaryText }]}>{windowLine}</Text>
            ) : null}
            {allIn ? (
              <Text style={[styles.small, { color: tones.success.text }]}>Everyone on this pass is checked in.</Text>
            ) : null}
          </View>
          {idLine !== null ? (
            <EntryNote palette={palette} icon="shield" testID="issue-4490-visit-id">
              {idLine}
            </EntryNote>
          ) : null}
          <View
            style={[entryStyles.card, styles.actions, { backgroundColor: palette.card, borderColor: palette.panelBorder }]}
          >
            <ActionRow palette={palette} icon="location" label="Get directions" detail={booking.venue.city} onPress={openDirections} testID="issue-4490-visit-directions" />
            {booking.window !== null ? (
              <ActionRow palette={palette} icon="calendarPlus" label="Add to calendar" detail={null} onPress={addToCalendar} testID="issue-4490-visit-calendar" />
            ) : null}
            <ActionRow palette={palette} icon="share" label="Tell your guests" detail="One pass for everyone" onPress={() => void tellGuests()} testID="issue-4490-visit-share" />
            {booking.paymentCollection === "mingla" && !allIn ? (
              <ActionRow
                palette={palette}
                icon="refund"
                label="Cancel booking"
                detail={previewBusy ? "Checking…" : "See what comes back first"}
                onPress={() => void askCancel()}
                testID="issue-4490-visit-cancel"
              />
            ) : null}
          </View>
          {shared !== null ? <Text style={[styles.caption, { color: palette.secondaryText }]}>{shared}</Text> : null}
          {preview !== null ? (
            <View
              style={[entryStyles.card, { backgroundColor: palette.card, borderColor: tones.warning.line }]}
              testID="issue-4490-visit-cancel-preview"
            >
              <Text style={[styles.cardTitle, themeBoldFace(theme), { color: palette.primaryText }]}>
                Cancel this booking?
              </Text>
              <Text style={[styles.body, { color: palette.secondaryText }]} testID="issue-4490-visit-cancel-words">
                {refundPreviewWords(preview, exponent, booking.venue.name)}
              </Text>
              {booking.policyText !== null ? (
                <Text style={[styles.caption, styles.leftText, { color: palette.tertiaryText }]}>
                  {`The terms you agreed: ${booking.policyText}`}
                </Text>
              ) : null}
              <EntryButton
                palette={palette}
                theme={theme}
                label={preview.refundMinor > 0 ? `Cancel and get ${money(preview.refundMinor)} back` : "Cancel booking"}
                onPress={() => void doCancel()}
                busy={cancelling}
                testID="issue-4490-visit-cancel-confirm"
              />
              <EntryButton
                palette={palette}
                theme={theme}
                variant="secondary"
                label="Keep my booking"
                onPress={() => setPreview(null)}
                disabled={cancelling}
                testID="issue-4490-visit-cancel-keep"
              />
            </View>
          ) : null}
          {errorNote}
        </View>
      );
      break;
    }
    case "cancelled":
      main = (
        <View style={styles.column} testID="issue-4490-visit-cancelled">
          <Text style={[styles.title, themeBoldFace(theme), { color: palette.primaryText }]} accessibilityRole="header">
            {view.partial ? "Part of this booking was cancelled" : "Booking cancelled"}
          </Text>
          <EntryNote palette={palette} icon="refund" testID="issue-4490-visit-cancelled-money">
            {cancelledMoneyLine(booking, exponent)}
          </EntryNote>
          {venuePath !== null ? (
            <EntryButton
              palette={palette}
              theme={theme}
              variant="secondary"
              label={`Book ${booking.venue.name} again`}
              onPress={() => router.push(`${venuePath}?tab=entry` as never)}
            />
          ) : null}
        </View>
      );
      break;
    default:
      main = (
        <View style={styles.column}>
          <Text style={[styles.title, themeBoldFace(theme), { color: palette.primaryText }]}>
            We&apos;re updating this booking
          </Text>
          <EntryButton palette={palette} theme={theme} variant="secondary" label="Check again" onPress={() => void read()} />
        </View>
      );
  }

  if (confirm === "timed_out" && view.kind !== "confirmed" && view.kind !== "cancelled") {
    main = (
      <View style={styles.column} testID="issue-4490-visit-still-checking">
        <Text style={[styles.title, themeBoldFace(theme), { color: palette.primaryText }]} accessibilityRole="header">
          We&apos;re checking your payment
        </Text>
        <Text style={[styles.body, { color: palette.secondaryText }]}>
          Your bank hasn&apos;t told us yet. This page updates when you check again, and we&apos;ll email you once
          it&apos;s confirmed. Please don&apos;t pay twice.
        </Text>
        <EntryButton
          palette={palette}
          theme={theme}
          variant="secondary"
          label="Check again"
          onPress={() => {
            setConfirm("polling");
            startedAt.current = Date.now() - POLL_WINDOW_MS + POLL_MS * 3;
            void confirmOnce().then((outcome) => {
              if (outcome === "pending") setConfirm("timed_out");
            });
          }}
          testID="issue-4490-visit-check-again"
        />
      </View>
    );
  }

  return shell(
    wide ? (
      <View style={styles.twoCol}>
        <View style={styles.leftCol}>{main}</View>
        <View style={styles.rightCol}>{summary}</View>
      </View>
    ) : (
      <View style={styles.column}>
        {main}
        {summary}
      </View>
    ),
  );
}

function ActionRow({
  palette,
  icon,
  label,
  detail,
  onPress,
  testID,
}: {
  palette: ThemePalette;
  icon: IconName;
  label: string;
  detail: string | null;
  onPress: () => void;
  testID?: string;
}): React.ReactElement {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={detail !== null ? `${label}, ${detail}` : label}
      style={({ pressed }) => [styles.actionRow, pressed ? styles.pressed : null]}
      testID={testID}
    >
      <Icon name={icon} size={20} color={palette.primaryText} />
      <Text style={[styles.actionLabel, { color: palette.primaryText }]}>{label}</Text>
      {detail !== null ? <Text style={[styles.caption, { color: palette.secondaryText }]}>{detail}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1 },
  content: { width: "100%", maxWidth: 1040, alignSelf: "center", paddingHorizontal: space[4], gap: space[4] },
  eyebrow: { ...type.label },
  center: { alignItems: "center", gap: space[3], paddingVertical: space[8] },
  hero: { gap: space[3], paddingVertical: space[6] },
  title: { ...type.title },
  body: { ...type.body },
  small: { ...type.small },
  caption: { ...type.caption, textAlign: "center" },
  leftText: { textAlign: "left" },
  centerText: { textAlign: "center" },
  cardTitle: { ...type.h1, textAlign: "center" },
  column: { gap: space[4] },
  twoCol: { flexDirection: "row", alignItems: "flex-start", gap: space[6] },
  leftCol: { flex: 1, minWidth: 0 },
  rightCol: { width: 380 },
  rule: { height: StyleSheet.hairlineWidth },
  passCard: { alignItems: "center", paddingVertical: space[6] },
  actions: { gap: 0, paddingVertical: space[2] },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    minHeight: size.btn.lg,
    borderRadius: radius.sm,
  },
  actionLabel: { ...type.row, flex: 1 },
  pressed: { opacity: 0.8 },
});

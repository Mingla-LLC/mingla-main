/**
 * #4490 P2 — checkout for entry: day and guests (same picker as the venue
 * page), the server's total with VAT per the venue's mode, the ID reminder,
 * the refund terms, the guest's details (name, email, phone with a country
 * picker), then hold and pay.
 *
 * Buying never needs an account (no `useAuth` anywhere). Pressing Pay first
 * asks for a fresh quote, then holds the places ("On hold until 20:41" with a
 * live countdown), keeps the booking token on this device, and opens the
 * secure payment page in this tab. The payment page only ever sees
 * `/visit/<groupId>?paid=1` as its return address: the token stays here.
 *
 * Layout: two columns from 1024 px (form left, a 380 px summary right); one
 * column with the pay button pinned at the bottom below that.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";
import { useRouter } from "expo-router";
import {
  createThemePalette,
  resolveTheme,
  type ResolvedTheme,
  type ThemePalette,
} from "@mingla/offering-rendering";
import { neutralHair, statusOn } from "@mingla/offering-rendering/themePalette";
import { themeBoldFace } from "@mingla/offering-rendering/themeAccentStyle";
import { OfferingGlassBar } from "@mingla/offering-rendering/OfferingGlassBar";
import { formatVenueMoney } from "@mingla/brand-rendering/venueMoney";
import {
  bookingVat,
  countdownText,
  entryDateLabel,
  holdSecondsLeft,
  holdUntilText,
  idCheckNote,
  orderLinesByOptions,
  summaryLines,
  venueAddressLine,
  venueOfferErrorCopy,
  windowText,
  type EntryBooking,
} from "@mingla/brand-rendering/venueOffers/entryModel";

import { color, radius, size, space, type } from "../../../constants/designSystem";
import { usePublicVenueBySlug } from "../../../hooks/usePublicEvents";
import {
  VenueOfferGuestError,
  venueOfferGuestService,
} from "../../../services/venueOfferGuestService";
import { useThemeFont } from "../../../theme/useThemeFont";
import { randomId } from "../../../utils/randomId";
import {
  readVenueOfferBookingToken,
  recallLastHold,
  rememberLastHold,
  rememberVenueOfferPayUrl,
  saveVenueOfferBookingToken,
  venueOfferCartKey,
} from "../../../utils/venueOfferBookingTokens";
import { ScrollView } from "../../../wrappers/SmartScrollView";
import { SecurePaymentHandoff } from "../../offering/LazyPublicParts";
import { Icon } from "../../ui/Icon";
import { boldFontFamily } from "@mingla/offering-rendering/themePalette";
import { EntryPicker } from "./EntryPicker";
import {
  EntryButton,
  EntryNote,
  EntryProblem,
  EntrySectionLabel,
  EntrySummaryRows,
  entryStyles,
} from "./EntryUi";
import { useEntrySelection } from "./useEntrySelection";
import { GuestDetailsCard, useGuestDetails } from "./GuestDetails";
import { useMemberPrefill } from "./useMemberPrefill";
import { memberGuestErrorCopy, memberUseLine, readVenueMember } from "./memberGuestModel";
import { revealFocusedField } from "./revealFocusedField";

const WIDE = 1024;
const BAR_CLEARANCE = 68 + space[6];

export interface OfferCheckoutProps {
  brandSlug: string;
  venueSlug: string;
  offerId: string;
  initialDate: string | null;
  /** #4490 fix 2 (N85) — the timed session picked on the venue page. */
  initialWindowId?: string | null;
  initialCounts: Record<string, number>;
  safeTop: number;
  safeBottom: number;
}

interface HeldBooking {
  booking: EntryBooking;
  token: string | null;
}

export function OfferCheckout(props: OfferCheckoutProps): React.ReactElement {
  const { brandSlug, venueSlug, offerId } = props;
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  const venueQuery = usePublicVenueBySlug(brandSlug, venueSlug);
  const venue = venueQuery.data ?? null;
  const theme: ResolvedTheme = useMemo(() => resolveTheme(venue?.theme ?? null, null), [venue?.theme]);
  const palette: ThemePalette = useMemo(() => createThemePalette(theme), [theme]);
  useThemeFont(boldFontFamily(theme));
  const hair = neutralHair(palette);
  const tones = statusOn(palette);

  const [cartKey] = useState(venueOfferCartKey);
  // #4490 P6 — a member on this device (opened their member page here) gets their price.
  const [member, setMember] = useState<{ subscriptionId: string; token: string } | null>(null);
  const [useMember, setUseMember] = useState(true);
  useEffect(() => {
    setMember(readVenueMember(brandSlug, venueSlug));
  }, [brandSlug, venueSlug]);
  const [memberNote, setMemberNote] = useState<string | null>(null);
  const selection = useEntrySelection({
    brandSlug,
    venueSlug,
    offeringId: offerId,
    cartKey,
    membership: member !== null && useMember ? member : null,
    initialDate: props.initialDate,
    initialWindowId: props.initialWindowId ?? null,
    initialCounts: props.initialCounts,
  });
  const offer = selection.offer;
  const money = (minor: number): string =>
    formatVenueMoney(minor, offer?.currencyCode ?? "NGN", offer?.exponent ?? 2);

  // ── your details (shared with the group package checkout) ─────────────
  const details = useGuestDetails({ countryCode: offer?.venue.countryCode ?? null, currencyCode: offer?.currencyCode ?? null });
  // #4490 fix 3 (N87) — a member starts with their own name and email.
  useMemberPrefill(member, details);
  const { nameOk, emailOk, phoneOk } = details;
  const [focused, setFocused] = useState(false);

  // ── hold, countdown, pay ──────────────────────────────────────────────
  const [held, setHeld] = useState<HeldBooking | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState<{ code: string; remaining: number | null } | null>(null);
  const [handoffUrl, setHandoffUrl] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (held === null) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [held]);
  // A hold this tab made earlier (the guest stepped back from the payment
  // page): offer to carry on with it instead of holding twice.
  const [earlierHold, setEarlierHold] = useState<EntryBooking | null>(null);
  useEffect(() => {
    const groupId = recallLastHold(offerId);
    if (groupId === null) return;
    let live = true;
    venueOfferGuestService
      .get({ groupId, token: readVenueOfferBookingToken(groupId) })
      .then((booking) => {
        if (
          live &&
          booking.state === "instant_payment_pending" &&
          holdSecondsLeft(booking.holdUntil, Date.now()) > 0
        ) {
          setEarlierHold(booking);
        }
      })
      .catch(() => undefined); // nothing to offer: checkout starts fresh
    return () => {
      live = false;
    };
  }, [offerId]);
  const secondsLeft = held === null ? 0 : holdSecondsLeft(held.booking.holdUntil, now);
  const holdLive = held !== null && secondsLeft > 0;

  // A membership that can't price this (ended, lapsed, another venue) falls back to the usual price.
  const memberQuoteError =
    member !== null && useMember && selection.quote.status === "error" && /^member/.test(selection.quote.code) ? selection.quote.code : null;
  useEffect(() => {
    if (memberQuoteError === null) return;
    setMemberNote(memberGuestErrorCopy(memberQuoteError));
    setUseMember(false);
  }, [memberQuoteError]);
  const quote = selection.quote.status === "ready" ? selection.quote.quote : null;
  const totalMinor = holdLive ? held.booking.amountDueNowMinor || held.booking.totalMinor : quote?.totalMinor ?? null;
  const totalText = totalMinor === null ? null : money(totalMinor);

  const blocker: string | null = holdLive
    ? null
    : selection.problem ??
      (selection.quote.status === "loading" || selection.quote.status === "idle"
        ? "Working out your total…"
        : selection.quote.status === "error"
          ? venueOfferErrorCopy(selection.quote.code, selection.quote.remaining)
          : !nameOk
            ? "Add your name."
            : !emailOk
              ? "Add a valid email. Your pass is sent there."
              : !phoneOk
                ? "Check the phone number, or leave it empty."
                : null);

  const payLabel = busy ? "Opening payment…" : totalMinor === 0 ? "Get my pass" : totalText !== null ? `Pay ${totalText}` : "Pay";

  const pay = async (): Promise<void> => {
    if (busy) return;
    details.setTouched({ name: true, email: true, phone: true });
    if (blocker !== null) return;
    setBusy(true);
    setErrorCode(null);
    try {
      let current = holdLive ? held : null;
      if (current === null) {
        const fresh = await selection.refreshQuote();
        if (fresh === null) {
          setBusy(false);
          return;
        }
        const result = await venueOfferGuestService.hold({
          quoteId: fresh.quoteId,
          guest: details.guest(),
          cartKey,
          idempotencyKey: `venue-offer:hold:${randomId()}`,
        });
        if (result.bookingToken !== null) {
          saveVenueOfferBookingToken(result.booking.groupId, result.bookingToken);
        }
        rememberLastHold(offerId, result.booking.groupId);
        current = { booking: result.booking, token: result.bookingToken };
        setHeld(current);
        // #4490 P6 — a member's booking that owes nothing is confirmed at once.
        if (result.booking.state === "confirmed" || result.booking.totalMinor === 0) {
          router.replace(`/visit/${result.booking.groupId}` as never);
          return;
        }
      }
      const payment = await venueOfferGuestService.pay({
        groupId: current.booking.groupId,
        token: current.token,
        expectedVersion: current.booking.version,
        idempotencyKey: `venue-offer:pay:${randomId()}`,
      });
      rememberVenueOfferPayUrl(current.booking.groupId, payment.authorizationUrl);
      setHandoffUrl(payment.authorizationUrl);
    } catch (caught) {
      const error =
        caught instanceof VenueOfferGuestError ? caught : new VenueOfferGuestError("offer_request_failed", null);
      if (error.code === "offer_guest_invalid" || error.code === "offer_payment_details_rejected") {
        details.setEmailServerInvalid(true);
      }
      if (error.code === "offer_payment_already_pending" && held !== null) {
        router.replace(`/visit/${held.booking.groupId}` as never);
        return;
      }
      if (error.code === "offer_hold_expired") setHeld(null);
      setErrorCode({ code: error.code, remaining: error.remaining });
    } finally {
      setBusy(false);
    }
  };

  const goBack = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace(`/b/${brandSlug}/v/${venueSlug}?tab=entry` as never);
  };

  const onFieldFocus = (): void => {
    setFocused(true);
    revealFocusedField();
  };

  // ── states ────────────────────────────────────────────────────────────
  if (handoffUrl !== null && held !== null) {
    return (
      <View style={[styles.host, { backgroundColor: palette.page, paddingTop: props.safeTop + space[6] }]}>
        <View style={styles.handoff}>
          <SecurePaymentHandoff
            url={handoffUrl}
            palette={palette}
            holdLine={
              held.booking.holdUntil !== null
                ? `Your places are held until ${holdUntilText(held.booking.holdUntil, offer?.venue.timezone ?? null).replace(/^On hold until /, "")}.`
                : null
            }
            onBack={() => setHandoffUrl(null)}
            testID="issue-4490-checkout-secure-payment"
          />
        </View>
      </View>
    );
  }

  const venueName = offer?.venue.name || venue?.name || "";
  const tile = selection.selectedTile;
  const summaryCard = (
    <View
      style={[entryStyles.card, { backgroundColor: palette.card, borderColor: palette.panelBorder }]}
      testID="issue-4490-checkout-summary"
    >
      <Text style={[styles.venueName, themeBoldFace(theme), { color: palette.primaryText }]}>{venueName}</Text>
      {offer?.venue.address ? (
        <Text style={[styles.small, { color: palette.secondaryText }]}>
          {venueAddressLine(offer.venue.address, offer.venue.city)}
        </Text>
      ) : null}
      {offer !== null ? (
        <Text style={[styles.small, { color: palette.secondaryText }]}>
          {holdLive && held.booking.window !== null
            ? `${offer.name} · ${entryDateLabel(held.booking.window.localDate)} · ${windowText(held.booking.window, offer.venue.timezone) ?? ""}`
            : tile !== null
              ? `${offer.name} · ${entryDateLabel(tile.date)}${tile.row !== null ? ` · ${windowText(tile.row, offer.venue.timezone) ?? ""}` : ""}`
              : offer.name}
        </Text>
      ) : null}
      <View style={[styles.rule, { backgroundColor: hair }]} />
      {holdLive ? (
        <EntrySummaryRows
          palette={palette}
          theme={theme}
          lines={summaryLines(orderLinesByOptions(held.booking.lines, offer?.options.map((o) => o.id) ?? []), {
            currencyCode: held.booking.currencyCode,
            exponent: offer?.exponent ?? 2,
            taxMinor: bookingVat(held.booking, offer?.vat?.ratePct ?? null).taxMinor,
            feeMinor: held.booking.feeMinor,
            totalMinor: held.booking.totalMinor,
            vatMode: held.booking.vatMode,
            vatRatePct: offer?.vat?.ratePct ?? 0,
          })}
          testID="issue-4490-checkout-summary-held"
        />
      ) : quote !== null ? (
        <EntrySummaryRows
          palette={palette}
          theme={theme}
          lines={summaryLines(quote.lines, {
            currencyCode: quote.currencyCode,
            exponent: offer?.exponent ?? 2,
            taxMinor: quote.taxMinor,
            feeMinor: quote.feeMinor,
            totalMinor: quote.totalMinor,
            vatMode: quote.vatMode,
            vatRatePct: quote.vatRatePct,
          })}
          testID="issue-4490-checkout-summary-lines"
        />
      ) : (
        <Text style={[styles.small, { color: palette.secondaryText }]}>
          {selection.problem ?? "Working out your total…"}
        </Text>
      )}
      {(() => {
        const note = idCheckNote(selection.optionRows, selection.counts);
        return note !== null ? (
          <EntryNote palette={palette} icon="shield" testID="issue-4490-checkout-id-note">
            {note}
          </EntryNote>
        ) : null;
      })()}
    </View>
  );

  const holdBanner = holdLive ? (
    <EntryNote palette={palette} icon="clock" tone="warning" testID="issue-4490-checkout-hold">
      <Text style={[styles.small, { color: tones.warning.text }]}>
        <Text style={themeBoldFace(theme)}>
          {holdUntilText(held.booking.holdUntil as string, offer?.venue.timezone ?? null)}
        </Text>
        {` · ${countdownText(secondsLeft)}. Pay before then to keep your places.`}
      </Text>
    </EntryNote>
  ) : held !== null ? (
    <EntryNote palette={palette} icon="clock" tone="error" testID="issue-4490-checkout-hold-expired">
      Your hold ran out and the places went back on sale. Pay again to hold them afresh.
    </EntryNote>
  ) : null;

  const detailsCard = (
    <GuestDetailsCard
      details={details}
      palette={palette}
      theme={theme}
      disabled={holdLive || busy}
      onFieldFocus={onFieldFocus}
      onFieldBlur={() => setFocused(false)}
    />
  );

  const errorBlock =
    errorCode !== null ? (
      <EntryNote palette={palette} icon="flag" tone="error" testID="issue-4490-checkout-error">
        {venueOfferErrorCopy(errorCode.code, errorCode.remaining)}
      </EntryNote>
    ) : null;

  const payBlock = (
    <View style={styles.payBlock}>
      <EntryButton
        palette={palette}
        theme={theme}
        label={payLabel}
        onPress={() => void pay()}
        disabled={blocker !== null}
        busy={busy}
        accessibilityLabel={totalText !== null ? `Pay ${totalText}` : "Pay"}
        testID="issue-4490-checkout-pay"
      />
      <Text
        style={[styles.caption, { color: blocker !== null ? palette.secondaryText : palette.tertiaryText }]}
        testID="issue-4490-checkout-pay-reason"
      >
        {blocker ??
          "Card, bank transfer or USSD on the secure payment page. Your places are held while you pay."}
      </Text>
    </View>
  );

  const payCaption = (
    <Text
      style={[styles.caption, { color: blocker !== null ? palette.secondaryText : palette.tertiaryText }]}
      testID="issue-4490-checkout-pay-reason"
    >
      {blocker ??
        "Card, bank transfer or USSD on the secure payment page. Your places are held while you pay."}
    </Text>
  );

  const changeHeld =
    held !== null ? (
      <Pressable
        onPress={() => {
          setHeld(null);
          setErrorCode(null);
        }}
        accessibilityRole="button"
        hitSlop={8}
        testID="issue-4490-checkout-change"
      >
        <Text style={[styles.small, { color: palette.accent }]}>
          Change the day or guests (your current hold simply lapses)
        </Text>
      </Pressable>
    ) : null;

  const earlierHoldNote =
    earlierHold !== null && held === null ? (
      <EntryNote palette={palette} icon="clock" tone="warning" testID="issue-4490-checkout-earlier-hold">
        <View style={styles.payBlock}>
          <Text style={[styles.small, { color: tones.warning.text }]}>
            {`You already have places on hold${
              earlierHold.window !== null ? ` for ${entryDateLabel(earlierHold.window.localDate)}` : ""
            } (${holdUntilText(earlierHold.holdUntil as string, offer?.venue.timezone ?? null).replace(/^On hold/, "held")}). Carry on with that booking, or choose again below.`}
          </Text>
          <EntryButton
            palette={palette}
            theme={theme}
            variant="secondary"
            label="Continue that booking"
            onPress={() => router.push(`/visit/${earlierHold.groupId}` as never)}
            testID="issue-4490-checkout-continue-hold"
          />
        </View>
      </EntryNote>
    ) : null;

  const left = (
    <View style={styles.column}>
      {earlierHoldNote}
      {holdBanner}
      {held === null || !holdLive ? (
        <View
          style={[entryStyles.card, { backgroundColor: palette.card, borderColor: palette.panelBorder }]}
        >
          <EntryPicker
            selection={selection}
            palette={palette}
            theme={theme}
            showSummary={!wide}
            testID="issue-4490-checkout-picker"
          />
        </View>
      ) : (
        changeHeld
      )}
      {member !== null && !holdLive ? (
        <Pressable
          onPress={() => setUseMember((v) => !v)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: useMember }}
          accessibilityLabel="I'm a member"
          style={[entryStyles.card, styles.memberChoice, { backgroundColor: palette.card, borderColor: useMember ? palette.primaryText : palette.panelBorder }]}
          testID="issue-4490-checkout-member"
        >
          <Icon name={useMember ? "check" : "star"} size={20} color={palette.primaryText} />
          <View style={styles.memberText}>
            <Text style={[styles.memberTitle, themeBoldFace(theme), { color: palette.primaryText }]}>I&apos;m a member</Text>
            <Text style={[styles.small, { color: palette.secondaryText }]}>
              {!useMember
                ? memberNote ?? "Tap to use your plan: free entry and guest passes."
                : selection.member !== null
                  ? memberUseLine(selection.member, money) ?? "Your plan's price."
                  : selection.quote.status === "error"
                    ? memberGuestErrorCopy(selection.quote.code)
                    : "Checking your plan…"}
            </Text>
          </View>
        </Pressable>
      ) : null}
      {detailsCard}
      {errorBlock}
      {wide ? payBlock : null}
    </View>
  );

  if (selection.offerState === "error") {
    return (
      <View style={[styles.host, styles.centered, { backgroundColor: palette.page }]}>
        <View style={styles.narrow}>
          <EntryProblem
            palette={palette}
            theme={theme}
            title={selection.offerError === "offer_not_found" ? "This isn't on sale" : "We couldn't load checkout"}
            body={venueOfferErrorCopy(selection.offerError)}
            actionLabel={selection.offerError === "offer_not_found" ? "Back to the venue" : "Try again"}
            onAction={
              selection.offerError === "offer_not_found"
                ? () => router.replace(`/b/${brandSlug}/v/${venueSlug}` as never)
                : selection.retryOffer
            }
            testID="issue-4490-checkout-offer-error"
          />
        </View>
      </View>
    );
  }

  const showBar = !wide && !focused;
  return (
    <View style={[styles.host, { backgroundColor: palette.page }]} testID="issue-4490-checkout">
      <ScrollView
        style={styles.host}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: props.safeTop + space[5],
            paddingBottom: props.safeBottom + (showBar ? BAR_CLEARANCE + space[6] : space[8]),
          },
        ]}
      >
        <View style={styles.backRow}>
          <Pressable
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel="Back to the venue"
            hitSlop={10}
            style={[styles.backButton, { backgroundColor: palette.card, borderColor: palette.panelBorder }]}
            testID="issue-4490-checkout-back"
          >
            <Icon name="chevL" size={20} color={palette.primaryText} />
          </Pressable>
          <Text
            accessibilityRole="header"
            style={[styles.title, themeBoldFace(theme), { color: palette.primaryText }]}
          >
            Checkout
          </Text>
        </View>
        {wide ? (
          <View style={styles.twoCol}>
            <View style={styles.leftCol}>{left}</View>
            {/* #4490 N30: the summary stays in view beside the form. */}
            <View style={[styles.rightCol, Platform.OS === "web" ? (STICKY_SUMMARY as unknown as ViewStyle) : null]}>{summaryCard}</View>
          </View>
        ) : (
          <View style={styles.column}>
            {left}
            {holdLive ? summaryCard : null}
            {/* #4490 N41: one primary at a time. With the pinned bar showing
                Pay, the inline button is not drawn (its line stays). */}
            {showBar && totalText !== null ? payCaption : payBlock}
          </View>
        )}
      </ScrollView>
      {showBar && totalText !== null ? (
        <View style={[styles.barDock, { paddingBottom: props.safeBottom + space[3] }]} pointerEvents="box-none">
          <OfferingGlassBar
            palette={palette}
            theme={theme}
            title={totalText}
            subtitle={holdLive ? countdownText(secondsLeft) : selection.guests > 0 ? `${selection.guests} ${selection.guests === 1 ? "guest" : "guests"}` : null}
            ctaLabel={busy ? "Opening…" : "Pay"}
            onPress={() => void pay()}
            enabled={blocker === null && !busy}
            ctaAccessibilityLabel={`Pay ${totalText}`}
            style={styles.bar}
            testID="issue-4490-checkout-bar"
            actionTestID="issue-4490-checkout-bar-pay"
          />
        </View>
      ) : null}
    </View>
  );
}

const STICKY_SUMMARY = { position: "sticky", top: space[4] };

const styles = StyleSheet.create({
  memberChoice: { flexDirection: "row", alignItems: "center", gap: space[3], borderWidth: 1 },
  memberText: { flex: 1, minWidth: 0, gap: 2 },
  memberTitle: { ...type.row },
  host: { flex: 1 },
  centered: { alignItems: "center", justifyContent: "center", padding: space[6] },
  narrow: { width: "100%", maxWidth: 480 },
  handoff: { width: "100%", maxWidth: 560, alignSelf: "center", paddingHorizontal: space[5] },
  content: {
    width: "100%",
    maxWidth: 1040,
    alignSelf: "center",
    paddingHorizontal: space[4],
    gap: space[5],
  },
  backRow: { flexDirection: "row", alignItems: "center", gap: space[3] },
  backButton: {
    width: size.iconBtn.md,
    height: size.iconBtn.md,
    borderRadius: radius.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { ...type.title },
  twoCol: { flexDirection: "row", alignItems: "flex-start", gap: space[6] },
  leftCol: { flex: 1, minWidth: 0 },
  // The spec's summary column (C §2.8).
  rightCol: { width: 380 },
  column: { gap: space[4] },
  venueName: { ...type.h2 },
  small: { ...type.small },
  caption: { ...type.caption, textAlign: "center" },
  rule: { height: StyleSheet.hairlineWidth },
  field: { gap: space[1] },
  fieldLabel: { ...type.caption },
  fieldError: { ...type.caption, color: color.errorText },
  payBlock: { gap: space[2] },
  barDock: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: space[4] },
  bar: { width: "100%", maxWidth: 620, alignSelf: "center" },
});

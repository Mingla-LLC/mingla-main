/**
 * #4490 P5-3 — checkout for a by-the-hour booking: the choice from the address
 * (day, start, length, guests), the server's quote (hours × price, VAT, total;
 * per minute for part hours), the guest's details, then hold and pay. Paid in
 * full when booked. No account: the booking token stays on this device and the
 * payment page only returns to `/visit/<groupId>?paid=1`.
 *
 * Layout: two columns from 1024 px (form left, a 380 px summary right); one
 * column with the pay button pinned below that on a phone.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { createThemePalette, resolveTheme, type ResolvedTheme, type ThemePalette } from "@mingla/offering-rendering";
import { boldFontFamily, statusOn } from "@mingla/offering-rendering/themePalette";
import { themeBoldFace } from "@mingla/offering-rendering/themeAccentStyle";
import { OfferingGlassBar } from "@mingla/offering-rendering/OfferingGlassBar";
import { formatVenueMoney } from "@mingla/brand-rendering/venueMoney";
import {
  countdownText,
  entryDateLabel,
  holdSecondsLeft,
  holdUntilText,
  venueAddressLine,
  venueClock,
  venueOfferErrorCopy,
  type EntryBooking,
} from "@mingla/brand-rendering/venueOffers/entryModel";
import { hourLengthWords } from "@mingla/brand-rendering/venueOffers/hireModel";

import { radius, size, space, type } from "../../../constants/designSystem";
import { usePublicVenueBySlug } from "../../../hooks/usePublicEvents";
import { VenueOfferGuestError, venueOfferGuestService } from "../../../services/venueOfferGuestService";
import { useThemeFont } from "../../../theme/useThemeFont";
import { randomId } from "../../../utils/randomId";
import {
  rememberLastHold,
  rememberVenueOfferPayUrl,
  saveVenueOfferBookingToken,
  venueOfferCartKey,
} from "../../../utils/venueOfferBookingTokens";
import { ScrollView } from "../../../wrappers/SmartScrollView";
import { SecurePaymentHandoff } from "../../offering/LazyPublicParts";
import { Icon } from "../../ui/Icon";
import { EntryButton, EntryNote, EntryProblem, entryStyles } from "./EntryUi";
import { GuestDetailsCard, useGuestDetails } from "./GuestDetails";
import { useMemberPrefill } from "./useMemberPrefill";
import { hourGuestErrorCopy, type HourChoice } from "./hourGuestModel";
import { memberGuestErrorCopy, memberUseLine, parseMemberQuote, readVenueMember } from "./memberGuestModel";
import { revealFocusedField } from "./revealFocusedField";

const WIDE = 1024;
const BAR_CLEARANCE = 68 + space[6];

export interface HourCheckoutProps {
  brandSlug: string;
  venueSlug: string;
  offerId: string;
  choice: HourChoice;
  safeTop: number;
  safeBottom: number;
}

function errorWords(code: string, remaining: number | null): string {
  if (code.startsWith("member") || code.startsWith("membership")) return memberGuestErrorCopy(code);
  return hourGuestErrorCopy(code) ?? venueOfferErrorCopy(code, remaining);
}

export function HourCheckout(props: HourCheckoutProps): React.ReactElement {
  const { brandSlug, venueSlug, offerId, choice } = props;
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  const venueQuery = usePublicVenueBySlug(brandSlug, venueSlug);
  const theme: ResolvedTheme = useMemo(() => resolveTheme(venueQuery.data?.theme ?? null, null), [venueQuery.data?.theme]);
  const palette: ThemePalette = useMemo(() => createThemePalette(theme), [theme]);
  useThemeFont(boldFontFamily(theme));
  const tones = statusOn(palette);
  const [cartKey] = useState(venueOfferCartKey);
  const offerQuery = useQuery({
    queryKey: ["venueHourCheckoutOffer", brandSlug, venueSlug, offerId],
    staleTime: 60_000,
    queryFn: () => venueOfferGuestService.offer({ brandSlug, venueSlug, offeringId: offerId }),
  });
  const offer = offerQuery.data ?? null;
  const tz = offer?.venue.timezone ?? null;
  const priceOptionId = offer?.options[0]?.id ?? null;
  // #4490 P6 — a member on this device (opened their member page here) gets their price.
  const [member, setMember] = useState<{ subscriptionId: string; token: string } | null>(null);
  const [useMember, setUseMember] = useState(true);
  useEffect(() => {
    setMember(readVenueMember(brandSlug, venueSlug));
  }, [brandSlug, venueSlug]);
  const asMember = member !== null && useMember;
  const quoteKey = useRef(`venue-offer:quote:${randomId()}`);
  const quoteQuery = useQuery({
    queryKey: ["venueHourQuote", offerId, choice.startsAt, choice.minutes, choice.guests, priceOptionId, asMember ? member?.subscriptionId ?? "" : ""],
    enabled: offer !== null,
    retry: false,
    staleTime: 60_000,
    queryFn: () =>
      venueOfferGuestService.hourQuote({
        offeringId: offerId,
        startsAt: choice.startsAt,
        minutes: choice.minutes,
        guests: choice.guests,
        priceOptionId,
        cartKey,
        idempotencyKey: `venue-offer:quote:${randomId()}`,
        membership: asMember && member !== null ? { subscriptionId: member.subscriptionId, token: member.token } : null,
      }),
  });
  const memberBlock = asMember ? parseMemberQuote(quoteQuery.data?.raw) : null;
  // A membership that can't price this (ended, lapsed, another venue) falls back to the usual price.
  const [memberNote, setMemberNote] = useState<string | null>(null);
  const memberErr = asMember && quoteQuery.error instanceof VenueOfferGuestError && /^member/.test(quoteQuery.error.code) ? quoteQuery.error.code : null;
  useEffect(() => {
    if (memberErr === null) return;
    setMemberNote(memberGuestErrorCopy(memberErr));
    setUseMember(false);
  }, [memberErr]);
  const money = (m: number): string => formatVenueMoney(m, offer?.currencyCode ?? "NGN", offer?.exponent ?? 2);
  const details = useGuestDetails({ countryCode: offer?.venue.countryCode ?? null, currencyCode: offer?.currencyCode ?? null });
  // #4490 fix 3 (N87) — a member starts with their own name and email.
  useMemberPrefill(member, details);
  const [focused, setFocused] = useState(false);
  const [held, setHeld] = useState<{ booking: EntryBooking; token: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState<{ code: string; remaining: number | null } | null>(null);
  const [handoffUrl, setHandoffUrl] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (held === null) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [held]);
  const secondsLeft = held === null ? 0 : holdSecondsLeft(held.booking.holdUntil, now);
  const holdLive = held !== null && secondsLeft > 0;
  const quote = quoteQuery.data?.quote ?? null;
  const endIso = new Date(Date.parse(choice.startsAt) + choice.minutes * 60_000).toISOString();
  const when = `${entryDateLabel(choice.date)} · ${venueClock(choice.startsAt, tz) ?? ""}–${venueClock(endIso, tz) ?? ""}`;
  const quoteErr = quoteQuery.error instanceof VenueOfferGuestError ? quoteQuery.error : null;

  const blocker: string | null = holdLive
    ? null
    : offerQuery.isLoading || quoteQuery.isLoading
      ? "Working out your total…"
      : quoteQuery.isError
        ? errorWords(quoteErr?.code ?? "offer_request_failed", quoteErr?.remaining ?? null)
        : details.problem;

  const pay = async (): Promise<void> => {
    if (busy) return;
    details.setTouched({ name: true, email: true, phone: true });
    if (blocker !== null) return;
    setBusy(true);
    setErrorCode(null);
    try {
      let current = holdLive ? held : null;
      if (current === null) {
        // A fresh quote for the hold (a quote is used once).
        quoteKey.current = `venue-offer:quote:${randomId()}`;
        const fresh = await venueOfferGuestService.hourQuote({
          offeringId: offerId,
          startsAt: choice.startsAt,
          minutes: choice.minutes,
          guests: choice.guests,
          priceOptionId,
          cartKey,
          idempotencyKey: quoteKey.current,
          membership: asMember && member !== null ? { subscriptionId: member.subscriptionId, token: member.token } : null,
        });
        const result = await venueOfferGuestService.hold({
          quoteId: fresh.quote.quoteId,
          guest: details.guest(),
          cartKey,
          idempotencyKey: `venue-offer:hold:${randomId()}`,
        });
        if (result.bookingToken !== null) saveVenueOfferBookingToken(result.booking.groupId, result.bookingToken);
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
        payMode: "full",
      });
      rememberVenueOfferPayUrl(current.booking.groupId, payment.authorizationUrl);
      setHandoffUrl(payment.authorizationUrl);
    } catch (caught) {
      const error = caught instanceof VenueOfferGuestError ? caught : new VenueOfferGuestError("offer_request_failed", null);
      if (error.code === "offer_guest_invalid" || error.code === "offer_payment_details_rejected") details.setEmailServerInvalid(true);
      if (error.code === "offer_payment_already_pending" && held !== null) {
        router.replace(`/visit/${held.booking.groupId}` as never);
        return;
      }
      if (error.code === "offer_hold_expired") setHeld(null);
      if (error.code === "member_credits_used_up" || error.code === "member_not_active") void quoteQuery.refetch();
      setErrorCode({ code: error.code, remaining: error.remaining });
    } finally {
      setBusy(false);
    }
  };

  const goBack = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace(`/b/${brandSlug}/v/${venueSlug}?tab=by_the_hour` as never);
  };

  if (handoffUrl !== null && held !== null) {
    return (
      <View style={[styles.host, { backgroundColor: palette.page, paddingTop: props.safeTop + space[6] }]}>
        <View style={styles.handoff}>
          <SecurePaymentHandoff
            url={handoffUrl}
            palette={palette}
            holdLine={held.booking.holdUntil !== null ? `Your time is held until ${holdUntilText(held.booking.holdUntil, tz).replace(/^On hold until /, "")}.` : null}
            onBack={() => setHandoffUrl(null)}
            testID="issue-4490-hour-secure-payment"
          />
        </View>
      </View>
    );
  }

  if (offerQuery.isError) {
    const code = offerQuery.error instanceof VenueOfferGuestError ? offerQuery.error.code : "offer_request_failed";
    return (
      <View style={[styles.host, styles.centered, { backgroundColor: palette.page }]}>
        <View style={styles.narrow}>
          <EntryProblem
            palette={palette}
            theme={theme}
            title={code === "offer_not_found" ? "This isn't on sale" : "We couldn't load checkout"}
            body={venueOfferErrorCopy(code)}
            actionLabel={code === "offer_not_found" ? "Back to the venue" : "Try again"}
            onAction={code === "offer_not_found" ? () => router.replace(`/b/${brandSlug}/v/${venueSlug}` as never) : () => void offerQuery.refetch()}
            testID="issue-4490-hour-checkout-error"
          />
        </View>
      </View>
    );
  }

  const lines: Array<{ label: string; value: string; total?: boolean }> = [];
  if (quote !== null) {
    const hourMinor = quoteQuery.data?.pricePerHourMinor ?? null;
    const memberOff = memberBlock !== null && memberBlock.applied ? memberBlock.includedMinor + memberBlock.discountMinor : 0;
    lines.push({
      label: hourMinor !== null ? `${hourLengthWords(choice.minutes)} × ${money(hourMinor)} an hour` : hourLengthWords(choice.minutes),
      value: money(memberOff > 0 ? quote.subtotalMinor + memberOff : quoteQuery.data?.hoursMinor ?? quote.subtotalMinor),
    });
    if (memberBlock !== null && memberBlock.applied && memberBlock.includedMinor > 0) {
      lines.push({ label: "Included in your plan", value: `−${money(memberBlock.includedMinor)}` });
    }
    if (memberBlock !== null && memberBlock.applied && memberBlock.discountMinor > 0) {
      lines.push({ label: "Member price", value: `−${money(memberBlock.discountMinor)}` });
    }
    if (quote.vatMode === "added" && quote.taxMinor > 0) lines.push({ label: `VAT ${quote.vatRatePct}%`, value: money(quote.taxMinor) });
    if (quote.feeMinor > 0) lines.push({ label: "Booking fee", value: money(quote.feeMinor) });
    lines.push({ label: "Total", value: money(quote.totalMinor), total: true });
    if (quote.vatMode === "included" && quote.vatAmountMinor > 0) lines.push({ label: `Includes VAT ${quote.vatRatePct}%`, value: money(quote.vatAmountMinor) });
  }

  const summaryCard = (
    <View style={[entryStyles.card, { backgroundColor: palette.card, borderColor: palette.panelBorder }]} testID="issue-4490-hour-checkout-summary">
      <Text style={[styles.venueName, themeBoldFace(theme), { color: palette.primaryText }]}>{offer?.venue.name ?? venueQuery.data?.name ?? ""}</Text>
      {offer?.venue.address ? <Text style={[styles.small, { color: palette.secondaryText }]}>{venueAddressLine(offer.venue.address, offer.venue.city)}</Text> : null}
      <Text style={[styles.small, { color: palette.primaryText }]}>
        {[quoteQuery.data?.placeName ?? offer?.name ?? null, when, `${choice.guests} ${choice.guests === 1 ? "guest" : "guests"}`].filter(Boolean).join(" · ")}
      </Text>
      <View style={[styles.rule, { backgroundColor: palette.panelBorder }]} />
      {quote === null ? (
        <Text style={[styles.small, { color: palette.secondaryText }]}>{blocker ?? "Working out your total…"}</Text>
      ) : (
        lines.map((l) => (
          <View key={l.label} style={styles.line}>
            <Text style={[l.total ? styles.totalText : styles.small, { color: l.total ? palette.primaryText : palette.secondaryText }]}>{l.label}</Text>
            <Text style={[l.total ? styles.totalText : styles.small, { color: palette.primaryText }]}>{l.value}</Text>
          </View>
        ))
      )}
      {offer?.policyText ? <Text style={[styles.caption, { color: palette.tertiaryText }]}>{offer.policyText}</Text> : null}
    </View>
  );

  const nowText = quote !== null ? money(quote.totalMinor) : null;
  const payLabel = busy ? "Opening payment…" : quote !== null && quote.totalMinor === 0 ? "Book it" : nowText !== null ? `Pay ${nowText}` : "Pay";
  const left = (
    <View style={styles.column}>
      {holdLive ? (
        <EntryNote palette={palette} icon="clock" tone="warning" testID="issue-4490-hour-checkout-hold">
          <Text style={[styles.small, { color: tones.warning.text }]}>
            <Text style={themeBoldFace(theme)}>{holdUntilText(held.booking.holdUntil as string, tz)}</Text>
            {` · ${countdownText(secondsLeft)}. Pay before then to keep your time.`}
          </Text>
        </EntryNote>
      ) : held !== null ? (
        <EntryNote palette={palette} icon="clock" tone="error">
          Your hold ran out and the time went back on sale. Pay again to hold it afresh.
        </EntryNote>
      ) : null}
      <View style={[entryStyles.card, { backgroundColor: palette.card, borderColor: palette.panelBorder }]}>
        <Text style={[styles.small, { color: palette.primaryText }]}>{when}</Text>
        <Text style={[styles.small, { color: palette.secondaryText }]}>{`${hourLengthWords(choice.minutes)} · ${choice.guests} ${choice.guests === 1 ? "guest" : "guests"}`}</Text>
        {/* #4490 fix 2 (N87): a real button, not an accent text link. */}
        <Pressable onPress={goBack} accessibilityRole="button" accessibilityLabel="Change the time" hitSlop={8} style={[styles.change, { borderColor: palette.panelBorder }]} testID="issue-4490-hour-checkout-change">
          <Text style={[styles.small, styles.changeLabel, { color: palette.primaryText }]}>Change the time</Text>
        </Pressable>
      </View>
      {member !== null ? (
        <Pressable
          onPress={() => setUseMember((v) => !v)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: useMember }}
          accessibilityLabel="I'm a member"
          style={[entryStyles.card, styles.memberChoice, { backgroundColor: palette.card, borderColor: useMember ? palette.primaryText : palette.panelBorder }]}
          testID="issue-4490-hour-checkout-member"
        >
          <Icon name={useMember ? "check" : "star"} size={20} color={palette.primaryText} />
          <View style={styles.grow}>
            <Text style={[styles.memberTitle, themeBoldFace(theme), { color: palette.primaryText }]}>I&apos;m a member</Text>
            <Text style={[styles.small, { color: palette.secondaryText }]}>
              {!useMember
                ? memberNote ?? "Tap to use your plan's hours and member price."
                : memberBlock !== null
                  ? memberUseLine(memberBlock, money) ?? "Your plan's price."
                  : quoteQuery.isError
                    ? errorWords(quoteErr?.code ?? "membership_request_failed", null)
                    : "Checking your plan…"}
            </Text>
          </View>
        </Pressable>
      ) : null}
      {!wide ? summaryCard : null}
      <GuestDetailsCard
        details={details}
        palette={palette}
        theme={theme}
        disabled={holdLive || busy}
        onFieldFocus={() => {
          setFocused(true);
          revealFocusedField();
        }}
        onFieldBlur={() => setFocused(false)}
        footnote="No account needed. Your booking and pass go to this email."
      />
      {errorCode !== null ? (
        <EntryNote palette={palette} icon="flag" tone="error" testID="issue-4490-hour-checkout-pay-error">
          {errorWords(errorCode.code, errorCode.remaining)}
        </EntryNote>
      ) : null}
      <View style={styles.payBlock}>
        <EntryButton
          palette={palette}
          theme={theme}
          label={payLabel}
          onPress={() => void pay()}
          disabled={blocker !== null}
          busy={busy}
          accessibilityLabel={payLabel}
          testID="issue-4490-hour-checkout-pay"
        />
        <Text style={[styles.caption, { color: blocker !== null ? palette.secondaryText : palette.tertiaryText }]} testID="issue-4490-hour-checkout-reason">
          {blocker ?? "Card, bank transfer or USSD on the secure payment page. Your time is held while you pay."}
        </Text>
      </View>
    </View>
  );

  const showBar = !wide && !focused;
  return (
    <View style={[styles.host, { backgroundColor: palette.page }]} testID="issue-4490-hour-checkout">
      <ScrollView
        style={styles.host}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingTop: props.safeTop + space[5], paddingBottom: props.safeBottom + (showBar ? BAR_CLEARANCE + space[6] : space[8]) }]}
      >
        <View style={styles.backRow}>
          <Pressable
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel="Back to the venue"
            hitSlop={10}
            style={[styles.backButton, { backgroundColor: palette.card, borderColor: palette.panelBorder }]}
            testID="issue-4490-hour-checkout-back"
          >
            <Icon name="chevL" size={20} color={palette.primaryText} />
          </Pressable>
          <Text accessibilityRole="header" style={[styles.title, themeBoldFace(theme), { color: palette.primaryText }]}>
            {offer !== null ? `Book ${offer.name}` : "Book"}
          </Text>
        </View>
        {wide ? (
          <View style={styles.twoCol}>
            <View style={styles.leftCol}>{left}</View>
            <View style={styles.rightCol}>{summaryCard}</View>
          </View>
        ) : (
          left
        )}
      </ScrollView>
      {showBar && nowText !== null ? (
        <View style={[styles.barDock, { paddingBottom: props.safeBottom + space[3] }]} pointerEvents="box-none">
          <OfferingGlassBar
            palette={palette}
            theme={theme}
            title={nowText}
            subtitle={holdLive ? countdownText(secondsLeft) : when}
            ctaLabel={busy ? "Opening…" : quote !== null && quote.totalMinor === 0 ? "Book" : "Pay"}
            onPress={() => void pay()}
            enabled={blocker === null && !busy}
            ctaAccessibilityLabel={payLabel}
            style={styles.bar}
            testID="issue-4490-hour-checkout-bar"
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1 },
  centered: { alignItems: "center", justifyContent: "center", padding: space[6] },
  narrow: { width: "100%", maxWidth: 480 },
  handoff: { width: "100%", maxWidth: 560, alignSelf: "center", paddingHorizontal: space[5] },
  content: { width: "100%", maxWidth: 1040, alignSelf: "center", paddingHorizontal: space[4], gap: space[5] },
  backRow: { flexDirection: "row", alignItems: "center", gap: space[3] },
  backButton: { width: size.iconBtn.md, height: size.iconBtn.md, borderRadius: radius.full, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  title: { ...type.title, flexShrink: 1 },
  twoCol: { flexDirection: "row", alignItems: "flex-start", gap: space[6] },
  leftCol: { flex: 1, minWidth: 0 },
  rightCol: { width: 380 },
  column: { gap: space[4] },
  venueName: { ...type.h2 },
  small: { ...type.small },
  caption: { ...type.caption, textAlign: "center" },
  totalText: { ...type.body, fontWeight: "700" },
  rule: { height: StyleSheet.hairlineWidth },
  line: { flexDirection: "row", justifyContent: "space-between", gap: space[3] },
  change: {
    minHeight: 44,
    justifyContent: "center",
    alignSelf: "flex-start",
    paddingHorizontal: space[4],
    borderRadius: radius.full,
    borderWidth: 1,
  },
  changeLabel: { fontWeight: "600" },
  payBlock: { gap: space[2] },
  memberChoice: { flexDirection: "row", alignItems: "center", gap: space[3], borderWidth: 1 },
  memberTitle: { ...type.row },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  barDock: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: space[4] },
  bar: { width: "100%", maxWidth: 620, alignSelf: "center" },
});

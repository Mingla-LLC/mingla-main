/**
 * #4490 P3-3 — checkout for a group package: the group's choice (same form as
 * the venue page, read back from the address), "How you pay" (Half now / All
 * now when the package takes a deposit), the server's total with extras and
 * VAT, the guest's details, then hold and pay.
 *
 * Buying never needs an account (no `useAuth`). Pay first re-asks the quote,
 * then holds the group's places ("On hold until 20:41", live countdown),
 * keeps the booking token on this device and opens the secure payment page in
 * this tab. The payment page only sees `/visit/<groupId>?paid=1` as its return.
 *
 * Layout: two columns from 1024 px (form left, a 380 px summary right); one
 * column with the pay button pinned below that.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useRouter } from "expo-router";
import { createThemePalette, resolveTheme, type ResolvedTheme, type ThemePalette } from "@mingla/offering-rendering";
import { boldFontFamily, neutralHair, statusOn } from "@mingla/offering-rendering/themePalette";
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
import {
  depositWords,
  packageSummaryLines,
  venueDayOf,
  type PackageChoice,
} from "@mingla/brand-rendering/venueOffers/packageModel";

import { radius, size, space, type } from "../../../constants/designSystem";
import { usePublicVenueBySlug } from "../../../hooks/usePublicEvents";
import { VenueOfferGuestError, venueOfferGuestService } from "../../../services/venueOfferGuestService";
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
import { EntryButton, EntryNote, EntryProblem, EntrySummaryRows, entryStyles } from "./EntryUi";
import { GuestDetailsCard, useGuestDetails } from "./GuestDetails";
import { PackageForm } from "./PackageForm";
import { PayModeChoice } from "./PayModeChoice";
import { revealFocusedField } from "./revealFocusedField";
import { usePackageSelection } from "./usePackageSelection";

const WIDE = 1024;
const BAR_CLEARANCE = 68 + space[6];

export interface PackageCheckoutProps {
  brandSlug: string;
  venueSlug: string;
  offerId: string;
  choice: PackageChoice;
  safeTop: number;
  safeBottom: number;
}

interface HeldBooking {
  booking: EntryBooking;
  token: string | null;
}

export function PackageCheckout(props: PackageCheckoutProps): React.ReactElement {
  const { brandSlug, venueSlug, offerId } = props;
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  const venueQuery = usePublicVenueBySlug(brandSlug, venueSlug);
  const theme: ResolvedTheme = useMemo(() => resolveTheme(venueQuery.data?.theme ?? null, null), [venueQuery.data?.theme]);
  const palette: ThemePalette = useMemo(() => createThemePalette(theme), [theme]);
  useThemeFont(boldFontFamily(theme));
  const hair = neutralHair(palette);
  const tones = statusOn(palette);

  const [cartKey] = useState(venueOfferCartKey);
  const selection = usePackageSelection({ brandSlug, venueSlug, offeringId: offerId, cartKey, initial: props.choice });
  const offer = selection.offer;
  const money = (m: number): string => formatVenueMoney(m, offer?.currencyCode ?? "NGN", offer?.exponent ?? 2);
  const details = useGuestDetails({ countryCode: offer?.venue.countryCode ?? null, currencyCode: offer?.currencyCode ?? null });
  const [focused, setFocused] = useState(false);

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
  const [earlierHold, setEarlierHold] = useState<EntryBooking | null>(null);
  useEffect(() => {
    const groupId = recallLastHold(offerId);
    if (groupId === null) return undefined;
    let live = true;
    venueOfferGuestService
      .get({ groupId, token: readVenueOfferBookingToken(groupId) })
      .then((booking) => {
        if (live && booking.state === "instant_payment_pending" && holdSecondsLeft(booking.holdUntil, Date.now()) > 0) {
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

  const quote = selection.quote.status === "ready" ? selection.quote.quote : null;
  const plan = quote?.payPlan ?? null;
  const depositOffered = offer !== null && offer.payModes.includes("deposit") && plan !== null && plan.payModes.includes("deposit");
  const payMode: "deposit" | "full" = depositOffered && selection.payMode === "deposit" ? "deposit" : "full";
  const deposit = depositOffered ? (plan?.depositMinor ?? null) : null;
  const later = quote !== null && deposit !== null ? quote.totalMinor - deposit : null;
  const laterBy = venueDayOf(plan?.balanceDueAt ?? null, offer?.venue.timezone ?? null);
  const nowMinor = quote === null ? null : payMode === "deposit" && deposit !== null ? deposit : quote.totalMinor;
  const nowText = nowMinor === null ? null : money(nowMinor);

  const blocker: string | null = holdLive
    ? null
    : selection.problem ??
      (selection.quote.status === "loading" || selection.quote.status === "idle"
        ? "Working out your total…"
        : selection.quote.status === "error"
          ? venueOfferErrorCopy(selection.quote.code, selection.quote.remaining)
          : details.problem);

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
        if (result.bookingToken !== null) saveVenueOfferBookingToken(result.booking.groupId, result.bookingToken);
        rememberLastHold(offerId, result.booking.groupId);
        current = { booking: result.booking, token: result.bookingToken };
        setHeld(current);
      }
      const payment = await venueOfferGuestService.pay({
        groupId: current.booking.groupId,
        token: current.token,
        expectedVersion: current.booking.version,
        idempotencyKey: `venue-offer:pay:${randomId()}`,
        payMode,
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
      setErrorCode({ code: error.code, remaining: error.remaining });
    } finally {
      setBusy(false);
    }
  };

  const goBack = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace(`/b/${brandSlug}/v/${venueSlug}?tab=groups` as never);
  };

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
            testID="issue-4490-package-secure-payment"
          />
        </View>
      </View>
    );
  }

  if (selection.offerState === "error") {
    return (
      <View style={[styles.host, styles.centered, { backgroundColor: palette.page }]}>
        <View style={styles.narrow}>
          <EntryProblem
            palette={palette}
            theme={theme}
            title={selection.offerError === "offer_not_found" ? "This package isn't on sale" : "We couldn't load checkout"}
            body={venueOfferErrorCopy(selection.offerError)}
            actionLabel={selection.offerError === "offer_not_found" ? "Back to the venue" : "Try again"}
            onAction={selection.offerError === "offer_not_found" ? () => router.replace(`/b/${brandSlug}/v/${venueSlug}` as never) : selection.retryOffer}
            testID="issue-4490-package-checkout-error"
          />
        </View>
      </View>
    );
  }

  const chosenRow = selection.rows.find((r) => r.windowId === selection.windowId) ?? null;
  const unit = offer !== null && offer.options.length === 1 && offer.options[0].unit === "booking" ? "booking" : "guest";
  const summaryCard = (
    <View style={[entryStyles.card, { backgroundColor: palette.card, borderColor: palette.panelBorder }]} testID="issue-4490-package-checkout-summary">
      <Text style={[styles.venueName, themeBoldFace(theme), { color: palette.primaryText }]}>{offer?.venue.name ?? venueQuery.data?.name ?? ""}</Text>
      {offer?.venue.address ? (
        <Text style={[styles.small, { color: palette.secondaryText }]}>{venueAddressLine(offer.venue.address, offer.venue.city)}</Text>
      ) : null}
      {offer !== null ? (
        <Text style={[styles.small, { color: palette.secondaryText }]}>
          {[
            offer.name,
            selection.selectedDate !== null ? entryDateLabel(selection.selectedDate) : null,
            chosenRow !== null ? venueClock(chosenRow.startsAt, offer.venue.timezone) : null,
            `${selection.guests} guests`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      ) : null}
      <View style={[styles.rule, { backgroundColor: hair }]} />
      {offer !== null && depositOffered && !holdLive ? (
        <PayModeChoice
          palette={palette}
          value={selection.payMode}
          onChange={selection.setPayMode}
          depositLabel={depositWords(plan ?? { depositKind: offer.deposit.kind, depositValue: offer.deposit.value, depositMinor: null }, offer.currencyCode, offer.exponent)}
          depositAmount={deposit !== null ? money(deposit) : null}
          fullAmount={quote !== null ? money(quote.totalMinor) : null}
          laterLine={later !== null && later > 0 ? `Then ${money(later)}${laterBy !== null ? ` by ${laterBy}` : " later"}` : null}
          fontFamily={themeBoldFace(theme).fontFamily}
          testID="issue-4490-package-checkout-pay-mode"
        />
      ) : null}
      {quote !== null && offer !== null ? (
        <EntrySummaryRows
          palette={palette}
          theme={theme}
          lines={packageSummaryLines(quote, {
            exponent: offer.exponent,
            offerName: offer.name,
            guests: selection.guests,
            unit,
            payNowMinor: payMode === "deposit" ? deposit : null,
            laterMinor: later,
            laterBy,
          })}
          testID="issue-4490-package-checkout-lines"
        />
      ) : (
        <Text style={[styles.small, { color: palette.secondaryText }]}>{selection.problem ?? "Working out your total…"}</Text>
      )}
    </View>
  );

  const holdBanner = holdLive ? (
    <EntryNote palette={palette} icon="clock" tone="warning" testID="issue-4490-package-checkout-hold">
      <Text style={[styles.small, { color: tones.warning.text }]}>
        <Text style={themeBoldFace(theme)}>{holdUntilText(held.booking.holdUntil as string, offer?.venue.timezone ?? null)}</Text>
        {` · ${countdownText(secondsLeft)}. Pay before then to keep your places.`}
      </Text>
    </EntryNote>
  ) : held !== null ? (
    <EntryNote palette={palette} icon="clock" tone="error" testID="issue-4490-package-checkout-hold-expired">
      Your hold ran out and the places went back on sale. Pay again to hold them afresh.
    </EntryNote>
  ) : null;

  const earlierHoldNote =
    earlierHold !== null && held === null ? (
      <EntryNote palette={palette} icon="clock" tone="warning" testID="issue-4490-package-checkout-earlier-hold">
        <View style={styles.payBlock}>
          <Text style={[styles.small, { color: tones.warning.text }]}>
            {`You already have a group booking on hold${earlierHold.window !== null ? ` for ${entryDateLabel(earlierHold.window.localDate)}` : ""}. Carry on with it, or choose again below.`}
          </Text>
          <EntryButton
            palette={palette}
            theme={theme}
            variant="secondary"
            label="Continue that booking"
            onPress={() => router.push(`/visit/${earlierHold.groupId}` as never)}
            testID="issue-4490-package-checkout-continue-hold"
          />
        </View>
      </EntryNote>
    ) : null;

  const payLabel = busy ? "Opening payment…" : nowText !== null ? (payMode === "deposit" ? `Pay ${nowText} now` : `Pay ${nowText}`) : "Pay";
  const payBlock = (
    <View style={styles.payBlock}>
      <EntryButton
        palette={palette}
        theme={theme}
        label={payLabel}
        onPress={() => void pay()}
        disabled={blocker !== null}
        busy={busy}
        accessibilityLabel={payLabel}
        testID="issue-4490-package-checkout-pay"
      />
      <Text style={[styles.caption, { color: blocker !== null ? palette.secondaryText : palette.tertiaryText }]} testID="issue-4490-package-checkout-reason">
        {blocker ?? "Card, bank transfer or USSD on the secure payment page. Your places are held while you pay."}
      </Text>
    </View>
  );

  const onFieldFocus = (): void => {
    setFocused(true);
    revealFocusedField();
  };

  const left = (
    <View style={styles.column}>
      {earlierHoldNote}
      {holdBanner}
      {held === null || !holdLive ? (
        <View style={[entryStyles.card, { backgroundColor: palette.card, borderColor: palette.panelBorder }]}>
          <PackageForm selection={selection} palette={palette} theme={theme} showSummary={false} testID="issue-4490-package-checkout-form" />
        </View>
      ) : (
        <Pressable onPress={() => setHeld(null)} accessibilityRole="button" hitSlop={8} testID="issue-4490-package-checkout-change">
          <Text style={[styles.small, { color: palette.accent }]}>Change the day or group (your current hold simply lapses)</Text>
        </Pressable>
      )}
      {!wide ? summaryCard : null}
      <GuestDetailsCard
        details={details}
        palette={palette}
        theme={theme}
        disabled={holdLive || busy}
        onFieldFocus={onFieldFocus}
        onFieldBlur={() => setFocused(false)}
        footnote="No account needed. Your booking, pass and payment reminders go to this email."
      />
      {errorCode !== null ? (
        <EntryNote palette={palette} icon="flag" tone="error" testID="issue-4490-package-checkout-pay-error">
          {venueOfferErrorCopy(errorCode.code, errorCode.remaining)}
        </EntryNote>
      ) : null}
      {payBlock}
    </View>
  );

  const showBar = !wide && !focused;
  return (
    <View style={[styles.host, { backgroundColor: palette.page }]} testID="issue-4490-package-checkout">
      <ScrollView
        style={styles.host}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          { paddingTop: props.safeTop + space[5], paddingBottom: props.safeBottom + (showBar ? BAR_CLEARANCE + space[6] : space[8]) },
        ]}
      >
        <View style={styles.backRow}>
          <Pressable
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel="Back to the venue"
            hitSlop={10}
            style={[styles.backButton, { backgroundColor: palette.card, borderColor: palette.panelBorder }]}
            testID="issue-4490-package-checkout-back"
          >
            <Icon name="chevL" size={20} color={palette.primaryText} />
          </Pressable>
          <Text accessibilityRole="header" style={[styles.title, themeBoldFace(theme), { color: palette.primaryText }]}>
            Book for your group
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
            subtitle={holdLive ? countdownText(secondsLeft) : payMode === "deposit" ? "now, the rest later" : `${selection.guests} guests`}
            ctaLabel={busy ? "Opening…" : "Pay"}
            onPress={() => void pay()}
            enabled={blocker === null && !busy}
            ctaAccessibilityLabel={payLabel}
            style={styles.bar}
            testID="issue-4490-package-checkout-bar"
            actionTestID="issue-4490-package-checkout-bar-pay"
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
  rightCol: { width: 380 },
  column: { gap: space[4] },
  venueName: { ...type.h2 },
  small: { ...type.small },
  caption: { ...type.caption, textAlign: "center" },
  rule: { height: StyleSheet.hairlineWidth },
  payBlock: { gap: space[2] },
  barDock: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: space[4] },
  bar: { width: "100%", maxWidth: 620, alignSelf: "center" },
});

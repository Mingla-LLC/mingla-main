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
  Pressable,
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
import { neutralHair, statusOn } from "@mingla/offering-rendering/themePalette";
import { themeBoldFace } from "@mingla/offering-rendering/themeAccentStyle";
import { OfferingGlassBar } from "@mingla/offering-rendering/OfferingGlassBar";
import {
  PhoneInput,
  getCountryByCode,
  type PhoneInputIconName,
  type PhoneInputTheme,
} from "@mingla/phone-input";
import { parsePhoneEntry, resolvePhoneStartCountry } from "@mingla/phone-input/phoneNumber";
import { formatVenueMoney } from "@mingla/brand-rendering/venueFeaturePage";
import {
  ENTRY_EMAIL_PATTERN,
  countdownText,
  entryDateLabel,
  holdSecondsLeft,
  holdUntilText,
  idCheckNote,
  summaryLines,
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
import { devicePhoneRegion } from "../../../utils/devicePhoneRegion";
import { composeE164 } from "../../../utils/phone";
import { phoneStartCountryForCurrency } from "../../../utils/phoneStartCountryForCurrency";
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
import { Input } from "../../ui/Input";
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
import { revealFocusedField } from "./revealFocusedField";

const WIDE = 1024;
const BAR_CLEARANCE = 68 + space[6];

const phoneCountryKnown = (iso: string): boolean => {
  try {
    return getCountryByCode(iso) !== undefined;
  } catch {
    return false;
  }
};

export interface OfferCheckoutProps {
  brandSlug: string;
  venueSlug: string;
  offerId: string;
  initialDate: string | null;
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
  const selection = useEntrySelection({
    brandSlug,
    venueSlug,
    offeringId: offerId,
    cartKey,
    initialDate: props.initialDate,
    initialCounts: props.initialCounts,
  });
  const offer = selection.offer;
  const money = (minor: number): string =>
    formatVenueMoney(minor, offer?.currencyCode ?? "NGN", offer?.exponent ?? 2);

  // ── your details ──────────────────────────────────────────────────────
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phoneLocal, setPhoneLocal] = useState("");
  const [phoneCountry, setPhoneCountry] = useState<string>(() =>
    resolvePhoneStartCountry(
      [phoneStartCountryForCurrency("NGN"), devicePhoneRegion()],
      phoneCountryKnown,
    ) ?? "NG",
  );
  const countryChosen = useRef(false);
  useEffect(() => {
    if (countryChosen.current || offer === null) return;
    const start = resolvePhoneStartCountry(
      [offer.venue.countryCode, phoneStartCountryForCurrency(offer.currencyCode), devicePhoneRegion()],
      phoneCountryKnown,
    );
    if (start !== null) setPhoneCountry(start);
  }, [offer]);
  const [touched, setTouched] = useState({ name: false, email: false, phone: false });
  const [emailServerInvalid, setEmailServerInvalid] = useState(false);
  const [focused, setFocused] = useState(false);

  const nameOk = name.trim().length >= 1 && name.trim().length <= 120;
  const emailOk = ENTRY_EMAIL_PATTERN.test(email.trim()) && !emailServerInvalid;
  const dial = getCountryByCode(phoneCountry)?.dialCode ?? "+234";
  const phoneDigits = phoneLocal.replace(/\D/g, "");
  const phoneCheck = parsePhoneEntry(phoneLocal, { countryIso: phoneCountry, dialCode: dial, mode: "mobile" });
  const phoneOk = phoneDigits.length === 0 || phoneCheck.ok;
  const suggestedCountry =
    !phoneCheck.ok && phoneCheck.suggestedCountryIso != null
      ? getCountryByCode(phoneCheck.suggestedCountryIso)
      : undefined;

  const phoneTheme = useMemo<PhoneInputTheme>(
    () => ({
      backgroundPrimary: palette.page,
      textPrimary: palette.primaryText,
      textTertiary: palette.tertiaryText,
      borderDefault: palette.panelBorder,
      borderFocused: palette.accent,
      borderError: color.danger,
      searchBackground: palette.card,
      rowPressedBackground: palette.accentWash,
      divider: palette.panelBorder,
      accessoryBackground: palette.page,
      accessoryBorder: palette.panelBorder,
      accent: palette.accent,
      errorText: color.errorText,
    }),
    [palette],
  );

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

  const payLabel = busy ? "Opening payment…" : totalText !== null ? `Pay ${totalText}` : "Pay";

  const pay = async (): Promise<void> => {
    if (busy) return;
    setTouched({ name: true, email: true, phone: true });
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
        const phone = phoneDigits.length > 0 ? composeE164(dial, phoneLocal) : null;
        const result = await venueOfferGuestService.hold({
          quoteId: fresh.quoteId,
          guest: {
            name: name.trim(),
            email: email.trim(),
            ...(phone !== null ? { phone, phoneCountryIso: phoneCountry } : {}),
          },
          cartKey,
          idempotencyKey: `venue-offer:hold:${randomId()}`,
        });
        if (result.bookingToken !== null) {
          saveVenueOfferBookingToken(result.booking.groupId, result.bookingToken);
        }
        rememberLastHold(offerId, result.booking.groupId);
        current = { booking: result.booking, token: result.bookingToken };
        setHeld(current);
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
        setEmailServerInvalid(true);
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
          {[offer.venue.address, offer.venue.city].filter(Boolean).join(", ")}
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
          lines={summaryLines(held.booking.lines, {
            currencyCode: held.booking.currencyCode,
            exponent: offer?.exponent ?? 2,
            taxMinor: held.booking.taxMinor,
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

  const details = (
    <View
      style={[entryStyles.card, { backgroundColor: palette.card, borderColor: palette.panelBorder }]}
      testID="issue-4490-checkout-details"
    >
      <EntrySectionLabel palette={palette}>Your details</EntrySectionLabel>
      <View style={styles.field}>
        <Text style={[styles.fieldLabel, { color: palette.secondaryText }]}>Name</Text>
        <Input
          value={name}
          onChangeText={setName}
          onFocus={onFieldFocus}
          onBlur={() => {
            setFocused(false);
            setTouched((t) => ({ ...t, name: true }));
          }}
          placeholder="Your name"
          accessibilityLabel="Name, required"
          editable={!holdLive && !busy}
          testID="issue-4490-checkout-name"
        />
        {touched.name && !nameOk ? <Text style={styles.fieldError}>Add your name.</Text> : null}
      </View>
      <View style={styles.field}>
        <Text style={[styles.fieldLabel, { color: palette.secondaryText }]}>Email</Text>
        <Input
          value={email}
          onChangeText={(next: string) => {
            setEmail(next);
            setEmailServerInvalid(false);
          }}
          onFocus={onFieldFocus}
          onBlur={() => {
            setFocused(false);
            setTouched((t) => ({ ...t, email: true }));
          }}
          variant="email"
          placeholder="you@example.com"
          accessibilityLabel="Email, required"
          editable={!holdLive && !busy}
          testID="issue-4490-checkout-email"
        />
        {touched.email && !emailOk ? (
          <Text style={styles.fieldError} accessibilityRole="alert">
            {emailServerInvalid
              ? "The payment page didn't accept this email. Check it and try again."
              : "That email looks unfinished. Your pass is sent there."}
          </Text>
        ) : null}
      </View>
      <View style={styles.field}>
        <Text style={[styles.fieldLabel, { color: palette.secondaryText }]}>Phone (optional)</Text>
        <PhoneInput
          smartEntry
          value={phoneLocal}
          countryCode={phoneCountry}
          onChangePhone={(next: string) => {
            if (next.length > 0) countryChosen.current = true;
            setPhoneLocal(next);
          }}
          onChangeCountry={(next: string) => {
            countryChosen.current = true;
            setPhoneCountry(next);
          }}
          onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
          error={touched.phone && !phoneOk ? phoneCheck.message ?? "Check the phone number." : null}
          disabled={holdLive || busy}
          iconRenderer={(iconName: PhoneInputIconName, iconProps: { size: number; color: string }) => (
            <Icon
              name={
                iconName === "chevronDown"
                  ? "chevD"
                  : iconName === "checkmark"
                    ? "check"
                    : iconName === "close"
                      ? "close"
                      : "search"
              }
              size={iconProps.size}
              color={iconProps.color}
            />
          )}
          labels={{
            phonePlaceholder: "Phone number",
            countryButtonAccessibilityLabel: (countryName: string) =>
              `Country code, ${countryName}, tap to change`,
            phoneInputAccessibilityLabel: "Phone number, optional",
            doneButton: "Done",
            pickerTitle: "Select country",
            pickerSearchPlaceholder: "Search country or dial code",
            pickerCloseAccessibilityLabel: "Close country picker",
          }}
          theme={phoneTheme}
        />
        {touched.phone && suggestedCountry !== undefined ? (
          <Pressable
            onPress={() => {
              countryChosen.current = true;
              setPhoneCountry(suggestedCountry.code);
            }}
            accessibilityRole="button"
            hitSlop={8}
          >
            <Text style={[styles.small, { color: palette.accent }]}>
              {`Switch to ${suggestedCountry.name} (${suggestedCountry.dialCode})`}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={[styles.caption, { color: palette.tertiaryText }]}>
        No account needed. Your pass and receipt go to this email.
      </Text>
    </View>
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
      {details}
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
            <View style={styles.rightCol}>{summaryCard}</View>
          </View>
        ) : (
          <View style={styles.column}>
            {left}
            {holdLive ? summaryCard : null}
            {payBlock}
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

const styles = StyleSheet.create({
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

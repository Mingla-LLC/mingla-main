/**
 * #4490 P4-3 — asking for a private hire (`/b/…/book/<offerId>?k=hire…`): the
 * choice from the venue page (space, day, session, guests — changeable here),
 * the occasion (chips), extra hours when the venue offers them, the guest's
 * details, "Anything <venue> should know?" (500), "I'd like to see the space
 * first", and the server's quote: hire, extras, VAT, the refundable damage
 * deposit and the total, with "Nothing to pay yet … <deposit> holds your
 * date". Send request creates the request (nothing is held) and opens the
 * booking page. An instant-mode hire goes straight to paying the deposit.
 *
 * Buying never needs an account (no `useAuth`). The pay amount shown is the
 * server's own deposit.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useRouter } from "expo-router";
import { createThemePalette, resolveTheme, type ResolvedTheme, type ThemePalette } from "@mingla/offering-rendering";
import { boldFontFamily, neutralHair, statusOn } from "@mingla/offering-rendering/themePalette";
import { themeBoldFace } from "@mingla/offering-rendering/themeAccentStyle";
import { OfferingChipRow, OfferingChoiceChip, OfferingStepper } from "@mingla/offering-rendering/OfferingDecideParts";
import { formatVenueMoney } from "@mingla/brand-rendering/venueMoney";
import { entryDateLabel, holdUntilText, venueAddressLine, venueClock } from "@mingla/brand-rendering/venueOffers/entryModel";
import {
  OCCASIONS,
  damageLine,
  hireErrorCopy,
  hirePayNowMinor,
  hourLengthWords,
  hireSummaryLines,
  requestPromise,
  type HireChoice,
  type HireQuote,
} from "@mingla/brand-rendering/venueOffers/hireModel";
import {
  venueLayoutLabel,
  venueLayoutSummary,
  type VenueLayout,
} from "@mingla/brand-rendering/venueOffers/layoutModel";

import { radius, size, space, type } from "../../../constants/designSystem";
import { usePublicVenueBySlug } from "../../../hooks/usePublicEvents";
import { VenueOfferGuestError, venueOfferGuestService } from "../../../services/venueOfferGuestService";
import { useThemeFont } from "../../../theme/useThemeFont";
import { randomId } from "../../../utils/randomId";
import { rememberVenueOfferPayUrl, saveVenueOfferBookingToken, venueOfferCartKey } from "../../../utils/venueOfferBookingTokens";
import { ScrollView } from "../../../wrappers/SmartScrollView";
import { SecurePaymentHandoff } from "../../offering/LazyPublicParts";
import { Icon } from "../../ui/Icon";
import { Input } from "../../ui/Input";
import { EntryButton, EntryNote, EntryProblem, EntrySectionLabel, entryStyles } from "./EntryUi";
import { GuestDetailsCard, useGuestDetails } from "./GuestDetails";
import { HireForm } from "./HireForm";
import { ExtrasList } from "./ExtrasList";
import { revealFocusedField } from "./revealFocusedField";
import { useHireSelection } from "./useHireSelection";

const WIDE = 1024;
const QUOTE_DEBOUNCE_MS = 450;

export interface HireRequestProps {
  brandSlug: string;
  venueSlug: string;
  offerId: string;
  choice: HireChoice;
  safeTop: number;
  safeBottom: number;
}

type QuoteState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; quote: HireQuote }
  | { status: "error"; code: string; detail: { placeName?: string; capacity?: number; layout?: string } | null };

export function HireRequest(props: HireRequestProps): React.ReactElement {
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
  const selection = useHireSelection({ brandSlug, venueSlug, offeringId: offerId, initial: props.choice });
  const offer = selection.offer;
  const exponent = offer?.exponent ?? 2;
  const money = (m: number): string => formatVenueMoney(m, offer?.currencyCode ?? "NGN", exponent);
  const details = useGuestDetails({ countryCode: offer?.venue.countryCode ?? null, currencyCode: offer?.currencyCode ?? null });
  const [editing, setEditing] = useState(false);
  const [occasion, setOccasion] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [siteVisit, setSiteVisit] = useState(false);
  const [overtime, setOvertime] = useState(0);
  const [pickedExtras, setPickedExtras] = useState<string[]>([]);
  const [layout, setLayout] = useState<VenueLayout | null>(null);
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [handoffUrl, setHandoffUrl] = useState<{ url: string; holdUntil: string | null } | null>(null);
  const venueName = offer?.venue.name ?? venueQuery.data?.name ?? "The venue";

  // ── the live quote ───────────────────────────────────────────────────
  const [quote, setQuote] = useState<QuoteState>({ status: "idle" });
  const choice = selection.choice;
  const chosenRow = offer?.rows.find((row) => row.optionId === choice?.priceOptionId) ?? null;
  const availableLayouts = useMemo(
    () => (offer?.layouts ?? []).flatMap((key) => {
      const capacity = chosenRow?.layoutCapacities[key];
      return capacity === undefined ? [] : [{ key, capacity }];
    }),
    [chosenRow, offer?.layouts],
  );
  useEffect(() => {
    if (layout !== null && availableLayouts.some((row) => row.key === layout)) return;
    setLayout(availableLayouts.length === 1 ? availableLayouts[0].key : null);
  }, [availableLayouts, layout]);
  const answers = useMemo((): Record<string, string | boolean> => {
    const out: Record<string, string | boolean> = {};
    if (occasion !== null) out.occasion = occasion;
    if (note.trim().length > 0) out.note = note.trim().slice(0, 500);
    if (siteVisit) out.siteVisit = true;
    return out;
  }, [occasion, note, siteVisit]);
  const quoteKey = `${choice?.windowId ?? ""}|${choice?.priceOptionId ?? ""}|${choice?.guests ?? 0}|${layout ?? ""}|${overtime}|${[...pickedExtras].sort().join(",")}|${choice?.startsAt ?? ""}|${choice?.minutes ?? 0}`;
  const latest = useRef(quoteKey);
  latest.current = quoteKey;
  const askQuote = async (withAnswers: boolean): Promise<HireQuote | null> => {
    if (choice === null || selection.problem !== null || ((offer?.layouts.length ?? 0) > 0 && layout === null)) {
      setQuote({ status: "idle" });
      return null;
    }
    const asked = latest.current;
    setQuote({ status: "loading" });
    try {
      const next = await venueOfferGuestService.hireQuote({
        offeringId: offerId,
        windowId: choice.windowId,
        ...(choice.startsAt !== undefined && choice.minutes !== undefined ? { startsAt: choice.startsAt, minutes: choice.minutes } : {}),
        priceOptionId: choice.priceOptionId,
        guests: choice.guests,
        layout,
        overtimeHours: choice.startsAt !== undefined ? 0 : overtime,
        extras: pickedExtras.map((id) => ({ id })),
        answers: withAnswers ? answers : {},
        cartKey,
        idempotencyKey: `venue-offer:quote:${randomId()}`,
      });
      if (latest.current === asked) setQuote({ status: "ready", quote: next });
      return next;
    } catch (caught) {
      const code = caught instanceof VenueOfferGuestError ? caught.code : "offer_request_failed";
      if (latest.current === asked) setQuote({ status: "error", code, detail: caught instanceof VenueOfferGuestError ? caught.detail : null });
      return null;
    }
  };
  useEffect(() => {
    if (choice === null || selection.problem !== null || ((offer?.layouts.length ?? 0) > 0 && layout === null)) {
      setQuote({ status: "idle" });
      return undefined;
    }
    setQuote({ status: "loading" });
    const timer = setTimeout(() => void askQuote(false), QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey, selection.problem]);

  const q = quote.status === "ready" ? quote.quote : null;
  const instant = offer?.mode === "instant";
  const blocker: string | null =
    selection.problem ??
    ((offer?.layouts.length ?? 0) > 0 && layout === null ? "Pick how you'll set up the space." : null) ??
    (quote.status === "loading" || quote.status === "idle"
      ? "Working out your price…"
      : quote.status === "error"
        ? hireErrorCopy(quote.code, quote.detail)
        : details.problem);

  const send = async (): Promise<void> => {
    if (busy) return;
    details.setTouched({ name: true, email: true, phone: true });
    if (blocker !== null) return;
    setBusy(true);
    setErrorCode(null);
    try {
      const fresh = await askQuote(true);
      if (fresh === null) return;
      const held = await venueOfferGuestService.hold({
        quoteId: fresh.quoteId,
        guest: details.guest(),
        cartKey,
        idempotencyKey: `venue-offer:hold:${randomId()}`,
      });
      if (held.bookingToken !== null) saveVenueOfferBookingToken(held.booking.groupId, held.bookingToken);
      if (!instant || held.booking.state === "request_pending") {
        router.replace(`/visit/${held.booking.groupId}?sent=1` as never);
        return;
      }
      const deposit = fresh.payPlan.payModes.includes("deposit") ? "deposit" : "full";
      const payment = await venueOfferGuestService.pay({
        groupId: held.booking.groupId,
        token: held.bookingToken,
        expectedVersion: held.booking.version,
        idempotencyKey: `venue-offer:pay:${randomId()}`,
        payMode: deposit,
      });
      rememberVenueOfferPayUrl(held.booking.groupId, payment.authorizationUrl);
      setHandoffUrl({ url: payment.authorizationUrl, holdUntil: held.booking.holdUntil });
    } catch (caught) {
      const error = caught instanceof VenueOfferGuestError ? caught : new VenueOfferGuestError("offer_request_failed", null);
      if (error.code === "offer_guest_invalid" || error.code === "offer_payment_details_rejected") details.setEmailServerInvalid(true);
      setErrorCode(error.code);
      if (error.code === "offer_space_taken") selection.retryPlaces();
    } finally {
      setBusy(false);
    }
  };

  const goBack = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace(`/b/${brandSlug}/v/${venueSlug}?tab=hire` as never);
  };

  if (handoffUrl !== null) {
    return (
      <View style={[styles.host, { backgroundColor: palette.page, paddingTop: props.safeTop + space[6] }]}>
        <View style={styles.handoff}>
          <SecurePaymentHandoff
            url={handoffUrl.url}
            palette={palette}
            holdLine={handoffUrl.holdUntil !== null ? `Your date is held until ${holdUntilText(handoffUrl.holdUntil, offer?.venue.timezone ?? null).replace(/^On hold until /, "")}.` : null}
            onBack={() => setHandoffUrl(null)}
            testID="issue-4490-hire-secure-payment"
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
            title={selection.offerError === "offer_not_found" ? "Private hire isn't open here" : "We couldn't load this page"}
            body={hireErrorCopy(selection.offerError)}
            actionLabel={selection.offerError === "offer_not_found" ? "Back to the venue" : "Try again"}
            onAction={selection.offerError === "offer_not_found" ? () => router.replace(`/b/${brandSlug}/v/${venueSlug}` as never) : selection.retryOffer}
            testID="issue-4490-hire-request-error"
          />
        </View>
      </View>
    );
  }

  const session = selection.sessions.find((s) => s.windowId === selection.windowId) ?? null;
  const place = selection.selectedPlace;
  const choiceCard = (
    <View style={[entryStyles.card, { backgroundColor: palette.card, borderColor: palette.panelBorder }]} testID="issue-4490-hire-request-choice">
      {editing || place === null ? (
        <>
          <HireForm selection={selection} palette={palette} theme={theme} testID="issue-4490-hire-request-form" />
          {place !== null ? (
            <EntryButton palette={palette} theme={theme} variant="secondary" label="Done" onPress={() => setEditing(false)} testID="issue-4490-hire-request-done" />
          ) : null}
        </>
      ) : (
        <View style={styles.choiceRow}>
          <View style={styles.grow}>
            <Text style={[styles.row, themeBoldFace(theme), { color: palette.primaryText }]}>{place.placeName}</Text>
            <Text style={[styles.small, { color: palette.secondaryText }]}>
              {[
                selection.selectedDate !== null ? entryDateLabel(selection.selectedDate) : null,
                selection.isFlex && selection.startsAt !== null && selection.minutes !== null
                  ? `${venueClock(selection.startsAt, offer?.venue.timezone ?? null) ?? ""} for ${hourLengthWords(selection.minutes)}`
                  : session !== null
                    ? `${session.label}${session.times !== null ? ` ${session.times}` : ""}`
                    : null,
                `${selection.guests.toLocaleString("en-GB")} guests`,
                layout !== null && chosenRow?.layoutCapacities[layout] !== undefined
                  ? venueLayoutSummary(layout, chosenRow.layoutCapacities[layout] as number)
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </View>
          <EntryButton palette={palette} theme={theme} variant="secondary" label="Change" onPress={() => setEditing(true)} testID="issue-4490-hire-request-change" />
        </View>
      )}
    </View>
  );

  const onFieldFocus = (): void => {
    setFocused(true);
    revealFocusedField();
  };

  const aboutCard = (
    <View style={[entryStyles.card, { backgroundColor: palette.card, borderColor: palette.panelBorder }]} testID="issue-4490-hire-request-about">
      {availableLayouts.length > 0 ? (
        <>
          <EntrySectionLabel palette={palette}>How will you set up?</EntrySectionLabel>
          <OfferingChipRow accessibilityLabel="How will you set up?" testID="issue-4490-hire-request-layouts">
            {availableLayouts.map((row) => (
              <OfferingChoiceChip
                key={row.key}
                palette={palette}
                label={`${venueLayoutLabel(row.key)} · up to ${row.capacity.toLocaleString("en-GB")}`}
                selected={layout === row.key}
                onPress={() => setLayout(row.key)}
                role="radio"
                testID={`issue-4490-hire-layout-${row.key}`}
              />
            ))}
          </OfferingChipRow>
        </>
      ) : null}
      <EntrySectionLabel palette={palette}>The occasion</EntrySectionLabel>
      <OfferingChipRow accessibilityLabel="The occasion" testID="issue-4490-hire-request-occasion">
        {OCCASIONS.map((o) => (
          <OfferingChoiceChip
            key={o}
            palette={palette}
            label={o}
            selected={occasion === o}
            onPress={() => setOccasion(occasion === o ? null : o)}
            role="radio"
            testID={`issue-4490-hire-occasion-${o.replace(/\s+/g, "-").toLowerCase()}`}
          />
        ))}
      </OfferingChipRow>
      {offer?.overtimeMinorPerHour !== null && offer?.overtimeMinorPerHour !== undefined && !selection.isFlex ? (
        <>
          <EntrySectionLabel palette={palette}>Extra hours</EntrySectionLabel>
          <View style={styles.choiceRow}>
            <View style={styles.grow}>
              <Text style={[styles.row, { color: palette.primaryText }]}>{overtime === 0 ? "None" : `${overtime} ${overtime === 1 ? "hour" : "hours"} after the session`}</Text>
              <Text style={[styles.small, { color: palette.secondaryText }]}>{`${money(offer.overtimeMinorPerHour)} an hour`}</Text>
            </View>
            <OfferingStepper
              palette={palette}
              value={overtime}
              min={0}
              max={12}
              onChange={setOvertime}
              decrementLabel="One hour fewer"
              incrementLabel="One hour more"
              valueLabel={`${overtime} extra hours`}
              testID="issue-4490-hire-request-overtime"
            />
          </View>
        </>
      ) : null}
      {offer !== null && offer !== undefined ? (
        <ExtrasList
          palette={palette}
          theme={theme}
          extras={offer.extras}
          picked={pickedExtras}
          onToggle={(id) =>
            setPickedExtras((current) =>
              current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
            )
          }
          currencyCode={offer.currencyCode}
          exponent={offer.exponent}
          label="ADD TO YOUR BOOKING"
          testID="issue-4490-hire-request-extras"
        />
      ) : null}
      <EntrySectionLabel palette={palette}>{`Anything ${venueName} should know?`}</EntrySectionLabel>
      <Input
        value={note}
        onChangeText={(v) => setNote(v.slice(0, 500))}
        placeholder="e.g. A short awards moment at 7 PM. Is there a mic?"
        accessibilityLabel={`Anything ${venueName} should know`}
        onFocus={onFieldFocus}
        onBlur={() => setFocused(false)}
        testID="issue-4490-hire-request-note"
      />
      <Text style={[styles.caption, styles.left, { color: palette.tertiaryText }]}>{`${500 - note.length} characters left`}</Text>
      <Pressable
        onPress={() => setSiteVisit((v) => !v)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: siteVisit }}
        accessibilityLabel="I'd like to see the space first"
        style={styles.checkRow}
        testID="issue-4490-hire-request-site-visit"
      >
        <View style={[styles.checkBox, { borderColor: siteVisit ? palette.primaryText : hair, backgroundColor: siteVisit ? palette.primaryText : "transparent" }]}>
          {siteVisit ? <Icon name="check" size={14} color={palette.page} /> : null}
        </View>
        <Text style={[styles.small, { color: palette.primaryText }]}>I&apos;d like to see the space first</Text>
      </Pressable>
    </View>
  );

  const summaryCard = (
    <View style={[entryStyles.card, { backgroundColor: palette.card, borderColor: palette.panelBorder }]} testID="issue-4490-hire-request-summary">
      <Text style={[styles.venueName, themeBoldFace(theme), { color: palette.primaryText }]}>{venueName}</Text>
      {offer?.venue.address ? <Text style={[styles.small, { color: palette.secondaryText }]}>{venueAddressLine(offer.venue.address, offer.venue.city)}</Text> : null}
      <View style={[styles.rule, { backgroundColor: hair }]} />
      {q !== null ? (
        <>
          {hireSummaryLines(q, exponent).map((l) => (
            <View key={l.key} style={styles.line}>
              <Text style={[styles.small, styles.grow, { color: l.strong ? palette.primaryText : palette.secondaryText }]}>{l.label}</Text>
              <Text style={[l.strong ? styles.row : styles.small, { color: palette.primaryText }]}>{l.value}</Text>
            </View>
          ))}
          <View style={[styles.rule, { backgroundColor: hair }]} />
          {instant ? (
            <Text style={[styles.small, { color: palette.primaryText }]} testID="issue-4490-hire-request-pay-now">
              {`Pay ${money(hirePayNowMinor(q))} now to book ${selection.selectedDate !== null ? entryDateLabel(selection.selectedDate) : "your date"}.`}
            </Text>
          ) : (
            <Text style={[styles.small, { color: palette.primaryText }]} testID="issue-4490-hire-request-promise">
              {requestPromise(q, venueName, exponent)}
            </Text>
          )}
          {damageLine(q, exponent) !== null ? <Text style={[styles.caption, styles.left, { color: palette.tertiaryText }]}>{damageLine(q, exponent)}</Text> : null}
        </>
      ) : quote.status === "error" ? (
        <EntryNote palette={palette} icon="flag" tone="error" testID="issue-4490-hire-request-quote-error">
          {hireErrorCopy(quote.code, quote.detail)}
        </EntryNote>
      ) : (
        <Text style={[styles.small, { color: palette.secondaryText }]}>{selection.problem ?? "Working out your price…"}</Text>
      )}
    </View>
  );

  const ctaLabel = busy ? (instant ? "Opening payment…" : "Sending…") : instant ? (q !== null ? `Pay ${money(hirePayNowMinor(q))}` : "Pay") : "Send request";
  const cta = (
    <View style={styles.payBlock}>
      <EntryButton palette={palette} theme={theme} label={ctaLabel} onPress={() => void send()} disabled={blocker !== null} busy={busy} accessibilityLabel={ctaLabel} testID="issue-4490-hire-request-send" />
      <Text style={[styles.caption, { color: blocker !== null ? palette.secondaryText : palette.tertiaryText }]} testID="issue-4490-hire-request-reason">
        {blocker ?? (instant ? "Card, bank transfer or USSD on the secure payment page." : "Nothing is charged now. You'll get an email when they reply.")}
      </Text>
    </View>
  );

  const left = (
    <View style={styles.column}>
      {choiceCard}
      {aboutCard}
      {!wide ? summaryCard : null}
      <GuestDetailsCard
        details={details}
        palette={palette}
        theme={theme}
        disabled={busy}
        onFieldFocus={onFieldFocus}
        onFieldBlur={() => setFocused(false)}
        footnote="No account needed. The venue's reply and your booking link go to this email."
      />
      {errorCode !== null ? (
        <EntryNote palette={palette} icon="flag" tone="error" testID="issue-4490-hire-request-error-note">
          <Text style={[styles.small, { color: tones.error.text }]}>{hireErrorCopy(errorCode)}</Text>
        </EntryNote>
      ) : null}
      {cta}
    </View>
  );

  return (
    <View style={[styles.host, { backgroundColor: palette.page }]} testID="issue-4490-hire-request">
      <ScrollView
        style={styles.host}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingTop: props.safeTop + space[5], paddingBottom: props.safeBottom + (focused ? space[8] : space[10]) }]}
      >
        <View style={styles.backRow}>
          <Pressable
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel="Back to the venue"
            hitSlop={10}
            style={[styles.backButton, { backgroundColor: palette.card, borderColor: palette.panelBorder }]}
            testID="issue-4490-hire-request-back"
          >
            <Icon name="chevL" size={20} color={palette.primaryText} />
          </Pressable>
          <Text accessibilityRole="header" style={[styles.title, themeBoldFace(theme), { color: palette.primaryText }]}>
            {instant ? "Book private hire" : "Ask for private hire"}
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
  title: { ...type.title },
  twoCol: { flexDirection: "row", alignItems: "flex-start", gap: space[6] },
  leftCol: { flex: 1, minWidth: 0 },
  rightCol: { width: 380 },
  column: { gap: space[4] },
  venueName: { ...type.h2 },
  row: { ...type.row },
  small: { ...type.small },
  caption: { ...type.caption, textAlign: "center" },
  left: { textAlign: "left" },
  rule: { height: StyleSheet.hairlineWidth },
  payBlock: { gap: space[2] },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  choiceRow: { flexDirection: "row", alignItems: "center", gap: space[3], flexWrap: "wrap" },
  line: { flexDirection: "row", alignItems: "baseline", gap: space[3] },
  checkRow: { flexDirection: "row", alignItems: "center", gap: space[2], minHeight: size.btn.lg },
  checkBox: { width: 22, height: 22, borderRadius: radius.xs, borderWidth: 2, alignItems: "center", justifyContent: "center" },
});

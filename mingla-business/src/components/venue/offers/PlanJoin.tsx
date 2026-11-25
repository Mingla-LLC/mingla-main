/**
 * #4490 P6-3/K — joining a monthly or yearly plan (`pk-join`), signed out. What you get,
 * how you pay in three plain lines (today, each period, a skipped period), the
 * start day (a date strip, today up to 60 days ahead), name / email / phone,
 * and the first period's total with VAT. "Pay … and join" joins (the member
 * token is kept on this device only), then opens the secure payment page;
 * the payment page returns to the member page `/visit/plan/<id>?paid=1`
 * (no token in that address), which confirms the payment on return.
 *
 * Layout: two columns from 1024 px (form left, a 380 px summary right); one
 * column with the pay bar pinned below that on a phone (hidden while a field
 * has focus so the keyboard never covers it).
 */
import React, { useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useRouter } from "expo-router";
import { createThemePalette, resolveTheme, type ResolvedTheme, type ThemePalette } from "@mingla/offering-rendering";
import { boldFontFamily } from "@mingla/offering-rendering/themePalette";
import { themeBoldFace } from "@mingla/offering-rendering/themeAccentStyle";
import { OfferingGlassBar } from "@mingla/offering-rendering/OfferingGlassBar";
import { OfferingDateStrip, type OfferingDateTile } from "@mingla/offering-rendering/OfferingDecideParts";
import { formatVenueMoney } from "@mingla/brand-rendering/venueMoney";
import { addDays, entryDateLabel, venueToday } from "@mingla/brand-rendering/venueOffers/entryModel";

import { radius, size, space, type } from "../../../constants/designSystem";
import { usePublicVenueBySlug } from "../../../hooks/usePublicEvents";
import { usePublicVenueFeatures } from "../../../hooks/usePublicVenueFeatures";
import { VenueOfferGuestError } from "../../../services/venueOfferGuestService";
import { venueMembershipGuestService } from "../../../services/venueMembershipGuestService";
import { useThemeFont } from "../../../theme/useThemeFont";
import { randomId } from "../../../utils/randomId";
import { saveVenueOfferBookingToken, venueOfferCartKey } from "../../../utils/venueOfferBookingTokens";
import { ScrollView } from "../../../wrappers/SmartScrollView";
import { SecurePaymentHandoff } from "../../offering/LazyPublicParts";
import { Icon } from "../../ui/Icon";
import { EntryButton, EntryNote, EntryProblem, entryStyles } from "./EntryUi";
import { GuestDetailsCard, useGuestDetails } from "./GuestDetails";
import {
  howYouPayLines,
  memberGuestErrorCopy,
  memberPeriodRangeWords,
  memberPagePath,
  membershipJoinNeedsPayment,
  pctWords,
  planGiveLines,
  rememberVenueMember,
} from "./memberGuestModel";
import { revealFocusedField } from "./revealFocusedField";

const WIDE = 1024;
const BAR_CLEARANCE = 68 + space[6];
const START_DAYS = 21;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export interface PlanJoinProps {
  brandSlug: string;
  venueSlug: string;
  planId: string;
  safeTop: number;
  safeBottom: number;
}

export function PlanJoin({ brandSlug, venueSlug, planId, safeTop, safeBottom }: PlanJoinProps): React.ReactElement {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  const venueQuery = usePublicVenueBySlug(brandSlug, venueSlug);
  const pageQuery = usePublicVenueFeatures(brandSlug, venueSlug);
  const theme: ResolvedTheme = useMemo(() => resolveTheme(venueQuery.data?.theme ?? null, null), [venueQuery.data?.theme]);
  const palette: ThemePalette = useMemo(() => createThemePalette(theme), [theme]);
  useThemeFont(boldFontFamily(theme));
  const page = pageQuery.data ?? null;
  const plan = page?.memberships?.plans?.find((p) => p.id === planId) ?? null;
  const currency = page?.currencyCode ?? "NGN";
  const exponent = page?.minorUnitExponent ?? 2;
  const money = (m: number): string => formatVenueMoney(m, currency, exponent);
  const tz = venueQuery.data?.timezone ?? "Africa/Lagos";
  const today = venueToday(new Date(), tz);
  const [startOn, setStartOn] = useState<string>(today);
  const details = useGuestDetails({ countryCode: venueQuery.data?.countryCode ?? null, currencyCode: currency });
  const [cartKey] = useState(venueOfferCartKey);
  const joinKey = useRef(`venue-member:join:${randomId()}`);
  const [joined, setJoined] = useState<{ subscriptionId: string; token: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handoffUrl, setHandoffUrl] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  // #4490 06-W4 fix 1 (W4-N2): the server's charge for one payment (the page asks for exactly this).
  const total = plan?.charge ?? null;
  const periodEnd = (() => {
    const d = new Date(`${startOn}T12:00:00Z`);
    if (plan?.period === "year") d.setUTCFullYear(d.getUTCFullYear() + 1);
    else d.setUTCMonth(d.getUTCMonth() + 1);
    return d.toISOString().slice(0, 10);
  })();
  const fallbackShort = (iso: string): string => entryDateLabel(iso).replace(/^\w+ /, "");
  const firstPeriodRange = memberPeriodRangeWords(startOn, periodEnd, tz, { weekday: false })
    ?? `${fallbackShort(startOn)} to ${fallbackShort(periodEnd)}`;
  const firstPeriod = `your first ${plan?.period ?? "month"}, ${firstPeriodRange}`;
  const periodRange = memberPeriodRangeWords(startOn, periodEnd, tz, { weekday: false, separator: " – " })
    ?? `${fallbackShort(startOn)} – ${fallbackShort(periodEnd)}`;
  const blocker: string | null =
    pageQuery.isLoading || venueQuery.isLoading
      ? "Loading the plan…"
      : plan === null
        ? "This plan isn't on sale any more."
        : plan.full
          ? "This plan is full right now."
          : details.problem;

  const pay = async (): Promise<void> => {
    if (busy || plan === null) return;
    details.setTouched({ name: true, email: true, phone: true });
    if (blocker !== null) return;
    setBusy(true);
    setError(null);
    try {
      let current = joined;
      if (current === null) {
        const g = details.guest();
        const result = await venueMembershipGuestService.join({
          planId: plan.id,
          member: { name: g.name, email: g.email, ...(g.phone !== undefined && g.phone.length > 0 ? { phone: g.phone } : {}) },
          startOn: startOn === today ? null : startOn,
          cartKey,
          idempotencyKey: joinKey.current,
        });
        if (result.memberToken !== null) saveVenueOfferBookingToken(result.subscriptionId, result.memberToken);
        rememberVenueMember(brandSlug, venueSlug, result.subscriptionId);
        current = { subscriptionId: result.subscriptionId, token: result.memberToken };
        setJoined(current);
        if (!membershipJoinNeedsPayment(plan.joinMode, result.status)) {
          router.replace(memberPagePath(result.subscriptionId) as never);
          return;
        }
      }
      const payment = await venueMembershipGuestService.pay({
        subscriptionId: current.subscriptionId,
        token: current.token,
        idempotencyKey: `venue-member:pay:${randomId()}`,
      });
      setHandoffUrl(payment.authorizationUrl);
    } catch (caught) {
      const code = caught instanceof VenueOfferGuestError ? caught.code : "membership_request_failed";
      if (code === "membership_member_invalid" || code === "membership_payment_details_rejected") details.setEmailServerInvalid(true);
      if (code === "membership_already_member" || code === "offer_payment_already_pending") {
        if (joined !== null) {
          router.replace(memberPagePath(joined.subscriptionId) as never);
          return;
        }
      }
      if (code === "offer_idempotency_conflict") joinKey.current = `venue-member:join:${randomId()}`;
      setError(memberGuestErrorCopy(code));
    } finally {
      setBusy(false);
    }
  };

  const goBack = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace(`/b/${brandSlug}/v/${venueSlug}?tab=plans` as never);
  };

  if (handoffUrl !== null) {
    return (
      <View style={[styles.host, { backgroundColor: palette.page, paddingTop: safeTop + space[6] }]}>
        <View style={styles.handoff}>
          <SecurePaymentHandoff
            url={handoffUrl}
            palette={palette}
            holdLine="Your membership starts as soon as this payment goes through."
            onBack={() => setHandoffUrl(null)}
            testID="issue-4490-plan-secure-payment"
          />
        </View>
      </View>
    );
  }

  if (pageQuery.isError || (pageQuery.isSuccess && plan === null)) {
    return (
      <View style={[styles.host, styles.centered, { backgroundColor: palette.page }]}>
        <View style={styles.narrow}>
          <EntryProblem
            palette={palette}
            theme={theme}
            title={pageQuery.isError ? "We couldn't load this plan" : "This plan isn't on sale"}
            body={pageQuery.isError ? "Check your connection and try again." : "It may be full or no longer sold. See the venue's other plans."}
            actionLabel={pageQuery.isError ? "Try again" : "Back to the venue"}
            onAction={pageQuery.isError ? () => void pageQuery.refetch() : () => router.replace(`/b/${brandSlug}/v/${venueSlug}?tab=plans` as never)}
            testID="issue-4490-plan-join-error"
          />
        </View>
      </View>
    );
  }

  const tiles: OfferingDateTile[] = Array.from({ length: START_DAYS }, (_, i) => {
    const d = addDays(today, i);
    const dt = new Date(`${d}T12:00:00Z`);
    const dow = (dt.getUTCDay() + 6) % 7;
    return {
      key: d,
      top: i === 0 ? "Today" : DAYS[dow] ?? "",
      big: String(dt.getUTCDate()),
      bottom: MONTHS[dt.getUTCMonth()] ?? "",
      selected: d === startOn,
      accessibilityLabel: entryDateLabel(d),
    };
  });

  const gives = plan !== null ? planGiveLines(plan) : [];
  const steps = plan !== null
    ? plan.joinMode === "request"
      ? [
          { title: "Today", body: "Ask to join. Nothing is paid yet." },
          { title: "If approved", body: `We email you a link. Pay your first ${plan.period} within 3 days to start.` },
          { title: `Each ${plan.period} after`, body: `We email a payment link ${plan.renewalNoticeDays} days ahead. Nothing renews or is charged by itself.` },
        ]
      : howYouPayLines({ period: plan.period, firstPeriod, renewalNoticeDays: plan.renewalNoticeDays, graceDays: plan.graceDays, minMonths: plan.minMonths, noticeDays: plan.noticeDays })
    : [];
  const totalWords = total !== null ? money(total.totalMinor) : null;
  const payLabel = busy
    ? plan?.joinMode === "request" ? "Sending request…" : "Opening payment…"
    : plan?.joinMode === "request"
      ? "Ask to join"
      : totalWords !== null ? `Pay ${totalWords} and join` : "Join";

  const summaryCard = (
    <View style={[entryStyles.card, { backgroundColor: palette.card, borderColor: palette.panelBorder }]} testID="issue-4490-plan-join-summary">
      <Text style={[styles.venueName, themeBoldFace(theme), { color: palette.primaryText }]}>{venueQuery.data?.name ?? ""}</Text>
      {plan !== null && total !== null ? (
        <>
          <View style={styles.line}>
            <Text style={[styles.small, { color: palette.secondaryText }]}>{`${plan.name} · ${periodRange}`}</Text>
            <Text style={[styles.small, { color: palette.primaryText }]}>{money(total.baseMinor)}</Text>
          </View>
          {total.vatMode === "added" ? (
            <View style={styles.line}>
              <Text style={[styles.small, { color: palette.secondaryText }]}>{`VAT ${pctWords(total.vatRatePct)}`}</Text>
              <Text style={[styles.small, { color: palette.primaryText }]}>{money(total.taxMinor)}</Text>
            </View>
          ) : null}
          <View style={[styles.rule, { backgroundColor: palette.panelBorder }]} />
          <View style={styles.line}>
            <Text style={[styles.totalText, { color: palette.primaryText }]}>{plan.joinMode === "request" ? "First payment, if approved" : "Total today"}</Text>
            <Text style={[styles.totalText, { color: palette.primaryText }]}>{money(total.totalMinor)}</Text>
          </View>
          {total.vatMode === "included" ? (
            <Text style={[styles.caption, { color: palette.tertiaryText }]}>{`Includes VAT ${pctWords(total.vatRatePct)} (${money(total.taxMinor)})`}</Text>
          ) : null}
          <Text style={[styles.caption, { color: palette.tertiaryText }]}>
            {plan.joinMode === "request"
              ? "No payment is taken with your request. The venue approves first."
              : `Then ${money(total.totalMinor)} a ${plan.period}, paid from an emailed link.`}
          </Text>
        </>
      ) : plan !== null ? (
        // No server charge in the answer (an older server): the plan's own price only, never a total worked out here.
        <View style={styles.line}>
          <Text style={[styles.small, { color: palette.secondaryText }]}>{`${plan.name} · ${periodRange}`}</Text>
          <Text style={[styles.small, { color: palette.primaryText }]}>{money(plan.priceMinor)}</Text>
        </View>
      ) : (
        <Text style={[styles.small, { color: palette.secondaryText }]}>Loading the plan…</Text>
      )}
    </View>
  );

  const left = (
    <View style={styles.column}>
      <View style={[entryStyles.card, { backgroundColor: palette.card, borderColor: palette.panelBorder }]} testID="issue-4490-plan-join-gives">
        <Text style={[styles.label, { color: palette.tertiaryText }]}>WHAT YOU GET</Text>
        {gives.length > 0 ? (
          gives.map((g) => (
            <View key={g} style={styles.giveRow}>
              <Icon name="check" size={18} color={palette.primaryText} />
              <Text style={[styles.body, { color: palette.primaryText }]}>{g}</Text>
            </View>
          ))
        ) : (
          <Text style={[styles.small, { color: palette.secondaryText }]}>Ask the venue what this plan includes.</Text>
        )}
      </View>
      <View style={[entryStyles.card, { backgroundColor: palette.card, borderColor: palette.panelBorder }]} testID="issue-4490-plan-join-how">
        <Text style={[styles.label, { color: palette.tertiaryText }]}>HOW YOU PAY</Text>
        {steps.map((s, i) => (
          <View key={s.title} style={styles.step}>
            <View style={[styles.dot, { borderColor: palette.primaryText, backgroundColor: i === 0 ? palette.primaryText : "transparent" }]} />
            <View style={styles.stepText}>
              <Text style={[styles.body, themeBoldFace(theme), { color: palette.primaryText }]}>{s.title}</Text>
              <Text style={[styles.small, { color: palette.secondaryText }]}>{s.body}</Text>
            </View>
          </View>
        ))}
      </View>
      <View style={[entryStyles.card, { backgroundColor: palette.card, borderColor: palette.panelBorder }]}>
        <Text style={[styles.label, { color: palette.tertiaryText }]}>START ON</Text>
        <OfferingDateStrip
          palette={palette}
          tiles={tiles}
          onPress={setStartOn}
          fontFamily={themeBoldFace(theme).fontFamily}
          accessibilityLabel="Choose the day your membership starts"
          testID="issue-4490-plan-join-start"
        />
        <Text style={[styles.small, { color: palette.secondaryText }]}>
          {plan?.joinMode === "request"
            ? `Requested start: ${entryDateLabel(startOn)}. The venue replies before you pay.`
            : startOn === today ? "Starts today, as soon as you've paid." : `Starts ${entryDateLabel(startOn)}. You pay for the first ${plan?.period ?? "month"} now.`}
        </Text>
      </View>
      {!wide ? summaryCard : null}
      <GuestDetailsCard
        details={details}
        palette={palette}
        theme={theme}
        disabled={busy}
        onFieldFocus={() => {
          setFocused(true);
          revealFocusedField();
        }}
        onFieldBlur={() => setFocused(false)}
        footnote="No account needed. Your member pass and payment emails go to this email."
        testID="issue-4490-plan-join-details"
      />
      {error !== null ? (
        <EntryNote palette={palette} icon="flag" tone="error" testID="issue-4490-plan-join-pay-error">
          {error}
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
          testID="issue-4490-plan-join-pay"
        />
        <Text style={[styles.caption, styles.center, { color: palette.tertiaryText }]} testID="issue-4490-plan-join-reason">
          {blocker ?? (plan?.joinMode === "request" ? `${venueQuery.data?.name ?? "The venue"} will reply before any payment.` : "No card is saved. Card, bank transfer or USSD on the secure payment page.")}
        </Text>
      </View>
    </View>
  );

  const showBar = !wide && !focused && totalWords !== null;
  return (
    <View style={[styles.host, { backgroundColor: palette.page }]} testID="issue-4490-plan-join">
      <ScrollView
        style={styles.host}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingTop: safeTop + space[5], paddingBottom: safeBottom + (showBar ? BAR_CLEARANCE + space[6] : space[8]) }]}
      >
        <View style={styles.backRow}>
          <Pressable
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel="Back to the venue"
            style={[styles.backButton, { backgroundColor: palette.card, borderColor: palette.panelBorder }]}
            testID="issue-4490-plan-join-back"
          >
            <Icon name="chevL" size={20} color={palette.primaryText} />
          </Pressable>
          <Text accessibilityRole="header" style={[styles.title, themeBoldFace(theme), { color: palette.primaryText }]}>
            {plan !== null ? `Join: ${plan.name}` : "Join"}
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
      {showBar ? (
        <View style={[styles.barDock, { paddingBottom: safeBottom + space[3] }]} pointerEvents="box-none">
          <OfferingGlassBar
            palette={palette}
            theme={theme}
            title={totalWords ?? ""}
            subtitle={plan?.joinMode === "request" ? "No payment today" : `First ${plan?.period ?? "month"} today`}
            ctaLabel={busy ? (plan?.joinMode === "request" ? "Sending…" : "Opening…") : plan?.joinMode === "request" ? "Ask to join" : "Pay and join"}
            onPress={() => void pay()}
            enabled={blocker === null && !busy}
            ctaAccessibilityLabel={payLabel}
            style={styles.bar}
            testID="issue-4490-plan-join-bar"
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
  backButton: { width: size.iconBtn.md, height: size.iconBtn.md, minWidth: 44, minHeight: 44, borderRadius: radius.full, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  title: { ...type.title, flexShrink: 1 },
  twoCol: { flexDirection: "row", alignItems: "flex-start", gap: space[6] },
  leftCol: { flex: 1, minWidth: 0 },
  rightCol: { width: 380 },
  column: { gap: space[4] },
  venueName: { ...type.h2 },
  label: { ...type.label },
  body: { ...type.body, flexShrink: 1 },
  small: { ...type.small, flexShrink: 1 },
  caption: { ...type.caption },
  center: { textAlign: "center" },
  totalText: { ...type.body, fontWeight: "700" },
  rule: { height: StyleSheet.hairlineWidth },
  line: { flexDirection: "row", justifyContent: "space-between", gap: space[3] },
  giveRow: { flexDirection: "row", alignItems: "flex-start", gap: space[2] },
  step: { flexDirection: "row", alignItems: "flex-start", gap: space[3] },
  dot: { width: 12, height: 12, borderRadius: radius.full, borderWidth: 2, marginTop: space[1] },
  stepText: { flex: 1, minWidth: 0, gap: 2 },
  payBlock: { gap: space[2] },
  barDock: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: space[4] },
  bar: { width: "100%", maxWidth: 620, alignSelf: "center" },
});

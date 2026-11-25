/**
 * #4490 P6-3 — the member page `/visit/plan/<id>` (`pkm-pass`): the member's
 * name, the status in plain words, the pass to show at the front desk (QR,
 * the plan and paid period), what's left this period (room hours, guest passes),
 * when it renews and when the payment email goes out, the period to pay
 * ("Pay ₦X", "Pay ₦X to start again", "Pay ₦X and start"), payments made,
 * book a room, leave / stay on, pause / resume.
 *
 * ANON: the member token (kept on this device, or arriving once in the `#t=`
 * fragment of a member email, then scrubbed from the address) is the key.
 * `?paid=1` marks a return from the secure payment page: the page confirms the
 * payment, polls while it is in flight, and scrubs the address.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useRouter } from "expo-router";
import {
  createThemePalette,
  resolveTheme,
  type ResolvedTheme,
  type ThemePalette,
} from "@mingla/offering-rendering";
import { boldFontFamily, statusOn } from "@mingla/offering-rendering/themePalette";
import { themeBoldFace } from "@mingla/offering-rendering/themeAccentStyle";
import { formatVenueMoney } from "@mingla/brand-rendering/venueMoney";

import { radius, size, space, type } from "../../../constants/designSystem";
import { usePublicVenueBySlug } from "../../../hooks/usePublicEvents";
import { usePublicVenueFeatures } from "../../../hooks/usePublicVenueFeatures";
import { VenueOfferGuestError } from "../../../services/venueOfferGuestService";
import { venueMembershipGuestService } from "../../../services/venueMembershipGuestService";
import { useThemeFont } from "../../../theme/useThemeFont";
import { randomId } from "../../../utils/randomId";
import { formatVenueMemberCode } from "../../../utils/venueMemberCode";
import {
  adoptFragmentToken,
  readVenueOfferBookingToken,
  scrubVisitAddress,
} from "../../../utils/venueOfferBookingTokens";
import { ScrollView } from "../../../wrappers/SmartScrollView";
import { SecurePaymentHandoff } from "../../offering/LazyPublicParts";
import { Icon, type IconName } from "../../ui/Icon";
import { EntryButton, EntryNote, EntryProblem, entryStyles } from "./EntryUi";
import { VenueOfferPassQr } from "./VenueOfferPassQr";
import { VenueClaimCard, VenuePassInAppBlock, parseVenueHandoff, type VenueHandoff } from "./VenueAppHandoff";
import {
  forgetVenueMember,
  guestMemberState,
  hoursLeftWords,
  memberDayWords,
  memberGuestErrorCopy,
  membershipBenefitsAvailable,
  monthWords,
  parseGuestMember,
  payLabel,
  pctWords,
  planGiveLines,
  rememberVenueMember,
  type GuestMember,
} from "./memberGuestModel";

const POLL_MS = 2500;
const POLL_WINDOW_MS = 30_000;
const WIDE = 1024;

type Load =
  | { status: "loading" }
  | { status: "not_found"; code: string }
  | { status: "error"; code: string }
  | { status: "ready"; member: GuestMember };

type Confirm = "idle" | "polling" | "timed_out" | "failed" | "not_paid" | "confirmed";

export interface VisitMembershipProps {
  subscriptionId: string;
  paidReturn: boolean;
  safeTop: number;
  safeBottom: number;
}

export function VisitMembership({ subscriptionId, paidReturn, safeTop, safeBottom }: VisitMembershipProps): React.ReactElement {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [confirm, setConfirm] = useState<Confirm>(paidReturn ? "polling" : "idle");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [handoffUrl, setHandoffUrl] = useState<string | null>(null);
  const [asking, setAsking] = useState<"leave" | "pause" | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    const fromFragment = adoptFragmentToken(subscriptionId);
    setToken(fromFragment ?? readVenueOfferBookingToken(subscriptionId));
  }, [subscriptionId]);

  // #4490 Explorer W1: the app handoff and the app-only pass switch, read off each member read.
  const [handoff, setHandoff] = useState<VenueHandoff>({ shortUrl: null, code: null, passInApp: false, texted: false, textsLeft: null });
  const apply = useCallback((raw: unknown): GuestMember | null => {
    setHandoff(parseVenueHandoff(raw));
    const member = parseGuestMember(raw);
    if (member !== null) {
      setLoad({ status: "ready", member });
      if (member.venue.brandSlug !== null && member.venue.slug !== null) {
        if (member.status === "cancelled") forgetVenueMember(member.venue.brandSlug, member.venue.slug);
        else rememberVenueMember(member.venue.brandSlug, member.venue.slug, member.subscriptionId);
      }
    }
    return member;
  }, []);

  const read = useCallback(async (): Promise<void> => {
    if (token === undefined) return;
    try {
      const member = apply(await venueMembershipGuestService.get({ subscriptionId, token }));
      if (member === null) setLoad({ status: "error", code: "membership_request_failed" });
    } catch (caught) {
      const code = caught instanceof VenueOfferGuestError ? caught.code : "membership_request_failed";
      setLoad(
        code === "membership_not_found" || code === "membership_token_required" || code === "invalid_request"
          ? { status: "not_found", code }
          : { status: "error", code },
      );
    }
  }, [apply, subscriptionId, token]);

  // ── back from paying: confirm, then poll while it is in flight ──────────
  const startedAt = useRef<number>(Date.now());
  const confirmOnce = useCallback(async (): Promise<"done" | "pending"> => {
    if (token === undefined) return "pending";
    try {
      const result = await venueMembershipGuestService.confirmReturn({ subscriptionId, token });
      apply(result.member);
      if (result.outcome === "pending") return "pending";
      setConfirm(result.outcome === "failed" ? "failed" : result.outcome === "not_paid" ? "not_paid" : result.outcome === "confirmed" ? "confirmed" : "idle");
      return "done";
    } catch (caught) {
      const code = caught instanceof VenueOfferGuestError ? caught.code : "membership_request_failed";
      if (code === "membership_not_found" || code === "membership_token_required") {
        setLoad({ status: "not_found", code });
        setConfirm("idle");
        return "done";
      }
      return "pending";
    }
  }, [apply, subscriptionId, token]);

  useEffect(() => {
    if (token === undefined) return undefined;
    if (!paidReturn) {
      void read();
      return undefined;
    }
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

  const member = load.status === "ready" ? load.member : null;
  const venueQuery = usePublicVenueBySlug(member?.venue.brandSlug ?? null, member?.venue.slug ?? null);
  const pageQuery = usePublicVenueFeatures(member?.venue.brandSlug ?? null, member?.venue.slug ?? null);
  const theme: ResolvedTheme = useMemo(() => resolveTheme(venueQuery.data?.theme ?? null, null), [venueQuery.data?.theme]);
  const palette: ThemePalette = useMemo(() => createThemePalette(theme), [theme]);
  useThemeFont(boldFontFamily(theme));
  const tones = statusOn(palette);
  const page = pageQuery.data ?? null;
  const currency = member?.plan.currencyCode ?? page?.currencyCode ?? "NGN";
  const membershipPeriod = member?.plan.period ?? "month";
  const exponent = page?.minorUnitExponent ?? 2;
  const money = (m: number): string => formatVenueMoney(m, currency, exponent);
  const venuePath = member?.venue.brandSlug && member.venue.slug ? `/b/${member.venue.brandSlug}/v/${member.venue.slug}` : null;

  const pay = async (): Promise<void> => {
    if (busy !== null) return;
    setBusy("pay");
    setActionError(null);
    try {
      const payment = await venueMembershipGuestService.pay({ subscriptionId, token: token ?? null, idempotencyKey: `venue-member:pay:${randomId()}` });
      setHandoffUrl(payment.authorizationUrl);
    } catch (caught) {
      const code = caught instanceof VenueOfferGuestError ? caught.code : "membership_request_failed";
      setActionError(memberGuestErrorCopy(code, membershipPeriod));
      void read();
    } finally {
      setBusy(null);
    }
  };

  const act = async (action: "membership_leave" | "membership_stay" | "membership_pause" | "membership_resume", message: string): Promise<void> => {
    if (busy !== null) return;
    setBusy(action);
    setActionError(null);
    setDone(null);
    try {
      apply(await venueMembershipGuestService.act({ subscriptionId, token: token ?? null, action, idempotencyKey: `venue-member:${action}:${randomId()}` }));
      setAsking(null);
      setDone(message);
    } catch (caught) {
      setActionError(memberGuestErrorCopy(caught instanceof VenueOfferGuestError ? caught.code : null, membershipPeriod));
      void read();
    } finally {
      setBusy(null);
    }
  };

  const checkPayment = async (): Promise<void> => {
    if (busy !== null) return;
    setBusy("check");
    setActionError(null);
    try {
      const outcome = await confirmOnce();
      if (outcome === "pending") setActionError("We haven't heard back about that payment yet. If you finished paying, check again in a minute.");
    } finally {
      setBusy(null);
    }
  };

  const shell = (children: React.ReactNode): React.ReactElement => (
    <View style={[styles.host, { backgroundColor: palette.page }]} testID="issue-4490-member-page">
      <ScrollView style={styles.host} contentContainerStyle={[styles.content, { paddingTop: safeTop + space[6], paddingBottom: safeBottom + space[8] }]}>
        {member !== null ? <Text style={[styles.eyebrow, { color: palette.tertiaryText }]}>{member.venue.name.toUpperCase()}</Text> : null}
        {children}
      </ScrollView>
    </View>
  );

  if (load.status === "loading" || token === undefined || (confirm === "polling" && member === null)) {
    return shell(
      <View style={styles.center} accessibilityLiveRegion="polite" testID="issue-4490-member-loading">
        <ActivityIndicator color={palette.primaryText} />
        <Text style={[styles.body, { color: palette.secondaryText }]}>{paidReturn ? "Confirming your payment…" : "Opening your membership…"}</Text>
      </View>,
    );
  }
  if (load.status === "not_found") {
    return shell(
      <View style={styles.hero} testID="issue-4490-member-not-found">
        <Text style={[styles.title, themeBoldFace(theme), { color: palette.primaryText }]} accessibilityRole="header">
          We couldn&apos;t open this membership
        </Text>
        <Text style={[styles.body, { color: palette.secondaryText }]}>
          {load.code === "membership_token_required"
            ? "Open this page from the button in your latest membership email. It works on any device."
            : "The link may be wrong or out of date. Open it from the button in your latest membership email."}
        </Text>
        <EntryButton palette={palette} theme={theme} variant="secondary" label="Try again" onPress={() => void read()} testID="issue-4490-member-retry" />
      </View>,
    );
  }
  if (load.status === "error" || member === null) {
    return shell(
      <EntryProblem
        palette={palette}
        theme={theme}
        title="Your membership couldn't load"
        body={memberGuestErrorCopy(load.status === "error" ? load.code : null)}
        actionLabel="Try again"
        onAction={() => void read()}
        testID="issue-4490-member-error"
      />,
    );
  }

  if (handoffUrl !== null) {
    return shell(
      <SecurePaymentHandoff
        url={handoffUrl}
        palette={palette}
        holdLine="Your membership updates as soon as this payment goes through."
        onBack={() => setHandoffUrl(null)}
        testID="issue-4490-member-secure-payment"
      />,
    );
  }

  const tz = member.venue.timezone;
  const day = (iso: string | null | undefined): string =>
    memberDayWords(iso ?? null, tz, { year: member.plan.period === "year" }) ?? "—";
  const state = guestMemberState(member);
  const due = member.paymentDue;
  // #4490 06-W4 fix 1 (W4-N2): the server's amount due and its breakdown (what the page charges).
  const total = due?.charge ?? null;
  const totalWords = due !== null ? money(due.amountMinor) : null;
  const passPeriod = member.plan.period === "year" && member.activeUntil !== null
    ? `Paid until ${day(member.activeUntil)}`
    : monthWords(member.currentPeriodStart ?? member.activeUntil, tz);
  const toneInk = state.tone === "success" ? tones.success.text : state.tone === "warning" ? tones.warning.text : state.tone === "error" ? tones.error.text : palette.primaryText;
  const hourTab = page?.features.includes("by_the_hour") === true && page.offers.some((o) => o.kind === "by_the_hour");
  const canBookRoom = membershipBenefitsAvailable(member.status)
    && hourTab
    && (member.plan.roomHours > 0 || member.plan.discountKinds.includes("by_the_hour"));
  const gives = planGiveLines(member.plan);
  const memberCode = formatVenueMemberCode(member.memberCode);

  const statusCard = (
    <View style={[entryStyles.card, { backgroundColor: palette.card, borderColor: palette.panelBorder }]} testID="issue-4490-member-status">
      <View style={styles.statusHead}>
        <Text style={[styles.pill, { color: toneInk, borderColor: toneInk }]}>{state.label}</Text>
      </View>
      <Text style={[styles.cardTitle, themeBoldFace(theme), { color: palette.primaryText }]}>{state.title}</Text>
      <Text style={[styles.small, { color: palette.secondaryText }]}>{state.line}</Text>
      {confirm === "confirmed" ? (
        <EntryNote palette={palette} icon="check" tone="success" testID="issue-4490-member-paid">
          {`Paid. A receipt is on its way to your email.`}
        </EntryNote>
      ) : confirm === "failed" ? (
        <EntryNote palette={palette} icon="flag" tone="error" testID="issue-4490-member-pay-failed">
          That payment didn&apos;t go through. Nothing was taken. Try again below.
        </EntryNote>
      ) : confirm === "not_paid" ? (
        <EntryNote palette={palette} icon="flag" tone="error" testID="issue-4490-member-not-paid">
          You left the payment page before paying. Nothing was taken. Pay again whenever you&apos;re ready.
        </EntryNote>
      ) : confirm === "timed_out" ? (
        <EntryNote palette={palette} icon="clock" testID="issue-4490-member-pay-slow">
          We haven&apos;t heard back about your payment yet. If you paid, it shows here in a few minutes.
        </EntryNote>
      ) : null}
      {done !== null ? (
        <EntryNote palette={palette} icon="check" tone="success" testID="issue-4490-member-done">
          {done}
        </EntryNote>
      ) : null}
      {actionError !== null ? (
        <EntryNote palette={palette} icon="flag" tone="error" testID="issue-4490-member-error-note">
          {actionError}
        </EntryNote>
      ) : null}
    </View>
  );

  const payCard =
    due !== null && member.status !== "cancelled" ? (
      <View style={[entryStyles.card, { backgroundColor: palette.card, borderColor: palette.panelBorder }]} testID="issue-4490-member-pay">
        <Text style={[styles.label, { color: palette.tertiaryText }]}>{member.status === "pending" ? `YOUR FIRST ${member.plan.period.toUpperCase()}` : `THIS ${member.plan.period.toUpperCase()}`}</Text>
        <View style={styles.line}>
          <Text style={[styles.small, { color: palette.secondaryText }]}>{`${member.plan.name} · ${day(due.periodStart)} to ${day(due.periodEnd)}`}</Text>
          <Text style={[styles.small, { color: palette.primaryText }]}>{money(total?.baseMinor ?? due.amountMinor)}</Text>
        </View>
        {total !== null && total.vatMode === "added" ? (
          <View style={styles.line}>
            <Text style={[styles.small, { color: palette.secondaryText }]}>{`VAT ${pctWords(total.vatRatePct)}`}</Text>
            <Text style={[styles.small, { color: palette.primaryText }]}>{money(total.taxMinor)}</Text>
          </View>
        ) : null}
        {totalWords !== null ? (
          <View style={styles.line}>
            <Text style={[styles.totalText, { color: palette.primaryText }]}>Total</Text>
            <Text style={[styles.totalText, { color: palette.primaryText }]}>{totalWords}</Text>
          </View>
        ) : null}
        {due.paying ? (
          <>
            <EntryNote palette={palette} icon="clock">{`A payment for this ${member.plan.period} is open. Finish it, or check whether it went through.`}</EntryNote>
            <EntryButton palette={palette} theme={theme} variant="secondary" label="I've paid: check now" onPress={() => void checkPayment()} busy={busy === "check"} testID="issue-4490-member-check" />
          </>
        ) : (
          <EntryButton palette={palette} theme={theme} label={busy === "pay" ? "Opening payment…" : payLabel(member, totalWords)} onPress={() => void pay()} busy={busy === "pay"} testID="issue-4490-member-pay-button" />
        )}
        <Text style={[styles.caption, { color: palette.tertiaryText }]}>Card, bank transfer or USSD on the secure payment page. No card is saved.</Text>
      </View>
    ) : null;

  const passCard =
    member.pass !== null ? (
      <View style={[entryStyles.card, styles.passCard, { backgroundColor: palette.card, borderColor: palette.panelBorder }]} testID="issue-4490-member-pass">
        <View style={member.pass.valid ? null : styles.dim}>
          <VenueOfferPassQr payload={member.pass.qrPayload} size={wide ? 200 : 220} testID="issue-4490-member-qr" />
        </View>
        {memberCode !== null ? (
          <Text style={[styles.memberCode, { color: palette.primaryText }]} testID="issue-4490-member-code">
            {`Can’t scan? Your code: ${memberCode}`}
          </Text>
        ) : null}
        <Text style={[styles.cardTitle, themeBoldFace(theme), { color: palette.primaryText }]}>
          {`${member.plan.name}${passPeriod !== null && member.pass.valid ? ` · ${passPeriod}` : ""}`}
        </Text>
        <Text style={[styles.small, styles.centerText, { color: member.pass.valid ? palette.secondaryText : tones.error.text }]}>
          {member.pass.valid
            ? member.inToday
              ? "You're checked in today."
              : "Show this at the front desk"
            : member.status === "pending"
              ? `Your pass opens the door once your first ${member.plan.period} is paid.`
              : member.startOn !== null && Date.parse(`${member.startOn}T23:59:59Z`) > Date.now() && member.status === "active"
                ? `Your pass works from ${day(member.startOn)}.`
                : `Your pass won't open the door until this ${member.plan.period} is paid.`}
        </Text>
      </View>
    ) : handoff.passInApp && member.status !== "requested" && member.status !== "declined" ? (
      <VenuePassInAppBlock palette={palette} theme={theme} />
    ) : null;
  const claimCard = (
    <VenueClaimCard
      handoff={handoff}
      kind="pass"
      email={member.memberEmail ?? null}
      phone={null}
      analyticsSurface="venue_visit_membership"
      brandSlug={member.venue.brandSlug}
      venueSlug={member.venue.slug}
    />
  );

  const factsCard = member.status !== "cancelled" ? (
    <View style={[entryStyles.card, { backgroundColor: palette.card, borderColor: palette.panelBorder }]} testID="issue-4490-member-facts">
      {member.credits.roomHoursPerMonth > 0 ? (
        <Fact palette={palette} label="Meeting rooms" value={`${hoursLeftWords(member.credits.roomHoursLeft).replace(/ (hours|hour|minutes)$/, "")} of ${hoursLeftWords(member.credits.roomHoursPerMonth)} left`} />
      ) : null}
      {member.credits.guestPassesPerMonth > 0 ? (
        <Fact palette={palette} label="Guest passes" value={`${member.credits.guestPassesLeft} left`} />
      ) : null}
      {member.assignedSpace !== null ? <Fact palette={palette} label="Your desk" value={member.assignedSpace.name} /> : null}
      {member.activeUntil !== null ? <Fact palette={palette} label="Paid until" value={day(member.activeUntil)} /> : null}
      {member.renewsOn !== null && (member.status === "active" || member.status === "payment_due" || member.status === "grace") && Date.parse(member.renewsOn) > Date.now() - 86_400_000 ? (
        <Fact
          palette={palette}
          label="Renews"
          value={`${day(member.renewsOn)}${member.renewalEmailOn !== null && Date.parse(member.renewalEmailOn) > Date.now() ? ` · email on ${day(member.renewalEmailOn)}` : ""}`}
        />
      ) : null}
      {member.startedAt !== null ? <Fact palette={palette} label="Member since" value={day(member.startedAt)} /> : null}
      {member.terms.minMonths !== null && member.terms.minMonths > 1 ? <Fact palette={palette} label="Minimum" value={member.plan.period === "year" ? "1 year" : `${member.terms.minMonths} months`} /> : null}
    </View>
  ) : null;

  const actionsCard = (
    <View style={[entryStyles.card, styles.actions, { backgroundColor: palette.card, borderColor: palette.panelBorder }]} testID="issue-4490-member-actions">
      {canBookRoom && venuePath !== null ? (
        <ActionRow palette={palette} icon="clock" label="Book a meeting room" detail={member.credits.roomHoursLeft > 0 ? `${hoursLeftWords(member.credits.roomHoursLeft)} included left` : "Member price"} onPress={() => router.push(`${venuePath}?tab=by_the_hour` as never)} testID="issue-4490-member-book-room" />
      ) : null}
      {member.credits.guestPassesLeft > 0 && member.status !== "cancelled" ? (
        <View style={styles.infoRow}>
          <Icon name="users" size={20} color={palette.primaryText} />
          <Text style={[styles.small, styles.grow, { color: palette.secondaryText }]}>
            {`Bring a guest: tell the front desk when you check in. It uses a guest pass (${member.credits.guestPassesLeft} left this ${member.plan.period}).`}
          </Text>
        </View>
      ) : null}
      {member.canResume ? (
        <ActionRow palette={palette} icon="play" label={member.status === "paused" ? "Start again" : "Don't pause"} detail={member.status === "paused" ? `Pay for a ${member.plan.period} to start` : null} onPress={() => void act("membership_resume", member.status === "paused" ? "Pay below to start again." : "You won't pause. Your next payment email comes as usual.")} testID="issue-4490-member-resume" />
      ) : null}
      {member.canPause && asking !== "pause" ? (
        <ActionRow palette={palette} icon="pause" label={`Pause after this ${member.plan.period}`} detail={null} onPress={() => { setAsking("pause"); setDone(null); }} testID="issue-4490-member-pause" />
      ) : null}
      {asking === "pause" ? (
        <AskBox
          palette={palette}
          theme={theme}
          text={`Your pass works until ${day(member.activeUntil)}, then your membership pauses. No payment email goes out for the next ${member.plan.period}. Start again any time by paying for a ${member.plan.period}.`}
          confirmLabel={`Pause after this ${member.plan.period}`}
          busy={busy === "membership_pause"}
          onConfirm={() => void act("membership_pause", `You'll pause on ${day(member.activeUntil)}.`)}
          onCancel={() => setAsking(null)}
          testID="issue-4490-member-pause-ask"
        />
      ) : null}
      {member.canStay ? (
        <ActionRow palette={palette} icon="check" label="Stay on" detail={member.leaving !== null ? `Instead of leaving ${day(member.leaving.endsAt)}` : null} onPress={() => void act("membership_stay", "You're staying on. Your next payment email comes as usual.")} testID="issue-4490-member-stay" />
      ) : null}
      {member.canLeave && asking !== "leave" ? (
        <ActionRow palette={palette} icon="logout" label={member.status === "pending" ? "Cancel joining" : "Leave"} detail={member.status === "pending" ? "Nothing has been paid" : `At the end of a paid ${member.plan.period}`} onPress={() => { setAsking("leave"); setDone(null); }} testID="issue-4490-member-leave" />
      ) : null}
      {asking === "leave" ? (
        <AskBox
          palette={palette}
          theme={theme}
          text={
            member.status === "pending"
              ? "Your membership closes now. Nothing has been paid and nothing is owed."
              : `You leave at the end of a paid ${member.plan.period}${member.terms.noticeDays !== null && member.terms.noticeDays > 0 ? ` with ${member.terms.noticeDays} days' notice` : ""}${member.terms.minMonths !== null && member.terms.minMonths > 1 ? ` (after your ${member.plan.period === "year" ? "1-year" : `${member.terms.minMonths}-month`} minimum)` : ""}. Your pass works as usual until then, and nothing more is owed. You can change your mind before then.`
          }
          confirmLabel={member.status === "pending" ? "Cancel joining" : "Leave"}
          busy={busy === "membership_leave"}
          onConfirm={() => void act("membership_leave", member.status === "pending" ? "Your membership is closed." : "Done. You'll see your last day above.")}
          onCancel={() => setAsking(null)}
          testID="issue-4490-member-leave-ask"
        />
      ) : null}
      {venuePath !== null ? (
        <ActionRow palette={palette} icon="location" label={`Open ${member.venue.name}`} detail={null} onPress={() => router.push(venuePath as never)} testID="issue-4490-member-venue" />
      ) : null}
    </View>
  );

  const includesCard = gives.length > 0 && member.status !== "cancelled" ? (
    <View style={[entryStyles.card, { backgroundColor: palette.card, borderColor: palette.panelBorder }]}>
      <Text style={[styles.label, { color: palette.tertiaryText }]}>YOUR PLAN</Text>
      {gives.map((g) => (
        <Text key={g} style={[styles.small, { color: palette.primaryText }]}>{`• ${g}`}</Text>
      ))}
    </View>
  ) : null;

  const title = (
    <Text style={[styles.title, themeBoldFace(theme), { color: palette.primaryText }]} accessibilityRole="header">
      {member.memberName}
    </Text>
  );

  if (wide) {
    return shell(
      <>
        {title}
        <View style={styles.twoCol}>
          <View style={styles.leftCol}>
            {statusCard}
            {payCard}
            {factsCard}
            {includesCard}
            {actionsCard}
          </View>
          <View style={styles.rightCol}>{passCard}{claimCard}</View>
        </View>
      </>,
    );
  }
  return shell(
    <View style={styles.column}>
      {title}
      {statusCard}
      {payCard}
      {passCard}
      {claimCard}
      {factsCard}
      {includesCard}
      {actionsCard}
    </View>,
  );
}

function Fact({ palette, label, value }: { palette: ThemePalette; label: string; value: string }): React.ReactElement {
  return (
    <View style={styles.line}>
      <Text style={[styles.small, { color: palette.secondaryText }]}>{label}</Text>
      <Text style={[styles.small, styles.factValue, { color: palette.primaryText }]}>{value}</Text>
    </View>
  );
}

function AskBox({
  palette,
  theme,
  text,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
  testID,
}: {
  palette: ThemePalette;
  theme: ResolvedTheme;
  text: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testID: string;
}): React.ReactElement {
  return (
    <View style={[styles.ask, { borderColor: palette.panelBorder }]} testID={testID}>
      <Text style={[styles.small, { color: palette.primaryText }]}>{text}</Text>
      <EntryButton palette={palette} theme={theme} label={confirmLabel} onPress={onConfirm} busy={busy} testID={`${testID}-confirm`} />
      <EntryButton palette={palette} theme={theme} variant="secondary" label="Keep my membership" onPress={onCancel} testID={`${testID}-cancel`} />
    </View>
  );
}

function ActionRow({ palette, icon, label, detail, onPress, testID }: { palette: ThemePalette; icon: IconName; label: string; detail: string | null; onPress: () => void; testID?: string }): React.ReactElement {
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
  small: { ...type.small, flexShrink: 1 },
  caption: { ...type.caption },
  label: { ...type.label },
  centerText: { textAlign: "center" },
  cardTitle: { ...type.h2 },
  column: { gap: space[4] },
  twoCol: { flexDirection: "row", alignItems: "flex-start", gap: space[6] },
  leftCol: { flex: 1, minWidth: 0, gap: space[4] },
  rightCol: { width: 380 },
  passCard: { alignItems: "center", paddingVertical: space[6] },
  memberCode: { ...type.row, textAlign: "center", letterSpacing: 1 },
  dim: { opacity: 0.35 },
  statusHead: { flexDirection: "row" },
  pill: { ...type.label, borderWidth: 1, borderRadius: radius.full, paddingHorizontal: space[3], paddingVertical: space[1] },
  line: { flexDirection: "row", justifyContent: "space-between", gap: space[3], alignItems: "baseline" },
  factValue: { textAlign: "right", fontWeight: "600" },
  totalText: { ...type.body, fontWeight: "700" },
  actions: { gap: 0, paddingVertical: space[2] },
  actionRow: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: size.btn.lg, borderRadius: radius.sm },
  actionLabel: { ...type.row, flex: 1 },
  infoRow: { flexDirection: "row", alignItems: "flex-start", gap: space[3], paddingVertical: space[2] },
  grow: { flex: 1, minWidth: 0 },
  ask: { gap: space[2], borderWidth: 1, borderRadius: radius.lg, padding: space[3], marginVertical: space[2] },
  pressed: { opacity: 0.8 },
});

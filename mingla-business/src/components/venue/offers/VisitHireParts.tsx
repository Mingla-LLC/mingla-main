/**
 * #4490 P4-3 — the private hire parts of `/visit/<groupId>`: the tracker
 * (Request sent → {Venue} says yes → You pay the deposit → You pay the rest
 * → Your day), the state card for the states a hire adds (request sent,
 * declined with the reason and other dates, timed out, withdrawn, said yes
 * with the hold clock and the host's note, the hold ran out, we're checking
 * your payment), the pay and withdraw actions, and the hire facts for the
 * summary card. Every amount is the server's.
 *
 * Anonymous (no `useAuth`): the booking token reaches every action.
 */
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ResolvedTheme, ThemePalette } from "@mingla/offering-rendering";
import { neutralHair, statusOn } from "@mingla/offering-rendering/themePalette";
import { themeBoldFace } from "@mingla/offering-rendering/themeAccentStyle";
import { formatVenueMoney } from "@mingla/brand-rendering/venueMoney";
import { countdownText, entryDateLabel, holdSecondsLeft } from "@mingla/brand-rendering/venueOffers/entryModel";
import {
  damageDepositGuestLine,
  hireMoment,
  venueClockRange,
  hireTrackerSteps,
  type HireBookingView,
  type HireStateCard,
} from "@mingla/brand-rendering/venueOffers/hireModel";
import { venueLayoutSummary } from "@mingla/brand-rendering/venueOffers/layoutModel";

import { radius, space, type } from "../../../constants/designSystem";
import { EntryButton, EntryNote } from "./EntryUi";

/** "2 days 23 hours left", "5 h 12 min left", or the m:ss clock in the last hour. */
export function leftWords(seconds: number): string {
  if (seconds < 3600) return countdownText(seconds);
  const hours = Math.floor(seconds / 3600);
  if (hours < 48) return `${hours} h ${Math.floor((seconds % 3600) / 60)} min left`;
  const days = Math.floor(hours / 24);
  return `${days} days ${hours % 24} hours left`;
}

export function HireTracker({
  state,
  venueName,
  hire,
  palette,
}: {
  state: string;
  venueName: string;
  hire: HireBookingView;
  palette: ThemePalette;
}): React.ReactElement | null {
  const steps = hireTrackerSteps(state, venueName, hire);
  if (!steps.some((s) => s.done || s.current)) return null;
  const hair = neutralHair(palette);
  return (
    <View style={styles.tracker} accessibilityRole="list" accessibilityLabel="Where your booking is" testID="issue-4490-visit-hire-tracker">
      {steps.map((s, i) => (
        <View key={s.key} style={styles.step} accessibilityLabel={`${s.label}${s.done ? ", done" : s.current ? ", now" : ""}`}>
          <View
            style={[
              styles.dot,
              {
                backgroundColor: s.done ? palette.primaryText : s.current ? palette.accentWash : "transparent",
                borderColor: s.done || s.current ? palette.primaryText : hair,
              },
            ]}
          >
            <Text style={[styles.dotText, { color: s.done ? palette.page : palette.primaryText }]}>{i + 1}</Text>
          </View>
          <Text style={[styles.stepText, { color: s.done || s.current ? palette.primaryText : palette.tertiaryText }]} numberOfLines={2}>
            {s.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

export interface HireStateMainProps {
  card: HireStateCard;
  hire: HireBookingView;
  palette: ThemePalette;
  theme: ResolvedTheme;
  currencyCode: string;
  exponent: number;
  timeZone: string | null;
  holdUntil: string | null;
  now: number;
  venueName: string;
  /** "deposit" and "full" amounts the server offers right now. */
  payModes: Array<{ mode: "deposit" | "full"; amountMinor: number }>;
  paying: boolean;
  onPay: (mode: "deposit" | "full" | undefined) => void;
  /** A payment page already open (resume or check). */
  inFlight: { resumeUrl: string | null } | null;
  onResume: () => void;
  onCheck: () => void;
  failedNote: string | null;
  withdrawing: boolean;
  onWithdraw: () => void;
  onAskAgain: (() => void) | null;
  onAskDate: ((date: string) => void) | null;
  onCheckAgain: () => void;
  errorNote: React.ReactNode;
}

export function HireStateMain(p: HireStateMainProps): React.ReactElement {
  const { card, hire, palette, theme } = p;
  const tones = statusOn(palette);
  const money = (m: number): string => formatVenueMoney(m, p.currencyCode, p.exponent);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const deposit = p.payModes.find((m) => m.mode === "deposit") ?? null;
  const full = p.payModes.find((m) => m.mode === "full") ?? null;
  const canWithdraw = card.kind === "request_sent" || card.kind === "pay_deposit";
  const left = p.holdUntil !== null ? holdSecondsLeft(p.holdUntil, p.now) : 0;

  return (
    <View style={styles.column} testID={`issue-4490-visit-hire-${card.kind}`}>
      <Text style={[styles.title, themeBoldFace(theme), { color: palette.primaryText }]} accessibilityRole="header">
        {card.title}
      </Text>
      <Text style={[styles.body, { color: palette.secondaryText }]} testID="issue-4490-visit-hire-body">{card.body}</Text>

      {card.kind === "pay_deposit" && p.holdUntil !== null ? (
        <EntryNote palette={palette} icon="clock" tone="warning" testID="issue-4490-visit-hire-hold">
          <Text style={[styles.small, { color: tones.warning.text }]}>
            <Text style={themeBoldFace(theme)}>{`On hold until ${hireMoment(p.holdUntil, p.timeZone) ?? ""}`}</Text>
            {` · ${leftWords(left)}`}
          </Text>
        </EntryNote>
      ) : null}
      {hire.hostNote !== null && (card.kind === "pay_deposit" || card.kind === "confirmed") ? (
        <EntryNote palette={palette} icon="chat" testID="issue-4490-visit-hire-host-note">
          {`${p.venueName}: “${hire.hostNote}”`}
        </EntryNote>
      ) : null}
      {card.kind === "declined" && hire.alternatives.length > 0 ? (
        <View style={styles.column} testID="issue-4490-visit-hire-alternatives">
          <Text style={[styles.small, { color: palette.primaryText }]}>{`${p.venueName} offered these dates instead:`}</Text>
          {hire.alternatives.map((d) => (
            <EntryButton
              key={d}
              palette={palette}
              theme={theme}
              variant="secondary"
              label={`Ask for ${entryDateLabel(d)}`}
              onPress={() => p.onAskDate?.(d)}
              disabled={p.onAskDate === null}
              testID={`issue-4490-visit-hire-ask-${d}`}
            />
          ))}
        </View>
      ) : null}
      {p.failedNote !== null ? (
        <EntryNote palette={palette} icon="flag" tone="error" testID="issue-4490-visit-hire-pay-failed">
          {p.failedNote}
        </EntryNote>
      ) : null}
      {p.errorNote}

      {card.kind === "pay_deposit" && card.payMinor !== null ? (
        p.inFlight !== null ? (
          <View style={styles.column} testID="issue-4490-visit-hire-in-flight">
            <EntryNote palette={palette} icon="clock">
              {p.inFlight.resumeUrl !== null
                ? "You've already started paying. Carry on with that payment, or check whether it went through."
                : "A payment for this booking was started somewhere else. If you finished it, check now."}
            </EntryNote>
            {p.inFlight.resumeUrl !== null ? <EntryButton palette={palette} theme={theme} label="Continue your payment" onPress={p.onResume} /> : null}
            <EntryButton palette={palette} theme={theme} variant="secondary" label="I've paid: check now" onPress={p.onCheck} busy={p.paying} />
          </View>
        ) : (
          <View style={styles.column}>
            <EntryButton
              palette={palette}
              theme={theme}
              label={p.paying ? "Opening payment…" : `Pay ${money(deposit !== null ? deposit.amountMinor : card.payMinor)} to hold your date`}
              onPress={() => p.onPay(deposit !== null ? "deposit" : undefined)}
              busy={p.paying}
              testID="issue-4490-visit-hire-pay"
            />
            {deposit !== null && full !== null && full.amountMinor > deposit.amountMinor ? (
              <EntryButton
                palette={palette}
                theme={theme}
                variant="secondary"
                label={`Pay everything now · ${money(full.amountMinor)}`}
                onPress={() => p.onPay("full")}
                disabled={p.paying}
                testID="issue-4490-visit-hire-pay-full"
              />
            ) : null}
            {deposit !== null && full !== null && full.amountMinor > deposit.amountMinor ? (
              <Text style={[styles.caption, { color: palette.tertiaryText }]}>
                {`Then ${money(full.amountMinor - deposit.amountMinor)}${hire.balanceDueAt !== null ? ` by ${hireMoment(hire.balanceDueAt, p.timeZone)?.split(",")[0] ?? "the due date"}` : " later"}${hire.damageDepositMinor > 0 ? `, including the ${money(hire.damageDepositMinor)} refundable damage deposit` : ""}.`}
              </Text>
            ) : null}
            <Text style={[styles.caption, { color: palette.tertiaryText }]}>Card, bank transfer or USSD on the secure payment page.</Text>
          </View>
        )
      ) : null}

      {card.kind === "checking" ? (
        <EntryButton palette={palette} theme={theme} variant="secondary" label="Check again" onPress={p.onCheckAgain} testID="issue-4490-visit-hire-check-again" />
      ) : null}

      {(card.kind === "expired" || card.kind === "hold_ran_out" || card.kind === "withdrawn" || card.kind === "declined") && p.onAskAgain !== null ? (
        <EntryButton palette={palette} theme={theme} variant={card.kind === "declined" && hire.alternatives.length > 0 ? "secondary" : "primary"} label="Ask for another date" onPress={p.onAskAgain} testID="issue-4490-visit-hire-ask-again" />
      ) : null}

      {canWithdraw && p.inFlight === null ? (
        confirmWithdraw ? (
          <View style={[styles.confirm, { borderColor: tones.warning.line }]} testID="issue-4490-visit-hire-withdraw-confirm">
            <Text style={[styles.small, { color: palette.primaryText }]}>
              {card.kind === "pay_deposit"
                ? `Withdraw and let ${hire.placeName ?? "the space"} go? Nothing has been charged.`
                : `Withdraw your request? ${p.venueName} is told and nothing is charged.`}
            </Text>
            <EntryButton palette={palette} theme={theme} label="Withdraw" onPress={p.onWithdraw} busy={p.withdrawing} testID="issue-4490-visit-hire-withdraw-yes" />
            <EntryButton palette={palette} theme={theme} variant="secondary" label="Keep it" onPress={() => setConfirmWithdraw(false)} disabled={p.withdrawing} testID="issue-4490-visit-hire-withdraw-no" />
          </View>
        ) : (
          <EntryButton
            palette={palette}
            theme={theme}
            variant="secondary"
            label={card.kind === "pay_deposit" ? "Not going ahead? Withdraw" : "Withdraw request"}
            onPress={() => setConfirmWithdraw(true)}
            disabled={p.paying}
            testID="issue-4490-visit-hire-withdraw"
          />
        )
      ) : null}
    </View>
  );
}

/** The hire facts on the booking page's summary card. */
export function HireFacts({
  hire,
  palette,
  currencyCode,
  exponent,
  totalDueMinor,
  paidMinor,
  balanceDueMinor,
  showMoney,
  taxMinor = 0,
  vatMode = null,
  bookedTotalMinor = null,
  timeZone = null,
}: {
  hire: HireBookingView;
  palette: ThemePalette;
  currencyCode: string;
  exponent: number;
  totalDueMinor: number;
  paidMinor: number;
  balanceDueMinor: number;
  showMoney: boolean;
  /** The server's VAT on the booking (added on top, or inside the price). */
  taxMinor?: number;
  vatMode?: "added" | "included" | "none" | null;
  /** The total when booked; differs from `totalDueMinor` once the venue edited the price. */
  bookedTotalMinor?: number | null;
  timeZone?: string | null;
}): React.ReactElement {
  const money = (m: number): string => formatVenueMoney(m, currencyCode, exponent);
  const rows: Array<{ k: string; v: string; strong?: boolean }> = [
    { k: "Space", v: hire.placeName ?? "—" },
    ...(hire.layout !== null && hire.layoutCapacity !== null
      ? [{ k: "Layout", v: venueLayoutSummary(hire.layout, hire.layoutCapacity) }]
      : []),
    ...(hire.sessionLabel !== null || hire.bookedFrom !== null
      ? [
          {
            k: "Session",
            v: [hire.sessionLabel, venueClockRange(hire.bookedFrom, hire.bookedTo, timeZone)].filter((x): x is string => x !== null).join(" · "),
          },
        ]
      : []),
    { k: "Guests", v: hire.guests.toLocaleString("en-GB") },
    ...(hire.occasion !== null ? [{ k: "Occasion", v: hire.occasion }] : []),
    ...(hire.siteVisit ? [{ k: "Site visit", v: "You asked to see the space first" }] : []),
  ];
  // The venue changed the price when it said yes: the server keeps the change on
  // top of the first quote, so the agreed price is shown as one exact line.
  const edited = bookedTotalMinor !== null && bookedTotalMinor !== totalDueMinor;
  const moneyRows: Array<{ k: string; v: string; strong?: boolean }> = edited
    ? [
        ...hire.extras.map((extra) => ({ k: `Extras · ${extra.name}`, v: money(extra.amountMinor) })),
        { k: taxMinor > 0 ? "Agreed price (with VAT)" : "Agreed price", v: money(totalDueMinor - hire.damageDepositMinor) },
        ...(hire.damageDepositMinor > 0 ? [{ k: "Refundable damage deposit", v: money(hire.damageDepositMinor) }] : []),
        { k: "Total", v: money(totalDueMinor), strong: true },
        ...(paidMinor > 0 ? [{ k: "Paid", v: money(paidMinor) }] : []),
        ...(paidMinor > 0 && balanceDueMinor > 0 ? [{ k: "Still to pay", v: money(balanceDueMinor), strong: true }] : []),
      ]
    : [
    { k: "Hire", v: money(hire.hireMinor) },
    ...(hire.extraGuests > 0 ? [{ k: `${hire.extraGuests} extra guests`, v: money(hire.extraGuestMinor) }] : []),
    ...(hire.overtimeHours > 0 ? [{ k: `${hire.overtimeHours} extra hours`, v: money(hire.overtimeMinor) }] : []),
    ...hire.extras.map((extra) => ({ k: `Extras · ${extra.name}`, v: money(extra.amountMinor) })),
    ...(taxMinor > 0 ? [{ k: vatMode === "included" ? "Includes VAT" : "VAT", v: money(taxMinor) }] : []),
    ...(hire.damageDepositMinor > 0 ? [{ k: "Refundable damage deposit", v: money(hire.damageDepositMinor) }] : []),
    { k: "Total", v: money(totalDueMinor), strong: true },
    ...(paidMinor > 0 ? [{ k: "Paid", v: money(paidMinor) }] : []),
    ...(paidMinor > 0 && balanceDueMinor > 0 ? [{ k: "Still to pay", v: money(balanceDueMinor), strong: true }] : []),
  ];
  return (
    <View style={styles.facts} testID="issue-4490-visit-hire-facts">
      {[...rows, ...(showMoney ? moneyRows : [])].map((r) => (
        <View key={r.k} style={styles.factRow}>
          <Text style={[styles.small, styles.grow, { color: palette.secondaryText }]}>{r.k}</Text>
          <Text style={[r.strong ? styles.strong : styles.small, styles.value, { color: palette.primaryText }]}>{r.v}</Text>
        </View>
      ))}
      {hire.note !== null ? <Text style={[styles.caption, styles.leftText, { color: palette.tertiaryText }]}>{`Your note: “${hire.note}”`}</Text> : null}
      {showMoney && hire.damageDeposit !== null && hire.damageDeposit.status !== "due" ? (
        <Text style={[styles.small, { color: palette.secondaryText }]} testID="issue-4490-visit-hire-deposit">
          {damageDepositGuestLine(hire.damageDeposit, currencyCode, exponent, timeZone)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  column: { gap: space[3] },
  title: { ...type.title },
  body: { ...type.body },
  small: { ...type.small },
  strong: { ...type.row },
  caption: { ...type.caption, textAlign: "center" },
  leftText: { textAlign: "left" },
  grow: { flex: 1, minWidth: 0 },
  value: { textAlign: "right", flexShrink: 1 },
  // #4490 N31: five equal columns (dot over its label), never a wrapped fifth step.
  tracker: { flexDirection: "row", gap: space[1] },
  step: { flex: 1, minWidth: 0, alignItems: "center", gap: space[1] },
  dot: { width: 24, height: 24, borderRadius: radius.full, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  dotText: { ...type.caption, fontWeight: "700" },
  stepText: { ...type.caption, textAlign: "center" },
  confirm: { gap: space[2], padding: space[3], borderWidth: 1, borderRadius: radius.md },
  facts: { gap: space[2] },
  factRow: { flexDirection: "row", gap: space[3], alignItems: "baseline" },
});

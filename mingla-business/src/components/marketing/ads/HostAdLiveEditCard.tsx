/**
 * #4238 media-buyer, wave D — "Edit budget and end date" on a live ad, once
 * a day. A raise sets the extra aside from Ads credit at once; a lower gives
 * it back. The end date is in the page's own calendar.
 */
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Button } from "../../ui/Button";
import { DateField } from "../../ui/DateField";
import { Input } from "../../ui/Input";
import { platformName, platformNames } from "./hostAdCopy";
import { formatHostAdMoneyCents } from "./hostAdMoney";
import { hostAdStyles as s } from "./hostAdBuilderStyles";
import { hostAdDayBoundaryIso, hostAdDayOf } from "./hostAdBuilderRules";
import { hostAdNextLiveEditAt } from "./hostAdAlerts";

export type HostAdLiveEditResult = {
  daily_not_pushed: string[];
  end_not_pushed: string[];
};

const ERRORS: Record<string, string> = {
  host_ad_live_edit_once_a_day:
    "You can change this ad once a day. Try again tomorrow.",
  host_ad_live_edit_in_progress:
    "This ad is already being changed. Wait a moment, then check the ad again.",
  host_ad_live_edit_end_after_last_bookable:
    "That's after the last day people can book. Pick an earlier end date.",
  host_ad_live_edit_below_spend:
    "That's no more than this ad has already spent. Pick a higher total, or end the ad.",
  host_ad_live_edit_caps_exceed_budget:
    "We couldn't split that total across the apps. Nothing was changed; try a slightly higher total.",
  host_ad_live_edit_end_in_past: "Pick an end date in the future.",
  ad_credit_insufficient:
    "There isn't enough Ads credit for that. Add credit, or pick a lower total.",
  // #4238 r8 P2-2: TikTok's own minimum is checked before Mingla asks, so a
  // refusal here is TikTok's limit on how much or how often a budget moves.
  tiktok_budget_update_failed:
    "TikTok didn't take that change, so nothing was changed. TikTok limits how much and how often a daily budget can change; try a smaller change, or try again tomorrow.",
};

/**
 * The plain message for a refused change. `detail` carries the app for an
 * app minimum ("tiktok:790500") or a failed undo ("meta,tiktok").
 */
export function hostAdLiveEditError(
  code: string | null | undefined,
  detail?: string | null,
  currency?: string | null,
): string {
  if (code === "host_ad_live_edit_below_app_minimum" && detail) {
    const [platform, cents] = detail.split(":");
    const amount = formatHostAdMoneyCents(Number(cents), currency ?? "");
    return amount
      ? `${platformName(platform)} needs about ${amount} a day. Pick a higher total or a sooner end date.`
      : `That's under ${platformName(platform)}'s daily minimum. Pick a higher total or a sooner end date.`;
  }
  // #4238 r8 P2-1: an undo failed. Never "Nothing was changed".
  if (code === "host_ad_live_edit_undo_failed") {
    const apps = (detail ?? "").split(",").map((item) => item.trim()).filter(Boolean);
    const who = apps.length > 0 ? platformNames(apps) : "One of the apps";
    return `We couldn't finish the change. ${who} may still be on the new daily amount. Mingla's team has been told and will put it right; you don't need to do anything.`;
  }
  return (code && ERRORS[code]) ??
    "We couldn't change your ad just now. Nothing was changed; try again in a minute.";
}

/** The plain note after a change: which apps keep their daily amount. */
export function hostAdLiveEditDoneNote(result: HostAdLiveEditResult): string {
  const notes = ["Your ad is updated."];
  if (result.daily_not_pushed.length > 0) {
    // #4238 r9 P3: "Google keeps its", "Google and Reddit keep their".
    const one = result.daily_not_pushed.length === 1;
    notes.push(
      `${platformNames(result.daily_not_pushed)} ${one ? "keeps its" : "keep their"} daily amount; Mingla stops ${one ? "it" : "them"} at your new total.`,
    );
  }
  // #4238 r8 P3: the apps that don't take an end date from Mingla.
  if (result.end_not_pushed.length > 0) {
    notes.push(
      `Mingla stops ${platformNames(result.end_not_pushed)} at your new end date.`,
    );
  }
  return notes.join(" ");
}

export type HostAdLiveEditAttempt = { signature: string; key: string };

/**
 * #4238 r8 P1-2: one idempotency key per edit attempt. A second tap, or a
 * retry of the same change after an error, reuses the key (the server then
 * returns the saved edit instead of pushing twice); a different change gets
 * a new one. The caller forgets the attempt once the change is saved.
 */
export function hostAdLiveEditAttempt(
  previous: HostAdLiveEditAttempt | null,
  input: { planId: string; newBudgetCents: number | null; newEndsAt: string | null },
  mintKey: () => string,
): HostAdLiveEditAttempt {
  const signature = JSON.stringify([input.planId, input.newBudgetCents, input.newEndsAt]);
  return previous !== null && previous.signature === signature
    ? previous
    : { signature, key: mintKey() };
}

/** "Wed 4 Nov, 22:25" in the page's own time zone (viewer's when unknown). */
export function hostAdLiveEditWhen(iso: string, timezone?: string | null): string {
  const date = new Date(iso);
  const options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  };
  if (timezone) {
    try {
      return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: timezone }).format(date);
    } catch {
      // Unknown zone on this device: the viewer's own clock below.
    }
  }
  return new Intl.DateTimeFormat("en-GB", options).format(date);
}

export function HostAdLiveEditCard(props: {
  currency: string;
  currentTotalCents: number;
  spentCents: number | null;
  currentEndsAt: string | null;
  timezone?: string | null;
  lastEditAt: string | null;
  nowIso: string;
  busy: boolean;
  /** The last save's outcome, shown right under Save (never at page bottom). */
  result?: { kind: "done" | "error"; text: string } | null;
  onSubmit: (input: { newBudgetCents: number | null; newEndsAt: string | null }) => Promise<void>;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [total, setTotal] = useState(String(props.currentTotalCents / 100));
  const [endDay, setEndDay] = useState(hostAdDayOf(props.currentEndsAt, props.timezone));
  const next = hostAdNextLiveEditAt(props.lastEditAt, props.nowIso);
  const money = (cents: number) => formatHostAdMoneyCents(cents, props.currency) ?? "";
  const newCents = Math.round(Number(total.replace(/,/g, "")) * 100);
  const validTotal = Number.isSafeInteger(newCents) && newCents > 0;
  const delta = validTotal ? newCents - props.currentTotalCents : 0;
  const today = hostAdDayOf(props.nowIso, props.timezone);
  const endChanged = endDay !== "" && endDay !== hostAdDayOf(props.currentEndsAt, props.timezone);
  const changed = (validTotal && delta !== 0) || endChanged;
  return (
    <View style={s.block} testID="host-ad-live-edit">
      <Pressable
        style={s.linkButton}
        onPress={() => setOpen((value) => !value)}
        disabled={next !== null}
        accessibilityRole="button"
        accessibilityState={{ expanded: open, disabled: next !== null }}
        accessibilityLabel="Edit budget and end date"
        testID="host-ad-live-edit-open"
      >
        <Text style={next ? s.faint : s.linkLabel}>Edit budget and end date</Text>
      </Pressable>
      {next ? (
        <Text style={s.helper} testID="host-ad-live-edit-wait">
          You changed this ad in the last day. You can change it again after{" "}
          {hostAdLiveEditWhen(next, props.timezone)}.
        </Text>
      ) : null}
      {open && !next ? (
        <View style={s.card}>
          <Text style={s.helper}>
            Changing an ad often makes the apps start learning again, so you
            can do it once a day.
          </Text>
          <Text style={s.label}>Total for the whole run ({props.currency})</Text>
          <Input
            value={total}
            onChangeText={setTotal}
            variant="number"
            accessibilityLabel="New total budget"
            testID="host-ad-live-edit-total"
          />
          {validTotal && delta > 0 ? (
            <Text style={s.subtitle} testID="host-ad-live-edit-delta">
              We&apos;ll set aside {money(delta)} more from your Ads credit now.
            </Text>
          ) : null}
          {validTotal && delta < 0 ? (
            <Text style={s.subtitle} testID="host-ad-live-edit-delta">
              {money(-delta)} goes back to your Ads credit now.
            </Text>
          ) : null}
          {props.spentCents !== null ? (
            <Text style={s.faint}>Spent so far: {money(props.spentCents)}</Text>
          ) : null}
          <DateField
            label="End date"
            value={endDay}
            min={today}
            onChangeValue={setEndDay}
            accessibilityLabel="New end date"
            testID="host-ad-live-edit-end"
          />
          <Button
            label="Save changes"
            onPress={() =>
              void props.onSubmit({
                newBudgetCents: validTotal && delta !== 0 ? newCents : null,
                newEndsAt: endChanged
                  ? hostAdDayBoundaryIso(endDay, "end", props.timezone ?? null)
                  : null,
              })}
            disabled={!changed || props.busy}
            loading={props.busy}
            fullWidth
            testID="host-ad-live-edit-save"
          />
        </View>
      ) : null}
      {props.result ? (
        <Text
          style={props.result.kind === "error" ? s.error : s.subtitle}
          accessibilityLiveRegion="polite"
          accessibilityRole={props.result.kind === "error" ? "alert" : "text"}
          testID="host-ad-live-edit-result"
        >
          {props.result.text}
        </Text>
      ) : null}
    </View>
  );
}

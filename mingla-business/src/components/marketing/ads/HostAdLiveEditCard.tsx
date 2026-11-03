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
import { platformNames } from "./hostAdCopy";
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
  host_ad_live_edit_end_after_last_bookable:
    "That's after the last day people can book. Pick an earlier end date.",
  host_ad_live_edit_below_spend:
    "That's less than this ad has already spent. Pick a higher total.",
  host_ad_live_edit_end_in_past: "Pick an end date in the future.",
  ad_credit_insufficient:
    "There isn't enough Ads credit for that. Add credit, or pick a lower total.",
  tiktok_budget_update_failed:
    "TikTok didn't take that change. TikTok only lets a daily budget move by about a third at a time; try a smaller change.",
};

export function hostAdLiveEditError(code: string | null | undefined): string {
  return (code && ERRORS[code]) ??
    "We couldn't change your ad just now. Nothing was changed; try again in a minute.";
}

/** The plain note after a change: which apps keep their daily amount. */
export function hostAdLiveEditDoneNote(result: HostAdLiveEditResult): string {
  const notes = ["Your ad is updated."];
  if (result.daily_not_pushed.length > 0) {
    notes.push(
      `${platformNames(result.daily_not_pushed)} keep their daily amount; Mingla stops them at your new total.`,
    );
  }
  return notes.join(" ");
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
          {new Date(next).toLocaleString()}.
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
    </View>
  );
}

/**
 * #4238 media-buyer — "How much?": a total for the run by default (daily as
 * an option), each app's own minimum before any money is set aside, a
 * recommended amount, the split, and "How spending works".
 */
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { platformName } from "./hostAdCopy";
import { formatHostAdMoneyCents } from "./hostAdMoney";
import { HOST_AD_APP_BADGES, hostAdStyles as s } from "./hostAdBuilderStyles";
import {
  type HostAdBudgetMode,
  hostAdRecommendedDaily,
  type HostAdSplit,
} from "./hostAdBudget";

export function HostAdBudgetPanel(props: {
  mode: HostAdBudgetMode;
  onMode: (mode: HostAdBudgetMode) => void;
  currency: string;
  days: number | null;
  split: HostAdSplit;
  dailyTotalCents: number;
  onUseRecommended: (dailyCents: number) => void;
}): React.ReactElement {
  const [explain, setExplain] = useState(false);
  const money = (cents: number): string =>
    formatHostAdMoneyCents(cents, props.currency) ?? "";
  const recommended = hostAdRecommendedDaily(props.split.minimumTotalCents);
  return (
    <View style={s.block} testID="host-ad-budget-panel">
      <View style={s.chipRow}>
        {(["total", "daily"] as const).map((mode) => (
          <Pressable
            key={mode}
            style={[s.chip, props.mode === mode && s.chipSelected]}
            onPress={() => props.onMode(mode)}
            accessibilityRole="radio"
            accessibilityState={{ selected: props.mode === mode }}
            accessibilityLabel={mode === "total" ? "Total for the whole run" : "Per day"}
            testID={`host-ad-budget-mode-${mode}`}
          >
            <Text style={s.chipLabel}>
              {mode === "total" ? "Total for the whole run" : "Per day"}
            </Text>
          </Pressable>
        ))}
      </View>
      {props.mode === "total" && props.days !== null && props.dailyTotalCents > 0 ? (
        <Text style={s.helper} testID="host-ad-budget-daily">
          About {money(props.dailyTotalCents)} a day for {props.days}{" "}
          {props.days === 1 ? "day" : "days"}.
        </Text>
      ) : null}
      {props.mode === "total" && props.days === null ? (
        <Text style={s.helper}>Pick an end date to spread the total over the run.</Text>
      ) : null}
      {props.split.rows.length > 0 ? (
        <View style={s.card}>
          <Text style={s.title}>How it&apos;s split each day</Text>
          {props.split.rows.map((row) => (
            <View key={row.platform} style={s.appRow} testID={`host-ad-split-${row.platform}`}>
              <View style={s.appBadge}>
                <Text style={s.appBadgeLabel}>{HOST_AD_APP_BADGES[row.platform]}</Text>
              </View>
              <View style={s.appText}>
                <Text style={row.dailyCents < row.minimumCents ? s.warn : s.subtitle}>
                  {platformName(row.platform)}: {money(row.dailyCents)} a day
                  {row.minimumCents > 0
                    ? ` · needs at least ${money(row.minimumCents)}`
                    : ""}
                </Text>
              </View>
            </View>
          ))}
          {!props.split.ok && props.split.short ? (
            <Text style={s.warn} testID="host-ad-budget-short">
              {platformName(props.split.short.platform)} needs about{" "}
              {money(props.split.short.minimumCents)} a day. Raise the budget, or
              turn {platformName(props.split.short.platform)} off.
            </Text>
          ) : null}
        </View>
      ) : null}
      {recommended > 0 ? (
        <Pressable
          style={s.acceptChip}
          onPress={() => props.onUseRecommended(recommended)}
          accessibilityRole="button"
          accessibilityLabel={`Use the recommended ${money(recommended)} a day`}
          testID="host-ad-budget-recommended"
        >
          <Text style={s.acceptChipLabel}>
            Recommended: {money(recommended)} a day
            {props.days ? ` (${money(recommended * props.days)} in total)` : ""}
          </Text>
        </Pressable>
      ) : null}
      <Pressable
        style={s.linkButton}
        onPress={() => setExplain((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded: explain }}
        accessibilityLabel="How spending works"
        testID="host-ad-budget-explain"
      >
        <Text style={s.linkLabel}>How spending works</Text>
      </Pressable>
      {explain ? (
        <Text style={s.helper} testID="host-ad-budget-explainer">
          Each app gets its minimum first, then the rest is shared evenly. Apps
          spend more on days more people are likely to buy, so one day can be
          higher than the average. Your total is a hard limit: we stop the ad
          before it goes over, and anything not spent goes back to your Ads
          credit.
        </Text>
      ) : null}
    </View>
  );
}

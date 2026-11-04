/**
 * #4238 media-buyer — reach per app with a too narrow / good / broad meter.
 * Each app is read on its own: one person can be on several apps.
 */
import React from "react";
import { Text, View } from "react-native";

import { platformName } from "./hostAdCopy";
import { hostAdStyles as s } from "./hostAdBuilderStyles";

export type HostAdReachMeterRow = {
  platform: string;
  state: string;
  lower: number | null;
  upper: number | null;
  meter: "too_narrow" | "good" | "broad" | null;
};

const METER_WORDS: Record<NonNullable<HostAdReachMeterRow["meter"]>, string> = {
  too_narrow: "Too narrow",
  good: "Good",
  broad: "Broad",
};

/** "1.2M", "640K", "900". */
export function hostAdShortNumber(value: number): string {
  if (value >= 1e6) {
    return `${(value / 1e6).toFixed(value >= 1e7 ? 0 : 1).replace(/\.0$/, "")}M`;
  }
  if (value >= 1e3) return `${Math.round(value / 1e3)}K`;
  return String(Math.round(value));
}

/** Where the marker sits on a log scale from 5K to 20M (3%–97%). */
export function hostAdMeterPosition(lower: number, upper: number): number {
  const mid = Math.max((lower + upper) / 2, 1000);
  const position = ((Math.log10(mid) - 3.7) / (7.3 - 3.7)) * 100;
  return Math.max(3, Math.min(97, position));
}

export function hostAdReachRowLine(row: HostAdReachMeterRow, enabled: boolean): string {
  const app = platformName(row.platform);
  if (!enabled) return `${app} didn't give us a reach number yet.`;
  if (row.state === "available" && row.lower !== null && row.upper !== null) {
    return `About ${hostAdShortNumber(row.lower)} to ${hostAdShortNumber(row.upper)} people on ${app}.`;
  }
  if (row.state === "targeting_unavailable") {
    return `${app} needs a choice above before it can count people.`;
  }
  return `${app} didn't give us a reach number yet.`;
}

export function HostAdReachMeter(props: {
  rows: readonly HostAdReachMeterRow[];
  enabled: Partial<Record<string, boolean>>;
  loading: boolean;
}): React.ReactElement | null {
  if (props.rows.length === 0 && !props.loading) return null;
  return (
    <View style={s.block} testID="host-ad-reach">
      <Text style={s.label}>Reach per app</Text>
      <Text style={s.helper}>
        Read each app on its own. One person can use more than one app.
      </Text>
      {props.loading ? <Text style={s.faint}>Counting people…</Text> : null}
      {props.rows.map((row) => {
        const enabled = props.enabled[row.platform] === true;
        const available = enabled && row.state === "available" &&
          row.lower !== null && row.upper !== null;
        return (
          <View key={row.platform} style={s.card} testID={`host-ad-reach-${row.platform}`}>
            <Text style={s.title}>{hostAdReachRowLine(row, enabled)}</Text>
            {available && row.meter ? (
              <>
                <View style={s.meterTrack}>
                  <View
                    style={[
                      s.meterFill,
                      { width: `${hostAdMeterPosition(row.lower as number, row.upper as number)}%` },
                    ]}
                  />
                </View>
                <Text style={row.meter === "good" ? s.ok : s.warn}>
                  {METER_WORDS[row.meter]}
                </Text>
              </>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

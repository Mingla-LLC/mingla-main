/**
 * #4238 Overview — the cards that answer "is my ad working?": the verdict,
 * the seen-to-sold funnel, pace per app, the best video and Ask Ari. Pure
 * presentation: the screen passes the words (from `hm`) and the numbers the
 * server worked out. App names are always in text, never colour alone.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../../../constants/designSystem";
import { Button } from "../../../ui/Button";
import { builderStyles as bs, BuilderCard, BuilderLabel } from "../HostAdBuilderBits";
import type { OverviewStep } from "./hostAdOverviewModel";

type VerdictState = "too_early" | "on_track" | "behind" | "ahead";

function verdictTone(state: VerdictState): string {
  return state === "behind"
    ? color.warningText
    : state === "ahead" || state === "on_track"
      ? color.successText
      : color.infoText;
}

export function AdVerdictCard(props: { state: VerdictState; title: string; body: string }): React.ReactElement {
  return (
    <BuilderCard accessibilityLabel={`${props.title}. ${props.body}`} testID="ads-detail-verdict">
      <View style={styles.verdictHead}>
        <View style={[styles.dot, { backgroundColor: verdictTone(props.state) }]} />
        <Text style={styles.verdictTitle} accessibilityRole="header">
          {props.title}
        </Text>
      </View>
      <Text style={bs.body}>{props.body}</Text>
    </BuilderCard>
  );
}

export function AdSeenToSoldFunnel(props: {
  title: string;
  steps: readonly OverviewStep[];
  label: (step: OverviewStep) => string;
  rateText: (step: OverviewStep) => string | null;
}): React.ReactElement | null {
  if (props.steps.length === 0) return null;
  const top = Math.max(1, props.steps[0]?.value ?? 1);
  return (
    <View style={styles.funnel} testID="ads-overview-funnel" accessibilityLabel={props.title}>
      <Text style={bs.caption}>{props.title}</Text>
      {props.steps.map((step) => {
        const label = props.label(step);
        const value = step.value.toLocaleString("en-US");
        const rate = props.rateText(step);
        const share = Math.min(1, Math.max(0, step.value / top));
        return (
          <View
            key={step.key}
            style={styles.step}
            accessible
            accessibilityLabel={`${label}: ${value}${rate ? `. ${rate}` : ""}`}
            testID={`ads-overview-step-${step.key}`}
          >
            <View style={styles.stepRow}>
              <Text style={styles.stepLabel}>{label}</Text>
              <Text style={styles.stepValue}>{value}</Text>
            </View>
            <View style={styles.track}>
              <View style={[styles.bar, { width: `${Math.max(share > 0 ? 2 : 0, share * 100)}%` }]} />
            </View>
            {rate ? <Text style={bs.caption}>{rate}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

export type AdPaceRow = {
  platform: string;
  appName: string;
  line: string | null;
  state: "on_pace" | "ends_early" | "stopped";
  stateLabel: string;
  endsEarlyLine: string | null;
};

export function AdPaceCard(props: {
  title: string;
  spentLine: string;
  evenLabel: string;
  spentShare: number;
  evenShare: number | null;
  rows: readonly AdPaceRow[];
}): React.ReactElement {
  const spent = Math.min(1, Math.max(0, props.spentShare));
  const even = props.evenShare === null ? null : Math.min(1, Math.max(0, props.evenShare));
  return (
    <BuilderCard accessibilityLabel={`${props.title}. ${props.spentLine}`} testID="ads-detail-pace">
      <BuilderLabel>{props.title}</BuilderLabel>
      <Text style={bs.body} testID="ads-pace-spent">{props.spentLine}</Text>
      <View style={styles.paceTrack} accessibilityLabel={props.spentLine}>
        <View style={[styles.paceFill, { width: `${spent * 100}%` }]} />
        {even !== null ? (
          <View style={[styles.evenTick, { left: `${even * 100}%` }]} testID="ads-pace-even" accessibilityLabel={props.evenLabel} />
        ) : null}
      </View>
      {even !== null ? <Text style={bs.caption}>{props.evenLabel}</Text> : null}
      <View style={styles.paceRows}>
        {props.rows.map((row) => (
          <View key={row.platform} style={styles.paceRow} testID={`ads-pace-${row.platform}`}>
            <View style={bs.rowBetween}>
              <Text style={styles.appName}>{row.appName}</Text>
              <View
                style={[styles.pill, row.state === "ends_early" ? styles.pillWarn : row.state === "stopped" ? styles.pillOff : styles.pillOk]}
                accessibilityLabel={`${row.appName}: ${row.stateLabel}`}
                testID={`ads-pace-${row.platform}-state`}
              >
                <Text style={styles.pillText}>{row.stateLabel}</Text>
              </View>
            </View>
            {row.line ? <Text style={bs.small}>{row.line}</Text> : null}
            {row.endsEarlyLine ? (
              <Text style={bs.caption} testID={`ads-pace-${row.platform}-ends-early`}>
                {row.endsEarlyLine}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
    </BuilderCard>
  );
}

export function AdBestVideoCard(props: { title: string; line: string }): React.ReactElement {
  return (
    <BuilderCard accessibilityLabel={`${props.title}. ${props.line}`} testID="ads-detail-best-video">
      <BuilderLabel>{props.title}</BuilderLabel>
      <Text style={bs.body}>{props.line}</Text>
    </BuilderCard>
  );
}

export function AdAskAriButton(props: { label: string; onPress: () => void; disabled?: boolean }): React.ReactElement {
  return (
    <Button
      label={props.label}
      variant="secondary"
      size="md"
      fullWidth
      disabled={props.disabled}
      onPress={props.onPress}
      accessibilityLabel={props.label}
      testID="ads-detail-ask-ari-overview"
    />
  );
}

const styles = StyleSheet.create({
  verdictHead: { flexDirection: "row", alignItems: "center", gap: space[2] },
  dot: { width: 10, height: 10, borderRadius: 5 },
  verdictTitle: { ...type.h2, color: color.text1, flexShrink: 1 },
  funnel: { gap: space[3], marginTop: space[2] },
  step: { gap: space[1] },
  stepRow: { flexDirection: "row", justifyContent: "space-between", gap: space[3] },
  stepLabel: { ...type.small, color: color.text1, flexShrink: 1 },
  stepValue: { ...type.small, color: color.text1, fontWeight: "600" },
  track: { height: 6, borderRadius: radius.full, backgroundColor: color.fill.tile, overflow: "hidden" },
  bar: { height: 6, borderRadius: radius.full, backgroundColor: color.text2 },
  paceTrack: { height: 10, borderRadius: radius.full, backgroundColor: color.fill.tile, overflow: "visible", marginTop: space[2] },
  paceFill: { height: 10, borderRadius: radius.full, backgroundColor: color.accent },
  evenTick: { position: "absolute", top: -4, width: 2, height: 18, marginLeft: -1, backgroundColor: color.text1 },
  paceRows: { gap: space[4], marginTop: space[3] },
  paceRow: { gap: space[1] },
  appName: { ...type.small, color: color.text1, fontWeight: "600", flexShrink: 1 },
  pill: { paddingVertical: space[1], paddingHorizontal: space[3], borderRadius: radius.full },
  pillOk: { backgroundColor: color.successTint },
  pillWarn: { backgroundColor: color.warningTint },
  pillOff: { backgroundColor: color.fill.tile },
  pillText: { ...type.caption, color: color.text1 },
});

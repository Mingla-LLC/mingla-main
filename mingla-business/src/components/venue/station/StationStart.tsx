/**
 * #4490 spec 08 O3 — "Start service" (spec 08 §2 screen 11): pick what this
 * screen shows (Kitchen, Bar, Everything), play a test sound, print a test
 * ticket, Start service. On web the Start tap is also what lets the page play
 * sound (browsers need a tap first).
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { color, radius, size, space, type } from "../../../constants/designSystem";
import { Button } from "../../ui/Button";
import { Icon, type IconName } from "../../ui/Icon";
import { STATION_COPY } from "./stationCopy";
import type { StationChoice, StationName } from "./stationModel";

export interface StationStartProps {
  venueName: string | null;
  choice: StationChoice;
  onChoose: (choice: StationChoice) => void;
  /** Menu items with no station and the station they go to (from the board). */
  noStationItems: number;
  defaultStation: StationName;
  soundBusy: boolean;
  printing: boolean;
  onTestSound: () => void;
  onTestTicket: () => void;
  onStart: () => void;
}

const OPTIONS: readonly { key: StationChoice; icon: IconName; title: string; sub: string }[] = [
  { key: "kitchen", icon: "list", title: STATION_COPY.kitchen, sub: STATION_COPY.kitchenSub },
  { key: "bar", icon: "list", title: STATION_COPY.bar, sub: STATION_COPY.barSub },
  { key: "all", icon: "grid", title: STATION_COPY.everything, sub: STATION_COPY.everythingSub },
];

export function StationStart({
  venueName,
  choice,
  onChoose,
  noStationItems,
  defaultStation,
  soundBusy,
  printing,
  onTestSound,
  onTestTicket,
  onStart,
}: StationStartProps): React.ReactElement {
  return (
    <View style={styles.wrap} testID="station-start">
      <View style={styles.card}>
        <View style={styles.headText}>
          <Text style={styles.title} accessibilityRole="header">{STATION_COPY.startTitle}</Text>
          {venueName !== null ? <Text style={styles.caption}>{venueName}</Text> : null}
          <Text style={styles.body}>{STATION_COPY.startBody}</Text>
        </View>
        <View style={styles.options} accessibilityRole="radiogroup">
          {OPTIONS.map((option) => {
            const on = option.key === choice;
            const sub = noStationItems > 0 && option.key === defaultStation
              ? `${option.sub} · ${STATION_COPY.noStationHere(noStationItems)}`
              : option.sub;
            return (
              <Pressable
                key={option.key}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={option.title}
                onPress={() => onChoose(option.key)}
                style={({ pressed }) => [styles.option, on && styles.optionOn, pressed && styles.pressed]}
                testID={`station-choose-${option.key}`}
              >
                <Icon name={option.icon} size={22} color={on ? color.text1 : color.text2} />
                <View style={styles.optionText}>
                  <Text style={styles.optionTitle}>{option.title}</Text>
                  <Text style={styles.caption}>{sub}</Text>
                </View>
                <View style={[styles.radio, on && styles.radioOn]} />
              </Pressable>
            );
          })}
        </View>
        <View style={styles.row}>
          <Button label={STATION_COPY.playTestSound} variant="secondary" size="md" leadingIcon="volume"
            loading={soundBusy} disabled={soundBusy} onPress={onTestSound} style={styles.grow}
            testID="station-test-sound" />
          <Button label={STATION_COPY.printTestTicket} variant="secondary" size="md" leadingIcon="receipt"
            loading={printing} disabled={printing} onPress={onTestTicket} style={styles.grow}
            testID="station-test-ticket" />
        </View>
        <Button label={STATION_COPY.startService} variant="primary" size="lg" fullWidth onPress={onStart}
          testID="station-start-service" />
        <Text style={styles.caption}>{STATION_COPY.keepOpenLong}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexGrow: 1, justifyContent: "center", paddingHorizontal: space[4], paddingVertical: space[6] },
  card: {
    width: "100%",
    maxWidth: size.modal,
    alignSelf: "center",
    gap: space[4],
    padding: space[5],
    borderRadius: radius.xl,
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: color.line,
  },
  headText: { gap: space[1] },
  title: { ...type.h1, color: color.text1 },
  body: { ...type.body, color: color.text2 },
  caption: { ...type.small, color: color.text3 },
  options: { gap: space[2] },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    minHeight: size.btn.lg,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
  },
  optionOn: { borderColor: color.paper, backgroundColor: color.card2 },
  pressed: { opacity: 0.8 },
  optionText: { flex: 1, gap: 2 },
  optionTitle: { ...type.row, color: color.text1 },
  radio: { width: 20, height: 20, borderRadius: radius.full, borderWidth: 2, borderColor: color.lineStrong },
  radioOn: { borderColor: color.paper, backgroundColor: color.paper },
  row: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  grow: { flexGrow: 1 },
});

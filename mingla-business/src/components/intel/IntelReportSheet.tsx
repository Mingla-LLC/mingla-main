import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { ScrollView } from "../../wrappers/SmartScrollView";

import { space, type, color } from "../../constants/designSystem";
import type { TurnoutReport } from "../../types/growthTools";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import { EventsReportSections } from "./EventsReportSections";

export interface IntelReportSheetProps {
  visible: boolean;
  report: TurnoutReport | null;
  onClose: () => void;
  contextLabel?: string;
}

export const IntelReportSheet: React.FC<IntelReportSheetProps> = ({
  visible,
  report,
  onClose,
  contextLabel,
}) => (
  <Sheet
    visible={visible}
    onClose={onClose}
    snapPoint="full"
    testID="turnout-report-sheet"
  >
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>MINGLA INTELLIGENCE</Text>
          <Text style={styles.title}>Turnout forecast</Text>
          {contextLabel !== undefined ? (
            <Text style={styles.context}>{contextLabel}</Text>
          ) : null}
        </View>
        <Button label="Close" variant="ghost" size="sm" onPress={onClose} />
      </View>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {report !== null ? <EventsReportSections report={report} /> : null}
      </ScrollView>
    </View>
  </Sheet>
);

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: space[6], paddingBottom: space[6] },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[4],
    paddingBottom: space[4],
  },
  headerCopy: { flex: 1 },
  eyebrow: { ...type.label, color: color.text3 },
  title: { ...type.h1, color: color.text1 },
  context: {
    ...type.caption,
    color: color.text2,
    marginTop: space[1],
  },
  scroll: { paddingBottom: space[7] },
});

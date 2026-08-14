import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { ScrollView } from "../../wrappers/SmartScrollView";

import { spacing, text, typography } from "../../constants/designSystem";
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
  root: { flex: 1, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingBottom: spacing.md,
  },
  headerCopy: { flex: 1 },
  eyebrow: { ...typography.labelCap, color: text.tertiary },
  title: { ...typography.h2, color: text.primary },
  context: {
    ...typography.caption,
    color: text.secondary,
    marginTop: spacing.xs,
  },
  scroll: { paddingBottom: spacing.xl },
});

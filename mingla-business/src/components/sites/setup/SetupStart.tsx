import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Chip, WButton, ui } from "../website/ui";

/** Design state 1: first visit. Nothing is built until they approve the plan. */
export function SetupStart({ brandName, openCount, known, onAri, onHand, busy, ariAvailable }: {
  brandName: string;
  /** Open brand details, from the server's status. */
  openCount: number;
  /** What Mingla already has, by name ("name, logo and description"). */
  known: string | null;
  onAri: () => void;
  onHand: () => void;
  busy: boolean;
  ariAvailable: boolean;
}): React.ReactElement {
  return (
    <View style={styles.host} testID="setup-start">
      <View style={styles.bar}>
        <Text style={styles.title} role="heading" aria-level={1}>Build your website</Text>
        <Chip label="About 15 minutes" tone="accent" />
      </View>
      <Text style={styles.lead}>{known ? `${brandName} is already partly filled in.` : `Let's set up ${brandName}'s website.`}</Text>
      <Text style={styles.body} testID="setup-start-body">
        {`${known ? `We found your ${known} from your brand. ` : ""}${openCount} ${openCount === 1 ? "detail is" : "details are"} still needed, plus your design and story. Nothing goes public until you publish.`}
      </Text>
      <View style={styles.row}>
        {ariAvailable ? <WButton label="Do it with Ari" variant="primary" icon="spark" onPress={onAri} loading={busy} testID="setup-with-ari" /> : null}
        <WButton label="I'll do it myself" onPress={onHand} loading={busy && !ariAvailable} testID="setup-by-hand" />
      </View>
      <Text style={styles.small}>You can switch between these whenever you like. Your progress saves as you go.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { gap: 14, maxWidth: 720 },
  bar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" },
  title: { fontSize: 22, lineHeight: 28, fontWeight: "700", color: ui.t1 },
  lead: { fontSize: 18, lineHeight: 26, color: ui.t1 },
  body: { fontSize: 15, lineHeight: 22, color: ui.t2 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  small: { fontSize: 13, lineHeight: 18, color: ui.t3 },
});

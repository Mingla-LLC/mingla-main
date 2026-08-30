import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { semantic, spacing, text, typography } from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";

export type IdentityOperationReceiptProps =
  | { kind: "merge"; survivorName: string; onPrimary: () => void }
  | { kind: "split"; onPrimary: () => void }
  | {
    kind: "unsafe";
    supportReference: string;
    onEmailSupport: () => void;
    onDone: () => void;
  };

export function IdentityOperationReceipt(
  props: IdentityOperationReceiptProps,
): React.ReactElement {
  if (props.kind === "unsafe") {
    return (
      <View style={styles.receipt} accessibilityLiveRegion="assertive">
        <Icon name="shield" size={48} color={semantic.warning} />
        <Text accessibilityRole="header" style={styles.title}>We can’t split this automatically</Text>
        <Text style={styles.message}>
          This contact changed after that merge, so Mingla can’t split it automatically.
        </Text>
        <Text style={styles.unchanged}>Nothing changed.</Text>
        <Text selectable style={styles.reference}>Reference: {props.supportReference}</Text>
        <View style={styles.actions}>
          <Button label="Email support" fullWidth onPress={props.onEmailSupport} />
          <Button label="Done" variant="secondary" fullWidth onPress={props.onDone} />
        </View>
      </View>
    );
  }
  const merge = props.kind === "merge";
  return (
    <View style={styles.receipt} accessibilityLiveRegion="polite">
      <Icon name="check" size={48} color={semantic.success} />
      <Text accessibilityRole="header" style={styles.title}>
        {merge ? "Merge complete" : "Split complete"}
      </Text>
      <Text style={styles.message}>
        {merge
          ? `Merged into ${props.survivorName}. Every email and phone is still here.`
          : "Two people are back in your book."}
      </Text>
      <Button
        label={merge ? "View merged person" : "View people"}
        size="lg"
        fullWidth
        onPress={props.onPrimary}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  receipt: { padding: spacing.lg, alignItems: "center", gap: spacing.lg },
  title: { ...typography.h2, color: text.primary, textAlign: "center" },
  message: { ...typography.body, color: text.secondary, textAlign: "center" },
  unchanged: { ...typography.body, fontWeight: "600", color: text.primary },
  reference: { ...typography.monoMd, color: text.secondary },
  actions: { width: "100%", gap: spacing.sm },
});

import React from "react";
import {
  AccessibilityInfo,
  findNodeHandle,
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import {
  androidOpaque,
  glass,
  radius,
  semantic,
  spacing,
  text,
  typography,
} from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";

export type IdentityOperationReceiptProps =
  | { kind: "merge"; survivorName: string; onPrimary: () => void }
  | { kind: "split"; onPrimary: () => void }
  | {
    kind: "promote";
    contactValue: string | null;
    channel: "email" | "phone";
    onPrimary: () => void;
  }
  | {
    kind: "unsafe";
    supportReference: string;
    onEmailSupport: () => void;
    onDone: () => void;
  };

export function IdentityOperationReceipt(
  props: IdentityOperationReceiptProps,
): React.ReactElement {
  const headingRef = React.useRef<React.ElementRef<typeof Text> | null>(null);
  const { fontScale } = useWindowDimensions();
  const announcement = props.kind === "merge"
    ? "Merge complete."
    : props.kind === "split"
    ? "Split complete."
    : props.kind === "promote"
    ? props.contactValue
      ? `${props.contactValue} is now the primary ${props.channel}.`
      : `Primary ${props.channel} changed.`
    : `We can’t split this automatically. Nothing changed. Reference ${props.supportReference}.`;
  React.useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (Platform.OS === "web") {
        (headingRef.current as (React.ElementRef<typeof Text> & { focus?: () => void }) | null)
          ?.focus?.();
      } else {
        const handle = findNodeHandle(headingRef.current);
        if (handle !== null) AccessibilityInfo.setAccessibilityFocus(handle);
      }
    });
    AccessibilityInfo.announceForAccessibility(announcement);
    return () => cancelAnimationFrame(frame);
  }, [announcement]);
  if (props.kind === "unsafe") {
    return (
      <View style={[
        styles.receipt,
        styles.warningReceipt,
        fontScale >= 2 ? styles.largeTextReceipt : null,
      ]}>
        <Icon name="shield" size={48} color={semantic.warning} />
        <Text ref={headingRef} accessible accessibilityRole="header" style={styles.title}>
          We can’t split this automatically
        </Text>
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
  const promote = props.kind === "promote";
  return (
    <View style={[
      styles.receipt,
      styles.successReceipt,
      fontScale >= 2 ? styles.largeTextReceipt : null,
    ]}>
      <Icon name="check" size={48} color={semantic.success} />
      <Text ref={headingRef} accessible accessibilityRole="header" style={styles.title}>
        {merge ? "Merge complete" : promote ? "Primary changed" : "Split complete"}
      </Text>
      <Text style={styles.message}>
        {merge
          ? `Merged into ${props.survivorName}. Every email and phone is still here.`
          : promote
          ? props.contactValue
            ? `${props.contactValue} is now the primary ${props.channel}.`
            : `The selected ${props.channel} is now primary.`
          : "Two people are back in your book."}
      </Text>
      <Button
        label={merge ? "View merged person" : promote ? "Done" : "View people"}
        size="lg"
        fullWidth
        onPress={props.onPrimary}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  receipt: {
    padding: spacing.lg,
    alignItems: "center",
    gap: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: Platform.OS === "android" ? androidOpaque.rowBorder : glass.border.profileBase,
  },
  successReceipt: {
    backgroundColor: Platform.OS === "android" ? androidOpaque.successFill : glass.tint.profileBase,
  },
  warningReceipt: {
    backgroundColor: Platform.OS === "android" ? androidOpaque.warningFill : glass.tint.profileBase,
  },
  largeTextReceipt: { alignItems: "stretch" },
  title: { ...typography.h2, color: text.primary, textAlign: "center" },
  message: { ...typography.body, color: text.secondary, textAlign: "center" },
  unchanged: { ...typography.body, fontWeight: "600", color: text.primary },
  reference: { ...typography.monoMd, color: text.secondary },
  actions: { width: "100%", gap: spacing.sm },
});

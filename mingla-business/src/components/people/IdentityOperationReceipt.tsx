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
  radius,
  color,
  space,
  type,
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
    const focus = (): void => {
      if (Platform.OS === "web") {
        (headingRef.current as (React.ElementRef<typeof Text> & { focus?: () => void }) | null)
          ?.focus?.();
      } else {
        const handle = findNodeHandle(headingRef.current);
        if (handle !== null) AccessibilityInfo?.setAccessibilityFocus?.(handle);
      }
    };
    const frame = typeof requestAnimationFrame === "function"
      ? requestAnimationFrame(focus)
      : null;
    const timer = frame === null ? setTimeout(focus, 0) : null;
    AccessibilityInfo?.announceForAccessibility?.(announcement);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      if (timer !== null) clearTimeout(timer);
    };
  }, [announcement]);
  if (props.kind === "unsafe") {
    return (
      <View style={[
        styles.receipt,
        styles.warningReceipt,
        fontScale >= 2 ? styles.largeTextReceipt : null,
      ]}>
        <Icon name="shield" size={48} color={color.warning} />
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
      <Icon name="check" size={48} color={color.success} />
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
    padding: space[6],
    alignItems: "center",
    gap: space[6],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: Platform.OS === "android" ? color.card2 : color.line,
  },
  successReceipt: {
    backgroundColor: Platform.OS === "android" ? color.solidTint.success : color.fill.inset,
  },
  warningReceipt: {
    backgroundColor: Platform.OS === "android" ? color.solidTint.warning : color.fill.inset,
  },
  largeTextReceipt: { alignItems: "stretch" },
  title: { ...type.h1, color: color.text1, textAlign: "center" },
  message: { ...type.body, color: color.text2, textAlign: "center" },
  unchanged: { ...type.body, fontWeight: "600", color: color.text1 },
  reference: { ...type.mono, color: color.text2 },
  actions: { width: "100%", gap: space[2] },
});

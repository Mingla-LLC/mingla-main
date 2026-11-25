/**
 * #4490 spec 08 O5 part A — the PIN pad (Who's selling?, step-up, PIN setup,
 * Till device sign-out). Inline content, never its own sheet: it renders in
 * the screen or the sheet that shows it (08-O3 fix 3, one native modal per
 * presenter). Large keys (size.btn.xl), dots only (the digits are never shown
 * or announced), 4 to 6 digits then OK. The PIN is held in this component's
 * state only and cleared on submit.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { color, radius, size, space, type } from "../../../constants/designSystem";
import { Button } from "../../ui/Button";
import { PIN_COPY, PIN_MAX_DIGITS, pinAppend, pinComplete, pinKeyAction } from "./pinModel";

export interface PinPadProps {
  /** Shown above the dots ("Enter your PIN", "Enter it again"). */
  title: string;
  /** A line under the title: the person's name or a refusal in words. */
  subtitle?: string | null;
  error?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onSubmit: (pin: string) => void;
  testID?: string;
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

export function PinPad({ title, subtitle = null, error = false, busy = false, disabled = false, onSubmit, testID = "pin-pad" }: PinPadProps): React.ReactElement {
  const [pin, setPin] = useState("");
  const off = busy || disabled;
  const press = useCallback((digit: string) => setPin((p) => pinAppend(p, digit)), []);
  const back = useCallback(() => setPin((p) => p.slice(0, -1)), []);
  const submit = useCallback(() => {
    if (!pinComplete(pin)) return;
    const entered = pin;
    setPin("");
    onSubmit(entered);
  }, [onSubmit, pin]);

  // #4490 08-O5 fix 4: on web the keyboard types the PIN too (0-9, Backspace,
  // Enter = OK). Native keeps the on-screen keys only. A key typed into a
  // text field elsewhere is that field's, not the pad's.
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    if (Platform.OS !== "web" || off || typeof window === "undefined") return undefined;
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as { tagName?: string; isContentEditable?: boolean } | null;
      const tag = typeof target?.tagName === "string" ? target.tagName.toUpperCase() : "";
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable === true) return;
      const action = pinKeyAction(e.key, e.ctrlKey || e.metaKey || e.altKey);
      if (action === null) return;
      // #4490 08-O5 fix 5 (item 10): the pad's keys are the pad's only. It
      // listens in the capture phase and stops the key there, so Enter never
      // also presses the button that still has focus (the sheet's Close, the
      // refund confirm), which closed the sheet before the PIN was sent.
      e.preventDefault();
      e.stopPropagation();
      if (action.kind === "digit") press(action.digit);
      else if (action.kind === "back") back();
      else submitRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [back, off, press]);

  const key = (label: string, onPress: () => void, a11y: string, id: string): React.ReactElement => (
    <Pressable
      key={id}
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={({ pressed }) => [styles.key, pressed && styles.keyPressed, off && styles.keyOff]}
      testID={`${testID}-key-${id}`}
    >
      <Text style={styles.keyText}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={styles.root} testID={testID}>
      <Text style={styles.title} accessibilityRole="header">{title}</Text>
      {subtitle ? (
        <Text style={[styles.subtitle, error && styles.subtitleError]} accessibilityLiveRegion="polite" testID={`${testID}-message`}>
          {subtitle}
        </Text>
      ) : null}
      <View style={styles.dots} accessibilityLabel={`${pin.length} of ${PIN_MAX_DIGITS} digits entered`} testID={`${testID}-dots`}>
        {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
          <View key={i} style={[styles.dot, i < pin.length && styles.dotOn, error && pin.length === 0 && styles.dotError]} />
        ))}
      </View>
      <View style={styles.grid}>
        {KEYS.map((k) => key(k, () => press(k), k, k))}
        {key("⌫", back, PIN_COPY.deleteDigit, "back")}
        {key("0", () => press("0"), "0", "0")}
        <View style={styles.okCell}>
          <Button
            label={PIN_COPY.ok}
            variant="primary"
            size="xl"
            fullWidth
            loading={busy}
            disabled={disabled || !pinComplete(pin)}
            onPress={submit}
            testID={`${testID}-ok`}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: "center", gap: space[3], alignSelf: "center", width: "100%", maxWidth: size.dialog },
  title: { ...type.h1, color: color.text1, textAlign: "center" },
  subtitle: { ...type.small, color: color.text2, textAlign: "center" },
  subtitleError: { color: color.errorText },
  dots: { flexDirection: "row", gap: space[3], paddingVertical: space[2] },
  dot: { width: space[3], height: space[3], borderRadius: radius.full, borderWidth: 2, borderColor: color.lineStrong },
  dotOn: { backgroundColor: color.text1, borderColor: color.text1 },
  dotError: { borderColor: color.danger },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: space[2], width: "100%" },
  key: {
    width: "31%",
    minHeight: size.btn.xl + space[2],
    borderRadius: radius.md,
    backgroundColor: color.card2,
    alignItems: "center",
    justifyContent: "center",
  },
  keyPressed: { backgroundColor: color.card3 },
  keyOff: { opacity: 0.5 },
  keyText: { ...type.title, color: color.text1 },
  okCell: { width: "31%", justifyContent: "center" },
});

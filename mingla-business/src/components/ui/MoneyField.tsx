/**
 * #4490 — the shared money input. Numeric keypad, the brand currency's glyph,
 * exact parsing to integer MINOR units (NGN has exponent 2: typed "5000" is
 * stored as 500000). A brand with no currency never sees a made-up one: the
 * field is replaced by `noCurrency` (callers pass the payout-country prompt).
 */
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, space, type } from "../../constants/designSystem";
import { currencyCodeOrNull } from "../../utils/currency";
import { Input } from "./Input";
import {
  currencySymbol,
  formatMoneyInput,
  groupMoneyTyping,
  moneyErrorCopy,
  parseMoneyInput,
} from "./fieldModels";

export interface MoneyFieldProps {
  label: string;
  /** Stored amount in minor units, or null for "not set". */
  valueMinor: number | null;
  onChangeMinor: (next: number | null) => void;
  currency: string | null | undefined;
  /** Rendered instead of the input when the brand has no currency. */
  noCurrency?: React.ReactNode;
  placeholder?: string;
  disabled?: boolean;
  /** An error from the caller (e.g. "Enter a price"). Parse errors show first. */
  error?: string | null;
  accessibilityLabel?: string;
  testID?: string;
}

export function MoneyField({
  label,
  valueMinor,
  onChangeMinor,
  currency,
  noCurrency = null,
  placeholder = "0",
  disabled = false,
  error = null,
  accessibilityLabel,
  testID,
}: MoneyFieldProps): React.ReactElement {
  const code = currencyCodeOrNull(currency ?? undefined);
  const [text, setText] = useState<string>(() =>
    code === null ? "" : formatMoneyInput(valueMinor, code),
  );
  const [parseError, setParseError] = useState<string | null>(null);
  const lastEmitted = useRef<number | null>(valueMinor);

  // Re-hydrate when the stored value changes from outside (not our own echo).
  useEffect(() => {
    if (code === null) return;
    if (valueMinor !== lastEmitted.current) {
      lastEmitted.current = valueMinor;
      setText(formatMoneyInput(valueMinor, code));
      setParseError(null);
    }
  }, [code, valueMinor]);

  if (code === null) {
    return (
      <View style={styles.host} testID={testID}>
        <Text style={styles.label}>{label}</Text>
        {noCurrency}
      </View>
    );
  }

  const handleChange = (raw: string): void => {
    // #4490 N4: thousands are grouped as the host types, and again on blur.
    const next = groupMoneyTyping(raw);
    setText(next);
    const parsed = parseMoneyInput(next, code);
    if (parsed.kind === "blank") {
      setParseError(null);
      lastEmitted.current = null;
      onChangeMinor(null);
    } else if (parsed.kind === "valid") {
      setParseError(null);
      lastEmitted.current = parsed.minor;
      onChangeMinor(parsed.minor);
    } else {
      setParseError(moneyErrorCopy(parsed.reason, code));
    }
  };

  const shownError = parseError ?? error;
  return (
    <View style={styles.host} testID={testID}>
      <Text style={styles.label}>
        {label} ({currencySymbol(code)})
      </Text>
      <Input
        value={text}
        onChangeText={handleChange}
        onBlur={() => {
          const parsed = parseMoneyInput(text, code);
          if (parsed.kind === "valid") setText(formatMoneyInput(parsed.minor, code));
        }}
        variant="number"
        placeholder={placeholder}
        disabled={disabled}
        accessibilityLabel={accessibilityLabel ?? `${label}, in ${code}`}
        error={shownError}
        testID={testID !== undefined ? `${testID}-input` : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  host: { gap: space[1] },
  label: { ...type.small, color: color.text2 },
});

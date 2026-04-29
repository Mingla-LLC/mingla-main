/**
 * Input — single-line text input primitive.
 *
 * Variants map to `keyboardType` + `secureTextEntry` + autoCapitalize/auto-
 * Complete defaults so callers don't have to remember the right combo per
 * field type. `search` variant injects a leading magnifying-glass icon.
 *
 * Border animates from idle 1px to focus 1.5px `accent.warm` over 120ms.
 * Optional clear button shows when value is non-empty AND `clearable === true`.
 */

import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import type {
  StyleProp,
  TextInputProps,
  ViewStyle,
} from "react-native";

type TextInputFocusHandler = NonNullable<TextInputProps["onFocus"]>;
type TextInputFocusEvent = Parameters<TextInputFocusHandler>[0];

import {
  accent,
  durations,
  radius as radiusTokens,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

import { Icon } from "./Icon";
import type { IconName } from "./Icon";

export type InputVariant =
  | "text"
  | "email"
  | "phone"
  | "number"
  | "password"
  | "search";

type VariantBehaviour = Pick<
  TextInputProps,
  "keyboardType" | "secureTextEntry" | "autoCapitalize" | "autoComplete" | "autoCorrect"
>;

const VARIANT_BEHAVIOUR: Record<InputVariant, VariantBehaviour> = {
  text: {},
  email: {
    keyboardType: "email-address",
    autoCapitalize: "none",
    autoComplete: "email",
  },
  phone: {
    keyboardType: "phone-pad",
    autoComplete: "tel",
  },
  number: {
    keyboardType: "numeric",
  },
  password: {
    secureTextEntry: true,
    autoComplete: "password",
    autoCapitalize: "none",
  },
  search: {
    autoCorrect: false,
    autoCapitalize: "none",
  },
};

export interface InputProps
  extends Omit<
    TextInputProps,
    | "value"
    | "onChangeText"
    | "keyboardType"
    | "secureTextEntry"
    | "autoCapitalize"
    | "autoComplete"
    | "autoCorrect"
    | "style"
  > {
  value: string;
  onChangeText: (next: string) => void;
  variant?: InputVariant;
  placeholder?: string;
  leadingIcon?: IconName;
  /** Show the trailing clear (×) button when value is non-empty. */
  clearable?: boolean;
  disabled?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

const HEIGHT = 48;
const PADDING_X = 14;
const ICON_SIZE = 18;
const IDLE_BORDER = "rgba(255, 255, 255, 0.12)";
const BACKGROUND = "rgba(255, 255, 255, 0.04)";

export const Input: React.FC<InputProps> = ({
  value,
  onChangeText,
  variant = "text",
  placeholder,
  leadingIcon,
  clearable = false,
  disabled = false,
  testID,
  style,
  accessibilityLabel,
  onFocus,
  onBlur,
  ...rest
}) => {
  const [focused, setFocused] = useState(false);
  const behaviour = VARIANT_BEHAVIOUR[variant];
  const resolvedLeadingIcon: IconName | undefined =
    leadingIcon ?? (variant === "search" ? "search" : undefined);

  const handleFocus = useCallback(
    (event: TextInputFocusEvent): void => {
      setFocused(true);
      onFocus?.(event);
    },
    [onFocus],
  );

  const handleBlur = useCallback(
    (event: TextInputFocusEvent): void => {
      setFocused(false);
      onBlur?.(event);
    },
    [onBlur],
  );

  const handleClear = useCallback((): void => {
    onChangeText("");
  }, [onChangeText]);

  const showClear = clearable && value.length > 0 && !disabled;

  return (
    <View
      testID={testID}
      style={[
        styles.container,
        {
          borderColor: focused ? accent.warm : IDLE_BORDER,
          borderWidth: focused ? 1.5 : 1,
          opacity: disabled ? 0.5 : 1,
        },
        style,
      ]}
    >
      {resolvedLeadingIcon !== undefined ? (
        <View style={styles.leadingIcon}>
          <Icon name={resolvedLeadingIcon} size={ICON_SIZE} color={textTokens.tertiary} />
        </View>
      ) : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={textTokens.quaternary}
        editable={!disabled}
        onFocus={handleFocus}
        onBlur={handleBlur}
        accessibilityLabel={accessibilityLabel ?? placeholder}
        style={[
          styles.input,
          {
            color: textTokens.primary,
            fontSize: typography.body.fontSize,
            lineHeight: typography.body.lineHeight,
            fontWeight: typography.body.fontWeight,
            paddingLeft: resolvedLeadingIcon !== undefined ? 0 : PADDING_X,
            paddingRight: showClear ? 0 : PADDING_X,
          },
        ]}
        {...behaviour}
        {...rest}
      />
      {showClear ? (
        <Pressable
          onPress={handleClear}
          accessibilityRole="button"
          accessibilityLabel="Clear text"
          style={styles.clearButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Icon name="close" size={ICON_SIZE} color={textTokens.tertiary} />
        </Pressable>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    height: HEIGHT,
    borderRadius: radiusTokens.sm,
    backgroundColor: BACKGROUND,
    transitionProperty: "border-color",
    transitionDuration: `${durations.fast}ms`,
  } as ViewStyle,
  leadingIcon: {
    paddingLeft: PADDING_X,
    paddingRight: 8,
    height: "100%",
    justifyContent: "center",
  },
  input: {
    flex: 1,
    height: "100%",
  },
  clearButton: {
    paddingLeft: 8,
    paddingRight: PADDING_X - 2,
    height: "100%",
    justifyContent: "center",
  },
});

export default Input;

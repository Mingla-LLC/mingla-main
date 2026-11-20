/**
 * #4523 — the eager half of every Host calendar field. `lazyHostField` builds a
 * field that loads its calendar through ONE React.lazy (the whole feature lives
 * in `HostCalendarBody`, one chunk) and shows an inert-looking but pressable
 * row meanwhile: a tap made while loading is remembered and opens the calendar
 * as soon as the body mounts (Constitution #1, no dead tap).
 */
import React, { Suspense, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { color, radius, type } from "../../constants/designSystem";

export interface HostFieldBase {
  label: string;
  placeholder?: string;
  disabled?: boolean;
  hasError?: boolean;
  testID?: string;
}

export function lazyHostField<P extends HostFieldBase>(
  load: () => Promise<{ default: React.ComponentType<P & { openOnMount?: boolean }> }>,
  defaultPlaceholder: string,
): React.FC<P> {
  const Body = React.lazy(load);
  const Field: React.FC<P> = (props) => {
    // A tap on the placeholder while the body loads is remembered and opens the
    // calendar the moment the body mounts.
    const [armed, setArmed] = useState(false);
    return (
      <Suspense
        fallback={
          <LoadingRow
            label={props.label}
            placeholder={props.placeholder ?? defaultPlaceholder}
            disabled={props.disabled ?? false}
            hasError={props.hasError ?? false}
            testID={props.testID}
            armed={armed}
            onArm={() => setArmed(true)}
          />
        }
      >
        <Body {...props} openOnMount={armed} />
      </Suspense>
    );
  };
  return Field;
}

function LoadingRow({
  label,
  placeholder,
  disabled,
  hasError,
  testID,
  armed,
  onArm,
}: {
  label: string;
  placeholder: string;
  disabled: boolean;
  hasError: boolean;
  testID?: string;
  armed: boolean;
  onArm: () => void;
}): React.ReactElement {
  return (
    <View style={styles.host}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ busy: true, disabled }}
        disabled={disabled}
        onPress={onArm}
        testID={testID === undefined ? undefined : `${testID}-loading`}
        style={({ pressed }) => [
          styles.row,
          hasError ? styles.rowError : null,
          disabled ? styles.rowDisabled : null,
          pressed || armed ? styles.rowPressed : null,
        ]}
      >
        <Text style={styles.rowPlaceholder}>{placeholder}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { gap: 2 },
  label: { ...type.small, color: color.text2 },
  row: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  rowError: { borderColor: color.errorText },
  rowDisabled: { opacity: 0.45 },
  rowPressed: { opacity: 0.7 },
  rowPlaceholder: { fontSize: 16, color: color.text4 },
});

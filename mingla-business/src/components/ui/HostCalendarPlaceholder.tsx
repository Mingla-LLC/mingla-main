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
import type { HostFieldBase } from "./hostCalendarFieldProps";

// The one import site of the calendar body chunk for every Host field: each
// field names its body (`pick`), so the boot payload carries one loader.
type HostCalendarBodyModule = typeof import("./HostCalendarBody");
const loadHostCalendarBody = (): Promise<HostCalendarBodyModule> => import("./HostCalendarBody");

export function lazyHostField<P extends HostFieldBase>(
  pick: (m: HostCalendarBodyModule) => React.ComponentType<P & { openOnMount?: boolean }>,
  defaultPlaceholder: string,
): React.FC<P> {
  const Body = React.lazy(() => loadHostCalendarBody().then((m) => ({ default: pick(m) })));
  // One component, no separate row module: this file sits in the Host web boot
  // payload (#3281 boot room), so the loading row is drawn inline.
  return (props) => {
    // A tap on the placeholder while the body loads is remembered and opens the
    // calendar the moment the body mounts.
    const [armed, setArmed] = useState(false);
    const { label, disabled = false, testID } = props;
    return (
      <Suspense
        fallback={
          <View style={styles.host}>
            <Text style={styles.label}>{label}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ busy: true, disabled }}
              disabled={disabled}
              onPress={() => setArmed(true)}
              testID={testID === undefined ? undefined : `${testID}-loading`}
              style={({ pressed }) => [
                styles.row,
                props.hasError ? styles.rowError : null,
                // Pressed (or armed) wins over disabled, as before.
                pressed || armed ? styles.rowPressed : disabled ? styles.rowDisabled : null,
              ]}
            >
              <Text style={styles.rowPlaceholder}>{props.placeholder ?? defaultPlaceholder}</Text>
            </Pressable>
          </View>
        }
      >
        <Body {...props} openOnMount={armed} />
      </Suspense>
    );
  };
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

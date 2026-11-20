import React, { forwardRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { color, radius, space } from "../../../../constants/designSystem";
import { WebsiteIcon, type WebsiteIconName } from "../WebsiteIcon";
import { ui } from "../ui";
import { WORKSPACE_MODE_LABELS, WORKSPACE_MODES, type WorkspaceMode } from "../../../../sites/workspaceRoute";

/*
 * #4453 — the workspace's own small controls. Every one is a real button
 * with a 44 px target, a spoken name and, when it cannot act, the reason
 * (never a silent dead tap).
 */
export const IconButton = forwardRef<View, {
  icon: WebsiteIconName;
  /** The spoken name; also the hover tip. */
  label: string;
  onPress: () => void;
  /** Why it cannot act right now. Shown as the tip and spoken; the press explains instead of doing nothing. */
  disabledReason?: string | null;
  onDisabledPress?: (reason: string) => void;
  busy?: boolean;
  testID?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
  expanded?: boolean;
  hasPopup?: boolean;
}>(function IconButton(props, ref) {
  const [hovered, setHovered] = useState(false);
  const blocked = Boolean(props.disabledReason);
  const tip = props.disabledReason || props.label;
  return (
    <Pressable
      ref={ref}
      onPress={() => {
        if (props.busy) return;
        if (blocked) props.onDisabledPress?.(props.disabledReason!);
        else props.onPress();
      }}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      role="button"
      accessibilityRole="button"
      accessibilityLabel={blocked ? `${props.label}. ${props.disabledReason}` : props.label}
      accessibilityState={{ disabled: blocked, busy: props.busy === true }}
      aria-disabled={blocked || undefined}
      aria-expanded={props.expanded}
      aria-haspopup={props.hasPopup ? "menu" : undefined}
      testID={props.testID}
      style={({ pressed }) => [styles.iconButton, props.style, pressed && !blocked ? styles.pressed : null]}
    >
      <WebsiteIcon name={props.icon} size={props.size ?? 18} color={blocked ? ui.t4 : ui.t1} />
      {hovered && Platform.OS === "web" ? <View style={styles.tip} pointerEvents="none"><Text style={styles.tipText} numberOfLines={1}>{tip}</Text></View> : null}
    </Pressable>
  );
});

/** Ari · Edit · Design: a tab list; arrow keys move between the three. */
export function ModeSwitch({ mode, onChange }: { mode: WorkspaceMode; onChange: (mode: WorkspaceMode) => void }): React.ReactElement {
  const onKey = (event: { nativeEvent?: { key?: string }; key?: string }) => {
    const key = event.nativeEvent?.key ?? event.key;
    const index = WORKSPACE_MODES.indexOf(mode);
    if (key === "ArrowRight") onChange(WORKSPACE_MODES[(index + 1) % WORKSPACE_MODES.length]!);
    if (key === "ArrowLeft") onChange(WORKSPACE_MODES[(index + WORKSPACE_MODES.length - 1) % WORKSPACE_MODES.length]!);
  };
  return (
    <View role="tablist" accessibilityRole="tablist" accessibilityLabel="Website controls" style={styles.switch} testID="workspace-modes">
      {WORKSPACE_MODES.map((key) => {
        const on = key === mode;
        return (
          <Pressable
            key={key}
            role="tab"
            accessibilityRole="tab"
            aria-selected={on}
            accessibilityState={{ selected: on }}
            accessibilityLabel={WORKSPACE_MODE_LABELS[key]}
            onPress={() => onChange(key)}
            {...({ onKeyDown: onKey, tabIndex: on ? 0 : -1 } as object)}
            testID={`workspace-mode-${key}`}
            style={[styles.switchItem, on ? styles.switchOn : null]}
          >
            {key === "ari" ? <WebsiteIcon name="spark" size={15} color={on ? ui.t1 : ui.t2} /> : null}
            <Text style={[styles.switchText, on ? styles.switchTextOn : null]}>{WORKSPACE_MODE_LABELS[key]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A small tappable suggestion (44 px tall, wraps onto lines). */
export function SuggestionChip({ label, onPress, disabled, testID }: { label: string; onPress: () => void; disabled?: boolean; testID?: string }): React.ReactElement {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      role="button"
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled === true }}
      testID={testID}
      style={({ pressed }) => [styles.suggestion, disabled ? styles.dim : null, pressed ? styles.pressed : null]}
    >
      <Text style={styles.suggestionText}>{label}</Text>
    </Pressable>
  );
}

export function PanelNote({ children, tone, testID }: { children: React.ReactNode; tone?: "warn"; testID?: string }): React.ReactElement {
  return <Text style={[styles.note, tone === "warn" ? styles.noteWarn : null]} testID={testID}>{children}</Text>;
}

/** A small caps-free label above a group of controls. */
export function GroupLabel({ children }: { children: React.ReactNode }): React.ReactElement {
  return <Text style={styles.groupLabel} role="heading" aria-level={3}>{children}</Text>;
}

export const parts = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space[2] },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  grow: { flex: 1, minWidth: 0 },
  panelPad: { padding: space[4], gap: space[3] },
  box: { borderWidth: 1, borderColor: ui.cardBorder, backgroundColor: ui.card, borderRadius: radius.sm, padding: space[3], gap: space[2] },
  title: { fontSize: 15, lineHeight: 22, fontWeight: "600", color: ui.t1 },
  body: { fontSize: 14, lineHeight: 20, color: ui.t2 },
  small: { fontSize: 12, lineHeight: 16, color: ui.t3 },
});

const styles = StyleSheet.create({
  iconButton: { width: 44, height: 44, borderRadius: radius.full, borderWidth: 1, borderColor: ui.border2, backgroundColor: ui.card, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.7 },
  dim: { opacity: 0.5 },
  tip: { position: "absolute", top: 48, right: 0, zIndex: 20, maxWidth: 280, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.xs, backgroundColor: color.card3, borderWidth: 1, borderColor: ui.border2 },
  tipText: { fontSize: 12, lineHeight: 16, color: ui.t1 },
  switch: { flexDirection: "row", gap: 4, padding: 4, borderRadius: radius.sm, backgroundColor: ui.card, borderWidth: 1, borderColor: ui.cardBorder },
  switchItem: { flex: 1, minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: radius.xs },
  switchOn: { backgroundColor: color.fill.railOn },
  switchText: { fontSize: 14, fontWeight: "600", color: ui.t2 },
  switchTextOn: { color: ui.t1 },
  suggestion: { minHeight: 44, justifyContent: "center", paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: ui.border2, backgroundColor: ui.card },
  suggestionText: { fontSize: 14, lineHeight: 20, color: ui.t1 },
  note: { fontSize: 12, lineHeight: 18, color: ui.t3 },
  noteWarn: { color: color.warningText },
  groupLabel: { fontSize: 12, lineHeight: 16, fontWeight: "600", color: ui.t3, marginTop: space[2] },
});

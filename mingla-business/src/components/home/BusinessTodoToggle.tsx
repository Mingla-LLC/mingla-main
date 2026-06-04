/**
 * BusinessTodoToggle — ORCH-1038 [Business Home/Hub unified smart To-Do toggle].
 *
 * One collapsible to-do surface shared by Home and Hub, flush beneath the top bar.
 * It replaces every per-surface conditional card (no-brand / choose-brand /
 * add-venue / deck-readiness / rule-ladder next-action / offering-chooser) with a
 * single ordered list of derived rows (see `buildBusinessTodos`). Rows vanish
 * automatically as their state is satisfied; when there are zero rows the whole
 * toggle renders NOTHING (the screen is then driven purely by real analytics).
 *
 * Pure presentational: it takes the already-derived, already-ordered list and an
 * `onAction` dispatcher. The parent wraps it with `paddingHorizontal: spacing.md`
 * so its width is flush with the TopBar's inner content.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from "react-native";

import {
  accent,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { BusinessTodo } from "../../utils/businessTodos";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental !== undefined
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export interface BusinessTodoToggleProps {
  todos: BusinessTodo[];
  onAction: (todo: BusinessTodo) => void;
  testID?: string;
}

const headerCountLabel = (n: number): string =>
  n === 1 ? "1 thing to do" : `${n} things to do`;

export const BusinessTodoToggle: React.FC<BusinessTodoToggleProps> = ({
  todos,
  onAction,
  testID,
}) => {
  const [open, setOpen] = useState<boolean>(true);
  const count = todos.length;

  // Animate the row set whenever it shrinks/grows (the "vanish when done" feel)
  // and on every collapse/expand.
  useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  }, [count]);

  const toggleOpen = useCallback((): void => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((prev) => !prev);
  }, []);

  // Empty → render nothing at all (toggle hides entirely).
  if (count === 0) return null;

  return (
    <GlassCard variant="elevated" padding={spacing.md} testID={testID}>
      <Pressable
        onPress={toggleOpen}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`To-do list, ${headerCountLabel(count)}, ${
          open ? "tap to collapse" : "tap to expand"
        }`}
        style={styles.header}
        testID={testID !== undefined ? `${testID}-header` : undefined}
      >
        <View style={styles.headerLeft}>
          <Icon name="list" size={16} color={accent.warm} />
          <Text style={styles.headerTitle}>To-do</Text>
          <Text style={styles.headerCount}>{headerCountLabel(count)}</Text>
        </View>
        <Icon name={open ? "chevU" : "chevD"} size={18} color={textTokens.secondary} />
      </Pressable>

      {open ? (
        <View style={styles.list}>
          {todos.map((todo, index) => (
            <Pressable
              key={todo.id}
              onPress={() => onAction(todo)}
              accessibilityRole="button"
              accessibilityLabel={
                todo.badge !== undefined
                  ? todo.sublabel !== undefined
                    ? `${todo.label}, ${todo.badge}. ${todo.sublabel}`
                    : `${todo.label}, ${todo.badge}`
                  : todo.sublabel !== undefined
                    ? `${todo.label}. ${todo.sublabel}`
                    : todo.label
              }
              style={[styles.row, index === 0 && styles.rowFirst]}
              testID={testID !== undefined ? `${testID}-row-${todo.id}` : undefined}
            >
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>{todo.label}</Text>
                {todo.sublabel !== undefined ? (
                  <Text style={styles.rowSublabel}>{todo.sublabel}</Text>
                ) : null}
              </View>
              {/* ORCH-1064 — worded count pill (e.g. "3 to fix") for the
                  venue-claim-feedback row; decorative-within-the-button (count is
                  already folded into the row's accessibilityLabel above). */}
              {todo.badge !== undefined ? (
                <View
                  style={styles.badge}
                  testID={
                    testID !== undefined
                      ? `${testID}-row-${todo.id}-badge`
                      : undefined
                  }
                >
                  <Text style={styles.badgeText}>{todo.badge}</Text>
                </View>
              ) : null}
              <Icon name="chevR" size={16} color={textTokens.tertiary} />
            </Pressable>
          ))}
        </View>
      ) : null}
    </GlassCard>
  );
};

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  headerTitle: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
  },
  headerCount: {
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
    marginLeft: spacing.xs,
  },
  list: {
    marginTop: spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.10)",
    gap: spacing.sm,
  },
  rowFirst: {
    borderTopWidth: 0,
  },
  rowText: {
    flex: 1,
  },
  rowLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  rowSublabel: {
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
    marginTop: 2,
  },
  // ORCH-1064 — "N to fix" count pill (matches the VenueClaimStatusBanner badge:
  // worded, warning-tinted, finite-punch-list framing — not an anxiety dot).
  badge: {
    borderRadius: radius.full,
    backgroundColor: semantic.warning,
    paddingHorizontal: spacing.sm,
    height: 22,
    minWidth: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    ...typography.micro,
    color: "#1a1206",
  },
});

export default BusinessTodoToggle;

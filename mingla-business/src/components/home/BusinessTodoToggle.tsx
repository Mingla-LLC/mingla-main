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
 * Contents are prop-driven/presentational: it takes the already-derived,
 * already-ordered list and an `onAction` dispatcher. The parent wraps it with
 * `paddingHorizontal: spacing.md` so its width is flush with the TopBar's
 * inner content. The open/closed POSITION, however, is owned by the persisted
 * `todoToggleCollapseStore` (#882) — shared by every render site and
 * hydration-gated (nothing renders before `hasHydrated`), so the first
 * visible paint is already the remembered position.
 */
import React, { useCallback, useEffect } from "react";
import {
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
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
import { useTodoToggleCollapseStore } from "../../store/todoToggleCollapseStore";
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
  presentation?: "bounded" | "page-flow";
}

const headerCountLabel = (n: number): string =>
  n === 1 ? "1 thing to do" : `${n} things to do`;

export const BusinessTodoToggle: React.FC<BusinessTodoToggleProps> = ({
  todos,
  onAction,
  testID,
  presentation = "bounded",
}) => {
  // #882 — position is store-owned (persisted + hydration-gated), never
  // component-local: both render sites (Home, Hub) share it and it survives
  // remounts and restarts.
  const collapsed = useTodoToggleCollapseStore((s) => s.collapsed);
  const hasHydrated = useTodoToggleCollapseStore((s) => s.hasHydrated);
  const toggle = useTodoToggleCollapseStore((s) => s.toggle);
  const open = !collapsed;
  const count = todos.length;

  // Animate the row set whenever it shrinks/grows (the "vanish when done" feel)
  // and on every collapse/expand.
  useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  }, [count]);

  const toggleOpen = useCallback((): void => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    toggle();
  }, [toggle]);

  // Empty → render nothing at all (toggle hides entirely).
  if (count === 0) return null;
  // #882 — hydration gate: render NOTHING until the persisted position has
  // rehydrated, so the first visible paint is already the remembered position
  // (no open→collapsed flip). Deliberately not animated.
  if (!hasHydrated) return null;

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
        // ORCH-1256 — bounded, internally-scrollable row list. The toggle
        // mounts ABOVE the screen scroll area on Home/Hub (todoWrap sibling),
        // so an unbounded list (now up to ~11 rows with the profile band)
        // would bury the dashboard with rows running off-screen unscrollably.
        <TodoListOwner presentation={presentation} testID={testID}>
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
        </TodoListOwner>
      ) : null}
    </GlassCard>
  );
};

function TodoListOwner({ presentation, testID, children }: {
  presentation: "bounded" | "page-flow";
  testID?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return presentation === "page-flow" ? (
    <View style={styles.list} testID={testID !== undefined ? `${testID}-page-flow-list` : undefined}>{children}</View>
  ) : (
    <ScrollView style={[styles.list, styles.listBounded]} nestedScrollEnabled showsVerticalScrollIndicator>{children}</ScrollView>
  );
}

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
  // ORCH-1256 — capacity bound (F-4): ≈6 rows visible; rows beyond scroll
  // internally so the Home/Hub dashboard beneath the toggle stays reachable.
  // Tuneable constant — adjust only with a designer eyeball (SPEC OQ-3).
  listBounded: {
    maxHeight: 320,
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

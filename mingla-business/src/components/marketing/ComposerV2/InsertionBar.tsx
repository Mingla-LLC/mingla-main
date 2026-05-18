/**
 * ORCH-0864 [Marketing Composer V2] Stage C — InsertionBar.
 *
 * The persistent 3-pill bar that floats above the keyboard:
 *   [ + Event ]  [ { } Personalize ]  [ ⋮ ]
 *
 * Tapping a pill opens an inline panel directly above the bar:
 *   - events-open: horizontal scroller of brand events; tap → insertEvent
 *   - personalize-open: 2-col grid of 11 personalization tokens; tap →
 *     insertPersonalization (panel stays open for chained inserts per
 *     SPEC §4.8)
 *   - overflow-open: vertical list (Link / Divider / Image / Template)
 *
 * State machine (SPEC §4.8): only one panel open at any time. Opening one
 * closes the others. Tap outside (handled by parent — bar exposes
 * `state` as controlled prop) closes all.
 *
 * Invariants enforced here:
 *   - I-PROPOSED-MKT-COMPOSER-V2-INSERTION-BAR-ALWAYS-VISIBLE: no
 *     conditional rendering of the bar root container; `display:none` /
 *     `pointerEvents:"none"` are forbidden (strict-grep gate Stage G).
 *   - I-WCAG-AA-TOUCH-44PT: every interactive pill / item ≥ 44×44pt via
 *     minHeight + hitSlop.
 *   - I-WCAG-AA-ACCESSIBILITY-LABEL: every Pressable has explicit
 *     accessibilityLabel + accessibilityRole.
 *   - I-RN-COLOR-FORMATS: hex / rgb / hsl only (no oklch/lab).
 *   - I-RN-INLINE-STYLE-NONE: StyleSheet.create only.
 *
 * Pure RN — zero TenTap dep. Operator can render-test this in isolation
 * before Stage D wires the callbacks to the editor instance.
 */

import React, { useCallback } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import type { PersonalizationToken } from "../../../services/marketing/tenTapTokenBridge";
import type { EventCardOption } from "../../../services/marketing/brandEvents";
import {
  computeNextInsertionBarState,
  OVERFLOW_ITEMS,
  PERSONALIZATION_OPTIONS,
  type InsertionBarState,
  type OverflowItem,
} from "./InsertionBarState";

// Re-export for ergonomics — consumers import from InsertionBar.tsx.
export type { InsertionBarState };
export {
  computeNextInsertionBarState,
  PERSONALIZATION_TOKEN_COUNT,
  OVERFLOW_ITEM_IDS,
} from "./InsertionBarState";

export interface InsertionBarProps {
  state: InsertionBarState;
  onStateChange: (next: InsertionBarState) => void;

  /** Brand events for the events-open panel. Empty = panel shows hint. */
  events: EventCardOption[];

  /** Fires when operator picks an event from the scroller. */
  onInsertEvent: (event: EventCardOption) => void;

  /** Fires when operator picks a token from the personalization grid. */
  onInsertPersonalization: (token: PersonalizationToken) => void;

  /** Overflow actions. */
  onOpenLink: () => void;
  onInsertDivider: () => void;
  onInsertImage: () => void;
  onOpenTemplateDrawer: () => void;

  /** Stage F.9: merged toolbar — Bold / Italic / Link sit BEFORE +Event
   * in the same row. These callbacks fire the pell sendAction(actions.X)
   * commands from the editor host. */
  onToggleBold: () => void;
  onToggleItalic: () => void;
  onToggleLink: () => void;

  /** Optional style override on the root for embedding in keyboard accessory. */
  style?: StyleProp<ViewStyle>;
}

// ─── Component ─────────────────────────────────────────────────────────────

export function InsertionBar(props: InsertionBarProps): React.ReactElement {
  const {
    state,
    onStateChange,
    events,
    onInsertEvent,
    onInsertPersonalization,
    onOpenLink,
    onInsertDivider,
    onInsertImage,
    onOpenTemplateDrawer,
    onToggleBold,
    onToggleItalic,
    onToggleLink,
    style,
  } = props;

  const toggle = useCallback(
    (panel: Exclude<InsertionBarState, "closed">): void => {
      onStateChange(computeNextInsertionBarState(state, panel));
    },
    [state, onStateChange],
  );

  const handleInsertEvent = useCallback(
    (event: EventCardOption): void => {
      onInsertEvent(event);
      // Events panel closes on insert (one chip per tap) — matches design §4.4.
      onStateChange("closed");
    },
    [onInsertEvent, onStateChange],
  );

  const handleInsertToken = useCallback(
    (token: PersonalizationToken): void => {
      onInsertPersonalization(token);
      // Personalize panel STAYS OPEN for chained inserts — design §4.5 +
      // SPEC §4.8 ("tap token: stays open for chained inserts").
    },
    [onInsertPersonalization],
  );

  const handleOverflow = useCallback(
    (id: OverflowItem["id"]): void => {
      if (id === "link") onOpenLink();
      else if (id === "divider") onInsertDivider();
      else if (id === "image") onInsertImage();
      else if (id === "template") onOpenTemplateDrawer();
      // Overflow closes after every selection.
      onStateChange("closed");
    },
    [onOpenLink, onInsertDivider, onInsertImage, onOpenTemplateDrawer, onStateChange],
  );

  return (
    <View
      style={[styles.root, style]}
      accessibilityRole="toolbar"
      accessibilityLabel="Insertion toolbar"
      testID="composer-v2-insertion-bar"
    >
      {/* F.9l: panels moved AFTER the pill row so they expand DOWNWARD
          (between pills and body) instead of upward (between subject and
          pills). Operator F.9l directive: "+Event / Personalize / ⋮ open
          upward instead of downward" — fix is render-order swap. State
          machine + content unchanged. */}
      {/* F.9c: merged toolbar — ALWAYS ONE ROW via horizontal ScrollView.
          F.9's `flexWrap: 'wrap'` broke on iPhone Pro (361pt available
          width < 445pt total pill width) and pushed the footer off-screen.
          Horizontal scroll handles overflow gracefully: large screens
          show all pills; small screens let operator swipe. Divider
          dropped + Personalize label shortened to save width. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pillRow}
        keyboardShouldPersistTaps="handled"
      >
        <Pill
          label="B"
          accessibilityLabel="Bold"
          active={false}
          onPress={onToggleBold}
          compact
          testID="composer-v2-format-bold"
        />
        <Pill
          label="I"
          accessibilityLabel="Italic"
          active={false}
          onPress={onToggleItalic}
          compact
          italic
          testID="composer-v2-format-italic"
        />
        <Pill
          label="Link"
          accessibilityLabel="Insert link"
          active={false}
          onPress={onToggleLink}
          compact
          testID="composer-v2-format-link"
        />
        <Pill
          label="+ Event"
          accessibilityLabel="Insert event card"
          active={state === "events-open"}
          primary
          onPress={() => toggle("events-open")}
          testID="composer-v2-pill-event"
        />
        <Pill
          label="Personalize"
          accessibilityLabel="Insert personalization token"
          active={state === "personalize-open"}
          onPress={() => toggle("personalize-open")}
          testID="composer-v2-pill-personalize"
        />
        <Pill
          label="⋮"
          accessibilityLabel="More insertion options"
          active={state === "overflow-open"}
          onPress={() => toggle("overflow-open")}
          compact
          testID="composer-v2-pill-overflow"
        />
      </ScrollView>

      {state === "events-open" ? (
        <EventsPanel events={events} onPick={handleInsertEvent} />
      ) : null}
      {state === "personalize-open" ? (
        <PersonalizePanel onPick={handleInsertToken} />
      ) : null}
      {state === "overflow-open" ? (
        <OverflowPanel onPick={handleOverflow} />
      ) : null}
    </View>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

interface PillProps {
  label: string;
  accessibilityLabel: string;
  active: boolean;
  onPress: () => void;
  primary?: boolean;
  compact?: boolean;
  italic?: boolean;
  testID?: string;
}

function Pill(props: PillProps): React.ReactElement {
  const { label, accessibilityLabel, active, onPress, primary, compact, italic, testID } = props;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ expanded: active }}
      style={({ pressed }) => [
        styles.pill,
        compact === true ? styles.pillCompact : null,
        primary === true ? styles.pillPrimary : styles.pillNeutral,
        active ? styles.pillActive : null,
        pressed ? styles.pillPressed : null,
      ]}
      testID={testID}
    >
      <Text
        style={[
          styles.pillText,
          primary === true ? styles.pillTextPrimary : styles.pillTextNeutral,
          italic === true ? styles.pillTextItalic : null,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

interface EventsPanelProps {
  events: EventCardOption[];
  onPick: (event: EventCardOption) => void;
}

function EventsPanel(props: EventsPanelProps): React.ReactElement {
  const { events, onPick } = props;
  if (events.length === 0) {
    return (
      <View style={styles.panelEmpty}>
        <Text style={styles.panelEmptyText}>
          No upcoming events. Create one from the Events tab.
        </Text>
      </View>
    );
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.eventsScroller}
      accessibilityLabel="Brand events scroller"
    >
      {events.map((event) => (
        <Pressable
          key={event.id}
          onPress={() => onPick(event)}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={`Insert event card ${event.title}`}
          style={({ pressed }) => [
            styles.eventCard,
            pressed ? styles.eventCardPressed : null,
          ]}
          testID={`composer-v2-event-card-${event.id}`}
        >
          <Text style={styles.eventCardGlyph}>▣</Text>
          <View style={styles.eventCardText}>
            <Text style={styles.eventCardTitle} numberOfLines={1}>
              {event.title}
            </Text>
            {event.date_label !== null ? (
              <Text style={styles.eventCardDate} numberOfLines={1}>
                {event.date_label}
              </Text>
            ) : null}
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

interface PersonalizePanelProps {
  onPick: (token: PersonalizationToken) => void;
}

function PersonalizePanel(props: PersonalizePanelProps): React.ReactElement {
  const { onPick } = props;
  return (
    <View style={styles.personalizeGrid} accessibilityLabel="Personalization tokens">
      {PERSONALIZATION_OPTIONS.map((opt) => (
        <Pressable
          key={opt.token}
          onPress={() => onPick(opt.token)}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={`Insert ${opt.label} — ${opt.hint}`}
          style={({ pressed }) => [
            styles.tokenChip,
            pressed ? styles.tokenChipPressed : null,
          ]}
          testID={`composer-v2-token-${opt.token}`}
        >
          <Text style={styles.tokenChipText}>{opt.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

interface OverflowPanelProps {
  onPick: (id: OverflowItem["id"]) => void;
}

function OverflowPanel(props: OverflowPanelProps): React.ReactElement {
  const { onPick } = props;
  return (
    <View style={styles.overflowList} accessibilityLabel="More insertion options">
      {OVERFLOW_ITEMS.map((item) => (
        <Pressable
          key={item.id}
          onPress={() => onPick(item.id)}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={`${item.label} — ${item.hint}`}
          style={({ pressed }) => [
            styles.overflowItem,
            pressed ? styles.overflowItemPressed : null,
          ]}
          testID={`composer-v2-overflow-${item.id}`}
        >
          <Text style={styles.overflowItemText}>{item.label}</Text>
          <Text style={styles.overflowItemHint}>{item.hint}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Root MUST always render. Do NOT add conditional display:none or
  // pointerEvents:"none" — I-PROPOSED-MKT-COMPOSER-V2-INSERTION-BAR-ALWAYS-VISIBLE.
  root: {
    // F.9i: dropped backgroundColor + borderTop. The tinted background +
    // hairline top border sat directly under the subject text baseline
    // and read visually as a bar clipping the subject's descenders
    // (operator screenshot: "good" looked cut off). Toolbar now floats
    // transparently over the dark canvas — matches the F.9d floating-CTA
    // pattern in ComposerFooter. Each pill keeps its own border so the
    // toolbar still reads as a discrete control row.
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  pillRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs, // F.9c: dropped flexWrap + divider; horizontal scroll
                     // in parent handles overflow on narrow screens.
  },
  pill: {
    minHeight: 36, // F.8: was 44 (still 44pt with hitSlop:8 → I-WCAG-AA-TOUCH-44PT)
    minWidth: 36,
    paddingHorizontal: spacing.sm, // F.8: was spacing.md
    paddingVertical: spacing.xs, // F.8: was spacing.sm
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillCompact: {
    paddingHorizontal: spacing.sm,
  },
  pillPrimary: {
    backgroundColor: accent.tint,
    borderColor: accent.border,
  },
  pillNeutral: {
    backgroundColor: glass.tint.badge.idle,
    borderColor: glass.border.chrome,
  },
  pillActive: {
    backgroundColor: accent.glow,
    borderColor: accent.warm,
  },
  pillPressed: {
    opacity: 0.7,
  },
  pillText: {
    ...typography.buttonMd,
  },
  pillTextPrimary: {
    color: textTokens.primary,
  },
  pillTextNeutral: {
    color: textTokens.secondary,
  },
  pillTextItalic: {
    fontStyle: "italic",
  },

  // Events panel
  eventsScroller: {
    flexDirection: "row",
    gap: spacing.sm,
    // F.9m: paddingTop md gives breathing room between the pill row and
    // the events carousel (operator directive — pill was sitting flush
    // against the carousel chips).
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  eventCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: accent.tint,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: accent.border,
    maxWidth: 220,
  },
  eventCardPressed: {
    opacity: 0.7,
  },
  eventCardGlyph: {
    ...typography.bodyLg,
    color: textTokens.primary,
  },
  eventCardText: {
    flexShrink: 1,
  },
  eventCardTitle: {
    ...typography.bodySm,
    color: textTokens.primary,
    fontWeight: "600",
  },
  eventCardDate: {
    ...typography.caption,
    color: textTokens.secondary,
  },

  // Personalization grid
  personalizeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    // F.9m: paddingTop md — breathing room from pill row.
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  tokenChip: {
    minHeight: 44, // I-WCAG-AA-TOUCH-44PT — relaxed via hitSlop visually compact
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: glass.tint.profileElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  tokenChipPressed: {
    opacity: 0.7,
  },
  tokenChipText: {
    ...typography.monoMd,
    color: textTokens.primary,
  },

  // Overflow list
  overflowList: {
    // F.9m: paddingTop md — breathing room from pill row.
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  overflowItem: {
    minHeight: 44, // I-WCAG-AA-TOUCH-44PT
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.chrome,
    marginBottom: spacing.xs,
    backgroundColor: glass.tint.profileBase,
  },
  overflowItemPressed: {
    opacity: 0.7,
  },
  overflowItemText: {
    ...typography.body,
    color: textTokens.primary,
  },
  overflowItemHint: {
    ...typography.caption,
    color: textTokens.tertiary,
    marginTop: spacing.xxs,
  },

  // Empty state
  panelEmpty: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  panelEmptyText: {
    ...typography.bodySm,
    color: textTokens.tertiary,
  },
});

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

import React, { useCallback, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import {
  accent,
  androidOpaque,
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

  /** Stage F.9: merged toolbar — Bold / Italic / Underline / Link sit
   * BEFORE +Event in the same row. These callbacks run focus-then-
   * execCommand JS in the editor's WebView via commandDOM. */
  onToggleBold: () => void;
  onToggleItalic: () => void;
  onToggleUnderline: () => void;
  onToggleLink: () => void;

  /**
   * #2262 10.10 — the LIVE mark state of the current selection, WEB ONLY.
   *
   * `undefined` means "no channel exists on this platform", and the four format
   * glyphs then render with NO active affordance at all. That is deliberate and
   * it is the whole point: on native, `COMPOSER_SELECTION_TRACKER_JS` saves the
   * selection into the pell WebView's own `window` and posts NOTHING back to
   * React Native — there is no `postMessage`, no `onMessage`, no channel. An
   * active fill wired to a source that can never become true is the UI form of
   * a check that carries no information, and it is worse than no affordance,
   * because the operator learns to read "not filled" as "not bold". The native
   * WebView->RN selection channel is registered as its own work item.
   *
   * This prop replaces the four hardcoded `active={false}` props, which were
   * the same defect with the same cause.
   */
  formatState?: FormatState;

  /** Optional style override on the root for embedding in keyboard accessory. */
  style?: StyleProp<ViewStyle>;
}

/** #2262 10.10 — live mark state of the selection. */
export interface FormatState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  link: boolean;
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
    onToggleUnderline,
    onToggleLink,
    formatState,
    style,
  } = props;
  // #2262 — the missing overflow AFFORDANCE. The rail genuinely scrolls
  // (measured 383px of controls in a 288px viewport at 320pt) but
  // `showsHorizontalScrollIndicator={false}` left no sign of it, and on desktop
  // there is no sign at all. A 24pt edge fade paints on whichever side has
  // hidden content. Two measurements, both from onLayout/onScroll — neither is
  // a viewport height and neither sizes anything.
  const [railScrollX, setRailScrollX] = useState(0);
  const [railViewportW, setRailViewportW] = useState(0);
  const [railContentW, setRailContentW] = useState(0);
  const handleRailScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>): void => {
      setRailScrollX(e.nativeEvent.contentOffset.x);
    },
    [],
  );
  const handleRailLayout = useCallback((e: LayoutChangeEvent): void => {
    setRailViewportW(e.nativeEvent.layout.width);
  }, []);
  const handleRailContentSize = useCallback((w: number): void => {
    setRailContentW(w);
  }, []);
  const fadeLeft = railScrollX > 1;
  const fadeRight =
    railContentW > 0 &&
    railViewportW > 0 &&
    railScrollX + railViewportW < railContentW - 1;

  // WEB ONLY, per #2262 10.10 + the operator decision recorded there. On native
  // `formatState` is never supplied, so `active` stays undefined and the glyph
  // renders neutral.
  const marks = Platform.OS === "web" ? formatState : undefined;

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
      accessibilityLabel="Formatting and insert tools"
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
      {state === "events-open" ? (
        <EventsPanel events={events} onPick={handleInsertEvent} />
      ) : null}
      {state === "personalize-open" ? (
        <PersonalizePanel onPick={handleInsertToken} />
      ) : null}
      {state === "overflow-open" ? (
        <OverflowPanel onPick={handleOverflow} />
      ) : null}
      <View style={styles.foot}>
        <View style={styles.railWrap} onLayout={handleRailLayout}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.pillRow}
            keyboardShouldPersistTaps="handled"
            onScroll={handleRailScroll}
            onContentSizeChange={handleRailContentSize}
            scrollEventThrottle={16}
          >
            <Glyph
              label="B"
              accessibilityLabel="Bold"
              active={marks?.bold}
              onPress={onToggleBold}
              testID="composer-v2-format-bold"
            />
            <Glyph
              label="I"
              accessibilityLabel="Italic"
              active={marks?.italic}
              onPress={onToggleItalic}
              italic
              testID="composer-v2-format-italic"
            />
            <Glyph
              label="U"
              accessibilityLabel="Underline"
              active={marks?.underline}
              onPress={onToggleUnderline}
              underline
              testID="composer-v2-format-underline"
            />
            <Glyph
              label="⌗"
              accessibilityLabel="Insert link"
              active={marks?.link}
              onPress={onToggleLink}
              testID="composer-v2-format-link"
            />
            {/* #2262 — DESIGN §4.2 wanted these two moved into the `⋮` menu
                below `bpCompact`. `⋮`'s item list lives in `InsertionBarState.ts`,
                which is DO-NOT-TOUCH on this issue, and the alternative loses
                nothing: the rail genuinely scrolls, and it now carries the edge
                fade that was the actual missing affordance. Deviation recorded
                in the implementation report. */}
            <TextButton
              label="+ Event"
              accessibilityLabel="Insert event card"
              open={state === "events-open"}
              onPress={() => toggle("events-open")}
              testID="composer-v2-pill-event"
            />
            <TextButton
              label="Personalize"
              accessibilityLabel="Insert personalization token"
              open={state === "personalize-open"}
              onPress={() => toggle("personalize-open")}
              testID="composer-v2-pill-personalize"
            />
          </ScrollView>
          {fadeLeft ? (
            <LinearGradient
              colors={["rgba(19, 21, 25, 1)", "rgba(19, 21, 25, 0)"]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[styles.edgeFade, styles.edgeFadeLeft]}
              testID="composer-v2-toolbar-fade-left"
            />
          ) : null}
          {fadeRight ? (
            <LinearGradient
              colors={["rgba(19, 21, 25, 0)", "rgba(19, 21, 25, 1)"]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[styles.edgeFade, styles.edgeFadeRight]}
              testID="composer-v2-toolbar-fade-right"
            />
          ) : null}
        </View>
        {/* Pinned right, never scrolls, never collapses — it is the escape
            hatch, so everything dropped at a narrow width is reachable here. */}
        <Glyph
          label="⋮"
          accessibilityLabel="More insert options"
          open={state === "overflow-open"}
          onPress={() => toggle("overflow-open")}
          testID="composer-v2-pill-overflow"
        />
      </View>
    </View>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

/**
 * A 32x32 icon button. The letterforms B / I / U ARE the icons and are
 * universally read; `hitSlop: 6` takes the effective target to 44pt
 * (I-WCAG-AA-TOUCH-44PT).
 *
 * `active` is OPTIONAL and that is load-bearing. `undefined` means the platform
 * has no channel that could ever report the state, and the button then renders
 * with NO active affordance — see `InsertionBarProps.formatState`. `open` is a
 * separate prop for the panel toggles, whose state has always been real
 * (`state === "events-open"` etc.) and is reported through
 * `accessibilityState.expanded` rather than `selected`.
 */
interface GlyphProps {
  label: string;
  accessibilityLabel: string;
  active?: boolean;
  open?: boolean;
  onPress: () => void;
  italic?: boolean;
  underline?: boolean;
  testID?: string;
}

function Glyph(props: GlyphProps): React.ReactElement {
  const { label, accessibilityLabel, active, open, onPress, italic, underline, testID } =
    props;
  const isActive = active === true || open === true;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      // A toggle reports `selected`; a disclosure reports `expanded`.
      accessibilityState={
        open === undefined ? { selected: active === true } : { expanded: open }
      }
      style={({ pressed }) => [
        styles.glyph,
        isActive
          ? Platform.OS === "android"
            ? styles.glyphActiveOpaque
            : styles.glyphActive
          : null,
        pressed ? styles.glyphPressed : null,
      ]}
      testID={testID}
    >
      <Text
        style={[
          styles.glyphText,
          isActive ? styles.glyphTextActive : null,
          italic === true ? styles.glyphTextItalic : null,
          underline === true ? styles.glyphTextUnderline : null,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** A labelled insert action. `+ Event` no longer wears the primary fill — it is
 *  not the primary action on this screen and should not carry that colour. */
interface TextButtonProps {
  label: string;
  accessibilityLabel: string;
  open: boolean;
  onPress: () => void;
  testID?: string;
}

function TextButton(props: TextButtonProps): React.ReactElement {
  const { label, accessibilityLabel, open, onPress, testID } = props;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ expanded: open }}
      style={({ pressed }) => [
        styles.textBtn,
        open
          ? Platform.OS === "android"
            ? styles.textBtnOpenOpaque
            : styles.textBtnOpen
          : null,
        pressed ? styles.glyphPressed : null,
      ]}
      testID={testID}
    >
      <Text style={[styles.textBtnLabel, open ? styles.textBtnLabelOpen : null]}>
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
  /**
   * #2262 — the toolbar now lives at the SHEET FOOT, as the sheet's own chrome
   * rather than a pill row cutting the screen in half between the subject and
   * the body. It is a CHILD of the sheet, so its 44pt is part of the sheet's
   * height and not part of the chrome above it — which is exactly why moving it
   * cost the height model nothing: `measuredBodyPx` is taken after layout, so
   * it is automatically net of wherever this ended up.
   *
   * Root MUST always render. Do NOT add conditional display:none or
   * pointerEvents:"none" — I-PROPOSED-MKT-COMPOSER-V2-INSERTION-BAR-ALWAYS-VISIBLE.
   */
  root: {
    flexShrink: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: glass.border.profileBase,
  },
  foot: {
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
  },
  railWrap: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
  },
  edgeFade: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 24,
  },
  edgeFadeLeft: {
    left: 0,
  },
  edgeFadeRight: {
    right: 0,
  },
  pillRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  glyph: {
    height: 32,
    minWidth: 32,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "transparent",
    backgroundColor: "transparent",
  },
  glyphActive: {
    backgroundColor: accent.tint,
    borderColor: glass.border.control,
  },
  glyphActiveOpaque: {
    backgroundColor: androidOpaque.accentFill,
    borderColor: androidOpaque.controlBorder,
  },
  glyphPressed: {
    backgroundColor: glass.tint.profileElevated,
  },
  glyphText: {
    ...typography.buttonMd,
    fontSize: 15,
    color: textTokens.secondary,
  },
  glyphTextActive: {
    color: accent.warm,
  },
  glyphTextItalic: {
    fontStyle: "italic",
  },
  glyphTextUnderline: {
    textDecorationLine: "underline",
  },
  textBtn: {
    height: 32,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "transparent",
    backgroundColor: "transparent",
  },
  textBtnOpen: {
    backgroundColor: accent.tint,
    borderColor: accent.border,
  },
  textBtnOpenOpaque: {
    backgroundColor: androidOpaque.accentFill,
    borderColor: accent.border,
  },
  textBtnLabel: {
    ...typography.buttonMd,
    color: textTokens.secondary,
  },
  textBtnLabelOpen: {
    color: textTokens.primary,
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
    overflow: "hidden",
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
    overflow: "hidden",
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
    overflow: "hidden",
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

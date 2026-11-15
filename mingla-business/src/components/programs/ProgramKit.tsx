/**
 * #3872 — shared Host building blocks for the Creator and Referral programs,
 * on the app's glass design system (no flat "ProgramUi" look).
 */
import React from "react";
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ScrollView } from "../../wrappers/SmartScrollView";
import { useKeyboardIsVisible } from "../../wrappers/useKeyboardIsVisible";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { useStickyFooterOffset } from "../../hooks/useStickyFooterOffset";
import { scrollPaddingClearOfFloatingAction } from "../../utils/floatingActionClearance";
import { GlassCard } from "../ui/GlassCard";
import { Icon, type IconName } from "../ui/Icon";
import { color as colorTokens, radius, space, type } from "../../constants/designSystem";
import { ProgramBackBar } from "./ProgramBackBar";
import {
  PROGRAM_BLOCK_GAP,
  PROGRAM_CARD_PADDING,
  PROGRAM_GUTTER,
  PROGRAM_LABEL_GAP,
  PROGRAM_ROW_MIN_HEIGHT,
  programFormChrome,
} from "./programLayout";
import type { HostStatusTone } from "../../utils/creatorProgramFormat";

// ---------------------------------------------------------------------------
// Screen shell: plain title bar, scrolling content, optional sticky footer.
// ---------------------------------------------------------------------------

/**
 * Round 2: the screen pads its own safe area from `useSafeAreaInsets` instead
 * of a measuring `SafeAreaView`, so coming back to a program screen never
 * re-measures and leaves a gap at the top. `embedded` renders the same body
 * inside another screen's chrome (the Blast tab): no title bar, no safe area,
 * and the footer flows at the end of the content instead of pinning.
 */
export function ProgramScreen({
  title,
  fallback,
  leading,
  right,
  footer,
  overlay,
  refreshing,
  onRefresh,
  children,
  testID,
  embedded = false,
  onBack,
  desktopWidth = "form",
}: {
  onBack?: () => void;
  /**
   * #4420 — the desktop column. `form` keeps the 720 form column (T4);
   * `detail` opens the 1120 detail column so a ProgramColumns 8/4 split has
   * room and the page is never a small card on an empty canvas.
   */
  desktopWidth?: "form" | "detail";
  title: string;
  fallback: string;
  leading?: "back" | "close";
  right?: React.ReactNode;
  footer?: React.ReactNode;
  /** Sheets and viewers: rendered outside the scroll view so they cover the screen. */
  overlay?: React.ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  children: React.ReactNode;
  testID?: string;
  embedded?: boolean;
}): React.ReactElement {
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardIsVisible();
  const { isWideDesktop } = useResponsiveLayout();
  const detailWide = !embedded && isWideDesktop && desktopWidth === "detail";
  const chrome = programFormChrome({
    keyboardVisible,
    hasFooter: Boolean(footer),
  });
  // #4430 H-B: an embedded program screen lives in the Blast tab, where the
  // floating action ("Hire a creator") and the bottom nav sit over the
  // content. Reserve their height (safe area included) so the last button
  // scrolls clear of them, as the ad screens do (#4238).
  const embeddedBottom = scrollPaddingClearOfFloatingAction(useStickyFooterOffset());
  const scroll = (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        detailWide && styles.contentDetailWide,
        embedded && styles.contentEmbedded,
        embedded ? { paddingBottom: embeddedBottom } : null,
      ]}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing === true}
            onRefresh={onRefresh}
            tintColor={colorTokens.text2}
          />
        ) : undefined
      }
    >
      {children}
      {embedded && footer && chrome.showFooter ? (
        <View style={styles.inlineFooter}>{footer}</View>
      ) : null}
    </ScrollView>
  );
  if (embedded) {
    return (
      <View style={styles.embedded} testID={testID}>
        {scroll}
        {overlay ?? null}
      </View>
    );
  }
  return (
    <View
      style={[
        styles.safe,
        { paddingTop: insets.top, paddingBottom: chrome.showFooter ? 0 : insets.bottom },
      ]}
      testID={testID}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <ProgramBackBar
        title={title}
        fallback={fallback}
        leading={leading}
        onBack={onBack}
        right={chrome.showDone ? <KeyboardDone /> : right}
      />
      {scroll}
      {chrome.showFooter ? (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space[2]) }]}>
          {footer}
        </View>
      ) : null}
      {overlay ?? null}
    </View>
  );
}

/** Title-bar Done while the keyboard is open (closes it). */
function KeyboardDone(): React.ReactElement {
  return (
    <Pressable
      onPress={() => Keyboard.dismiss()}
      accessibilityRole="button"
      accessibilityLabel="Done typing"
      hitSlop={8}
      style={styles.done}
    >
      <Text style={styles.doneText}>Done</Text>
    </Pressable>
  );
}

/**
 * Scrollable, padded body for a Sheet. Inputs stay above the keyboard (the
 * scroll view is keyboard-aware) and an optional `footer` (the sheet's main
 * button) hides while typing, the same rule as program screens.
 */
export function SheetBody({
  title,
  children,
  footer,
}: {
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}): React.ReactElement {
  const keyboardVisible = useKeyboardIsVisible();
  const chrome = programFormChrome({
    keyboardVisible,
    hasFooter: Boolean(footer),
  });
  return (
    <ScrollView
      contentContainerStyle={styles.sheetBody}
      keyboardShouldPersistTaps="handled"
    >
      {title ? (
        <Text style={styles.sheetTitle} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      {children}
      {chrome.showFooter ? footer : null}
    </ScrollView>
  );
}

export function ProgramLoading({
  label = "Loading…",
}: {
  label?: string;
}): React.ReactElement {
  return (
    <View style={styles.loading} accessibilityLabel={label}>
      <ActivityIndicator color={colorTokens.text2} />
    </View>
  );
}

/**
 * #4168 — shared responsive program workspace. Desktop uses the available
 * canvas as a 5:3 primary/support pair; compact screens keep one vertical page
 * scroll and stack the same surfaces. No column owns an independent vertical
 * scroller.
 */
export function ProgramColumns({
  primary,
  support,
  supportFirstOnCompact = false,
}: {
  primary: React.ReactNode;
  support: React.ReactNode;
  supportFirstOnCompact?: boolean;
}): React.ReactElement {
  const { isWideDesktop } = useResponsiveLayout();
  const primaryColumn = (
    <View style={isWideDesktop ? styles.primaryWide : styles.columnCompact}>
      {primary}
    </View>
  );
  const supportColumn = (
    <View style={isWideDesktop ? styles.supportWide : styles.columnCompact}>
      {support}
    </View>
  );
  return (
    <View
      style={[
        styles.programColumns,
        isWideDesktop ? styles.programColumnsWide : styles.programColumnsCompact,
        isWideDesktop && supportFirstOnCompact
          ? styles.programColumnsWideReversed
          : null,
      ]}
    >
      {supportFirstOnCompact ? supportColumn : primaryColumn}
      {supportFirstOnCompact ? primaryColumn : supportColumn}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Text pieces
// ---------------------------------------------------------------------------

export function SectionLabel({
  children,
  wide = false,
}: {
  children: React.ReactNode;
  /** Desktop: a little more room above the label (12 instead of 8). */
  wide?: boolean;
}): React.ReactElement {
  return (
    <Text
      style={[styles.section, wide && styles.sectionWide]}
      accessibilityRole="header"
    >
      {children}
    </Text>
  );
}

export function Muted({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  return <Text style={[styles.muted, style as never]}>{children}</Text>;
}

export function FieldError({
  message,
}: {
  message: string | null | undefined;
}): React.ReactElement | null {
  if (!message) return null;
  return (
    <Text style={styles.fieldError} accessibilityLiveRegion="polite">
      {message}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Cards, rows, tiles, pills
// ---------------------------------------------------------------------------

export function Card({
  children,
  style,
  onPress,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  accessibilityLabel?: string;
}): React.ReactElement {
  // Round 2: ONE inner padding, set once here. The old card passed its own
  // padding on GlassCard's chrome on top of GlassCard's default padding, so
  // every card sat 16pt further in than the headings around it.
  const card = (
    <GlassCard
      variant="base"
      radius="lg"
      padding={PROGRAM_CARD_PADDING}
      style={style}
      contentStyle={styles.cardContent}
    >
      {children}
    </GlassCard>
  );
  if (!onPress) return card;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => (pressed ? styles.pressed : null)}
    >
      {card}
    </Pressable>
  );
}

export function ListGroup({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <GlassCard
      variant="base"
      radius="lg"
      padding={0}
      contentStyle={styles.group}
    >
      {items.map((child, index) => (
        <View key={index} style={index > 0 ? styles.groupDivider : null}>
          {child}
        </View>
      ))}
    </GlassCard>
  );
}

/** Web-only Pressable state (hover / keyboard focus), passed at runtime by react-native-web. */
type WebPressableState = PressableStateCallbackType & {
  hovered?: boolean;
  focused?: boolean;
};

export function ListRow({
  icon,
  title,
  subtitle,
  right,
  onPress,
  chevron = Boolean(onPress),
  accessibilityLabel,
  leading,
  compact = false,
  action,
  tag,
  testID,
}: {
  icon?: IconName;
  title: string;
  subtitle?: string | null;
  right?: React.ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  accessibilityLabel?: string;
  leading?: React.ReactNode;
  /** One line for the title and one for the subtitle (list rows, not details). */
  compact?: boolean;
  /**
   * #3872 — a second control on the row (Send). Rendered as a SIBLING of the
   * row's pressable area, never inside it: a button inside a button is
   * invalid on web, screen readers flatten it, and one click can fire both.
   */
  action?: React.ReactNode;
  /** #3872 — a short status tag after the title ("Needs setup"). */
  tag?: { label: string; tone: StatusTagTone };
  testID?: string;
}): React.ReactElement {
  // Compact rows with an icon tile are list rows people scan and tap: 64pt
  // tall, a 40pt tile, 12pt between the pieces.
  const roomy = compact && Boolean(icon) && !leading;
  const label =
    accessibilityLabel ?? (subtitle ? `${title}, ${subtitle}` : title);
  const chevronIcon = chevron ? (
    <Icon name="chevR" size={16} color={colorTokens.text3} />
  ) : null;
  const rightNode =
    typeof right === "string" ? (
      <Text style={styles.rowRight}>{right}</Text>
    ) : (
      (right ?? null)
    );
  const content = (hovered: boolean): React.ReactElement => (
    <>
      {leading ??
        (icon ? (
          <View style={[styles.rowIcon, roomy && styles.rowIconRoomy]}>
            <Icon name={icon} size={roomy ? 20 : 18} color={colorTokens.text1} />
          </View>
        ) : null)}
      <View style={styles.rowText}>
        <View style={tag ? styles.rowTitleLine : null}>
          <Text
            style={[
              styles.rowTitle,
              tag && styles.rowTitleShrink,
              hovered && styles.rowTitleHover,
            ]}
            numberOfLines={compact ? 1 : 2}
          >
            {title}
          </Text>
          {tag ? <StatusTag label={tag.label} tone={tag.tone} /> : null}
        </View>
        {subtitle ? (
          <Text style={styles.rowSubtitle} numberOfLines={compact ? 1 : 3}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </>
  );
  const rowStyle = [styles.row, roomy && styles.rowRoomy];

  if (!onPress) {
    return (
      <View style={rowStyle} testID={testID}>
        {content(false)}
        {rightNode}
        {action ?? null}
        {chevronIcon}
      </View>
    );
  }

  if (action === undefined || action === null) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        testID={testID}
        style={(state: WebPressableState) => [
          state.pressed ? styles.pressed : null,
          state.focused && Platform.OS === "web" ? styles.focusRing : null,
        ]}
      >
        {(state: WebPressableState) => (
          <View style={rowStyle}>
            {content(state.hovered === true)}
            {rightNode}
            {chevronIcon}
          </View>
        )}
      </Pressable>
    );
  }

  // With an action: [pressable icon + text][action][chevron]. The chevron
  // still navigates (its own pressable, hidden from assistive tech so the
  // row is ONE element for a screen reader, and the action is another).
  return (
    <View style={[rowStyle, styles.rowWithAction]} testID={testID}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        testID={testID !== undefined ? `${testID}-open` : undefined}
        style={(state: WebPressableState) => [
          styles.rowHit,
          roomy && styles.rowHitRoomy,
          state.pressed ? styles.pressed : null,
          state.focused && Platform.OS === "web" ? styles.focusRing : null,
        ]}
      >
        {(state: WebPressableState) => content(state.hovered === true)}
      </Pressable>
      {rightNode}
      {action}
      {chevronIcon ? (
        <Pressable
          onPress={onPress}
          accessibilityLabel={label}
          accessible={false}
          focusable={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.rowChevronHit}
          testID={testID !== undefined ? `${testID}-chevron` : undefined}
        >
          {chevronIcon}
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * #3872 — the small tinted button for a row's direct action (Send) and for
 * Try again. 36pt tall with a hit area of at least 44pt. Tinted, never a
 * solid orange fill with white text (2.9:1); on web hover it fills with the
 * accent and switches to dark text (6.9:1).
 */
export function ProgramButton({
  label,
  icon,
  onPress,
  accessibilityLabel,
  disabled = false,
  testID,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
  testID?: string;
}): React.ReactElement {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      hitSlop={PROGRAM_BUTTON_HIT_SLOP}
      testID={testID}
      // react-native-web's Pressable ignores hitSlop, so on web the pressable
      // itself is a transparent 44pt-tall box around the 36pt pill; the
      // negative margin keeps its layout footprint at 36pt.
      style={Platform.OS === "web" ? styles.buttonHitWeb : null}
    >
      {(state: WebPressableState) => {
        const color =
          state.hovered && !disabled && Platform.OS === "web"
            ? colorTokens.canvas
            : colorTokens.text1;
        return (
          <View
            style={[
              styles.button,
              state.hovered && !disabled && Platform.OS === "web"
                ? styles.buttonHover
                : null,
              state.pressed ? styles.buttonPressed : null,
              state.focused && Platform.OS === "web" ? styles.focusRing : null,
              disabled ? styles.buttonDisabled : null,
            ]}
          >
            {icon ? <Icon name={icon} size={16} color={color} /> : null}
            <Text style={[styles.buttonText, { color }]} numberOfLines={1}>
              {label}
            </Text>
          </View>
        );
      }}
    </Pressable>
  );
}

/** 36pt visual + 4pt above and below = a 44pt tap target. */
/** The minimum tap target on every platform. */
export const PROGRAM_TAP_TARGET = 44;

export const PROGRAM_BUTTON_HIT_SLOP = { top: 4, bottom: 4, left: 8, right: 8 } as const;

/**
 * Round 2: numbers sit in ONE strip of up to three (never a tile grid).
 * `tone: "muted"` keeps a value in the normal text colour; only money coming
 * in may be green, so spend and fees are never green.
 */
export { StatStrip } from "./StatStrip";

/**
 * #4168 — compact empty card. Wide screens use one horizontal row so an
 * empty program still feels intentional instead of floating in the middle of
 * a large canvas; compact screens stack the same content without introducing
 * another scroll region.
 */
export function ProgramEmpty({
  icon,
  title,
  body,
  action,
}: {
  icon: IconName;
  title: string;
  body: string;
  action?: React.ReactNode;
}): React.ReactElement {
  const { isWideDesktop } = useResponsiveLayout();
  return (
    <View style={[styles.empty, isWideDesktop && styles.emptyWide]}>
      <View style={styles.emptyIcon}>
        <Icon name={icon} size={26} color={colorTokens.text1} />
      </View>
      <View style={styles.emptyCopy}>
        <Text style={styles.emptyTitle} accessibilityRole="header">
          {title}
        </Text>
        <Text style={styles.emptyBody}>{body}</Text>
      </View>
      {action ? (
        <View style={[styles.emptyAction, isWideDesktop && styles.emptyActionWide]}>
          {action}
        </View>
      ) : null}
    </View>
  );
}

const TONE: Record<
  HostStatusTone | "live" | "paused",
  { bg: string; fg: string }
> = {
  action: { bg: colorTokens.warningTint, fg: colorTokens.warningText },
  waiting: { bg: colorTokens.fill.tile, fg: colorTokens.text2 },
  done: { bg: colorTokens.successTint, fg: colorTokens.success },
  problem: { bg: colorTokens.errorTint, fg: colorTokens.errorText },
  ended: { bg: colorTokens.fill.tile, fg: colorTokens.text3 },
  live: { bg: colorTokens.successTint, fg: colorTokens.success },
  paused: { bg: colorTokens.warningTint, fg: colorTokens.warning },
};

export type StatusTagTone = keyof typeof TONE;

export function StatusTag({
  label,
  tone,
}: {
  label: string;
  tone: StatusTagTone;
}): React.ReactElement {
  const colors = TONE[tone];
  return (
    <View style={[styles.tag, { backgroundColor: colors.bg }]}>
      <Text style={[styles.tagText, { color: colors.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}): React.ReactElement {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      style={[styles.chip, selected && styles.chipOn]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Two-to-four segment control (Sell tickets / Get seen; Offers / Promoters …). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (next: T) => void;
}): React.ReactElement {
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map(([key, label]) => {
        const on = key === value;
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected: on }}
            style={[styles.segment, on && styles.segmentOn]}
          >
            <Text
              style={[styles.segmentText, on && styles.segmentTextOn]}
              numberOfLines={1}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Initials({
  name,
  size = 40,
}: {
  name: string;
  size?: number;
}): React.ReactElement {
  const letters =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?";
  return (
    <View
      style={[
        styles.initials,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      <Text style={styles.initialsText}>{letters}</Text>
    </View>
  );
}

export function Checkbox({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}): React.ReactElement {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      style={styles.checkRow}
    >
      <View style={[styles.checkBox, checked && styles.checkBoxOn]}>
        {checked ? (
          <Icon name="check" size={14} color={colorTokens.textStrong} />
        ) : null}
      </View>
      <Text style={styles.checkLabel}>{label}</Text>
    </Pressable>
  );
}

export function SummaryLine({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}): React.ReactElement {
  return (
    <View style={styles.summaryLine}>
      <Text style={[styles.summaryLabel, strong && styles.summaryStrong]}>
        {label}
      </Text>
      <Text style={[styles.summaryValue, strong && styles.summaryStrong]}>
        {value}
      </Text>
    </View>
  );
}

export const programStyles = StyleSheet.create({
  title: { color: colorTokens.text1, fontSize: 18, fontWeight: "700" },
  body: { color: colorTokens.text1, fontSize: 15, lineHeight: 22 },
  muted: { color: colorTokens.text2, fontSize: 14, lineHeight: 20 },
  small: { color: colorTokens.text3, fontSize: 12, lineHeight: 16 },
  actions: { flexDirection: "row", gap: space[2], flexWrap: "wrap" },
  grow: { flex: 1 },
  stack: { gap: space[2] },
  footerRow: { flexDirection: "row", gap: space[2] },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colorTokens.canvas },
  embedded: { flex: 1 },
  content: {
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
    paddingHorizontal: PROGRAM_GUTTER,
    paddingTop: space[2],
    paddingBottom: space[9],
    gap: PROGRAM_BLOCK_GAP,
  },
  contentDetailWide: { maxWidth: 1120, paddingHorizontal: space[6], paddingTop: space[4] },
  contentEmbedded: {
    maxWidth: "100%",
    paddingTop: space[2],
  },
  programColumns: { width: "100%", gap: space[6] },
  programColumnsWide: { flexDirection: "row", alignItems: "flex-start" },
  programColumnsWideReversed: { flexDirection: "row-reverse" },
  programColumnsCompact: { flexDirection: "column" },
  primaryWide: {
    flexBasis: 0,
    flexGrow: 5,
    minWidth: 0,
    gap: PROGRAM_BLOCK_GAP,
  },
  supportWide: {
    flexBasis: 0,
    flexGrow: 3,
    minWidth: 0,
    gap: PROGRAM_BLOCK_GAP,
  },
  columnCompact: { width: "100%", minWidth: 0, gap: PROGRAM_BLOCK_GAP },
  inlineFooter: { gap: space[2], marginTop: space[1] },
  done: { minWidth: 40, height: 40, alignItems: "flex-end", justifyContent: "center" },
  doneText: { color: colorTokens.accent, fontSize: 16, fontWeight: "700" },
  footer: {
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
    paddingHorizontal: PROGRAM_GUTTER,
    paddingTop: space[2],
    gap: space[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colorTokens.line,
    backgroundColor: colorTokens.canvas,
  },
  sheetBody: {
    padding: PROGRAM_GUTTER,
    paddingBottom: space[7],
    gap: PROGRAM_BLOCK_GAP,
  },
  sheetTitle: { color: colorTokens.text1, fontSize: 20, fontWeight: "800" },
  loading: { paddingVertical: space[7], alignItems: "center" },
  // #3872 — the app's one section-label type (`typography.labelCap`), so a
  // kit label matches the page labels beside it.
  section: {
    ...type.label,
    color: colorTokens.text3,
    textTransform: "uppercase",
    marginTop: space[2],
    // Blocks are PROGRAM_BLOCK_GAP apart; a label sits PROGRAM_LABEL_GAP above
    // its own card.
    marginBottom: PROGRAM_LABEL_GAP - PROGRAM_BLOCK_GAP,
  },
  sectionWide: { marginTop: 12 },
  muted: { color: colorTokens.text2, fontSize: 14, lineHeight: 20 },
  fieldError: {
    color: colorTokens.errorText,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },
  cardContent: { gap: space[2] },
  pressed: { opacity: 0.85 },
  group: { paddingHorizontal: PROGRAM_CARD_PADDING },
  groupDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colorTokens.lineStrong,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[4],
    paddingVertical: 10,
    minHeight: PROGRAM_ROW_MIN_HEIGHT,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colorTokens.fill.tile,
  },
  rowRoomy: { gap: 12, paddingVertical: 12, minHeight: 64 },
  rowWithAction: { paddingVertical: 0 },
  rowHit: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: space[4],
    paddingVertical: 10,
    minHeight: PROGRAM_ROW_MIN_HEIGHT,
  },
  rowHitRoomy: { gap: 12, paddingVertical: 12, minHeight: 64 },
  rowChevronHit: {
    alignSelf: "stretch",
    justifyContent: "center",
    paddingLeft: 4,
  },
  rowIconRoomy: { width: 40, height: 40, borderRadius: radius.md },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitleLine: { flexDirection: "row", alignItems: "center", gap: space[2] },
  rowTitle: {
    color: colorTokens.text1,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "600",
  },
  rowTitleShrink: { flexShrink: 1 },
  rowTitleHover: {
    textDecorationLine: "underline",
    textDecorationColor: colorTokens.lineStrong,
  },
  focusRing: {
    outlineColor: colorTokens.focus,
    outlineWidth: 2,
    outlineStyle: "solid",
    outlineOffset: 2,
    borderRadius: radius.md,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 36,
    minWidth: 72,
    paddingHorizontal: 16,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colorTokens.lineStrong,
    backgroundColor: colorTokens.fill.tile,
  },
  buttonHitWeb: {
    minHeight: PROGRAM_TAP_TARGET,
    marginVertical: -(PROGRAM_TAP_TARGET - 36) / 2,
    justifyContent: "center",
  },
  buttonHover: { backgroundColor: colorTokens.paper, borderColor: colorTokens.lineStrong },
  buttonPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { fontSize: 14, lineHeight: 20, fontWeight: "700" },
  rowSubtitle: { color: colorTokens.text2, fontSize: 13, lineHeight: 18 },
  // #4420 round 3 item 17: a long value ("Mon Dec 21, 11:59 PM New York
  // time") wraps on the right instead of squeezing the row title to "Vide o …".
  rowRight: {
    color: colorTokens.text1,
    fontSize: 15,
    fontWeight: "700",
    flexShrink: 1,
    maxWidth: "58%",
    textAlign: "right",
  },
  empty: {
    alignItems: "flex-start",
    gap: space[4],
    padding: space[6],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colorTokens.line,
    backgroundColor: colorTokens.fill.inset,
  },
  emptyWide: {
    minHeight: 112,
    flexDirection: "row",
    alignItems: "center",
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colorTokens.fill.tile,
  },
  emptyCopy: { flex: 1, minWidth: 0, gap: 4 },
  emptyAction: { alignSelf: "stretch" },
  emptyActionWide: { alignSelf: "center" },
  emptyTitle: {
    color: colorTokens.text1,
    fontSize: 17,
    fontWeight: "800",
    textAlign: "left",
  },
  emptyBody: {
    color: colorTokens.text2,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "left",
    maxWidth: 520,
  },
  tag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.full,
    maxWidth: 200,
  },
  tagText: { fontSize: 12, fontWeight: "700" },
  chip: {
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colorTokens.lineStrong,
    backgroundColor: colorTokens.fill.inset,
  },
  chipOn: { borderColor: colorTokens.lineStrong, backgroundColor: colorTokens.fill.tabOn },
  chipText: { color: colorTokens.text2, fontWeight: "600", fontSize: 14 },
  chipTextOn: { color: colorTokens.text1 },
  segmented: {
    flexDirection: "row",
    padding: 4,
    borderRadius: radius.full,
    backgroundColor: colorTokens.fill.tile,
    borderWidth: 1,
    borderColor: colorTokens.line,
  },
  segment: {
    flex: 1,
    paddingVertical: 9,
    alignItems: "center",
    borderRadius: radius.full,
  },
  segmentOn: { backgroundColor: colorTokens.fill.tabOn },
  segmentText: { color: colorTokens.text2, fontWeight: "600", fontSize: 14 },
  segmentTextOn: { color: colorTokens.text1 },
  initials: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colorTokens.fill.tile,
  },
  initialsText: { color: colorTokens.textStrong, fontWeight: "800" },
  checkRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[2],
    paddingVertical: 6,
  },
  checkBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colorTokens.fill.pager,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  checkBoxOn: { backgroundColor: colorTokens.paper, borderColor: colorTokens.paper },
  checkLabel: {
    flex: 1,
    color: colorTokens.text1,
    fontSize: 14,
    lineHeight: 20,
  },
  summaryLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: space[4],
    paddingVertical: 4,
  },
  summaryLabel: { color: colorTokens.text2, fontSize: 15, flexShrink: 1 },
  summaryValue: { color: colorTokens.text1, fontSize: 15, fontWeight: "600" },
  summaryStrong: { color: colorTokens.text1, fontWeight: "800", fontSize: 17 },
});

/** Six-segment progress bar with a caption ("Step 3 of 6 · Script"). */
export function StepBar({
  steps,
  current,
  caption,
}: {
  steps: readonly string[];
  current: number;
  caption?: string;
}): React.ReactElement {
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={caption ?? `Step ${current} of ${steps.length}`}
      accessibilityValue={{ min: 1, max: steps.length, now: current }}
      style={stepStyles.wrap}
    >
      <View style={stepStyles.bar}>
        {steps.map((step, index) => (
          <View
            key={step}
            style={[
              stepStyles.segment,
              index + 1 < current && stepStyles.done,
              index + 1 === current && stepStyles.current,
            ]}
          />
        ))}
      </View>
      {caption ? <Text style={stepStyles.caption}>{caption}</Text> : null}
    </View>
  );
}

const stepStyles = StyleSheet.create({
  wrap: { gap: space[1] },
  bar: { flexDirection: "row", gap: 4 },
  segment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: colorTokens.lineStrong,
  },
  done: { backgroundColor: colorTokens.accentLine },
  current: { backgroundColor: colorTokens.accent },
  caption: { color: colorTokens.text2, fontSize: 13, fontWeight: "600" },
});

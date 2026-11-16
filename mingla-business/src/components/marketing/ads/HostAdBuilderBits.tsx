/**
 * #4238 W6a — the Promote builder's small parts, on the #4420 Graphite Glass
 * tokens (designSystem.ts) and kit (Button, Switch, Sheet, Material). Design
 * v9: every group breathes (24 between groups, 16 inside, cards 20/24 in,
 * rows 64 tall), one paper primary per view, orange only on progress marks.
 * No colour literal here (I-HOST-CHROME-TOKENS-ONLY); Android gets the
 * materials' solid fills through Material.
 */
import React, { useMemo, useRef } from "react";
import {
  type LayoutChangeEvent,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Button } from "../../ui/Button";
import { Icon, type IconName } from "../../ui/Icon";
import { Switch } from "../../ui/Switch";
import { color, edge, radius, space, type } from "../../../constants/designSystem";
import { HapticFeedback } from "../../../utils/hapticFeedback";
import { hostAdMarkCrossed, hostAdSnap } from "./hostAdBuilderModel";

const WEB = Platform.OS === "web";

/** Section label: small caps above a group. */
export function BuilderLabel(props: { children: string; testID?: string }): React.ReactElement {
  return (
    <Text style={s.label} accessibilityRole="header" testID={props.testID}>
      {props.children}
    </Text>
  );
}

/** A plain surface card (design: 28 radius phone, 24 web; 20 / 24 padding). */
export function BuilderCard(props: {
  children: React.ReactNode;
  testID?: string;
  accessibilityLabel?: string;
  tone?: "plain" | "inset";
}): React.ReactElement {
  return (
    <View
      style={[s.card, props.tone === "inset" && s.cardInset]}
      testID={props.testID}
      accessibilityLabel={props.accessibilityLabel}
    >
      {props.children}
    </View>
  );
}

/** A grouped list surface; rows inside draw their own dividers. */
export function BuilderList(props: { children: React.ReactNode; testID?: string }): React.ReactElement {
  return (
    <View style={s.list} testID={props.testID}>
      {props.children}
    </View>
  );
}

/** Two (or more) choices in one pill track. */
export function Segmented<T extends string>(props: {
  value: T;
  options: readonly { id: T; label: string }[];
  onChange: (next: T) => void;
  accessibilityLabel: string;
  testID?: string;
}): React.ReactElement {
  return (
    <View style={s.seg} accessibilityRole="radiogroup" accessibilityLabel={props.accessibilityLabel} testID={props.testID}>
      {props.options.map((option) => {
        const on = option.id === props.value;
        return (
          <Pressable
            key={option.id}
            style={({ pressed }) => [s.segItem, on && s.segItemOn, pressed && !on && s.segItemPressed]}
            onPress={() => {
              if (!on) {
                HapticFeedback.selectionEnter();
                props.onChange(option.id);
              }
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={option.label}
            testID={props.testID ? `${props.testID}-${option.id}` : undefined}
          >
            <Text style={[s.segText, on && s.segTextOn]} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The collapsed "Advanced" row (dashed hairline); expands in place. */
export function AdvancedRow(props: {
  open: boolean;
  title: string;
  subtitle: string;
  onToggle: () => void;
  reduceMotion: boolean;
  testID?: string;
}): React.ReactElement {
  return (
    <Pressable
      style={({ pressed }) => [s.adv, props.open && s.advOpen, pressed && s.advPressed]}
      onPress={props.onToggle}
      accessibilityRole="button"
      accessibilityState={{ expanded: props.open }}
      accessibilityLabel={`${props.title}. ${props.subtitle}`}
      testID={props.testID}
    >
      <View style={s.grow}>
        <Text style={s.rowTitle}>{props.title}</Text>
        <Text style={s.rowSub}>{props.subtitle}</Text>
      </View>
      <View style={!props.reduceMotion && props.open ? s.chevOpen : undefined}>
        <Icon name={props.open && props.reduceMotion ? "chevD" : "chevR"} size={16} color={color.text3} />
      </View>
    </Pressable>
  );
}

/** A list row with a switch (role=switch via the kit Switch). */
export function SwitchRow(props: {
  title: string;
  subtitle?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  divider?: boolean;
  testID?: string;
}): React.ReactElement {
  return (
    <View style={[s.row, props.divider && s.rowDivider, props.disabled && s.rowDisabled]}>
      <View style={s.grow}>
        <Text style={s.rowTitle}>{props.title}</Text>
        {props.subtitle ? <Text style={s.rowSub}>{props.subtitle}</Text> : null}
      </View>
      <Switch
        value={props.value}
        onValueChange={props.onChange}
        disabled={props.disabled}
        accessibilityLabel={props.title}
        testID={props.testID}
      />
    </View>
  );
}

/** A read-only or navigating row: small key above, value below. */
export function ValueRow(props: {
  label: string;
  value: string;
  onPress?: () => void;
  trailing?: string;
  divider?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  icon?: IconName;
  badge?: string;
}): React.ReactElement {
  const inner = (
    <>
      {props.icon ? (
        <View style={s.ico}>
          <Icon name={props.icon} size={18} color={color.text2} />
        </View>
      ) : null}
      <View style={s.grow}>
        <Text style={s.rowKey}>{props.label}</Text>
        <Text style={s.rowTitle}>{props.value}</Text>
      </View>
      {props.badge ? <Badge label={props.badge} /> : null}
      {props.trailing ? <Text style={s.rowTrail}>{props.trailing}</Text> : null}
      {props.onPress && !props.trailing ? <Icon name="chevR" size={16} color={color.text3} /> : null}
    </>
  );
  if (!props.onPress) {
    return <View style={[s.row, props.divider && s.rowDivider]} testID={props.testID}>{inner}</View>;
  }
  return (
    <Pressable
      style={({ pressed }) => [s.row, props.divider && s.rowDivider, pressed && s.rowPressed]}
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? `${props.label}: ${props.value}`}
      testID={props.testID}
    >
      {inner}
    </Pressable>
  );
}

/** An icon line inside a card: what Mingla does for the Host. */
export function InfoLine(props: { icon: IconName; title: string; subtitle?: string }): React.ReactElement {
  return (
    <View style={s.infoLine}>
      <View style={s.ico}>
        <Icon name={props.icon} size={18} color={color.text2} />
      </View>
      <View style={s.grow}>
        <Text style={s.rowTitle}>{props.title}</Text>
        {props.subtitle ? <Text style={s.small}>{props.subtitle}</Text> : null}
      </View>
    </View>
  );
}

export function Badge(props: { label: string }): React.ReactElement {
  return (
    <View style={s.badge}>
      <Text style={s.badgeText} numberOfLines={1}>{props.label}</Text>
    </View>
  );
}

/** A status dot + word (never colour alone). */
export function CheckState(props: { state: "checking" | "ready" | "question" | "failed"; label: string }): React.ReactElement {
  const dot =
    props.state === "ready"
      ? color.success
      : props.state === "checking"
        ? color.info
        : props.state === "question"
          ? color.warning
          : color.errorText;
  const text =
    props.state === "ready"
      ? color.successText
      : props.state === "checking"
        ? color.infoText
        : props.state === "question"
          ? color.warningText
          : color.errorText;
  return (
    <View style={s.status} accessibilityLabel={props.label}>
      <View style={[s.statusDot, { backgroundColor: dot }]} />
      <Text style={[s.statusText, { color: text }]}>{props.label}</Text>
    </View>
  );
}

/** A tinted note with an optional action row (warn, info, error, ok). */
export function Note(props: {
  tone: "warn" | "info" | "error" | "ok";
  text: string;
  actions?: React.ReactNode;
  testID?: string;
}): React.ReactElement {
  const tint =
    props.tone === "warn"
      ? color.warningTint
      : props.tone === "info"
        ? color.infoTint
        : props.tone === "error"
          ? color.errorTint
          : color.successTint;
  const iconColor =
    props.tone === "warn"
      ? color.warningText
      : props.tone === "info"
        ? color.infoText
        : props.tone === "error"
          ? color.errorText
          : color.successText;
  return (
    <View
      style={[s.note, { backgroundColor: tint }]}
      accessibilityRole={props.tone === "error" ? "alert" : "text"}
      accessibilityLiveRegion="polite"
      testID={props.testID}
    >
      <View style={s.noteRow}>
        <Icon name={props.tone === "ok" ? "check" : "flag"} size={18} color={iconColor} />
        <Text style={s.noteText}>{props.text}</Text>
      </View>
      {props.actions ? <View style={s.noteActions}>{props.actions}</View> : null}
    </View>
  );
}

/** The one-line reason pinned above a disabled primary action. */
export function Blocker(props: { text: string; onShow?: () => void; showLabel?: string; testID?: string }): React.ReactElement {
  return (
    <View style={s.blocker} accessibilityRole="text" accessibilityLiveRegion="polite" testID={props.testID}>
      <Icon name="flag" size={18} color={color.warningText} />
      <Text style={s.blockerText}>{props.text}</Text>
      {props.onShow && props.showLabel ? (
        <Button label={props.showLabel} variant="ghost" size="sm" onPress={props.onShow} testID={props.testID ? `${props.testID}-show` : undefined} />
      ) : null}
    </View>
  );
}

/** A checkbox row (rights, made with AI). */
export function CheckRow(props: {
  checked: boolean;
  label: string;
  onToggle: () => void;
  testID?: string;
}): React.ReactElement {
  return (
    <Pressable
      style={s.check}
      onPress={props.onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: props.checked }}
      aria-checked={props.checked}
      accessibilityLabel={props.label}
      testID={props.testID}
    >
      <View style={[s.box, props.checked && s.boxOn]}>
        {props.checked ? <Icon name="check" size={14} color={color.ink} /> : null}
      </View>
      <Text style={s.checkText}>{props.label}</Text>
    </Pressable>
  );
}

/** A wrapping row of chips. */
export function ChipRow(props: {
  options: readonly { id: string; label: string }[];
  selected: readonly string[];
  onToggle: (id: string) => void;
  role: "radio" | "checkbox";
  grid?: boolean;
  accessibilityLabel: string;
  testIDPrefix?: string;
}): React.ReactElement {
  return (
    <View
      style={props.grid ? s.chipGrid : s.chips}
      accessibilityRole={props.role === "radio" ? "radiogroup" : undefined}
      accessibilityLabel={props.accessibilityLabel}
    >
      {props.options.map((option) => {
        const on = props.selected.includes(option.id);
        return (
          <Pressable
            key={option.id}
            style={({ pressed }) => [s.chip, props.grid && s.chipCell, on && s.chipOn, pressed && !on && s.chipPressed]}
            onPress={() => props.onToggle(option.id)}
            accessibilityRole={props.role}
            accessibilityState={props.role === "radio" ? { selected: on } : { checked: on }}
            accessibilityLabel={option.label}
            testID={props.testIDPrefix ? `${props.testIDPrefix}-${option.id}` : undefined}
          >
            <Text style={[s.chipText, on && s.chipTextOn]} numberOfLines={1}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * The budget slider: a track with the Minimum and Recommended marks in their
 * own band. Adjustable for screen readers (increment / decrement by one
 * step), arrow keys on web, a light haptic when the thumb crosses a mark.
 * Live outcome text is the caller's (no animation on it).
 */
/**
 * #4238 rework 3 (tester P3-11): a mark near either end of the track hangs
 * its label inward (left-aligned at the start, right-aligned at the end) so
 * "Minimum $5.89" never runs past the slider onto the card's edge.
 */
export function hostAdMarkEdge(percent: number): "start" | "middle" | "end" {
  if (percent < 15) return "start";
  if (percent > 85) return "end";
  return "middle";
}

export function BudgetSlider(props: {
  value: number;
  range: { min: number; max: number; step: number };
  marks: readonly { value: number; label: string; accent?: boolean }[];
  onChange: (next: number) => void;
  label: string;
  valueText: string;
  testID?: string;
}): React.ReactElement {
  const widthRef = useRef(0);
  const startRef = useRef(props.value);
  const valueRef = useRef(props.value);
  valueRef.current = props.value;
  const { min, max } = props.range;
  const span = Math.max(1, max - min);
  const pct = (value: number): number => ((Math.min(max, Math.max(min, value)) - min) / span) * 100;
  const markValues = useMemo(() => props.marks.map((mark) => mark.value), [props.marks]);
  const commit = (next: number): void => {
    const snapped = hostAdSnap(next, props.range);
    if (snapped === valueRef.current) return;
    if (hostAdMarkCrossed(valueRef.current, snapped, markValues) !== null) HapticFeedback.selectionEnter();
    props.onChange(snapped);
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          const x = event.nativeEvent.locationX;
          const width = widthRef.current || 1;
          const next = min + (x / width) * span;
          startRef.current = next;
          commitRef.current(next);
        },
        onPanResponderMove: (_event, gesture) => {
          const width = widthRef.current || 1;
          commitRef.current(startRef.current + (gesture.dx / width) * span);
        },
        onPanResponderTerminationRequest: () => false,
      }),
    [min, span],
  );
  const close = markValues.length === 2 && Math.abs(pct(markValues[0]) - pct(markValues[1])) < 22;
  const webKeys = WEB
    ? {
        onKeyDown: (event: { nativeEvent: { key: string }; preventDefault?: () => void }) => {
          const key = event.nativeEvent.key;
          if (key === "ArrowRight" || key === "ArrowUp") {
            event.preventDefault?.();
            commitRef.current(valueRef.current + props.range.step);
          } else if (key === "ArrowLeft" || key === "ArrowDown") {
            event.preventDefault?.();
            commitRef.current(valueRef.current - props.range.step);
          }
        },
        tabIndex: 0,
      }
    : {};
  return (
    <View style={s.sliderWrap}>
      <Text style={s.label}>{props.label}</Text>
      <View
        style={s.sliderHit}
        onLayout={(event: LayoutChangeEvent) => {
          widthRef.current = event.nativeEvent.layout.width;
        }}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={props.label}
        accessibilityValue={{ min, max, now: props.value, text: props.valueText }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "increment") commit(props.value + props.range.step);
          if (event.nativeEvent.actionName === "decrement") commit(props.value - props.range.step);
        }}
        testID={props.testID}
        {...(webKeys as object)}
        {...responder.panHandlers}
      >
        <View style={s.track} pointerEvents="none">
          <View style={[s.trackFill, { width: `${pct(props.value)}%` }]} />
        </View>
        <View style={[s.thumb, { left: `${pct(props.value)}%` }]} pointerEvents="none" />
      </View>
      <View style={[s.marks, close && s.marksTall]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {props.marks.map((mark, index) => (
          <View
            key={mark.label}
            style={[
              s.mark,
              { left: `${pct(mark.value)}%` },
              hostAdMarkEdge(pct(mark.value)) === "start" && s.markStart,
              hostAdMarkEdge(pct(mark.value)) === "end" && s.markEnd,
              close && index === 1 && s.markLow,
            ]}
            pointerEvents="none"
            testID={`${props.testID ?? "budget-slider"}-mark-${index}`}
          >
            <View style={[s.markTick, mark.accent && s.markTickAccent]} />
            <Text
              style={[
                s.markText,
                hostAdMarkEdge(pct(mark.value)) === "start" && s.markTextStart,
                hostAdMarkEdge(pct(mark.value)) === "end" && s.markTextEnd,
              ]}
            >
              {mark.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** A tile in the 1–5 creative picker. */
export function CreativeTile(props: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  poster: React.ReactNode;
  onPress: () => void;
  testID?: string;
}): React.ReactElement {
  return (
    <Pressable
      style={[s.tile, props.disabled && s.rowDisabled]}
      onPress={props.onPress}
      disabled={props.disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: props.selected, disabled: props.disabled }}
      aria-checked={props.selected}
      accessibilityLabel={props.label}
      testID={props.testID}
    >
      <View style={[s.tilePoster, props.selected && s.tilePosterOn]}>
        {props.poster}
        <View style={[s.tileTick, props.selected && s.tileTickOn]}>
          {props.selected ? <Icon name="check" size={14} color={color.ink} /> : null}
        </View>
      </View>
      <Text style={s.tileLabel} numberOfLines={1}>{props.label}</Text>
    </Pressable>
  );
}

export function AddTile(props: { label: string; onPress: () => void; loading?: boolean; testID?: string }): React.ReactElement {
  return (
    <Pressable
      style={s.tile}
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      testID={props.testID}
    >
      <View style={[s.tilePoster, s.tileAdd]}>
        <Icon name={props.loading ? "clock" : "plus"} size={22} color={color.text2} />
      </View>
      <Text style={s.tileLabel}>{props.label}</Text>
    </Pressable>
  );
}

export const builderStyles = StyleSheet.create({
  stack: { gap: space[4] },
  stackLg: { gap: space[6] },
  h1: { ...type.h1, color: color.text1 },
  body: { ...type.body, color: color.text1 },
  small: { ...type.small, color: color.text2 },
  caption: { ...type.caption, color: color.text2 },
  statXl: { ...type.statXl, color: color.text1 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[4] },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space[3] },
  est: { gap: space[1], paddingVertical: space[3] + 2, paddingHorizontal: space[4], borderRadius: radius.md, backgroundColor: color.fill.input },
  kv: { gap: space[3] },
  kvRow: { flexDirection: "row", justifyContent: "space-between", gap: space[4] },
  kvKey: { ...type.small, color: color.text2, flex: 1 },
  kvVal: { ...type.small, color: color.text1, fontWeight: "600", textAlign: "right" },
  kvTotal: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line, paddingTop: space[3] },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: space[3] },
});

const s = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  label: { ...type.label, color: color.text3, textTransform: "uppercase" },
  small: { ...type.small, color: color.text2, marginTop: 2 },
  card: {
    backgroundColor: color.card,
    borderRadius: WEB ? radius.xl : radius.xxl,
    padding: WEB ? space[6] : space[5],
    gap: space[4],
    ...edge.edge,
    ...edge.rim,
  },
  cardInset: { backgroundColor: color.fill.input },
  list: {
    backgroundColor: color.card,
    borderRadius: WEB ? radius.xl : radius.xxl,
    overflow: "hidden",
    ...edge.edge,
    ...edge.rim,
  },
  seg: {
    flexDirection: "row",
    backgroundColor: color.fill.input,
    borderRadius: radius.full,
    padding: space[1],
    gap: space[1],
    ...edge.seg,
  },
  segItem: {
    flex: 1,
    minHeight: WEB ? 40 : 44,
    paddingHorizontal: space[4],
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  segItemOn: { backgroundColor: color.card3, ...edge.rimSelected },
  segItemPressed: { backgroundColor: color.fill.pressed },
  segText: { ...type.chip, color: color.text2 },
  segTextOn: { color: color.text1 },
  adv: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[4],
    paddingVertical: space[4] + 2,
    paddingHorizontal: space[5],
    borderRadius: radius.xl,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: color.lineStrong,
  },
  advOpen: { borderStyle: "solid", backgroundColor: color.fill.tableHead },
  advPressed: { backgroundColor: color.fill.rowHover },
  chevOpen: { transform: [{ rotate: "90deg" }] },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[4],
    minHeight: WEB ? 60 : 64,
    paddingVertical: WEB ? space[3] + 2 : space[4],
    paddingHorizontal: space[5],
  },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  rowDisabled: { opacity: 0.5 },
  rowPressed: { backgroundColor: color.fill.rowHover },
  rowTitle: { ...type.row, color: color.text1 },
  rowSub: { ...type.caption, color: color.text2, marginTop: 2 },
  rowKey: { ...type.caption, color: color.text2, marginBottom: 2 },
  rowTrail: { ...type.caption, color: color.text2 },
  ico: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.fill.tile,
  },
  infoLine: { flexDirection: "row", alignItems: "flex-start", gap: space[3] + 2 },
  badge: {
    minHeight: 26,
    paddingHorizontal: space[3],
    borderRadius: radius.full,
    backgroundColor: color.fill.tile,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { ...type.caption, color: color.text2 },
  status: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    minHeight: 28,
    paddingHorizontal: space[3],
    borderRadius: radius.full,
    backgroundColor: color.fill.status,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { ...type.caption },
  note: { borderRadius: radius.lg, padding: space[4], gap: space[3] },
  noteRow: { flexDirection: "row", alignItems: "flex-start", gap: space[3] },
  noteText: { ...type.small, color: color.text1, flex: 1 },
  noteActions: { flexDirection: "row", flexWrap: "wrap", gap: space[3], paddingLeft: space[6] + 6 },
  blocker: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2] + 2,
    paddingVertical: space[2] + 2,
    paddingLeft: space[3] + 2,
    paddingRight: space[3],
    borderRadius: radius.md,
    backgroundColor: color.warningTint,
  },
  blockerText: { ...type.small, color: color.text1, flex: 1 },
  check: { flexDirection: "row", alignItems: "flex-start", gap: space[3] + 2, paddingVertical: space[1], minHeight: 44 },
  box: {
    width: 24,
    height: 24,
    borderRadius: radius.xs,
    borderWidth: 1.5,
    borderColor: color.text4,
    alignItems: "center",
    justifyContent: "center",
  },
  boxOn: { backgroundColor: color.paper, borderColor: color.paper },
  checkText: { ...type.small, color: color.text1, flex: 1, paddingTop: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space[3] },
  chipGrid: { flexDirection: "row", flexWrap: "wrap", gap: space[3] },
  chip: {
    minHeight: 44,
    paddingHorizontal: space[5],
    borderRadius: radius.full,
    backgroundColor: color.fill.tile,
    alignItems: "center",
    justifyContent: "center",
    ...edge.seg,
  },
  chipCell: { flexBasis: "46%", flexGrow: 1 },
  chipOn: { backgroundColor: color.paper },
  chipPressed: { backgroundColor: color.fill.pressed },
  chipText: { ...type.chip, color: color.text1 },
  chipTextOn: { color: color.ink },
  sliderWrap: { gap: space[2] },
  sliderHit: { height: 44, justifyContent: "center" },
  track: { height: 6, borderRadius: 3, backgroundColor: color.fill.step, overflow: "hidden" },
  trackFill: { height: 6, backgroundColor: color.paper },
  thumb: {
    position: "absolute",
    width: 28,
    height: 28,
    marginLeft: -14,
    borderRadius: 14,
    backgroundColor: color.paper,
    ...edge.lineOnPaper,
  },
  marks: { position: "relative", height: 52, marginTop: space[1] },
  marksTall: { height: 84 },
  mark: { position: "absolute", top: 0, alignItems: "center", width: 120, marginLeft: -60 },
  markLow: { top: 34 },
  markStart: { marginLeft: -1, alignItems: "flex-start" },
  markEnd: { marginLeft: -119, alignItems: "flex-end" },
  markTextStart: { textAlign: "left" },
  markTextEnd: { textAlign: "right" },
  markTick: { width: 2, height: 8, backgroundColor: color.text3, marginBottom: 3 },
  markTickAccent: { backgroundColor: color.accent },
  markText: { ...type.caption, color: color.text2, textAlign: "center" },
  tile: { width: WEB ? "18%" : "30%", flexGrow: 0, gap: space[2] },
  tilePoster: {
    width: "100%",
    aspectRatio: 9 / 12,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: color.card3,
  },
  tilePosterOn: { borderWidth: 2, borderColor: color.paper },
  tileTick: {
    position: "absolute",
    top: space[2],
    right: space[2],
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.mask,
    borderWidth: 1,
    borderColor: color.textOnPhoto2,
  },
  tileTickOn: { backgroundColor: color.paper, borderColor: color.paper },
  tileAdd: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.transparent,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: color.lineStrong,
  },
  tileLabel: { ...type.caption, color: color.text2 },
});

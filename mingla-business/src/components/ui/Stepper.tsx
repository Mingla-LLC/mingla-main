/**
 * Stepper — wizard progress (#4420 Graphite Glass, spec §3.5 / B7).
 *
 * Existing callers (`<Stepper steps currentIndex />`) keep their exact look
 * contract: web = numbered circles joined by connectors, phone = dots plus a
 * "Step N of M" caption. Everything below is additive.
 *
 * Clickable stepper (pass `onStepPress`):
 *   - Each step resolves to a state: done | current | error | todo | locked
 *     (`resolveStepState`; an explicit `step.state` wins).
 *   - A step is reachable when it is not locked and
 *     `index <= furthestValidIndex` (the wizard passes its own per-step
 *     validator result; no new rule here). Locked and unreachable steps are
 *     not pressable (`isStepReachable`).
 *   - `layout="list"` (desktop T4): the 280 step list. done = paper check,
 *     current = orange number, error = red ring + the first error, locked =
 *     lock glyph + the reason.
 *   - phone (`layout="chips"`, the default when `onStepPress` is set off web):
 *     progress segments, tappable step chips, and an "n / N" button that opens
 *     the Steps sheet. No swipe between steps (it fights chip rows, date
 *     pickers and the iOS back-swipe).
 *   - `StepperFooter`: the sticky Back (named after the previous step) /
 *     Continue bar, with a hairline top and the bottom safe area.
 *
 * Orange is allowed here: steppers and progress are one of the four places.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import {
  color,
  materials,
  radius,
  size,
  space,
  type,
} from "../../constants/designSystem";

import { useTouchFloor } from "../../hooks/useTouchFloor";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";

export type StepperStepState = "done" | "current" | "error" | "todo" | "locked";

export interface StepperStep {
  id: string;
  label: string;
  /**
   * ORCH-1263 (DESIGN §5.2) — the step's content ARRIVED filled (claim
   * adoption). Future prefilled dots render green-45; a visited prefilled dot
   * becomes standard white.
   */
  prefilled?: boolean;
  /** #4420: explicit state. Omitted → derived from `currentIndex`. */
  state?: StepperStepState;
  /** #4420: why a locked step is locked (shown in the list and the sheet). */
  lockedReason?: string;
  /** #4420: the first validation error on an `error` step. */
  firstError?: string;
  /**
   * #4420: one line under the label in the desktop step list (and the phone
   * Steps sheet), e.g. what the step asks for. An error or a lock reason
   * takes its place while one applies.
   */
  description?: string;
  /**
   * #4420: the host already got past this step (e.g. a saved step that is now
   * locked). Its progress segment fills even when its state is `locked`.
   * Omitted → a locked step before the current one counts as passed.
   */
  passed?: boolean;
}

export type StepperLayout = "inline" | "list" | "chips";

export interface StepperProps {
  steps: StepperStep[];
  /** 0-based index of the current step. */
  currentIndex: number;
  /** Show "Step N of M" caption on mobile. Default `true`. */
  showCaption?: boolean;
  /** #4420: makes steps pressable (reachable ones only). */
  onStepPress?: (index: number) => void;
  /** #4420: the furthest step the wizard's validators allow. Default `currentIndex`. */
  furthestValidIndex?: number;
  /** #4420: `list` = desktop 280 step list; `chips` = phone chips + Steps sheet. */
  layout?: StepperLayout;
  /** #4420: Steps sheet title. */
  sheetTitle?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** The state a step draws in. An explicit `step.state` wins. */
export const resolveStepState = (step: StepperStep, index: number, currentIndex: number): StepperStepState => {
  if (step.state !== undefined) return step.state;
  if (index === currentIndex) return "current";
  return index < currentIndex ? "done" : "todo";
};

/**
 * Whether a step's progress segment fills: done and current always; a step
 * the host has passed (`passed`, or a locked step before the current one)
 * too. Error steps draw their own red segment.
 */
export const isStepSegmentFilled = (step: StepperStep, index: number, currentIndex: number): boolean => {
  const state = resolveStepState(step, index, currentIndex);
  if (state === "error") return false;
  if (state === "done" || state === "current") return true;
  if (step.passed === true) return true;
  return state === "locked" && index < currentIndex;
};

/**
 * The scroll offset that centres a chip in the chip row, clamped at the start.
 * The ScrollView clamps the far end itself.
 */
export const chipScrollOffset = (chipX: number, chipWidth: number, viewportWidth: number): number =>
  Math.max(0, chipX + chipWidth / 2 - viewportWidth / 2);

/** Whether pressing step `index` may navigate there. */
export const isStepReachable = (
  step: StepperStep,
  index: number,
  currentIndex: number,
  furthestValidIndex: number = currentIndex,
): boolean => {
  if (resolveStepState(step, index, currentIndex) === "locked") return false;
  return index <= Math.max(furthestValidIndex, currentIndex);
};

const DOT_SIZE = 8;
const CIRCLE_SIZE = 24;
const LIST_MARK = 28;
const CONNECTOR_FILL_DURATION = 280;
const FUTURE_DOT_BG = color.fill.pager;
const PREFILLED_DOT_BG = color.successText;
const PREFILLED_CIRCLE_BORDER = color.successText;
const DOT_CONFIRM_DURATION = 120;

const StepDot: React.FC<{ color: string }> = ({ color: dotColor }) => {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(1);
  const prevColor = React.useRef(dotColor);

  useEffect(() => {
    if (prevColor.current !== dotColor) {
      prevColor.current = dotColor;
      if (!reduceMotion) {
        progress.value = 0;
        progress.value = withTiming(1, { duration: DOT_CONFIRM_DURATION });
      } else {
        progress.value = 1;
      }
    }
    return (): void => {
      cancelAnimation(progress);
    };
  }, [dotColor, progress, reduceMotion]);

  const style = useAnimatedStyle(() => ({
    backgroundColor: dotColor,
    opacity: 0.4 + 0.6 * progress.value,
  }));

  return <Animated.View style={[styles.dot, style]} />;
};

const Connector: React.FC<{ filled: boolean }> = ({ filled }) => {
  const fill = useSharedValue(filled ? 1 : 0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const target = filled ? 1 : 0;
    fill.value = reduceMotion
      ? target
      : withTiming(target, { duration: CONNECTOR_FILL_DURATION, easing: Easing.out(Easing.cubic) });
    return (): void => {
      cancelAnimation(fill);
    };
  }, [fill, filled, reduceMotion]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));

  return (
    <View style={styles.connector}>
      <Animated.View style={[styles.connectorFill, fillStyle]} />
    </View>
  );
};

const StepperMobile: React.FC<StepperProps> = ({ steps, currentIndex, showCaption = true, testID, style }) => {
  const prefilledCount = steps.filter((s) => s.prefilled === true).length;
  return (
    <View testID={testID} style={[styles.mobileWrap, style]}>
      <View style={styles.dotRow}>
        {steps.map((step, index) => {
          const dotColor =
            index === currentIndex
              ? color.accent
              : index < currentIndex
                ? color.textStrong
                : step.prefilled === true
                  ? PREFILLED_DOT_BG
                  : FUTURE_DOT_BG;
          return <StepDot key={step.id} color={dotColor} />;
        })}
      </View>
      {showCaption ? (
        <Text style={styles.caption}>
          Step {Math.min(currentIndex + 1, steps.length)} of {steps.length}
          {prefilledCount >= 6 ? " · most are quick confirms" : ""}
        </Text>
      ) : null}
    </View>
  );
};

const StepperWeb: React.FC<StepperProps> = ({ steps, currentIndex, testID, style }) => (
  <View testID={testID} style={[styles.webWrap, style]}>
    {steps.map((step, index) => {
      const isCurrent = index === currentIndex;
      const isCompleted = index < currentIndex;
      const isFuture = index > currentIndex;
      const isPrefilledFuture = isFuture && step.prefilled === true;

      const circleBg = isCurrent ? color.accent : isCompleted ? color.paper : isPrefilledFuture ? color.successTint : color.fill.inset;
      const circleBorder = isCurrent || isCompleted ? color.transparent : isPrefilledFuture ? PREFILLED_CIRCLE_BORDER : color.line;
      const numberColor = isCurrent || isCompleted ? color.ink : isPrefilledFuture ? color.text2 : color.text3;
      const labelColor = isFuture ? color.text3 : color.text1;

      return (
        <React.Fragment key={step.id}>
          <View style={styles.stepCol}>
            <View style={[styles.circle, { backgroundColor: circleBg, borderColor: circleBorder }]}>
              <Text style={[styles.circleNumber, { color: numberColor }]}>{index + 1}</Text>
            </View>
            <Text style={[styles.stepLabel, { color: labelColor }]} numberOfLines={1}>
              {step.label}
            </Text>
          </View>
          {index < steps.length - 1 ? <Connector filled={index < currentIndex} /> : null}
        </React.Fragment>
      );
    })}
  </View>
);

/** The mark for one step in the list / sheet. */
const StepMark: React.FC<{ state: StepperStepState; index: number }> = ({ state, index }) => {
  if (state === "done") {
    return (
      <View style={[styles.mark, styles.markDone]}>
        <Icon name="check" size={14} color={color.ink} />
      </View>
    );
  }
  if (state === "locked") {
    return (
      <View style={[styles.mark, styles.markLocked]}>
        <Icon name="shield" size={13} color={color.text3} />
      </View>
    );
  }
  return (
    <View
      style={[
        styles.mark,
        state === "current" ? styles.markCurrent : state === "error" ? styles.markError : styles.markTodo,
      ]}
    >
      <Text
        style={[
          styles.markNumber,
          { color: state === "current" ? color.onAccent : state === "error" ? color.errorText : color.text2 },
        ]}
      >
        {index + 1}
      </Text>
    </View>
  );
};

interface StepListProps extends StepperProps {
  onPicked?: () => void;
}

/** Desktop 280 step list (also the body of the phone Steps sheet). */
const StepList: React.FC<StepListProps> = ({ steps, currentIndex, onStepPress, furthestValidIndex, testID, style, onPicked }) => (
  <View style={[styles.list, style]} testID={testID} accessibilityRole="list">
    {steps.map((step, index) => {
      const state = resolveStepState(step, index, currentIndex);
      const reachable = onStepPress !== undefined && isStepReachable(step, index, currentIndex, furthestValidIndex);
      const sub = state === "error" ? step.firstError : state === "locked" ? step.lockedReason : step.description;
      return (
        <Pressable
          key={step.id}
          onPress={
            reachable
              ? () => {
                  onStepPress?.(index);
                  onPicked?.();
                }
              : undefined
          }
          disabled={!reachable}
          accessibilityRole="button"
          accessibilityState={{ disabled: !reachable, selected: state === "current" }}
          accessibilityLabel={sub !== undefined ? `${index + 1}. ${step.label}. ${sub}` : `${index + 1}. ${step.label}`}
          testID={testID !== undefined ? `${testID}-step-${index}` : undefined}
          style={({ pressed }) => [
            styles.listRow,
            state === "current" ? styles.listRowCurrent : null,
            pressed && reachable ? styles.listRowPressed : null,
          ]}
        >
          <StepMark state={state} index={index} />
          <View style={styles.listText}>
            <Text
              style={[styles.listLabel, state === "todo" || state === "locked" ? styles.listLabelMuted : null]}
              numberOfLines={2}
            >
              {step.label}
            </Text>
            {sub !== undefined && sub.length > 0 ? (
              <Text style={[styles.listSub, state === "error" ? styles.listSubError : null]} numberOfLines={2}>
                {sub}
              </Text>
            ) : null}
          </View>
        </Pressable>
      );
    })}
  </View>
);

/** Phone: progress segments, tappable chips and the "n / N" Steps sheet. */
const StepChips: React.FC<StepperProps> = (props) => {
  const touchFloor = useTouchFloor();
  const { steps, currentIndex, onStepPress, furthestValidIndex, sheetTitle = "Steps", testID, style } = props;
  const [sheetOpen, setSheetOpen] = useState(false);
  // #4420: keep the current step's chip in view, on mount and on every step change.
  const scrollRef = useRef<ScrollView | null>(null);
  const chipFrames = useRef<Record<number, { x: number; width: number }>>({});
  const [viewportWidth, setViewportWidth] = useState(0);
  const [measured, setMeasured] = useState(0);
  const scrollToCurrent = useCallback((): void => {
    const frame = chipFrames.current[currentIndex];
    if (frame === undefined || viewportWidth <= 0) return;
    scrollRef.current?.scrollTo?.({ x: chipScrollOffset(frame.x, frame.width, viewportWidth), animated: true });
  }, [currentIndex, viewportWidth]);
  useEffect(() => {
    scrollToCurrent();
  }, [scrollToCurrent, measured]);
  return (
    <View style={[styles.chipsWrap, style]} testID={testID}>
      <View style={styles.segments}>
        {steps.map((step, index) => {
          const state = resolveStepState(step, index, currentIndex);
          return (
            <View
              key={step.id}
              style={[
                styles.segment,
                isStepSegmentFilled(step, index, currentIndex) ? styles.segmentOn : null,
                state === "error" ? styles.segmentError : null,
              ]}
            />
          );
        })}
      </View>
      <View style={styles.chipsRow}>
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsScroll}
          style={styles.chipsScroller}
          onLayout={(event) => setViewportWidth(event.nativeEvent.layout.width)}
          testID={testID !== undefined ? `${testID}-chips` : undefined}
        >
          {steps.map((step, index) => {
            const state = resolveStepState(step, index, currentIndex);
            const reachable = onStepPress !== undefined && isStepReachable(step, index, currentIndex, furthestValidIndex);
            return (
              <Pressable
                key={step.id}
                onPress={reachable ? () => onStepPress?.(index) : undefined}
                disabled={!reachable}
                accessibilityRole="button"
                accessibilityState={{ disabled: !reachable, selected: state === "current" }}
                accessibilityLabel={`${index + 1}. ${step.label}`}
                testID={testID !== undefined ? `${testID}-chip-${index}` : undefined}
                onLayout={(event) => {
                  const { x, width } = event.nativeEvent.layout;
                  chipFrames.current[index] = { x, width };
                  if (index === currentIndex) setMeasured((n) => n + 1);
                }}
                style={[
                  styles.chip,
                  touchFloor > 0 ? { minHeight: touchFloor } : null,
                  state === "current" ? styles.chipOn : null,
                  state === "error" ? styles.chipError : null,
                  !reachable ? styles.chipLocked : null,
                ]}
              >
                <Text style={[styles.chipLabel, state === "current" ? styles.chipLabelOn : null]} numberOfLines={1}>
                  {step.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Pressable
          onPress={() => setSheetOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`${sheetTitle}, ${Math.min(currentIndex + 1, steps.length)} of ${steps.length}`}
          testID={testID !== undefined ? `${testID}-count` : undefined}
          style={[styles.countButton, touchFloor > 0 ? { minHeight: touchFloor } : null]}
        >
          <Text style={styles.countLabel}>
            {Math.min(currentIndex + 1, steps.length)} / {steps.length}
          </Text>
        </Pressable>
      </View>
      <Sheet visible={sheetOpen} onClose={() => setSheetOpen(false)} snapPoint="half">
        <Text style={styles.sheetTitle}>{sheetTitle}</Text>
        <ScrollView showsVerticalScrollIndicator={false}>
          <StepList {...props} testID={testID !== undefined ? `${testID}-sheet` : undefined} style={null} onPicked={() => setSheetOpen(false)} />
        </ScrollView>
      </Sheet>
    </View>
  );
};

export const Stepper: React.FC<StepperProps> = (props) => {
  const layout = props.layout ?? (props.onStepPress !== undefined && Platform.OS !== "web" ? "chips" : "inline");
  if (layout === "list") return <StepList {...props} />;
  if (layout === "chips") return <StepChips {...props} />;
  if (Platform.OS === "web") return <StepperWeb {...props} />;
  return <StepperMobile {...props} />;
};

export interface StepperFooterProps {
  /** The previous step's label; omit on the first step (no Back). */
  previousLabel?: string;
  onBack?: () => void;
  /**
   * #4420: Back stays visible but cannot be pressed (e.g. #1780: while Publish
   * re-reads the invite plan, or while a step is still saving).
   */
  backDisabled?: boolean;
  continueLabel: string;
  onContinue: () => void;
  continueDisabled?: boolean;
  continueLoading?: boolean;
  /** #4420: testID for the primary button. Default `${testID}-continue`. */
  continueTestID?: string;
  /**
   * #4420: the desktop (T4 wizard) bar: Back at the start and the primary
   * action at the end at their natural widths, on the card surface, with the
   * desktop gutter. Default false (phone: two full-width cells).
   */
  wide?: boolean;
  /** Add the bottom safe area (phone, pinned to the screen bottom). Default true off web and off `wide`. */
  safeArea?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * #4420 — the sticky wizard footer: Back (named after the previous step) and
 * Continue. Hairline top, 12 above the buttons, the bottom safe area below.
 * Buttons wrap into a stack rather than squeeze on a narrow phone.
 */
export const StepperFooter: React.FC<StepperFooterProps> = ({
  previousLabel,
  onBack,
  backDisabled = false,
  continueLabel,
  onContinue,
  continueDisabled = false,
  continueLoading = false,
  continueTestID,
  wide = false,
  safeArea = Platform.OS !== "web" && !wide,
  testID,
  style,
}) => {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.footer,
        wide ? styles.footerWide : null,
        { paddingBottom: space[3] + (safeArea ? insets.bottom : 0) },
        style,
      ]}
      testID={testID}
    >
      {previousLabel !== undefined && onBack !== undefined ? (
        <View style={wide ? null : styles.footerBack}>
          <Button
            label={previousLabel}
            leadingIcon="chevL"
            onPress={onBack}
            variant="secondary"
            size="lg"
            disabled={backDisabled}
            fullWidth={!wide}
            testID={testID !== undefined ? `${testID}-back` : undefined}
          />
        </View>
      ) : null}
      <View style={wide ? styles.footerContinueWide : styles.footerContinue}>
        <Button
          label={continueLabel}
          onPress={onContinue}
          variant="primary"
          size="lg"
          disabled={continueDisabled}
          loading={continueLoading}
          fullWidth={!wide}
          testID={continueTestID ?? (testID !== undefined ? `${testID}-continue` : undefined)}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  mobileWrap: { alignItems: "center", gap: space[2] },
  dotRow: { flexDirection: "row", gap: space[2] },
  dot: { width: DOT_SIZE, height: DOT_SIZE, borderRadius: DOT_SIZE / 2 },
  caption: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    fontWeight: type.caption.fontWeight,
    letterSpacing: type.caption.letterSpacing,
    color: color.text3,
  },
  webWrap: { flexDirection: "row", alignItems: "flex-start", gap: space[1] },
  stepCol: { alignItems: "center", gap: space[1] },
  circle: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  circleNumber: { fontSize: type.small.fontSize, lineHeight: type.small.lineHeight, fontWeight: "600" },
  stepLabel: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    fontWeight: type.caption.fontWeight,
    letterSpacing: type.caption.letterSpacing,
    maxWidth: 120,
    textAlign: "center",
  },
  connector: {
    flex: 1,
    height: 2,
    minWidth: 24,
    backgroundColor: color.line,
    borderRadius: 1,
    overflow: "hidden",
    marginTop: CIRCLE_SIZE / 2 - 1,
  },
  connectorFill: { height: 2, backgroundColor: color.accent },

  // list (desktop T4, and the Steps sheet)
  list: { width: "100%", maxWidth: size.stepList, gap: space[1] },
  listRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[3],
    paddingVertical: space[2] + 2,
    paddingHorizontal: space[3],
    borderRadius: radius.sm,
    minHeight: 48,
  },
  listRowCurrent: { backgroundColor: color.fill.railOn },
  listRowPressed: { backgroundColor: color.fill.rowHover },
  listText: { flex: 1, minWidth: 0, gap: 2, paddingTop: 4 },
  listLabel: { ...type.small, fontWeight: "600", color: color.text1 },
  listLabelMuted: { color: color.text3 },
  listSub: { ...type.caption, color: color.text3 },
  listSubError: { color: color.errorText },
  mark: {
    width: LIST_MARK,
    height: LIST_MARK,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  markDone: { backgroundColor: color.paper },
  markCurrent: { backgroundColor: color.accent },
  markError: { borderWidth: 1.5, borderColor: color.errorText },
  markTodo: { backgroundColor: color.fill.step },
  markLocked: { backgroundColor: color.fill.inset },
  markNumber: { ...type.caption, fontWeight: "700" },

  // phone chips
  chipsWrap: { gap: space[3] },
  segments: { flexDirection: "row", gap: space[1] },
  segment: { flex: 1, height: 3, borderRadius: radius.full, backgroundColor: color.fill.step },
  segmentOn: { backgroundColor: color.accent },
  segmentError: { backgroundColor: color.danger },
  chipsRow: { flexDirection: "row", alignItems: "center", gap: space[2] },
  chipsScroller: { flex: 1 },
  chipsScroll: { gap: space[2], paddingRight: space[8] },
  chip: {
    minHeight: 36,
    paddingHorizontal: space[3],
    borderRadius: radius.full,
    justifyContent: "center",
    backgroundColor: color.fill.tile,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
  },
  chipOn: {
    backgroundColor: materials.selected.solidFill,
    borderColor: materials.selected.rim.edge,
    borderTopColor: materials.selected.rim.top ?? materials.selected.rim.edge,
  },
  chipError: { borderColor: color.errorLine },
  chipLocked: { opacity: 0.45 },
  chipLabel: { ...type.chip, color: color.text2 },
  chipLabelOn: { color: color.textStrong },
  countButton: {
    minHeight: 36,
    minWidth: 56,
    paddingHorizontal: space[3],
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: materials.control.solidFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: materials.control.rim.edge,
    flexShrink: 0,
  },
  countLabel: { ...type.btnSm, color: color.text1 },
  sheetTitle: { ...type.h1, color: color.text1, paddingBottom: space[3] },

  // footer
  footer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
    paddingTop: space[3],
    paddingHorizontal: space[4],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
    backgroundColor: color.canvas,
  },
  footerWide: {
    flexWrap: "nowrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[3],
    paddingHorizontal: space[6],
    backgroundColor: color.card,
  },
  footerBack: { flexGrow: 1, flexBasis: 120 },
  footerContinue: { flexGrow: 2, flexBasis: 160 },
  footerContinueWide: { marginLeft: "auto" },
});

export default Stepper;

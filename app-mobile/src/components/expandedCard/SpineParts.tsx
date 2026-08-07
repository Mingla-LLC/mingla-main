/**
 * The expanded sheet's body furniture. Issue #1605 wave 4.
 *
 * Five small components, and between them they are the whole visual grammar of
 * the body: a heading, a rule, a fact row, a skeleton and a per-section error.
 * There is deliberately nothing else — no card, no tinted box, no icon badge, no
 * chip row. A group is a HEADING AND A RULE, which costs one line and no colour.
 *
 * Constitution 9 runs through every one of them: a `FactRow` with no value does
 * not render, a `Section` with no children does not render, and NEITHER renders
 * a placeholder, an em-dash or a "Not available". The rule above a section goes
 * with the section — a rule with nothing under it is a rule to nowhere.
 */
import React from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Icon } from '../ui/Icon';
import { SPINE } from './spineTokens';

/** Non-empty after trimming. The one vacuity predicate the body uses. */
export function present(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * A section: a full-bleed rule, a heading, then rows.
 *
 * IT RETURNS NULL WHEN IT HAS NOTHING TO SAY, and that is the point of routing
 * every body group through it. `hidden` lets a caller state the data gate once,
 * at the call site, instead of each section growing its own early return that
 * forgets to take the rule with it.
 */
export function Section({
  title,
  hidden,
  trailing,
  children,
  style,
}: {
  title: string;
  hidden?: boolean;
  /** e.g. the `Customized` chip on the Plan section's heading row. */
  trailing?: React.ReactNode;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement | null {
  if (hidden) return null;
  return (
    <View style={[styles.section, style]}>
      <View style={styles.rule} />
      <View style={styles.headingRow}>
        <Text style={styles.heading} accessibilityRole="header">
          {title.toUpperCase()}
        </Text>
        {trailing}
      </View>
      {children}
    </View>
  );
}

/** A small neutral chip. 12/600 #6B7280 on #F3F4F6 — no accent, no border. */
export function Chip({ label }: { label: string }): React.ReactElement {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );
}

/**
 * One fact: a label and a value, 44pt minimum, hairline-separated.
 *
 * A row with no value DOES NOT RENDER. There is no greyed-out row, no em-dash
 * and no "Not available" — a place with no phone simply has no phone row, and a
 * place with no address and no hours has no Details section at all.
 */
export function FactRow({
  label,
  value,
  tail,
  onPress,
  trailingIcon,
  accessibilityLabel,
  first,
}: {
  label: string;
  value: string | null | undefined;
  /** A quieter continuation of the value, e.g. the weather's condition word. */
  tail?: string | null;
  onPress?: () => void;
  trailingIcon?: string;
  accessibilityLabel?: string;
  /** The first row in a section carries no top hairline. */
  first?: boolean;
}): React.ReactElement | null {
  if (!present(value)) return null;

  const body = (
    <>
      <Text style={styles.factLabel} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.factValueWrap}>
        <Text style={styles.factValue} numberOfLines={2}>
          {value}
          {present(tail) ? <Text style={styles.factTail}>{`  ${tail}`}</Text> : null}
        </Text>
      </View>
      {trailingIcon ? <Icon name={trailingIcon} size={16} color={SPINE.factLabel} /> : null}
    </>
  );

  if (!onPress) {
    return <View style={[styles.factRow, first ? null : styles.factRowDivided]}>{body}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.factRow,
        first ? null : styles.factRowDivided,
        pressed ? styles.factRowPressed : null,
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `${label}, ${value}`}
    >
      {body}
    </Pressable>
  );
}

/**
 * A row that opens a URL, with the ONE pre-flight the six existing
 * `Linking.openURL` call sites did not have between them.
 *
 * #1605's bug ledger, items 1-3: six openURL sites, ZERO `canOpenURL`
 * pre-flights and ONE `.catch` (console-only). A URL the OS cannot open is a
 * DEAD TAP (Constitution 1) and a rejected promise is a SILENT FAILURE
 * (Constitution 3). `onUnavailable` is what turns both into something the user
 * can see.
 */
export function LinkRow({
  label,
  value,
  url,
  trailingIcon,
  onUnavailable,
  first,
}: {
  label: string;
  value: string | null | undefined;
  url: string | null;
  trailingIcon?: string;
  onUnavailable: () => void;
  first?: boolean;
}): React.ReactElement | null {
  if (!present(value) || url === null) return null;
  return (
    <FactRow
      label={label}
      value={value}
      trailingIcon={trailingIcon}
      first={first}
      onPress={() => {
        void (async () => {
          try {
            const can = await Linking.canOpenURL(url);
            if (!can) {
              onUnavailable();
              return;
            }
            await Linking.openURL(url);
          } catch {
            onUnavailable();
          }
        })();
      }}
    />
  );
}

/**
 * A section that failed, replaced IN PLACE by one line and a retry.
 *
 * Per-section, never whole-sheet: the hero and the action band render from data
 * already in hand and cannot fail. No icon, no illustration, no apology
 * paragraph. After a second failure the caller stops rendering the section
 * entirely — silence beats a retry button that does not work.
 */
export function SectionError({
  message,
  retryLabel,
  onRetry,
}: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
}): React.ReactElement {
  return (
    <View style={styles.errorRow}>
      <Text style={styles.errorText}>{message}</Text>
      <Pressable
        onPress={onRetry}
        style={({ pressed }) => [styles.retry, pressed ? styles.retryPressed : null]}
        accessibilityRole="button"
        accessibilityLabel={retryLabel}
      >
        <Text style={styles.retryText}>{retryLabel}</Text>
      </Pressable>
    </View>
  );
}

/**
 * A skeleton at a section's KNOWN height.
 *
 * There is no hero skeleton, ever — the deck already holds the cover, the title
 * and the facts line, so the hero is complete at frame 1 and a skeleton there
 * would be a lie about latency. Only sections whose data is genuinely in flight
 * get one, and each renders at the height its real content will occupy so
 * nothing jumps under the user's thumb.
 *
 * Reduced motion: flat, no pulse. Read once at mount — the OS setting does not
 * change mid-sheet, and subscribing would leak a listener per skeleton row.
 */
export function Skeleton({
  height,
  width,
  style,
}: {
  height: number;
  width?: number | `${number}%`;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const pulse = React.useRef(new Animated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = React.useState(false);

  React.useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled?.().then((v) => {
      if (mounted) setReduceMotion(!!v);
    });
    return () => {
      mounted = false;
    };
  }, []);

  React.useEffect(() => {
    if (reduceMotion) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.55,
          duration: SPINE.skeletonPulseMs / 2,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: SPINE.skeletonPulseMs / 2,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[
        styles.skeleton,
        { height, width: width ?? '100%' },
        reduceMotion ? null : { opacity: pulse },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  section: { paddingVertical: SPINE.sectionPaddingVertical },
  // Full-bleed: the rule spans the sheet, the content does not. That contrast is
  // what makes one line read as a group boundary without any colour.
  rule: {
    height: 1,
    backgroundColor: SPINE.rule,
    marginBottom: SPINE.sectionPaddingVertical,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: SPINE.gutter,
    marginBottom: 12,
  },
  heading: {
    fontSize: SPINE.headingSize,
    fontWeight: '700',
    color: SPINE.heading,
    letterSpacing: SPINE.headingLetterSpacing,
  },
  chip: {
    backgroundColor: SPINE.chipFill,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  chipText: { fontSize: 12, fontWeight: '600', color: SPINE.heading },
  factRow: {
    minHeight: SPINE.factRowMinHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: SPINE.gutter,
    paddingVertical: 10,
  },
  factRowDivided: { borderTopWidth: 1, borderTopColor: SPINE.rule },
  factRowPressed: { backgroundColor: SPINE.pressedRow },
  factLabel: {
    fontSize: SPINE.factLabelSize,
    fontWeight: '500',
    color: SPINE.factLabel,
    // A stable label column so the values line up down the section without a
    // grid or a measured layout pass. 118, not 96: at 96 the longest shipped
    // label ("Opening Hours", 14/500) tail-ellipsised to "Opening Ho…" on a
    // 402pt screen — caught on device, not in review.
    width: 118,
  },
  factValueWrap: { flex: 1 },
  factValue: {
    fontSize: SPINE.factValueSize,
    fontWeight: '500',
    color: SPINE.factValue,
  },
  factTail: { fontWeight: '400', color: SPINE.muted, fontSize: 14 },
  errorRow: {
    paddingHorizontal: SPINE.gutter,
    gap: 12,
    alignItems: 'flex-start',
  },
  errorText: { fontSize: 15, fontWeight: '500', color: SPINE.error },
  retry: {
    minHeight: SPINE.factRowMinHeight,
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: SPINE.hairline,
  },
  retryPressed: { backgroundColor: SPINE.pressedRow },
  retryText: { fontSize: 14, fontWeight: '600', color: SPINE.factValue },
  skeleton: {
    backgroundColor: SPINE.skeleton,
    borderRadius: SPINE.skeletonRadius,
  },
});

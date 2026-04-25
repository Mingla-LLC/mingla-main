/**
 * GlassSessionSwitcher — horizontally-scrolling glass capsule of session pills (ORCH-0589).
 *
 * Contents (left → right):
 *   [Solo pill] [Collab session pill 1] [Collab session pill 2] ... [+ create pill]
 *
 * Exactly ONE pill is active at any time (the current mode). Inactive pills are transparent
 * inside the glass container; the active pill has an orange-tinted glass overlay + orange
 * border + outer orange glow.
 *
 * Container: full chrome glass stack (BlurView + tint floor + top highlight + border + shadow).
 * Solid-tile fallback for Reduce Transparency and Android API < 31.
 *
 * Spec: SPEC_ORCH-0589_FLOATING_GLASS_HOME.md §4.4
 * Tokens: designSystem.ts → glass.chrome.*
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Platform,
  AccessibilityInfo,
  Animated,
  Easing,
  ScrollView,
} from 'react-native';
import type { NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Icon } from './ui/Icon';
import { glass } from '../constants/designSystem';

const c = glass.chrome;

// ORCH-0661 — Pill state covers the lifecycle of a session pill on the home bar.
// `active`         = currently-selected mode OR an accepted/active session pill
// `pending-sent`   = sender's outgoing invite, not yet accepted (clock badge)
// `pending-received` = receiver's incoming invite, not yet responded (mail badge)
// Required field on every SessionSwitcherItem — the `default: never` switch in
// HomePage.tsx → sessionTypeToPillState locks this contract at compile time.
// See I-PILL-STATE-PARITY invariant.
export type SessionPillState = 'active' | 'pending-sent' | 'pending-received';

export type SessionSwitcherItem = {
  id: string;               // unique identifier (session id or 'solo')
  label: string;            // display name — the primary visual content of each pill
  state: SessionPillState;  // ORCH-0661: required, no default fallback (see I-PILL-STATE-PARITY)
};

// ORCH-0661 — I-PILL-STATE-PARITY enforcement (secondary lock).
// The primary lock is the `default: never` switch in HomePage.tsx; this type-level
// assertion is a secondary safety net that catches the case where SessionPillState
// is extended without a corresponding SessionType change. If SessionType ever gains
// a member that the SessionPillState mapping doesn't cover, this assertion fails.
import type { SessionType as _SessionTypeForParityCheck } from './CollaborationSessions';
type _PillStateCoversAllSessionTypes = Exclude<
  _SessionTypeForParityCheck,
  'active' | 'sent-invite' | 'received-invite'
> extends never ? true : never;
// Force-evaluate the type so unused-import warnings don't strip _SessionTypeForParityCheck.
const _PILL_STATE_PARITY_CHECK: _PillStateCoversAllSessionTypes = true;
// Intentionally exported as a no-op constant; consumers don't read it, but the
// assignment makes TypeScript hold the import + evaluate the assertion.
export { _PILL_STATE_PARITY_CHECK };

export type GlassSessionSwitcherProps = {
  items: SessionSwitcherItem[];
  activeId: string;
  onSelect: (id: string) => void;
  /** When provided, appends a "+" trailing pill that calls this on tap. */
  onCreate?: () => void;
  /** ORCH-0635: coach-mark target ref for the Solo pill (step 5). */
  coachSoloRef?: (node: View | null) => void;
  /** ORCH-0635: coach-mark target ref for the "+" create pill (step 4). */
  coachCreateRef?: (node: View | null) => void;
};

const isAndroidPreBlur = Platform.OS === 'android' && Platform.Version < 31;

export const GlassSessionSwitcher: React.FC<GlassSessionSwitcherProps> = ({
  items,
  activeId,
  onSelect,
  onCreate,
  coachSoloRef,
  coachCreateRef,
}) => {
  const [reduceTransparency, setReduceTransparency] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async (): Promise<void> => {
      try {
        const [rt, rm] = await Promise.all([
          AccessibilityInfo.isReduceTransparencyEnabled(),
          AccessibilityInfo.isReduceMotionEnabled(),
        ]);
        if (mounted) {
          setReduceTransparency(rt);
          setReduceMotion(rm);
        }
      } catch (err) {
        if (__DEV__) console.warn('[GlassSessionSwitcher] a11y init failed:', err);
        if (mounted) {
          setReduceTransparency(true);
          setReduceMotion(true);
        }
      }
    })();
    const rtSub = AccessibilityInfo.addEventListener(
      'reduceTransparencyChanged',
      (enabled: boolean) => setReduceTransparency(enabled),
    );
    const rmSub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled: boolean) => setReduceMotion(enabled),
    );
    return () => {
      mounted = false;
      rtSub.remove();
      rmSub.remove();
    };
  }, []);

  const useGlass = !reduceTransparency && !isAndroidPreBlur;

  // Track pill layout for auto-scroll-to-selected (collab sessions only — Solo
  // and Create live in the fixed-left block and never scroll).
  const scrollRef = useRef<ScrollView>(null);
  const pillLayoutsRef = useRef<Record<string, { x: number; width: number }>>({});
  const [contentWidth, setContentWidth] = useState(0);
  const [scrollAreaWidth, setScrollAreaWidth] = useState(0);
  const [scrollX, setScrollX] = useState(0);

  const handlePillLayout = (id: string, x: number, width: number): void => {
    pillLayoutsRef.current[id] = { x, width };
  };

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>): void => {
    setScrollX(e.nativeEvent.contentOffset.x);
  };

  // Auto-scroll so the active session pill is centered in the scroll viewport.
  // Solo is fixed-left so this is a no-op when activeId === 'solo'.
  useEffect(() => {
    const layout = pillLayoutsRef.current[activeId];
    const sv = scrollRef.current;
    if (!layout || !sv || scrollAreaWidth === 0) return;

    const targetX = Math.max(
      0,
      Math.min(
        layout.x - (scrollAreaWidth / 2 - layout.width / 2),
        Math.max(0, contentWidth - scrollAreaWidth),
      ),
    );
    // Only scroll if pill is not already reasonably centered.
    const currentCenter = scrollX + scrollAreaWidth / 2;
    const pillCenter = layout.x + layout.width / 2;
    if (Math.abs(currentCenter - pillCenter) > 16) {
      sv.scrollTo({ x: targetX, animated: !reduceMotion });
    }
    // Intentionally omit scrollX from deps — we don't want scroll to retrigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, scrollAreaWidth, contentWidth, reduceMotion]);

  const overflowsLeft = scrollX > 4;
  const overflowsRight = scrollX + scrollAreaWidth < contentWidth - 4;

  // Solo pill is rendered in the fixed-left block; everything else scrolls.
  // Defensive: if upstream stops sending solo, the fixed slot just stays empty.
  const soloItem = items.find((i) => i.id === 'solo') ?? null;
  const scrollableItems = items.filter((i) => i.id !== 'solo');

  const handleSoloPress = (): void => {
    if (Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    if (soloItem) onSelect(soloItem.id);
  };

  return (
    <View style={styles.container}>
      {/* L1 — blur or solid fallback */}
      {useGlass ? (
        <BlurView
          intensity={c.blur.intensity}
          tint={c.blur.tint}
          pointerEvents="none"
          experimentalBlurMethod={
            Platform.OS === 'android' ? 'dimezisBlurView' : undefined
          }
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: c.fallback.solid }]}
        />
      )}
      {/* L2 — tint floor */}
      {useGlass ? (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: c.tint.floor }]}
        />
      ) : null}
      {/* ORCH-0589 v4 (V5): top-highlight line removed — rendered as a visible
          white hairline artifact on device. Chrome elements now use only L4 full-
          perimeter border + L5 shadow for edge definition. */}

      {/* Fixed-left block: Solo pill + Create ("+") pill. Never scrolls. */}
      <View style={styles.fixedLeft}>
        {soloItem ? (
          <SessionPill
            item={soloItem}
            active={soloItem.id === activeId}
            onPress={handleSoloPress}
            onLayout={() => {
              /* fixed pill — no auto-scroll tracking needed */
            }}
            firstInRow={true}
            reduceMotion={reduceMotion}
            coachRef={coachSoloRef}
          />
        ) : null}
        {onCreate ? (
          <CreatePill
            onPress={() => {
              if (Platform.OS === 'ios') {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              }
              onCreate();
            }}
            coachRef={coachCreateRef}
          />
        ) : null}
      </View>

      {/* Scrollable area: collab session pills only. Edge fades clip to this area
          so they never paint over the fixed Solo / "+" pills on the left. */}
      <View
        style={styles.scrollArea}
        onLayout={(e) => setScrollAreaWidth(e.nativeEvent.layout.width)}
      >
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          onContentSizeChange={(w) => setContentWidth(w)}
        >
          {scrollableItems.map((item, idx) => (
            <SessionPill
              key={item.id}
              item={item}
              active={item.id === activeId}
              onPress={() => {
                // ORCH-0589 v5 (T3): re-tap on active pill is NOT a no-op anymore.
                // The parent (HomePage) decides whether to act — for collab sessions
                // it reopens the SessionViewModal via openSessionId nonce.
                if (Platform.OS === 'ios') {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                }
                onSelect(item.id);
              }}
              onLayout={(x, width) => handlePillLayout(item.id, x, width)}
              firstInRow={idx === 0}
              reduceMotion={reduceMotion}
            />
          ))}
        </ScrollView>

        {/* Edge-fade gradients — only over the scroll area (not over Solo / "+"). */}
        {/* ORCH-0589 v2 (G6): real horizontal LinearGradient fades — no more hard-edged matte. */}
        {overflowsLeft ? (
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(12,14,18,0.85)', 'rgba(12,14,18,0)']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={[styles.fadeEdge, styles.fadeEdgeLeft]}
          />
        ) : null}
        {overflowsRight ? (
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(12,14,18,0)', 'rgba(12,14,18,0.85)']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={[styles.fadeEdge, styles.fadeEdgeRight]}
          />
        ) : null}
      </View>
    </View>
  );
};

// ──────────────────────────────────────────────────────────
// Session pill (inactive transparent / active orange-tinted)
// ──────────────────────────────────────────────────────────

type SessionPillProps = {
  item: SessionSwitcherItem;
  active: boolean;
  onPress: () => void;
  onLayout: (x: number, width: number) => void;
  firstInRow: boolean;
  reduceMotion: boolean;
  /** ORCH-0635: optional coach-mark ref (attached to Solo pill only). */
  coachRef?: (node: View | null) => void;
};

const SessionPill: React.FC<SessionPillProps> = ({
  item,
  active,
  onPress,
  onLayout,
  firstInRow,
  reduceMotion,
  coachRef,
}) => {
  const pulse = useRef(new Animated.Value(1)).current;
  const prevActiveRef = useRef<boolean>(active);

  // ORCH-0661: pulse animation only fires for `state === 'active'` pills.
  // Pending pills do not pulse on becoming active because they typically aren't
  // tapped to switch modes — they trigger a modal. When a pending pill transitions
  // to active (T-04, invitee accepts), the next render with `state === 'active'`
  // will let this effect fall through and detect `active && !prevActiveRef.current`.
  // We always update `prevActiveRef.current` so re-becoming-active still fires.
  useEffect(() => {
    if (item.state === 'active' && active && !prevActiveRef.current) {
      if (reduceMotion) {
        pulse.setValue(1);
      } else {
        Animated.sequence([
          Animated.timing(pulse, {
            toValue: c.motion.selectPulseScale,
            duration: 120,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulse, {
            toValue: 1,
            duration: 140,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
        ]).start();
      }
    }
    prevActiveRef.current = active;
  }, [active, pulse, reduceMotion, item.state]);

  // ORCH-0661: pending pills get dim opacity at the outer Animated.View so
  // both the pill body AND the badge dim together as a single visual unit.
  const isPending = item.state === 'pending-sent' || item.state === 'pending-received';

  const pillStyle = [
    styles.pill,
    active ? styles.pillActive : null,
    !firstInRow ? { marginLeft: c.switcher.pillGap } : null,
    isPending ? { opacity: c.pending.dimOpacity } : null,
  ];

  // ORCH-0661: pending badge config picked once per render.
  const pendingBadge = isPending
    ? (item.state === 'pending-sent'
        ? { bg: c.pending.sent.badgeBgColor, icon: c.pending.sent.iconName }
        : { bg: c.pending.received.badgeBgColor, icon: c.pending.received.iconName })
    : null;

  // ORCH-0661: accessibility label varies by state so VoiceOver/TalkBack is
  // unambiguous about what tapping the pill will do.
  const a11yLabel =
    item.state === 'pending-sent'
      ? `Pending session ${item.label}, invite sent, tap to manage`
      : item.state === 'pending-received'
      ? `Pending session ${item.label}, invite received, tap to respond`
      : `Switch to ${item.label}${active ? ', active' : ''}`;

  return (
    // ORCH-0635: outer coach-ref wrapper (static View) for measureInWindow stability.
    // Animated.View can animate out of place; wrapping keeps the measurement target still.
    // ORCH-0661: pending badge is rendered as a sibling of Animated.View (NOT inside)
    // because the pill style has `overflow: 'hidden'` to clip the rounded fill/border
    // absolute overlays. A child badge with `top: -3, right: -3` would be clipped by
    // that overflow boundary. As a sibling inside the wrapper, the badge positions
    // relative to the wrapper bounds (which equal the Animated.View bounds because
    // the marginLeft is on Animated.View) and escapes the clipping.
    <View ref={coachRef} collapsable={false}>
      <Animated.View
        style={[pillStyle, { transform: [{ scale: pulse }] }]}
        onLayout={(e) => {
          const { x, width } = e.nativeEvent.layout;
          onLayout(x, width);
        }}
      >
        {active ? (
          <>
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.pillActiveFill]} />
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.pillActiveBorder]} />
          </>
        ) : null}
        {/* ORCH-0661: pending pill border — dashed hairline overlay, mirrors
            the absolute-fill pattern used for `pillActiveBorder`. Border is drawn
            AT the pill bounds (not outside), so overflow:hidden does not clip it. */}
        {isPending ? (
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.pillPendingBorder]} />
        ) : null}
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={a11yLabel}
          accessibilityState={{ selected: active }}
          style={styles.pillInner}
        >
          {/* ORCH-0589 v2 (G5): avatar removed — pills are label-only for a cleaner read. */}
          <Text
            style={[
              styles.pillLabel,
              active ? styles.pillLabelActive : (isPending ? styles.pillLabelPending : styles.pillLabelInactive),
            ]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {item.label}
          </Text>
        </Pressable>
      </Animated.View>
      {/* ORCH-0661: pending badge — sibling of Animated.View so it escapes
          overflow:hidden. Pixel-matches legacy CollaborationSessions inviteBadge
          geometry (size 14, radius 7, offset -3, 1.5px border, 7px icon). */}
      {pendingBadge ? (
        <View
          pointerEvents="none"
          style={[styles.pillPendingBadge, { backgroundColor: pendingBadge.bg }]}
        >
          <Icon
            name={pendingBadge.icon}
            size={c.pending.badge.iconSize}
            color={c.pending.badge.iconColor}
          />
        </View>
      ) : null}
    </View>
  );
};

// ──────────────────────────────────────────────────────────
// Create pill ("+")
// ──────────────────────────────────────────────────────────

const CreatePill: React.FC<{
  onPress: () => void;
  /** ORCH-0635: optional coach-mark ref (step 4, "Better together"). */
  coachRef?: (node: View | null) => void;
}> = ({ onPress, coachRef }) => {
  const scale = useRef(new Animated.Value(1)).current;

  const pressIn = (): void => {
    Animated.timing(scale, {
      toValue: 0.92,
      duration: c.motion.pressDurationMs,
      useNativeDriver: true,
    }).start();
  };
  const pressOut = (): void => {
    Animated.timing(scale, {
      toValue: 1,
      duration: c.motion.pressDurationMs,
      useNativeDriver: true,
    }).start();
  };

  return (
    // ORCH-0635 rework: outer wrapper owns the left-gap margin so the coach-ref
    // bounds match just the 32pt circular pill (not the preceding gap). The inner
    // Animated.View gets an override marginLeft:0 to avoid double-spacing.
    <View
      ref={coachRef}
      collapsable={false}
      style={{ marginLeft: glass.chrome.switcher.createPillGap }}
    >
      <Animated.View
        style={[styles.createPill, { marginLeft: 0, transform: [{ scale }] }]}
      >
        <Pressable
          onPress={onPress}
          onPressIn={pressIn}
          onPressOut={pressOut}
          accessibilityRole="button"
          accessibilityLabel="Create new session"
          style={styles.createPillInner}
        >
          <Icon name="add" size={18} color={c.inactive.iconColorStrong} />
        </Pressable>
      </Animated.View>
    </View>
  );
};

// ──────────────────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    height: glass.chrome.switcher.height,
    borderRadius: glass.chrome.switcher.radius,
    borderWidth: 1,
    borderColor: glass.chrome.border.hairline,
    overflow: 'hidden',
    shadowColor: glass.chrome.shadow.color,
    shadowOffset: glass.chrome.shadow.offset,
    shadowOpacity: glass.chrome.shadow.opacity,
    shadowRadius: glass.chrome.shadow.radius,
    elevation: glass.chrome.shadow.elevation,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  // ORCH-0589 v4 (V5): topHighlight style deleted — see JSX comment above.
  // Fixed-left block: Solo + "+" pills, anchored to the left of the glass capsule.
  // Pulls innerEdgeGap from the left edge so Solo doesn't crowd the rounded corner.
  fixedLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: glass.chrome.switcher.innerEdgeGap,
    paddingVertical: glass.chrome.switcher.paddingVertical,
  },
  // Scroll area takes the remaining width and serves as the positioning context
  // for the edge-fade gradients (so they never overlap Solo / "+").
  scrollArea: {
    flex: 1,
    height: '100%',
    position: 'relative',
  },
  scrollContent: {
    // Left padding gives the first session pill breathing room from the "+"
    // pill (createPillGap = 10 keeps rhythm symmetric with Solo↔"+" gap).
    paddingLeft: glass.chrome.switcher.createPillGap,
    paddingRight: glass.chrome.switcher.innerEdgeGap,
    paddingVertical: glass.chrome.switcher.paddingVertical,
    alignItems: 'center',
  },
  pill: {
    height: glass.chrome.pill.height,
    borderRadius: glass.chrome.pill.radius,
    paddingHorizontal: glass.chrome.pill.paddingHorizontal,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  pillActive: {
    paddingHorizontal: glass.chrome.pill.paddingHorizontalActive,
    shadowColor: glass.chrome.active.glowColor,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: glass.chrome.active.glowOpacity,
    shadowRadius: 8,
    elevation: 4,
  },
  pillActiveFill: {
    backgroundColor: glass.chrome.active.tint,
    borderRadius: glass.chrome.pill.radius,
  },
  pillActiveBorder: {
    borderRadius: glass.chrome.pill.radius,
    borderWidth: 1,
    borderColor: glass.chrome.active.border,
  },
  // ORCH-0589 v2 (G5): label-only — no avatar gap / no avatar-width allowance.
  pillInner: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: glass.chrome.pill.maxLabelWidth,
  },
  pillLabel: {
    fontSize: 13,
    letterSpacing: 0.2,
  },
  pillLabelInactive: {
    color: glass.chrome.inactive.labelColor,
    fontWeight: '500',
  },
  pillLabelActive: {
    color: glass.chrome.active.labelColor,
    fontWeight: '600',
  },
  // ORCH-0661: pending-state styles. Border is dashed hairline overlay (absolute
  // fill, mirrors pillActiveBorder pattern). Label color reuses inactive value
  // via the dedicated pending token (designer can refine independently).
  pillLabelPending: {
    color: glass.chrome.pending.labelColor,
    fontWeight: '500',
  },
  pillPendingBorder: {
    borderRadius: glass.chrome.pill.radius,
    borderWidth: glass.chrome.pending.borderWidth,
    borderStyle: glass.chrome.pending.borderStyle,
    borderColor: glass.chrome.pending.borderColor,
  },
  pillPendingBadge: {
    position: 'absolute',
    top: glass.chrome.pending.badge.offsetTop,
    right: glass.chrome.pending.badge.offsetRight,
    width: glass.chrome.pending.badge.size,
    height: glass.chrome.pending.badge.size,
    borderRadius: glass.chrome.pending.badge.radius,
    borderWidth: glass.chrome.pending.badge.borderWidth,
    borderColor: glass.chrome.pending.badge.borderColor,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ORCH-0589 v2 (G5): avatar / avatarSolo / avatarInitials / avatarInitialsText removed.
  createPill: {
    width: glass.chrome.pill.createSize,
    height: glass.chrome.pill.createSize,
    borderRadius: glass.chrome.pill.createRadius,
    marginLeft: glass.chrome.switcher.createPillGap,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: glass.chrome.border.hairline,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  createPillInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ORCH-0589 v2 (G6): real LinearGradient fade. Width widened (token bumped 12→20)
  // so the gradient has room to fade smoothly rather than appearing as a hard line.
  fadeEdge: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: glass.chrome.switcher.fadeEdgeWidth,
  },
  fadeEdgeLeft: {
    left: 0,
  },
  fadeEdgeRight: {
    right: 0,
  },
});

export default GlassSessionSwitcher;

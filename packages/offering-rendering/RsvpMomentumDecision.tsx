/**
 * RsvpMomentumDecision — ORCH-1157 [rsvp-public-redesign] · Direction C "Momentum".
 *
 * The ONE shared, pure-presentational RSVP hero consumed by every surface:
 *   - buyer-web + business iOS/Android via `RsvpPublicBody`
 *   - consumer iOS/Android via the `ConsumerEventDetailScreen` RSVP branch
 *   - business-web draft preview (honest goingCount=0 zero-state)
 *
 * It renders, per the approved Direction-C mockup:
 *   (1) the GOING-MOMENTUM unit — oversized going COUNT + "going", an honest
 *       derived sub-line (spots-left / open-invite / full+waitlist), a capacity
 *       METER, and an explicitly ANONYMOUS (FACELESS) attendee cluster that is a
 *       COUNT motif, never identities; and
 *   (2) the GOING / MAYBE / CAN'T decision control as the thumb-zone hero
 *       (floating-dock on phone, sticky-panel on desktop, inline as fallback).
 *
 * WHY this exists (read before editing):
 *   - RSVP is TICKETLESS. There is NO price, NO "Reserve"/"Get tickets", NO cart,
 *     NO /checkout anywhere on any RSVP surface (I-PROPOSED-1157-RSVP-NO-CHECKOUT-
 *     AFFORDANCE). Do not add one.
 *   - Social proof is HONEST: going COUNT + capacity meter + a FACELESS cluster
 *     ONLY. We store NO public guest list, NO public maybe count, NO public
 *     waitlist count, NO comments/photos/reactions — so this component renders
 *     none of those, and its props surface carries no name/photo/maybeCount/
 *     waitlistCount field (I-PROPOSED-1157-RSVP-SOCIAL-PROOF-ANON-ONLY; constitution
 *     rule 9 — missing is hidden, never faked). The cluster avatars are GLYPH-only
 *     (a person outline drawn in SVG) — never an <Image>/uri.
 *   - The brand THEME ACCENT is the "loudness dial": the meter, cluster, going
 *     button and kicker dot all derive their color from `palette.accent` /
 *     `palette.accentWash`, never a hardcoded hue (I-PROPOSED-1157-RSVP-USES-
 *     BRAND-THEME-DIAL) — so the same layout reads right from a corporate mixer to
 *     a club-night with no layout change.
 *   - The decision is the HERO — it is rendered docked/sticky, never buried
 *     mid-body (I-PROPOSED-1157-RSVP-DECISION-IS-HERO).
 *
 * Pure: react-native + react-native-svg + the shared ThemePalette/ResolvedTheme
 * only. NO data fetch, NO React Query, NO app `src/` import
 * (I-MOR-0827-PACKAGE-ISOLATION). Renders on react-native-web AND native RN.
 * Android: every card fill is OPAQUE (Platform.select, fill ≥0.92, overflow:'hidden',
 * no Android shadow under a rounded fill) per ANDROID_GLASS_USES_OPAQUE_FALLBACK.
 */

import React, { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

import { boldFontFamily, type ThemePalette } from "./themePalette";
import { type ResolvedTheme } from "./designTokens";
import { type RsvpCtaState } from "./offeringCta";

// Pure, dep-free momentum derivation (Deno/node-testable; no renderer).
import { deriveMomentum, partyTypeLabel } from "./rsvpMomentum";

// ───────────────────────── presentational types ─────────────────────────────

/** The guest's own resolvable RSVP state (mirror of RsvpPublicBody). */
export type RsvpGuestStatus =
  | "going"
  | "not_going"
  | "waitlisted"
  | "maybe"
  | null;
export type RsvpGuestApproval = "pending" | "approved" | null;

export type RsvpMomentumVariant = "inline" | "sticky-panel" | "floating-dock";

// ───────────────────────────── props contract ───────────────────────────────

export interface RsvpMomentumDecisionProps {
  palette: ThemePalette;
  theme: ResolvedTheme;
  /** Confirmed-going headcount (each going+approved guest + their plus_count). */
  goingCount: number;
  /** Capacity cap; null = unlimited (no scarcity language). */
  capacity: number | null;
  /** From resolveRsvpCta (single owner of the CTA state machine). */
  ctaState: RsvpCtaState;
  guestStatus: RsvpGuestStatus;
  guestApproval: RsvpGuestApproval;
  /** Canonical party-type slugs (chips). [] → no chip row. */
  partyTypes: string[];
  /** Plus-ones stepper (RsvpPublicBody owns the count on the contact-form path). */
  allowPlusOnes: boolean;
  plusOnesMax: number;
  plusCount: number;
  onPlusChange: (n: number) => void;
  /** Waitlist is ON for this event (drives the Going→"Join waitlist" variant). */
  waitlistEnabled: boolean;
  submitting: boolean;
  /**
   * Going / Maybe both need a reachable guest. On buyer-web the contact form
   * (RsvpPublicBody) gates this; on consumer the logged-in JWT supplies it.
   * When false, tapping Going/Maybe still calls back so the host can surface the
   * "add your details" hint — the control is not disabled into a dead end.
   */
  contactReady: boolean;
  onGoing: () => void;
  onMaybe: () => void;
  onNotGoing: () => void;
  variant: RsvpMomentumVariant;
  /**
   * When true, render the host row + momentum unit ABOVE the decision (the
   * desktop sticky-panel + the consumer inline body both want the momentum here).
   * The phone floating-dock passes false (momentum lives inline in the body, the
   * dock is the decision only).
   */
  showMomentum: boolean;
  /**
   * When false, the Going / Maybe / Can't decision block is NOT rendered (the
   * momentum unit only). The phone `inline` body mount passes false — the
   * decision lives ONCE in the floating dock there (mockup line 177:
   * `.decision-host.inbody { display:none }`). Default true so the dock + the
   * desktop sticky-panel (the single mount on those surfaces) keep the decision.
   * Without this, the inline body would emit a SECOND, dead Going/Maybe/Can't row
   * with no-op handlers (Constitution rule 1 — no dead taps).
   */
  showDecision?: boolean;
  /**
   * The host row (avatar + "Hosted by X") for the sticky-panel. Optional —
   * RsvpPublicBody renders its own brand chip in the body on phone.
   */
  hostRow?: React.ReactNode;
  /** Optional microcopy under the decision (e.g. "Anyone with the link can RSVP"). */
  micro?: string;
  /** testID prefix for the going / maybe / not-going buttons + nodes. */
  goingTestID?: string;
  maybeTestID?: string;
  notGoingTestID?: string;
  testID?: string;
}

// ─────────────────────────────── glyphs (SVG) ───────────────────────────────

/** FACELESS person glyph for the anonymous cluster (NEVER a photo/uri). */
const PersonGlyph: React.FC<{ color: string }> = ({ color }) => (
  <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
    <Circle cx={12} cy={8} r={4} stroke={color} strokeWidth={2} />
    <Path
      d="M4 21c0-4 4-7 8-7s8 3 8 7"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
    />
  </Svg>
);

const CheckGlyph: React.FC<{ color: string }> = ({ color }) => (
  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
    <Path d="M5 13l4 4L19 7" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
const MaybeGlyph: React.FC<{ color: string }> = ({ color }) => (
  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
    <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={2.2} />
    <Path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .9-1 1.7" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M12 17h.01" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
  </Svg>
);
const XGlyph: React.FC<{ color: string }> = ({ color }) => (
  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
    <Path d="M6 6l12 12M18 6L6 18" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
  </Svg>
);
const ClockGlyph: React.FC<{ color: string }> = ({ color }) => (
  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
    <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={2.2} />
    <Path d="M12 7v5l3 2" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
const ListGlyph: React.FC<{ color: string }> = ({ color }) => (
  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
    <Path d="M4 6h16M4 12h16M4 18h10" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
  </Svg>
);

// Opaque-on-Android card fill (ANDROID_GLASS_USES_OPAQUE_FALLBACK): on Android we
// never use a translucent tint — derive an opaque fill from the palette (the page
// + a small accent wash already resolve to high-alpha values on dark/light
// themes). `overflow:'hidden'` clips the fill under the rounded corners.
const opaqueCardFill = (palette: ThemePalette): string =>
  Platform.OS === "android" ? palette.page : palette.card;

// ─────────────────────────────── component ──────────────────────────────────

export const RsvpMomentumDecision: React.FC<RsvpMomentumDecisionProps> = ({
  palette,
  theme,
  goingCount,
  capacity,
  ctaState,
  guestStatus,
  guestApproval,
  partyTypes,
  allowPlusOnes,
  plusOnesMax,
  plusCount,
  onPlusChange,
  waitlistEnabled,
  submitting,
  contactReady,
  onGoing,
  onMaybe,
  onNotGoing,
  variant,
  showMomentum,
  showDecision = true,
  hostRow,
  micro,
  goingTestID,
  maybeTestID,
  notGoingTestID,
  testID,
}) => {
  const boldFamily = boldFontFamily(theme);
  const momentum = deriveMomentum(goingCount, capacity);

  // Kicker dot pulse (1.8s) + meter fill width transition (0.5s ease) — subtle.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const dotScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] });
  const dotOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.5] });

  const meterWidth = useRef(new Animated.Value(momentum.meterPercent)).current;
  useEffect(() => {
    Animated.timing(meterWidth, {
      toValue: momentum.meterPercent,
      duration: 500,
      easing: Easing.out(Easing.ease),
      useNativeDriver: false,
    }).start();
  }, [meterWidth, momentum.meterPercent]);
  const meterFillWidth = meterWidth.interpolate({
    inputRange: [0, 100],
    outputRange: ["0%", "100%"],
  });

  // ── resolved guest states (mirror RsvpPublicBody) ──
  const goingResolved = guestStatus === "going" && guestApproval === "approved";
  const pendingResolved = guestApproval === "pending";
  const notGoingResolved = guestStatus === "not_going";
  const waitlistedResolved = guestStatus === "waitlisted";
  const maybeResolved = guestStatus === "maybe";

  const goingIsWaitlist = ctaState === "waitlist" && !waitlistedResolved && !goingResolved;
  const goingDisabled =
    submitting ||
    goingResolved ||
    pendingResolved ||
    waitlistedResolved ||
    (ctaState === "full" && !waitlistEnabled) ||
    !contactReady;
  const maybeDisabled =
    submitting || goingResolved || pendingResolved || waitlistedResolved || maybeResolved || !contactReady;

  const goingLabel = goingResolved
    ? "You're going"
    : goingIsWaitlist
      ? submitting
        ? "Joining…"
        : "Join waitlist"
      : pendingResolved
        ? "Awaiting approval"
        : waitlistedResolved
          ? "On the waitlist"
          : submitting
            ? "Saving…"
            : "Going";

  // ── party-type vibe chips (accent-wash pills; glyph-free, per the mockup) ──
  const chips =
    partyTypes.length > 0 ? (
      <View style={styles.chips} testID="orch-1157-rsvp-chips">
        {partyTypes.map((slug) => (
          <View
            key={slug}
            style={[
              styles.chip,
              {
                backgroundColor: palette.accentWash,
                borderColor: palette.panelBorder,
              },
            ]}
          >
            <Text style={[styles.chipText, { color: palette.primaryText }]}>
              {partyTypeLabel(slug)}
            </Text>
          </View>
        ))}
      </View>
    ) : null;

  // ── the momentum unit (count + meter + faceless cluster) ──
  const momentumUnit = (
    <View
      style={[
        styles.momentum,
        { backgroundColor: opaqueCardFill(palette), borderColor: palette.panelBorder },
      ]}
      testID="orch-1157-rsvp-momentum"
    >
      <View style={styles.momTop}>
        <Text
          style={[styles.momCount, { color: palette.primaryText, fontFamily: boldFamily }]}
          testID="orch-1157-rsvp-going-count"
          accessibilityLabel={`${momentum.hasGoing ? goingCount : 0} people going`}
        >
          {momentum.hasGoing ? goingCount : 0}
        </Text>
        <Text style={[styles.momLabel, { color: palette.secondaryText }]}>going</Text>
      </View>
      <Text style={[styles.momSub, { color: palette.tertiaryText }]} testID="orch-1157-rsvp-momentum-sub">
        {momentum.subLabel}
      </Text>
      {/* capacity meter — accent-gradient fill (theme dial), empty at goingCount=0 */}
      <View style={[styles.meterTrack, { backgroundColor: palette.panelBorder }]}>
        <Animated.View
          style={[
            styles.meterFill,
            { width: meterFillWidth, backgroundColor: palette.accent },
          ]}
          testID="orch-1157-rsvp-meter"
        />
      </View>
      {/* anonymous FACELESS attendee cluster — a COUNT motif, never identities.
          Hidden entirely at goingCount=0. NO <Image>/uri anywhere (rule 9). */}
      {momentum.hasGoing ? (
        <View
          style={styles.cluster}
          accessibilityLabel={`${goingCount} people going`}
          testID="orch-1157-rsvp-cluster"
        >
          {Array.from({ length: momentum.shownAvatars }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.avatar,
                {
                  backgroundColor: palette.accent,
                  borderColor: palette.page,
                  marginLeft: i === 0 ? 0 : -8,
                },
              ]}
            >
              <PersonGlyph color={palette.accentText} />
            </View>
          ))}
          {momentum.overflowCount > 0 ? (
            <View
              style={[
                styles.avatar,
                styles.avatarMore,
                { backgroundColor: opaqueCardFill(palette), borderColor: palette.page, marginLeft: -8 },
              ]}
            >
              <Text style={[styles.avatarMoreText, { color: palette.secondaryText }]}>
                +{momentum.overflowCount}
              </Text>
            </View>
          ) : null}
          <Text style={[styles.clusterNote, { color: palette.tertiaryText }]}>
            are pulling up
          </Text>
        </View>
      ) : null}
    </View>
  );

  // ── the decision control (Going / Maybe / Can't) ──
  // Each button is a glyph + label column, equal width, theme-accent driven.
  const dbtnBase = [styles.dbtn, { backgroundColor: opaqueCardFill(palette), borderColor: palette.panelBorder }];

  const GoingButton = (
    <Pressable
      onPress={onGoing}
      disabled={submitting || goingResolved || pendingResolved || waitlistedResolved || (ctaState === "full" && !waitlistEnabled)}
      accessibilityRole="button"
      accessibilityState={{ disabled: goingDisabled }}
      accessibilityLabel={goingLabel}
      style={[
        styles.dbtn,
        goingDisabled
          ? { backgroundColor: opaqueCardFill(palette), borderColor: palette.panelBorder }
          : { backgroundColor: palette.accent, borderColor: palette.accent },
      ]}
      testID={goingTestID ?? "orch-1157-rsvp-going"}
    >
      {goingIsWaitlist ? (
        <ListGlyph color={goingDisabled ? palette.tertiaryText : palette.accentText} />
      ) : pendingResolved ? (
        <ClockGlyph color={goingDisabled ? palette.tertiaryText : palette.accentText} />
      ) : (
        <CheckGlyph color={goingDisabled ? palette.tertiaryText : palette.accentText} />
      )}
      <Text
        style={[styles.dbtnText, { color: goingDisabled ? palette.tertiaryText : palette.accentText, fontFamily: boldFamily }]}
        numberOfLines={1}
      >
        {goingLabel}
      </Text>
    </Pressable>
  );

  const MaybeButton = (
    <Pressable
      onPress={onMaybe}
      disabled={submitting || maybeResolved || goingResolved || pendingResolved || waitlistedResolved}
      accessibilityRole="button"
      accessibilityState={{ disabled: maybeDisabled }}
      accessibilityLabel="Maybe"
      style={[styles.dbtn, { backgroundColor: palette.accentWash, borderColor: palette.accent, opacity: maybeDisabled ? 0.5 : 1 }]}
      testID={maybeTestID ?? "orch-1157-rsvp-maybe"}
    >
      <MaybeGlyph color={palette.accent} />
      <Text style={[styles.dbtnText, { color: palette.accent, fontFamily: boldFamily }]} numberOfLines={1}>
        Maybe
      </Text>
    </Pressable>
  );

  const NotGoingButton = (
    <Pressable
      onPress={onNotGoing}
      disabled={submitting}
      accessibilityRole="button"
      accessibilityLabel="Can't go"
      style={[...dbtnBase]}
      testID={notGoingTestID ?? "orch-1157-rsvp-not-going"}
    >
      <XGlyph color={palette.secondaryText} />
      <Text style={[styles.dbtnText, { color: palette.secondaryText, fontFamily: boldFamily }]} numberOfLines={1}>
        Can't go
      </Text>
    </Pressable>
  );

  // The button set depends on the resolved guest state (no dead ends):
  //  - pending → single disabled "Awaiting approval"
  //  - waitlisted → single "On the waitlist" (no maybe/can't toggle on a waitlist row)
  //  - going → "You're going" + Maybe(switch) + Can't (change reply)
  //  - maybe → switch-to-Going + Can't
  //  - not_going → switch-to-Going
  //  - open / full+waitlist → Going(/Join waitlist) + Maybe + Can't
  let decisionButtons: React.ReactNode;
  if (pendingResolved) {
    decisionButtons = <View style={styles.decisionRow}>{GoingButton}</View>;
  } else if (waitlistedResolved) {
    decisionButtons = <View style={styles.decisionRow}>{GoingButton}</View>;
  } else if (notGoingResolved) {
    decisionButtons = <View style={styles.decisionRow}>{GoingButton}</View>;
  } else if (maybeResolved) {
    decisionButtons = (
      <View style={styles.decisionRow}>
        {GoingButton}
        {NotGoingButton}
      </View>
    );
  } else if (goingResolved) {
    decisionButtons = (
      <View style={styles.decisionRow}>
        {GoingButton}
        {MaybeButton}
        {NotGoingButton}
      </View>
    );
  } else if (ctaState === "full" && !waitlistEnabled) {
    // Hard-full, no waitlist → Going disabled (informational) + Can't.
    decisionButtons = (
      <View style={styles.decisionRow}>
        {GoingButton}
        {NotGoingButton}
      </View>
    );
  } else if (goingIsWaitlist) {
    // Full + waitlist → "Join waitlist" + Can't (no Maybe on a full waitlist).
    decisionButtons = (
      <View style={styles.decisionRow}>
        {GoingButton}
        {NotGoingButton}
      </View>
    );
  } else {
    decisionButtons = (
      <View style={styles.decisionRow}>
        {GoingButton}
        {MaybeButton}
        {NotGoingButton}
      </View>
    );
  }

  // Plus-ones stepper (only in an unresolved, non-binding state).
  const showStepper =
    allowPlusOnes &&
    !goingResolved &&
    !pendingResolved &&
    !waitlistedResolved &&
    !maybeResolved &&
    !(ctaState === "full" && !waitlistEnabled);
  const stepper = showStepper ? (
    <View style={[styles.plusRow, { backgroundColor: opaqueCardFill(palette), borderColor: palette.panelBorder }]}>
      <Text style={[styles.plusLabel, { color: palette.secondaryText }]}>Bringing extras?</Text>
      <View style={styles.stepper}>
        <Pressable
          onPress={() => onPlusChange(Math.max(0, plusCount - 1))}
          disabled={plusCount <= 0}
          accessibilityRole="button"
          accessibilityLabel="Remove one extra guest"
          style={[styles.stepBtn, { borderColor: palette.panelBorder }]}
          testID="orch-1157-rsvp-plus-minus"
        >
          <Text style={[styles.stepGlyph, { color: palette.accent }]}>–</Text>
        </Pressable>
        <Text style={[styles.stepCount, { color: palette.primaryText, fontFamily: boldFamily }]}>+{plusCount}</Text>
        <Pressable
          onPress={() => onPlusChange(Math.min(plusOnesMax, plusCount + 1))}
          disabled={plusCount >= plusOnesMax}
          accessibilityRole="button"
          accessibilityLabel="Add one extra guest"
          style={[styles.stepBtn, { borderColor: palette.panelBorder }]}
          testID="orch-1157-rsvp-plus-plus"
        >
          <Text style={[styles.stepGlyph, { color: palette.accent }]}>+</Text>
        </Pressable>
      </View>
    </View>
  ) : null;

  const decisionBlock = (
    <View testID="orch-1157-rsvp-decision">
      {stepper}
      {decisionButtons}
      {micro !== undefined && micro.length > 0 ? (
        <Text style={[styles.micro, { color: palette.tertiaryText }]}>{micro}</Text>
      ) : null}
    </View>
  );

  // Kicker — "You're invited" (color: inherit = SAME as the title color =
  // palette.primaryText). The pulsing dot stays accent (Seth's approved tweak).
  const kicker = (
    <View style={styles.kickerRow} testID="orch-1157-rsvp-kicker">
      <Animated.View
        style={[
          styles.kickerDot,
          { backgroundColor: palette.accent, transform: [{ scale: dotScale }], opacity: dotOpacity },
        ]}
      />
      <Text style={[styles.kickerText, { color: palette.primaryText, fontFamily: boldFamily }]}>
        YOU'RE INVITED
      </Text>
    </View>
  );

  return (
    <View
      style={variant === "floating-dock" ? styles.dockWrap : styles.wrap}
      testID={testID ?? "orch-1157-rsvp-momentum-decision"}
    >
      {hostRow}
      {showMomentum ? kicker : null}
      {showMomentum ? chips : null}
      {showMomentum ? momentumUnit : null}
      {showDecision ? decisionBlock : null}
    </View>
  );
};

// Exposed so RsvpPublicBody can render the kicker + chips inline in the body on
// phone (they are part of the momentum unit but visually lead the body).
RsvpMomentumDecision.displayName = "RsvpMomentumDecision";

const styles = StyleSheet.create({
  wrap: { width: "100%" },
  dockWrap: { width: "100%" },

  kickerRow: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 8 },
  kickerDot: { width: 7, height: 7, borderRadius: 999 },
  kickerText: { fontSize: 11, fontWeight: "900", letterSpacing: 1.8 },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  chip: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 13, paddingVertical: 8 },
  chipText: { fontSize: 13, fontWeight: "700" },

  momentum: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
    marginBottom: 16,
    overflow: "hidden",
  },
  momTop: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  momCount: { fontSize: 40, fontWeight: "900", letterSpacing: -1.5, lineHeight: 42 },
  momLabel: { fontSize: 14, fontWeight: "700" },
  momSub: { fontSize: 12, fontWeight: "600", marginTop: 4 },
  meterTrack: { height: 8, borderRadius: 999, marginTop: 14, overflow: "hidden" },
  meterFill: { height: "100%", borderRadius: 999 },
  cluster: { flexDirection: "row", alignItems: "center", marginTop: 14 },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 999,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarMore: {},
  avatarMoreText: { fontSize: 11, fontWeight: "800" },
  clusterNote: { marginLeft: 12, fontSize: 12, fontWeight: "600" },

  decisionRow: { flexDirection: "row", gap: 10 },
  dbtn: {
    flex: 1,
    minWidth: 0,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 6,
    overflow: "hidden",
  },
  dbtnText: { fontSize: 13, fontWeight: "900" },
  micro: { textAlign: "center", fontSize: 11, marginTop: 10 },

  plusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
    overflow: "hidden",
  },
  plusLabel: { fontSize: 14, fontWeight: "600" },
  stepper: { flexDirection: "row", alignItems: "center" },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stepGlyph: { fontSize: 20, fontWeight: "800", lineHeight: 22 },
  stepCount: { fontSize: 16, fontWeight: "800", minWidth: 40, textAlign: "center" },
});

export default RsvpMomentumDecision;

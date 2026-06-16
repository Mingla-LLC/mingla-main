/**
 * UniversalCreatorSheet (ORCH-0826) — top-anchored creator picker.
 *
 * Opens from the top-bar "+" button on Home / Hub / Marketing / Account.
 *
 * TWO IN-PLACE STEPS (ORCH-1144 UX refinement, Seth 2026-06-15 — replaces the
 * old separate experience-chooser route that swapped one sheet for another):
 *
 *   Step "root" — three options as tappable rows:
 *     - "Create event"            → `/event/create` (close + push, unchanged)
 *     - "Create experience"       → does NOT navigate; transitions THIS sheet
 *                                   in-place to Step "experience" (stays open)
 *     - "Create trip or otherwise"→ `/trip/create` (close + push, unchanged)
 *
 *   Step "experience" — the universal experience-create chooser, in-place in the
 *   SAME sheet (no second sheet). Heading "Create An Experience", a back
 *   affordance to Step "root", and three option rows:
 *     - "Snap a food menu"        → `/experience/snap?mode=menu`       (Ve5 parser)
 *     - "Snap an activities menu" → `/experience/snap?mode=activities` (Ve6 parser)
 *     - "Build it yourself"       → `/experience/create`              (manual wizard)
 *   The snap/parse flow and the manual wizard STAY their own dedicated screens —
 *   only the 3-option chooser moved in-sheet.
 *
 * `parseMode` is chosen EXPLICITLY by the user's pick — never inferred from the
 * brand. No `venueCategory` gating, no `canGenerate*` predicate; every brand sees
 * all three rows. See I-PROPOSED-1144-PARSERS-CATEGORY-AGNOSTIC.
 *
 * `initialStep` (default "root") lets a caller open the sheet straight at the
 * experience chooser — the Hub > Experiences tab CTA passes "experience". When
 * opened directly at the experience step there is no root to return to, so the
 * back affordance is OMITTED in that mode (the scrim/close is the only way out);
 * when reached via the root step it returns in-place to root.
 *
 * The step RESETS to `initialStep` every time the sheet (re)opens, so it never
 * reopens mid-step.
 *
 * Uses TopSheet with `heightMode="compact"` (new in ORCH-0826, DEC-152) — both
 * steps render a header + 3 rows, so compact fits either step.
 *
 * Per Q1-Q8 SPEC ORCH-0826:
 *   - Q2: TopSheet (not bottom Sheet) — operator override
 *   - Q7: short-and-friendly copy
 *   - Constitution #1 (no dead taps): every row routes or steps to something real
 *   - Constitution #9 (no fabricated data): copy describes real offering types
 *   - I-38: Icon rows ≥ 44pt touch target (44×44 iconWrap below)
 *   - I-39: Every Pressable has accessibilityLabel
 *
 * Android glass: the experience-step rows use the opaque fallback (Platform.select
 * solid fill, no rgba bleed, overflow:'hidden', no Android shadow) per
 * ANDROID_GLASS_USES_OPAQUE_FALLBACK; iOS keeps the translucent glass tint.
 *
 * Caller mounts and controls `visible`. Each consumer (Home / Hub / Marketing /
 * Account / Hub>Experiences) owns its own `[isCreatorOpen, setIsCreatorOpen]`.
 *
 * Mingla_Artifacts/specs/SPEC_ORCH-0826_M0_HUB_FOUNDATION.md §6.2
 * Mingla_Artifacts/design/ORCH-1144/COPY_ORCH-1144_EXPERIENCE_CREATE_CHOOSER.md
 */

import React, { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import {
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Icon } from "./Icon";
import { TopSheet } from "./TopSheet";

// ORCH-1150 — "event" added: the "Create event" root row now steps in-place to
// a Ticketed-vs-RSVP chooser (mirrors the ORCH-1144 experience step) instead of
// routing straight to /event/create.
export type UniversalCreatorStep = "root" | "experience" | "event";

export interface UniversalCreatorSheetProps {
  visible: boolean;
  onClose: () => void;
  /**
   * Which step to open at. Defaults to "root" (the +→ creator picker). The
   * Hub > Experiences tab CTA passes "experience" to land straight on the
   * experience chooser. The sheet resets to this value on every (re)open.
   */
  initialStep?: UniversalCreatorStep;
  testID?: string;
}

type IconName = "calendar" | "sparkle" | "globe" | "flash" | "list" | "chevR";

interface RootOption {
  readonly key: "event" | "experience" | "trip";
  readonly iconName: IconName;
  readonly title: string;
  readonly subtitle: string;
  /** Either route (close + push) OR step (in-place transition), never both. */
  readonly route?: string;
  readonly step?: UniversalCreatorStep;
  readonly testID: string;
}

interface ChooserOption {
  // ORCH-1150 — + "ticketed" | "rsvp" for the EVENT_OPTIONS chooser.
  readonly key: "food" | "activities" | "manual" | "ticketed" | "rsvp";
  readonly iconName: IconName;
  readonly title: string;
  readonly subtitle: string;
  readonly route: string;
  readonly testID: string;
}

const ROOT_OPTIONS: readonly RootOption[] = [
  {
    key: "event",
    iconName: "calendar",
    title: "Create event",
    // ORCH-1150 — steps in-place to the Ticketed-vs-RSVP chooser.
    subtitle: "A gathering with guests — ticketed, or RSVP-only.",
    step: "event",
    testID: "universal-creator-event",
  },
  {
    key: "experience",
    iconName: "sparkle",
    title: "Create experience",
    subtitle: "A single-intent offering for venues: brunch, tasting, class.",
    // ORCH-1144 — does NOT navigate. Steps THIS sheet in-place to the
    // experience chooser (Snap a food menu / Snap an activities menu / Build it
    // yourself), shown unconditionally to every brand.
    step: "experience",
    testID: "universal-creator-experience",
  },
  {
    key: "trip",
    iconName: "globe",
    // I-BRAND-UNIVERSAL-AUTHORING (META-ORCH-0972): /trip/create routes
    // universally for every brand.
    title: "Create trip or otherwise",
    subtitle: "A multi-day curated package: retreat, tour, weekend getaway.",
    route: "/trip/create",
    testID: "universal-creator-trip",
  },
] as const;

// Order is FIXED and flat: food → activities → manual. Every brand sees all 3.
// COPY §1/§2 Recommended-primary set (heading overridden to "Create An
// Experience" per Seth 2026-06-15). Lifted verbatim from the retired
// ExperienceCreateChooser.tsx (ORCH-1144 UX refinement folded it in-sheet).
const EXPERIENCE_OPTIONS: readonly ChooserOption[] = [
  {
    key: "food",
    iconName: "flash",
    title: "Snap a food menu",
    subtitle:
      "Photo or PDF of your food or drinks menu. Mingla suggests experiences you can accept, edit, or reject.",
    route: "/experience/snap?mode=menu",
    testID: "experience-chooser-food",
  },
  {
    key: "activities",
    iconName: "list",
    title: "Snap an activities menu",
    subtitle:
      "Photo or PDF of your activities, packages, or rates — bowling, arcade, escape room, mini-golf. Mingla suggests experiences you can accept, edit, or reject.",
    route: "/experience/snap?mode=activities",
    testID: "experience-chooser-activities",
  },
  {
    key: "manual",
    iconName: "sparkle",
    title: "Build it yourself",
    subtitle:
      "No menu handy? Set up your experience step by step — full control over every detail.",
    route: "/experience/create",
    testID: "experience-chooser-manual",
  },
] as const;

// ORCH-1150 — the in-sheet "event" step: Ticketed (existing wizard, untouched)
// vs RSVP (new /rsvp/create). Mirrors EXPERIENCE_OPTIONS exactly.
const EVENT_OPTIONS: readonly ChooserOption[] = [
  {
    key: "ticketed",
    iconName: "calendar",
    title: "Ticketed event",
    subtitle: "Sell or issue tickets — concert, party, comedy night, festival.",
    route: "/event/create",
    testID: "event-chooser-ticketed",
  },
  {
    key: "rsvp",
    iconName: "list",
    title: "RSVP event",
    subtitle: "Guests reply Going or Not going. No tickets — like a private invite.",
    route: "/rsvp/create",
    testID: "event-chooser-rsvp",
  },
] as const;

export const UniversalCreatorSheet: React.FC<UniversalCreatorSheetProps> = ({
  visible,
  onClose,
  initialStep = "root",
  testID,
}) => {
  const router = useRouter();
  const [step, setStep] = useState<UniversalCreatorStep>(initialStep);

  // Reset to the caller's entry step on every (re)open so the sheet never
  // reopens mid-step.
  useEffect(() => {
    if (visible) setStep(initialStep);
  }, [visible, initialStep]);

  const pushRoute = useCallback(
    (route: string): void => {
      // Close first so the sheet's exit animation begins, then push the route.
      // The 50ms delay matches the scrim-fade lead so the transition feels
      // intentional rather than abrupt.
      onClose();
      setTimeout(() => {
        router.push(route as never);
      }, 50);
    },
    [onClose, router],
  );

  const handleRootSelect = useCallback(
    (option: RootOption): void => {
      if (option.step !== undefined) {
        // In-place step transition — keep the sheet open.
        setStep(option.step);
        return;
      }
      if (option.route !== undefined) pushRoute(option.route);
    },
    [pushRoute],
  );

  const handleExperienceSelect = useCallback(
    (option: ChooserOption): void => {
      pushRoute(option.route);
    },
    [pushRoute],
  );

  // ORCH-1150 — the event step rows just push their route (Ticketed/RSVP).
  const handleEventSelect = useCallback(
    (option: ChooserOption): void => {
      pushRoute(option.route);
    },
    [pushRoute],
  );

  // Back is only meaningful when there IS a root to return to — i.e. the sheet
  // was opened at the root step. When opened directly at a sub-step
  // (Hub > Experiences tab passes initialStep="experience") there is no root,
  // so the affordance is omitted. ORCH-1150 — generalized to cover both the
  // experience AND event sub-steps.
  const showBack = step !== "root" && initialStep === "root";

  return (
    <TopSheet visible={visible} onClose={onClose} heightMode="compact" testID={testID}>
      {step === "root" ? (
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>What are you creating?</Text>
            <Text style={styles.headerSubtitle}>
              Pick one and we&apos;ll walk you through it.
            </Text>
          </View>
          <View style={styles.rows}>
            {ROOT_OPTIONS.map((option) => (
              <Pressable
                key={option.key}
                accessibilityRole="button"
                accessibilityLabel={option.title}
                accessibilityHint={option.subtitle}
                onPress={() => handleRootSelect(option)}
                style={({ pressed }) =>
                  pressed ? [styles.row, styles.rowPressed] : styles.row
                }
                testID={option.testID}
              >
                <View style={styles.rowIconWrap}>
                  <Icon name={option.iconName} size={28} color={textTokens.primary} />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{option.title}</Text>
                  <Text style={styles.rowSubtitle}>{option.subtitle}</Text>
                </View>
                <Icon name="chevR" size={20} color={textTokens.tertiary} />
              </Pressable>
            ))}
          </View>
        </View>
      ) : step === "event" ? (
        // ORCH-1150 — in-sheet event chooser: Ticketed vs RSVP.
        <View style={styles.container}>
          <View style={styles.header}>
            {showBack ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back"
                accessibilityHint="Back to what you're creating"
                onPress={() => setStep("root")}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={({ pressed }) =>
                  pressed ? [styles.backRow, styles.backRowPressed] : styles.backRow
                }
                testID="event-chooser-back"
              >
                <Icon name="chevL" size={18} color={textTokens.secondary} />
                <Text style={styles.backLabel}>Back</Text>
              </Pressable>
            ) : null}
            <Text style={styles.headerTitle}>Create an event</Text>
            <Text style={styles.headerSubtitle}>Pick how guests join.</Text>
          </View>
          <View style={styles.rows}>
            {EVENT_OPTIONS.map((option) => (
              <Pressable
                key={option.key}
                accessibilityRole="button"
                accessibilityLabel={option.title}
                accessibilityHint={option.subtitle}
                onPress={() => handleEventSelect(option)}
                style={({ pressed }) =>
                  pressed ? [styles.expRow, styles.expRowPressed] : styles.expRow
                }
                testID={option.testID}
              >
                <View style={styles.expRowIconWrap}>
                  <Icon name={option.iconName} size={28} color={textTokens.primary} />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{option.title}</Text>
                  <Text style={styles.rowSubtitle}>{option.subtitle}</Text>
                </View>
                <Icon name="chevR" size={20} color={textTokens.tertiary} />
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <View style={styles.container}>
          <View style={styles.header}>
            {showBack ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back"
                accessibilityHint="Back to what you're creating"
                onPress={() => setStep("root")}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={({ pressed }) =>
                  pressed ? [styles.backRow, styles.backRowPressed] : styles.backRow
                }
                testID="experience-chooser-back"
              >
                <Icon name="chevL" size={18} color={textTokens.secondary} />
                <Text style={styles.backLabel}>Back</Text>
              </Pressable>
            ) : null}
            <Text style={styles.headerTitle}>Create An Experience</Text>
            <Text style={styles.headerSubtitle}>
              Snap a menu and let Mingla draft it for you, or build it yourself.
            </Text>
          </View>
          <View style={styles.rows}>
            {EXPERIENCE_OPTIONS.map((option) => (
              <Pressable
                key={option.key}
                accessibilityRole="button"
                accessibilityLabel={option.title}
                accessibilityHint={option.subtitle}
                onPress={() => handleExperienceSelect(option)}
                style={({ pressed }) =>
                  pressed ? [styles.expRow, styles.expRowPressed] : styles.expRow
                }
                testID={option.testID}
              >
                <View style={styles.expRowIconWrap}>
                  <Icon name={option.iconName} size={28} color={textTokens.primary} />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{option.title}</Text>
                  <Text style={styles.rowSubtitle}>{option.subtitle}</Text>
                </View>
                <Icon name="chevR" size={20} color={textTokens.tertiary} />
              </Pressable>
            ))}
          </View>
        </View>
      )}
    </TopSheet>
  );
};

// ANDROID_GLASS_USES_OPAQUE_FALLBACK — opaque solid fills on Android (no rgba
// bleed-through over the TopSheet surface), translucent glass on iOS. No Android
// shadow under the rounded fill; overflow:'hidden' clips the row content. Used
// by the experience-step rows (lifted from the retired ExperienceCreateChooser).
const ROW_BG = Platform.select({
  ios: glass.tint.profileBase,
  android: "#23262b",
  default: glass.tint.profileBase,
});
const ROW_BG_PRESSED = Platform.select({
  ios: glass.tint.profileElevated,
  android: "#2c2f35",
  default: glass.tint.profileElevated,
});
const ROW_ICON_BG = Platform.select({
  ios: glass.tint.profileElevated,
  android: "#2c2f35",
  default: glass.tint.profileElevated,
});

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  header: {
    gap: spacing.xs,
  },
  headerTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  headerSubtitle: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
  },
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 2,
    marginBottom: spacing.xs,
    paddingVertical: 2,
    paddingRight: spacing.sm,
  },
  backRowPressed: {
    opacity: 0.6,
  },
  backLabel: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "500",
    color: textTokens.secondary,
  },
  rows: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radiusTokens.lg,
    overflow: "hidden",
    backgroundColor: glass.tint.profileBase,
    borderColor: glass.border.profileBase,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowPressed: {
    backgroundColor: glass.tint.profileElevated,
  },
  rowIconWrap: {
    width: 44,
    height: 44,
    borderRadius: radiusTokens.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.tint.profileElevated,
  },
  // Experience-step rows — Android opaque fallback (see ROW_BG above).
  expRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radiusTokens.lg,
    overflow: "hidden",
    backgroundColor: ROW_BG,
    borderColor: glass.border.profileBase,
    borderWidth: StyleSheet.hairlineWidth,
  },
  expRowPressed: {
    backgroundColor: ROW_BG_PRESSED,
  },
  expRowIconWrap: {
    width: 44,
    height: 44,
    borderRadius: radiusTokens.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: ROW_ICON_BG,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: typography.bodyLg.fontSize,
    lineHeight: typography.bodyLg.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
  },
  rowSubtitle: {
    fontSize: typography.bodySm?.fontSize ?? typography.body.fontSize,
    lineHeight: typography.bodySm?.lineHeight ?? typography.body.lineHeight,
    color: textTokens.secondary,
  },
});

export default UniversalCreatorSheet;

import React, { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import type { ThemeAnimationSlug, ThemeInput } from "@mingla/offering-rendering";
import {
  EventCoverMedia,
  ThemeEntranceAnimation,
} from "@mingla/offering-rendering";
import {
  SERVER_ACCEPTED_ANIMATION_SLUGS,
  THEME_ANIMATION_CATALOG,
  THEME_MOTION_GROUPS,
} from "../../../../packages/offering-rendering/designTokens";
import { setThemeMotionDevOverride } from "../../../../packages/offering-rendering/themeMotion";
import {
  boldFontFamily,
  createThemePalette,
  themeTextAccent,
} from "../../../../packages/offering-rendering/themePalette";
import { resolveTheme } from "../../../../packages/offering-rendering/themeResolver";
import { ThemeAccentGradientLayer } from "../../../../packages/offering-rendering/ThemeAccentFill";
import { googleFontOutcome } from "../../../../packages/offering-rendering/googleFontLoader";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import { themeAxisIsInherited } from "../../services/offeringTheme";
import { useThemeFont } from "../../theme/useThemeFont";
import { ScrollView } from "../../wrappers/SmartScrollView";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
// #1022 F-4 — import the PLATFORM-RESOLVING entry point, not the mobile
// implementation. Importing ../ui/SheetMobile directly (this was the only
// consumer repo-wide that did) bypassed Sheet.web.tsx entirely, so the
// >=1024px DesktopCenteredCard never rendered and the sheet went full-bleed.
import { Sheet } from "../ui/Sheet";
import { ThemeColourTab } from "./ThemeColourTab";
import { ThemeFontTab } from "./ThemeFontTab";
import {
  themeDefaultFontLabel,
  themeResetLabel,
  type ThemeControlScope,
  type ThemeSheetTab,
} from "./themeColorModel";
import {
  SAMPLE_THEME_PREVIEW,
  type ThemePreviewContent,
} from "./themePreviewContent";

/**
 * #1022 — the expanded Theme control.
 *
 * TWO THINGS IN HERE ARE LOAD-BEARING AND MUST NOT BE "TIDIED":
 *
 * 1. THE BODY BRINGS ITS OWN SCROLL. `SheetMobile`'s body is
 *    `{flex:1, ...}` inside a FIXED-HEIGHT panel with `overflow:"hidden"` —
 *    the Sheet supplies NO scrolling of its own. The tab body below therefore
 *    mounts `wrappers/SmartScrollView` with `style={{flex:1}}`. Dropping that
 *    `flex:1` is the ORCH-1193 bug: the scroll box grows past the panel bottom
 *    and the footer `Done` becomes permanently unreachable. The designed
 *    content leaves only ~20pt of slack, so there is no margin for error.
 *    SmartScrollView is also what keeps the hex field clear of the keyboard.
 *
 * 2. NO GESTURE COORDINATION. The Custom hue sliders (ThemeColourTab) use
 *    their own Pan gestures. They are NOT coordinated with the sheet's dismiss
 *    pan via Gesture.Simultaneous / Gesture.Native /
 *    simultaneousWithExternalGesture / blocksExternalGesture. ORCH-1173 R1
 *    tried exactly that and it failed on a physical Samsung. The sheet's
 *    dismiss pan is scoped to its own 52pt handle band (#1022, SheetMobile),
 *    which is what makes slider dragging safe.
 *
 * issue #1023 wave 2 — the colour tab is swatches + gradients + Custom
 * (ThemeColourTab), the font tab is every Google Fonts family (ThemeFontTab).
 * The font tab is rendered OUTSIDE the body ScrollView: its FlatList owns the
 * scroll (a list nested in a same-direction ScrollView loses virtualisation).
 */

const COMPACT_SCREEN_HEIGHT = 700;

type TabKey = ThemeSheetTab;

export interface ThemeSheetProps {
  visible: boolean;
  onClose: () => void;
  /** The raw override. null = fully inherited. */
  value: ThemeInput | null | undefined;
  /** ONE patch per user action, derived from CURRENT state at commit time. */
  onChange: (next: ThemeInput | null) => void;
  scope: ThemeControlScope;
  brandTheme?: ThemeInput | null;
  /**
   * issue #3349 — the draft the preview band shows (its name, first start and
   * cover). Offering mounts pass `buildDraftThemePreview(draft)`. Omitted = a
   * sample, for the brand and venue sheets, which have no single event.
   */
  preview?: ThemePreviewContent | null;
  testID?: string;
}

/**
 * Merge one axis into the current override and normalise the empty case.
 * issue #1023 — `color2` belongs to the colour axis: a colour commit sets both
 * stops at once (a gradient is one unit), any other axis keeps them, and
 * clearing the colour clears the second stop too.
 */
const withAxis = (
  current: ThemeInput | null | undefined,
  axis: "color" | "font" | "animation",
  next: string | null,
  nextColor2: string | null = null,
): ThemeInput | null => {
  const color = axis === "color" ? next : (current?.color ?? null);
  const color2 =
    axis === "color" ? (next === null ? null : nextColor2) : (current?.color2 ?? null);
  const merged: ThemeInput = {
    color,
    font: axis === "font" ? next : (current?.font ?? null),
    animation: axis === "animation" ? next : (current?.animation ?? null),
  };
  if (color !== null && color2 !== null) merged.color2 = color2;
  if (merged.color === null && merged.font === null && merged.animation === null) {
    return null;
  }
  return merged;
};

export const ThemeSheet: React.FC<ThemeSheetProps> = ({
  visible,
  onClose,
  value,
  onChange,
  scope,
  brandTheme,
  preview,
  testID,
}) => {
  const { height: screenHeight } = useWindowDimensions();
  const previewContent = preview ?? SAMPLE_THEME_PREVIEW;
  const compact = screenHeight < COMPACT_SCREEN_HEIGHT;
  const [tab, setTab] = useState<TabKey>("colour");
  const [replayNonce, setReplayNonce] = useState(0);
  // issue #1023 — a preview-only motion pick (not saved; see below).
  const [previewSlug, setPreviewSlug] = useState<ThemeAnimationSlug | null>(null);

  // C-1 — brandTheme FIRST. Getting this backwards is the bug that shipped.
  const resolved = useMemo(
    () =>
      scope === "brand"
        ? resolveTheme(value ?? null, null)
        : resolveTheme(brandTheme ?? null, value ?? null),
    [scope, value, brandTheme],
  );
  const palette = useMemo(() => createThemePalette(resolved), [resolved]);
  const previewTheme = useMemo(
    () => (previewSlug === null ? resolved : { ...resolved, animation: previewSlug }),
    [resolved, previewSlug],
  );

  // ORCH-1083 — the ONLY useThemeFont call site in this sheet. Browsing the
  // font list loads nothing; only the SELECTED family loads, for the preview.
  const resolvedFontState = useThemeFont(resolved.fontFamilyValue);
  const resolvedFontLoaded = resolvedFontState?.loaded === true;
  // issue #1023 — a Google family that could not load is drawn as Inter; say
  // so under the preview rather than letting the host think Inter was chosen.
  const resolvedFamily = resolved.fontFamilyValue.startsWith("GF_")
    ? resolved.font
    : null;
  const resolvedFamilyFellBack =
    resolvedFontLoaded &&
    resolvedFamily !== null &&
    googleFontOutcome(resolvedFamily)?.fellBack === true;


  // ── THE single colour write path ─────────────────────────────────────────
  // Swatch, gradient, slider release and hex commit ALL funnel through here.
  // Each call emits ONE patch derived from CURRENT state (never a captured
  // prop snapshot — that is A/F-11), carrying both stops together.
  const commitColor = useCallback(
    (hex: string, hex2: string | null): void => {
      onChange(withAxis(value, "color", hex, hex2));
    },
    [onChange, value],
  );

  const commitFont = useCallback(
    (slug: string | null): void => {
      onChange(withAxis(value, "font", slug));
    },
    [onChange, value],
  );

  // issue #1023 — production's database still accepts only the original nine
  // slugs. A saveable pick commits as before. A preview-only pick is NEVER
  // sent to onChange: it plays in the preview band and, in dev builds only,
  // overrides every live entrance layer so the real public pages show it.
  const commitAnimation = useCallback(
    (slug: string | null): void => {
      const accepted = (SERVER_ACCEPTED_ANIMATION_SLUGS as readonly (string | null)[]).includes(slug);
      if (slug === null || accepted) {
        setPreviewSlug(null);
        setThemeMotionDevOverride(null, typeof __DEV__ !== "undefined" && __DEV__);
        onChange(withAxis(value, "animation", slug));
      } else {
        setPreviewSlug(slug as ThemeAnimationSlug);
        setThemeMotionDevOverride(slug as ThemeAnimationSlug, typeof __DEV__ !== "undefined" && __DEV__);
      }
      setReplayNonce((n) => n + 1);
    },
    [onChange, value],
  );


  const snapPoint = compact ? 0.9 : 0.86;

  const colourInherited = themeAxisIsInherited(value, "color");
  const fontInherited = themeAxisIsInherited(value, "font");
  const motionInherited = themeAxisIsInherited(value, "animation");

  // issue #1564 — at a VENUE the reset is not "undo an edit", it is "go back to
  // wearing the brand's look", and the label has to say which of the two it is
  // or the operator cannot tell what the button does. Approved copy for the
  // colour tab is "Use the brand's colours"; font and motion take the same
  // sentence with their own noun so all three tabs read as one control. Every
  // other scope keeps the shipped "Reset …" wording byte-for-byte.
  const resetLabel = themeResetLabel(scope, tab);
  const resetHidden =
    tab === "colour" ? colourInherited : tab === "font" ? fontInherited : motionInherited;

  // Per-axis reset — clears ONLY the active tab's axis back to inherited.
  // The old editor had a single blunt reset that wiped all three at once, and
  // it was the ONLY way to clear anything.
  const handleReset = useCallback((): void => {
    const axis = tab === "colour" ? "color" : tab === "font" ? "font" : "animation";
    onChange(withAxis(value, axis, null));
  }, [tab, onChange, value]);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      snapPoint={snapPoint}
      testID={testID}
    >
      {/* ── preview band — the honesty engine. Shows the DERIVED palette, the
          real bold family, and the real entrance motion. ── */}
      <View
        style={[
          styles.preview,
          { height: compact ? 104 : 132, backgroundColor: palette.page },
        ]}
        accessibilityLabel="Preview: your page with this theme"
      >
        <View style={styles.previewRow}>
          <View style={styles.previewText}>
            <Text
              style={[styles.previewEyebrow, { color: themeTextAccent(palette) }]}
              numberOfLines={1}
            >
              {previewContent.dateLine}
            </Text>
            <Text
              style={[
                styles.previewTitle,
                { color: palette.primaryText, fontFamily: boldFontFamily(resolved) },
              ]}
              numberOfLines={1}
            >
              {previewContent.title}
            </Text>
            <View style={[styles.previewCta, { backgroundColor: palette.accent }]}>
              <ThemeAccentGradientLayer
                theme={resolved}
                palette={palette}
                borderRadius={styles.previewCta.borderRadius}
                testID={testID !== undefined ? `${testID}-preview-gradient` : undefined}
              />
              <Text style={styles.previewCtaLabel}>{previewContent.ctaLabel}</Text>
            </View>
          </View>
          {/* issue #3349 — the draft's own cover, as a STILL: an image cover or
              a video cover's poster, else its hue. Never a second video player
              while the cover step's own player is live behind the sheet. */}
          {previewContent.cover !== null ? (
            <View
              style={[
                styles.previewCover,
                compact ? styles.previewCoverCompact : null,
              ]}
              testID={testID !== undefined ? `${testID}-preview-cover` : undefined}
            >
              <EventCoverMedia
                hue={previewContent.cover.hue}
                mediaUrl={previewContent.cover.imageUrl}
                mediaType={previewContent.cover.imageUrl !== null ? "image" : null}
                radius={radius.md}
                label=""
                height="100%"
                autoplay={false}
                playbackActive={false}
              />
            </View>
          ) : null}
        </View>
        <View style={styles.previewOverlay} pointerEvents="none">
          <ThemeEntranceAnimation
            theme={previewTheme}
            sessionKey={`theme-picker:${previewTheme.animation}:${replayNonce}`}
            replayOnMount={true}
            pauseButton="none"
          />
        </View>
      </View>

      <Pressable
        onPress={() => setReplayNonce((n) => n + 1)}
        style={styles.replay}
        accessibilityRole="button"
        accessibilityLabel="Replay motion preview"
        hitSlop={12}
      >
        <Text style={styles.replayLabel}>↻ Replay</Text>
      </Pressable>

      {/* ── segmented tabs ── */}
      <View style={styles.tabs} accessibilityRole="tablist">
        {(["colour", "font", "motion"] as const).map((key) => (
          <Pressable
            key={key}
            onPress={() => setTab(key)}
            hitSlop={{ top: 4, bottom: 4 }}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === key }}
            accessibilityLabel={key === "motion" ? "Motion" : key === "font" ? "Font" : "Colour"}
            style={[styles.tab, tab === key ? styles.tabActive : null]}
          >
            <Text style={[styles.tabLabel, tab === key ? styles.tabLabelActive : null]}>
              {key === "colour" ? "Colour" : key === "font" ? "Font" : "Motion"}
            </Text>
          </Pressable>
        ))}
      </View>

      {/*
        ── THE TAB BODY ──
        `style={{flex:1}}` is MANDATORY. Without it this scroll box grows past
        the fixed-height, overflow:hidden panel and the footer Done below
        becomes permanently unreachable (ORCH-1193). SmartScrollView also keeps
        the hex field above the keyboard + the 42pt Done bar.
      */}
      {resolvedFamilyFellBack ? (
        <Text style={styles.fallbackNote} testID={testID !== undefined ? `${testID}-font-fallback` : undefined}>
          This font couldn't load, so pages will show Inter for now.
        </Text>
      ) : null}

      {tab === "font" ? (
        <View style={styles.bodyScroll}>
          <ThemeFontTab
            font={value?.font ?? null}
            inherited={fontInherited}
            inheritLabel={themeDefaultFontLabel(scope, brandTheme)}
            inheritAccessibilityLabel={`${scope === "brand" ? "Mingla" : "Brand"} default font`}
            onCommit={commitFont}
            testID={testID !== undefined ? `${testID}-font-tab` : undefined}
          />
        </View>
      ) : (
      <ScrollView
        style={styles.bodyScroll}
        contentContainerStyle={styles.bodyContent}
        keyboardShouldPersistTaps="handled"
        testID={testID !== undefined ? `${testID}-body-scroll` : undefined}
      >
        {tab === "colour" ? (
          <View style={styles.tabBody}>
            <ThemeColourTab
              value={value}
              scope={scope}
              brandTheme={brandTheme}
              colourInherited={colourInherited}
              onCommit={commitColor}
              onInherit={() => onChange(withAxis(value, "color", null))}
            />
          </View>
        ) : null}

        {tab === "motion" ? (
          <View style={styles.tabBody}>
            {/* issue #1023 — every animation, grouped as in the approved
                reference. Tiles show a STILL of each look in the brand colour;
                the one live player is the preview band above (29 looping
                players would cost battery and frames). */}
            <View style={styles.motionGrid}>
              <MotionTile
                label="No motion"
                selected={!motionInherited && (value?.animation ?? null) === "none" && previewSlug === null}
                onPress={() => commitAnimation("none")}
              />
            </View>
            {THEME_MOTION_GROUPS.map((group) => (
              <View key={group} style={styles.motionGroup}>
                <Text style={styles.motionGroupLabel}>{group}</Text>
                <View style={styles.motionGrid}>
                  {(Object.keys(THEME_ANIMATION_CATALOG) as Array<keyof typeof THEME_ANIMATION_CATALOG>)
                    .filter((slug) => THEME_ANIMATION_CATALOG[slug].group === group)
                    .map((slug) => {
                      const previewOnly = !(SERVER_ACCEPTED_ANIMATION_SLUGS as readonly string[]).includes(slug);
                      const selected = previewOnly
                        ? previewSlug === slug
                        : previewSlug === null && !motionInherited && (value?.animation ?? null) === slug;
                      return (
                        <MotionTile
                          key={slug}
                          label={THEME_ANIMATION_CATALOG[slug].name}
                          selected={selected}
                          previewOnly={previewOnly}
                          onPress={() => commitAnimation(slug)}
                          stillTheme={{ ...resolved, animation: slug }}
                        />
                      );
                    })}
                </View>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
      )}

      {/* ── footer: per-axis reset + Done. Done DISMISSES ONLY — every change
          is already committed, so there is no save button to miss. ── */}
      <View style={styles.footer}>
        {resetHidden ? (
          <View />
        ) : (
          <Pressable
            onPress={handleReset}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={resetLabel}
            style={styles.resetBtn}
          >
            <Text style={styles.resetLabel}>{resetLabel}</Text>
          </Pressable>
        )}
        <Button label="Done" variant="primary" size="md" onPress={onClose} />
      </View>
    </Sheet>
  );
};

interface MotionTileProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  previewOnly?: boolean;
  stillTheme?: ReturnType<typeof resolveTheme>;
}

const MotionTile: React.FC<MotionTileProps> = ({ label, selected, onPress, previewOnly = false, stillTheme }) => (
  <Pressable
    onPress={onPress}
    style={[styles.motionTile, selected ? styles.motionTileSelected : null]}
    accessibilityRole="button"
    accessibilityState={{ selected }}
    accessibilityLabel={previewOnly ? `${label}, preview only` : label}
    accessibilityHint={previewOnly ? "Plays in the preview. Not saved yet." : undefined}
  >
    {stillTheme !== undefined ? (
      <View style={styles.motionTileArt} pointerEvents="none">
        <ThemeEntranceAnimation
          theme={stillTheme}
          sessionKey={`theme-tile:${stillTheme.animation}`}
          still
          pauseButton="none"
        />
      </View>
    ) : null}
    {previewOnly ? (
      <View style={styles.previewChip}>
        <Text style={styles.previewChipLabel}>Preview only</Text>
      </View>
    ) : null}
    <Text style={styles.motionTileLabel} numberOfLines={1}>
      {label}
    </Text>
    {selected ? (
      <View style={styles.motionCheck}>
        <Icon name="check" size={16} color={accent.warm} />
      </View>
    ) : null}
  </Pressable>
);

const styles = StyleSheet.create({
  preview: {
    borderRadius: radius.lg,
    overflow: "hidden",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    justifyContent: "center",
    gap: 4,
  },
  previewOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 2 },
  previewRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  previewText: { flex: 1, minWidth: 0, gap: 4 },
  previewCover: {
    width: 96,
    height: 96,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  previewCoverCompact: { width: 72, height: 72 },
  previewEyebrow: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  previewTitle: { fontSize: 20, lineHeight: 26, fontWeight: "700" },
  previewCta: {
    height: 36,
    borderRadius: 10,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
  },
  previewCtaLabel: { color: "#ffffff", fontSize: 14, lineHeight: 20, fontWeight: "700" },
  replay: { height: 20, justifyContent: "center", alignSelf: "flex-start" },
  replayLabel: { fontSize: 12, color: textTokens.tertiary, fontWeight: "600" },
  tabs: {
    height: 40,
    flexDirection: "row",
    backgroundColor: glass.tint.profileBase,
    borderRadius: radius.full,
    padding: 3,
    marginTop: spacing.sm,
  },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", borderRadius: radius.full },
  tabActive: { backgroundColor: glass.tint.profileElevated },
  tabLabel: { fontSize: 13, fontWeight: "600", color: textTokens.tertiary },
  tabLabelActive: { color: textTokens.primary },
  // MANDATORY flex:1 — see the header note (ORCH-1193).
  bodyScroll: { flex: 1 },
  bodyContent: { paddingTop: spacing.md, paddingBottom: spacing.md, gap: spacing.md },
  tabBody: { gap: spacing.md },
  fallbackNote: { fontSize: 12, color: textTokens.tertiary, marginTop: 4 },
  motionGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  motionGroup: { marginTop: spacing.md },
  motionGroupLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: textTokens.tertiary,
    marginBottom: spacing.xs,
  },
  motionTileArt: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: "#0c0e12",
  },
  previewChip: {
    position: "absolute",
    top: spacing.sm,
    left: spacing.sm,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: "rgba(12,14,18,0.72)",
  },
  previewChipLabel: { fontSize: 10, fontWeight: "700", color: "#ffffff" },
  motionTile: {
    // #1022 F-6 — 174 needed 356pt for two tiles + the 8pt gap, but the sheet
    // body is `screen - 32`: 343 on iPhone SE/8 and 352 on the tested Samsung.
    // Only phones >=388pt got the specified 2-column grid; everything narrower
    // collapsed to one column and the grid grew to ~880pt. 167*2 + 8 = 342 fits
    // the narrowest surface we ship to.
    width: 167,
    height: 88,
    borderRadius: radius.lg,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1.5,
    borderColor: "transparent",
    padding: spacing.sm,
    justifyContent: "flex-end",
  },
  motionTileSelected: { backgroundColor: accent.tint, borderColor: accent.border },
  motionTileLabel: { fontSize: 13, fontWeight: "600", color: textTokens.primary },
  motionCheck: { position: "absolute", top: spacing.sm, right: spacing.sm },
  footer: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  resetBtn: { minHeight: 44, justifyContent: "center" },
  resetLabel: { fontSize: 13, fontWeight: "600", color: textTokens.tertiary },
});

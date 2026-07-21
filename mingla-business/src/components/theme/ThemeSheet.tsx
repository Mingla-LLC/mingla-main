import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Gesture } from "react-native-gesture-handler";

import type { ThemeInput } from "@mingla/offering-rendering";
import { ThemeEntranceAnimation } from "@mingla/offering-rendering";
import {
  boldFontFamily,
  createThemePalette,
} from "../../../../packages/offering-rendering/themePalette";
import { resolveTheme } from "../../../../packages/offering-rendering/themeResolver";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { readableTextFor } from "../../utils/buttonAccentContrast";
import { themeAxisIsInherited } from "../../services/offeringTheme";
import { useThemeRecentsStore } from "../../store/themeRecentsStore";
import { useThemeFont } from "../../theme/useThemeFont";
import { ScrollView } from "../../wrappers/SmartScrollView";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
// #1022 F-4 — import the PLATFORM-RESOLVING entry point, not the mobile
// implementation. Importing ../ui/SheetMobile directly (this was the only
// consumer repo-wide that did) bypassed Sheet.web.tsx entirely, so the
// >=1024px DesktopCenteredCard never rendered and the sheet went full-bleed.
import { Sheet } from "../ui/Sheet";
import { WebSafeGestureDetector } from "../ui/WebSafeGestureDetector";
import { FONT_SPECIMENS } from "./fontSpecimens";
import { normalizeHexColor, normalizeHexColorOnBlur } from "./normalizeHexColor";
import { THEME_PRESETS, presetForHex } from "./themePresets";
import {
  ALL_ANIMATION_SLUGS,
  FONT_GROUPS,
  MOTION_DISPLAY_NAMES,
  hexToHsv,
  hsvToHex,
  hueName,
  type ThemeControlScope,
} from "./themeColorModel";

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
 * 2. NO GESTURE COORDINATION. The S/V plane and hue rail use their own Pan
 *    gestures. They are NOT coordinated with the sheet's dismiss pan via
 *    Gesture.Simultaneous / Gesture.Native / simultaneousWithExternalGesture /
 *    blocksExternalGesture. ORCH-1173 R1 tried exactly that and it failed on a
 *    physical Samsung. The sheet's dismiss pan is scoped to its own 52pt handle
 *    band (#1022, SheetMobile), which is what makes plane dragging safe.
 */

const COMPACT_SCREEN_HEIGHT = 700;
const PLANE_HEIGHT = 170;
const PLANE_HEIGHT_COMPACT = 132;
const RAIL_HEIGHT = 28;
const PLANE_THUMB = 28;
const RAIL_THUMB = 32;

type TabKey = "colour" | "font" | "motion";

export interface ThemeSheetProps {
  visible: boolean;
  onClose: () => void;
  /** The raw override. null = fully inherited. */
  value: ThemeInput | null | undefined;
  /** ONE patch per user action, derived from CURRENT state at commit time. */
  onChange: (next: ThemeInput | null) => void;
  scope: ThemeControlScope;
  brandTheme?: ThemeInput | null;
  testID?: string;
}

/** Merge one axis into the current override and normalise the empty case. */
const withAxis = (
  current: ThemeInput | null | undefined,
  axis: "color" | "font" | "animation",
  next: string | null,
): ThemeInput | null => {
  const merged: ThemeInput = {
    color: current?.color ?? null,
    font: current?.font ?? null,
    animation: current?.animation ?? null,
    [axis]: next,
  };
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
  testID,
}) => {
  const { height: screenHeight } = useWindowDimensions();
  const compact = screenHeight < COMPACT_SCREEN_HEIGHT;
  const [tab, setTab] = useState<TabKey>("colour");
  const [replayNonce, setReplayNonce] = useState(0);
  const [screenReaderOn, setScreenReaderOn] = useState(false);
  const [numericMode, setNumericMode] = useState(false);

  const recents = useThemeRecentsStore((s) => s.recents);
  const addRecent = useThemeRecentsStore((s) => s.addRecent);

  // C-1 — brandTheme FIRST. Getting this backwards is the bug that shipped.
  const resolved = useMemo(
    () =>
      scope === "brand"
        ? resolveTheme(value ?? null, null)
        : resolveTheme(brandTheme ?? null, value ?? null),
    [scope, value, brandTheme],
  );
  const palette = useMemo(() => createThemePalette(resolved), [resolved]);

  // ORCH-1083 — the ONLY useThemeFont call site in this sheet. Browsing the
  // font list loads nothing; only the SELECTED family loads, for the preview.
  useThemeFont(resolved.fontFamilyValue);

  const seedHex = value?.color ?? resolved.color;
  const hsv = useMemo(() => hexToHsv(seedHex) ?? { h: 25, s: 0.84, v: 0.92 }, [seedHex]);

  // ── screen-reader detection: the 2D plane is unusable without sight, so the
  // colour tab opens in numeric mode and hides the plane from the a11y tree.
  useEffect(() => {
    // #1022 F-3 — NEVER trust this API on web. react-native-web's
    // AccessibilityInfo.isScreenReaderEnabled() resolves `true`
    // UNCONDITIONALLY for every browser and every user
    // (react-native-web/dist/exports/AccessibilityInfo/index.js), so the
    // accessibility fallback was forcing numeric mode on 100% of web users
    // and the colour plane — the deliverable Seth approved — never rendered
    // on any browser at all. The a11y path is right; the API is not.
    // Native keeps the real detection; web users get the plane and can still
    // reach numeric mode with the keyboard toggle.
    if (Platform.OS === "web") {
      setScreenReaderOn(false);
      return;
    }
    let cancelled = false;
    void AccessibilityInfo.isScreenReaderEnabled().then((on) => {
      if (cancelled) return;
      setScreenReaderOn(on);
      if (on) setNumericMode(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── THE single colour write path ─────────────────────────────────────────
  // Plane drag, rail drag, swatch, recent, brand tap and hex commit ALL funnel
  // through here. Each call emits ONE patch derived from CURRENT state (never a
  // captured prop snapshot — that is A/F-11).
  const commitColor = useCallback(
    (hex: string): void => {
      onChange(withAxis(value, "color", hex));
    },
    [onChange, value],
  );

  const commitFont = useCallback(
    (slug: string | null): void => {
      onChange(withAxis(value, "font", slug));
    },
    [onChange, value],
  );

  const commitAnimation = useCallback(
    (slug: string | null): void => {
      onChange(withAxis(value, "animation", slug));
      setReplayNonce((n) => n + 1);
    },
    [onChange, value],
  );

  // ── hex field: the ORCH-0964 contract, reproduced exactly ────────────────
  // `hexDraft` is SEPARATE raw state and is NEVER bound to the committed
  // value. Binding it is what collapsed char-by-char typing.
  const [hexDraft, setHexDraft] = useState<string>(seedHex);
  useEffect(() => {
    setHexDraft(value?.color ?? "");
  }, [value?.color]);

  const handleHexChange = useCallback(
    (raw: string): void => {
      setHexDraft(raw);
      const normalized = normalizeHexColor(raw);
      if (normalized !== null) commitColor(normalized);
    },
    [commitColor],
  );

  const handleHexBlur = useCallback((): void => {
    // Short hex (#f80) expands HERE and only here — never on keystroke, where
    // it would commit "#FF1" while someone is typing "#FF1493".
    const expanded = normalizeHexColorOnBlur(hexDraft);
    if (expanded === null) {
      setHexDraft(value?.color ?? "");
      return;
    }
    commitColor(expanded);
    addRecent(expanded);
  }, [hexDraft, value?.color, commitColor, addRecent]);

  const pickSwatch = useCallback(
    (hex: string): void => {
      commitColor(hex);
      addRecent(hex);
    },
    [commitColor, addRecent],
  );

  // ── plane + rail gestures (NO coordination with the sheet pan) ───────────
  // #1022 F-5 — the measured widths MUST live in state. Reading them from a
  // ref meant the first painted frame used width 1, so both thumbs opened
  // clipped at the far-left edge (left = 0.84*1 - 14 = -13.2) while the
  // committed colour was something else entirely — the control opened telling
  // the user their colour was something it was not. A ref assignment schedules
  // no re-render, so nothing ever corrected it until an unrelated state change
  // happened to repaint.
  const [planeWidth, setPlaneWidth] = useState(0);
  const [railWidth, setRailWidth] = useState(0);
  const planeHeight = compact ? PLANE_HEIGHT_COMPACT : PLANE_HEIGHT;

  const applyPlane = useCallback(
    (x: number, y: number): void => {
      const s = Math.min(1, Math.max(0, x / Math.max(1, planeWidth)));
      const v = 1 - Math.min(1, Math.max(0, y / Math.max(1, planeHeight)));
      commitColor(hsvToHex({ h: hsv.h, s, v }));
    },
    [commitColor, hsv.h, planeHeight, planeWidth],
  );

  const applyRail = useCallback(
    (x: number): void => {
      const ratioX = Math.min(1, Math.max(0, x / Math.max(1, railWidth)));
      commitColor(hsvToHex({ h: ratioX * 360, s: hsv.s, v: hsv.v }));
    },
    [commitColor, hsv.s, hsv.v, railWidth],
  );

  const planeGesture = useMemo(
    () =>
      Gesture.Pan()
        .onBegin((e) => applyPlane(e.x, e.y))
        .onUpdate((e) => applyPlane(e.x, e.y))
        .runOnJS(true),
    [applyPlane],
  );

  const railGesture = useMemo(
    () =>
      Gesture.Pan()
        .onBegin((e) => applyRail(e.x))
        .onUpdate((e) => applyRail(e.x))
        .runOnJS(true),
    [applyRail],
  );

  const snapPoint = compact ? 0.9 : 0.86;

  const colourInherited = themeAxisIsInherited(value, "color");
  const fontInherited = themeAxisIsInherited(value, "font");
  const motionInherited = themeAxisIsInherited(value, "animation");

  const resetLabel =
    tab === "colour" ? "Reset colour" : tab === "font" ? "Reset font" : "Reset motion";
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
        <Text style={[styles.previewEyebrow, { color: palette.accent }]}>
          SAT 12 JUL · 8:00 PM
        </Text>
        <Text
          style={[
            styles.previewTitle,
            { color: palette.primaryText, fontFamily: boldFontFamily(resolved) },
          ]}
          numberOfLines={1}
        >
          Rooftop Sessions
        </Text>
        <View style={[styles.previewCta, { backgroundColor: palette.accent }]}>
          <Text style={styles.previewCtaLabel}>Get tickets</Text>
        </View>
        <View style={styles.previewOverlay} pointerEvents="none">
          <ThemeEntranceAnimation
            theme={resolved}
            sessionKey={`theme-picker:${resolved.animation}:${replayNonce}`}
            replayOnMount={true}
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
      <ScrollView
        style={styles.bodyScroll}
        contentContainerStyle={styles.bodyContent}
        keyboardShouldPersistTaps="handled"
        testID={testID !== undefined ? `${testID}-body-scroll` : undefined}
      >
        {tab === "colour" ? (
          <View style={styles.tabBody}>
            {!numericMode ? (
              <>
                <WebSafeGestureDetector gesture={planeGesture}>
                  <View
                    style={[styles.plane, { height: planeHeight }]}
                    onLayout={(e) => setPlaneWidth(e.nativeEvent.layout.width)}
                    accessibilityElementsHidden={screenReaderOn}
                    importantForAccessibility={
                      screenReaderOn ? "no-hide-descendants" : "auto"
                    }
                  >
                    <View
                      style={[
                        StyleSheet.absoluteFill,
                        { backgroundColor: `hsl(${Math.round(hsv.h)}, 100%, 50%)` },
                      ]}
                    />
                    <LinearGradient
                      colors={["#ffffff", "rgba(255,255,255,0)"]}
                      start={{ x: 0, y: 0.5 }}
                      end={{ x: 1, y: 0.5 }}
                      style={StyleSheet.absoluteFill}
                    />
                    <LinearGradient
                      colors={["rgba(0,0,0,0)", "#000000"]}
                      start={{ x: 0.5, y: 0 }}
                      end={{ x: 0.5, y: 1 }}
                      style={StyleSheet.absoluteFill}
                    />
                    {planeWidth > 0 ? (
                    <View
                      pointerEvents="none"
                      style={[
                        styles.planeThumb,
                        {
                          left: hsv.s * planeWidth - PLANE_THUMB / 2,
                          top: (1 - hsv.v) * planeHeight - PLANE_THUMB / 2,
                          backgroundColor: seedHex,
                        },
                      ]}
                    />
                    ) : null}
                  </View>
                </WebSafeGestureDetector>

                <WebSafeGestureDetector gesture={railGesture}>
                  <View
                    style={styles.rail}
                    onLayout={(e) => setRailWidth(e.nativeEvent.layout.width)}
                    accessibilityElementsHidden={screenReaderOn}
                    importantForAccessibility={
                      screenReaderOn ? "no-hide-descendants" : "auto"
                    }
                  >
                    <LinearGradient
                      colors={[
                        "#ff0000",
                        "#ffff00",
                        "#00ff00",
                        "#00ffff",
                        "#0000ff",
                        "#ff00ff",
                        "#ff0000",
                      ]}
                      start={{ x: 0, y: 0.5 }}
                      end={{ x: 1, y: 0.5 }}
                      style={[StyleSheet.absoluteFill, { borderRadius: radius.full }]}
                    />
                    {railWidth > 0 ? (
                    <View
                      pointerEvents="none"
                      style={[
                        styles.railThumb,
                        {
                          left: (hsv.h / 360) * railWidth - RAIL_THUMB / 2,
                          backgroundColor: `hsl(${Math.round(hsv.h)}, 100%, 50%)`,
                        },
                      ]}
                    />
                    ) : null}
                  </View>
                </WebSafeGestureDetector>
              </>
            ) : (
              // Numeric mode — the 2D-plane accessibility answer. Hue is
              // announced with a COLOUR NAME, not just a number.
              <View style={styles.numericBlock}>
                {(
                  [
                    ["Hue", `${Math.round(hsv.h)} degrees, ${hueName(hsv)}`, "h"],
                    ["Saturation", `${Math.round(hsv.s * 100)} percent`, "s"],
                    ["Lightness", `${Math.round(hsv.v * 100)} percent`, "v"],
                  ] as const
                ).map(([label, valueText, axis]) => (
                  <View
                    key={axis}
                    style={styles.numericRow}
                    accessibilityRole="adjustable"
                    accessibilityLabel={label}
                    accessibilityValue={{ text: valueText }}
                    accessibilityActions={[
                      { name: "increment" },
                      { name: "decrement" },
                    ]}
                    onAccessibilityAction={(e) => {
                      const dir = e.nativeEvent.actionName === "increment" ? 1 : -1;
                      const next =
                        axis === "h"
                          ? { ...hsv, h: (hsv.h + dir + 360) % 360 }
                          : axis === "s"
                            ? { ...hsv, s: Math.min(1, Math.max(0, hsv.s + dir * 0.01)) }
                            : { ...hsv, v: Math.min(1, Math.max(0, hsv.v + dir * 0.01)) };
                      commitColor(hsvToHex(next));
                    }}
                  >
                    <Text style={styles.numericLabel}>{label}</Text>
                    <Text style={styles.numericValue}>{valueText}</Text>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.hexRow}>
              <TextInput
                value={hexDraft}
                onChangeText={handleHexChange}
                onBlur={handleHexBlur}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                autoComplete="off"
                maxLength={7}
                placeholder="#eb7825"
                placeholderTextColor={textTokens.quaternary}
                accessibilityLabel="Hex colour code"
                style={styles.hexInput}
              />
              <Pressable
                onPress={() => setNumericMode((m) => !m)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={
                  numericMode ? "Switch to colour plane" : "Switch to numeric colour entry"
                }
                style={styles.numericToggle}
              >
                <Text style={styles.numericToggleLabel}>⌨</Text>
              </Pressable>
            </View>

            {/* Swatch strip — brand · recents · presets */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.swatchStrip}
              keyboardShouldPersistTaps="handled"
            >
              {scope === "offering" && brandTheme?.color ? (
                <>
                  <SwatchDot
                    hex={brandTheme.color}
                    selected={
                      (value?.color ?? "").toLowerCase() ===
                      brandTheme.color.toLowerCase()
                    }
                    label="Use my brand colour"
                    onPress={() => pickSwatch(brandTheme.color as string)}
                  />
                  <View style={styles.swatchDivider} />
                </>
              ) : null}

              {recents.map((hex) => (
                <SwatchDot
                  key={`recent-${hex}`}
                  hex={hex}
                  selected={(value?.color ?? "").toLowerCase() === hex.toLowerCase()}
                  label={`Recent ${presetForHex(hex)?.name ?? hex}`}
                  onPress={() => pickSwatch(hex)}
                />
              ))}
              {recents.length > 0 ? <View style={styles.swatchDivider} /> : null}

              {THEME_PRESETS.map((preset) => (
                <SwatchDot
                  key={preset.hex}
                  hex={preset.hex}
                  selected={
                    (value?.color ?? "").toLowerCase() === preset.hex.toLowerCase()
                  }
                  label={`${preset.name}, ${preset.colorWord}`}
                  onPress={() => pickSwatch(preset.hex)}
                />
              ))}
            </ScrollView>
          </View>
        ) : null}

        {tab === "font" ? (
          <View style={styles.tabBody}>
            <Pressable
              onPress={() => commitFont(null)}
              style={[styles.fontRow, fontInherited ? styles.fontRowSelected : null]}
              accessibilityRole="button"
              accessibilityState={{ selected: fontInherited }}
              accessibilityLabel={`${scope === "brand" ? "Mingla" : "Brand"} default font`}
            >
              <Text style={styles.fontRowLabel}>
                {scope === "brand" ? "Mingla default" : "Brand default"}
                {" — "}
                {FONT_SPECIMENS[resolved.font]?.label ?? resolved.font}
              </Text>
              {fontInherited ? <Icon name="check" size={16} color={accent.warm} /> : null}
            </Pressable>

            {FONT_GROUPS.map((group) => (
              <View key={group.label}>
                <Text style={styles.groupHeader}>{group.label}</Text>
                {group.slugs.map((slug) => {
                  const spec = FONT_SPECIMENS[slug];
                  if (spec === undefined) return null;
                  const selected = !fontInherited && value?.font === slug;
                  return (
                    <Pressable
                      key={slug}
                      onPress={() => commitFont(slug)}
                      style={[styles.fontRow, selected ? styles.fontRowSelected : null]}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={spec.accessibilityLabel}
                    >
                      {/* NOTE: `spec.style` never sets fontFamily — browsing
                          this list loads ZERO typefaces (ORCH-1083). */}
                      <Text style={[styles.fontSpecimen, spec.style]} numberOfLines={1}>
                        {spec.label}
                      </Text>
                      <Text style={styles.fontDescriptor}>{spec.descriptor}</Text>
                      {selected ? (
                        <Icon name="check" size={16} color={accent.warm} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        ) : null}

        {tab === "motion" ? (
          <View style={styles.tabBody}>
            {Platform.OS === "web" ? (
              <View style={styles.webBanner}>
                <Text style={styles.webBannerText}>
                  Entrance motion plays in the Mingla apps. Shared web links don&apos;t
                  show it yet.
                </Text>
              </View>
            ) : null}

            <View style={styles.motionGrid}>
              {ALL_ANIMATION_SLUGS.map((slug) => {
                const selected = motionInherited
                  ? false
                  : (value?.animation ?? null) === slug;
                return (
                  <Pressable
                    key={slug}
                    onPress={() => commitAnimation(slug)}
                    style={[styles.motionTile, selected ? styles.motionTileSelected : null]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={MOTION_DISPLAY_NAMES[slug] ?? slug}
                  >
                    {/* STATIC poster only. Exactly ONE Lottie instance is ever
                        alive, and it lives in the preview band above — 10
                        looping tiles would be a battery and jank disaster. */}
                    <Text style={styles.motionTileLabel} numberOfLines={1}>
                      {slug === "none" ? "— No motion" : MOTION_DISPLAY_NAMES[slug]}
                    </Text>
                    <Text style={styles.motionTileHint}>
                      {slug === "none" ? "" : "Play once"}
                    </Text>
                    {selected ? (
                      <View style={styles.motionCheck}>
                        <Icon name="check" size={16} color={accent.warm} />
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}
      </ScrollView>

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

const SwatchDot: React.FC<{
  hex: string;
  selected: boolean;
  label: string;
  onPress: () => void;
}> = ({ hex, selected, label, onPress }) => (
  <Pressable
    onPress={onPress}
    hitSlop={4}
    accessibilityRole="button"
    accessibilityState={{ selected }}
    accessibilityLabel={label}
    style={[styles.swatch, { backgroundColor: hex }, selected ? styles.swatchSelected : null]}
  >
    {/* Selection is not colour-only — a check in a readable colour rides on top. */}
    {selected ? <Icon name="check" size={14} color={readableTextFor(hex)} /> : null}
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
  plane: { width: "100%", borderRadius: radius.md, overflow: "hidden" },
  planeThumb: {
    position: "absolute",
    width: PLANE_THUMB,
    height: PLANE_THUMB,
    borderRadius: PLANE_THUMB / 2,
    borderWidth: 3,
    borderColor: "#ffffff",
  },
  rail: {
    width: "100%",
    height: RAIL_HEIGHT,
    borderRadius: radius.full,
    justifyContent: "center",
  },
  railThumb: {
    position: "absolute",
    width: RAIL_THUMB,
    height: RAIL_THUMB,
    borderRadius: RAIL_THUMB / 2,
    borderWidth: 3,
    borderColor: "#ffffff",
    top: (RAIL_HEIGHT - RAIL_THUMB) / 2,
  },
  numericBlock: { gap: spacing.sm },
  numericRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: glass.tint.profileBase,
  },
  numericLabel: { fontSize: 14, fontWeight: "600", color: textTokens.secondary },
  numericValue: { fontSize: 13, color: textTokens.tertiary },
  hexRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  hexInput: {
    width: 132,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    color: textTokens.primary,
    paddingHorizontal: spacing.sm,
    fontSize: 14,
  },
  numericToggle: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  numericToggleLabel: { fontSize: 16, color: textTokens.tertiary },
  swatchStrip: { alignItems: "center", gap: spacing.sm, paddingVertical: 2 },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  swatchSelected: { borderWidth: 3, borderColor: "#ffffff" },
  swatchDivider: {
    width: 1,
    height: 20,
    backgroundColor: glass.border.profileBase,
    marginHorizontal: 2,
  },
  fontRow: {
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  fontRowSelected: { backgroundColor: accent.tint },
  fontRowLabel: { flex: 1, fontSize: 14, fontWeight: "600", color: textTokens.primary },
  fontSpecimen: { flex: 1, fontSize: 18, color: textTokens.primary },
  fontDescriptor: { fontSize: 11, color: textTokens.quaternary },
  groupHeader: {
    ...typography.labelCap,
    textTransform: "uppercase",
    color: textTokens.tertiary,
    paddingTop: spacing.md,
    paddingBottom: 6,
  },
  webBanner: {
    minHeight: 36,
    borderRadius: radius.md,
    backgroundColor: "rgba(59,130,246,0.15)",
    paddingHorizontal: spacing.sm,
    justifyContent: "center",
  },
  webBannerText: { fontSize: 12, lineHeight: 16, color: textTokens.secondary },
  motionGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
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
  motionTileHint: { fontSize: 11, color: textTokens.quaternary },
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

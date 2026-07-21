import React, { useMemo } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import type { ThemeInput } from "@mingla/offering-rendering";
import { createThemePalette } from "../../../../packages/offering-rendering/themePalette";
import { resolveTheme } from "../../../../packages/offering-rendering/themeResolver";

import {
  androidOpaque,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { themeAxisIsInherited } from "../../services/offeringTheme";
import { Icon } from "../ui/Icon";
import { Skeleton } from "../ui/Skeleton";
import { themeValueLine, type ThemeControlScope } from "./themeColorModel";

/**
 * #1022 — the collapsed Theme row.
 *
 * Replaces the ~420-500pt inline ThemeEditorSection with a 56pt row that opens
 * a Sheet. Mounted at six places: the four create wizards, the Review/Preview
 * steps, EditPublishedScreen and BrandEditView.
 *
 * WIDTH-AGNOSTIC BY CONTRACT. The row renders at 342pt in the create wizards,
 * 358pt on BrandEditView and 310pt on EditPublishedScreen (C-10). Nothing here
 * may assume a width: the text block is `flex: 1` and truncates tail-first. On
 * wide desktop it SELF-CAPS at 560pt rather than relying on a desktop shell,
 * because neither edit surface has one (C-9).
 *
 * THE CHIP SHOWS THE DERIVED PALETTE, NEVER THE SEED. createThemePalette
 * transforms a seed substantially — #eb7825 becomes accent #ae591c on page
 * #1e120d; #16a34a produces a LIGHT page. A chip painted with the raw hex
 * would lie about what the guest sees.
 */

export type { ThemeControlScope };
export type BrandThemeStatus = "loading" | "error" | "ready";

export interface ThemeControlRowProps {
  /** The offering's (or brand's) raw override. null = fully inherited. */
  value: ThemeInput | null | undefined;
  /** ONE patch per user action. */
  onChange: (next: ThemeInput | null) => void;
  scope: ThemeControlScope;
  /** Required when scope==="offering". Null while loading or on error. */
  brandTheme?: ThemeInput | null;
  brandThemeStatus?: BrandThemeStatus;
  /** "review" swaps the chevron for the word "Edit". */
  variant?: "row" | "review";
  /** Trip Step 1 passes `submitting` (B-13). Default false. */
  disabled?: boolean;
  /** Opens the sheet. The row never owns sheet visibility itself. */
  onPress: () => void;
  testID?: string;
}

const ROW_HEIGHT = 56;
const DESKTOP_MAX_WIDTH = 560;

export const ThemeControlRow: React.FC<ThemeControlRowProps> = ({
  value,
  scope,
  brandTheme,
  brandThemeStatus = "ready",
  variant = "row",
  disabled = false,
  onPress,
  testID,
}) => {
  const { isWideDesktop } = useResponsiveLayout();
  const isAndroid = Platform.OS === "android";
  const isLoading = brandThemeStatus === "loading";
  const isError = brandThemeStatus === "error";

  // The DERIVED palette — what the guest actually sees.
  const palette = useMemo(() => {
    const resolved =
      scope === "brand"
        ? resolveTheme(value ?? null, null)
        : resolveTheme(brandTheme ?? null, value ?? null);
    return createThemePalette(resolved);
  }, [scope, value, brandTheme]);

  const valueLine = useMemo(
    () => themeValueLine(value, scope, brandTheme),
    [value, scope, brandTheme],
  );

  const accessibilityValueText = isError
    ? "Mingla default"
    : valueLine.replace(/ · /g, ", ");

  return (
    <Pressable
      testID={testID}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel="Theme"
      accessibilityValue={{ text: accessibilityValueText }}
      accessibilityHint="Opens colour, font and motion options"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.row,
        isAndroid ? styles.rowAndroid : styles.rowGlass,
        isWideDesktop ? styles.rowDesktopCap : null,
        // Press feedback: fill lighten + a 0.985 scale, never a layout shift.
        pressed && !disabled
          ? isAndroid
            ? styles.rowPressedAndroid
            : styles.rowPressed
          : null,
        disabled ? styles.rowDisabled : null,
      ]}
    >
      {isLoading ? (
        <Skeleton width={32} height={32} radius="md" />
      ) : (
        <View
          style={[
            styles.chip,
            { backgroundColor: palette.page, borderColor: palette.panelBorder },
          ]}
        >
          <View style={[styles.chipDot, { backgroundColor: palette.accent }]} />
        </View>
      )}

      <View style={styles.textBlock}>
        <Text style={styles.title} numberOfLines={1}>
          Theme
        </Text>
        {isLoading ? (
          <Skeleton width={160} height={12} radius="sm" />
        ) : (
          <View style={styles.valueRow}>
            {isError ? <View style={styles.warningDot} /> : null}
            <Text style={styles.value} numberOfLines={1} ellipsizeMode="tail">
              {isError ? "Mingla default" : valueLine}
            </Text>
          </View>
        )}
      </View>

      {variant === "review" ? (
        <Text style={styles.editWord}>Edit</Text>
      ) : (
        <Icon name="chevR" size={16} color={textTokens.quaternary} />
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  row: {
    height: ROW_HEIGHT,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
  },
  // iOS / Web — translucent glass.
  rowGlass: {
    backgroundColor: glass.tint.profileBase,
    borderColor: glass.border.profileBase,
  },
  // Android — opaque composites, and NO elevation under a rounded fill
  // (ANDROID_GLASS_USES_OPAQUE_FALLBACK).
  rowAndroid: {
    backgroundColor: androidOpaque.rowFill,
    borderColor: androidOpaque.rowBorder,
    elevation: 0,
  },
  rowPressed: {
    backgroundColor: "rgba(255, 255, 255, 0.07)",
    transform: [{ scale: 0.985 }],
  },
  rowPressedAndroid: {
    backgroundColor: "#1a1d21",
    transform: [{ scale: 0.985 }],
  },
  rowDisabled: {
    opacity: 0.5,
  },
  // C-9 — neither edit surface has a desktopFormPane to inherit from, so the
  // row caps itself rather than a desktop shell being retrofitted.
  rowDesktopCap: {
    maxWidth: DESKTOP_MAX_WIDTH,
    alignSelf: "flex-start",
  },
  chip: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  chipDot: {
    width: 16,
    height: 16,
    borderRadius: 5,
  },
  textBlock: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    color: textTokens.secondary,
  },
  valueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  value: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "500",
    color: textTokens.tertiary,
  },
  warningDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#f59e0b",
  },
  editWord: {
    ...typography.labelCap,
    color: textTokens.secondary,
  },
});

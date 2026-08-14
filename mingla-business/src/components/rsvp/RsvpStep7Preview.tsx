/**
 * ORCH-1150 — RSVP Preview step (clone of CreatorStep7Preview, money-free).
 *
 * Renders the RSVP public-page mini preview (Going / Not going framing). NO
 * StripeBlockedCard, NO money surfaces, NO onConnectStripe (RSVP is moneyless).
 * Readiness = validateRsvpPublish(draft).length === 0.
 *
 * See SPEC §4.3 (Preview row).
 */

import React, { useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { type Brand } from "../../store/currentBrandStore";
import { validateRsvpPublish } from "../../utils/draftRsvpValidation";
import {
  formatDraftDateLine,
  formatDraftDateSubline,
} from "../../utils/eventDateDisplay";

import { EventCoverMedia } from "../ui/EventCoverMedia";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { TurnoutGateSection } from "../intel/TurnoutGateSection";
import { useMemo as useThemeMemo } from "react";

import { createThemePalette } from "../../../../packages/offering-rendering/themePalette";
import { resolveTheme } from "../../../../packages/offering-rendering/themeResolver";
import { ThemeControlRow } from "../theme/ThemeControlRow";
import { ThemeSheet } from "../theme/ThemeSheet";
import { type StepBodyProps } from "../event/types";

interface RsvpStep7PreviewProps extends StepBodyProps {
  brand: Brand | null;
  onTapMiniCard: () => void;
}

export const RsvpStep7Preview: React.FC<RsvpStep7PreviewProps> = ({
  draft,
  updateDraft,
  brand,
  onTapMiniCard,
}) => {
  const errors = validateRsvpPublish(draft);
  const isReady = errors.length === 0;

  const handleMiniCardPress = useCallback((): void => {
    onTapMiniCard();
  }, [onTapMiniCard]);

  const dateLine = formatDraftDateLine(draft);
  const subline = formatDraftDateSubline(draft);
  const titleLine = draft.name.length > 0 ? draft.name : "Untitled RSVP";
  const venueLine =
    draft.format === "online" ? "Online" : draft.venueName ?? "Set a location in Step 3";

  // #1022 A/F-12 — this preview was THEME-BLIND (accent.warm unconditionally),
  // so a review row would have advertised a theme the preview could not show.
  const brandTheme = brand?.theme ?? null;
  const themePalette = useThemeMemo(
    () => createThemePalette(resolveTheme(brandTheme, draft.themeOverrides ?? null)),
    [brandTheme, draft.themeOverrides],
  );
  const [themeSheetOpen, setThemeSheetOpen] = React.useState(false);
  const handleThemeChange = useCallback(
    (next: Parameters<typeof updateDraft>[0]["themeOverrides"]): void => {
      updateDraft({ themeOverrides: next });
    },
    [updateDraft],
  );

  return (
    <View>
      <TurnoutGateSection />
      {/* #1022 — second touchpoint before publishing. */}
      <ThemeControlRow
        value={draft.themeOverrides}
        onChange={handleThemeChange}
        scope="offering"
        brandTheme={brandTheme}
        variant="review"
        onPress={() => setThemeSheetOpen(true)}
        testID="rsvp-review-theme-row"
      />

      {/* Mini RSVP card */}
      <Pressable
        onPress={handleMiniCardPress}
        accessibilityRole="button"
        accessibilityLabel="Preview public page"
        style={[styles.miniCard, { backgroundColor: themePalette.page }]}
      >
        <View style={styles.miniCover}>
          <EventCoverMedia
            hue={draft.coverHue}
            mediaUrl={draft.coverMediaUrl}
            mediaType={draft.coverMediaType}
            radius={0}
            label=""
            height={140}
          />
        </View>
        <View style={styles.miniBody}>
          <Text style={[styles.miniDate, { color: themePalette.accent }]}>{dateLine}</Text>
          <Text
            style={[styles.miniTitle, { color: themePalette.primaryText }]}
            numberOfLines={1}
          >
            {titleLine}
          </Text>
          <Text style={styles.miniVenue} numberOfLines={1}>
            {venueLine}
          </Text>
          {subline !== null ? (
            <View style={styles.recurrencePillRow}>
              <View style={styles.recurrencePill}>
                <Text style={styles.recurrencePillLabel}>{subline}</Text>
              </View>
            </View>
          ) : null}
          {/* Going / Not-going CTA preview (non-interactive) */}
          <View style={styles.ctaRow}>
            <View style={[styles.ctaBtn, styles.ctaGoing]}>
              <Text style={styles.ctaGoingLabel}>Going</Text>
            </View>
            <View style={[styles.ctaBtn, styles.ctaNotGoing]}>
              <Text style={styles.ctaNotGoingLabel}>Not going</Text>
            </View>
          </View>
        </View>
      </Pressable>

      {/* Status card (money-free) */}
      <View style={styles.statusCardWrap}>
        {isReady ? (
          <GlassCard variant="base" padding={spacing.md}>
            <View style={styles.statusRow}>
              <Icon name="check" size={20} color={semantic.success} />
              <View style={styles.statusTextCol}>
                <Text style={styles.statusTitle}>Ready to publish</Text>
                <Text style={styles.statusSub}>
                  Your invite link goes live immediately. Guests can RSVP right away.
                </Text>
              </View>
            </View>
          </GlassCard>
        ) : (
          <GlassCard variant="base" padding={spacing.md} style={styles.warnCard}>
            <View style={styles.statusRow}>
              <Icon name="flag" size={20} color={accent.warm} />
              <View style={styles.statusTextCol}>
                <Text style={styles.statusTitle}>
                  {errors.length === 1 ? "1 thing to fix" : `${errors.length} things to fix`}
                </Text>
                <Text style={styles.statusSub}>Tap Publish to see what is missing.</Text>
              </View>
            </View>
          </GlassCard>
        )}
      </View>

      <Pressable
        onPress={handleMiniCardPress}
        accessibilityRole="button"
        accessibilityLabel="Preview public page"
        style={styles.previewLinkBtn}
      >
        <Icon name="eye" size={16} color={accent.warm} />
        <Text style={styles.previewLinkLabel}>Preview public page</Text>
      </Pressable>
      <ThemeSheet
        visible={themeSheetOpen}
        onClose={() => setThemeSheetOpen(false)}
        value={draft.themeOverrides}
        onChange={handleThemeChange}
        scope="offering"
        brandTheme={brandTheme}
        testID="rsvp-review-theme-sheet"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  miniCard: {
    borderRadius: radiusTokens.lg,
    overflow: "hidden",
    backgroundColor: glass.tint.profileElevated,
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
    marginBottom: spacing.md,
  },
  miniCover: { height: 140, width: "100%" },
  miniBody: { padding: spacing.md },
  miniDate: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: accent.warm,
    marginBottom: 4,
  },
  miniTitle: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.2,
    color: textTokens.primary,
  },
  miniVenue: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
    marginTop: 2,
  },
  recurrencePillRow: { flexDirection: "row", marginTop: spacing.xs },
  recurrencePill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
  },
  recurrencePillLabel: {
    fontSize: typography.caption.fontSize,
    fontWeight: "600",
    color: accent.warm,
  },
  ctaRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  ctaBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radiusTokens.md,
    alignItems: "center",
  },
  ctaGoing: { backgroundColor: accent.warm },
  ctaGoingLabel: { fontSize: typography.bodySm.fontSize, fontWeight: "700", color: "#fff" },
  ctaNotGoing: {
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  ctaNotGoingLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.secondary,
  },
  statusCardWrap: { marginBottom: spacing.sm },
  previewLinkBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  previewLinkLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: accent.warm,
  },
  statusRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  statusTextCol: { flex: 1 },
  statusTitle: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  statusSub: {
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
    marginTop: 2,
    lineHeight: typography.caption.lineHeight * 1.4,
  },
  warnCard: { borderColor: accent.border, borderWidth: 1 },
});

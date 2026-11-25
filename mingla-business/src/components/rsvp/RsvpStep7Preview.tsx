/**
 * ORCH-1150 — RSVP Preview step (clone of CreatorStep7Preview, money-free).
 *
 * Renders the RSVP public-page mini preview (Going / Not going framing). NO
 * StripeBlockedCard, NO money surfaces, NO onConnectStripe (RSVP is moneyless).
 * Readiness = validateRsvpPublish(draft).length === 0.
 *
 * See SPEC §4.3 (Preview row).
 */

import React, { useCallback, useMemo as useThemeMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  radius as radiusTokens,
  color,
  space,
  type,
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
import { createThemePalette } from "../../../../packages/offering-rendering/themePalette";
import { resolveTheme } from "../../../../packages/offering-rendering/themeResolver";
import { ThemeControlRow } from "../theme/ThemeControlRow";
import { ThemeSheet } from "../theme/ThemeSheetLazy";
import { buildDraftThemePreview } from "../theme/themePreviewContent";
import { themedPreviewCardColors } from "../theme/themedPreviewCardColors";
import { type StepBodyProps } from "../event/types";

// #1742 / ORCH-1083 — Review intelligence is an on-demand surface, not boot UI.
const LazyTurnoutGateSection = React.lazy(async () => {
  const module = await import("../intel/PrePublishIntelligenceSurfaces");
  return { default: module.TurnoutGateSection };
});

interface RsvpStep7PreviewProps extends StepBodyProps {
  brand: Brand | null;
  onTapMiniCard: () => void;
}

export const RsvpStep7Preview: React.FC<RsvpStep7PreviewProps> = ({
  draft,
  updateDraft,
  brand,
  onTapMiniCard,
  atVenue = false,
}) => {
  const errors = validateRsvpPublish(draft, { atVenue });
  const isReady = errors.length === 0;

  const handleMiniCardPress = useCallback((): void => {
    onTapMiniCard();
  }, [onTapMiniCard]);

  const dateLine = formatDraftDateLine(draft);
  const subline = formatDraftDateSubline(draft);
  const titleLine = draft.name.length > 0 ? draft.name : "Untitled RSVP";
  const venueLine =
    draft.format === "online" ? "Online" : draft.venueName ?? "Set a location in Step 3";

  // #1022 A/F-12 — this preview was THEME-BLIND (color.accent unconditionally),
  // so a review row would have advertised a theme the preview could not show.
  const brandTheme = brand?.theme ?? null;
  const themePalette = useThemeMemo(
    () => createThemePalette(resolveTheme(brandTheme, draft.themeOverrides ?? null)),
    [brandTheme, draft.themeOverrides],
  );
  // The card paints the THEMED page as its surface, so every text on it must
  // come from the palette too — never the dark app-chrome text tokens, which
  // are near-white and vanish on a light theme. See themedPreviewCardColors.
  const card = useThemeMemo(
    () => themedPreviewCardColors(themePalette),
    [themePalette],
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
      <React.Suspense fallback={null}>
        <LazyTurnoutGateSection />
      </React.Suspense>
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
        style={[
          styles.miniCard,
          { backgroundColor: card.surface, borderColor: card.border },
        ]}
        testID="rsvp-preview-mini-card"
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
          <Text style={[styles.miniDate, { color: card.dateText }]}>{dateLine}</Text>
          <Text
            style={[styles.miniTitle, { color: card.titleText }]}
            numberOfLines={1}
          >
            {titleLine}
          </Text>
          <Text
            style={[styles.miniVenue, { color: card.venueText }]}
            numberOfLines={1}
          >
            {venueLine}
          </Text>
          {subline !== null ? (
            <View style={styles.recurrencePillRow}>
              <View
                style={[
                  styles.recurrencePill,
                  { backgroundColor: card.pillFill, borderColor: card.pillBorder },
                ]}
              >
                <Text style={[styles.recurrencePillLabel, { color: card.pillText }]}>
                  {subline}
                </Text>
              </View>
            </View>
          ) : null}
          {/* Going / Not-going CTA preview (non-interactive) */}
          <View style={styles.ctaRow}>
            <View
              style={[
                styles.ctaBtn,
                card.goingFillStyle,
              ]}
            >
              <Text style={[styles.ctaGoingLabel, { color: card.goingText }]}>
                Going
              </Text>
            </View>
            <View
              style={[
                styles.ctaBtn,
                {
                  backgroundColor: card.notGoingFill,
                  borderColor: card.notGoingBorder,
                },
              ]}
            >
              <Text style={[styles.ctaNotGoingLabel, { color: card.notGoingText }]}>
                Not going
              </Text>
            </View>
          </View>
        </View>
      </Pressable>

      {/* Status card (money-free) */}
      <View style={styles.statusCardWrap}>
        {isReady ? (
          <GlassCard variant="base" padding={space[4]}>
            <View style={styles.statusRow}>
              <Icon name="check" size={20} color={color.success} />
              <View style={styles.statusTextCol}>
                <Text style={styles.statusTitle}>Ready to publish</Text>
                <Text style={styles.statusSub}>
                  Your invite link goes live immediately. Guests can RSVP right away.
                </Text>
              </View>
            </View>
          </GlassCard>
        ) : (
          <GlassCard variant="base" padding={space[4]} style={styles.warnCard}>
            <View style={styles.statusRow}>
              <Icon name="flag" size={20} color={color.accent} />
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
        <Icon name="eye" size={16} color={color.accent} />
        <Text style={styles.previewLinkLabel}>Preview public page</Text>
      </Pressable>
      <ThemeSheet
        visible={themeSheetOpen}
        onClose={() => setThemeSheetOpen(false)}
        value={draft.themeOverrides}
        onChange={handleThemeChange}
        scope="offering"
        brandTheme={brandTheme}
        preview={buildDraftThemePreview(draft)}
        testID="rsvp-review-theme-sheet"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  // Colours for miniCard and everything inside it are applied inline from
  // themedPreviewCardColors — the card sits on the THEMED surface.
  miniCard: {
    borderRadius: radiusTokens.lg,
    overflow: "hidden",
    borderWidth: 1,
    marginBottom: space[4],
  },
  miniCover: { height: 140, width: "100%" },
  miniBody: { padding: space[4] },
  miniDate: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  miniTitle: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  miniVenue: {
    fontSize: type.small.fontSize,
    marginTop: 2,
  },
  recurrencePillRow: { flexDirection: "row", marginTop: space[1] },
  recurrencePill: {
    paddingHorizontal: space[2],
    paddingVertical: 4,
    borderRadius: 999,
    overflow: "hidden",
    borderWidth: 1,
  },
  recurrencePillLabel: {
    fontSize: type.caption.fontSize,
    fontWeight: "600",
  },
  ctaRow: { flexDirection: "row", gap: space[2], marginTop: space[4] },
  ctaBtn: {
    flex: 1,
    paddingVertical: space[2],
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    alignItems: "center",
  },
  ctaGoingLabel: { fontSize: type.small.fontSize, fontWeight: "700" },
  ctaNotGoingLabel: {
    fontSize: type.small.fontSize,
    fontWeight: "600",
  },
  statusCardWrap: { marginBottom: space[2] },
  previewLinkBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[1],
    paddingVertical: space[4],
    paddingHorizontal: space[4],
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  previewLinkLabel: {
    fontSize: type.small.fontSize,
    fontWeight: "600",
    color: color.accent,
  },
  statusRow: { flexDirection: "row", alignItems: "flex-start", gap: space[2] },
  statusTextCol: { flex: 1 },
  statusTitle: {
    fontSize: type.small.fontSize,
    fontWeight: "600",
    color: color.text1,
  },
  statusSub: {
    fontSize: type.caption.fontSize,
    color: color.text2,
    marginTop: 2,
    lineHeight: type.caption.lineHeight * 1.4,
  },
  warnCard: { borderColor: color.accentLine, borderWidth: 1 },
});

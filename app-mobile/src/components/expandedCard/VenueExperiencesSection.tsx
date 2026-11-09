import React, { useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
} from "react-native";

import { Icon } from "../ui/Icon";
import { hueFromId } from "../../utils/hueFromId";
import { isVideoUrl } from "../../utils/videoUrl";
import {
  useVenueExperiences,
  type VenueExperienceRow,
} from "../../hooks/useVenueExperiences";
import {
  posterFor,
  formatExperiencePrice,
  experienceToBusinessEventCard,
} from "../../utils/venueExperienceMapping";
import type { BusinessEventCard } from "../../types/mergedDiscover";
import { useTranslation } from "react-i18next";
import { formatDisplayPrice } from "../utils/formatters";
import { SPINE } from "./spineTokens";
import type { WhenColors } from "../venuePage/venueExplorerModel";

interface VenueExperiencesSectionProps {
  /** Deck card id == place_pool.id (uuid). Non-uuid ids disable the fetch. */
  placePoolId: string | null | undefined;
  /** The viewer's account currency; prices convert into it (#4347). */
  currency?: string | null;
  /**
   * Called with the experience mapped to the BusinessEventCard shape when a row
   * is tapped. ExpandedCardModal renders the ExpandedBusinessEventSheet as a
   * sibling of its root sheet (not nested here) and gates the root off while it
   * is open — the proven sub-sheet pattern.
   */
  onOpenExperience: (card: BusinessEventCard) => void;
  /**
   * #4347 wave 4 — on a host venue page the rows sit inside the host's page,
   * in its measured colours (`whenColorsFor`). Absent: the place sheet's paper.
   */
  colors?: WhenColors;
}

type Tone = ReturnType<typeof toneStyles> | null;

function toneStyles(c: WhenColors) {
  return StyleSheet.create({
    container: { paddingHorizontal: 0, paddingVertical: 0 },
    headerText: { color: c.heading },
    row: { backgroundColor: c.tileFill, borderColor: c.tileFill },
    rowTitle: { color: c.text },
    rowPrice: { color: c.text },
  });
}

function ExperienceRow({
  row,
  currency,
  onPress,
  tone,
  chevron,
}: {
  row: VenueExperienceRow;
  currency?: string | null;
  onPress: (row: VenueExperienceRow) => void;
  tone: Tone;
  chevron: string;
}): React.ReactElement {
  const poster = posterFor(row);
  const isVideoCover =
    row.cover_media_type === "video" || isVideoUrl(row.cover_media_url);
  const { t } = useTranslation(["cards"]);
  // #4347: converted from the experience's own currency for this viewer.
  const priceText = formatExperiencePrice(row, currency, formatDisplayPrice, {
    free: t("cards:swipeable.free", { defaultValue: "Free" }),
    from: (price) => t("cards:price.from", { defaultValue: "From {{price}}", price }),
  });
  return (
    <TouchableOpacity
      style={[styles.row, tone?.row]}
      activeOpacity={0.7}
      onPress={() => onPress(row)}
      accessibilityRole="button"
      accessibilityLabel={`${row.title}${priceText ? `, ${priceText}` : ""}`}
    >
      <View style={[styles.thumb, { backgroundColor: `hsl(${hueFromId(row.experience_id)}, 45%, 88%)` }]}>
        {poster ? (
          <Image source={{ uri: poster }} style={styles.thumbImage} resizeMode="cover" />
        ) : (
          <Icon name="image-outline" size={18} color="#b45309" />
        )}
        {isVideoCover && (
          <View style={styles.playBadge}>
            <Icon name="play" size={10} color="#ffffff" />
          </View>
        )}
      </View>
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, tone?.rowTitle]} numberOfLines={1}>
          {row.title}
        </Text>
        {priceText ? (
          <Text style={[styles.rowPrice, tone?.rowPrice]} numberOfLines={1}>
            {priceText}
          </Text>
        ) : null}
      </View>
      <Icon name="chevron-forward" size={16} color={chevron} />
    </TouchableOpacity>
  );
}

export default function VenueExperiencesSection({
  placePoolId,
  currency,
  onOpenExperience,
  colors,
}: VenueExperiencesSectionProps): React.ReactElement | null {
  const { data } = useVenueExperiences(placePoolId);
  const { t } = useTranslation(["cards"]);
  const tone = useMemo<Tone>(() => (colors ? toneStyles(colors) : null), [colors]);

  // Emit the selection upward; ExpandedCardModal owns the ExpandedBusinessEventSheet
  // as a SIBLING of the root sheet (feedback_rn_sub_sheet_must_render_inside_parent
  // — a second sheet must not be nested inside the root sheet's scroll content).
  const handleOpen = useCallback(
    (row: VenueExperienceRow) => {
      onOpenExperience(experienceToBusinessEventCard(row));
    },
    [onOpenExperience],
  );

  // Render nothing until there is at least one experience — no empty header,
  // no loading flash (matches the other conditional sections on this card).
  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }

  return (
    <View style={[styles.container, tone?.container]} testID="venue-experiences">
      <View style={styles.header}>
        <Icon name="sparkles-outline" size={14} color={colors ? colors.heading : SPINE.link} />
        <Text style={[styles.headerText, tone?.headerText]} accessibilityRole="header">
          {t("cards:venue_page.experiences_here", { count: data.length })}
        </Text>
      </View>
      {data.map((row) => (
        <ExperienceRow
          key={row.experience_id}
          row={row}
          currency={currency}
          onPress={handleOpen}
          tone={tone}
          chevron={colors ? colors.muted : "#9ca3af"}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 2,
  },
  headerText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#9a3412",
    letterSpacing: 0.2,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fef7f0",
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: "#eb782533",
    gap: 10,
  },
  thumb: {
    width: 48,
    height: 48,
    borderRadius: 10,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },
  thumbImage: {
    width: "100%",
    height: "100%",
  },
  playBadge: {
    position: "absolute",
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1f2937",
  },
  rowPrice: {
    fontSize: 12,
    fontWeight: "600",
    // #4347 wave 3 rework — #ea580c measured 3.56:1 on paper; the link accent
    // is the one orange legible as text (5.18:1).
    color: SPINE.link,
  },
});

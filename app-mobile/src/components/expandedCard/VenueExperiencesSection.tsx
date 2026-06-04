import React, { useCallback } from "react";
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

interface VenueExperiencesSectionProps {
  /** Deck card id == place_pool.id (uuid). Non-uuid ids disable the fetch. */
  placePoolId: string | null | undefined;
  /** Account-preference currency, used as the display fallback. */
  currency?: string | null;
  /**
   * Called with the experience mapped to the BusinessEventCard shape when a row
   * is tapped. ExpandedCardModal renders the ExpandedBusinessEventSheet as a
   * sibling of its root sheet (not nested here) and gates the root off while it
   * is open — the proven sub-sheet pattern.
   */
  onOpenExperience: (card: BusinessEventCard) => void;
}

function ExperienceRow({
  row,
  currency,
  onPress,
}: {
  row: VenueExperienceRow;
  currency?: string | null;
  onPress: (row: VenueExperienceRow) => void;
}): React.ReactElement {
  const poster = posterFor(row);
  const isVideoCover =
    row.cover_media_type === "video" || isVideoUrl(row.cover_media_url);
  const priceText = formatExperiencePrice(row, currency);
  return (
    <TouchableOpacity
      style={styles.row}
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
        <Text style={styles.rowTitle} numberOfLines={1}>
          {row.title}
        </Text>
        {priceText ? (
          <Text style={styles.rowPrice} numberOfLines={1}>
            {priceText}
          </Text>
        ) : null}
      </View>
      <Icon name="chevron-forward" size={16} color="#9ca3af" />
    </TouchableOpacity>
  );
}

export default function VenueExperiencesSection({
  placePoolId,
  currency,
  onOpenExperience,
}: VenueExperiencesSectionProps): React.ReactElement | null {
  const { data } = useVenueExperiences(placePoolId);

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
    <View style={styles.container}>
      <View style={styles.header}>
        <Icon name="sparkles-outline" size={14} color="#ea580c" />
        <Text style={styles.headerText}>
          {data.length === 1 ? "Experience here" : "Experiences here"}
        </Text>
      </View>
      {data.map((row) => (
        <ExperienceRow
          key={row.experience_id}
          row={row}
          currency={currency}
          onPress={handleOpen}
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
    color: "#ea580c",
  },
});

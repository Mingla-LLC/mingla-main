/**
 * Issue #4261 amendment 1 (6.5 #3) — the place vote, on the chat card and on
 * Matches, voted exactly like times: tap every place that works (the row
 * toggles your vote), the open button opens the place (a Mingla place its
 * card, any other place its own link or the map, inside Mingla), and
 * "+ Suggest another place" when the plan takes suggestions.
 */
import React, { useState } from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "../ui/Icon";
import { chatTokens } from "../../constants/chatTokens";
import { resolvePlacePhotoThumbSource } from "../../utils/placePhotoThumb";
import { isHttpsImage, optionVotersLine, placeOptionName } from "./planModel";
import type { ChatPlan, ChatPlanPlaceOption } from "../../types/chatPlans";

const HIT_SLOP = { top: 4, bottom: 4, left: 4, right: 4 };

function PlaceThumb({ option }: { option: ChatPlanPlaceOption }): React.ReactElement {
  const [failed, setFailed] = useState(false);
  const pool = option.poolId ? resolvePlacePhotoThumbSource(option.photoUrl) : null;
  const linkImage = !option.poolId && isHttpsImage(option.link?.imageUrl) ? option.link?.imageUrl ?? null : null;
  const uri = pool?.uri ?? linkImage;
  if (uri && !failed) {
    return <Image source={{ uri }} style={styles.thumb} resizeMode="cover" onError={() => setFailed(true)} />;
  }
  return (
    <View style={[styles.thumb, styles.thumbIcon]}>
      <Icon name="location" size={16} color={chatTokens.textSoft} />
    </View>
  );
}

interface PlanPlaceOptionsProps {
  plan: ChatPlan;
  viewerId: string;
  memberCount: number;
  nameOf: (userId: string | null) => string;
  heading: string;
  compact?: boolean;
  onVote: (optionId: string) => void;
  onOpen: (option: ChatPlanPlaceOption) => void;
  onSuggest?: () => void;
}

export function PlanPlaceOptions({
  plan,
  viewerId,
  memberCount,
  nameOf,
  heading,
  compact = false,
  onVote,
  onOpen,
  onSuggest,
}: PlanPlaceOptionsProps): React.ReactElement {
  const { t } = useTranslation(["chat"]);
  const size = Math.max(1, memberCount);
  const translate = (key: string, params?: Record<string, unknown>) => t(`chat:${key}`, params);
  return (
    <View style={styles.block} testID={`plan-places-${plan.id}`}>
      <Text style={[styles.heading, compact && styles.headingCompact]}>{heading}</Text>
      {plan.places.map((option) => {
        const mine = option.voterIds.includes(viewerId);
        const share = Math.min(1, option.voterIds.length / size);
        const name = placeOptionName(option);
        const line = option.voterIds.length > 0 || (option.addedBy && option.addedBy !== plan.createdBy)
          ? optionVotersLine(option, plan, viewerId, nameOf, translate, "place")
          : option.address || optionVotersLine(option, plan, viewerId, nameOf, translate, "place");
        return (
          <View key={option.id} style={[styles.row, compact && styles.rowCompact, mine && styles.rowMine]}>
            <View style={[styles.fill, mine ? styles.fillMine : styles.fillOther, { width: `${Math.round(share * 100)}%` }]} />
            <TouchableOpacity
              style={styles.voteArea}
              onPress={() => onVote(option.id)}
              disabled={plan.status !== "deciding"}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={`${name}, ${option.voterIds.length}`}
              accessibilityState={{ selected: mine }}
              testID={`plan-place-option-${option.id}`}
            >
              <PlaceThumb option={option} />
              <View style={styles.text}>
                <View style={styles.nameRow}>
                  <Text style={styles.name} numberOfLines={1}>{name}</Text>
                  {!option.poolId ? (
                    <View style={styles.chip}>
                      <Text style={styles.chipText}>{t("chat:plan_not_on_mingla")}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.line} numberOfLines={1}>{line}</Text>
              </View>
              <Text style={styles.count}>{option.voterIds.length}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.open}
              onPress={() => onOpen(option)}
              hitSlop={HIT_SLOP}
              accessibilityRole="button"
              accessibilityLabel={t("chat:plan_open_place_a11y", { name })}
              testID={`plan-place-open-${option.id}`}
            >
              <Icon name="open-outline" size={16} color={chatTokens.textSecondary} />
            </TouchableOpacity>
          </View>
        );
      })}
      {onSuggest ? <PlanSuggestPlaceButton onPress={onSuggest} /> : null}
    </View>
  );
}

/** The dashed "+ Suggest another place" button (also under a single place). */
export function PlanSuggestPlaceButton({ onPress }: { onPress: () => void }): React.ReactElement {
  const { t } = useTranslation(["chat"]);
  return (
    <TouchableOpacity
      style={styles.suggest}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t("chat:plan_suggest_place")}
      testID="plan-suggest-place"
    >
      <Text style={styles.suggestText}>{t("chat:plan_suggest_place")}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  block: { gap: 6 },
  heading: { color: chatTokens.tagDeck, fontSize: 12, fontWeight: "700" },
  headingCompact: { fontSize: 11 },
  row: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: chatTokens.hairline,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
  },
  rowCompact: { minHeight: 48 },
  rowMine: { borderColor: chatTokens.accent },
  fill: { ...StyleSheet.absoluteFillObject, right: undefined },
  fillMine: { backgroundColor: "rgba(235, 120, 37, 0.24)" },
  fillOther: { backgroundColor: "rgba(255, 255, 255, 0.07)" },
  voteArea: { flex: 1, minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 8, paddingVertical: 6 },
  thumb: { width: 36, height: 36, borderRadius: 8 },
  thumbIcon: { backgroundColor: chatTokens.surfaceRaised, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { flexShrink: 1, color: chatTokens.textPrimary, fontSize: 14, fontWeight: "600" },
  chip: { borderRadius: 6, borderWidth: 1, borderColor: chatTokens.hairline, paddingHorizontal: 5, paddingVertical: 1 },
  chipText: { color: chatTokens.textSoft, fontSize: 11, fontWeight: "700" },
  line: { color: chatTokens.textSecondary, fontSize: 12 },
  count: { color: chatTokens.textPrimary, fontSize: 13, fontWeight: "700" },
  open: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  suggest: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "rgba(255, 255, 255, 0.28)",
    alignItems: "center",
    justifyContent: "center",
  },
  suggestText: { color: chatTokens.textPrimary, fontSize: 14, fontWeight: "600" },
});

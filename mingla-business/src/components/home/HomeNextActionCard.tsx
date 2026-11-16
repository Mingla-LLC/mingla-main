/**
 * ORCH-0965 [Home dashboard intelligent KPIs + tri-kind upcoming]
 *
 * HomeNextActionCard — renders one best-next-action rung from the rule
 * ladder in `utils/homeNextAction.ts`. Visual treatment mirrors the
 * pre-ORCH-0965 trip-planner CTA at home.tsx:419–477 (now absorbed
 * here): GlassCard variant="elevated", title + body + chevron-row CTA.
 *
 * Pure presentational component. State + routing live in the home
 * screen — this component receives a fully resolved action + onPress.
 *
 * Established by SPEC §4.5.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  color,
  space,
  type,
} from "../../constants/designSystem";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import type { HomeNextActionRung } from "../../utils/homeNextAction";

interface HomeNextActionCardProps {
  action: HomeNextActionRung;
  onPress: () => void;
}

export const HomeNextActionCard: React.FC<HomeNextActionCardProps> = ({
  action,
  onPress,
}) => {
  return (
    <View style={styles.wrap}>
      <GlassCard variant="elevated" padding={space[6]}>
        <Text style={styles.title}>{action.title}</Text>
        <Text style={styles.body}>{action.body}</Text>
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={action.ctaLabel}
          style={styles.action}
          testID={`home-next-action-rung-${action.rung}`}
        >
          <Icon name="chevR" size={16} color={color.text1} />
          <Text style={styles.actionText}>{action.ctaLabel}</Text>
        </Pressable>
      </GlassCard>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    marginBottom: space[4],
  },
  title: {
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
    color: color.text1,
    marginBottom: space[1],
  },
  body: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    color: color.text2,
    marginBottom: space[4],
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
    alignSelf: "flex-start",
  },
  actionText: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    fontWeight: "600",
    color: color.text1,
  },
});

export default HomeNextActionCard;

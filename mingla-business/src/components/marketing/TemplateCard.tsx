/**
 * TemplateCard — row in the Templates tab (ORCH-0863). Per DESIGN §5.3 + §5.4.
 *
 * Starter rows render with a "Read-only" pill chip (top-right, inline with
 * title). User rows render without the chip. Body preview is single-line
 * with tokens (`{first_name}`, `{{event:id}}`) preserved verbatim.
 */

import React, { useCallback, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Icon } from "../ui/Icon";
import type { MarketingTemplateRow } from "../../types/marketing";

const PREVIEW_MAX_CHARS = 80;

function buildPreview(body: string): string {
  const flat = body.replace(/\n+/g, " ").trim();
  if (flat.length <= PREVIEW_MAX_CHARS) return flat;
  return `${flat.slice(0, PREVIEW_MAX_CHARS).trimEnd()}…`;
}

export interface TemplateCardProps {
  template: MarketingTemplateRow;
  onPress: (id: string) => void;
}

export const TemplateCard: React.FC<TemplateCardProps> = ({ template, onPress }) => {
  const handlePress = useCallback(() => {
    onPress(template.id);
  }, [template.id, onPress]);

  const preview = useMemo(() => buildPreview(template.body_template), [template.body_template]);
  const isStarter = template.is_starter_pack === true;

  const accLabel = isStarter
    ? `${template.name}, read-only starter template`
    : `${template.name}, your template`;
  const accHint = isStarter
    ? "Opens the template preview"
    : "Opens the template editor";

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={accLabel}
      accessibilityHint={accHint}
      style={({ pressed }) => [styles.host, pressed ? styles.hostPressed : null]}
    >
      <View style={styles.headerRow}>
        <Text style={styles.title} numberOfLines={1}>
          {template.name}
        </Text>
        {isStarter ? (
          <View style={styles.pill}>
            <Text style={styles.pillText}>Read-only</Text>
          </View>
        ) : null}
        <Icon name="chevR" size={16} color={textTokens.tertiary} />
      </View>
      <Text style={styles.preview} numberOfLines={1}>
        {preview}
      </Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  host: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    gap: 2,
    minHeight: 64,
  },
  hostPressed: {
    opacity: 0.78,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.xs,
  },
  title: {
    ...typography.body,
    fontWeight: "600",
    color: textTokens.primary,
    flex: 1,
  },
  pill: {
    paddingVertical: 2,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  pillText: {
    ...typography.micro,
    color: textTokens.tertiary,
  },
  preview: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
});

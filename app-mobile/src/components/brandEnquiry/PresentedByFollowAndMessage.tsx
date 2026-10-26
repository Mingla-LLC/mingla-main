/**
 * #4111 Wave D (D6) — the organiser row on Explorer's event, RSVP, trip and
 * experience pages: Follow and Message side by side. Message opens the sheet
 * with this page's offering already picked (step 2). With no Message (brand
 * not taking messages, or not loaded yet) Follow renders alone, exactly as
 * before.
 */
import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { ResolvedTheme } from "@mingla/offering-rendering";
import type { ThemePalette } from "@mingla/offering-rendering/themePalette";
import type { EnquiryOffering } from "@mingla/brand-rendering/enquiry/enquiryTopics";

import { PresentedByFollowButton } from "../brand/PresentedByFollowButton";
import { useExplorerBrandMessage } from "./useExplorerBrandMessage";

export interface PresentedByFollowAndMessageProps {
  brandId: string;
  brandName: string;
  brandSlug: string | null;
  palette: ThemePalette;
  theme: ResolvedTheme;
  /** The page's own offering, picked when the sheet opens. */
  offering: EnquiryOffering;
}

export function PresentedByFollowAndMessage({
  brandId,
  brandName,
  brandSlug,
  palette,
  theme,
  offering,
}: PresentedByFollowAndMessageProps): React.ReactElement {
  const { t } = useTranslation("enquiry");
  const brand = useMemo(
    () => ({ id: brandId, name: brandName, slug: brandSlug, theme }),
    [brandId, brandName, brandSlug, theme],
  );
  const offerings = useMemo(() => [offering], [offering]);
  const message = useExplorerBrandMessage({ brand, entry: "offering", offerings });
  const follow = <PresentedByFollowButton brandId={brandId} brandName={brandName} palette={palette} />;
  if (!message.available) return follow;
  return (
    <>
      <View style={styles.row}>
        <View style={styles.cell}>{follow}</View>
        <Pressable
          onPress={() => message.open({ contextKind: "offering", contextId: offering.id, offering })}
          accessibilityRole="button"
          accessibilityLabel={t("enquiry:message_brand", { brand: brandName })}
          testID="presented-by-message"
          style={({ pressed }) => [
            styles.cell,
            styles.message,
            { borderColor: palette.accent },
            pressed && styles.pressed,
          ]}
        >
          <Text numberOfLines={1} style={[styles.label, { color: palette.primaryText }]}>
            {t("enquiry:message")}
          </Text>
        </Pressable>
      </View>
      {message.overlays}
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "stretch", gap: 10 },
  cell: { flex: 1, minWidth: 0 },
  message: {
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  label: { fontSize: 15, fontWeight: "700" },
  pressed: { opacity: 0.85 },
});

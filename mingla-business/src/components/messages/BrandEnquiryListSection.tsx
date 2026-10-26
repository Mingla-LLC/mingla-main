/**
 * #4111 D4 — "Customer enquiries · {n} waiting" on the Host Messages screen,
 * above "Your Brand groups". Same section pattern as the staff Support inbox.
 *
 * The section renders nothing until the team has at least one enquiry: the
 * server returns nothing for scanner-only members (and for Mingla staff, D8),
 * so they never see the section.
 */

import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import { useBrandEnquiries } from "../../hooks/useBrandEnquiries";
import type { BrandEnquirySummary } from "../../services/brandEnquiriesService";
import {
  brandEnquiryInitials,
  brandEnquiryRowSubtitle,
  brandEnquirySectionTitle,
  brandEnquiryStatusPill,
  type BrandEnquiryPillTone,
} from "../../utils/brandEnquiryDisplay";
import { Button } from "../ui/Button";

const PILL_COLORS: Record<BrandEnquiryPillTone, { background: string; color: string }> = {
  new: { background: "#16304f", color: "#8ec1ff" },
  waiting: { background: "#4a3410", color: "#ffc66b" },
  replied: { background: "#173a2a", color: "#7fdcaa" },
  resolved: { background: "#2c2c31", color: textTokens.tertiary },
};

export function BrandEnquiryStatusPill({ status }: { status: BrandEnquirySummary["status"] }): React.ReactElement {
  const pill = brandEnquiryStatusPill(status);
  const colors = PILL_COLORS[pill.tone];
  return (
    <View style={[styles.pill, { backgroundColor: colors.background }]} testID={`brand-enquiry-pill-${pill.tone}`}>
      <Text style={[styles.pillText, { color: colors.color }]} numberOfLines={1}>{pill.label}</Text>
    </View>
  );
}

export function BrandEnquiryRow({
  item,
  onPress,
}: {
  item: BrandEnquirySummary;
  onPress: () => void;
}): React.ReactElement {
  const pill = brandEnquiryStatusPill(item.status);
  const subtitle = brandEnquiryRowSubtitle(item);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Customer enquiry from ${item.guest_name}, ${pill.label}. ${subtitle}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      testID={`brand-enquiry-row-${item.id}`}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{brandEnquiryInitials(item.guest_name)}</Text>
      </View>
      <View style={styles.rowCopy}>
        <View style={styles.rowTitleLine}>
          <Text style={styles.rowTitle} numberOfLines={1}>{item.guest_name}</Text>
          <BrandEnquiryStatusPill status={item.status} />
        </View>
        <Text style={styles.preview} numberOfLines={1}>{subtitle}</Text>
      </View>
    </Pressable>
  );
}

export function BrandEnquiryListSection({
  onOpen,
}: {
  onOpen: (item: BrandEnquirySummary) => void;
}): React.ReactElement | null {
  const [showResolved, setShowResolved] = useState(false);
  const open = useBrandEnquiries("open");
  const resolved = useBrandEnquiries("resolved", { enabled: showResolved });

  if (open.isError) {
    return (
      <View style={styles.section} testID="brand-enquiry-section">
        <Text style={styles.sectionTitle}>Customer enquiries</Text>
        <View style={styles.errorRow}>
          <Text style={styles.preview}>
            {open.error instanceof Error ? open.error.message : "Couldn't load customer enquiries"}
          </Text>
          <Button label="Retry" variant="secondary" size="sm" onPress={() => void open.refetch()} />
        </View>
      </View>
    );
  }

  const data = open.data;
  if (!data) return null;
  const resolvedCount = data.counts.resolved;
  if (data.items.length === 0 && resolvedCount === 0) return null;

  return (
    <View style={styles.section} testID="brand-enquiry-section">
      <Text style={styles.sectionTitle}>{brandEnquirySectionTitle(data.counts)}</Text>
      {data.items.map((item) => (
        <BrandEnquiryRow key={item.id} item={item} onPress={() => onOpen(item)} />
      ))}
      {resolvedCount > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={showResolved ? "Hide resolved enquiries" : `See resolved enquiries, ${resolvedCount}`}
          accessibilityState={{ expanded: showResolved }}
          onPress={() => setShowResolved((value) => !value)}
          style={({ pressed }) => [styles.resolvedRow, pressed && styles.rowPressed]}
          testID="brand-enquiry-see-resolved"
        >
          <Text style={styles.resolvedText}>{showResolved ? "Hide resolved" : `See resolved (${resolvedCount})`}</Text>
          <Text style={styles.resolvedChevron}>{showResolved ? "⌃" : "›"}</Text>
        </Pressable>
      ) : null}
      {showResolved ? (
        resolved.isError ? (
          <View style={styles.errorRow}>
            <Text style={styles.preview}>
              {resolved.error instanceof Error ? resolved.error.message : "Couldn't load resolved enquiries"}
            </Text>
            <Button label="Retry" variant="secondary" size="sm" onPress={() => void resolved.refetch()} />
          </View>
        ) : resolved.data ? (
          resolved.data.items.map((item) => (
            <BrandEnquiryRow key={item.id} item={item} onPress={() => onOpen(item)} />
          ))
        ) : (
          <Text style={styles.preview}>Loading resolved enquiries…</Text>
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  sectionTitle: { color: textTokens.tertiary, fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.7 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 72, padding: spacing.md, borderWidth: 1, borderColor: glass.border.profileBase, borderRadius: radius.lg, backgroundColor: glass.tint.profileBase },
  rowPressed: { opacity: 0.72 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(235,120,37,0.14)", borderWidth: 1, borderColor: "rgba(235,120,37,0.35)" },
  avatarText: { color: accent.warm, fontSize: 15, fontWeight: "800" },
  rowCopy: { flex: 1, minWidth: 0, gap: 4 },
  rowTitleLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rowTitle: { flexShrink: 1, color: textTokens.primary, fontSize: 16, fontWeight: "700" },
  preview: { color: textTokens.secondary, fontSize: 13 },
  pill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, flexShrink: 0 },
  pillText: { fontSize: 11, fontWeight: "700" },
  resolvedRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: glass.border.profileBase, borderRadius: radius.lg, backgroundColor: glass.tint.profileBase },
  resolvedText: { flex: 1, color: textTokens.secondary, fontSize: 14, fontWeight: "600" },
  resolvedChevron: { color: textTokens.tertiary, fontSize: 16 },
  errorRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: glass.border.profileBase, borderRadius: radius.lg, backgroundColor: glass.tint.profileBase },
});

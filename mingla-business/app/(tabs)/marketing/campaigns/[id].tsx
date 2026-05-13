/**
 * Marketing → Campaigns → [id] — per-campaign report screen
 * (Sub-ORCH-0815-C-1).
 *
 * Honest about what's measurable today vs not:
 *   - Delivered counts: yes (marketing_messages rows by status)
 *   - Click data: yes (marketing_clicks rows with clicked_at)
 *   - Open rate: NOT YET — requires Resend webhook ingest (future ORCH).
 *
 * Cross-references:
 *   - Service: marketingReportService.ts (aggregates marketing_messages + marketing_clicks)
 *   - Schema: Phase A migration 20260602000003_orch_0815_marketing_hub_phase_a.sql
 */

import React, { useCallback } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "../../../../src/components/ui/EmptyState";
import { Icon } from "../../../../src/components/ui/Icon";
import {
  accent,
  canvas,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../../../src/constants/designSystem";
import { useCampaignReport } from "../../../../src/hooks/marketing/useCampaignReport";
import type { MessageStatus } from "../../../../src/types/marketing";

const STATUS_GLYPH: Record<string, string> = {
  draft: "📝",
  scheduled: "⏰",
  sending: "⚡",
  sent: "✉",
  failed: "⚠",
  cancelled: "—",
};

// Friendly campaign-level status copy. Replaces raw DB enums in the hero.
const STATUS_HEADLINE: Record<string, string> = {
  draft: "Draft",
  scheduled: "Scheduled to send",
  sending: "Sending now",
  sent: "Sent",
  failed: "Send failed",
  cancelled: "Cancelled",
};

// Friendly per-recipient status copy. Replaces raw DB enums in the
// recipient detail list. Anything missing falls back to the raw value.
const RECIPIENT_STATUS_LABEL: Record<string, string> = {
  queued: "Waiting in line",
  sent: "Sent",
  delivered: "Delivered",
  opened: "Opened",
  clicked: "Clicked a link",
  bounced: "Bounced — bad address",
  failed: "Send failed",
  unsubscribed: "Unsubscribed",
  preview_skipped: "Preview only (no real email sent)",
};

function formatDateTime(iso: string | null): string {
  if (iso === null) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusTone(status: MessageStatus): string {
  if (status === "sent" || status === "delivered" || status === "clicked") {
    return textTokens.primary;
  }
  if (status === "failed" || status === "bounced") return semantic.warning;
  if (status === "unsubscribed") return semantic.warning;
  if (status === "preview_skipped") return textTokens.tertiary;
  return textTokens.secondary;
}

function maskEmail(email: string | null): string {
  if (email === null) return "—";
  const at = email.indexOf("@");
  if (at < 1) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 3) return local + "**" + domain;
  return local.slice(0, 3) + "**" + domain;
}

export default function CampaignReportRoute(): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const idParam = Array.isArray(params.id) ? params.id[0] : params.id;
  const campaignId =
    typeof idParam === "string" && idParam.length > 0 ? idParam : null;
  const reportQuery = useCampaignReport(campaignId);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/marketing/campaigns" as never);
  }, [router]);

  if (campaignId === null) {
    return (
      <View style={styles.host}>
        <Header onBack={handleBack} title="Campaign" />
        <View style={styles.centerHost}>
          <EmptyState
            illustration="users"
            title="Campaign not found"
            description="The link may be stale."
          />
        </View>
      </View>
    );
  }

  if (reportQuery.isLoading && reportQuery.data === undefined) {
    return (
      <View style={styles.host}>
        <Header onBack={handleBack} title="Campaign" />
        <View style={styles.centerHost}>
          <ActivityIndicator size="small" color={textTokens.secondary} />
        </View>
      </View>
    );
  }

  if (reportQuery.isError || reportQuery.data === undefined) {
    return (
      <View style={styles.host}>
        <Header onBack={handleBack} title="Campaign" />
        <View style={styles.centerHost}>
          <EmptyState
            illustration="users"
            title="Couldn't load this campaign"
            description="Pull to retry, or come back in a moment."
          />
        </View>
      </View>
    );
  }

  const { campaign, recipientStats, clickStats, recipients } = reportQuery.data;
  const glyph = STATUS_GLYPH[campaign.status] ?? "•";
  const isLivePreviewOnly = recipientStats.preview_skipped > 0 && recipientStats.sent === 0;

  return (
    <View style={styles.host}>
      <Header onBack={handleBack} title={campaign.name} />
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          // Clear the BottomNav (~72pt visible) + safe-area inset + a 24pt
          // breathing gap so the last recipient row scrolls into view.
          { paddingBottom: insets.bottom + 96 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Status hero */}
        <View style={styles.heroCard}>
          <Text style={styles.heroGlyph}>{glyph}</Text>
          <Text style={styles.heroStatus}>
            {STATUS_HEADLINE[campaign.status] ?? campaign.status}
          </Text>
          <Text style={styles.heroSub}>
            {campaign.status === "scheduled"
              ? `Going out ${formatDateTime(campaign.scheduled_for)}`
              : campaign.status === "sent"
                ? `Sent ${formatDateTime(campaign.sent_at)}`
                : campaign.status === "failed"
                  ? `Failed ${formatDateTime(campaign.updated_at)}`
                  : campaign.status === "sending"
                    ? "Going out now — refresh in a moment"
                    : `Updated ${formatDateTime(campaign.updated_at)}`}
          </Text>
        </View>

        {/* Preview-only banner — visible only while the live email gate is off. */}
        {isLivePreviewOnly ? (
          <View style={styles.previewBanner}>
            <Text style={styles.previewBannerTitle}>
              Preview mode — no real emails went out
            </Text>
            <Text style={styles.previewBannerText}>
              Mingla is set up to test the whole send flow without delivering real
              email. We'll flip the switch once production payments are signed off.
              Counts below show who <Text style={styles.previewBannerEmphasis}>would</Text> have received it.
            </Text>
          </View>
        ) : null}

        {/* Recipient stats */}
        <Text style={styles.sectionLabel}>WHO IT WENT TO</Text>
        <View style={styles.statsGrid}>
          <StatCell label="Total audience" value={recipientStats.total} />
          <StatCell label="Delivered" value={recipientStats.sent} tone={semantic.success} />
          <StatCell label="Preview only" value={recipientStats.preview_skipped} tone={textTokens.tertiary} />
          <StatCell label="Failed to send" value={recipientStats.failed} tone={semantic.warning} />
          <StatCell label="Unsubscribed" value={recipientStats.unsubscribed} tone={semantic.warning} />
          <StatCell label="Clicked a link" value={recipientStats.clicked} />
        </View>

        {/* Click stats */}
        <Text style={styles.sectionLabel}>LINK CLICKS</Text>
        <View style={styles.statsGrid}>
          <StatCell label="Total taps" value={clickStats.total_clicks} />
          <StatCell label="Unique people" value={clickStats.unique_clickers} />
        </View>
        {clickStats.top_links.length > 0 ? (
          <View style={styles.linksCard}>
            <Text style={styles.linksHeader}>MOST-CLICKED LINKS</Text>
            {clickStats.top_links.map((link) => (
              <View key={link.destination_url} style={styles.linkRow}>
                <Text style={styles.linkUrl} numberOfLines={1}>
                  {link.destination_url}
                </Text>
                <Text style={styles.linkCount}>
                  {link.clicks} {link.clicks === 1 ? "tap" : "taps"}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Honesty about what we can and can't measure */}
        <View style={styles.honestyNote}>
          <Text style={styles.honestyTitle}>What these numbers mean</Text>
          <Text style={styles.honestyText}>
            We can tell you exactly who clicked a link in your email — that's the
            data above. We can't yet tell who opened the email without clicking;
            that needs an extra setup we'll add in a later update. We never
            invent numbers we don't actually measure.
          </Text>
        </View>

        {/* Per-recipient */}
        <Text style={styles.sectionLabel}>EVERY RECIPIENT</Text>
        {recipients.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              No recipients yet. Give it a minute — we process scheduled campaigns
              in batches and your list will fill in here as the send completes.
            </Text>
          </View>
        ) : (
          <View style={styles.recipientList}>
            {recipients.map((r) => (
              <View key={r.id} style={styles.recipientRow}>
                <Text style={styles.recipientEmail} numberOfLines={1}>
                  {maskEmail(r.recipient_email)}
                </Text>
                <View style={styles.recipientMeta}>
                  <Text style={[styles.recipientStatus, { color: statusTone(r.status) }]}>
                    {RECIPIENT_STATUS_LABEL[r.status] ?? r.status}
                  </Text>
                  {r.click_count > 0 ? (
                    <Text style={styles.recipientClicks}>
                      · tapped {r.click_count} link{r.click_count === 1 ? "" : "s"}
                    </Text>
                  ) : null}
                </View>
                {r.failure_reason !== null ? (
                  <Text style={styles.recipientFailure} numberOfLines={2}>
                    Reason: {r.failure_reason}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const Header: React.FC<{ onBack: () => void; title: string }> = ({
  onBack,
  title,
}) => (
  <View style={styles.header}>
    <Pressable
      onPress={onBack}
      accessibilityRole="button"
      accessibilityLabel="Back"
      style={({ pressed }) => [
        styles.iconBtn,
        pressed ? styles.iconBtnPressed : null,
      ]}
      hitSlop={8}
    >
      <Icon name="arrowL" size={24} color={textTokens.primary} />
    </Pressable>
    <Text style={styles.headerTitle} numberOfLines={1}>
      {title}
    </Text>
    <View style={styles.iconBtnSpacer} />
  </View>
);

interface StatCellProps {
  label: string;
  value: number;
  tone?: string;
}
const StatCell: React.FC<StatCellProps> = ({ label, value, tone }) => (
  <View style={styles.statCell}>
    <Text style={styles.statLabel}>{label}</Text>
    <Text style={[styles.statValue, tone !== undefined ? { color: tone } : null]}>
      {value}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: canvas.discover,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    minHeight: 56,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.tint.profileBase,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
  },
  iconBtnPressed: {
    opacity: 0.78,
  },
  iconBtnSpacer: {
    width: 44,
  },
  headerTitle: {
    ...typography.bodyLg,
    color: textTokens.primary,
    fontWeight: "600",
    flex: 1,
    textAlign: "center",
  },
  centerHost: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    // paddingBottom is injected per-render via insets.bottom + 96 so the
    // last recipient row clears the floating BottomNav.
    gap: spacing.md,
  },
  heroCard: {
    alignItems: "center",
    padding: spacing.lg,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileElevated,
    backgroundColor: glass.tint.profileElevated,
    gap: spacing.xs,
  },
  heroGlyph: {
    fontSize: 40,
    color: accent.warm,
  },
  heroStatus: {
    ...typography.h2,
    color: textTokens.primary,
    letterSpacing: 1.4,
  },
  heroSub: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  previewBanner: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    borderLeftWidth: 3,
    borderLeftColor: semantic.warning,
    gap: 4,
  },
  previewBannerTitle: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "700",
  },
  previewBannerText: {
    ...typography.bodySm,
    color: textTokens.primary,
  },
  previewBannerEmphasis: {
    fontStyle: "italic",
    fontWeight: "600",
  },
  sectionLabel: {
    ...typography.labelCap,
    color: textTokens.tertiary,
    marginTop: spacing.sm,
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  statCell: {
    flexBasis: "47%",
    flexGrow: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    gap: 2,
  },
  statLabel: {
    ...typography.labelCap,
    color: textTokens.tertiary,
  },
  statValue: {
    ...typography.h3,
    color: textTokens.primary,
  },
  linksCard: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    padding: spacing.md,
    gap: spacing.sm,
  },
  linksHeader: {
    ...typography.labelCap,
    color: textTokens.tertiary,
  },
  linkRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingVertical: 4,
  },
  linkUrl: {
    ...typography.bodySm,
    color: textTokens.primary,
    flex: 1,
  },
  linkCount: {
    ...typography.bodySm,
    color: textTokens.secondary,
    fontWeight: "600",
  },
  honestyNote: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    gap: 4,
  },
  honestyTitle: {
    ...typography.bodySm,
    color: textTokens.secondary,
    fontWeight: "700",
  },
  honestyText: {
    ...typography.bodySm,
    color: textTokens.tertiary,
  },
  emptyCard: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: glass.tint.profileBase,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
  },
  emptyText: {
    ...typography.body,
    color: textTokens.secondary,
    textAlign: "center",
  },
  recipientList: {
    gap: spacing.xs,
  },
  recipientRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    gap: 4,
  },
  recipientEmail: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "500",
  },
  recipientMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  recipientStatus: {
    ...typography.bodySm,
    fontWeight: "600",
  },
  recipientClicks: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  recipientFailure: {
    ...typography.bodySm,
    color: semantic.warning,
  },
});

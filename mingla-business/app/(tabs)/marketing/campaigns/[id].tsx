/**
 * Marketing → Campaigns → [id] — one campaign, every method (#4273 polish;
 * report since Sub-ORCH-0815-C-1).
 *
 * One tab per method of the blast (Email · SMS · Push), each with the message
 * that went out and its own numbers:
 *   - Preview: the send snapshot ("Exactly as sent"); a method sent before the
 *     snapshot existed is rebuilt from the saved message and says so; a draft
 *     or scheduled send shows what will go.
 *   - Email numbers: delivered, opened (an estimate), clicks, recipients.
 *   - SMS numbers: sent, held for quiet hours, failed, link taps, segments and
 *     the confirmed cost. No per-recipient list (it held no address to show).
 *   - Push numbers: sent, not delivered, skipped, from the push ledger.
 *
 * Layout: one column on iOS, Android and narrow web; preview and numbers side
 * by side on web at 1024px and wider. No height is derived from the window
 * (#2262 doctrine); the panes render without their own scroll so the page
 * scroll owns them.
 *
 * Cross-references:
 *   - Group view: marketingCampaignGroupViewService.ts (biz_marketing_campaign_group_view_v1)
 *   - Email/SMS numbers: marketingReportService.ts (unchanged)
 *   - Preview rules: src/features/marketing/sentPreviewModel.ts
 */

import React, { Suspense, useCallback, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useStickyFooterOffset } from "../../../../src/hooks/useStickyFooterOffset";

import { EmptyState } from "../../../../src/components/ui/EmptyState";
import { Icon } from "../../../../src/components/ui/Icon";
import type { MarketingChannelKind } from "../../../../src/components/marketing/ChannelTabs";
import {
  accent,
  androidOpaque,
  canvas,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../../../src/constants/designSystem";
import { useCampaignReport } from "../../../../src/hooks/marketing/useCampaignReport";
import { useCampaignGroupView } from "../../../../src/hooks/marketing/useCampaignGroupView";
import { useResponsiveLayout } from "../../../../src/hooks/useResponsiveLayout";
import {
  METHOD_LABEL,
  NUMBERS_LATER,
  PER_GUEST_CAPTION,
  SMS_COST_MISSING,
  methodTabLabel,
  previewSourceFor,
  sendStarted,
  tabMembers,
} from "../../../../src/features/marketing/sentPreviewModel";
import {
  CampaignNotFoundError,
  type CampaignGroupMember,
} from "../../../../src/services/marketing/marketingCampaignGroupViewService";
import type { CampaignReport } from "../../../../src/services/marketing/marketingReportService";
import type { MessageStatus } from "../../../../src/types/marketing";

// #4273 — the composer's panes load on demand, through one lazy owner. A
// static import here would make two lazy routes share them, and Metro would
// hoist them (and everything they import) into the boot chunk, __common.
const loadSentPreviews = () =>
  import("../../../../src/components/marketing/SentCampaignPreviews");
const SentMethodTabs = React.lazy(async () => ({ default: (await loadSentPreviews()).SentMethodTabs }));
const SentMethodPreview = React.lazy(async () => ({ default: (await loadSentPreviews()).SentMethodPreview }));
const SentSmsCost = React.lazy(async () => ({ default: (await loadSentPreviews()).SentSmsCost }));

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

/** The status line for one method (headline + detail). */
function statusCopy(member: CampaignGroupMember): { headline: string; detail: string | null } {
  switch (member.status) {
    case "draft":
      return { headline: "Draft — not sent yet", detail: null };
    case "scheduled":
      return {
        headline: `Going out ${formatDateTime(member.scheduledFor)}. This is what will be sent.`,
        detail: null,
      };
    case "sending":
      return { headline: "Going out now — refresh in a moment", detail: null };
    case "sent":
      return { headline: `Sent ${formatDateTime(member.sentAt)}`, detail: null };
    case "failed":
      return { headline: "This didn't go out", detail: `Failed ${formatDateTime(member.updatedAt)}` };
    case "cancelled":
      return { headline: "Cancelled — nothing was sent", detail: null };
    default: {
      const _exhaustive: never = member.status;
      return { headline: String(_exhaustive), detail: null };
    }
  }
}

export default function CampaignReportRoute(): React.ReactElement {
  const router = useRouter();
  const bottomChromeInset = useStickyFooterOffset();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const idParam = Array.isArray(params.id) ? params.id[0] : params.id;
  const campaignId =
    typeof idParam === "string" && idParam.length > 0 ? idParam : null;
  const groupQuery = useCampaignGroupView(campaignId);
  const [activeId, setActiveId] = useState<string | null>(campaignId);
  const { isWideDesktop } = useResponsiveLayout();
  // Width and text size only: whether stat cells sit two to a row.
  const { width, fontScale } = useWindowDimensions();
  const statOneColumn = fontScale >= 1.6 || width - spacing.md * 2 < 320;

  const view = groupQuery.data;
  const tabs = view === undefined ? [] : tabMembers(view.members, activeId ?? view.focusCampaignId);
  const active =
    tabs.find((member) => member.campaignId === activeId) ??
    tabs.find((member) => member.campaignId === view?.focusCampaignId) ??
    tabs[0] ??
    null;
  // Email and SMS numbers come from the per-campaign report, once it started.
  const reportQuery = useCampaignReport(
    active !== null && active.channel !== "push" && sendStarted(active)
      ? active.campaignId
      : null,
  );

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/marketing/campaigns" as never);
  }, [router]);

  const handleKeepEditing = useCallback((id: string) => {
    router.push(`/marketing/campaigns/compose?draft=${id}` as never);
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

  // ORCH-0889: disabled-query + first-fetch both render the spinner.
  // Per I-DISABLED-QUERY-IS-LOADING.
  if (!groupQuery.hasResolved && !groupQuery.isError) {
    return (
      <View style={styles.host}>
        <Header onBack={handleBack} title="Campaign" />
        <View style={styles.centerHost}>
          <ActivityIndicator size="small" color={textTokens.secondary} />
        </View>
      </View>
    );
  }

  if (groupQuery.isError || view === undefined || active === null) {
    return (
      <View style={styles.host}>
        <Header onBack={handleBack} title="Campaign" />
        <View style={styles.centerHost}>
          <EmptyState
            illustration="users"
            title={groupQuery.notFound ? "Campaign not found" : "Couldn't load this campaign"}
            description={groupQuery.notFound ? "The link may be stale." : "Pull to retry, or come back in a moment."}
          />
        </View>
      </View>
    );
  }

  const primary = view.members.find((member) => member.isHead) ?? view.members[0] ?? active;
  const resolution = previewSourceFor(active, view.brand);
  const started = sendStarted(active);
  const status = statusCopy(active);
  const methodWord = METHOD_LABEL[active.channel].toLowerCase();
  const labelFor = (kind: MarketingChannelKind): string => {
    const member = tabs.find((row) => row.channel === kind);
    return member === undefined ? METHOD_LABEL[kind] : methodTabLabel(member);
  };

  const body = (
    <View style={styles.methodBody} testID="campaign-method-body">
      <View style={styles.statusBlock}>
        <Text style={styles.statusHeadline} accessibilityRole="header">
          {status.headline}
        </Text>
        {status.detail !== null ? <Text style={styles.statusDetail}>{status.detail}</Text> : null}
        {active.status === "draft" ? (
          <Pressable
            onPress={() => handleKeepEditing(active.campaignId)}
            accessibilityRole="button"
            accessibilityLabel={`Keep editing the ${methodWord} draft`}
            style={({ pressed }) => [styles.keepEditing, pressed ? styles.keepEditingPressed : null]}
          >
            <Text style={styles.keepEditingLabel}>Keep editing</Text>
          </Pressable>
        ) : null}
      </View>

      <View
        style={isWideDesktop ? styles.wideRow : styles.column}
        testID={isWideDesktop ? "campaign-layout-wide" : "campaign-layout-narrow"}
      >
        <View style={isWideDesktop ? styles.previewColumn : styles.columnChild}>
          <View
            style={[styles.previewCard, Platform.OS === "android" ? styles.previewCardAndroid : null]}
            accessibilityLabel={started ? `Preview of the ${methodWord} as sent` : `Preview of the ${methodWord}`}
            testID="campaign-preview-card"
          >
            <Suspense fallback={<View style={styles.previewLoading}><ActivityIndicator size="small" color={textTokens.secondary} /></View>}>
              <SentMethodPreview resolution={resolution} />
            </Suspense>
          </View>
          {resolution.label !== null ? (
            <Text style={styles.sourceLabel} testID="campaign-preview-source">{resolution.label}</Text>
          ) : null}
          {resolution.channel === "email" && resolution.source === "snapshot" && resolution.props.hasGuestWords ? (
            <Text style={styles.sourceLabel}>{PER_GUEST_CAPTION}</Text>
          ) : null}
        </View>

        <View style={isWideDesktop ? styles.statsColumn : styles.columnChild}>
          {!started ? (
            <Text style={styles.numbersLater}>{NUMBERS_LATER}</Text>
          ) : active.channel === "push" ? (
            <PushNumbers member={active} oneColumn={statOneColumn} />
          ) : !reportQuery.hasResolved && !reportQuery.isError ? (
            <View style={styles.numbersLoading}>
              <ActivityIndicator size="small" color={textTokens.secondary} />
            </View>
          ) : reportQuery.isError || reportQuery.data === undefined ? (
            <Text style={styles.numbersLater}>
              Couldn't load the numbers for this {methodWord}. Come back in a moment.
            </Text>
          ) : active.channel === "sms" ? (
            <SmsNumbers member={active} report={reportQuery.data} oneColumn={statOneColumn} />
          ) : (
            <EmailNumbers report={reportQuery.data} oneColumn={statOneColumn} />
          )}
        </View>
      </View>
    </View>
  );

  return (
    <View style={styles.host}>
      <Header onBack={handleBack} title={primary.name} />
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          isWideDesktop ? styles.scrollContentWide : null,
          // ORCH-0889: bottom inset comes from useStickyFooterOffset so the
          // last row clears the mobile BottomNav capsule on native + narrow
          // web AND avoids extra empty gutter on wide-desktop.
          { paddingBottom: bottomChromeInset },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Suspense fallback={body}>
          <SentMethodTabs
            channels={tabs.map((member) => member.channel)}
            active={active.channel}
            onSelect={(kind) => {
              const next = tabs.find((member) => member.channel === kind);
              if (next !== undefined) setActiveId(next.campaignId);
            }}
            labelFor={labelFor}
            pane={body}
          />
        </Suspense>
      </ScrollView>
    </View>
  );
}

const EmailNumbers: React.FC<{ report: CampaignReport; oneColumn: boolean }> = ({ report, oneColumn }) => {
  const { campaign, recipientStats, clickStats, recipients } = report;
  const isLivePreviewOnly =
    recipientStats.preview_skipped > 0 && recipientStats.accepted === 0;
  const openedPct =
    recipientStats.trackedDelivered > 0
      ? (recipientStats.opened / recipientStats.trackedDelivered) * 100
      : undefined;
  return (
    <View style={styles.numbers}>
      {campaign.audience_name_snapshot ? (
        <Text style={styles.audienceLine}>
          Audience: {campaign.audience_name_snapshot}
        </Text>
      ) : null}

      {/* Preview-only banner — visible only while the live email gate is off. */}
      {isLivePreviewOnly ? (
        <View style={styles.previewBanner}>
          <Text style={styles.previewBannerTitle}>
            Preview mode — no real emails went out
          </Text>
          <Text style={styles.previewBannerText}>
            Mingla is set up to test the whole send flow without delivering
            real email. We'll flip the switch once production payments are
            signed off. Counts below show who{" "}
            <Text style={styles.previewBannerEmphasis}>would</Text> have
            received it.
          </Text>
        </View>
      ) : null}

      {/* Recipient stats */}
      <Text style={styles.sectionLabel}>WHO IT WENT TO</Text>
      <View style={styles.statsGrid}>
        {/* #2510 — one honest vocabulary. Delivered/Opened render as
            unknown (not 0) for campaigns sent before the webhook existed,
            because a 0% open rate reads as "nobody read it". */}
        <StatCell label="Total audience" value={recipientStats.total} oneColumn={oneColumn} />
        <StatCell label="Accepted by provider" value={recipientStats.accepted} tone={semantic.success} oneColumn={oneColumn} />
        <StatCell
          label="Delivered"
          value={recipientStats.hasDeliveryCoverage ? recipientStats.delivered : null}
          tone={semantic.success}
          state={
            !recipientStats.deliveryHealthy
              ? "degraded"
              : recipientStats.hasDeliveryCoverage
                ? "measured"
                : "notMeasured"
          }
          oneColumn={oneColumn}
        />
        <StatCell
          label="Opened"
          value={recipientStats.hasOpenCoverage ? recipientStats.opened : null}
          percent={recipientStats.hasOpenCoverage ? openedPct : undefined}
          state={
            !recipientStats.openHealthy
              ? "degraded"
              : recipientStats.hasOpenCoverage
                ? "measured"
                : "notMeasured"
          }
          oneColumn={oneColumn}
        />
        <StatCell label="Clicked a link" value={recipientStats.clicked} oneColumn={oneColumn} />
        <StatCell label="Bounced" value={recipientStats.bounced} tone={semantic.warning} oneColumn={oneColumn} />
        <StatCell label="Marked as spam" value={recipientStats.complained} tone={semantic.warning} oneColumn={oneColumn} />
        <StatCell label="Preview only" value={recipientStats.preview_skipped} tone={textTokens.tertiary} oneColumn={oneColumn} />
        <StatCell label="Failed to send" value={recipientStats.failed} tone={semantic.warning} oneColumn={oneColumn} />
        <StatCell label="Unsubscribed" value={recipientStats.unsubscribed} tone={semantic.warning} oneColumn={oneColumn} />
      </View>

      <LinkClicks clickStats={clickStats} oneColumn={oneColumn} totalLabel="Total taps" uniqueLabel="Unique people" />

      {/* Honesty about what we can and can't measure */}
      <View style={styles.honestyNote}>
        <Text style={styles.honestyTitle}>What these numbers mean</Text>
        <Text style={styles.honestyText}>
          Opened is an estimate based on a tiny image in the email. Privacy
          protections and image settings can hide a real open or register one
          automatically, so use opens as a trend — not proof that a specific
          person read it. Link clicks are a stronger signal. Emails sent
          before open tracking was enabled show — because those opens were
          never measured.
        </Text>
        {!recipientStats.deliveryHealthy || !recipientStats.openHealthy ? (
          <Text style={styles.trackingDegraded}>
            Tracking data is catching up. Check back in a few minutes.
          </Text>
        ) : null}
      </View>

      {/* Per-recipient (email only: an SMS row held no address to show) */}
      <Text style={styles.sectionLabel}>EVERY RECIPIENT</Text>
      {recipients.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>
            No recipients yet. Give it a minute — we process scheduled
            campaigns in batches and your list will fill in here as the send
            completes.
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
                    · tapped {r.click_count} link
                    {r.click_count === 1 ? "" : "s"}
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
    </View>
  );
};

const SmsNumbers: React.FC<{ member: CampaignGroupMember; report: CampaignReport; oneColumn: boolean }> = ({
  member,
  report,
  oneColumn,
}) => {
  const { campaign, recipientStats, clickStats } = report;
  const isLivePreviewOnly =
    recipientStats.preview_skipped > 0 && recipientStats.accepted === 0;
  return (
    <View style={styles.numbers}>
      {campaign.audience_name_snapshot ? (
        <Text style={styles.audienceLine}>Audience: {campaign.audience_name_snapshot}</Text>
      ) : null}
      {isLivePreviewOnly ? (
        <View style={styles.previewBanner}>
          <Text style={styles.previewBannerTitle}>Preview mode — no real texts went out</Text>
          <Text style={styles.previewBannerText}>
            Counts below show who would have received it.
          </Text>
        </View>
      ) : null}
      <Text style={styles.sectionLabel}>WHO IT WENT TO</Text>
      <View style={styles.statsGrid} testID="campaign-sms-numbers">
        <StatCell label="Sent" value={recipientStats.accepted} tone={semantic.success} oneColumn={oneColumn} />
        <StatCell label="Held for quiet hours" value={member.sms?.deferred ?? 0} oneColumn={oneColumn} />
        <StatCell label="Failed to send" value={recipientStats.failed} tone={semantic.warning} oneColumn={oneColumn} />
        <StatCell label="Preview only" value={recipientStats.preview_skipped} tone={textTokens.tertiary} oneColumn={oneColumn} />
      </View>
      <LinkClicks clickStats={clickStats} oneColumn={oneColumn} totalLabel="Link taps" uniqueLabel="Unique people who tapped" />
      <View style={styles.smsFacts}>
        <Text style={styles.smsFact}>Segments sent: {member.sms?.segmentsSent ?? 0}</Text>
        <Suspense fallback={null}>
          <SentSmsCost cost={member.cost} missing={SMS_COST_MISSING} />
        </Suspense>
      </View>
    </View>
  );
};

const PushNumbers: React.FC<{ member: CampaignGroupMember; oneColumn: boolean }> = ({ member, oneColumn }) => {
  const counts = member.push ?? { queued: 0, sent: 0, failed: 0, skipped: 0 };
  return (
    <View style={styles.numbers}>
      <Text style={styles.sectionLabel}>WHO IT WENT TO</Text>
      <View style={styles.statsGrid} testID="campaign-push-numbers">
        <StatCell label="Sent" value={counts.sent} tone={semantic.success} oneColumn={oneColumn} />
        <StatCell label="Not delivered" value={counts.failed} tone={semantic.warning} oneColumn={oneColumn} />
        <StatCell label="Skipped (muted or no device)" value={counts.skipped} tone={textTokens.tertiary} oneColumn={oneColumn} />
        {counts.queued > 0 ? <StatCell label="Waiting" value={counts.queued} oneColumn={oneColumn} /> : null}
      </View>
    </View>
  );
};

const LinkClicks: React.FC<{
  clickStats: CampaignReport["clickStats"];
  oneColumn: boolean;
  totalLabel: string;
  uniqueLabel: string;
}> = ({ clickStats, oneColumn, totalLabel, uniqueLabel }) => (
  <>
    <Text style={styles.sectionLabel}>LINK CLICKS</Text>
    <View style={styles.statsGrid}>
      <StatCell label={totalLabel} value={clickStats.total_clicks} oneColumn={oneColumn} />
      <StatCell label={uniqueLabel} value={clickStats.unique_clickers} oneColumn={oneColumn} />
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
  </>
);

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
  /** `null` = not tracked for this campaign; renders an em-dash, never 0. */
  value: number | null;
  tone?: string;
  percent?: number;
  state?: "measured" | "notMeasured" | "degraded";
  oneColumn: boolean;
}
/**
 * #2510 — `null` means UNKNOWN and renders an em-dash, not "0".
 *
 * A campaign sent before the Resend webhook existed has no delivery events.
 * Showing "Opened 0" for it would tell an organiser nobody read their email,
 * which is a claim we cannot make. Constitution rule 9: missing is hidden,
 * never faked.
 */
const StatCell: React.FC<StatCellProps> = ({
  label,
  value,
  tone,
  percent,
  state = value === null ? "notMeasured" : "measured",
  oneColumn,
}) => {
  const roundedPercent =
    typeof percent === "number" && Number.isFinite(percent)
      ? Math.round(percent)
      : null;
  const a11yLabel =
    state === "degraded"
      ? `${label}: temporarily unavailable while tracking catches up`
      : value === null
        ? `${label}: not measured`
        : label === "Opened"
          ? `Opened: ${value} tracked email${value === 1 ? "" : "s"} opened, ${roundedPercent ?? 0} percent`
          : `${label}: ${value}`;
  return (
    <View
      style={[
        styles.statCell,
        Platform.OS === "android" ? styles.statCellAndroid : null,
        oneColumn ? styles.statCellOneColumn : null,
      ]}
      accessible
      accessibilityLabel={a11yLabel}
    >
      <Text style={styles.statLabel}>{label}</Text>
      <View style={styles.statValueRow}>
        <Text
          style={[
            styles.statValue,
            tone !== undefined ? { color: tone } : null,
          ]}
        >
          {value === null ? "—" : value}
        </Text>
        {roundedPercent !== null && value !== null ? (
          <Text style={styles.statPercent}>{roundedPercent}%</Text>
        ) : null}
      </View>
    </View>
  );
};

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
    // paddingBottom is injected per-render via useStickyFooterOffset()
    // (ORCH-0889).
    gap: spacing.md,
  },
  scrollContentWide: {
    width: "100%",
    maxWidth: 1120,
    alignSelf: "center",
  },
  methodBody: {
    gap: spacing.md,
  },
  statusBlock: {
    gap: spacing.xs,
  },
  statusHeadline: {
    ...typography.h3,
    color: textTokens.primary,
  },
  statusDetail: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  keepEditing: {
    alignSelf: "flex-start",
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: accent.warm,
    backgroundColor: accent.tint,
    marginTop: spacing.xs,
  },
  keepEditingPressed: {
    opacity: 0.85,
  },
  keepEditingLabel: {
    ...typography.bodySm,
    fontWeight: "600",
    color: textTokens.primary,
  },
  column: {
    gap: spacing.md,
  },
  columnChild: {
    gap: spacing.sm,
  },
  wideRow: {
    flexDirection: "row",
    gap: spacing.lg,
    alignItems: "flex-start",
  },
  previewColumn: {
    flexGrow: 5,
    flexBasis: 0,
    minWidth: 360,
    maxWidth: 520,
    gap: spacing.sm,
  },
  statsColumn: {
    flexGrow: 6,
    flexBasis: 0,
    minWidth: 320,
    gap: spacing.sm,
  },
  previewCard: {
    borderRadius: radius.xl,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
  },
  previewCardAndroid: {
    // Android glass policy: an opaque backdrop, never a translucent tint.
    backgroundColor: androidOpaque.rowFill,
    borderColor: androidOpaque.rowBorder,
  },
  sourceLabel: {
    ...typography.bodySm,
    color: textTokens.tertiary,
  },
  previewLoading: {
    paddingVertical: spacing.xl,
    alignItems: "center",
  },
  numbers: {
    gap: spacing.sm,
  },
  numbersLater: {
    ...typography.body,
    color: textTokens.secondary,
  },
  numbersLoading: {
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
  audienceLine: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  smsFacts: {
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
  },
  smsFact: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  previewBanner: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: semantic.warningTint,
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
  statCellAndroid: {
    backgroundColor: androidOpaque.rowFill,
    borderColor: androidOpaque.rowBorder,
    elevation: 0,
    overflow: "hidden",
  },
  statCellOneColumn: {
    flexBasis: "100%",
  },
  statLabel: {
    ...typography.labelCap,
    color: textTokens.tertiary,
  },
  statValue: {
    ...typography.h3,
    color: textTokens.primary,
  },
  statValueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.xs,
  },
  statPercent: {
    ...typography.bodySm,
    color: textTokens.secondary,
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
  trackingDegraded: {
    ...typography.bodySm,
    color: textTokens.secondary,
    marginTop: spacing.sm,
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

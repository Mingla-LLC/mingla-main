/**
 * Reconciliation route — Cycle 13 J-R1 + J-R2 + J-R3 cross-source reconciliation summary.
 *
 * Per Cycle 13 + DEC-095 (11 architectural decisions locked):
 *   D-13-1: NEW route (mirrors Cycle 12 J-D5 pattern; supersets door-only card)
 *   D-13-2: Always-visible permission-gated; copy adapts per status
 *   D-13-3: VIEW_RECONCILIATION = finance_manager (rank 30)
 *   D-13-4: D1+D2+D3 ADVISORY-only; D4 informational ("no-shows")
 *   D-13-5: Warm-orange (accent.warm) for D1/D2/D3 visual severity
 *   D-13-6: "No-shows" (past/cancelled) / "Waiting" (live/upcoming)
 *   D-13-7: PDF DEFERRED to B-cycle (CTA renders disabled with "B-cycle" caption)
 *   D-13-8: CSV with Gross/Refunded/Net columns + summary stanza prefix
 *   D-13-9: filename {slug}-reconciliation-{YYYY-MM-DD}.csv
 *   D-13-10: payoutEstimate split (online×0.96 + door×1.0)
 *   D-13-11: audit_log integration DEFERRED entirely
 *
 * Selector pattern rule (Cycle 9c v2 + Cycle 12 lesson): ALL multi-record reads use raw
 * `entries` selector + useMemo. NEVER subscribe to fresh-array selectors directly.
 *
 * I-21: operator-side route. Uses useAuth via useCurrentBrandRole. NEVER imported by
 * anon-tolerant buyer routes (app/o/, app/e/, app/checkout/).
 *
 * I-27 defensive: scans deduped by ticketId via Set in computeReconciliation.
 *
 * ORCH-0710: ALL hooks declared BEFORE any conditional early-return shell.
 *
 * [TRANSITIONAL] payoutEstimate uses 4% Stripe-fee stub on online revenue. EXIT: B-cycle
 * Stripe payout API integration + Stripe Terminal SDK fee schedules.
 *
 * Per Cycle 13 SPEC §4.3.2.
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  accent,
  canvas,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../../src/constants/designSystem";
import { useAuth } from "../../../src/context/AuthContext";
import { useCurrentBrandRole } from "../../../src/hooks/useCurrentBrandRole";
import { useCurrentBrandStore } from "../../../src/store/currentBrandStore";
import { useDoorSalesStore } from "../../../src/store/doorSalesStore";
import { useGuestStore } from "../../../src/store/guestStore";
import { useLiveEventStore } from "../../../src/store/liveEventStore";
import { useOrderStore } from "../../../src/store/orderStore";
import { useScanStore } from "../../../src/store/scanStore";
import {
  canPerformAction,
  gateCaptionFor,
} from "../../../src/utils/permissionGates";
import { formatGbp } from "../../../src/utils/currency";
import { formatDraftDateLine } from "../../../src/utils/eventDateDisplay";
import { deriveLiveStatus } from "../../../src/utils/eventLifecycle";
import { exportReconciliationCsv } from "../../../src/utils/guestCsvExport";
import {
  EMPTY_SUMMARY,
  computeReconciliation,
  type DiscrepancyEntry,
  type EventLifecycleStatus,
  type PaymentMethodKey,
  type ReconciliationSummary,
} from "../../../src/utils/reconciliation";

import { EmptyState } from "../../../src/components/ui/EmptyState";
import { Icon } from "../../../src/components/ui/Icon";
import { IconChrome } from "../../../src/components/ui/IconChrome";
import { Toast } from "../../../src/components/ui/Toast";

// ============================================================
// Reconciliation Route
// ============================================================

export default function ReconciliationRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const eventId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { user } = useAuth();
  const operatorAccountId = user?.id ?? "anonymous";

  // ---- All hooks declared BEFORE early returns (ORCH-0710) ----
  const event = useLiveEventStore((s) =>
    typeof eventId === "string"
      ? s.events.find((e) => e.id === eventId) ?? null
      : null,
  );
  const brand = useCurrentBrandStore((s) =>
    event !== null
      ? s.brands.find((b) => b.id === event.brandId) ?? null
      : null,
  );
  const { rank } = useCurrentBrandRole(brand?.id ?? null);

  // Raw entries + useMemo per selector pattern rule (T-41 grep gate)
  const allOrderEntries = useOrderStore((s) => s.entries);
  const allDoorEntries = useDoorSalesStore((s) => s.entries);
  const allCompEntries = useGuestStore((s) => s.entries);
  const allScanEntries = useScanStore((s) => s.entries);

  const summary = useMemo<ReconciliationSummary>(() => {
    if (event === null || typeof eventId !== "string") return EMPTY_SUMMARY;
    return computeReconciliation({
      eventId,
      status: deriveLiveStatus(event),
      eventName: event.name,
      orderEntries: allOrderEntries,
      doorEntries: allDoorEntries,
      compEntries: allCompEntries,
      scanEntries: allScanEntries,
    });
  }, [
    event,
    eventId,
    allOrderEntries,
    allDoorEntries,
    allCompEntries,
    allScanEntries,
  ]);

  // Pre-filtered arrays for CSV export (avoids re-filtering inside exportReconciliationCsv)
  const eventOrders = useMemo(
    () =>
      event === null
        ? []
        : allOrderEntries.filter((o) => o.eventId === event.id),
    [allOrderEntries, event],
  );
  const eventDoorSales = useMemo(
    () =>
      event === null
        ? []
        : allDoorEntries.filter((s) => s.eventId === event.id),
    [allDoorEntries, event],
  );
  const eventComps = useMemo(
    () =>
      event === null
        ? []
        : allCompEntries.filter((c) => c.eventId === event.id),
    [allCompEntries, event],
  );

  // ---- UI state ----
  const [byScannerExpanded, setByScannerExpanded] = useState<boolean>(false);
  const [exporting, setExporting] = useState<boolean>(false);
  const [toast, setToast] = useState<{ visible: boolean; message: string }>({
    visible: false,
    message: "",
  });

  const showToast = useCallback((message: string): void => {
    setToast({ visible: true, message });
  }, []);

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else if (typeof eventId === "string") {
      router.replace(`/event/${eventId}` as never);
    }
  }, [router, eventId]);

  const hasAnyData = useMemo<boolean>(
    () =>
      summary.totalLiveTickets > 0 ||
      summary.uniqueScannedTickets > 0 ||
      summary.scanDups +
        summary.scanWrongEvent +
        summary.scanNotFound +
        summary.scanVoid +
        summary.scanCancelled >
        0,
    [summary],
  );

  const handleExport = useCallback(async (): Promise<void> => {
    if (event === null || !hasAnyData || exporting) return;
    setExporting(true);
    try {
      // Cycle 13 v2 (D-CYCLE13-IMPL-6): honest toast per export result.
      // Web → file actually downloaded. Native shared → user picked a
      // destination. Native dismissed → silent (no toast — user knew they
      // dismissed; pre-rework wrongly toasted success on this path).
      const result = await exportReconciliationCsv({
        event,
        orders: eventOrders,
        doorSales: eventDoorSales,
        comps: eventComps,
        summary,
      });
      if (result.method === "downloaded") {
        showToast("Downloaded reconciliation report.");
      } else if (result.method === "shared") {
        showToast("Reconciliation CSV shared.");
      }
      // result.method === "dismissed" → silent.
    } catch (_err) {
      showToast("Couldn't export. Tap to try again.");
    } finally {
      setExporting(false);
    }
  }, [
    event,
    eventOrders,
    eventDoorSales,
    eventComps,
    summary,
    hasAnyData,
    exporting,
    showToast,
  ]);

  const toggleByScanner = useCallback((): void => {
    setByScannerExpanded((v) => !v);
  }, []);

  // ---- Early returns (after all hooks per ORCH-0710) ----

  // 1. Not found shell
  if (event === null || typeof eventId !== "string") {
    return (
      <View
        style={[
          styles.host,
          { paddingTop: insets.top, backgroundColor: canvas.discover },
        ]}
      >
        <ChromeRow onBack={handleBack} />
        <View style={styles.emptyHost}>
          <EmptyState
            illustration="ticket"
            title="Event not found"
            description="It may have been deleted."
          />
        </View>
      </View>
    );
  }

  // 2. Permission gate shell — friendly, NOT a 404
  if (!canPerformAction(rank, "VIEW_RECONCILIATION")) {
    return (
      <View
        style={[
          styles.host,
          { paddingTop: insets.top, backgroundColor: canvas.discover },
        ]}
      >
        <ChromeRow onBack={handleBack} />
        <View style={styles.emptyHost}>
          <EmptyState
            illustration="shield"
            title="Restricted"
            description={gateCaptionFor("VIEW_RECONCILIATION")}
          />
        </View>
      </View>
    );
  }

  // 3. Populated render — full screen
  const dateLine = formatDraftDateLine(event);

  return (
    <View
      style={[
        styles.host,
        { paddingTop: insets.top, backgroundColor: canvas.discover },
      ]}
    >
      {/* Chrome */}
      <View style={styles.chromeRow}>
        <IconChrome
          icon="close"
          size={36}
          onPress={handleBack}
          accessibilityLabel="Back"
        />
        <Text style={styles.chromeTitle}>Reconciliation</Text>
        <View style={styles.chromeRight}>
          <IconChrome
            icon="download"
            size={36}
            onPress={handleExport}
            accessibilityLabel="Export reconciliation CSV"
            disabled={!hasAnyData || exporting}
          />
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 120 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Headline banner — adaptive copy per status */}
        <HeadlineBanner
          headline={summary.headlineCopy}
          eventName={event.name}
          dateLine={dateLine}
        />

        {/* TICKETS section */}
        <TicketsSection summary={summary} hasAnyData={hasAnyData} />

        {/* REVENUE section */}
        <RevenueSection summary={summary} hasAnyData={hasAnyData} />

        {/* SCANS section */}
        <ScansSection
          summary={summary}
          status={summary.status}
          operatorAccountId={operatorAccountId}
          byScannerExpanded={byScannerExpanded}
          onToggleByScanner={toggleByScanner}
        />

        {/* DISCREPANCIES section — only renders if non-empty (Const #9: silent when clean) */}
        {summary.discrepancies.length > 0 ? (
          <DiscrepanciesSection entries={summary.discrepancies} />
        ) : null}

        {/* EXPORT section */}
        <ExportSection
          hasAnyData={hasAnyData}
          exporting={exporting}
          onExportCsv={handleExport}
        />
      </ScrollView>

      {/* Toast — absolute-wrapped per memory rule feedback_toast_needs_absolute_wrap */}
      <View style={styles.toastWrap} pointerEvents="box-none">
        <Toast
          visible={toast.visible}
          kind="info"
          message={toast.message}
          onDismiss={() => setToast({ visible: false, message: "" })}
        />
      </View>
    </View>
  );
}

// ============================================================
// Chrome (shared between not-found / permission shells)
// ============================================================

interface ChromeRowProps {
  onBack: () => void;
}

const ChromeRow: React.FC<ChromeRowProps> = ({ onBack }) => (
  <View style={styles.chromeRow}>
    <IconChrome
      icon="close"
      size={36}
      onPress={onBack}
      accessibilityLabel="Back"
    />
    <Text style={styles.chromeTitle}>Reconciliation</Text>
    <View style={styles.chromeRightSlot} />
  </View>
);

// ============================================================
// Headline banner
// ============================================================

interface HeadlineBannerProps {
  headline: string;
  eventName: string;
  dateLine: string;
}

const HeadlineBanner: React.FC<HeadlineBannerProps> = ({
  headline,
  eventName,
  dateLine,
}) => (
  <View style={styles.headlineBanner}>
    <Text style={styles.headlineText}>{headline}</Text>
    <Text style={styles.headlineSubline} numberOfLines={1}>
      {eventName}
      {dateLine.length > 0 ? ` · ${dateLine}` : ""}
    </Text>
  </View>
);

// ============================================================
// Tickets section
// ============================================================

interface TicketsSectionProps {
  summary: ReconciliationSummary;
  hasAnyData: boolean;
}

const TicketsSection: React.FC<TicketsSectionProps> = ({
  summary,
  hasAnyData,
}) => (
  <View style={styles.section}>
    <Text style={styles.sectionHeading}>TICKETS</Text>
    <SectionRow
      label="Online sold"
      value={hasAnyData ? `${summary.onlineLiveTickets}` : "—"}
      subValue={hasAnyData ? formatGbp(summary.onlineRevenue) : ""}
    />
    <SectionRow
      label="Door sold"
      value={hasAnyData ? `${summary.doorLiveTickets}` : "—"}
      subValue={hasAnyData ? formatGbp(summary.doorRevenue) : ""}
    />
    <SectionRow
      label="Comps"
      value={hasAnyData ? `${summary.compTickets}` : "—"}
    />
    <SectionDivider />
    <SectionRow
      label="TOTAL LIVE"
      value={`${summary.totalLiveTickets}`}
      variant="big"
    />
  </View>
);

// ============================================================
// Revenue section
// ============================================================

interface RevenueSectionProps {
  summary: ReconciliationSummary;
  hasAnyData: boolean;
}

const RevenueSection: React.FC<RevenueSectionProps> = ({
  summary,
  hasAnyData,
}) => {
  // Stripe fee stub on online revenue only (D-13-10).
  // Door revenue contributes 1.0 (cash zero fee; card_reader/NFC fees ship B-cycle).
  const stripeFeeOnline = Math.round(summary.onlineRevenue * 4) / 100;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionHeading}>REVENUE</Text>
      {/* Online methods */}
      <SectionRow
        label="Card (online)"
        value={formatGbp(summary.revenueByMethod.card)}
      />
      <SectionRow
        label="Apple Pay"
        value={formatGbp(summary.revenueByMethod.apple_pay)}
      />
      <SectionRow
        label="Google Pay"
        value={formatGbp(summary.revenueByMethod.google_pay)}
      />
      <SectionRow
        label="Free (online)"
        value={formatGbp(summary.revenueByMethod.free)}
      />
      {/* Door methods */}
      <SectionRow
        label="Cash (door)"
        value={formatGbp(summary.revenueByMethod.cash)}
      />
      <SectionRow
        label="Card reader (door)"
        value={formatGbp(summary.revenueByMethod.card_reader)}
        hint="B-cycle"
      />
      <SectionRow
        label="NFC tap (door)"
        value={formatGbp(summary.revenueByMethod.nfc)}
        hint="B-cycle"
      />
      <SectionRow
        label="Manual (door)"
        value={formatGbp(summary.revenueByMethod.manual)}
      />
      <SectionDivider />
      <SectionRow label="Gross" value={formatGbp(summary.grossRevenue)} />
      <SectionRow
        label="Refunded (online)"
        value={`−${formatGbp(summary.onlineRefunded)}`}
        variant="warn"
      />
      <SectionRow
        label="Refunded (door)"
        value={`−${formatGbp(summary.doorRefunded)}`}
        variant="warn"
      />
      <SectionDivider />
      <SectionRow
        label="NET"
        value={hasAnyData ? formatGbp(summary.grossRevenue) : "—"}
        variant="big"
      />
      <SectionRow
        label="Stripe fee (online, 4% stub)"
        value={`−${formatGbp(stripeFeeOnline)}`}
        variant="muted"
      />
      <SectionRow label="Door fee" value={formatGbp(0)} variant="muted" />
      <SectionRow
        label="PAYOUT (estimated)"
        value={formatGbp(summary.payoutEstimate)}
        variant="mid"
        hint="TRANSITIONAL — B-cycle Stripe payout API"
      />
    </View>
  );
};

// ============================================================
// Scans section
// ============================================================

interface ScansSectionProps {
  summary: ReconciliationSummary;
  status: EventLifecycleStatus;
  operatorAccountId: string;
  byScannerExpanded: boolean;
  onToggleByScanner: () => void;
}

const ScansSection: React.FC<ScansSectionProps> = ({
  summary,
  status,
  operatorAccountId,
  byScannerExpanded,
  onToggleByScanner,
}) => {
  const pct =
    summary.totalLiveTickets > 0
      ? Math.round(
          (summary.uniqueScannedTickets / summary.totalLiveTickets) * 100,
        )
      : 0;
  const unscannedLabel =
    status === "past" || status === "cancelled" ? "No-shows" : "Waiting";
  const scannerKeys = Object.keys(summary.scansByScanner);

  return (
    <View style={styles.section}>
      <Text style={styles.sectionHeading}>SCANS</Text>
      <SectionRow
        label="Scanned in"
        value={
          summary.totalLiveTickets > 0
            ? `${summary.uniqueScannedTickets} of ${summary.totalLiveTickets} · ${pct}%`
            : `${summary.uniqueScannedTickets}`
        }
      />
      <SectionRow
        label={unscannedLabel}
        value={`${summary.unscannedTickets}`}
        variant={
          status === "past" || status === "cancelled" ? "muted" : undefined
        }
      />
      <SectionRow label="Duplicate scans" value={`${summary.scanDups}`} />
      <SectionRow label="Wrong event" value={`${summary.scanWrongEvent}`} />
      <SectionRow label="Not-found" value={`${summary.scanNotFound}`} />
      <SectionRow label="Voided" value={`${summary.scanVoid}`} />
      <SectionRow label="Cancelled" value={`${summary.scanCancelled}`} />
      {scannerKeys.length > 0 ? (
        <Pressable
          onPress={onToggleByScanner}
          accessibilityRole="button"
          accessibilityLabel={
            byScannerExpanded
              ? "Hide by-scanner breakdown"
              : "Show by-scanner breakdown"
          }
          style={styles.byScannerToggle}
        >
          <Text style={styles.byScannerToggleText}>
            {byScannerExpanded ? "Hide by scanner" : "View by scanner"}
          </Text>
        </Pressable>
      ) : null}
      {byScannerExpanded
        ? scannerKeys.map((scannerKey) => {
            const count = summary.scansByScanner[scannerKey];
            const label =
              scannerKey === operatorAccountId
                ? "You (operator)"
                : `Scanner ${scannerKey.slice(0, 8)}`;
            return (
              <View key={scannerKey} style={styles.scannerCard}>
                <Text style={styles.scannerName}>{label}</Text>
                <Text style={styles.scannerCount}>
                  {count} scan{count === 1 ? "" : "s"}
                </Text>
              </View>
            );
          })
        : null}
    </View>
  );
};

// ============================================================
// Discrepancies section (only renders if entries.length > 0)
// ============================================================

interface DiscrepanciesSectionProps {
  entries: DiscrepancyEntry[];
}

const DiscrepanciesSection: React.FC<DiscrepanciesSectionProps> = ({
  entries,
}) => (
  <View style={styles.section}>
    <Text style={styles.sectionHeading}>DISCREPANCIES</Text>
    {entries.map((entry, idx) => (
      <View key={`${entry.kind}-${idx}`} style={styles.discrepancyRow}>
        <View style={styles.discrepancyIconBadge}>
          <Icon name="flag" size={16} color={accent.warm} />
        </View>
        <View style={styles.discrepancyCol}>
          <Text style={styles.discrepancyCopy} numberOfLines={2}>
            {entry.copy}
          </Text>
          <Text style={styles.discrepancyHint} numberOfLines={3}>
            {entry.followupHint}
          </Text>
        </View>
      </View>
    ))}
  </View>
);

// ============================================================
// Export section
// ============================================================

interface ExportSectionProps {
  hasAnyData: boolean;
  exporting: boolean;
  onExportCsv: () => void;
}

const ExportSection: React.FC<ExportSectionProps> = ({
  hasAnyData,
  exporting,
  onExportCsv,
}) => (
  <View style={styles.section}>
    <Text style={styles.sectionHeading}>EXPORT</Text>
    <Pressable
      onPress={onExportCsv}
      disabled={!hasAnyData || exporting}
      accessibilityRole="button"
      accessibilityLabel="Export reconciliation CSV"
      style={({ pressed }) => [
        styles.exportPrimaryCta,
        (!hasAnyData || exporting) && styles.exportCtaDisabled,
        pressed && hasAnyData && !exporting && styles.exportCtaPressed,
      ]}
    >
      <Icon name="download" size={18} color={accent.warm} />
      <Text style={styles.exportPrimaryLabel}>
        {exporting ? "Exporting..." : "Export reconciliation CSV"}
      </Text>
    </Pressable>
    {!hasAnyData ? (
      <Text style={styles.exportCaption}>No data to export yet.</Text>
    ) : null}
    {/* "Email PDF report" — DEFERRED to B-cycle per D-13-7. Visibly disabled, never tappable (Const #1 + #7). */}
    <View style={styles.exportSecondaryDisabled}>
      <Icon name="mail" size={18} color={textTokens.tertiary} />
      <Text style={styles.exportSecondaryLabel}>Email PDF report</Text>
      <Text style={styles.exportSecondaryHint}>B-cycle</Text>
    </View>
  </View>
);

// ============================================================
// Section primitives (composed inline)
// ============================================================

type SectionRowVariant = "big" | "mid" | "warn" | "muted";

interface SectionRowProps {
  label: string;
  value: string;
  subValue?: string;
  hint?: string;
  variant?: SectionRowVariant;
}

const SectionRow: React.FC<SectionRowProps> = ({
  label,
  value,
  subValue,
  hint,
  variant,
}) => {
  const labelStyle =
    variant === "big" ? styles.rowLabelStrong : styles.rowLabel;
  const valueStyle =
    variant === "big"
      ? styles.rowValueStrong
      : variant === "mid"
        ? styles.rowValueMid
        : variant === "warn"
          ? styles.rowValueWarn
          : variant === "muted"
            ? styles.rowValueMuted
            : styles.rowValue;
  return (
    <View style={styles.row}>
      <View style={styles.rowLabelCol}>
        <Text style={labelStyle}>{label}</Text>
        {hint !== undefined ? (
          <Text style={styles.rowLabelHint} numberOfLines={1}>
            ({hint})
          </Text>
        ) : null}
      </View>
      <View style={styles.rowValueCol}>
        <Text style={valueStyle}>{value}</Text>
        {subValue !== undefined && subValue.length > 0 ? (
          <Text style={styles.rowSubValue}>{subValue}</Text>
        ) : null}
      </View>
    </View>
  );
};

const SectionDivider: React.FC = () => <View style={styles.sectionDivider} />;

// ============================================================
// Styles
// ============================================================
//
// All inline colors hex/rgb/rgba/hsl per memory rule feedback_rn_color_formats.
// No oklch/lab/lch/color-mix anywhere.

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },

  // Chrome -----------------------------------------------------------
  chromeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  chromeTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    color: textTokens.primary,
    letterSpacing: -0.2,
    textAlign: "center",
  },
  chromeRight: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  chromeRightSlot: {
    width: 36,
  },

  // Scroll -----------------------------------------------------------
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },
  emptyHost: {
    paddingTop: spacing.xl,
  },

  // Headline ---------------------------------------------------------
  headlineBanner: {
    padding: spacing.md - 2,
    borderRadius: radiusTokens.md,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  headlineText: {
    fontSize: 14,
    fontWeight: "700",
    color: textTokens.primary,
    letterSpacing: -0.1,
    marginBottom: 4,
  },
  headlineSubline: {
    fontSize: 12,
    color: textTokens.secondary,
  },

  // Section card -----------------------------------------------------
  section: {
    padding: spacing.md,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  sectionHeading: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: textTokens.tertiary,
    marginBottom: spacing.sm,
    textTransform: "uppercase",
  },
  sectionDivider: {
    marginVertical: spacing.sm,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },

  // Section row ------------------------------------------------------
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    paddingVertical: 4,
  },
  rowLabelCol: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
    flexShrink: 1,
  },
  rowValueCol: {
    alignItems: "flex-end",
    flexShrink: 0,
  },
  rowLabel: {
    fontSize: 13,
    color: textTokens.secondary,
  },
  rowLabelStrong: {
    fontSize: 14,
    fontWeight: "700",
    color: textTokens.primary,
  },
  rowLabelHint: {
    fontSize: 11,
    color: textTokens.quaternary,
  },
  rowValue: {
    fontSize: 14,
    fontWeight: "500",
    color: textTokens.primary,
    fontVariant: ["tabular-nums"],
  },
  rowValueWarn: {
    fontSize: 14,
    fontWeight: "500",
    color: accent.warm,
    fontVariant: ["tabular-nums"],
  },
  rowValueMid: {
    fontSize: 16,
    fontWeight: "600",
    color: textTokens.primary,
    fontVariant: ["tabular-nums"],
  },
  rowValueStrong: {
    fontSize: 18,
    fontWeight: "700",
    color: textTokens.primary,
    fontVariant: ["tabular-nums"],
  },
  rowValueMuted: {
    fontSize: 13,
    color: textTokens.tertiary,
    fontVariant: ["tabular-nums"],
  },
  rowSubValue: {
    fontSize: 11,
    color: textTokens.tertiary,
    fontVariant: ["tabular-nums"],
    marginTop: 2,
  },

  // By-scanner expand ------------------------------------------------
  byScannerToggle: {
    marginTop: spacing.sm,
    paddingVertical: 6,
  },
  byScannerToggleText: {
    fontSize: 13,
    fontWeight: "600",
    color: accent.warm,
  },
  scannerCard: {
    marginTop: spacing.sm,
    padding: spacing.sm + 2,
    borderRadius: radiusTokens.sm,
    backgroundColor: glass.tint.profileElevated,
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  scannerName: {
    fontSize: 13,
    fontWeight: "600",
    color: textTokens.primary,
  },
  scannerCount: {
    fontSize: 13,
    color: textTokens.tertiary,
    fontVariant: ["tabular-nums"],
  },

  // Discrepancies ----------------------------------------------------
  discrepancyRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    paddingVertical: 6,
  },
  discrepancyIconBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(235, 120, 37, 0.18)",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  discrepancyCol: {
    flex: 1,
    minWidth: 0,
  },
  discrepancyCopy: {
    fontSize: 13,
    fontWeight: "600",
    color: textTokens.primary,
    marginBottom: 2,
  },
  discrepancyHint: {
    fontSize: 11,
    color: textTokens.tertiary,
    lineHeight: 15,
  },

  // Export -----------------------------------------------------------
  exportPrimaryCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.md - 2,
    borderRadius: radiusTokens.md,
    backgroundColor: "rgba(235, 120, 37, 0.10)",
    borderWidth: 1,
    borderColor: "rgba(235, 120, 37, 0.30)",
  },
  exportCtaDisabled: {
    opacity: 0.5,
  },
  exportCtaPressed: {
    opacity: 0.7,
  },
  exportPrimaryLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: accent.warm,
  },
  exportCaption: {
    marginTop: 6,
    fontSize: 11,
    color: textTokens.tertiary,
    textAlign: "center",
  },
  exportSecondaryDisabled: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md - 2,
    marginTop: spacing.sm,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: "rgba(255, 255, 255, 0.02)",
    opacity: 0.6,
  },
  exportSecondaryLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
    color: textTokens.tertiary,
  },
  exportSecondaryHint: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 1.0,
    color: textTokens.quaternary,
    textTransform: "uppercase",
  },

  // Toast ------------------------------------------------------------
  toastWrap: {
    position: "absolute",
    top: 80,
    left: 0,
    right: 0,
    zIndex: 100,
    elevation: 12,
  },
});

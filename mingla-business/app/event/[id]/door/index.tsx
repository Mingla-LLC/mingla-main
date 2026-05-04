/**
 * /event/[id]/door — J-D2 Door Sales list view + J-D5 inline reconciliation (Cycle 12).
 *
 * Operator-side ledger of in-person door sales for the event. Top of
 * route renders the reconciliation summary card (J-D5: cash / card / nfc
 * / manual / refunded / NET, plus a "By scanner" expandable breakdown
 * and an Export CSV button). Below that, sales list newest-first with
 * row-level avatars, payment-method pill, status pill, and tap-to-detail
 * routing to /event/{id}/door/{saleId}.
 *
 * I-21: operator-side route. Uses useAuth.
 * I-29: door sales live in useDoorSalesStore ONLY — never as phantom orders.
 *
 * TESTING MODE banner reused from DoorSaleNewSheet pattern (Const #7).
 *
 * Per Cycle 12 SPEC §4.12 / §5/J-D2 + J-D5.
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
} from "../../../../src/constants/designSystem";
import {
  useDoorSalesStore,
  type DoorPaymentMethod,
  type DoorSaleRecord,
} from "../../../../src/store/doorSalesStore";
import { useLiveEventStore } from "../../../../src/store/liveEventStore";
import { useCurrentBrandStore } from "../../../../src/store/currentBrandStore";
import { useAuth } from "../../../../src/context/AuthContext";
import { formatGbp } from "../../../../src/utils/currency";
import { exportDoorSalesCsv } from "../../../../src/utils/guestCsvExport";

import { DoorSaleNewSheet } from "../../../../src/components/door/DoorSaleNewSheet";
import { EmptyState } from "../../../../src/components/ui/EmptyState";
import { Icon } from "../../../../src/components/ui/Icon";
import { IconChrome } from "../../../../src/components/ui/IconChrome";
import { Pill } from "../../../../src/components/ui/Pill";
import { Toast } from "../../../../src/components/ui/Toast";
import { useCurrentBrandRole } from "../../../../src/hooks/useCurrentBrandRole";
import { canPerformAction } from "../../../../src/utils/permissionGates";

// ---- Helpers --------------------------------------------------------

const RELATIVE_TIME_MS = {
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
};

const formatRelativeTime = (iso: string): string => {
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const delta = now - then;
  if (delta < RELATIVE_TIME_MS.minute) return "just now";
  if (delta < RELATIVE_TIME_MS.hour) {
    return `${Math.floor(delta / RELATIVE_TIME_MS.minute)}m ago`;
  }
  if (delta < RELATIVE_TIME_MS.day) {
    return `${Math.floor(delta / RELATIVE_TIME_MS.hour)}h ago`;
  }
  return `${Math.floor(delta / RELATIVE_TIME_MS.day)}d ago`;
};

const hashStringToHue = (s: string): number => {
  let hash = 0;
  for (let i = 0; i < s.length; i += 1) {
    hash = (hash * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
};

const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter((p) => p.length > 0);
  if (parts.length === 0) return "W";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
};

const summarizeDoorTickets = (lines: DoorSaleRecord["lines"]): string => {
  if (lines.length === 0) return "—";
  if (lines.length === 1) {
    const l = lines[0];
    return `${l.quantity}× ${l.ticketNameAtSale}`;
  }
  const total = lines.reduce((s, l) => s + l.quantity, 0);
  return `${total} tickets`;
};

interface PaymentPillSpec {
  variant: "info" | "warn" | "draft" | "accent";
  label: string;
}

const doorPaymentPill = (
  method: DoorPaymentMethod,
  status: DoorSaleRecord["status"],
): PaymentPillSpec => {
  if (status === "refunded_full") return { variant: "warn", label: "REFUNDED" };
  if (status === "refunded_partial") {
    return { variant: "accent", label: "PARTIAL" };
  }
  switch (method) {
    case "cash":
      return { variant: "info", label: "CASH" };
    case "card_reader":
      return { variant: "info", label: "CARD" };
    case "nfc":
      return { variant: "info", label: "NFC" };
    case "manual":
      return { variant: "draft", label: "MANUAL" };
    default: {
      const _exhaust: never = method;
      return _exhaust;
    }
  }
};

const PAYMENT_METHOD_LABELS: Record<DoorPaymentMethod, string> = {
  cash: "Cash",
  card_reader: "Card reader",
  nfc: "NFC tap",
  manual: "Manual",
};

// ---- Screen ---------------------------------------------------------

export default function EventDoorSalesListRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const eventId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { user } = useAuth();
  const operatorAccountId = user?.id ?? "anonymous";

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

  // Cycle 13 — permission gate for the "View full reconciliation" polish CTA
  // (D-CYCLE13-RECON-FOR-4). Same VIEW_RECONCILIATION rank used by the
  // dedicated reconciliation route + Event Detail action grid tile.
  const { rank: currentRank } = useCurrentBrandRole(brand?.id ?? null);
  const canViewReconciliation = canPerformAction(
    currentRank,
    "VIEW_RECONCILIATION",
  );

  // Cycle 12 — raw entries + useMemo per selector pattern rule (SC-31 / T-38).
  const allEntries = useDoorSalesStore((s) => s.entries);
  const eventSales = useMemo<DoorSaleRecord[]>(() => {
    if (typeof eventId !== "string") return [];
    return allEntries
      .filter((s) => s.eventId === eventId)
      .sort(
        (a, b) =>
          new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime(),
      );
  }, [allEntries, eventId]);

  // Reconciliation totals — net of refunds, by payment method.
  const totalsByMethod = useMemo<Record<DoorPaymentMethod, number>>(() => {
    const totals: Record<DoorPaymentMethod, number> = {
      cash: 0,
      card_reader: 0,
      nfc: 0,
      manual: 0,
    };
    for (const s of eventSales) {
      const live = s.totalGbpAtSale - s.refundedAmountGbp;
      if (live <= 0) continue;
      totals[s.paymentMethod] += live;
    }
    return totals;
  }, [eventSales]);

  const totalsByScanner = useMemo<
    Record<string, Record<DoorPaymentMethod, number>>
  >(() => {
    const map: Record<string, Record<DoorPaymentMethod, number>> = {};
    for (const s of eventSales) {
      const live = s.totalGbpAtSale - s.refundedAmountGbp;
      if (live <= 0) continue;
      const scannerKey = s.recordedBy;
      const existing =
        map[scannerKey] ??
        ({ cash: 0, card_reader: 0, nfc: 0, manual: 0 } as Record<
          DoorPaymentMethod,
          number
        >);
      existing[s.paymentMethod] += live;
      map[scannerKey] = existing;
    }
    return map;
  }, [eventSales]);

  const grossTotal = useMemo<number>(
    () => eventSales.reduce((sum, s) => sum + s.totalGbpAtSale, 0),
    [eventSales],
  );
  const refundedTotal = useMemo<number>(
    () => eventSales.reduce((sum, s) => sum + s.refundedAmountGbp, 0),
    [eventSales],
  );
  const netTotal = grossTotal - refundedTotal;

  // ---- UI state ----
  const [newSheetOpen, setNewSheetOpen] = useState<boolean>(false);
  const [byScannerExpanded, setByScannerExpanded] = useState<boolean>(false);
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

  const handleOpenSale = useCallback(
    (sale: DoorSaleRecord): void => {
      if (typeof eventId !== "string") return;
      router.push(`/event/${eventId}/door/${sale.id}` as never);
    },
    [router, eventId],
  );

  const handleNewSale = useCallback((): void => {
    setNewSheetOpen(true);
  }, []);

  // Cycle 13 — D-CYCLE13-RECON-FOR-4 polish: navigate to full cross-source reconciliation.
  const handleViewReconciliation = useCallback((): void => {
    if (typeof eventId === "string") {
      router.push(`/event/${eventId}/reconciliation` as never);
    }
  }, [router, eventId]);

  const handleNewSaleSuccess = useCallback(
    (sale: DoorSaleRecord): void => {
      setNewSheetOpen(false);
      const buyerName =
        sale.buyerName.length > 0 ? sale.buyerName : "Walk-up";
      showToast(`${buyerName} — sale recorded.`);
    },
    [showToast],
  );

  const handleExport = useCallback(async (): Promise<void> => {
    if (event === null) return;
    if (eventSales.length === 0) {
      showToast("No door sales to export yet.");
      return;
    }
    try {
      await exportDoorSalesCsv({ event, sales: eventSales });
      showToast(`Exported ${eventSales.length} door sale(s).`);
    } catch (_err) {
      showToast("Couldn't export. Tap to try again.");
    }
  }, [event, eventSales, showToast]);

  // ---- Not-found shell ----
  if (event === null || typeof eventId !== "string") {
    return (
      <View
        style={[
          styles.host,
          { paddingTop: insets.top, backgroundColor: canvas.discover },
        ]}
      >
        <View style={styles.chromeRow}>
          <IconChrome
            icon="close"
            size={36}
            onPress={handleBack}
            accessibilityLabel="Back"
          />
          <Text style={styles.chromeTitle}>Door Sales</Text>
          <View style={styles.chromeRightSlot} />
        </View>
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

  const scannerKeys = Object.keys(totalsByScanner);

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
        <Text style={styles.chromeTitle}>Door Sales</Text>
        <View style={styles.chromeRight}>
          <IconChrome
            icon="download"
            size={36}
            onPress={handleExport}
            accessibilityLabel="Export door sales CSV"
          />
          <IconChrome
            icon="plus"
            size={36}
            onPress={handleNewSale}
            accessibilityLabel="Record new door sale"
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
        keyboardShouldPersistTaps="handled"
      >
        {/* Cycle 13 — D-CYCLE13-RECON-FOR-4 polish: link to full cross-source
            reconciliation report (gated finance_manager+ rank 30). */}
        {canViewReconciliation ? (
          <Pressable
            onPress={handleViewReconciliation}
            accessibilityRole="button"
            accessibilityLabel="View full reconciliation report"
            style={({ pressed }) => [
              styles.viewReconCta,
              pressed && styles.viewReconCtaPressed,
            ]}
          >
            <Icon name="chart" size={16} color={accent.warm} />
            <Text style={styles.viewReconCtaLabel}>
              View full reconciliation report
            </Text>
            <Icon name="chevR" size={16} color={textTokens.tertiary} />
          </Pressable>
        ) : null}

        {/* TESTING MODE banner — same copy as DoorSaleNewSheet (Const #7). */}
        <View style={styles.banner}>
          <Text style={styles.bannerTitle}>TESTING MODE</Text>
          <Text style={styles.bannerBody}>
            Only Cash and Manual payments work today. Card reader and NFC
            tap-to-pay land when the backend ships in B-cycle.
          </Text>
        </View>

        {/* J-D5 reconciliation summary card */}
        <View style={styles.reconCard}>
          <Text style={styles.reconHeading}>Reconciliation</Text>

          <View style={styles.reconRow}>
            <Text style={styles.reconLabel}>Cash</Text>
            <Text style={styles.reconValue}>
              {formatGbp(totalsByMethod.cash)}
            </Text>
          </View>
          <View style={styles.reconRow}>
            <View style={styles.reconLabelCol}>
              <Text style={styles.reconLabel}>Card reader</Text>
              <Text style={styles.reconLabelHint}>
                ({formatGbp(totalsByMethod.card_reader)} — B-cycle)
              </Text>
            </View>
          </View>
          <View style={styles.reconRow}>
            <View style={styles.reconLabelCol}>
              <Text style={styles.reconLabel}>NFC tap</Text>
              <Text style={styles.reconLabelHint}>
                ({formatGbp(totalsByMethod.nfc)} — B-cycle)
              </Text>
            </View>
          </View>
          <View style={styles.reconRow}>
            <Text style={styles.reconLabel}>Manual</Text>
            <Text style={styles.reconValue}>
              {formatGbp(totalsByMethod.manual)}
            </Text>
          </View>

          <View style={styles.reconDivider} />
          <View style={styles.reconRow}>
            <Text style={styles.reconLabel}>Refunded</Text>
            <Text style={styles.reconValueWarn}>
              −{formatGbp(refundedTotal)}
            </Text>
          </View>
          <View style={styles.reconRow}>
            <Text style={styles.reconLabelStrong}>NET</Text>
            <Text style={styles.reconValueStrong}>{formatGbp(netTotal)}</Text>
          </View>

          {/* By-scanner expandable */}
          {scannerKeys.length > 0 ? (
            <Pressable
              onPress={() => setByScannerExpanded((v) => !v)}
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
                const totals = totalsByScanner[scannerKey];
                const scannerTotal =
                  totals.cash + totals.card_reader + totals.nfc + totals.manual;
                const scannerLabel =
                  scannerKey === operatorAccountId
                    ? "You (operator)"
                    : `Scanner ${scannerKey.slice(0, 8)}`;
                return (
                  <View key={scannerKey} style={styles.scannerCard}>
                    <Text style={styles.scannerName}>{scannerLabel}</Text>
                    <View style={styles.scannerSubRow}>
                      <Text style={styles.scannerSubLabel}>
                        Cash {formatGbp(totals.cash)} · Manual{" "}
                        {formatGbp(totals.manual)}
                      </Text>
                      <Text style={styles.scannerTotal}>
                        {formatGbp(scannerTotal)}
                      </Text>
                    </View>
                  </View>
                );
              })
            : null}
        </View>

        {/* Sales list */}
        {eventSales.length === 0 ? (
          <View style={styles.emptyHost}>
            <EmptyState
              illustration="ticket"
              title="No door sales yet"
              description="Tap + to record one."
              cta={{
                label: "Record sale",
                onPress: handleNewSale,
                variant: "primary",
              }}
            />
          </View>
        ) : (
          <View style={styles.list}>
            {eventSales.map((sale) => (
              <DoorSaleRowCard
                key={sale.id}
                sale={sale}
                onPress={() => handleOpenSale(sale)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      {/* New sale sheet */}
      {brand !== null ? (
        <DoorSaleNewSheet
          visible={newSheetOpen}
          event={event}
          brandId={brand.id}
          operatorAccountId={operatorAccountId}
          onClose={() => setNewSheetOpen(false)}
          onSuccess={handleNewSaleSuccess}
        />
      ) : null}

      {/* Toast */}
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

// ---- DoorSaleRowCard (composed inline) ----------------------------

interface DoorSaleRowCardProps {
  sale: DoorSaleRecord;
  onPress: () => void;
}

const DoorSaleRowCard: React.FC<DoorSaleRowCardProps> = ({ sale, onPress }) => {
  const buyerName =
    sale.buyerName.length > 0 ? sale.buyerName : "Walk-up";
  const ticketSummary = summarizeDoorTickets(sale.lines);
  const relativeTime = formatRelativeTime(sale.recordedAt);
  const hue = hashStringToHue(sale.id);
  const initials = getInitials(buyerName);
  const subline = `${ticketSummary} · ${formatGbp(sale.totalGbpAtSale)} · ${relativeTime}`;
  const pillSpec = doorPaymentPill(sale.paymentMethod, sale.status);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Door sale ${buyerName}, ${ticketSummary}, ${PAYMENT_METHOD_LABELS[sale.paymentMethod]}`}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View
        style={[
          styles.avatar,
          { backgroundColor: `hsl(${hue}, 60%, 45%)` },
        ]}
      >
        <Text style={styles.avatarText}>{initials}</Text>
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={1}>
          {buyerName}
        </Text>
        <Text style={styles.rowSubline} numberOfLines={1}>
          {subline}
        </Text>
        <View style={styles.rowPills}>
          <Pill variant={pillSpec.variant}>{pillSpec.label}</Pill>
          <Pill variant="info">CHECKED IN</Pill>
        </View>
      </View>
    </Pressable>
  );
};

// ---- Styles --------------------------------------------------------

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
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
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },

  // Cycle 13 — D-CYCLE13-RECON-FOR-4 polish CTA -----------------------
  viewReconCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm + 2,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  viewReconCtaPressed: {
    opacity: 0.7,
  },
  viewReconCtaLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: textTokens.primary,
  },

  // Banner -----------------------------------------------------------
  banner: {
    padding: spacing.md - 2,
    borderRadius: radiusTokens.md,
    backgroundColor: "rgba(235, 120, 37, 0.10)",
    borderWidth: 1,
    borderColor: "rgba(235, 120, 37, 0.30)",
  },
  bannerTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: accent.warm,
    marginBottom: 4,
  },
  bannerBody: {
    fontSize: 12,
    lineHeight: 17,
    color: textTokens.secondary,
  },

  // Reconciliation card ----------------------------------------------
  reconCard: {
    padding: spacing.md,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  reconHeading: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: textTokens.tertiary,
    marginBottom: spacing.sm,
    textTransform: "uppercase",
  },
  reconRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    paddingVertical: 4,
  },
  reconLabelCol: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
  },
  reconLabel: {
    fontSize: 13,
    color: textTokens.secondary,
  },
  reconLabelHint: {
    fontSize: 11,
    color: textTokens.quaternary,
    fontVariant: ["tabular-nums"],
  },
  reconLabelStrong: {
    fontSize: 14,
    fontWeight: "700",
    color: textTokens.primary,
  },
  reconValue: {
    fontSize: 14,
    fontWeight: "500",
    color: textTokens.primary,
    fontVariant: ["tabular-nums"],
  },
  reconValueWarn: {
    fontSize: 14,
    fontWeight: "500",
    color: accent.warm,
    fontVariant: ["tabular-nums"],
  },
  reconValueStrong: {
    fontSize: 18,
    fontWeight: "700",
    color: textTokens.primary,
    fontVariant: ["tabular-nums"],
  },
  reconDivider: {
    marginVertical: spacing.sm,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
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
  },
  scannerName: {
    fontSize: 13,
    fontWeight: "600",
    color: textTokens.primary,
    marginBottom: 4,
  },
  scannerSubRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  scannerSubLabel: {
    fontSize: 11,
    color: textTokens.tertiary,
  },
  scannerTotal: {
    fontSize: 13,
    fontWeight: "600",
    color: textTokens.primary,
    fontVariant: ["tabular-nums"],
  },

  // List -------------------------------------------------------------
  list: {
    gap: spacing.sm,
  },
  emptyHost: {
    paddingTop: spacing.xl,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 2,
    padding: spacing.md - 2,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  rowPressed: {
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  avatarText: {
    fontSize: 14,
    fontWeight: "700",
    color: textTokens.primary,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    fontSize: 14,
    fontWeight: "600",
    color: textTokens.primary,
  },
  rowSubline: {
    fontSize: 12,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  rowPills: {
    flexDirection: "row",
    gap: 6,
    marginTop: 6,
    flexWrap: "wrap",
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

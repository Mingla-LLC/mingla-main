import { useCallback, useEffect, useMemo, useState } from "react";
import { BedDouble } from "lucide-react";
import { EntityListView } from "../entity/EntityListView";
import { EntityDetailView } from "../entity/EntityDetailView";
import { HighRiskActionModal } from "../entity/HighRiskActionModal";
import { Badge } from "../ui/Badge";
import {
  getAdminStayGroup,
  listAdminStayOperations,
  reconcileAdminStayPayment,
  retryAdminStayMaterialization,
  retryAdminStayNotification,
} from "../../services/stayAdminService";
import { actOnSourceRefund } from "../../services/refundOperationsService";
import { formatDateTime, timeAgo } from "../../lib/formatters";

const ISSUE_LABELS = {
  reconciliation_required: "Reconciliation required",
  payment_ambiguous: "Payment ambiguous",
  webhook_lag: "Webhook lag",
  late_success_refund_due: "Late payment; refund due",
  aged_hold: "Aged hold",
  request_expiry_backlog: "Request expiry backlog",
  payment_expiry_backlog: "Payment expiry backlog",
  charge_without_confirmation: "Charge without confirmation",
  refund_failure: "Refund failure",
  payout_reversal_owed: "Payout reversal owed",
  currency_inconsistency: "Currency inconsistency",
  notification_exhaustion: "Notification exhausted",
  inventory_changed: "Inventory conflict",
  materialization_failed: "Place schedule generation failed",
};

const KIND_OPTIONS = Object.entries(ISSUE_LABELS).map(([value, label]) => ({ value, label }));

function money(minor, currency) {
  if (minor == null || !currency) return "—";
  const amount = Number(minor) / 100;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function field(label, value, render) {
  return { label, value, render };
}

function badge(value, variant = "default") {
  return <Badge variant={variant} dot>{value || "—"}</Badge>;
}

const COLUMNS = [
  {
    key: "severity",
    label: "Severity",
    render: (value) => badge(value, value === "critical" ? "error" : "warning"),
  },
  {
    key: "issueKind",
    label: "Issue",
    render: (value) => ISSUE_LABELS[value] || value?.replaceAll("_", " "),
  },
  { key: "brandName", label: "Brand" },
  { key: "venueName", label: "Stay" },
  {
    key: "publicReference",
    label: "Reference",
    render: (value) => value ? <span className="font-mono text-xs">{value}</span> : "—",
  },
  {
    key: "amountMinor",
    label: "Amount",
    render: (value, row) => money(value, row.currencyCode),
  },
  { key: "state", label: "State", render: (value) => badge(value, "warning") },
  { key: "occurredAt", label: "Age", render: (value) => timeAgo(value) },
];

function groupSections(bundle) {
  const group = bundle.group || {};
  const guest = bundle.guest || {};
  const lines = Array.isArray(bundle.lines) ? bundle.lines : [];
  const payments = Array.isArray(bundle.payments) ? bundle.payments : [];
  const refunds = Array.isArray(bundle.refunds) ? bundle.refunds : [];
  const ledger = Array.isArray(bundle.ledger) ? bundle.ledger : [];
  const notifications = Array.isArray(bundle.notifications) ? bundle.notifications : [];
  const timeline = Array.isArray(bundle.timeline) ? bundle.timeline : [];
  const commitments = Array.isArray(bundle.commitments) ? bundle.commitments : [];
  return [
    {
      label: "Reservation group",
      fields: [
        field("State", null, () => badge(group.state, group.state === "confirmed" ? "success" : "warning")),
        field("Mode", group.mode),
        field("Brand", group.brandName),
        field("Stay", group.venueName),
        field("Total", money(group.totalMinor, group.currencyCode)),
        field("Subtotal", money(group.sourceSubtotalMinor, group.currencyCode)),
        field("Fees", money(group.feeTotalMinor, group.currencyCode)),
        field("Taxes", money(group.taxTotalMinor, group.currencyCode)),
        field("Request deadline", group.requestDeadline, (value) => value ? formatDateTime(value) : "—"),
        field("Payment deadline", group.paymentDeadline, (value) => value ? formatDateTime(value) : "—"),
        field("Version", bundle.version),
        field("Snapshot", bundle.snapshotAt, formatDateTime),
      ],
    },
    {
      label: "Guest (masked for support)",
      fields: [field("Name", guest.name), field("Email", guest.email), field("Phone", guest.phone)],
    },
    {
      label: `Rooms & Places (${lines.length})`,
      fields: lines.length ? lines.map((line) => field(
        line.offeringName || line.id,
        null,
        () => (
          <span className="flex flex-col gap-1">
            <span className="flex flex-wrap gap-1.5 items-center">
              <Badge variant={line.kind === "room" ? "info" : "brand"}>{line.kind}</Badge>
              {badge(line.state, line.state === "confirmed" ? "success" : "warning")}
              <span>{money(line.totalMinor, group.currencyCode)}</span>
            </span>
            <span className="text-xs text-[var(--color-text-tertiary)]">
              {line.kind === "room"
                ? `${line.roomQuantity} room(s), ${line.roomCheckIn} → ${line.roomCheckOut}`
                : `${line.placeUnits ?? line.placeGuests} unit/guest allocation`}
            </span>
          </span>
        ),
      )) : [field("Inventory", "No reservation lines")],
    },
    {
      label: "Hold and commitments",
      fields: [
        field("Hold", bundle.hold ? `${bundle.hold.state} · expires ${formatDateTime(bundle.hold.expiresAt)}` : "None"),
        field("Hold slices", bundle.hold?.slices?.length ?? 0),
        field("Commitments", commitments.length),
        ...commitments.slice(0, 12).map((item) => field(item.resourceType, `${item.quantity} · ${item.state} · ${item.roomDate || item.placeWindowId || "—"}`)),
      ],
    },
    {
      label: `Payments (${payments.length})`,
      fields: payments.length ? payments.flatMap((payment) => [
        field(`Attempt ${payment.attemptOrdinal}`, null, () => (
          <span className="flex flex-wrap items-center gap-1.5">
            {badge(payment.state, payment.state === "succeeded" ? "success" : "warning")}
            <span>{payment.provider}</span>
            <span>{money(payment.amountMinor, payment.currencyCode)}</span>
          </span>
        )),
        field("Provider references", [payment.providerPaymentRef, payment.providerChargeRef].filter(Boolean).join(" · ") || "None"),
        field("Allocations", payment.allocations?.length ?? 0),
        field("Provider events", payment.providerEvents?.length ?? 0),
      ]) : [field("Payment", "No payment attempts")],
    },
    {
      label: `Refunds (${refunds.length})`,
      fields: refunds.length ? refunds.map((refund) => field(
        refund.id,
        `${refund.state} · ${money(refund.amountMinor, refund.currencyCode)} · ${refund.providerRef || "no provider ref"}`,
      )) : [field("Refund", "No refunds")],
    },
    {
      label: `Money and payouts (${ledger.length} ledger entries)`,
      fields: [
        ...ledger.slice(-12).map((entry) => field(entry.entryType, `${money(entry.amountMinor, entry.currencyCode)} · ${formatDateTime(entry.occurredAt)}`)),
        field("Payout releases", bundle.payouts?.length ?? 0),
        field("Payout fee snapshots", bundle.payoutSnapshots?.length ?? 0),
      ],
    },
    {
      label: `Notifications (${notifications.length})`,
      fields: notifications.length ? notifications.map((item) => field(item.categoryKey, `${item.channel || "auto"} · ${item.status} · ${item.attempts} attempt(s)`)) : [field("Delivery", "No Stay notifications")],
    },
    {
      label: `Immutable timeline (${timeline.length})`,
      fields: timeline.length ? timeline.map((event) => field(event.eventType, `${event.actorType} · ${formatDateTime(event.createdAt)}`)) : [field("Timeline", "No events")],
    },
  ];
}

function groupActions(bundle, reload) {
  const actions = [];
  const payments = Array.isArray(bundle.payments) ? bundle.payments : [];
  const payment = [...payments].reverse().find((item) => item.providerPaymentRef && ["pending", "ambiguous", "refund_due"].includes(item.state));
  if (payment) {
    actions.push({
      label: "Reconcile payment from provider",
      title: "Reconcile payment from provider",
      description: "Mingla will read the stored Stripe or Paystack transaction and accept only matching provider evidence. You cannot enter an amount, currency, reference, or outcome.",
      confirmLabel: "Read provider and reconcile",
      requireReason: true,
      onConfirm: async ({ reason }) => {
        await reconcileAdminStayPayment({ paymentAttemptId: payment.id, reason });
        await reload();
      },
    });
  }
  if (bundle.notifications?.some((item) => item.status === "failed")) {
    actions.push({
      label: "Retry failed notifications",
      title: "Retry failed Stay notifications",
      description: "Requeues only failed Stay deliveries with the same recipient and payload. It does not edit reservation truth.",
      confirmLabel: "Retry failed deliveries",
      requireReason: true,
      onConfirm: async ({ reason }) => {
        await retryAdminStayNotification({ groupId: bundle.group.id, reason });
        await reload();
      },
    });
  }
  const refund = bundle.refunds?.find((item) => item.sourceRefundId && ["failed", "manual_reconciliation"].includes(item.state));
  if (refund) {
    actions.push({
      label: "Reconcile refund from provider",
      title: "Reconcile refund from provider",
      description: "Uses Mingla's existing source-refund control plane and provider evidence. It cannot create a second refund.",
      confirmLabel: "Reconcile refund",
      requireReason: true,
      onConfirm: async ({ reason }) => {
        await actOnSourceRefund({ refundId: refund.sourceRefundId, action: "reconcile_provider", reason });
        await reload();
      },
    });
  }
  return actions;
}

function groupIdFromHash() {
  return new URLSearchParams(window.location.hash.split("?")[1] || "").get("stayGroupId");
}

export function StayOperationsPanel() {
  const [groupId, setGroupId] = useState(() => groupIdFromHash());
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [bundle, setBundle] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [materializeOpen, setMaterializeOpen] = useState(false);

  useEffect(() => {
    const sync = () => setGroupId(groupIdFromHash());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const loadGroup = useCallback(async () => {
    if (!groupId) return;
    setLoading(true);
    setError(null);
    try {
      setBundle(await getAdminStayGroup(groupId));
    } catch (err) {
      setBundle(null);
      setError(err?.message || "Failed to load the Stay reservation.");
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    loadGroup();
  }, [loadGroup]);

  const openRow = useCallback((row) => {
    if (row.groupId) {
      setSelectedAlert(null);
      window.location.hash = `#/business-money-ledger?tab=stay&stayGroupId=${row.groupId}`;
      setGroupId(row.groupId);
    } else {
      setSelectedAlert(row);
    }
  }, []);

  const back = useCallback(() => {
    window.location.hash = "#/business-money-ledger?tab=stay";
    setGroupId(null);
    setSelectedAlert(null);
    setBundle(null);
    setError(null);
  }, []);

  const actions = useMemo(() => bundle ? groupActions(bundle, loadGroup) : [], [bundle, loadGroup]);

  if (groupId) {
    const group = bundle?.group || {};
    return (
      <EntityDetailView
        loading={loading}
        error={error}
        onRetry={loadGroup}
        header={{
          title: group.publicReference || "Stay reservation",
          subtitle: bundle ? `${group.brandName} · ${group.venueName}` : undefined,
          badges: bundle ? [{ label: group.state, variant: group.state === "confirmed" ? "success" : "warning" }] : [],
          backLabel: "Stay reconciliation",
          onBack: back,
        }}
        sections={bundle ? groupSections(bundle) : []}
        actions={actions}
      />
    );
  }

  if (selectedAlert) {
    return (
      <div className="flex flex-col gap-4">
        <EntityDetailView
          header={{
            title: ISSUE_LABELS[selectedAlert.issueKind] || "Stay alert",
            subtitle: selectedAlert.venueName || "Stay operations",
            badges: [{ label: selectedAlert.severity, variant: selectedAlert.severity === "critical" ? "error" : "warning" }],
            backLabel: "Stay reconciliation",
            onBack: back,
          }}
          sections={[{
            label: "Retained support evidence",
            fields: [
              field("Issue", ISSUE_LABELS[selectedAlert.issueKind]),
              field("Venue", selectedAlert.venueName),
              field("State", selectedAlert.state),
              field("Occurred", formatDateTime(selectedAlert.occurredAt)),
              field("Alert id", selectedAlert.alertId),
            ],
          }]}
        />
        {selectedAlert.issueKind === "materialization_failed" && (
          <div className="flex justify-end">
            <button type="button" className="text-sm underline text-[var(--color-brand-500)]" onClick={() => setMaterializeOpen(true)}>
              Retry from retained schedule evidence
            </button>
          </div>
        )}
        <HighRiskActionModal
          open={materializeOpen}
          onClose={() => setMaterializeOpen(false)}
          title="Retry Place schedule generation"
          description="Reuses the original rule and date range retained with this alert. No schedule values can be supplied here."
          confirmLabel="Retry materialization"
          onConfirm={async ({ reason }) => {
            await retryAdminStayMaterialization({ alertId: selectedAlert.alertId, reason });
            setMaterializeOpen(false);
            back();
          }}
          successMessage="Place schedule generation retried."
        />
      </div>
    );
  }

  return (
    <EntityListView
      title="Stay reconciliation"
      columns={COLUMNS}
      fetchPage={listAdminStayOperations}
      searchPlaceholder="Search reference, brand, or Stay"
      filters={[{ key: "kind", label: "Issue", options: KIND_OPTIONS }]}
      onRowClick={openRow}
      emptyMessage="No Stay operations need attention."
      emptyIcon={BedDouble}
    />
  );
}

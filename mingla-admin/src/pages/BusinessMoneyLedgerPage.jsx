// ORCH-1274 [Admin Money console — READ-ONLY] — Money ledger.
//
// One page, four in-page tabs — Refunds · Disputes · Payouts · Platform revenue —
// each an independent EntityListView over its own admin_* read-RPC. The disputes
// tab surfaces an evidence-due countdown and opens a dispute detail (linked order
// + collapsible raw event). Every list renders a clean empty state on the live
// (mostly-0-row) data. READ-ONLY: no dispute-resolve / refund action (Wave-2, §9).

import { useState, useEffect, useCallback } from "react";
import { Landmark } from "lucide-react";
import { EntityListView } from "../components/entity/EntityListView";
import { EntityDetailView } from "../components/entity/EntityDetailView";
import { HighRiskActionModal } from "../components/entity/HighRiskActionModal";
import { Tabs } from "../components/ui/Tabs";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { StayOperationsPanel } from "../components/stay/StayOperationsPanel";
import { listRefunds, listDisputes, getDispute, listPayouts, listRevenueLog } from "../services/adminMoneyService";
import { annotateDispute } from "../services/adminMoneyActService";
import { timeAgo, formatDateTime, formatDate } from "../lib/formatters";

// ── Money formatter (cents + currency → string; never throws — I-1152 lesson) ──

function formatMoney(cents, currency) {
  if (cents == null) return "—";
  const code = (currency || "").toUpperCase();
  const amount = cents / 100;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code || "USD" }).format(amount);
  } catch {
    return `${amount.toFixed(2)}${code ? ` ${code}` : ""}`;
  }
}

function brandCell(val) {
  return val || <span className="text-[var(--color-text-muted)]">—</span>;
}

// ── Evidence-due countdown (red if <72h or overdue) ───────────────────────────

function evidenceDue(due) {
  if (!due) return <span className="text-[var(--color-text-muted)]">—</span>;
  const ms = new Date(due).getTime() - Date.now();
  const hours = Math.floor(Math.abs(ms) / 3600000);
  const urgent = ms <= 0 || hours < 72;
  const label = ms <= 0 ? "overdue" : hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
  return <span className={urgent ? "text-[#b91c1c] font-medium" : "text-[var(--color-text-secondary)]"}>{label}</span>;
}

// ── Per-tab column / csv definitions ──────────────────────────────────────────

const REFUND_COLUMNS = [
  { key: "created_at", label: "Created", render: (v) => <span className="text-xs text-[var(--color-text-tertiary)]">{timeAgo(v)}</span> },
  { key: "brand_name", label: "Brand", render: brandCell },
  { key: "order_id", label: "Order", render: (v) => (v ? <span className="font-mono text-xs break-all">{v}</span> : <span className="text-[var(--color-text-muted)]">—</span>) },
  { key: "amount_cents", label: "Amount", render: (v, row) => <span className="font-medium">{formatMoney(v, row.currency)}</span> },
  { key: "status", label: "Status", render: (v) => <Badge variant={v === "succeeded" ? "success" : "warning"} dot>{v || "—"}</Badge> },
  { key: "reason", label: "Reason", render: (v) => v || <span className="text-[var(--color-text-muted)]">—</span> },
  { key: "application_fee_refunded_cents", label: "App-fee refunded", render: (v, row) => (v != null ? formatMoney(v, row.currency) : "—") },
];
const REFUND_CSV = {
  columns: [
    { key: "created_at", label: "Created" }, { key: "brand_name", label: "Brand" }, { key: "order_id", label: "Order" },
    { key: "amount_cents", label: "Amount cents" }, { key: "currency", label: "Currency" }, { key: "status", label: "Status" },
    { key: "reason", label: "Reason" }, { key: "stripe_refund_id", label: "Refund id" },
  ],
  filename: "refunds",
};

const DISPUTE_COLUMNS = [
  { key: "created_at", label: "Created", render: (v) => <span className="text-xs text-[var(--color-text-tertiary)]">{timeAgo(v)}</span> },
  { key: "brand_name", label: "Brand", render: brandCell },
  { key: "stripe_charge_id", label: "Charge id", render: (v) => (v ? <span className="font-mono text-xs break-all">{v}</span> : <span className="text-[var(--color-text-muted)]">—</span>) },
  { key: "amount", label: "Amount", render: (v, row) => <span className="font-medium">{formatMoney(v, row.currency)}</span> },
  {
    key: "status",
    label: "Status",
    render: (v) => {
      const variant =
        v === "won" ? "success" : v === "lost" ? "default" : v === "under_review" ? "warning" : "error";
      return <Badge variant={variant} dot>{v || "—"}</Badge>;
    },
  },
  { key: "reason", label: "Reason", render: (v) => v || <span className="text-[var(--color-text-muted)]">—</span> },
  { key: "evidence_due_by", label: "Evidence due", render: (v) => evidenceDue(v) },
];
const DISPUTE_CSV = {
  columns: [
    { key: "created_at", label: "Created" }, { key: "brand_name", label: "Brand" }, { key: "stripe_charge_id", label: "Charge id" },
    { key: "amount", label: "Amount cents" }, { key: "currency", label: "Currency" }, { key: "status", label: "Status" },
    { key: "reason", label: "Reason" }, { key: "evidence_due_by", label: "Evidence due" }, { key: "stripe_dispute_id", label: "Dispute id" },
  ],
  filename: "disputes",
};

const PAYOUT_COLUMNS = [
  { key: "created_at", label: "Created", render: (v) => <span className="text-xs text-[var(--color-text-tertiary)]">{timeAgo(v)}</span> },
  { key: "brand_name", label: "Brand", render: brandCell },
  { key: "amount_cents", label: "Amount", render: (v, row) => <span className="font-medium">{formatMoney(v, row.currency)}</span> },
  { key: "status", label: "Status", render: (v) => <Badge variant={v === "paid" ? "success" : "warning"} dot>{v || "—"}</Badge> },
  { key: "arrival_date", label: "Arrival date", render: (v) => (v ? formatDate(v) : <span className="text-[var(--color-text-muted)]">—</span>) },
];
const PAYOUT_CSV = {
  columns: [
    { key: "created_at", label: "Created" }, { key: "brand_name", label: "Brand" }, { key: "amount_cents", label: "Amount cents" },
    { key: "currency", label: "Currency" }, { key: "status", label: "Status" }, { key: "arrival_date", label: "Arrival date" },
    { key: "stripe_payout_id", label: "Payout id" },
  ],
  filename: "payouts",
};

const REVENUE_COLUMNS = [
  { key: "created_at", label: "Created", render: (v) => <span className="text-xs text-[var(--color-text-tertiary)]">{timeAgo(v)}</span> },
  { key: "brand_name", label: "Brand", render: brandCell },
  { key: "amount_cents", label: "Amount (app fee)", render: (v, row) => <span className="font-medium">{formatMoney(v, row.currency)}</span> },
  { key: "currency", label: "Currency", render: (v) => v || <span className="text-[var(--color-text-muted)]">—</span> },
  { key: "refunded", label: "Refunded", render: (v) => <Badge variant={v ? "warning" : "default"} dot>{v ? "Yes" : "No"}</Badge> },
  { key: "stripe_application_fee_id", label: "App-fee id", render: (v) => (v ? <span className="font-mono text-xs break-all">{v}</span> : <span className="text-[var(--color-text-muted)]">—</span>) },
];
const REVENUE_CSV = {
  columns: [
    { key: "created_at", label: "Created" }, { key: "brand_name", label: "Brand" }, { key: "amount_cents", label: "Amount cents" },
    { key: "currency", label: "Currency" }, { key: "refunded", label: "Refunded" }, { key: "refunded_amount_cents", label: "Refunded cents" },
    { key: "stripe_application_fee_id", label: "App-fee id" },
  ],
  filename: "platform-revenue",
};

const TABS = [
  { id: "refunds", label: "Refunds" },
  { id: "disputes", label: "Disputes" },
  { id: "payouts", label: "Payouts" },
  { id: "revenue", label: "Platform revenue" },
  { id: "stay", label: "Stay reconciliation" },
];

// ── Hash helpers ──────────────────────────────────────────────────────────────

function hashParams() {
  return new URLSearchParams(window.location.hash.split("?")[1] || "");
}
function tabFromHash() {
  const t = hashParams().get("tab");
  return TABS.some((x) => x.id === t) ? t : "refunds";
}
function disputeIdFromHash() {
  return hashParams().get("disputeId");
}

// ── Dispute detail sections ───────────────────────────────────────────────────

function field(label, value, render) {
  return { label, value, render };
}

function buildDisputeSections(bundle) {
  const d = bundle.dispute || {};
  const order = bundle.order || null;
  const brand = bundle.brand || null;
  const raw = bundle.raw_event || null;

  const sections = [
    {
      label: "Dispute",
      fields: [
        field("Dispute id", d.stripe_dispute_id, (v) => <span className="font-mono text-xs break-all">{v}</span>),
        field("Amount", null, () => <span className="font-medium">{formatMoney(d.amount, d.currency)}</span>),
        field("Status", d.status),
        field("Reason", d.reason),
        field("Evidence due", null, () => evidenceDue(d.evidence_due_by)),
        field("Charge refundable", null, () => (d.is_charge_refundable ? "Yes" : "No")),
        field("Charge id", d.stripe_charge_id, (v) => <span className="font-mono text-xs break-all">{v}</span>),
        field("Created", d.created_at, (v) => formatDateTime(v)),
      ],
    },
    {
      label: "Linked order",
      fields: order
        ? [
            field("Order id", order.order_id, (v) => <span className="font-mono text-xs break-all">{v}</span>),
            field("Total", null, () => formatMoney(order.total_cents, order.currency)),
            field("Payment status", order.payment_status),
            field("Buyer email", order.buyer_email),
          ]
        : [field("", "No linked order", (v) => <span className="text-[var(--color-text-muted)]">{v}</span>)],
    },
    {
      label: "Brand",
      fields: brand
        ? [field("Name", brand.name), field("Slug", brand.slug)]
        : [field("", "No brand on file", (v) => <span className="text-[var(--color-text-muted)]">{v}</span>)],
    },
    {
      label: "Admin review",
      fields: [
        field("Internal note", d.admin_internal_note, (v) => v || <span className="text-[var(--color-text-muted)]">—</span>),
        field("Reviewed", null, () =>
          d.admin_reviewed_at ? (
            <span className="flex items-center gap-1.5">
              <Badge variant="success">Reviewed</Badge>
              <span className="text-xs text-[var(--color-text-tertiary)]">{formatDateTime(d.admin_reviewed_at)}</span>
            </span>
          ) : (
            <span className="text-[var(--color-text-muted)]">Not reviewed</span>
          ),
        ),
      ],
    },
    {
      label: "Raw event",
      fields: [
        field("", null, () =>
          raw ? (
            <details className="text-xs">
              <summary className="cursor-pointer text-[var(--color-brand-500)]">Show raw event</summary>
              <pre className="mt-1 overflow-x-auto rounded-md bg-[var(--gray-100)] p-2 text-[11px] leading-relaxed">
                {JSON.stringify(raw, null, 2)}
              </pre>
            </details>
          ) : (
            <span className="text-[var(--color-text-muted)]">—</span>
          ),
        ),
      ],
    },
  ];

  return sections;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BusinessMoneyLedgerPage() {
  const [activeTab, setActiveTab] = useState(() => tabFromHash());
  const [disputeId, setDisputeId] = useState(() => disputeIdFromHash());
  const [disputeBundle, setDisputeBundle] = useState(null);
  const [disputeLoading, setDisputeLoading] = useState(false);
  const [disputeError, setDisputeError] = useState(null);
  const [annotateOpen, setAnnotateOpen] = useState(false);
  const [note, setNote] = useState("");
  const [markReviewed, setMarkReviewed] = useState(false);

  useEffect(() => {
    const sync = () => {
      setActiveTab(tabFromHash());
      setDisputeId(disputeIdFromHash());
    };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const changeTab = useCallback((tabId) => {
    window.location.hash = `#/business-money-ledger?tab=${tabId}`;
    setActiveTab(tabId);
  }, []);

  const openDispute = useCallback((id) => {
    window.location.hash = `#/business-money-ledger?tab=disputes&disputeId=${id}`;
    setDisputeId(id);
  }, []);

  const backToLedger = useCallback(() => {
    window.location.hash = "#/business-money-ledger?tab=disputes";
    setDisputeId(null);
    setDisputeBundle(null);
    setDisputeError(null);
  }, []);

  const loadDispute = useCallback(async (id) => {
    setDisputeLoading(true);
    setDisputeError(null);
    setDisputeBundle(null);
    try {
      const { data, error: err } = await getDispute(id);
      if (err) {
        const msg = err.message || "";
        if (msg.includes("not_authorized")) setDisputeError("You are not authorized to view this dispute.");
        else if (msg.includes("not_found")) setDisputeError("No dispute found for this ID.");
        else setDisputeError(msg || "Failed to load this dispute.");
      } else {
        setDisputeBundle(data);
      }
    } finally {
      setDisputeLoading(false);
    }
  }, []);

  useEffect(() => {
    if (disputeId) loadDispute(disputeId);
  }, [disputeId, loadDispute]);

  // Reset the annotate form each time the modal opens.
  useEffect(() => {
    if (annotateOpen) {
      setNote(disputeBundle?.dispute?.admin_internal_note || "");
      setMarkReviewed(false);
    }
  }, [annotateOpen, disputeBundle]);

  const runAnnotate = useCallback(async ({ reason }) => {
    const trimmedNote = note.trim();
    if (trimmedNote === "" && !markReviewed) {
      throw new Error("Add a note or mark the dispute reviewed.");
    }
    const { error: err } = await annotateDispute({
      dispute_id: disputeId,
      note: trimmedNote === "" ? null : trimmedNote,
      mark_reviewed: markReviewed,
      reason,
    });
    if (err) {
      const msg = err.message || "";
      if (msg.includes("not_authorized")) throw new Error("Admin access required.");
      if (msg.includes("reason_required")) throw new Error("A reason is required.");
      if (msg.includes("dispute_not_found")) throw new Error("This dispute no longer exists.");
      throw new Error(msg || "Couldn't save the annotation.");
    }
    loadDispute(disputeId);
  }, [disputeId, note, markReviewed, loadDispute]);

  // ── Dispute detail view ─────────────────────────────────────────────────────
  if (disputeId) {
    const d = disputeBundle?.dispute || {};
    const badges = [];
    if (disputeBundle) {
      const variant = d.status === "won" ? "success" : d.status === "lost" ? "default" : "warning";
      badges.push({ label: d.status || "dispute", variant });
    }
    return (
      <div className="py-8">
        <EntityDetailView
          loading={disputeLoading}
          error={disputeError}
          onRetry={() => loadDispute(disputeId)}
          header={{
            title: disputeBundle ? formatMoney(d.amount, d.currency) : "Dispute",
            subtitle: disputeBundle ? <span className="font-mono">{d.stripe_dispute_id}</span> : undefined,
            badges: disputeBundle ? badges : [],
            backLabel: "Money ledger",
            onBack: backToLedger,
          }}
          sections={disputeBundle ? buildDisputeSections(disputeBundle) : []}
        />
        {disputeBundle && (
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--gray-200)] pt-4">
            <Button variant="secondary" size="md" onClick={() => setAnnotateOpen(true)}>
              Add internal note / Mark reviewed
            </Button>
          </div>
        )}
        <HighRiskActionModal
          open={annotateOpen}
          onClose={() => setAnnotateOpen(false)}
          title="Annotate dispute"
          description="Adds an internal note and/or marks this dispute reviewed. This does NOT touch the dispute's Stripe status — it never moves money."
          confirmLabel="Save"
          onConfirm={runAnnotate}
          successMessage="Dispute annotation saved."
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="dispute-note" className="text-xs font-medium text-[var(--color-text-secondary)]">
                Internal note
              </label>
              <textarea
                id="dispute-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Context for the team (internal only)"
                className="w-full min-h-[72px] px-3 py-2 text-sm rounded-lg resize-y bg-[var(--color-background-primary)] text-[var(--color-text-primary)] border border-[var(--gray-300)] outline-none focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)] cursor-pointer">
              <input type="checkbox" checked={markReviewed} onChange={(e) => setMarkReviewed(e.target.checked)} />
              Mark this dispute reviewed
            </label>
          </div>
        </HighRiskActionModal>
      </div>
    );
  }

  // ── Tab list ────────────────────────────────────────────────────────────────
  let listView = null;
  if (activeTab === "refunds") {
    listView = (
      <EntityListView
        key="refunds"
        title="Refunds"
        columns={REFUND_COLUMNS}
        fetchPage={listRefunds}
        searchPlaceholder="Search refund id, charge id, or order id"
        filters={[{ key: "status", label: "Status", options: [{ value: "succeeded", label: "Succeeded" }, { value: "pending", label: "Pending" }, { value: "failed", label: "Failed" }] }]}
        csv={REFUND_CSV}
        emptyMessage="No refunds yet."
        emptyIcon={Landmark}
      />
    );
  } else if (activeTab === "disputes") {
    listView = (
      <EntityListView
        key="disputes"
        title="Disputes"
        columns={DISPUTE_COLUMNS}
        fetchPage={listDisputes}
        searchPlaceholder="Search dispute id or charge id"
        filters={[{ key: "status", label: "Status", options: [{ value: "needs_response", label: "Needs response" }, { value: "warning_needs_response", label: "Warning: needs response" }, { value: "under_review", label: "Under review" }, { value: "won", label: "Won" }, { value: "lost", label: "Lost" }] }]}
        onRowClick={(row) => openDispute(row.id)}
        csv={DISPUTE_CSV}
        emptyMessage="No disputes yet."
        emptyIcon={Landmark}
      />
    );
  } else if (activeTab === "payouts") {
    listView = (
      <EntityListView
        key="payouts"
        title="Payouts"
        columns={PAYOUT_COLUMNS}
        fetchPage={listPayouts}
        searchPlaceholder="Search payout id"
        filters={[{ key: "status", label: "Status", options: [{ value: "paid", label: "Paid" }, { value: "pending", label: "Pending" }, { value: "in_transit", label: "In transit" }, { value: "failed", label: "Failed" }] }]}
        csv={PAYOUT_CSV}
        emptyMessage="No payouts yet."
        emptyIcon={Landmark}
      />
    );
  } else if (activeTab === "stay") {
    listView = <StayOperationsPanel key="stay" />;
  } else {
    listView = (
      <EntityListView
        key="revenue"
        title="Platform revenue"
        columns={REVENUE_COLUMNS}
        fetchPage={listRevenueLog}
        searchPlaceholder="Search app-fee id or account id"
        csv={REVENUE_CSV}
        emptyMessage="No platform revenue yet."
        emptyIcon={Landmark}
      />
    );
  }

  return (
    <div className="py-8 flex flex-col gap-6">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-full bg-[var(--color-brand-50)] flex items-center justify-center shrink-0">
          <Landmark className="w-5 h-5 text-[var(--color-brand-500)]" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Money ledger</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
            Refunds, disputes, payouts, platform-fee revenue, and provider-evidence Stay reconciliation across every brand.
          </p>
        </div>
      </div>

      <Tabs tabs={TABS} activeTab={activeTab} onChange={changeTab} />
      {listView}
    </div>
  );
}

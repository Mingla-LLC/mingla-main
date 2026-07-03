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
import { Tabs } from "../components/ui/Tabs";
import { Badge } from "../components/ui/Badge";
import { listRefunds, listDisputes, getDispute, listPayouts, listRevenueLog } from "../services/adminMoneyService";
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
            Refunds, disputes, payouts, and Mingla's platform-fee revenue across every brand. Read-only.
          </p>
        </div>
      </div>

      <Tabs tabs={TABS} activeTab={activeTab} onChange={changeTab} />
      {listView}
    </div>
  );
}

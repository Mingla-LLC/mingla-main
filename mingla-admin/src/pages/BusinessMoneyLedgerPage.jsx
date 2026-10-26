// ORCH-1274 [Admin Money console] — Money ledger.
//
// Every payout, refund, dispute and debt, row by row. Totals and profit live
// on Mingla money. #4130 Wave 2a:
//   - Payouts is the first tab; the fee badge is the fee as a share of the
//     ticket price, with an "older pricing" label below 4%;
//   - "Mingla owes back" can be marked settled (admin_settle_owes_back, with
//     a reference and a reason, inside a confirmation);
//   - Stripe and Paystack disputes share one tab, evidence due first;
//   - the old Platform revenue tab (Stripe application fees only, so it
//     missed all naira revenue) is replaced by a link to Mingla money;
//   - the payout totals show an error with Retry instead of vanishing;
//   - the Refunds filter includes Cancelled.

import { useState, useEffect, useCallback } from "react";
import { Landmark } from "lucide-react";
import { EntityListView } from "../components/entity/EntityListView";
import { EntityDetailView } from "../components/entity/EntityDetailView";
import { HighRiskActionModal } from "../components/entity/HighRiskActionModal";
import { Tabs } from "../components/ui/Tabs";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { StayOperationsPanel } from "../components/stay/StayOperationsPanel";
import { listRefunds, getDispute, listAllDisputes, listPayouts, getPayoutSummary, listOrganiserPayoutDebts } from "../services/adminMoneyService";
import { annotateDispute, settleOwesBack } from "../services/adminMoneyActService";
import { feeShareOfTicket } from "../lib/minglaMoney";
import { LoadError } from "../components/ui/LoadError";
import { Skeleton } from "../components/ui/Skeleton";
import { PaystackDisputeDetail } from "../components/money/PaystackDisputeDetail";
import { deadlineCountdown } from "../lib/paystackDisputeEvidence";
import { reconcileTicketRefund } from "../services/adminRefundReconciliationService";
import { timeAgo, formatDateTime } from "../lib/formatters";
import { PageHeader } from "../components/ui/PageHeader";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { formatMoneyMinor } from "../lib/moneyFormat";

// ── Money formatter (cents + currency → string; never throws — I-1152 lesson) ──

function formatMoney(cents, currency) {
  return formatMoneyMinor(cents, currency);
}

function brandCell(val) {
  return val || <span className="text-[var(--color-text-muted)]">—</span>;
}

function formatCurrencyMap(values) {
  const entries = Object.entries(values ?? {}).filter(([, cents]) => Number(cents) !== 0);
  if (entries.length === 0) return "—";
  return entries.map(([currency, cents]) => formatMoney(Number(cents), currency)).join(" + ");
}

function PayoutMetric({ title, value, sub, alert = false, action = null }) {
  return (
    <div className={`rounded-xl border p-4 ${alert ? "border-[var(--color-error-300)] bg-[var(--color-error-50)]" : "border-[var(--gray-200)] bg-white"}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">{title}</p>
      <p className={`mt-1 text-xl font-semibold ${alert ? "text-[var(--color-error-700)]" : "text-[var(--color-text-primary)]"}`}>{value}</p>
      {sub ? <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{sub}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** #4130: the fee as a share of the ticket price, labelled "older pricing" below 4%. */
function FeeCell({ fee, ticket, currency }) {
  const share = feeShareOfTicket(fee, ticket);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="tabular-nums">{formatMoney(fee, currency)}</span>
      {share ? <Badge variant={share.older ? "default" : "success"}>{share.older ? `${share.label} · older pricing` : share.label}</Badge> : null}
    </span>
  );
}

function PayoutDetailDrawer({ payout, onClose }) {
  if (!payout) return null;
  const debt = Number(payout.permanent_debt_withheld_cents || 0) + Number(payout.temporary_debt_withheld_cents || 0);
  const line = (label, value, tone = "") => (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--gray-200)] py-3 last:border-b-0">
      <span className="text-sm text-[var(--color-text-secondary)]">{label}</span>
      <span className={`text-sm font-medium text-right ${tone}`}>{value}</span>
    </div>
  );
  return (
    <Modal open onClose={onClose} title={`${payout.brand_name} payout`} size="md">
      <ModalBody>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge variant={payout.status === "paid" ? "success" : payout.status === "late_on_us" ? "error" : "warning"} dot>
            {(payout.status || "—").replaceAll("_", " ")}
          </Badge>
          <Badge variant="default">{payout.provider}</Badge>
          <span className="font-mono text-xs text-[var(--color-text-tertiary)]">{payout.id}</span>
        </div>
        {payout.why ? <p className="mb-4 rounded-lg border border-[var(--color-warning-300)] bg-[var(--color-warning-50)] p-3 text-sm">{payout.why}</p> : null}
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">How this adds up</h3>
        <div className="mt-2">
          {line("Buyers paid", formatMoney(payout.gross_cents, payout.currency))}
          {Number(payout.refunded_cents) > 0 ? line("Refunds", `−${formatMoney(payout.refunded_cents, payout.currency)}`) : null}
          {Number(payout.disputed_cents) > 0 ? line("Disputes", `−${formatMoney(payout.disputed_cents, payout.currency)}`) : null}
          {debt > 0 ? line("Refund after an earlier payout", `−${formatMoney(debt, payout.currency)}`) : null}
          {line("Ticket price", formatMoney(payout.ticket_cents, payout.currency))}
          {line(
            (() => {
              // #4130: the real share of the ticket price, never a hard-coded 4.5%.
              const share = feeShareOfTicket(payout.mingla_fee_cents, payout.ticket_cents);
              if (!share) return "Mingla fee";
              return share.older ? `Mingla fee · ${share.label} of ticket, older pricing` : `Mingla fee · ${share.label} of ticket`;
            })(),
            `−${formatMoney(payout.mingla_fee_cents, payout.currency)}`,
          )}
          {line("Card processing", "Mingla pays")}
          {payout.provider === "stripe" ? line("Stripe automatic-tax fee (~0.5%)", "Paid by host") : null}
          {line("Host gets", formatMoney(payout.host_gets_cents, payout.currency))}
          {Number(payout.transfer_fee_cents) > 0 ? line("Bank transfer fee", `−${formatMoney(payout.transfer_fee_cents, payout.currency)}`) : null}
          {Number(payout.stamp_duty_cents) > 0 ? line("Stamp duty", `−${formatMoney(payout.stamp_duty_cents, payout.currency)}`) : null}
          {line("Sent to bank", formatMoney(payout.sent_to_bank_cents, payout.currency))}
        </div>
        {Number(payout.transfer_fee_credit_owed_cents) > 0 ? (
          <p className="mt-3 rounded-lg border border-[var(--color-error-300)] bg-[var(--color-error-50)] p-3 text-sm text-[var(--color-error-700)]">
            Mingla owes this host back {formatMoney(payout.transfer_fee_credit_owed_cents, payout.currency)} in transfer fees it held. Mark it settled on this tab once it is repaid.
          </p>
        ) : null}
        <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          <p><span className="text-[var(--color-text-tertiary)]">Sales:</span> {payout.sales_count}</p>
          <p><span className="text-[var(--color-text-tertiary)]">Due:</span> {formatDateTime(payout.due_at)}</p>
        </div>
      </ModalBody>
      <ModalFooter><Button variant="secondary" onClick={onClose}>Close</Button></ModalFooter>
    </Modal>
  );
}

function RefundReconcileButton({ row }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const actionable = ["awaiting_application_fee", "pending_visibility"].includes(row.application_fee_refund_status);
  if (!actionable) return <span className="text-[var(--color-text-muted)]">—</span>;
  return <div className="flex flex-col gap-1"><Button disabled={busy} onClick={async () => {
    setBusy(true); setError("");
    try { await reconcileTicketRefund(row.id); window.location.reload(); }
    catch { setError("Still pending — try again later."); }
    finally { setBusy(false); }
  }}>{busy ? "Checking…" : "Reconcile"}</Button>{error ? <span role="alert" className="text-xs text-[var(--color-error)]">{error}</span> : null}</div>;
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
  { key: "application_fee_refund_status", label: "Fee truth", render: (v) => <Badge variant={v === "succeeded_positive" || v === "not_applicable" ? "success" : "warning"} dot>{v || "unknown_legacy"}</Badge> },
  { key: "application_fee_refund_terminal_reason", label: "Fee detail", render: (v) => v || "—" },
  { key: "id", label: "Recovery", render: (_v, row) => <RefundReconcileButton row={row} /> },
];
const REFUND_CSV = {
  columns: [
    { key: "created_at", label: "Created" }, { key: "brand_name", label: "Brand" }, { key: "order_id", label: "Order" },
    { key: "amount_cents", label: "Amount cents" }, { key: "currency", label: "Currency" }, { key: "status", label: "Status" },
    { key: "reason", label: "Reason" }, { key: "stripe_refund_id", label: "Refund id" },
  ],
  filename: "refunds",
};

// #4130: Stripe and Paystack disputes in one list (listAllDisputes merges both).
// Paystack = Mingla is merchant of record, so its clock is Mingla's internal
// review deadline; Stripe's is the evidence-due date.
function disputeDueCell(due, row) {
  if (row.closed) return <span className="text-[var(--color-text-muted)]">—</span>;
  if (row.provider === "paystack") {
    const { overdue, label } = deadlineCountdown(due);
    const late = overdue && !row.evidence_reviewed_at;
    return <span className={late ? "text-[#b91c1c] font-medium" : "text-[var(--color-text-secondary)]"}>{label}</span>;
  }
  return evidenceDue(due);
}
const DISPUTE_COLUMNS = [
  { key: "created_at", label: "Opened", render: (v) => <span className="text-xs text-[var(--color-text-tertiary)]">{timeAgo(v)}</span> },
  { key: "provider", label: "Provider", render: (v) => <Badge variant="default">{v === "paystack" ? "Paystack" : "Stripe"}</Badge> },
  { key: "brand_name", label: "Brand", render: brandCell },
  { key: "reference", label: "Reference", render: (v) => (v ? <span className="font-mono text-xs break-all">{v}</span> : <span className="text-[var(--color-text-muted)]">—</span>) },
  { key: "amount_cents", label: "Amount", render: (v, row) => <span className="font-medium">{formatMoney(v, row.currency)}</span> },
  {
    key: "state",
    label: "Status",
    render: (v, row) => {
      const variant = row.closed ? "default" : v === "needs_review" || v === "needs_response" || v === "warning_needs_response" ? "error" : "warning";
      return <Badge variant={variant} dot>{(v || "—").replaceAll("_", " ")}</Badge>;
    },
  },
  { key: "reason", label: "Reason", render: (v) => v || <span className="text-[var(--color-text-muted)]">—</span> },
  { key: "due_at", label: "Evidence due", render: disputeDueCell },
];
const DISPUTE_CSV = {
  columns: [
    { key: "created_at", label: "Opened" }, { key: "provider", label: "Provider" }, { key: "brand_name", label: "Brand" },
    { key: "reference", label: "Reference" }, { key: "amount_cents", label: "Amount cents" }, { key: "currency", label: "Currency" },
    { key: "state", label: "Status" }, { key: "reason", label: "Reason" }, { key: "due_at", label: "Evidence due" },
  ],
  filename: "disputes",
};

const PAYOUT_COLUMNS = [
  { key: "brand_name", label: "Brand", render: brandCell },
  { key: "provider", label: "Rail", render: (v) => <Badge variant="default">{v === "paystack" ? "Paystack" : v === "stripe" ? "Stripe" : v || "—"}</Badge> },
  { key: "ticket_cents", label: "Ticket price", render: (v, row) => <span className="tabular-nums">{formatMoney(v, row.currency)}</span> },
  { key: "mingla_fee_cents", label: "Mingla fee", render: (v, row) => <FeeCell fee={v} ticket={row.ticket_cents} currency={row.currency} /> },
  { key: "gross_cents", label: "Buyer paid", render: (v, row) => <span className="font-medium tabular-nums">{formatMoney(v, row.currency)}</span> },
  { key: "sent_to_bank_cents", label: "Sent to bank", render: (v, row) => <span className="tabular-nums">{formatMoney(v, row.currency)}</span> },
  { key: "due_at", label: "Due", render: (v) => (v ? formatDateTime(v) : "—") },
  { key: "status", label: "Status", render: (v) => <Badge variant={v === "paid" ? "success" : ["late_on_us", "couldnt_send", "needs_you"].includes(v) ? "error" : "warning"} dot>{(v || "—").replaceAll("_", " ")}</Badge> },
  { key: "why", label: "Why", render: (v) => v || <span className="text-[var(--color-text-muted)]">—</span> },
  { key: "transfer_fee_credit_owed_cents", label: "Mingla owes back", render: (v, row) => v > 0 ? <span className="font-medium text-[var(--color-error-700)]">{formatMoney(v, row.currency)}</span> : "—" },
];
const PAYOUT_CSV = {
  columns: [
    { key: "id", label: "Payout id" }, { key: "brand_name", label: "Brand" }, { key: "provider", label: "Rail" },
    { key: "sales_count", label: "Sales" }, { key: "ticket_cents", label: "Ticket price cents" },
    { key: "gross_cents", label: "Buyers paid cents" }, { key: "mingla_fee_cents", label: "Mingla fee cents" },
    { key: "host_gets_cents", label: "Host gets cents" }, { key: "sent_to_bank_cents", label: "Sent to bank cents" },
    { key: "currency", label: "Currency" }, { key: "due_at", label: "Due" }, { key: "status", label: "Status" },
    { key: "why", label: "Why" }, { key: "transfer_fee_credit_owed_cents", label: "Mingla owes back cents" },
  ],
  filename: "payouts",
};

// #3645 PR9 — organiser payout debt (READ-ONLY). What each brand owes after a
// post-payout refund/chargeback/cancellation and how much has recovered.
const DEBT_COLUMNS = [
  { key: "opened_at", label: "Opened", render: (v) => <span className="text-xs text-[var(--color-text-tertiary)]">{timeAgo(v)}</span> },
  { key: "brand_name", label: "Brand", render: brandCell },
  { key: "kind", label: "Kind", render: (v) => <Badge variant="default">{(v || "").replace(/^post_release_/, "") || "—"}</Badge> },
  { key: "principal_cents", label: "Principal", render: (v, row) => <span className="font-medium">{formatMoney(v, row.currency)}</span> },
  { key: "recovered_cents", label: "Recovered", render: (v, row) => formatMoney(v, row.currency) },
  { key: "outstanding_cents", label: "Outstanding", render: (v, row) => <span className="font-medium">{formatMoney(v, row.currency)}</span> },
  { key: "status", label: "Status", render: (v) => <Badge variant={v === "closed" ? "success" : v === "converted" ? "default" : "warning"} dot>{v || "—"}</Badge> },
];
const DEBT_CSV = {
  columns: [
    { key: "opened_at", label: "Opened" }, { key: "brand_name", label: "Brand" }, { key: "kind", label: "Kind" },
    { key: "principal_cents", label: "Principal cents" }, { key: "recovered_cents", label: "Recovered cents" },
    { key: "outstanding_cents", label: "Outstanding cents" }, { key: "currency", label: "Currency" }, { key: "status", label: "Status" },
  ],
  filename: "organiser-debts",
};

// #4130: Payouts first; one Disputes tab for both providers; the old Platform
// revenue tab is a link to Mingla money.
const TABS = [
  { id: "payouts", label: "Payouts" },
  { id: "refunds", label: "Refunds" },
  { id: "disputes", label: "Disputes" },
  { id: "debts", label: "Organiser debts" },
  { id: "stay", label: "Stay reconciliation" },
  { id: "revenue", label: "Revenue → Mingla money" },
];
// Old addresses keep working.
const TAB_ALIASES = { paystack_disputes: "disputes" };
const PAYOUT_STATUSES = ["scheduled", "sending_today", "on_its_way", "paid", "waiting_for_bank", "late_on_us", "needs_you", "couldnt_send", "paused"];

// ── Hash helpers ──────────────────────────────────────────────────────────────

function hashParams() {
  return new URLSearchParams(window.location.hash.split("?")[1] || "");
}
function tabFromHash() {
  const raw = hashParams().get("tab");
  const t = TAB_ALIASES[raw] || raw;
  return TABS.some((x) => x.id === t) && t !== "revenue" ? t : "payouts";
}
function payoutStatusFromHash() {
  const v = hashParams().get("status");
  return PAYOUT_STATUSES.includes(v) ? v : null;
}
function disputeIdFromHash() {
  return hashParams().get("disputeId");
}
function paystackDisputeIdFromHash() {
  return hashParams().get("paystackDisputeId");
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
  const [paystackDisputeId, setPaystackDisputeId] = useState(() => paystackDisputeIdFromHash());
  const [disputeBundle, setDisputeBundle] = useState(null);
  const [disputeLoading, setDisputeLoading] = useState(false);
  const [disputeError, setDisputeError] = useState(null);
  const [annotateOpen, setAnnotateOpen] = useState(false);
  const [note, setNote] = useState("");
  const [markReviewed, setMarkReviewed] = useState(false);
  const [payoutSummary, setPayoutSummary] = useState(null);
  const [summaryError, setSummaryError] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [selectedPayout, setSelectedPayout] = useState(null);
  const [settleCurrency, setSettleCurrency] = useState(null);
  const [settleReference, setSettleReference] = useState("");
  const [payoutListKey, setPayoutListKey] = useState(0);
  const [initialPayoutStatus] = useState(() => payoutStatusFromHash());

  // #4130: a failed load shows an error with Retry, never blank cards.
  const loadPayoutSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      setPayoutSummary(await getPayoutSummary());
    } catch (err) {
      setPayoutSummary(null);
      setSummaryError(err?.message || null);
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab !== "payouts") return undefined;
    const timer = window.setTimeout(() => void loadPayoutSummary(), 0);
    return () => window.clearTimeout(timer);
  }, [activeTab, loadPayoutSummary]);

  const runSettle = useCallback(async ({ reason }) => {
    const reference = settleReference.trim();
    if (reference.length < 3) throw new Error("Add the payment reference Mingla used to repay the hosts.");
    const { error: err } = await settleOwesBack({ currency: settleCurrency, reference, reason });
    if (err) {
      const msg = err.message || "";
      if (msg.includes("not_authorized")) throw new Error("Admin access required.");
      if (msg.includes("nothing_to_settle")) throw new Error("Nothing is owed back in this currency any more.");
      if (msg.includes("reference_required")) throw new Error("Add the payment reference (3 to 200 characters).");
      if (msg.includes("reason_required")) throw new Error("A reason is required.");
      throw new Error(msg || "Couldn't mark this settled.");
    }
    setSettleReference("");
    await loadPayoutSummary();
    setPayoutListKey((k) => k + 1);
  }, [settleCurrency, settleReference, loadPayoutSummary]);

  useEffect(() => {
    const sync = () => {
      setActiveTab(tabFromHash());
      setDisputeId(disputeIdFromHash());
      setPaystackDisputeId(paystackDisputeIdFromHash());
    };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const changeTab = useCallback((tabId) => {
    if (tabId === "revenue") {
      window.location.hash = "#/mingla-money";
      return;
    }
    window.location.hash = `#/business-money-ledger?tab=${tabId}`;
    setActiveTab(tabId);
  }, []);

  const openDispute = useCallback((id) => {
    window.location.hash = `#/business-money-ledger?tab=disputes&disputeId=${id}`;
    setDisputeId(id);
  }, []);

  const openPaystackDispute = useCallback((id) => {
    window.location.hash = `#/business-money-ledger?tab=disputes&paystackDisputeId=${id}`;
    setPaystackDisputeId(id);
  }, []);

  const backToPaystackDisputes = useCallback(() => {
    window.location.hash = "#/business-money-ledger?tab=disputes";
    setPaystackDisputeId(null);
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
    if (!disputeId) return undefined;
    const timer = window.setTimeout(() => void loadDispute(disputeId), 0);
    return () => window.clearTimeout(timer);
  }, [disputeId, loadDispute]);

  const openAnnotate = useCallback(() => {
    setNote(disputeBundle?.dispute?.admin_internal_note || "");
    setMarkReviewed(false);
    setAnnotateOpen(true);
  }, [disputeBundle]);

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

  // ── Paystack dispute detail (evidence workflow) ─────────────────────────────
  if (paystackDisputeId) {
    return (
      <PaystackDisputeDetail
        key={paystackDisputeId}
        disputeId={paystackDisputeId}
        onBack={backToPaystackDisputes}
      />
    );
  }

  // ── Dispute detail view ─────────────────────────────────────────────────────
  if (disputeId) {
    const d = disputeBundle?.dispute || {};
    const badges = [];
    if (disputeBundle) {
      const variant = d.status === "won" ? "success" : d.status === "lost" ? "default" : "warning";
      badges.push({ label: d.status || "dispute", variant });
    }
    return (
      <div>
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
            <Button variant="secondary" size="md" onClick={openAnnotate}>
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
        filters={[{ key: "status", label: "Status", options: [{ value: "succeeded", label: "Succeeded" }, { value: "pending", label: "Pending" }, { value: "failed", label: "Failed" }, { value: "cancelled", label: "Cancelled" }] }]}
        csv={REFUND_CSV}
        emptyMessage="No refunds yet. When a buyer is refunded on Stripe or Paystack it appears here with the fee Mingla gave back."
        emptyIcon={Landmark}
      />
    );
  } else if (activeTab === "disputes") {
    listView = (
      <EntityListView
        key="disputes"
        title="Disputes"
        columns={DISPUTE_COLUMNS}
        fetchPage={listAllDisputes}
        searchPlaceholder="Search dispute id, charge id or transaction reference"
        filters={[
          { key: "status", label: "Status", options: [{ value: "open", label: "Open" }, { value: "closed", label: "Closed" }] },
          { key: "provider", label: "Provider", options: [{ value: "stripe", label: "Stripe" }, { value: "paystack", label: "Paystack" }] },
        ]}
        onRowClick={(row) => (row.provider === "paystack" ? openPaystackDispute(row.id) : openDispute(row.id))}
        csv={DISPUTE_CSV}
        emptyMessage="No disputes on Stripe or Paystack. Chargebacks from both providers appear here, evidence due first."
        emptyIcon={Landmark}
        rowKey={(row) => row.key}
      />
    );
  } else if (activeTab === "payouts") {
    listView = (
      <EntityListView
        key={`payouts-${payoutListKey}`}
        title="Payouts"
        initialFilters={initialPayoutStatus ? { status: initialPayoutStatus } : undefined}
        columns={PAYOUT_COLUMNS}
        fetchPage={listPayouts}
        searchPlaceholder="Search payout id"
        filters={[{ key: "status", label: "Status", allLabel: `All · ${payoutSummary?.total_count ?? 0}`, options: [
          { value: "scheduled", label: `Scheduled · ${payoutSummary?.count_by_state?.scheduled ?? 0}` },
          { value: "sending_today", label: `Sending today · ${payoutSummary?.count_by_state?.sending_today ?? 0}` },
          { value: "on_its_way", label: `On its way · ${payoutSummary?.count_by_state?.on_its_way ?? 0}` },
          { value: "paid", label: `Paid · ${payoutSummary?.count_by_state?.paid ?? 0}` },
          { value: "waiting_for_bank", label: `Waiting for bank · ${payoutSummary?.count_by_state?.waiting_for_bank ?? 0}` },
          { value: "late_on_us", label: `Late, on us · ${payoutSummary?.count_by_state?.late_on_us ?? 0}` },
          { value: "needs_you", label: `Needs you · ${payoutSummary?.count_by_state?.needs_you ?? 0}` },
          { value: "couldnt_send", label: `Couldn't send · ${payoutSummary?.count_by_state?.couldnt_send ?? 0}` },
          { value: "paused", label: `Paused · ${payoutSummary?.count_by_state?.paused ?? 0}` },
        ] }]}
        filterVariant="chips"
        onRowClick={setSelectedPayout}
        csv={PAYOUT_CSV}
        emptyMessage="No payouts match. Each sale's payout appears here about 24 hours after payment."
        emptyIcon={Landmark}
      />
    );
  } else if (activeTab === "debts") {
    listView = (
      <EntityListView
        key="debts"
        title="Organiser debts"
        columns={DEBT_COLUMNS}
        fetchPage={listOrganiserPayoutDebts}
        searchPlaceholder="Search brand name, slug, debt id or origin release id"
        filters={[{ key: "status", label: "Status", options: [{ value: "open", label: "Open" }, { value: "closed", label: "Closed" }, { value: "converted", label: "Converted" }] }]}
        csv={DEBT_CSV}
        emptyMessage="No organiser debts. A debt appears when a host owes Mingla after a refund or dispute."
        emptyIcon={Landmark}
      />
    );
  } else if (activeTab === "stay") {
    listView = <StayOperationsPanel key="stay" />;
  }

  const owedEntries = Object.entries(payoutSummary?.transfer_fee_credits_owed_by_currency ?? {}).filter(([, v]) => Number(v) > 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={activeTab === "payouts" ? "Money ledger · Payouts" : "Money ledger"}
        description={activeTab === "payouts"
          ? "Every sale's payout from the release ledger, across Stripe and Paystack. Each sale is due about 24 hours after payment. Totals and profit live on Mingla money."
          : "Every payout, refund, dispute and debt, row by row. Totals and profit live on Mingla money."}
        tabs={<Tabs tabs={TABS} activeTab={activeTab} onChange={changeTab} />}
      />

      {activeTab === "payouts" && summaryError ? (
        <LoadError title="Couldn't load the payout totals" message={summaryError} onRetry={loadPayoutSummary} retrying={summaryLoading} />
      ) : null}
      {activeTab === "payouts" && !payoutSummary && !summaryError ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-busy="true">
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} height={96} />)}
        </div>
      ) : null}
      {activeTab === "payouts" && payoutSummary ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Payout summary">
          <PayoutMetric title="Due next 24 hours" value={formatCurrencyMap(payoutSummary.due_next_24h_by_currency) === "—" ? "None" : formatCurrencyMap(payoutSummary.due_next_24h_by_currency)} />
          <PayoutMetric
            title="Late on Mingla"
            value={(payoutSummary.late_count ?? 0) > 0 ? formatCurrencyMap(payoutSummary.late_by_currency) : "None"}
            sub={payoutSummary.oldest_late_due_at ? `${payoutSummary.late_count} · oldest due ${formatDateTime(payoutSummary.oldest_late_due_at)}` : "None late"}
            alert={(payoutSummary.late_count ?? 0) > 0}
          />
          <PayoutMetric
            title="Waiting for host bank"
            value={(payoutSummary.waiting_for_bank_count ?? 0) > 0 ? formatCurrencyMap(payoutSummary.waiting_for_bank_by_currency) : "None"}
            sub={`${payoutSummary.waiting_for_bank_count ?? 0} waiting for the host to add a bank`}
          />
          <PayoutMetric
            title="Paid last 24 hours"
            value={formatCurrencyMap(payoutSummary.paid_last_24h_by_currency) === "—" ? "None" : formatCurrencyMap(payoutSummary.paid_last_24h_by_currency)}
            sub={payoutSummary.paid_last_24h_count != null ? `${payoutSummary.paid_last_24h_count} payouts` : undefined}
          />
          <PayoutMetric
            title="Mingla owes back"
            value={owedEntries.length ? formatCurrencyMap(payoutSummary.transfer_fee_credits_owed_by_currency) : "Nothing owed"}
            sub={owedEntries.length ? "Transfer fees Mingla held back from hosts" : "Marked settled credits no longer count"}
            alert={owedEntries.length > 0}
            action={owedEntries.length ? (
              <div className="flex flex-wrap gap-1.5">
                {owedEntries.map(([currency, cents]) => (
                  <Button key={currency} variant="secondary" size="sm" onClick={() => setSettleCurrency(currency)}>
                    Mark {formatMoney(Number(cents), currency)} settled
                  </Button>
                ))}
              </div>
            ) : null}
          />
        </div>
      ) : null}

      {listView}
      <PayoutDetailDrawer payout={selectedPayout} onClose={() => setSelectedPayout(null)} />
      <HighRiskActionModal
        open={settleCurrency != null}
        onClose={() => { setSettleCurrency(null); setSettleReference(""); }}
        title={settleCurrency ? `Mark ${formatMoney(Number(payoutSummary?.transfer_fee_credits_owed_by_currency?.[settleCurrency] ?? 0), settleCurrency)} settled?` : "Mark settled"}
        description="Use this once Mingla has paid hosts back the transfer fees it held. It records who settled it, when, and the payment reference, and the amount stops counting as owed. No money moves."
        confirmLabel="Mark settled"
        onConfirm={runSettle}
        successMessage="Marked settled."
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="settle-reference" className="text-xs font-medium text-[var(--color-text-secondary)]">
            Payment reference (required)
          </label>
          <input
            id="settle-reference"
            type="text"
            value={settleReference}
            onChange={(e) => setSettleReference(e.target.value)}
            placeholder="The transfer reference Mingla used to repay the hosts"
            className="h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]"
          />
        </div>
      </HighRiskActionModal>
    </div>
  );
}

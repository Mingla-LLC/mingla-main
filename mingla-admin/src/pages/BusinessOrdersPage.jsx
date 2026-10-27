// ORCH-1274 [Admin Money console] — Orders console.
//
// Cross-brand order search/list → an order detail bundle (offering + brand +
// buyer + amount + status + line items + installments + refunds + partner split
// + pricing/tax breakdown). A "View subscriber" link opens the read-only
// SubscriberContextCard when the order has a buyer_user_id.
//
// #4130 Wave 2a: every order shows its ticket price, Mingla fee, what the buyer
// paid and whether the host has been paid for it (admin_list_orders). The
// status filter is the real one (pending, paid, failed, refunded, partial
// refund, cancelled) plus Free and Host not paid. Discounts and margin are two
// separate cards (admin_orders_overview). Free orders read "Free" and have no
// refund button; the refund window names the brand's own provider.

import { useState, useEffect, useCallback } from "react";
import { Receipt } from "lucide-react";
import { EntityListView } from "../components/entity/EntityListView";
import { EntityDetailView } from "../components/entity/EntityDetailView";
import { SubscriberContextCard } from "../components/entity/SubscriberContextCard";
import { HighRiskActionModal } from "../components/entity/HighRiskActionModal";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { listOrders, getOrder, getOrdersOverview } from "../services/adminMoneyService";
import { formatMoneyMinor } from "../lib/moneyFormat";
import { LoadError } from "../components/ui/LoadError";
import { Skeleton } from "../components/ui/Skeleton";
import {
  createAdminRefundIdempotencyKey,
  refundOrder,
} from "../services/adminMoneyActService";
import { timeAgo, formatDateTime } from "../lib/formatters";
import { PageHeader } from "../components/ui/PageHeader";

// Order payment_status values (DB enum) an admin may refund.
const REFUNDABLE_STATUSES = ["paid", "partial_refund"];

// Map admin-refund-order edge-fn error codes → user-facing copy.
function refundErrorCopy(code) {
  switch (code) {
    case "refund_exceeds_remaining": return "Amount exceeds what's left to refund.";
    case "line_overrefund": return "One or more items are already fully refunded.";
    case "stripe_declined": return "Stripe declined — no money moved.";
    // #4130: Paystack refunds (admin-refund-order maps these for Paystack brands).
    case "paystack_refund_failed": return "Paystack refused the refund — no money moved.";
    case "paystack_refund_retryable": return "Paystack is busy — nothing was refunded yet. Try again in a few minutes.";
    case "paystack_refund_below_minimum": return "The amount is below Paystack's smallest refund. Refund a larger amount or the full order.";
    case "paystack_refund_duplicate_ambiguous": return "Paystack may already have a refund for this order. Check Refund operations before trying again.";
    case "paystack_refund_transaction_state_ambiguous": return "Paystack could not confirm the payment's state. Check Refund operations before trying again.";
    case "order_not_refundable": return "This order can't be refunded.";
    case "missing_connected_account": return "This brand has no Stripe account to refund from.";
    case "missing_payment_intent": return "This order has no payment reference to refund.";
    case "reason_invalid_length": return "Reason must be 10–200 characters.";
    case "forbidden": return "Admin access required.";
    case "unauthorized": return "Your session expired — sign in again.";
    case "idempotency_key_required": return "Couldn't start the refund. Please retry.";
    default: return null;
  }
}

// ── Money formatter: the shared one (#4130; never falls back to USD) ─────────

function formatMoney(cents, currency) {
  return formatMoneyMinor(cents, currency);
}

/** #4130: a free order reads "Free", never "$0.00". */
function isFreeOrder(order) {
  return order?.is_free === true
    || order?.payment_method === "free"
    || Number(order?.buyer_total_cents ?? order?.total_cents ?? 0) === 0;
}

const PROVIDER_NAME = { paystack: "Paystack", stripe: "Stripe" };

// ── Maps ──────────────────────────────────────────────────────────────────────

// #4130: the statuses orders really take (orders.payment_status).
const STATUS_VARIANT = {
  paid: "success",
  refunded: "default",
  partial_refund: "warning",
  failed: "warning",
  pending: "warning",
  cancelled: "default",
};
const STATUS_LABEL = {
  paid: "Paid",
  refunded: "Refunded",
  partial_refund: "Partial refund",
  failed: "Failed",
  pending: "Pending",
  cancelled: "Cancelled",
};

function statusBadge(status, row) {
  if (row && isFreeOrder(row) && status === "paid") return <Badge variant="default" dot>Free</Badge>;
  return <Badge variant={STATUS_VARIANT[status] || "default"} dot>{STATUS_LABEL[status] || status || "—"}</Badge>;
}

const HOST_PAID = {
  paid_out: { label: "Paid out", variant: "success" },
  in_payout: { label: "In a payout", variant: "info" },
  late: { label: "Late on Mingla", variant: "error" },
  waiting_for_bank: { label: "Waiting for bank", variant: "warning" },
  held: { label: "Held", variant: "warning" },
  not_in_payout: { label: "Not in a payout", variant: "error" },
};

function hostPaidCell(value) {
  if (value === "free") return <span className="text-[var(--color-text-muted)]">Free</span>;
  const h = HOST_PAID[value];
  if (!h) return <span className="text-[var(--color-text-muted)]">–</span>;
  return <Badge variant={h.variant} dot>{h.label}</Badge>;
}

// ── List columns / filters / csv ──────────────────────────────────────────────

const COLUMNS = [
  {
    key: "created_at",
    label: "When",
    render: (val) => <span className="text-xs text-[var(--color-text-tertiary)]">{timeAgo(val)}</span>,
  },
  {
    key: "buyer_name",
    label: "Buyer",
    render: (val, row) => (
      <div className="min-w-0">
        <span className="font-medium text-[var(--color-text-primary)] block truncate">{val || "—"}</span>
        <span className="text-xs text-[var(--color-text-muted)] block truncate">{row.buyer_email || row.buyer_phone || ""}</span>
      </div>
    ),
  },
  {
    key: "event_title",
    label: "Event · Brand",
    render: (val, row) => (
      <div className="min-w-0">
        <span className="block truncate">{val || "—"}</span>
        <span className="text-xs text-[var(--color-text-muted)] block truncate">{row.brand_name || ""}</span>
      </div>
    ),
  },
  {
    key: "ticket_cents",
    label: "Ticket",
    render: (val, row) => (isFreeOrder(row) ? "Free" : <span className="tabular-nums">{formatMoney(val, row.currency)}</span>),
  },
  {
    key: "mingla_fee_cents",
    label: "Mingla fee",
    render: (val, row) => (isFreeOrder(row) || val == null ? <span className="text-[var(--color-text-muted)]">–</span> : <span className="tabular-nums">{formatMoney(val, row.currency)}</span>),
  },
  {
    key: "buyer_paid_cents",
    label: "Buyer paid",
    render: (val, row) => (isFreeOrder(row) ? "Free" : <span className="font-medium tabular-nums">{formatMoney(val, row.currency)}</span>),
  },
  { key: "payment_status", label: "Status", render: (val, row) => statusBadge(val, row) },
  { key: "host_paid", label: "Host paid?", render: (val) => hostPaidCell(val) },
  {
    key: "flags",
    label: "Flags",
    render: (_val, row) => (
      <span className="flex flex-wrap items-center gap-1">
        {row.is_door_sale && <Badge variant="default">door</Badge>}
        {row.at_risk && <Badge variant="warning">at-risk</Badge>}
        {row.installment_plan_root && <Badge variant="info">installments</Badge>}
      </span>
    ),
  },
];

// #4130: the statuses orders really take, plus Free and Host not paid.
const STATUS_FILTER = {
  key: "status",
  label: "Status",
  options: [
    { value: "paid", label: "Paid" },
    { value: "free", label: "Free" },
    { value: "partial_refund", label: "Partial refund" },
    { value: "refunded", label: "Refunded" },
    { value: "failed", label: "Failed" },
    { value: "cancelled", label: "Cancelled" },
    { value: "pending", label: "Pending" },
    { value: "host_not_paid", label: "Host not paid" },
  ],
};
const FILTERS = [STATUS_FILTER];

const CSV = {
  columns: [
    { key: "order_id", label: "Order ID" },
    { key: "created_at", label: "Created at" },
    { key: "buyer_email", label: "Buyer email" },
    { key: "buyer_phone", label: "Buyer phone" },
    { key: "brand_name", label: "Brand" },
    { key: "event_title", label: "Event" },
    { key: "currency", label: "Currency" },
    { key: "ticket_cents", label: "Ticket cents" },
    { key: "mingla_fee_cents", label: "Mingla fee cents" },
    { key: "buyer_paid_cents", label: "Buyer paid cents" },
    { key: "payment_status", label: "Status" },
    { key: "host_paid", label: "Host paid" },
    { key: "provider", label: "Provider" },
    { key: "stripe_payment_intent_id", label: "Payment reference" },
    { key: "refunded_amount_cents", label: "Refunded cents" },
  ],
  filename: "orders",
};

function statusFromHash() {
  const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
  const v = params.get("status");
  return STATUS_FILTER.options.some((o) => o.value === v) ? v : null;
}

function moneyList(items, key) {
  const parts = (items ?? []).filter((i) => Number(i[key]) !== 0).map((i) => formatMoney(Number(i[key]), i.currency));
  return parts.length ? parts.join(" · ") : null;
}

/** #4130: three cards — paid orders all time, discounts given, margin. Never mixed. */
function OrdersOverviewCards() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const to = new Date();
      const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
      setData(await getOrdersOverview(from.toISOString(), to.toISOString()));
    } catch (err) {
      setData(null);
      setError(err?.message || null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (error) return <LoadError title="Couldn't load the order totals" message={error} onRetry={load} retrying={loading} />;
  if (!data) {
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3" aria-busy="true">
        {[0, 1, 2].map((i) => <Skeleton key={i} height={104} />)}
      </div>
    );
  }
  const paidCount = (data.paid_all_time ?? []).reduce((n, r) => n + Number(r.orders || 0), 0);
  const discountCount = (data.discounts ?? []).reduce((n, r) => n + Number(r.orders || 0), 0);
  const belowZero = (data.margin ?? []).reduce((n, r) => n + Number(r.below_zero || 0), 0);
  const card = (label, value, sub) => (
    <section className="rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-4" aria-label={label}>
      <p className="text-xs text-[var(--color-text-tertiary)]">{label}</p>
      <div className="mt-1 text-[22px] font-bold tabular-nums text-[var(--color-text-primary)]">{value}</div>
      <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{sub}</div>
    </section>
  );
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {card(
        "Paid orders, all time",
        <span>{paidCount.toLocaleString()} <span className="text-sm font-medium text-[var(--color-text-tertiary)]">+ {Number(data.free_orders_all_time || 0).toLocaleString()} free</span></span>,
        moneyList(data.paid_all_time, "buyer_paid_cents") || "No paid orders yet",
      )}
      {card(
        "Discounts given, last 30 days",
        `${discountCount.toLocaleString()} ${discountCount === 1 ? "order" : "orders"}`,
        moneyList(data.discounts, "discount_cents") ? `${moneyList(data.discounts, "discount_cents")} given away` : "No discounted orders in this period",
      )}
      {card(
        "Mingla margin on sales, last 30 days",
        moneyList(data.margin, "margin_cents") || "No sales in this period",
        belowZero > 0
          ? <span className="text-[var(--color-error-700)]">{belowZero} {belowZero === 1 ? "sale" : "sales"} below zero</span>
          : "Fee minus card processing, per currency",
      )}
    </div>
  );
}

// ── Hash helpers ──────────────────────────────────────────────────────────────

function orderIdFromHash() {
  const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
  return params.get("orderId");
}

// ── Detail section builders ───────────────────────────────────────────────────

function field(label, value, render) {
  return { label, value, render };
}
const noneField = (text) => field("", text, (v) => <span className="text-[var(--color-text-muted)]">{v}</span>);

function jsonBlock(obj) {
  if (!obj || (typeof obj === "object" && Object.keys(obj).length === 0)) {
    return <span className="text-[var(--color-text-muted)]">—</span>;
  }
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-[var(--color-brand-500)]">Show breakdown</summary>
      <pre className="mt-1 overflow-x-auto rounded-md bg-[var(--gray-100)] p-2 text-[11px] leading-relaxed">
        {JSON.stringify(obj, null, 2)}
      </pre>
    </details>
  );
}

function buildOrderSections(bundle, onViewSubscriber, money) {
  const order = bundle.order || {};
  const event = bundle.event || null;
  const brand = bundle.brand || null;
  const lineItems = Array.isArray(bundle.line_items) ? bundle.line_items : [];
  const installments = Array.isArray(bundle.installments) ? bundle.installments : [];
  const refunds = Array.isArray(bundle.refunds) ? bundle.refunds : [];
  const discountLines = Array.isArray(bundle.discount_lines) ? bundle.discount_lines : [];
  const split = bundle.partner_split || null;

  const sections = [
    // #4130: what the buyer paid, what Mingla kept, and whether the host was paid.
    {
      label: "Money",
      fields: money
        ? [
            field("Provider", PROVIDER_NAME[money.provider] || "—"),
            field("Ticket", null, () => (isFreeOrder(money) ? "Free" : formatMoney(money.ticket_cents, money.currency))),
            field("Mingla fee", null, () => (money.mingla_fee_cents == null ? "—" : formatMoney(money.mingla_fee_cents, money.currency))),
            field("Card processing Mingla paid", null, () => (money.processing_cents == null ? "—" : formatMoney(money.processing_cents, money.currency))),
            field("Host paid?", null, () => hostPaidCell(money.host_paid)),
          ]
        : [noneField("Couldn't load the money summary for this order")],
    },
    {
      label: "Order",
      fields: [
        field("Order id", order.id, (v) => <span className="font-mono text-xs break-all">{v}</span>),
        field("Status", null, () => statusBadge(order.payment_status)),
        field("Amount", null, () => <span className="font-medium">{isFreeOrder(order) ? "Free" : formatMoney(order.total_cents, order.currency)}</span>),
        field("List subtotal", null, () => formatMoney(order.list_subtotal_cents ?? order.net_subtotal_cents ?? order.total_cents, order.currency)),
        field("Discount", null, () => order.discount_cents > 0 ? `−${formatMoney(order.discount_cents, order.currency)}` : "—"),
        field("Fees & tax", null, () => formatMoney((order.buyer_fees_cents ?? 0) + (order.tax_cents ?? 0), order.currency)),
        field("Buyer paid", null, () => <span className="font-medium">{formatMoney(order.buyer_total_cents ?? order.total_cents, order.currency)}</span>),
        field("Refunded", null, () => (order.refunded_amount_cents ? formatMoney(order.refunded_amount_cents, order.currency) : "—")),
        field("Tax", null, () => (order.tax_amount_cents != null ? formatMoney(order.tax_amount_cents, order.currency) : "—")),
        field("App fee", null, () =>
          order.stripe_application_fee_amount_cents != null ? formatMoney(order.stripe_application_fee_amount_cents, order.currency) : "—",
        ),
        field("Payment method", order.payment_method),
        field("Payment reference", order.stripe_payment_intent_id, (v) => <span className="font-mono text-xs break-all">{v}</span>),
        field("Charge id", order.stripe_charge_id, (v) => <span className="font-mono text-xs break-all">{v}</span>),
        field("Created", order.created_at, (v) => formatDateTime(v)),
        field("Confirmed", order.confirmed_at, (v) => formatDateTime(v)),
        field("Failed", order.failed_at, (v) => formatDateTime(v)),
      ],
    },
    {
      label: "Buyer",
      fields: [
        field("Name", order.buyer_name),
        field("Email", order.buyer_email),
        field("Phone", order.buyer_phone),
        order.buyer_user_id
          ? field("Subscriber", null, () => (
              <button
                type="button"
                onClick={() => onViewSubscriber(order.buyer_user_id)}
                className="text-left text-[var(--color-brand-500)] underline cursor-pointer hover:opacity-80"
              >
                View subscriber
              </button>
            ))
          : field("Subscriber", "Anonymous buyer (no account)", (v) => <span className="text-[var(--color-text-muted)]">{v}</span>),
      ],
    },
    {
      label: "Offering",
      fields: event
        ? [
            field("Title", event.title),
            field("Type", event.event_type),
            field("City", event.city),
            field("Visibility", event.visibility),
            field("Status", event.status),
            field("Brand", brand?.name),
          ]
        : [noneField("No linked offering")],
    },
    {
      label: `Line items (${lineItems.length})`,
      fields:
        lineItems.length === 0
          ? [noneField("No line items")]
          : lineItems.map((li, i) =>
              field(li.ticket_type_name || `Item ${i + 1}`, li, (item) => (
                <span className="flex flex-wrap items-center gap-2">
                  <span>×{item.quantity}</span>
                  {item.list_unit_price_cents > item.unit_price_cents && (
                    <span className="text-xs line-through text-[var(--color-text-muted)]">{formatMoney(item.list_unit_price_cents, order.currency)} ea</span>
                  )}
                  <span className="text-[var(--color-text-tertiary)]">{formatMoney(item.unit_price_cents, order.currency)} ea</span>
                  <span className="font-medium">{formatMoney(item.total_cents, order.currency)}</span>
                </span>
              )),
            ),
    },
    {
      label: `Discounts (${discountLines.length})`,
      fields:
        discountLines.length === 0
          ? [noneField("No discounts")]
          : discountLines.map((line) =>
              field(line.name_snapshot || "Discount", null, () => (
                <span className="font-medium text-emerald-700">−{formatMoney(line.amount_minor, line.currency || order.currency)}</span>
              )),
            ),
    },
    {
      label: `Installments (${installments.length})`,
      fields:
        installments.length === 0
          ? [noneField("No installment plan")]
          : installments.map((it) =>
              field(`#${it.ordinal}`, it, (inst) => (
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{formatMoney(inst.amount_cents, inst.currency)}</span>
                  <Badge variant={inst.status === "collected" ? "success" : inst.status === "failed" ? "error" : "warning"}>{inst.status}</Badge>
                  {inst.due_at && <span className="text-xs text-[var(--color-text-tertiary)]">due {formatDateTime(inst.due_at)}</span>}
                </span>
              )),
            ),
    },
    {
      label: `Refunds (${refunds.length})`,
      fields:
        refunds.length === 0
          ? [noneField("No refunds")]
          : refunds.map((r) =>
              field(formatMoney(r.amount_cents, r.currency), r, (ref) => (
                <span className="flex flex-wrap items-center gap-2">
                  <Badge variant={ref.status === "succeeded" ? "success" : "warning"}>{ref.status}</Badge>
                  {ref.reason && <span className="text-xs text-[var(--color-text-tertiary)]">{ref.reason}</span>}
                  {ref.processed_at && <span className="text-xs text-[var(--color-text-tertiary)]">{formatDateTime(ref.processed_at)}</span>}
                </span>
              )),
            ),
    },
    {
      label: "Partner split",
      fields: split
        ? [
            field("Mingla fee", null, () => formatMoney(split.mingla_fee_cents, split.transfer_currency)),
            field("Partner share", null, () => formatMoney(split.partner_share_cents, split.transfer_currency)),
            field("Status", split.status),
          ]
        : [noneField("No partner split")],
    },
    {
      label: "Pricing / tax breakdown",
      fields: [
        field("Pricing breakdown", null, () => jsonBlock(order.pricing_breakdown)),
        field("Tax breakdown", null, () => jsonBlock(order.tax_breakdown)),
      ],
    },
  ];

  return sections;
}

// ── Refund modal (W2-A) — line-picker + typed-amount confirm ──────────────────
// A HighRiskActionModal variant: picks per-line quantities (bounded by remaining
// refundable), auto-computes each line amount (unit_price × qty, read-only), and
// requires typing the exact refund total to confirm. amount_cents is integer cents
// throughout. On success, refetches the order.

// Mounted only while open (parent gates with `refundOpen &&`), so picks reset on
// each open without a setState-in-effect.
function RefundModal({ onClose, order, lineItems, onRefunded, provider }) {
  const [qtys, setQtys] = useState({});
  const [idempotencyKey] = useState(createAdminRefundIdempotencyKey);

  const rows = (lineItems || []).map((li) => {
    const remaining = Math.max(0, (li.quantity ?? 0) - (li.refunded_quantity ?? 0));
    const qty = qtys[li.order_line_item_id] ?? 0;
    return {
      id: li.order_line_item_id,
      name: li.ticket_type_name,
      unit: li.unit_price_cents ?? 0,
      remaining,
      qty,
      amount: (li.unit_price_cents ?? 0) * qty,
    };
  });
  const totalCents = rows.reduce((s, r) => s + r.amount, 0);
  const confirmPhrase = (totalCents / 100).toFixed(2);

  const setQty = (id, val, max) => {
    const parsed = Math.floor(Number(val));
    const n = Number.isFinite(parsed) ? Math.max(0, Math.min(max, parsed)) : 0;
    setQtys((prev) => ({ ...prev, [id]: n }));
  };

  const selectFull = () => {
    const next = {};
    rows.forEach((r) => {
      if (r.remaining > 0) next[r.id] = r.remaining;
    });
    setQtys(next);
  };

  const handleConfirm = async ({ reason }) => {
    const lines = rows
      .filter((r) => r.qty > 0)
      .map((r) => ({ order_line_item_id: r.id, quantity: r.qty, amount_cents: r.amount }));
    if (lines.length === 0) throw new Error("Pick at least one item to refund.");
    const { error } = await refundOrder({
      order_id: order.id,
      lines,
      reason,
      idempotencyKey,
    });
    if (error) {
      let code = null;
      let detail = null;
      try {
        const b = await error.context?.json();
        code = b?.error;
        detail = b?.detail;
      } catch {
        // non-JSON error body — fall through to the generic message.
      }
      throw new Error(refundErrorCopy(code) || detail || error.message || "Refund failed.");
    }
    onRefunded?.();
  };

  const inputClass = [
    "w-16 h-9 px-2 text-sm text-right rounded-lg",
    "bg-[var(--color-background-primary)] text-[var(--color-text-primary)]",
    "border border-[var(--gray-300)] outline-none",
    "focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]",
    "disabled:opacity-50 disabled:cursor-not-allowed",
  ].join(" ");

  return (
    <HighRiskActionModal
      open
      onClose={onClose}
      title="Issue refund"
      description={`Refunds move real money through ${PROVIDER_NAME[provider] || "the brand's payment provider"}. Pick the items, then type the exact total to confirm.`}
      confirmLabel="Refund"
      destructive
      confirmPhrase={confirmPhrase}
      onConfirm={handleConfirm}
      successMessage="Refund issued."
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-[var(--color-text-secondary)]">Items to refund</span>
          <button
            type="button"
            onClick={selectFull}
            className="text-xs text-[var(--color-brand-500)] underline cursor-pointer hover:opacity-80"
          >
            Full refund
          </button>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">No refundable line items on this order.</p>
        ) : (
          rows.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-[var(--gray-200)] px-3 py-2"
            >
              <div className="min-w-0">
                <span className="block truncate text-sm font-medium text-[var(--color-text-primary)]">
                  {r.name || "Item"}
                </span>
                <span className="block text-xs text-[var(--color-text-tertiary)]">
                  {formatMoney(r.unit, order.currency)} ea · {r.remaining} refundable
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <input
                  type="number"
                  min={0}
                  max={r.remaining}
                  value={r.qty}
                  onChange={(e) => setQty(r.id, e.target.value, r.remaining)}
                  disabled={r.remaining === 0}
                  className={inputClass}
                  aria-label={`Refund quantity for ${r.name || "item"}`}
                />
                <span className="w-20 text-right text-sm font-medium">{formatMoney(r.amount, order.currency)}</span>
              </div>
            </div>
          ))
        )}
        <div className="flex items-center justify-between border-t border-[var(--gray-200)] pt-2">
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">Refund total</span>
          <span className="text-sm font-bold text-[var(--color-text-primary)]">{formatMoney(totalCents, order.currency)}</span>
        </div>
      </div>
    </HighRiskActionModal>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BusinessOrdersPage() {
  const [selectedOrderId, setSelectedOrderId] = useState(() => orderIdFromHash());
  const [bundle, setBundle] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [subUserId, setSubUserId] = useState(null);
  const [refundOpen, setRefundOpen] = useState(false);
  const [money, setMoney] = useState(null);
  const [initialStatus] = useState(() => statusFromHash());

  useEffect(() => {
    const sync = () => setSelectedOrderId(orderIdFromHash());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);


  const loadOrder = useCallback(async (orderId) => {
    setLoading(true);
    setError(null);
    setBundle(null);
    setMoney(null);
    try {
      // #4130: the order's money row (provider, fee, host paid) from the list RPC.
      try {
        const found = await listOrders({ search: orderId, page: 0, pageSize: 5 });
        setMoney(found.rows.find((r) => r.order_id === orderId) || null);
      } catch {
        setMoney(null); // the Money section says it couldn't load; the order still shows
      }
      const { data, error: err } = await getOrder(orderId);
      if (err) {
        const msg = err.message || "";
        if (msg.includes("not_authorized")) setError("You are not authorized to view this order.");
        else if (msg.includes("not_found")) setError("No order found for this ID.");
        else setError(msg || "Failed to load this order.");
      } else {
        setBundle(data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedOrderId) loadOrder(selectedOrderId);
  }, [selectedOrderId, loadOrder]);

  const openOrder = useCallback((orderId) => {
    window.location.hash = `#/business-orders?orderId=${orderId}`;
    setSelectedOrderId(orderId);
  }, []);

  const backToList = useCallback(() => {
    window.location.hash = "#/business-orders";
    setSelectedOrderId(null);
    setBundle(null);
    setError(null);
  }, []);

  // ── Detail view ───────────────────────────────────────────────────────────
  if (selectedOrderId) {
    const order = bundle?.order || {};
    const brand = bundle?.brand || null;
    const badges = [];
    if (bundle) {
      badges.push({
        label: isFreeOrder(order) && order.payment_status === "paid" ? "Free" : STATUS_LABEL[order.payment_status] || order.payment_status || "—",
        variant: STATUS_VARIANT[order.payment_status] || "default",
      });
      if (order.currency) badges.push({ label: order.currency, variant: "default" });
    }

    return (
      <div>
        <EntityDetailView
          loading={loading}
          error={error}
          onRetry={() => loadOrder(selectedOrderId)}
          header={{
            title: bundle ? (isFreeOrder(order) ? "Free order" : formatMoney(order.total_cents, order.currency)) : "Order",
            subtitle: bundle ? (
              <span>
                {brand?.name ? `${brand.name} · ` : ""}
                <span className="font-mono">{order.id}</span>
              </span>
            ) : undefined,
            badges: bundle ? badges : [],
            backLabel: "Orders",
            onBack: backToList,
          }}
          sections={bundle ? buildOrderSections(bundle, setSubUserId, money) : []}
        />
        {bundle && REFUNDABLE_STATUSES.includes(order.payment_status) && !isFreeOrder(order) && (
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--gray-200)] pt-4">
            <Button variant="danger" size="md" onClick={() => setRefundOpen(true)}>
              Issue refund
            </Button>
          </div>
        )}
        {refundOpen && (
          <RefundModal
            onClose={() => setRefundOpen(false)}
            order={order}
            lineItems={bundle?.line_items || []}
            onRefunded={() => loadOrder(selectedOrderId)}
            provider={money?.provider}
          />
        )}
        <SubscriberContextCard open={subUserId != null} onClose={() => setSubUserId(null)} userId={subUserId} />
      </div>
    );
  }

  // ── List view ─────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Orders"
        description="Every order, what the buyer paid, what Mingla kept and whether the host has been paid for it."
      />

      <OrdersOverviewCards />

      <EntityListView
        title="All orders"
        columns={COLUMNS}
        fetchPage={listOrders}
        searchPlaceholder="Buyer, event, brand, payment reference or order id"
        filters={FILTERS}
        filterVariant="chips"
        initialFilters={initialStatus ? { status: initialStatus } : undefined}
        onRowClick={(row) => openOrder(row.order_id)}
        csv={CSV}
        emptyMessage="No orders match."
        emptyIcon={Receipt}
        rowKey={(row) => row.order_id}
      />
    </div>
  );
}

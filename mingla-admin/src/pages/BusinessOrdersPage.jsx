// ORCH-1274 [Admin Money console — READ-ONLY] — Orders console.
//
// Cross-brand order search/list → an order detail bundle (offering + brand +
// buyer + amount + status + line items + installments + refunds + partner split
// + pricing/tax breakdown). A "View subscriber" link opens the read-only
// SubscriberContextCard when the order has a buyer_user_id. READ-ONLY: the
// "Issue refund" action is rendered DISABLED with a WAVE-2 tag (SPEC §9).

import { useState, useEffect, useCallback } from "react";
import { Receipt } from "lucide-react";
import { EntityListView } from "../components/entity/EntityListView";
import { EntityDetailView } from "../components/entity/EntityDetailView";
import { SubscriberContextCard } from "../components/entity/SubscriberContextCard";
import { HighRiskActionModal } from "../components/entity/HighRiskActionModal";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { listOrders, getOrder } from "../services/adminMoneyService";
import {
  createAdminRefundIdempotencyKey,
  refundOrder,
} from "../services/adminMoneyActService";
import { timeAgo, formatDateTime } from "../lib/formatters";

// Order payment_status values (DB enum) an admin may refund.
const REFUNDABLE_STATUSES = ["paid", "partial_refund"];

// Map admin-refund-order edge-fn error codes → user-facing copy.
function refundErrorCopy(code) {
  switch (code) {
    case "refund_exceeds_remaining": return "Amount exceeds what's left to refund.";
    case "line_overrefund": return "One or more items are already fully refunded.";
    case "stripe_declined": return "Stripe declined — no money moved.";
    case "order_not_refundable": return "This order can't be refunded.";
    case "missing_connected_account": return "This brand has no Stripe account to refund from.";
    case "missing_payment_intent": return "This order has no Stripe charge to refund.";
    case "reason_invalid_length": return "Reason must be 10–200 characters.";
    case "forbidden": return "Admin access required.";
    case "unauthorized": return "Your session expired — sign in again.";
    case "idempotency_key_required": return "Couldn't start the refund. Please retry.";
    default: return null;
  }
}

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

// ── Maps ──────────────────────────────────────────────────────────────────────

const STATUS_VARIANT = {
  paid: "success",
  confirmed: "success",
  refunded: "default",
  partially_refunded: "warning",
  disputed: "error",
  failed: "warning",
  pending: "warning",
  cancelled: "default",
};

function statusBadge(status) {
  return <Badge variant={STATUS_VARIANT[status] || "default"} dot>{status || "—"}</Badge>;
}

// ── List columns / filters / csv ──────────────────────────────────────────────

const COLUMNS = [
  {
    key: "created_at",
    label: "Created",
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
    label: "Offering",
    render: (val, row) => (
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="truncate">{val || "—"}</span>
        {row.event_type && <Badge variant="outline">{row.event_type}</Badge>}
      </span>
    ),
  },
  {
    key: "brand_name",
    label: "Brand",
    render: (val) => val || <span className="text-[var(--color-text-muted)]">—</span>,
  },
  {
    key: "total_cents",
    label: "Amount",
    render: (val, row) => <span className="font-medium">{formatMoney(val, row.currency)}</span>,
  },
  { key: "payment_status", label: "Status", render: (val) => statusBadge(val) },
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

const FILTERS = [
  {
    key: "status",
    label: "Payment status",
    options: [
      { value: "paid", label: "Paid" },
      { value: "pending", label: "Pending" },
      { value: "failed", label: "Failed" },
      { value: "refunded", label: "Refunded" },
      { value: "partially_refunded", label: "Partially refunded" },
      { value: "disputed", label: "Disputed" },
      { value: "cancelled", label: "Cancelled" },
    ],
  },
];

const CSV = {
  columns: [
    { key: "order_id", label: "Order ID" },
    { key: "created_at", label: "Created at" },
    { key: "buyer_email", label: "Buyer email" },
    { key: "buyer_phone", label: "Buyer phone" },
    { key: "brand_name", label: "Brand" },
    { key: "event_title", label: "Offering" },
    { key: "total_cents", label: "Total cents" },
    { key: "currency", label: "Currency" },
    { key: "payment_status", label: "Status" },
    { key: "stripe_payment_intent_id", label: "PaymentIntent id" },
    { key: "refunded_amount_cents", label: "Refunded cents" },
  ],
  filename: "orders",
};

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

function buildOrderSections(bundle, onViewSubscriber) {
  const order = bundle.order || {};
  const event = bundle.event || null;
  const brand = bundle.brand || null;
  const lineItems = Array.isArray(bundle.line_items) ? bundle.line_items : [];
  const installments = Array.isArray(bundle.installments) ? bundle.installments : [];
  const refunds = Array.isArray(bundle.refunds) ? bundle.refunds : [];
  const split = bundle.partner_split || null;

  const sections = [
    {
      label: "Order",
      fields: [
        field("Order id", order.id, (v) => <span className="font-mono text-xs break-all">{v}</span>),
        field("Status", null, () => statusBadge(order.payment_status)),
        field("Amount", null, () => <span className="font-medium">{formatMoney(order.total_cents, order.currency)}</span>),
        field("Refunded", null, () => (order.refunded_amount_cents ? formatMoney(order.refunded_amount_cents, order.currency) : "—")),
        field("Tax", null, () => (order.tax_amount_cents != null ? formatMoney(order.tax_amount_cents, order.currency) : "—")),
        field("App fee", null, () =>
          order.stripe_application_fee_amount_cents != null ? formatMoney(order.stripe_application_fee_amount_cents, order.currency) : "—",
        ),
        field("Payment method", order.payment_method),
        field("PaymentIntent id", order.stripe_payment_intent_id, (v) => <span className="font-mono text-xs break-all">{v}</span>),
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
                  <span className="text-[var(--color-text-tertiary)]">{formatMoney(item.unit_price_cents, order.currency)} ea</span>
                  <span className="font-medium">{formatMoney(item.total_cents, order.currency)}</span>
                </span>
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
function RefundModal({ onClose, order, lineItems, onRefunded }) {
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
      description="Refunds move real money in Stripe LIVE mode. Pick the items, then type the exact total to confirm."
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

  useEffect(() => {
    const sync = () => setSelectedOrderId(orderIdFromHash());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const loadOrder = useCallback(async (orderId) => {
    setLoading(true);
    setError(null);
    setBundle(null);
    try {
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
      badges.push({ label: order.payment_status || "—", variant: STATUS_VARIANT[order.payment_status] || "default" });
      if (order.currency) badges.push({ label: order.currency, variant: "default" });
    }

    return (
      <div className="py-8">
        <EntityDetailView
          loading={loading}
          error={error}
          onRetry={() => loadOrder(selectedOrderId)}
          header={{
            title: bundle ? formatMoney(order.total_cents, order.currency) : "Order",
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
          sections={bundle ? buildOrderSections(bundle, setSubUserId) : []}
        />
        {bundle && REFUNDABLE_STATUSES.includes(order.payment_status) && (
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
          />
        )}
        <SubscriberContextCard open={subUserId != null} onClose={() => setSubUserId(null)} userId={subUserId} />
      </div>
    );
  }

  // ── List view ─────────────────────────────────────────────────────────────
  return (
    <div className="py-8 flex flex-col gap-6">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-full bg-[var(--color-brand-50)] flex items-center justify-center shrink-0">
          <Receipt className="w-5 h-5 text-[var(--color-brand-500)]" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Orders</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
            Every order across the platform — buyer, offering, brand, amount, and status. Open one for the
            full money record. Read-only.
          </p>
        </div>
      </div>

      <EntityListView
        title="All orders"
        columns={COLUMNS}
        fetchPage={listOrders}
        searchPlaceholder="Buyer email, phone, name, PI id, or order id"
        filters={FILTERS}
        onRowClick={(row) => openOrder(row.order_id)}
        csv={CSV}
        emptyMessage="No orders match."
        emptyIcon={Receipt}
        rowKey={(row) => row.order_id}
      />
    </div>
  );
}

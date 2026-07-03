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
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { listOrders, getOrder } from "../services/adminMoneyService";
import { timeAgo, formatDateTime } from "../lib/formatters";

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

// ── Component ─────────────────────────────────────────────────────────────────

export function BusinessOrdersPage() {
  const [selectedOrderId, setSelectedOrderId] = useState(() => orderIdFromHash());
  const [bundle, setBundle] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [subUserId, setSubUserId] = useState(null);

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
        {bundle && (
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--gray-200)] pt-4">
            <Badge variant="outline">WAVE-2</Badge>
            <Button variant="secondary" size="md" disabled title="Available in a later wave">
              Issue refund
            </Button>
          </div>
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

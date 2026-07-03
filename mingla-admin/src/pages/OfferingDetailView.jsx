// ORCH-1273 [Admin Offerings console — READ-ONLY] — type-aware offering detail.
//
// ONE header bundle (admin_get_offering) drives the header + which section set
// renders, per event_type:
//   event      → ticket tiers (RLS-direct) + orders rollup (admin_list_event_orders)
//   rsvp       → guest list + counts (admin_list_event_rsvps)
//   trip       → itinerary + pricing tiers + inclusions + intake (RLS-direct)
//   experience → stops (RLS-direct); feedback = Wave-2 (card_id mapping, Open Q4)
//
// READ-ONLY: the EntityDetailView `actions` slot is left EMPTY. No refund / cancel
// / approve / override — every such action is Wave-2 (SPEC §6).

import { useState, useEffect, useCallback } from "react";
import { EntityDetailView } from "../components/entity/EntityDetailView";
import { Badge } from "../components/ui/Badge";
import {
  getOffering,
  getTicketTypes,
  listEventOrders,
  listEventRsvps,
  getTripDetail,
  getExperienceDetail,
} from "../services/offeringsService";
import { formatDate, formatDateTime } from "../lib/formatters";

// ── Local money formatter (server sends integer cents + currency, never pre-
//    formatted — the client formats; ORCH-1271 §3 / Constitution #10). ──────────
function money(cents, currency) {
  if (cents == null) return "—";
  const amount = Number(cents) / 100;
  const cur = (currency || "").trim().toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: cur || "USD" }).format(amount);
  } catch {
    return `${amount.toFixed(2)}${cur ? " " + cur : ""}`;
  }
}

const STATUS_VARIANT = { draft: "default", scheduled: "info", live: "success", ended: "default", cancelled: "error" };
const VISIBILITY_VARIANT = { public: "success", discover: "info", private: "warning", hidden: "default", draft: "default" };
const LIFECYCLE_VARIANT = { draft: "default", upcoming: "info", live: "success", past: "default", cancelled: "error" };
const PAYMENT_VARIANT = { paid: "success", pending: "warning", failed: "error", refunded: "info", cancelled: "default" };
const RSVP_VARIANT = { going: "success", not_going: "default", waitlisted: "warning", maybe: "info" };
const APPROVAL_VARIANT = { approved: "success", pending: "warning", denied: "error" };

function field(label, value, render) {
  return { label, value, render };
}
const muted = (v) => <span className="text-[var(--color-text-muted)]">{v}</span>;
const noneField = (label) => field(label, "None", (v) => muted(v));

function boolBadge(v) {
  return <Badge variant={v ? "success" : "default"} dot>{v ? "Yes" : "No"}</Badge>;
}

// ── Section builders ──────────────────────────────────────────────────────────

function coreSection(b) {
  return {
    label: "Offering",
    fields: [
      field("Type", b.event_type),
      field("Brand", b.brand_name || b.brand_id),
      field("Brand slug", b.brand_slug ? `/${b.brand_slug}` : null),
      field("City", b.city),
      field("Location", b.location_text),
      field("Destination", b.destination_text),
      field("Currency", (b.currency || "").trim() || null),
      field("Pricing mode", b.pricing_mode),
      field("Whole price", b.whole_price_cents != null ? null : undefined, () => money(b.whole_price_cents, b.currency)),
      field("Starts", b.master_start_at, (v) => formatDateTime(v)),
      field("Ends", b.master_end_at, (v) => formatDateTime(v)),
      field("Booking deadline", b.booking_deadline, (v) => formatDateTime(v)),
      field("Bookings closed", null, () => boolBadge(b.bookings_closed)),
      field("Pass tax", null, () => boolBadge(b.pass_tax)),
      field("Pass Mingla fee", null, () => boolBadge(b.pass_mingla_fee)),
      field("Pass service fee", null, () => boolBadge(b.pass_service_fee)),
      field("Published", b.published_at, (v) => formatDateTime(v)),
      field("Deleted", b.deleted_at, (v) => (v ? <Badge variant="error">Deleted {formatDate(v)}</Badge> : muted("—"))),
      field("Created", b.created_at, (v) => formatDate(v)),
    ].filter((f) => f.value !== undefined),
  };
}

function ticketTiersSection(tiers) {
  return {
    label: `Ticket tiers (${tiers.length})`,
    fields:
      tiers.length === 0
        ? [noneField("Ticket tiers")]
        : tiers.map((t) =>
            field(t.name || t.id, t, (tt) => (
              <span className={`flex flex-wrap items-center gap-1.5 ${tt.deleted_at ? "opacity-50" : ""}`}>
                <span className="font-medium">
                  {tt.is_free ? "Free" : money(tt.price_cents, tt.currency)}
                </span>
                <span className="text-xs text-[var(--color-text-tertiary)]">
                  {tt.is_unlimited ? "Unlimited" : `${tt.quantity_total ?? 0} total`}
                </span>
                {tt.is_hidden && <Badge variant="default">hidden</Badge>}
                {tt.is_disabled && <Badge variant="error">disabled</Badge>}
                {tt.requires_approval && <Badge variant="warning">approval</Badge>}
                {tt.waitlist_enabled && <Badge variant="info">waitlist</Badge>}
                {tt.deleted_at && <Badge variant="error">deleted</Badge>}
              </span>
            )),
          ),
  };
}

function ordersSection(orders) {
  const s = orders.summary || {};
  const summaryFields = [
    field("Gross (paid)", null, () => money(s.gross_cents, orders.currency)),
    field("Refunded", null, () => money(s.refunded_cents, orders.currency)),
    field("Paid orders", s.paid_count ?? 0),
    field("Refunded orders", s.refunded_count ?? 0),
    field("Tickets sold", s.ticket_count ?? 0),
  ];
  const rowFields =
    orders.rows.length === 0
      ? [noneField("Orders")]
      : orders.rows.map((o) =>
          field(o.buyer_name || o.buyer_email || o.order_id, o, (ord) => (
            <span className="flex flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-1.5">
                <Badge variant={PAYMENT_VARIANT[ord.payment_status] || "default"} dot>{ord.payment_status}</Badge>
                <span className="font-medium">{money(ord.total_cents, ord.currency)}</span>
                {ord.refunded_amount_cents > 0 && (
                  <span className="text-xs text-[var(--color-info-700)]">−{money(ord.refunded_amount_cents, ord.currency)}</span>
                )}
                {ord.is_door_sale && <Badge variant="outline">door</Badge>}
                {ord.source && <span className="text-xs text-[var(--color-text-tertiary)]">{ord.source}</span>}
              </span>
              {ord.buyer_email && <span className="text-xs text-[var(--color-text-tertiary)]">{ord.buyer_email}</span>}
              {Array.isArray(ord.line_items) && ord.line_items.length > 0 && (
                <span className="text-xs text-[var(--color-text-tertiary)]">
                  {ord.line_items.map((li) => `${li.quantity}× ${li.ticket_type_name || "tier"}`).join(", ")}
                </span>
              )}
            </span>
          )),
        );
  return [
    { label: "Sales summary", fields: summaryFields },
    { label: `Orders (${orders.total})`, fields: rowFields },
  ];
}

function rsvpSection(rsvps) {
  const c = rsvps.counts || {};
  const countFields = [
    field("Going", c.going ?? 0),
    field("Waitlisted", c.waitlisted ?? 0),
    field("Maybe", c.maybe ?? 0),
    field("Not going", c.not_going ?? 0),
    field("Pending approval", c.pending ?? 0),
    field("Approved", c.approved ?? 0),
    field("Denied", c.denied ?? 0),
    field("Confirmed attending", c.confirmed_attending ?? 0),
    field("Total headcount", c.total_headcount ?? 0),
    field("Capacity", c.capacity == null ? "Uncapped" : c.capacity),
    field("Capacity remaining", c.capacity_remaining == null ? "—" : c.capacity_remaining),
  ];
  const rowFields =
    rsvps.rows.length === 0
      ? [noneField("Guest list")]
      : rsvps.rows.map((r) =>
          field(r.guest_name || r.guest_email || r.rsvp_id, r, (g) => (
            <span className="flex flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-1.5">
                <Badge variant={RSVP_VARIANT[g.rsvp_status] || "default"} dot>{g.rsvp_status}</Badge>
                <Badge variant={APPROVAL_VARIANT[g.approval_status] || "default"}>{g.approval_status}</Badge>
                {g.plus_count > 0 && <span className="text-xs text-[var(--color-text-tertiary)]">+{g.plus_count}</span>}
                {!g.user_id && <Badge variant="outline">guest</Badge>}
              </span>
              {g.guest_email && <span className="text-xs text-[var(--color-text-tertiary)]">{g.guest_email}</span>}
              {Array.isArray(g.plus_guests) && g.plus_guests.length > 0 && (
                <span className="text-xs text-[var(--color-text-tertiary)]">
                  {g.plus_guests.map((pg) => pg.name || pg.email).filter(Boolean).join(", ")}
                </span>
              )}
            </span>
          )),
        );
  return [
    { label: "RSVP counts", fields: countFields },
    { label: `Guest list (${rsvps.total})`, fields: rowFields },
  ];
}

function tripSections(trip) {
  const priceByTicketType = {};
  for (const tt of trip.ticketTypes || []) priceByTicketType[tt.id] = tt;
  const included = (trip.inclusions || []).filter((i) => i.kind === "included");
  const excluded = (trip.inclusions || []).filter((i) => i.kind === "excluded");

  return [
    {
      label: `Itinerary (${trip.days.length} ${trip.days.length === 1 ? "day" : "days"})`,
      fields:
        trip.days.length === 0
          ? [noneField("Itinerary")]
          : trip.days.map((d) =>
              field(`Day ${d.ordinal ?? "?"}${d.title ? ` — ${d.title}` : ""}`, d, (day) => (
                <span className="flex flex-col gap-0.5">
                  {day.date && <span className="text-xs text-[var(--color-text-tertiary)]">{formatDate(day.date)}</span>}
                  {day.narrative && <span className="text-sm">{day.narrative}</span>}
                  <span className="text-xs text-[var(--color-text-tertiary)]">
                    {(Array.isArray(day.stops) ? day.stops.length : 0)} stops · {(Array.isArray(day.media) ? day.media.length : 0)} media
                  </span>
                </span>
              )),
            ),
    },
    {
      label: `Pricing tiers (${(trip.pricingTiers || []).length})`,
      fields:
        (trip.pricingTiers || []).length === 0
          ? [noneField("Pricing tiers")]
          : trip.pricingTiers.map((t) => {
              const tt = priceByTicketType[t.ticket_type_id];
              return field(t.tier_name || t.id, t, () => (
                <span className="flex flex-wrap items-center gap-1.5">
                  {tt ? <span className="font-medium">{money(tt.price_cents, tt.currency)}</span> : muted("no linked tier")}
                </span>
              ));
            }),
    },
    {
      label: `Inclusions (${included.length} in / ${excluded.length} out)`,
      fields: [
        field("Included", null, () =>
          included.length ? <span className="text-sm">{included.map((i) => i.item).join(", ")}</span> : muted("None")),
        field("Excluded", null, () =>
          excluded.length ? <span className="text-sm">{excluded.map((i) => i.item).join(", ")}</span> : muted("None")),
      ],
    },
    {
      label: `Intake forms (${(trip.intakeSchemas || []).length})`,
      fields:
        (trip.intakeSchemas || []).length === 0
          ? [noneField("Intake forms")]
          : trip.intakeSchemas.map((s) => {
              const tt = priceByTicketType[s.ticket_type_id];
              const fieldCount = Array.isArray(s.schema?.fields) ? s.schema.fields.length : (Array.isArray(s.schema) ? s.schema.length : 0);
              return field(tt?.name || s.ticket_type_id || s.id, s, () => (
                <span className="text-xs text-[var(--color-text-tertiary)]">{fieldCount} field{fieldCount === 1 ? "" : "s"}</span>
              ));
            }),
    },
    {
      label: "Installments",
      fields: [field("", "Installment status — Wave-2 (SPEC §4.5 / Open Q3).", (v) => muted(v))],
    },
  ];
}

function experienceSections(exp) {
  return [
    {
      label: `Stops (${exp.stops.length})`,
      fields:
        exp.stops.length === 0
          ? [noneField("Stops")]
          : exp.stops.map((s) =>
              field(`${s.stop_order != null ? s.stop_order + ". " : ""}${s.place_name || s.id}`, s, (stop) => (
                <span className="flex flex-col gap-0.5">
                  {stop.address && <span className="text-xs text-[var(--color-text-tertiary)]">{[stop.address, stop.city].filter(Boolean).join(", ")}</span>}
                  <span className="flex flex-wrap items-center gap-1.5">
                    {stop.start_time && <span className="text-xs text-[var(--color-text-tertiary)]">{stop.start_time}</span>}
                    {stop.price_cents != null && <span className="text-xs">{money(stop.price_cents, null)}</span>}
                    <span className="text-xs text-[var(--color-text-tertiary)]">
                      {(Array.isArray(stop.image_urls) ? stop.image_urls.length : 0)} images
                    </span>
                  </span>
                  {stop.ai_description && <span className="text-sm">{stop.ai_description}</span>}
                </span>
              )),
            ),
    },
    {
      label: "Feedback",
      fields: [field("", "Experience feedback — Wave-2 (needs card_id ↔ events mapping, Open Q4).", (v) => muted(v))],
    },
  ];
}

// ── Component ─────────────────────────────────────────────────────────────────

export function OfferingDetailView({ eventId, onBack }) {
  const [bundle, setBundle] = useState(null);
  const [children, setChildren] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setBundle(null);
    setChildren(null);
    try {
      const b = await getOffering(eventId);
      if (!b) {
        setError("No offering found for this ID.");
        return;
      }
      setBundle(b);

      // Load the type-specific children.
      let kids = {};
      if (b.event_type === "event") {
        const [tiers, orders] = await Promise.all([getTicketTypes(eventId), listEventOrders(eventId)]);
        kids = { tiers, orders };
      } else if (b.event_type === "rsvp") {
        kids = { rsvps: await listEventRsvps(eventId) };
      } else if (b.event_type === "trip") {
        const [trip, tiers] = await Promise.all([getTripDetail(eventId), getTicketTypes(eventId)]);
        kids = { trip, tiers };
      } else if (b.event_type === "experience") {
        kids = { exp: await getExperienceDetail(eventId) };
      }
      setChildren(kids);
    } catch (err) {
      const msg = err?.message || "";
      if (msg.includes("not_authorized")) setError("You are not authorized to view this offering.");
      else setError(msg || "Failed to load this offering.");
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  const sections = [];
  if (bundle) {
    sections.push(coreSection(bundle));
    const k = children || {};
    if (bundle.event_type === "event") {
      sections.push(ticketTiersSection(k.tiers || []));
      if (k.orders) sections.push(...ordersSection(k.orders));
    } else if (bundle.event_type === "rsvp") {
      if (k.rsvps) sections.push(...rsvpSection(k.rsvps));
    } else if (bundle.event_type === "trip") {
      // Trip pricing tiers cross-ref the event's ticket_types (loaded into trip).
      const trip = k.trip ? { ...k.trip, ticketTypes: k.trip.ticketTypes?.length ? k.trip.ticketTypes : k.tiers || [] } : null;
      if (trip) sections.push(...tripSections(trip));
      sections.push(ticketTiersSection(k.tiers || []));
    } else if (bundle.event_type === "experience") {
      if (k.exp) sections.push(...experienceSections(k.exp));
    }
  }

  const badges = [];
  if (bundle) {
    if (bundle.status) badges.push({ label: bundle.status, variant: STATUS_VARIANT[bundle.status] || "default" });
    if (bundle.visibility) badges.push({ label: bundle.visibility, variant: VISIBILITY_VARIANT[bundle.visibility] || "default" });
    if (bundle.lifecycle_bucket) badges.push({ label: bundle.lifecycle_bucket, variant: LIFECYCLE_VARIANT[bundle.lifecycle_bucket] || "default" });
  }

  return (
    <EntityDetailView
      loading={loading}
      error={error}
      onRetry={load}
      header={{
        title: bundle?.title || "Offering",
        subtitle: bundle ? <span className="font-mono">{eventId}</span> : undefined,
        badges,
        backLabel: "Offerings",
        onBack,
      }}
      sections={sections}
    />
  );
}

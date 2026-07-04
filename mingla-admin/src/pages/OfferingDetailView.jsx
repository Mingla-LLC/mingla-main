// ORCH-1273 [Admin Offerings console — READ-ONLY] — type-aware offering detail.
// ORCH-1277 [Admin Offerings console — WAVE-2 EDIT] — audited edit/moderation wired
// onto the detail: offering-level unpublish / cancel / close-reopen bookings /
// soft-delete-restore (footer + top row) + per-row price fix, trip-day edit/reorder,
// experience-stop edit/remove/reorder, RSVP approve/deny/remove, and RSVP capacity.
// EVERY write routes through offeringsService → callAdminWriteRpc (audited SECURITY
// DEFINER RPC); the page NEVER touches an offering table directly. Every success
// REFETCHES via load(). HIGH valueless actions use HighRiskActionModal; value-bearing
// actions use the shared EntityEditModal (ORCH-1276); audit-only reorders/approve skip
// the reason gate.
//
// ONE header bundle (admin_get_offering) drives the header + which section set
// renders, per event_type:
//   event      → ticket tiers (RLS-direct) + orders rollup (admin_list_event_orders)
//   rsvp       → guest list + counts (admin_list_event_rsvps)
//   trip       → itinerary + pricing tiers + inclusions + intake (RLS-direct)
//   experience → stops (RLS-direct); feedback = Wave-2 (card_id mapping, Open Q4)

import { useState, useEffect, useCallback } from "react";
import { EntityDetailView } from "../components/entity/EntityDetailView";
import { EntityEditModal } from "../components/entity/EntityEditModal";
import { HighRiskActionModal } from "../components/entity/HighRiskActionModal";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { useToast } from "../context/ToastContext";
import {
  getOffering,
  getTicketTypes,
  listEventOrders,
  listEventRsvps,
  getTripDetail,
  getExperienceDetail,
  setOfferingVisibility,
  cancelOffering,
  setBookingsClosed,
  setOfferingDeleted,
  setTicketPrice,
  updateTripDay,
  reorderTripDay,
  updateExperienceStop,
  deleteExperienceStop,
  reorderExperienceStop,
  setRsvpApproval,
  removeRsvpGuest,
  setRsvpCapacity,
  mapOfferingWriteError,
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

const VISIBILITY_OPTIONS = [
  { value: "public", label: "Public" },
  { value: "discover", label: "Discover" },
  { value: "private", label: "Private" },
  { value: "hidden", label: "Hidden" },
  { value: "draft", label: "Draft" },
];

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

// Inline per-row action affordance (mirrors the ORCH-1276 BrandsConsolePage pattern).
function RowAction({ onClick, danger, disabled, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`text-xs underline cursor-pointer hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed ${
        danger ? "text-[var(--color-error-700)]" : "text-[var(--color-brand-500)]"
      }`}
    >
      {children}
    </button>
  );
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

function ticketTiersSection(tiers, cb) {
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
                {cb?.dispatch && !tt.is_free && (
                  <RowAction
                    onClick={() =>
                      cb.dispatch({
                        kind: "ticketPrice",
                        targetId: tt.id,
                        label: tt.name || tt.id,
                        current: money(tt.price_cents, tt.currency),
                        initial: { price_cents: String(tt.price_cents ?? "") },
                      })
                    }
                  >
                    Fix price
                  </RowAction>
                )}
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

function rsvpSection(rsvps, cb) {
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
  if (cb?.dispatch) {
    countFields.push(
      field("Adjust", null, () => (
        <RowAction
          onClick={() =>
            cb.dispatch({
              kind: "rsvpCapacity",
              initial: {
                rsvp_capacity: c.capacity == null ? "" : String(c.capacity),
                rsvp_waitlist_enabled: Boolean(cb.waitlistEnabled),
              },
            })
          }
        >
          Adjust capacity / waitlist
        </RowAction>
      )),
    );
  }
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
                {cb?.dispatch && (
                  <>
                    {g.approval_status !== "approved" && (
                      <RowAction disabled={cb.approvingId === g.rsvp_id} onClick={() => cb.onApprove(g.rsvp_id)}>
                        Approve
                      </RowAction>
                    )}
                    {g.approval_status !== "denied" && (
                      <RowAction
                        danger
                        onClick={() =>
                          cb.dispatch({ kind: "rsvpDeny", targetId: g.rsvp_id, label: g.guest_name || g.guest_email || g.rsvp_id })
                        }
                      >
                        Deny
                      </RowAction>
                    )}
                    <RowAction
                      danger
                      onClick={() =>
                        cb.dispatch({ kind: "rsvpRemove", targetId: g.rsvp_id, label: g.guest_name || g.guest_email || g.rsvp_id })
                      }
                    >
                      Remove
                    </RowAction>
                  </>
                )}
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

function tripSections(trip, cb) {
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
                  {cb?.dispatch && (
                    <span className="flex flex-wrap items-center gap-2 pt-0.5">
                      <RowAction
                        onClick={() =>
                          cb.dispatch({
                            kind: "tripDayEdit",
                            targetId: day.id,
                            label: `Day ${day.ordinal ?? "?"}`,
                            initial: {
                              title: day.title ?? "",
                              narrative: day.narrative ?? "",
                              date: day.date ?? "",
                            },
                          })
                        }
                      >
                        Edit
                      </RowAction>
                      <RowAction
                        onClick={() =>
                          cb.dispatch({
                            kind: "tripDayReorder",
                            targetId: day.id,
                            label: `Day ${day.ordinal ?? "?"}`,
                            initial: { ordinal: String(day.ordinal ?? "") },
                          })
                        }
                      >
                        Reorder
                      </RowAction>
                    </span>
                  )}
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
                  {cb?.dispatch && tt && (
                    <RowAction
                      onClick={() =>
                        cb.dispatch({
                          kind: "ticketPrice",
                          targetId: tt.id,
                          label: t.tier_name || tt.name || tt.id,
                          current: money(tt.price_cents, tt.currency),
                          initial: { price_cents: String(tt.price_cents ?? "") },
                        })
                      }
                    >
                      Fix price
                    </RowAction>
                  )}
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

function experienceSections(exp, cb) {
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
                  {cb?.dispatch && (
                    <span className="flex flex-wrap items-center gap-2 pt-0.5">
                      <RowAction
                        onClick={() =>
                          cb.dispatch({
                            kind: "expStopEdit",
                            targetId: stop.id,
                            label: stop.place_name || stop.id,
                            initial: {
                              ai_description: stop.ai_description ?? "",
                              place_name: stop.place_name ?? "",
                              address: stop.address ?? "",
                              start_time: stop.start_time ?? "",
                            },
                          })
                        }
                      >
                        Edit
                      </RowAction>
                      <RowAction
                        onClick={() =>
                          cb.dispatch({
                            kind: "expStopReorder",
                            targetId: stop.id,
                            label: stop.place_name || stop.id,
                            initial: { stop_order: String(stop.stop_order ?? "") },
                          })
                        }
                      >
                        Reorder
                      </RowAction>
                      <RowAction
                        danger
                        onClick={() =>
                          cb.dispatch({ kind: "expStopRemove", targetId: stop.id, label: stop.place_name || stop.id })
                        }
                      >
                        Remove
                      </RowAction>
                    </span>
                  )}
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
  const { addToast } = useToast();
  const [bundle, setBundle] = useState(null);
  const [children, setChildren] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ORCH-1277 mutation state: one shared modal instance keyed by { kind, targetId, ... }.
  const [activeAction, setActiveAction] = useState(null);
  const [approvingId, setApprovingId] = useState(null);
  const dispatch = useCallback((a) => setActiveAction(a), []);
  const closeAction = useCallback(() => setActiveAction(null), []);

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

  // One-tap RSVP approve (AUDIT-ONLY: no reason gate). Disabled while in flight.
  const onApprove = useCallback(
    async (rsvpId) => {
      setApprovingId(rsvpId);
      try {
        const { error: e } = await setRsvpApproval(rsvpId, "approved", null);
        if (e) throw new Error(mapOfferingWriteError(e));
        addToast({ variant: "success", title: "Guest approved." });
        await load();
      } catch (err) {
        addToast({ variant: "error", title: "Couldn't approve", description: err?.message });
      } finally {
        setApprovingId(null);
      }
    },
    [addToast, load],
  );

  const sections = [];
  if (bundle) {
    const k = children || {};
    const cb = { dispatch, onApprove, approvingId, waitlistEnabled: bundle.rsvp_waitlist_enabled };
    sections.push(coreSection(bundle));
    if (bundle.event_type === "event") {
      sections.push(ticketTiersSection(k.tiers || [], cb));
      if (k.orders) sections.push(...ordersSection(k.orders));
    } else if (bundle.event_type === "rsvp") {
      if (k.rsvps) sections.push(...rsvpSection(k.rsvps, cb));
    } else if (bundle.event_type === "trip") {
      // Trip pricing tiers cross-ref the event's ticket_types (loaded into trip).
      const trip = k.trip ? { ...k.trip, ticketTypes: k.trip.ticketTypes?.length ? k.trip.ticketTypes : k.tiers || [] } : null;
      if (trip) sections.push(...tripSections(trip, cb));
      sections.push(ticketTiersSection(k.tiers || [], cb));
    } else if (bundle.event_type === "experience") {
      if (k.exp) sections.push(...experienceSections(k.exp, cb));
    }
  }

  const badges = [];
  if (bundle) {
    if (bundle.status) badges.push({ label: bundle.status, variant: STATUS_VARIANT[bundle.status] || "default" });
    if (bundle.visibility) badges.push({ label: bundle.visibility, variant: VISIBILITY_VARIANT[bundle.visibility] || "default" });
    if (bundle.lifecycle_bucket) badges.push({ label: bundle.lifecycle_bucket, variant: LIFECYCLE_VARIANT[bundle.lifecycle_bucket] || "default" });
  }

  // Offering-level footer HIGH actions (valueless) → EntityDetailView renders HighRiskActionModal.
  const footerActions = [];
  if (bundle) {
    const afterWrite = async (fn) => {
      const { error: e } = await fn();
      if (e) throw new Error(mapOfferingWriteError(e));
      await load();
    };
    if (bundle.status !== "cancelled") {
      footerActions.push({
        label: "Cancel offering",
        title: "Cancel offering",
        description: "Set this offering to cancelled. Refunds are handled in the Money console — cancelling issues none. Recorded in the audit log.",
        confirmLabel: "Cancel offering",
        destructive: true,
        requireReason: true,
        confirmPhrase: "CANCEL",
        onConfirm: ({ reason }) => afterWrite(() => cancelOffering(eventId, reason)),
      });
    }
    footerActions.push({
      label: bundle.bookings_closed ? "Reopen bookings" : "Close bookings",
      title: bundle.bookings_closed ? "Reopen bookings" : "Close bookings",
      description: bundle.bookings_closed
        ? "Reopen bookings for this offering. Recorded in the audit log."
        : "Close bookings for this offering (stops new purchases). Recorded in the audit log.",
      confirmLabel: bundle.bookings_closed ? "Reopen" : "Close",
      requireReason: true,
      onConfirm: ({ reason }) => afterWrite(() => setBookingsClosed(eventId, !bundle.bookings_closed, reason)),
    });
    if (bundle.deleted_at) {
      footerActions.push({
        label: "Restore offering",
        title: "Restore offering",
        description: "Clear the soft-delete on this offering. Recorded in the audit log.",
        confirmLabel: "Restore",
        requireReason: true,
        onConfirm: ({ reason }) => afterWrite(() => setOfferingDeleted(eventId, false, reason)),
      });
    } else {
      footerActions.push({
        label: "Soft-delete offering",
        title: "Soft-delete offering",
        description: "Soft-delete this offering (reversible). It disappears from organiser/buyer reads but stays admin-visible. Recorded in the audit log.",
        confirmLabel: "Soft-delete",
        destructive: true,
        requireReason: true,
        confirmPhrase: "DELETE",
        onConfirm: ({ reason }) => afterWrite(() => setOfferingDeleted(eventId, true, reason)),
      });
    }
  }

  const a = activeAction; // shorthand for the modal switch

  return (
    <div className="flex flex-col gap-4">
      {bundle && !loading && !error && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="secondary"
            size="md"
            onClick={() => dispatch({ kind: "visibility", initial: { visibility: bundle.visibility || "" } })}
          >
            Change visibility
          </Button>
        </div>
      )}

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
        actions={footerActions}
        sections={sections}
      />

      {/* ── ORCH-1277 value-bearing + per-row modals (mounted fresh per open) ── */}

      {a?.kind === "visibility" && (
        <EntityEditModal
          open
          onClose={closeAction}
          title="Change visibility"
          description="Unpublish (hidden) or republish an offering. Recorded in the audit log."
          fields={[{ key: "visibility", label: "Visibility", type: "select", options: VISIBILITY_OPTIONS, required: true }]}
          initialValues={a.initial}
          submitLabel="Save visibility"
          requireReason
          successMessage="Visibility updated."
          onSave={async (values, { reason }) => {
            const { error: e } = await setOfferingVisibility(eventId, values.visibility, reason);
            if (e) throw new Error(mapOfferingWriteError(e));
            closeAction();
            await load();
          }}
        />
      )}

      {a?.kind === "ticketPrice" && (
        <EntityEditModal
          open
          onClose={closeAction}
          title="Fix ticket price"
          description={`Correct the price for “${a.label}”. Current: ${a.current}. Enter the new price in cents (currency is unchanged).`}
          fields={[{ key: "price_cents", label: "New price (cents)", type: "text", required: true, help: "Whole number of cents, e.g. 1500 = $15.00." }]}
          initialValues={a.initial}
          submitLabel="Save price"
          requireReason
          successMessage="Price updated."
          onSave={async (values, { reason }) => {
            const cents = Number.parseInt(values.price_cents, 10);
            if (!Number.isInteger(cents) || cents < 0) throw new Error("Enter a whole number of cents (0 or more).");
            const { error: e } = await setTicketPrice(a.targetId, cents, reason);
            if (e) throw new Error(mapOfferingWriteError(e));
            closeAction();
            await load();
          }}
        />
      )}

      {a?.kind === "tripDayEdit" && (
        <EntityEditModal
          open
          onClose={closeAction}
          title={`Edit ${a.label}`}
          description="Correct this itinerary day's title, narrative, or date. Recorded in the audit log."
          fields={[
            { key: "title", label: "Title", type: "text", required: true },
            { key: "narrative", label: "Narrative", type: "textarea" },
            { key: "date", label: "Date (YYYY-MM-DD, blank to clear)", type: "text" },
          ]}
          initialValues={a.initial}
          submitLabel="Save day"
          requireReason
          successMessage="Itinerary day updated."
          onSave={async (values, { reason }) => {
            const { error: e } = await updateTripDay(
              a.targetId,
              { title: values.title, narrative: values.narrative, date: values.date },
              reason,
            );
            if (e) throw new Error(mapOfferingWriteError(e));
            closeAction();
            await load();
          }}
        />
      )}

      {a?.kind === "tripDayReorder" && (
        <EntityEditModal
          open
          onClose={closeAction}
          title={`Reorder ${a.label}`}
          description="Move this day to a new position. A reason is optional (still audited)."
          fields={[{ key: "ordinal", label: "New position", type: "text", required: true }]}
          initialValues={a.initial}
          submitLabel="Reorder"
          successMessage="Day reordered."
          onSave={async (values, { reason }) => {
            const ord = Number.parseInt(values.ordinal, 10);
            if (!Number.isInteger(ord)) throw new Error("Enter a whole-number position.");
            const { error: e } = await reorderTripDay(a.targetId, ord, reason || null);
            if (e) throw new Error(mapOfferingWriteError(e));
            closeAction();
            await load();
          }}
        />
      )}

      {a?.kind === "expStopEdit" && (
        <EntityEditModal
          open
          onClose={closeAction}
          title={`Edit stop — ${a.label}`}
          description="Correct or moderate this stop's AI description, place name, address, or start time. Recorded in the audit log."
          fields={[
            { key: "ai_description", label: "AI description", type: "textarea", required: true },
            { key: "place_name", label: "Place name", type: "text", required: true },
            { key: "address", label: "Address", type: "text", required: true },
            { key: "start_time", label: "Start time (HH:MM, blank to clear)", type: "text" },
          ]}
          initialValues={a.initial}
          submitLabel="Save stop"
          requireReason
          successMessage="Stop updated."
          onSave={async (values, { reason }) => {
            const { error: e } = await updateExperienceStop(
              a.targetId,
              {
                ai_description: values.ai_description,
                place_name: values.place_name,
                address: values.address,
                start_time: values.start_time,
              },
              reason,
            );
            if (e) throw new Error(mapOfferingWriteError(e));
            closeAction();
            await load();
          }}
        />
      )}

      {a?.kind === "expStopReorder" && (
        <EntityEditModal
          open
          onClose={closeAction}
          title={`Reorder stop — ${a.label}`}
          description="Move this stop to a new position. A reason is optional (still audited)."
          fields={[{ key: "stop_order", label: "New position", type: "text", required: true }]}
          initialValues={a.initial}
          submitLabel="Reorder"
          successMessage="Stop reordered."
          onSave={async (values, { reason }) => {
            const ord = Number.parseInt(values.stop_order, 10);
            if (!Number.isInteger(ord)) throw new Error("Enter a whole-number position.");
            const { error: e } = await reorderExperienceStop(a.targetId, ord, reason || null);
            if (e) throw new Error(mapOfferingWriteError(e));
            closeAction();
            await load();
          }}
        />
      )}

      {a?.kind === "rsvpCapacity" && (
        <EntityEditModal
          open
          onClose={closeAction}
          title="Adjust RSVP capacity"
          description="Set the capacity (blank = uncapped) and waitlist toggle. Raising capacity may auto-promote waitlisted guests. Recorded in the audit log."
          fields={[
            { key: "rsvp_capacity", label: "Capacity (blank = uncapped)", type: "text" },
            { key: "rsvp_waitlist_enabled", label: "Waitlist enabled", type: "switch" },
          ]}
          initialValues={a.initial}
          submitLabel="Save capacity"
          requireReason
          successMessage="Capacity updated."
          onSave={async (values, { reason }) => {
            const raw = (values.rsvp_capacity ?? "").toString().trim();
            let capacity = null;
            if (raw !== "") {
              capacity = Number.parseInt(raw, 10);
              if (!Number.isInteger(capacity) || capacity < 0) throw new Error("Capacity must be a whole number (0 or more), or blank for uncapped.");
            }
            const { error: e } = await setRsvpCapacity(eventId, capacity, Boolean(values.rsvp_waitlist_enabled), reason);
            if (e) throw new Error(mapOfferingWriteError(e));
            closeAction();
            await load();
          }}
        />
      )}

      {/* HIGH valueless per-row actions → HighRiskActionModal (mounted per open). */}
      {a?.kind === "expStopRemove" && (
        <HighRiskActionModal
          open
          onClose={closeAction}
          title="Remove experience stop"
          description={`Permanently remove the stop “${a.label}”. This cannot be undone (no soft-delete). Recorded in the audit log.`}
          confirmLabel="Remove stop"
          destructive
          confirmPhrase="REMOVE"
          successMessage="Stop removed."
          onConfirm={async ({ reason }) => {
            const { error: e } = await deleteExperienceStop(a.targetId, reason);
            if (e) throw new Error(mapOfferingWriteError(e));
            closeAction();
            await load();
          }}
        />
      )}

      {a?.kind === "rsvpDeny" && (
        <HighRiskActionModal
          open
          onClose={closeAction}
          title="Deny RSVP guest"
          description={`Deny ${a.label}. If they were going on a full RSVP, the next waitlisted guest is auto-promoted. Recorded in the audit log.`}
          confirmLabel="Deny guest"
          destructive
          requireReason
          successMessage="Guest denied."
          onConfirm={async ({ reason }) => {
            const { error: e } = await setRsvpApproval(a.targetId, "denied", reason);
            if (e) throw new Error(mapOfferingWriteError(e));
            closeAction();
            await load();
          }}
        />
      )}

      {a?.kind === "rsvpRemove" && (
        <HighRiskActionModal
          open
          onClose={closeAction}
          title="Remove RSVP guest"
          description={`Permanently remove ${a.label} and their plus-guests from this RSVP. This cannot be undone. Recorded in the audit log.`}
          confirmLabel="Remove guest"
          destructive
          confirmPhrase="REMOVE"
          successMessage="Guest removed."
          onConfirm={async ({ reason }) => {
            const { error: e } = await removeRsvpGuest(a.targetId, reason);
            if (e) throw new Error(mapOfferingWriteError(e));
            closeAction();
            await load();
          }}
        />
      )}
    </div>
  );
}

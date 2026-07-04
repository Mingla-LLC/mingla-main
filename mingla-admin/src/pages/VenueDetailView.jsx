// ORCH-1273 [Admin Offerings console — READ-ONLY] — venue detail.
// ORCH-1277 [Admin Offerings console — WAVE-2 EDIT] — audited venue reservation-stack
// edits wired onto the detail: edit reservation settings (incl. the enabled toggle) +
// edit a capacity rule + override a reservation status. EVERY write routes through
// venuesService → callAdminWriteRpc (audited SECURITY DEFINER RPC); the page NEVER
// touches a venue table directly. Every success REFETCHES via load(). NO venue-listing
// field edit (name/address/hours/category/contact) — that is a follow-on ORCH (Q6).
//
// Venue core (RLS-direct) + reservation-config stack (settings / tables / capacity
// rules / blackouts / waitlist, RLS-direct) + reservations rollup (guest PII →
// admin_list_venue_reservations definer RPC). Every panel renders empty gracefully.

import { useState, useEffect, useCallback } from "react";
import { EntityDetailView } from "../components/entity/EntityDetailView";
import { EntityEditModal } from "../components/entity/EntityEditModal";
import { Badge } from "../components/ui/Badge";
import {
  getVenue,
  getVenueReservationSettings,
  getVenueTables,
  getVenueCapacityRules,
  getVenueBlackouts,
  getVenueWaitlist,
  listVenueReservations,
  updateVenueReservationSettings,
  updateVenueCapacityRule,
  setReservationStatus,
  mapVenueWriteError,
} from "../services/venuesService";
import { formatDate, formatDateTime } from "../lib/formatters";

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

const NO_SHOW_POLICY_OPTIONS = [
  { value: "forfeit", label: "Forfeit" },
  { value: "none", label: "None" },
];
const ZONE_OPTIONS = [
  { value: "indoor", label: "Indoor" },
  { value: "outdoor", label: "Outdoor" },
  { value: "private_room", label: "Private room" },
  { value: "bar", label: "Bar" },
  { value: "patio", label: "Patio" },
];
const RESERVATION_STATUS_OPTIONS = [
  { value: "requested", label: "Requested" },
  { value: "confirmed", label: "Confirmed" },
  { value: "seated", label: "Seated" },
  { value: "completed", label: "Completed" },
  { value: "no_show", label: "No-show" },
  { value: "cancelled_by_guest", label: "Cancelled by guest" },
  { value: "cancelled_by_venue", label: "Cancelled by venue" },
  { value: "waitlisted", label: "Waitlisted" },
];

const CATEGORY_VARIANT = { restaurant: "info", play: "brand", creative_and_arts: "warning" };
const CLAIM_VARIANT = {
  verified: "success",
  pending_review: "warning",
  rejected: "error",
  suspended: "error",
  revoked: "error",
  none: "default",
};
const RESERVATION_STATUS_VARIANT = {
  confirmed: "success",
  seated: "success",
  completed: "default",
  pending: "warning",
  waitlisted: "warning",
  cancelled: "error",
  no_show: "error",
  expired: "default",
};
const WAITLIST_VARIANT = { waiting: "warning", notified: "info", converted: "success", expired: "default", lost: "error" };

function field(label, value, render) {
  return { label, value, render };
}
const muted = (v) => <span className="text-[var(--color-text-muted)]">{v}</span>;
const noneField = (label) => field(label, "None", (v) => muted(v));
function boolBadge(v) {
  return <Badge variant={v ? "success" : "default"} dot>{v ? "Yes" : "No"}</Badge>;
}

// Inline per-row action affordance (mirrors the ORCH-1276 pattern).
function RowAction({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs underline cursor-pointer hover:opacity-80 text-[var(--color-brand-500)]"
    >
      {children}
    </button>
  );
}

function venueSections(data, cb) {
  const v = data.venue || {};
  const rs = data.settings;
  const sections = [];

  sections.push({
    label: "Venue",
    fields: [
      field("Name", v.name),
      field("Slug", v.slug ? `/${v.slug}` : null),
      field("Category", null, () => (v.venue_category ? <Badge variant={CATEGORY_VARIANT[v.venue_category] || "default"}>{v.venue_category}</Badge> : muted("—"))),
      field("Claim status", null, () => (v.claim_status ? <Badge variant={CLAIM_VARIANT[v.claim_status] || "default"} dot>{v.claim_status}</Badge> : muted("—"))),
      field("Address", v.address),
      field("City", v.city),
      field("Country", v.country_code),
      field("Coordinates", v.lat != null && v.lng != null ? `${v.lat}, ${v.lng}` : null),
      field("Google place id", v.google_place_id, (x) => <span className="font-mono text-xs break-all">{x}</span>),
      field("Contact email", v.contact_email),
      field("Contact phone", v.contact_phone),
      field("Cover media", v.cover_media_url, (x) => <span className="break-all text-xs">{x}</span>),
      field("Claim follow-up", v.claim_follow_up_at, (x) => formatDateTime(x)),
      field("Rejection reason", v.rejection_reason),
      field("Marked called", v.marked_called_at, (x) => formatDateTime(x)),
      field("Duplicate of", v.duplicate_of_venue_id, (x) => <span className="font-mono text-xs">{x}</span>),
      field("Created", v.created_at, (x) => formatDate(x)),
    ],
  });

  sections.push({
    label: "Reservation settings",
    fields: !rs
      ? [field("", "No reservation settings for this venue.", (x) => muted(x))]
      : [
          field("Reservations enabled", null, () => boolBadge(rs.reservations_enabled)),
          field("Fee enabled", null, () => boolBadge(rs.fee_enabled)),
          field("Fee amount", null, () => money(rs.fee_amount_cents, rs.fee_currency)),
          field("Fee refundable", null, () => boolBadge(rs.fee_refundable)),
          field("Cancel cutoff (hrs)", rs.cancel_cutoff_hours),
          field("No-show fee policy", rs.no_show_fee_policy),
          field("Pass fee override", rs.pass_fee_override == null ? null : String(rs.pass_fee_override)),
          field("Pass tax override", rs.pass_tax_override == null ? null : String(rs.pass_tax_override)),
          ...(cb?.dispatch
            ? [
                field("Edit", null, () => (
                  <RowAction
                    onClick={() =>
                      cb.dispatch({
                        kind: "settings",
                        initial: {
                          reservations_enabled: Boolean(rs.reservations_enabled),
                          fee_amount_cents: rs.fee_amount_cents == null ? "" : String(rs.fee_amount_cents),
                          fee_currency: rs.fee_currency ?? "",
                          cancel_cutoff_hours: rs.cancel_cutoff_hours == null ? "" : String(rs.cancel_cutoff_hours),
                          no_show_fee_policy: rs.no_show_fee_policy ?? "forfeit",
                        },
                      })
                    }
                  >
                    Edit reservation settings
                  </RowAction>
                )),
              ]
            : []),
        ],
  });

  sections.push({
    label: `Tables (${data.tables.length})`,
    fields:
      data.tables.length === 0
        ? [noneField("Tables")]
        : data.tables.map((t) =>
            field(t.name || t.id, t, (tb) => (
              <span className={`flex flex-wrap items-center gap-1.5 ${tb.deleted_at ? "opacity-50" : ""}`}>
                <span className="text-sm">seats {tb.capacity ?? "?"}</span>
                {(tb.min_party != null || tb.max_party != null) && (
                  <span className="text-xs text-[var(--color-text-tertiary)]">party {tb.min_party ?? 1}–{tb.max_party ?? tb.capacity ?? "?"}</span>
                )}
                {tb.zone && <Badge variant="outline">{tb.zone}</Badge>}
                {tb.seating_type && <span className="text-xs text-[var(--color-text-tertiary)]">{tb.seating_type}</span>}
                <Badge variant={tb.is_active ? "success" : "default"} dot>{tb.is_active ? "active" : "inactive"}</Badge>
                {tb.deleted_at && <Badge variant="error">deleted</Badge>}
              </span>
            )),
          ),
  });

  sections.push({
    label: `Capacity rules (${data.capacityRules.length})`,
    fields:
      data.capacityRules.length === 0
        ? [noneField("Capacity rules")]
        : data.capacityRules.map((c) =>
            field(c.kind || c.id, c, (cr) => (
              <span className="flex flex-wrap items-center gap-1.5">
                {cr.zone && <Badge variant="outline">{cr.zone}</Badge>}
                <span className="text-xs text-[var(--color-text-tertiary)] break-all">{cr.params ? JSON.stringify(cr.params) : ""}</span>
                <Badge variant={cr.is_active ? "success" : "default"} dot>{cr.is_active ? "active" : "inactive"}</Badge>
                {cb?.dispatch && (
                  <RowAction
                    onClick={() =>
                      cb.dispatch({
                        kind: "capacityRule",
                        targetId: cr.id,
                        label: cr.kind || cr.id,
                        initial: {
                          params: cr.params ? JSON.stringify(cr.params, null, 2) : "",
                          is_active: Boolean(cr.is_active),
                          zone: cr.zone ?? "",
                        },
                      })
                    }
                  >
                    Edit rule
                  </RowAction>
                )}
              </span>
            )),
          ),
  });

  sections.push({
    label: `Blackouts (${data.blackouts.length})`,
    fields:
      data.blackouts.length === 0
        ? [noneField("Blackouts")]
        : data.blackouts.map((b) =>
            field(`${formatDate(b.date_start)}${b.date_end ? ` – ${formatDate(b.date_end)}` : ""}`, b, (bo) => (
              <span className="flex flex-wrap items-center gap-1.5">
                {bo.reason && <span className="text-sm">{bo.reason}</span>}
                {bo.applies_to && <Badge variant="outline">{bo.applies_to}</Badge>}
                {bo.zone && <span className="text-xs text-[var(--color-text-tertiary)]">{bo.zone}</span>}
              </span>
            )),
          ),
  });

  sections.push({
    label: `Waitlist (${data.waitlist.length})`,
    fields:
      data.waitlist.length === 0
        ? [noneField("Waitlist")]
        : data.waitlist.map((w) =>
            field(w.guest_name || w.id, w, (wl) => (
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm">party {wl.party_size ?? "?"}</span>
                <Badge variant={WAITLIST_VARIANT[wl.status] || "default"} dot>{wl.status}</Badge>
                {wl.quoted_wait_minutes != null && <span className="text-xs text-[var(--color-text-tertiary)]">~{wl.quoted_wait_minutes}m</span>}
              </span>
            )),
          ),
  });

  // Reservations rollup.
  const res = data.reservations || { rows: [], total: 0, counts: {} };
  const countEntries = Object.entries(res.counts || {});
  sections.push({
    label: "Reservation counts",
    fields:
      countEntries.length === 0
        ? [field("", "No reservations for this venue.", (x) => muted(x))]
        : countEntries.map(([status, n]) =>
            field(status, null, () => (
              <span className="flex items-center gap-1.5">
                <Badge variant={RESERVATION_STATUS_VARIANT[status] || "default"} dot>{status}</Badge>
                <span className="text-sm">{n}</span>
              </span>
            )),
          ),
  });
  sections.push({
    label: `Reservations (${res.total})`,
    fields:
      res.rows.length === 0
        ? [noneField("Reservations")]
        : res.rows.map((r) =>
            field(r.guest_name || r.guest_email || r.reservation_id, r, (rv) => (
              <span className="flex flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={RESERVATION_STATUS_VARIANT[rv.status] || "default"} dot>{rv.status}</Badge>
                  <span className="text-sm">party {rv.party_size ?? "?"}</span>
                  {rv.reserved_for && <span className="text-xs text-[var(--color-text-tertiary)]">{formatDateTime(rv.reserved_for)}</span>}
                  {rv.table_name && <Badge variant="outline">{rv.table_name}</Badge>}
                  {rv.fee_cents != null && rv.fee_cents > 0 && <span className="text-xs">{money(rv.fee_cents, rv.fee_currency)}</span>}
                  {cb?.dispatch && (
                    <RowAction
                      onClick={() =>
                        cb.dispatch({
                          kind: "reservationStatus",
                          targetId: rv.reservation_id,
                          label: rv.guest_name || rv.guest_email || rv.reservation_id,
                          initial: { status: rv.status || "" },
                        })
                      }
                    >
                      Override status
                    </RowAction>
                  )}
                </span>
                {(rv.guest_email || rv.guest_phone_e164) && (
                  <span className="text-xs text-[var(--color-text-tertiary)]">{[rv.guest_email, rv.guest_phone_e164].filter(Boolean).join(" · ")}</span>
                )}
              </span>
            )),
          ),
  });

  return sections;
}

export function VenueDetailView({ venueId, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ORCH-1277 mutation state: one shared modal instance keyed by { kind, targetId, ... }.
  const [activeAction, setActiveAction] = useState(null);
  const dispatch = useCallback((a) => setActiveAction(a), []);
  const closeAction = useCallback(() => setActiveAction(null), []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const venue = await getVenue(venueId);
      if (!venue) {
        setError("No venue found for this ID.");
        return;
      }
      const [settings, tables, capacityRules, blackouts, waitlist, reservations] = await Promise.all([
        getVenueReservationSettings(venueId),
        getVenueTables(venueId),
        getVenueCapacityRules(venueId),
        getVenueBlackouts(venueId),
        getVenueWaitlist(venueId),
        listVenueReservations(venueId).catch((e) => {
          console.warn("[VenueDetailView] reservations degraded:", e?.message || e);
          return { rows: [], total: 0, counts: {} };
        }),
      ]);
      setData({ venue, settings, tables, capacityRules, blackouts, waitlist, reservations });
    } catch (err) {
      const msg = err?.message || "";
      if (msg.includes("not_authorized")) setError("You are not authorized to view this venue.");
      else setError(msg || "Failed to load this venue.");
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => {
    load();
  }, [load]);

  const v = data?.venue || {};
  const badges = [];
  if (v.venue_category) badges.push({ label: v.venue_category, variant: CATEGORY_VARIANT[v.venue_category] || "default" });
  if (v.claim_status) badges.push({ label: v.claim_status, variant: CLAIM_VARIANT[v.claim_status] || "default" });

  const a = activeAction;

  return (
    <div className="flex flex-col gap-4">
      <EntityDetailView
        loading={loading}
        error={error}
        onRetry={load}
        header={{
          title: v.name || "Venue",
          subtitle: data ? <span className="font-mono">{v.slug ? `/${v.slug}` : venueId}</span> : undefined,
          badges: data ? badges : [],
          backLabel: "Venues",
          onBack,
        }}
        sections={data ? venueSections(data, { dispatch }) : []}
      />

      {/* ── ORCH-1277 venue reservation-stack edit modals (mounted fresh per open) ── */}

      {a?.kind === "settings" && (
        <EntityEditModal
          open
          onClose={closeAction}
          title="Edit reservation settings"
          description="Toggle reservations, the fee, cancellation cutoff, and no-show policy. Recorded in the audit log."
          fields={[
            { key: "reservations_enabled", label: "Reservations enabled", type: "switch" },
            { key: "fee_amount_cents", label: "Fee amount (cents, blank = none)", type: "text" },
            { key: "fee_currency", label: "Fee currency (ISO, blank = none)", type: "text" },
            { key: "cancel_cutoff_hours", label: "Cancel cutoff (hours)", type: "text" },
            { key: "no_show_fee_policy", label: "No-show fee policy", type: "select", options: NO_SHOW_POLICY_OPTIONS, required: true },
          ]}
          initialValues={a.initial}
          submitLabel="Save settings"
          requireReason
          successMessage="Reservation settings updated."
          onSave={async (values, { reason }) => {
            const { error: e } = await updateVenueReservationSettings(
              venueId,
              {
                reservations_enabled: Boolean(values.reservations_enabled),
                fee_amount_cents: values.fee_amount_cents,
                fee_currency: values.fee_currency,
                cancel_cutoff_hours: values.cancel_cutoff_hours,
                no_show_fee_policy: values.no_show_fee_policy,
              },
              reason,
            );
            if (e) throw new Error(mapVenueWriteError(e));
            closeAction();
            await load();
          }}
        />
      )}

      {a?.kind === "capacityRule" && (
        <EntityEditModal
          open
          onClose={closeAction}
          title={`Edit capacity rule — ${a.label}`}
          description="Edit the rule params (JSON), active toggle, and zone. The rule kind cannot be changed. Recorded in the audit log."
          fields={[
            { key: "params", label: "Params (JSON)", type: "json", required: true },
            { key: "is_active", label: "Active", type: "switch" },
            { key: "zone", label: "Zone (blank = none)", type: "select", options: ZONE_OPTIONS },
          ]}
          initialValues={a.initial}
          submitLabel="Save rule"
          requireReason
          successMessage="Capacity rule updated."
          onSave={async (values, { reason }) => {
            const { error: e } = await updateVenueCapacityRule(
              a.targetId,
              { params: values.params, is_active: Boolean(values.is_active), zone: values.zone },
              reason,
            );
            if (e) throw new Error(mapVenueWriteError(e));
            closeAction();
            await load();
          }}
        />
      )}

      {a?.kind === "reservationStatus" && (
        <EntityEditModal
          open
          onClose={closeAction}
          title={`Override reservation status — ${a.label}`}
          description="Set this reservation to a new status. The guest is notified of the change. Recorded in the audit log."
          fields={[{ key: "status", label: "Status", type: "select", options: RESERVATION_STATUS_OPTIONS, required: true }]}
          initialValues={a.initial}
          submitLabel="Save status"
          requireReason
          successMessage="Reservation status updated."
          onSave={async (values, { reason }) => {
            const { error: e } = await setReservationStatus(a.targetId, values.status, reason);
            if (e) throw new Error(mapVenueWriteError(e));
            closeAction();
            await load();
          }}
        />
      )}
    </div>
  );
}

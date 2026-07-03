// ORCH-1272 [Admin Identity console — READ-ONLY] — Brands console.
//
// Cross-brand list → Brand detail (profile + claim/verify + money + owner + team
// + invites + partner links + brand support tickets). Reuses the existing
// "brands admin can read" RLS (which also exposes soft-deleted brands); team /
// invites / partner-links come from the new ORCH-1272 admin-read RLS policies.
//
// READ-ONLY (visibility-first). No edit / mutation; no live Stripe call (that is
// ORCH-1274). The EntityDetailView `actions` slot is empty — Wave-2 attaches
// audited edits there.

import { useState, useEffect, useCallback } from "react";
import { Building2 } from "lucide-react";
import { EntityListView } from "../components/entity/EntityListView";
import { EntityDetailView } from "../components/entity/EntityDetailView";
import { Badge } from "../components/ui/Badge";
import { listBrands, getBrandDetail } from "../services/identityReadService";
import { timeAgo, formatDate, formatDateTime } from "../lib/formatters";

// ── Shared maps / helpers ─────────────────────────────────────────────────────

const CLAIM_VARIANT = {
  verified: "success",
  pending_review: "warning",
  rejected: "error",
  suspended: "error",
  revoked: "error",
  none: "default",
};
const ROLE_VARIANT = { brand_owner: "brand", brand_admin: "info", finance_manager: "warning" };
const INVITE_VARIANT = { pending: "warning", accepted: "success", revoked: "error", expired: "default", declined: "error" };
const TICKET_VARIANT = { open: "warning", pending: "info", resolved: "success", closed: "default" };

function takeRate(bps) {
  if (bps == null) return "default";
  return `${bps / 100}%`;
}

function boolBadge(v) {
  return <Badge variant={v ? "success" : "default"} dot>{v ? "Yes" : "No"}</Badge>;
}

function jsonLinks(value) {
  if (!value || (typeof value === "object" && Object.keys(value).length === 0)) {
    return <span className="text-[var(--color-text-muted)]">—</span>;
  }
  const entries = Array.isArray(value)
    ? value.map((v, i) => [i, v])
    : Object.entries(value);
  return (
    <div className="flex flex-col gap-0.5">
      {entries.map(([k, v]) => (
        <span key={k} className="text-xs break-all">
          <span className="text-[var(--color-text-tertiary)]">{k}: </span>
          {typeof v === "object" ? JSON.stringify(v) : String(v)}
        </span>
      ))}
    </div>
  );
}

// ── List columns / filters / csv ──────────────────────────────────────────────

const COLUMNS = [
  {
    key: "name",
    label: "Name",
    sortable: true,
    render: (val, row) => (
      <div className="min-w-0">
        <span className="font-medium text-[var(--color-text-primary)] block truncate">{val || "—"}</span>
        {row.slug && <span className="text-xs text-[var(--color-text-muted)] block truncate">/{row.slug}</span>}
      </div>
    ),
  },
  {
    key: "claim_status",
    label: "Claim",
    render: (val) => (val ? <Badge variant={CLAIM_VARIANT[val] || "default"}>{val}</Badge> : <span className="text-[var(--color-text-muted)]">—</span>),
  },
  {
    key: "owner_business_name",
    label: "Owner",
    render: (val) => val || <span className="text-[var(--color-text-muted)]">—</span>,
  },
  {
    key: "city",
    label: "Location",
    render: (val, row) =>
      val || row.country_code ? (
        <span className="text-sm">{[val, row.country_code].filter(Boolean).join(", ")}</span>
      ) : (
        <span className="text-[var(--color-text-muted)]">—</span>
      ),
  },
  {
    key: "pricing_currency",
    label: "Currency",
    render: (val, row) => (
      <span className="text-sm">
        {val || "—"}
        {row.default_currency && row.default_currency !== val && (
          <span className="text-xs text-[var(--color-text-muted)]"> · {row.default_currency}</span>
        )}
      </span>
    ),
  },
  {
    key: "take_rate_bps_override",
    label: "Take-rate",
    render: (val) => <span className="text-sm">{takeRate(val)}</span>,
  },
  {
    key: "payment_provider",
    label: "Payments",
    render: (val, row) =>
      val ? (
        <span className="flex items-center gap-1.5 text-sm">
          <Badge variant={row.stripe_charges_enabled ? "success" : "default"} dot>
            {val}
          </Badge>
        </span>
      ) : (
        <span className="text-[var(--color-text-muted)]">—</span>
      ),
  },
  {
    key: "deleted_at",
    label: "Status",
    render: (val) => (
      <Badge variant={val ? "error" : "success"} dot>
        {val ? "Deleted" : "Live"}
      </Badge>
    ),
  },
  {
    key: "created_at",
    label: "Created",
    sortable: true,
    render: (val) => <span className="text-xs text-[var(--color-text-tertiary)]">{timeAgo(val)}</span>,
  },
];

const FILTERS = [
  {
    key: "claim_status",
    label: "Claim status",
    options: [
      { value: "none", label: "None" },
      { value: "pending_review", label: "Pending review" },
      { value: "verified", label: "Verified" },
      { value: "rejected", label: "Rejected" },
      { value: "suspended", label: "Suspended" },
      { value: "revoked", label: "Revoked" },
    ],
  },
  {
    key: "status",
    label: "Status",
    options: [
      { value: "live", label: "Live" },
      { value: "deleted", label: "Deleted" },
    ],
  },
  {
    key: "payment_provider",
    label: "Provider",
    options: [
      { value: "stripe", label: "Stripe" },
      { value: "paystack", label: "Paystack" },
    ],
  },
];

const CSV = {
  columns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "slug", label: "Slug" },
    { key: "claim_status", label: "Claim status" },
    { key: "city", label: "City" },
    { key: "country_code", label: "Country" },
    { key: "pricing_currency", label: "Pricing currency" },
    { key: "take_rate_bps_override", label: "Take-rate bps" },
    { key: "payment_provider", label: "Payment provider" },
    { key: "deleted_at", label: "Deleted at" },
    { key: "created_at", label: "Created at" },
  ],
  filename: "brands",
};

// ── Hash helpers ──────────────────────────────────────────────────────────────

function brandIdFromHash() {
  const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
  return params.get("brandId");
}

// ── Detail section builders ───────────────────────────────────────────────────

function field(label, value, render) {
  return { label, value, render };
}
const noneField = () => field("", "None", (v) => <span className="text-[var(--color-text-muted)]">{v}</span>);

function buildBrandSections(detail, onOpenOwner) {
  const b = detail.brand || {};
  const owner = detail.owner || null;
  const team = detail.team || [];
  const invites = detail.invites || [];
  const partnerLinks = detail.partnerLinks || [];
  const tickets = detail.tickets || [];

  const sections = [
    {
      label: "Brand profile",
      fields: [
        field("Name", b.name),
        field("Slug", b.slug),
        field("Description", b.description),
        field("Venue category", b.venue_category),
        field("City", b.city),
        field("Country", b.country_code),
        field("Coordinates", b.latitude != null && b.longitude != null ? `${b.latitude}, ${b.longitude}` : null),
        field("Cover media", b.cover_media_url, (v) => <span className="break-all text-xs">{v}</span>),
        field("Profile media", b.profile_media_url, (v) => <span className="break-all text-xs">{v}</span>),
        field("Theme color", b.theme_color),
        field("Theme font", b.theme_font),
        field("Theme animation", b.theme_animation),
        field("Social links", null, () => jsonLinks(b.social_links)),
        field("Custom links", null, () => jsonLinks(b.custom_links)),
      ],
    },
    {
      label: "Claim & verification",
      fields: [
        field("Claim status", null, () =>
          b.claim_status ? <Badge variant={CLAIM_VARIANT[b.claim_status] || "default"}>{b.claim_status}</Badge> : "—",
        ),
        field("Verified at", b.verified_at, (v) => formatDateTime(v)),
        field("Verified by", b.verified_by, (v) => <span className="font-mono text-xs">{v}</span>),
        field("Rejection reason", b.rejection_reason),
        field("Marked called at", b.marked_called_at, (v) => formatDateTime(v)),
        field("Duplicate of", b.duplicate_of_brand_id, (v) => <span className="font-mono text-xs">{v}</span>),
      ],
    },
    {
      label: "Money",
      fields: [
        field("Pricing currency", b.pricing_currency),
        field("Default currency", null, () =>
          b.default_currency ? <span className="text-[var(--color-text-tertiary)]">{b.default_currency}</span> : "—",
        ),
        field("Pricing region", b.pricing_region),
        field("Take-rate", takeRate(b.take_rate_bps_override)),
        field("Payment provider", b.payment_provider),
        field("Payment country", b.payment_country),
        field("Stripe connect id", b.stripe_connect_id, (v) => <span className="font-mono text-xs break-all">{v}</span>),
        field("Stripe charges", null, () => boolBadge(b.stripe_charges_enabled)),
        field("Stripe payouts", null, () => boolBadge(b.stripe_payouts_enabled)),
        field("Paystack subaccount", b.paystack_subaccount_code, (v) => <span className="font-mono text-xs break-all">{v}</span>),
      ],
    },
  ];

  // Owner
  if (owner) {
    sections.push({
      label: "Owner",
      fields: [
        field("Business name", null, () => (
          <button
            type="button"
            onClick={() => onOpenOwner(b.account_id)}
            className="text-left text-[var(--color-brand-500)] underline cursor-pointer hover:opacity-80"
          >
            {owner.business_name || b.account_id}
          </button>
        )),
        field("Email", owner.email),
        field("Phone", owner.phone_e164),
        field("Partner", null, () => (owner.partner_enabled ? <Badge variant="success" dot>Partner</Badge> : "No")),
        field("Deleted", null, () =>
          owner.deleted_at ? <Badge variant="error">Deleted {formatDate(owner.deleted_at)}</Badge> : "Active",
        ),
      ],
    });
  } else {
    sections.push({ label: "Owner", fields: [noneField()] });
  }

  // Team
  sections.push({
    label: `Team (${team.length})`,
    fields:
      team.length === 0
        ? [noneField()]
        : team.map((m) =>
            field(m.member_name || m.user_id, m, (mem) => (
              <span className={`flex flex-wrap items-center gap-1.5 ${mem.removed_at ? "opacity-50" : ""}`}>
                <Badge variant={ROLE_VARIANT[mem.role] || "default"}>{mem.role}</Badge>
                {mem.member_email && <span className="text-xs text-[var(--color-text-tertiary)]">{mem.member_email}</span>}
                {mem.accepted_at && !mem.removed_at && (
                  <span className="text-xs text-[var(--color-text-tertiary)]">joined {formatDate(mem.accepted_at)}</span>
                )}
                {mem.removed_at && <Badge variant="error">removed</Badge>}
              </span>
            )),
          ),
  });

  // Invites
  sections.push({
    label: `Invitations (${invites.length})`,
    fields:
      invites.length === 0
        ? [field("", "No invitations", (v) => <span className="text-[var(--color-text-muted)]">{v}</span>)]
        : invites.map((inv) =>
            field(inv.email || inv.invitee_name || inv.id, inv, (iv) => (
              <span className="flex flex-wrap items-center gap-1.5">
                <Badge variant={INVITE_VARIANT[iv.status] || "default"}>{iv.status}</Badge>
                {iv.role && <Badge variant="outline">{iv.role}</Badge>}
                {iv.expires_at && (
                  <span className="text-xs text-[var(--color-text-tertiary)]">expires {formatDate(iv.expires_at)}</span>
                )}
              </span>
            )),
          ),
  });

  // Partner links
  sections.push({
    label: `Partner links (${partnerLinks.length})`,
    fields:
      partnerLinks.length === 0
        ? [noneField()]
        : partnerLinks.map((p) =>
            field(p.partner_business_name || p.invited_owner_email || p.id, p, (pl) => (
              <span className="flex flex-wrap items-center gap-1.5">
                {pl.invited_owner_email && <span className="text-xs text-[var(--color-text-tertiary)]">{pl.invited_owner_email}</span>}
                {pl.accepted_at ? (
                  <Badge variant="success" dot>accepted</Badge>
                ) : pl.cancelled_at ? (
                  <Badge variant="error" dot>cancelled</Badge>
                ) : (
                  <Badge variant="warning" dot>pending</Badge>
                )}
              </span>
            )),
          ),
  });

  // Brand support tickets
  sections.push({
    label: `Support tickets (${tickets.length})`,
    fields:
      tickets.length === 0
        ? [noneField()]
        : tickets.map((t) =>
            field(t.subject || t.id, t, (tk) => (
              <a href="#/support" className="flex flex-wrap items-center gap-1.5 hover:opacity-80">
                <Badge variant={TICKET_VARIANT[tk.status] || "default"}>{tk.status}</Badge>
                {tk.priority && <Badge variant="outline">{tk.priority}</Badge>}
                <span className="text-xs text-[var(--color-text-tertiary)]">{timeAgo(tk.last_message_at || tk.created_at)}</span>
              </a>
            )),
          ),
  });

  return sections;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BrandsConsolePage() {
  const [selectedBrandId, setSelectedBrandId] = useState(() => brandIdFromHash());
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const sync = () => setSelectedBrandId(brandIdFromHash());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const loadBrand = useCallback(async (brandId) => {
    setLoading(true);
    setError(null);
    setDetail(null);
    try {
      const d = await getBrandDetail(brandId);
      setDetail(d);
    } catch (err) {
      const msg = err?.message || "";
      setError(msg.includes("not_found") ? "No brand found for this ID." : msg || "Failed to load this brand.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedBrandId) loadBrand(selectedBrandId);
  }, [selectedBrandId, loadBrand]);

  const openBrand = useCallback((brandId) => {
    window.location.hash = `#/business-brands?brandId=${brandId}`;
    setSelectedBrandId(brandId);
  }, []);

  const openOwner = useCallback((accountId) => {
    if (accountId) window.location.hash = `#/business-people?userId=${accountId}`;
  }, []);

  const backToList = useCallback(() => {
    window.location.hash = "#/business-brands";
    setSelectedBrandId(null);
    setDetail(null);
    setError(null);
  }, []);

  // ── Brand detail view ───────────────────────────────────────────────────────
  if (selectedBrandId) {
    const b = detail?.brand || {};
    const badges = [];
    if (b.claim_status) badges.push({ label: b.claim_status, variant: CLAIM_VARIANT[b.claim_status] || "default" });
    badges.push(b.deleted_at ? { label: "Deleted", variant: "error" } : { label: "Live", variant: "success" });

    return (
      <div className="py-8">
        <EntityDetailView
          loading={loading}
          error={error}
          onRetry={() => loadBrand(selectedBrandId)}
          header={{
            title: b.name || "Brand",
            subtitle: detail ? <span className="font-mono">{b.slug ? `/${b.slug}` : selectedBrandId}</span> : undefined,
            badges: detail ? badges : [],
            backLabel: "Brands",
            onBack: backToList,
          }}
          sections={detail ? buildBrandSections(detail, openOwner) : []}
        />
      </div>
    );
  }

  // ── Brands list view ────────────────────────────────────────────────────────
  return (
    <div className="py-8 flex flex-col gap-6">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-full bg-[var(--color-brand-50)] flex items-center justify-center shrink-0">
          <Building2 className="w-5 h-5 text-[var(--color-brand-500)]" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Brands</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
            Every brand across the platform. Open one for the full record — profile, claim state, money,
            owner, team, invites, and support.
          </p>
        </div>
      </div>

      <EntityListView
        title="All brands"
        columns={COLUMNS}
        fetchPage={listBrands}
        searchPlaceholder="Search name, slug, or city…"
        filters={FILTERS}
        onRowClick={(row) => openBrand(row.id)}
        csv={CSV}
        emptyMessage="No brands match."
        emptyIcon={Building2}
      />
    </div>
  );
}

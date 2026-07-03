// ORCH-1272 [Admin Identity console — READ-ONLY] — Brands console.
// ORCH-1276 [Admin Identity console — WAVE-2 EDIT] — audited support actions wired
// onto the detail: edit profile (A1) + reassign owner (A2) + suspend/unsuspend
// (A3/A4) + soft-delete/restore (A5) + per-member change-role/remove (C1/C2) +
// revoke invite (C3). EVERY write routes through identityWriteService →
// callAdminWriteRpc (audited SECURITY DEFINER RPC); the page NEVER touches a
// brands/team/invite table directly. Every success REFETCHES via loadBrand.
//
// Cross-brand list → Brand detail (profile + claim/verify + money + owner + team
// + invites + partner links + brand support tickets). Reuses the existing
// "brands admin can read" RLS (which also exposes soft-deleted brands); team /
// invites / partner-links come from the ORCH-1272 admin-read RLS policies.

import { useState, useEffect, useCallback } from "react";
import { Building2 } from "lucide-react";
import { EntityListView } from "../components/entity/EntityListView";
import { EntityDetailView } from "../components/entity/EntityDetailView";
import { EntityEditModal } from "../components/entity/EntityEditModal";
import { HighRiskActionModal } from "../components/entity/HighRiskActionModal";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { listBrands, getBrandDetail, listAccounts } from "../services/identityReadService";
import {
  updateBrand,
  reassignBrandOwner,
  setBrandClaimStatus,
  setBrandDeleted,
  setTeamMemberRole,
  removeTeamMember,
  revokeInvitation,
  mapWriteError,
} from "../services/identityWriteService";
import { timeAgo, formatDate, formatDateTime } from "../lib/formatters";

const TEAM_ROLE_OPTIONS = [
  { value: "brand_owner", label: "Brand owner" },
  { value: "brand_admin", label: "Brand admin" },
  { value: "event_manager", label: "Event manager" },
  { value: "finance_manager", label: "Finance manager" },
  { value: "marketing_manager", label: "Marketing manager" },
  { value: "scanner", label: "Scanner" },
];
const VENUE_CATEGORY_OPTIONS = [
  { value: "restaurant", label: "Restaurant" },
  { value: "play", label: "Play" },
  { value: "creative_and_arts", label: "Creative & arts" },
];

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

function buildBrandSections(detail, callbacks) {
  const { onOpenOwner, onEditRole, onRemoveMember, onRevokeInvite } = callbacks || {};
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
                {!mem.removed_at && onEditRole && (
                  <button
                    type="button"
                    onClick={() => onEditRole(mem)}
                    className="text-xs text-[var(--color-brand-500)] underline cursor-pointer hover:opacity-80"
                  >
                    Change role
                  </button>
                )}
                {!mem.removed_at && onRemoveMember && (
                  <button
                    type="button"
                    onClick={() => onRemoveMember(mem)}
                    className="text-xs text-[var(--color-error-700)] underline cursor-pointer hover:opacity-80"
                  >
                    Remove
                  </button>
                )}
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
                {iv.status === "pending" && onRevokeInvite && (
                  <button
                    type="button"
                    onClick={() => onRevokeInvite(iv)}
                    className="text-xs text-[var(--color-error-700)] underline cursor-pointer hover:opacity-80"
                  >
                    Revoke
                  </button>
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

  // ORCH-1276 mutation state (page owns all modals + refetch-on-success).
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [accountOptions, setAccountOptions] = useState([]);
  // Per-row team/invite action: { type: 'role' | 'remove' | 'revoke', row }.
  const [teamAction, setTeamAction] = useState(null);

  useEffect(() => {
    const sync = () => setSelectedBrandId(brandIdFromHash());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  // Load the account picker (reassign-owner A2) once a brand is opened. Small set
  // (live creator_accounts ≈ 13); the RPC's invalid_new_owner guard backstops.
  useEffect(() => {
    if (!selectedBrandId || accountOptions.length > 0) return;
    let cancelled = false;
    listAccounts({ sortKey: "business_name", sortDir: "asc", pageSize: 500 })
      .then(({ rows }) => {
        if (cancelled) return;
        setAccountOptions(
          (rows || []).map((r) => ({ value: r.id, label: r.business_name || r.email || r.id })),
        );
      })
      .catch((err) => console.warn("[BrandsConsolePage] account picker load failed:", err?.message || err));
    return () => {
      cancelled = true;
    };
  }, [selectedBrandId, accountOptions.length]);

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

    // Entity-level footer HIGH actions → EntityDetailView renders HighRiskActionModal.
    const footerActions = [];
    if (detail) {
      const afterWrite = async (fn) => {
        const { error: e } = await fn();
        if (e) throw new Error(mapWriteError(e));
        await loadBrand(selectedBrandId);
      };
      if (b.claim_status === "suspended") {
        footerActions.push({
          label: "Unsuspend brand",
          title: "Unsuspend brand",
          description: "Restore this brand's claim status to verified. Recorded in the audit log.",
          confirmLabel: "Unsuspend",
          requireReason: true,
          onConfirm: ({ reason }) => afterWrite(() => setBrandClaimStatus(selectedBrandId, "verified", reason)),
        });
      } else {
        footerActions.push({
          label: "Suspend brand",
          title: "Suspend brand",
          description: "Suspend this brand. Its public pages and selling stop. Recorded in the audit log.",
          confirmLabel: "Suspend",
          destructive: true,
          requireReason: true,
          confirmPhrase: b.slug || undefined,
          onConfirm: ({ reason }) => afterWrite(() => setBrandClaimStatus(selectedBrandId, "suspended", reason)),
        });
      }
      if (b.deleted_at) {
        footerActions.push({
          label: "Restore brand",
          title: "Restore brand",
          description: "Clear the soft-delete on this brand. Recorded in the audit log.",
          confirmLabel: "Restore",
          requireReason: true,
          onConfirm: ({ reason }) => afterWrite(() => setBrandDeleted(selectedBrandId, false, reason)),
        });
      } else {
        footerActions.push({
          label: "Soft-delete brand",
          title: "Soft-delete brand",
          description: "Soft-delete this brand (reversible). Recorded in the audit log.",
          confirmLabel: "Soft-delete",
          destructive: true,
          requireReason: true,
          confirmPhrase: b.slug || undefined,
          onConfirm: ({ reason }) => afterWrite(() => setBrandDeleted(selectedBrandId, true, reason)),
        });
      }
    }

    // A1 edit-profile fields (only columns the 1272 read surfaces — no data loss).
    // Currency: default_currency is the SOURCE OF TRUTH — the DB trigger
    // trg_brands_derive_pricing_from_default forces pricing_currency :=
    // upper(default_currency) on any write, so pricing_currency is shown READ-ONLY
    // (derived, never submitted) and the admin edits default_currency instead.
    const profileFields = [
      { key: "name", label: "Name", type: "text", required: true },
      { key: "description", label: "Description", type: "textarea" },
      { key: "venue_category", label: "Venue category", type: "select", options: VENUE_CATEGORY_OPTIONS },
      {
        key: "default_currency",
        label: "Default currency",
        type: "text",
        required: true,
        help: "3-letter ISO (e.g. USD). Pricing currency is derived from this (upper-cased).",
      },
      {
        key: "pricing_currency",
        label: "Pricing currency (derived)",
        type: "readonly",
        help: "Set automatically from the default currency — not editable here.",
      },
      { key: "theme_color", label: "Theme color", type: "text" },
      { key: "theme_font", label: "Theme font", type: "text" },
      { key: "theme_animation", label: "Theme animation", type: "text" },
      { key: "social_links", label: "Social links (JSON)", type: "json" },
      { key: "custom_links", label: "Custom links (JSON)", type: "json" },
    ];
    const profileInitial = {
      name: b.name ?? "",
      description: b.description ?? "",
      venue_category: b.venue_category ?? "",
      // Pre-fill default_currency from itself, falling back to the (always-present,
      // NOT NULL) pricing_currency so a brand with a null default isn't blocked.
      default_currency: b.default_currency ?? b.pricing_currency ?? "",
      pricing_currency: b.pricing_currency ?? "",
      theme_color: b.theme_color ?? "",
      theme_font: b.theme_font ?? "",
      theme_animation: b.theme_animation ?? "",
      social_links: b.social_links ? JSON.stringify(b.social_links, null, 2) : "",
      custom_links: b.custom_links ? JSON.stringify(b.custom_links, null, 2) : "",
    };

    const activeMember = teamAction?.row;
    const memberPhrase = activeMember?.member_email || activeMember?.user_id || "";

    return (
      <div className="py-8 flex flex-col gap-4">
        {detail && !loading && !error && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="secondary" size="md" onClick={() => setEditProfileOpen(true)}>
              Edit profile
            </Button>
            <Button variant="secondary" size="md" onClick={() => setReassignOpen(true)}>
              Reassign owner
            </Button>
          </div>
        )}

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
          actions={footerActions}
          sections={
            detail
              ? buildBrandSections(detail, {
                  onOpenOwner: openOwner,
                  onEditRole: (mem) => setTeamAction({ type: "role", row: mem }),
                  onRemoveMember: (mem) => setTeamAction({ type: "remove", row: mem }),
                  onRevokeInvite: (inv) => setTeamAction({ type: "revoke", row: inv }),
                })
              : []
          }
        />

        {/* A1 — edit brand profile (LOW, audit-only). Mounted fresh per open. */}
        {editProfileOpen && (
          <EntityEditModal
            open
            onClose={() => setEditProfileOpen(false)}
            title="Edit brand profile"
            description="Profile-only edits. Ownership, claim status, deletion and money are separate audited actions."
            fields={profileFields}
            initialValues={profileInitial}
            submitLabel="Save profile"
            successMessage="Brand profile updated."
            onSave={async (values, { reason }) => {
              const { error: e } = await updateBrand(selectedBrandId, values, reason || null);
              if (e) throw new Error(mapWriteError(e));
              await loadBrand(selectedBrandId);
            }}
          />
        )}

        {/* A2 — reassign brand owner (HIGH, phrase = slug). Mounted fresh per open. */}
        {reassignOpen && (
          <EntityEditModal
            open
            onClose={() => setReassignOpen(false)}
            title="Reassign brand owner"
            description="Move this brand to a different account. The new owner gains full control."
            fields={[
              { key: "new_account_id", label: "New owner account", type: "select", options: accountOptions, required: true },
            ]}
            initialValues={{ new_account_id: "" }}
            submitLabel="Reassign owner"
            requireReason
            destructive
            confirmPhrase={b.slug || undefined}
            successMessage="Brand owner reassigned."
            onSave={async (values, { reason }) => {
              const { error: e } = await reassignBrandOwner(selectedBrandId, values.new_account_id, reason);
              if (e) throw new Error(mapWriteError(e));
              await loadBrand(selectedBrandId);
            }}
          />
        )}

        {/* C1 — change team-member role (HIGH). Mounted fresh per open. */}
        {teamAction?.type === "role" && (
          <EntityEditModal
            open
            onClose={() => setTeamAction(null)}
            title="Change team-member role"
            description={activeMember ? `Change the role for ${activeMember.member_email || activeMember.user_id}.` : ""}
            fields={[{ key: "role", label: "Role", type: "select", options: TEAM_ROLE_OPTIONS, required: true }]}
            initialValues={{ role: activeMember?.role || "" }}
            submitLabel="Change role"
            requireReason
            successMessage="Role updated."
            onSave={async (values, { reason }) => {
              const { error: e } = await setTeamMemberRole(activeMember.id, values.role, reason);
              if (e) throw new Error(mapWriteError(e));
              setTeamAction(null);
              await loadBrand(selectedBrandId);
            }}
          />
        )}

        {/* C2 — remove team member (HIGH, phrase = member email). */}
        <HighRiskActionModal
          open={teamAction?.type === "remove"}
          onClose={() => setTeamAction(null)}
          title="Remove team member"
          description={activeMember ? `Remove ${activeMember.member_email || activeMember.user_id} from this brand's team.` : ""}
          confirmLabel="Remove member"
          destructive
          confirmPhrase={memberPhrase || undefined}
          successMessage="Team member removed."
          onConfirm={async ({ reason }) => {
            const { error: e } = await removeTeamMember(activeMember.id, reason);
            if (e) throw new Error(mapWriteError(e));
            setTeamAction(null);
            await loadBrand(selectedBrandId);
          }}
        />

        {/* C3 — revoke invite (HIGH, reason only). */}
        <HighRiskActionModal
          open={teamAction?.type === "revoke"}
          onClose={() => setTeamAction(null)}
          title="Revoke invitation"
          description={teamAction?.row ? `Revoke the pending invite for ${teamAction.row.email || teamAction.row.id}.` : ""}
          confirmLabel="Revoke invite"
          destructive
          successMessage="Invitation revoked."
          onConfirm={async ({ reason }) => {
            const { error: e } = await revokeInvitation(teamAction.row.id, reason);
            if (e) throw new Error(mapWriteError(e));
            setTeamAction(null);
            await loadBrand(selectedBrandId);
          }}
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

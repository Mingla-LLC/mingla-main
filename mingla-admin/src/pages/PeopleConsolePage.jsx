// ORCH-1272 [Admin Identity console — READ-ONLY] — People console.
//
// The missing business-account layer: a searchable creator_accounts list →
// a unified Person detail that shows BOTH halves of a user (consumer profile +
// business account + brands owned/member + subscription + support tickets),
// served by the guard-first admin_get_person RPC.
//
// READ-ONLY (visibility-first). No edit / mutation. The EntityDetailView `actions`
// slot is intentionally left empty — Wave-2 attaches audited edits there.
// Consumer-only users are reachable via the ?userId= deep-link.

import { useState, useEffect, useCallback } from "react";
import { Users, Building2 } from "lucide-react";
import { EntityListView } from "../components/entity/EntityListView";
import { EntityDetailView } from "../components/entity/EntityDetailView";
import { Badge } from "../components/ui/Badge";
import { getPerson, listAccounts } from "../services/identityReadService";
import { timeAgo, formatDate, formatDateTime } from "../lib/formatters";

// ── Shared badge maps (read-only) ─────────────────────────────────────────────

const CLAIM_VARIANT = {
  verified: "success",
  pending_review: "warning",
  rejected: "error",
  suspended: "error",
  revoked: "error",
  none: "default",
};
const SEGMENT_VARIANT = { admin: "brand", business: "info", explorer: "default" };
const ROLE_VARIANT = { brand_owner: "brand", brand_admin: "info", finance_manager: "warning" };
const TICKET_VARIANT = { open: "warning", pending: "info", resolved: "success", closed: "default" };

function tierLabel(tier) {
  if (!tier) return "—";
  return tier === "mingla_plus" ? "Mingla+" : tier;
}

// ── Accounts list columns / filters / csv ─────────────────────────────────────

const COLUMNS = [
  {
    key: "business_name",
    label: "Business",
    sortable: true,
    render: (val, row) => (
      <span className="font-medium text-[var(--color-text-primary)]">
        {val || row.display_name || "—"}
      </span>
    ),
  },
  { key: "email", label: "Email", sortable: true },
  {
    key: "phone_e164",
    label: "Phone",
    render: (val) => val || <span className="text-[var(--color-text-muted)]">—</span>,
  },
  {
    key: "partner_enabled",
    label: "Partner",
    render: (val, row) =>
      val ? (
        <Badge variant="success" dot>
          Partner{row.partner_country ? ` · ${row.partner_country}` : ""}
        </Badge>
      ) : (
        <span className="text-[var(--color-text-muted)]">—</span>
      ),
  },
  {
    key: "default_brand_name",
    label: "Default brand",
    render: (val) => val || <span className="text-[var(--color-text-muted)]">—</span>,
  },
  {
    key: "deleted_at",
    label: "Status",
    render: (val) => (
      <Badge variant={val ? "error" : "success"} dot>
        {val ? "Deleted" : "Active"}
      </Badge>
    ),
  },
  {
    key: "created_at",
    label: "Joined",
    sortable: true,
    render: (val) => <span className="text-xs text-[var(--color-text-tertiary)]">{timeAgo(val)}</span>,
  },
];

const FILTERS = [
  {
    key: "partner",
    label: "Partner",
    options: [
      { value: "enabled", label: "Partner" },
      { value: "disabled", label: "Not partner" },
    ],
  },
  {
    key: "status",
    label: "Status",
    options: [
      { value: "active", label: "Active" },
      { value: "deleted", label: "Deleted" },
    ],
  },
];

const CSV = {
  columns: [
    { key: "id", label: "ID" },
    { key: "business_name", label: "Business name" },
    { key: "email", label: "Email" },
    { key: "phone_e164", label: "Phone" },
    { key: "partner_enabled", label: "Partner" },
    { key: "partner_country", label: "Partner country" },
    { key: "deleted_at", label: "Deleted at" },
    { key: "created_at", label: "Created at" },
  ],
  filename: "accounts",
};

// ── Hash helpers ──────────────────────────────────────────────────────────────

function userIdFromHash() {
  const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
  return params.get("userId");
}

// ── Person detail section builders ────────────────────────────────────────────

function field(label, value, render) {
  return { label, value, render };
}

/** A muted "None" cell for empty sub-lists (never a fabricated 0/row). */
const noneField = (label) => field(label, "None", (v) => <span className="text-[var(--color-text-muted)]">{v}</span>);

function buildPersonSections(bundle, onOpenBrand) {
  const person = bundle.person || {};
  const account = bundle.account || null;
  const brandsOwned = Array.isArray(bundle.brands_owned) ? bundle.brands_owned : [];
  const brandsMember = Array.isArray(bundle.brands_member) ? bundle.brands_member : [];
  const subscription = bundle.subscription || {};
  const override = bundle.active_override || null;
  const tickets = Array.isArray(bundle.tickets) ? bundle.tickets : [];

  const brandNameById = {};
  for (const b of brandsOwned) brandNameById[b.id] = b.name;

  const sections = [];

  // Consumer profile
  sections.push({
    label: "Consumer profile",
    fields: [
      field("Email", person.email),
      field("Username", person.username),
      field("First name", person.first_name),
      field("Last name", person.last_name),
      field("Phone", person.phone),
      field("Country", person.country),
      field("Currency", person.currency),
      field("Visibility", person.visibility_mode),
      field("Onboarded", null, () => (
        <Badge variant={person.has_completed_onboarding ? "success" : "warning"} dot>
          {person.has_completed_onboarding ? "Complete" : "Incomplete"}
        </Badge>
      )),
      field("Beta tester", null, () => (person.is_beta_tester ? <Badge variant="info">Beta</Badge> : "No")),
      field("Created", person.created_at, (v) => formatDate(v)),
    ],
  });

  // Business account
  if (account) {
    sections.push({
      label: "Business account",
      fields: [
        field("Business name", account.business_name),
        field("Email", account.email),
        field("Phone", account.phone_e164),
        field("Partner", null, () =>
          account.partner_enabled ? (
            <Badge variant="success" dot>
              Partner{account.partner_country ? ` · ${account.partner_country}` : ""}
            </Badge>
          ) : (
            "No"
          ),
        ),
        field("Default brand", account.default_brand_id ? brandNameById[account.default_brand_id] || account.default_brand_id : null),
        field("Marketing opt-in", null, () => (account.marketing_opt_in ? "Yes" : "No")),
        field("Deleted", null, () =>
          account.deleted_at ? <Badge variant="error">Deleted {formatDate(account.deleted_at)}</Badge> : "Active",
        ),
        field("Created", account.created_at, (v) => formatDate(v)),
      ],
    });
  } else {
    sections.push({
      label: "Business account",
      fields: [
        field("", "No business account — consumer-only user.", (v) => (
          <span className="text-[var(--color-text-muted)]">{v}</span>
        )),
      ],
    });
  }

  // Brands owned
  sections.push({
    label: `Brands owned (${brandsOwned.length})`,
    fields:
      brandsOwned.length === 0
        ? [noneField("Brands owned")]
        : brandsOwned.map((b) =>
            field(b.name || b.slug || b.id, b, (brand) => (
              <button
                type="button"
                onClick={() => onOpenBrand(brand.id)}
                className="flex flex-wrap items-center gap-1.5 text-left cursor-pointer hover:opacity-80"
              >
                {brand.kind && <Badge variant="outline">{brand.kind}</Badge>}
                {brand.claim_status && (
                  <Badge variant={CLAIM_VARIANT[brand.claim_status] || "default"}>{brand.claim_status}</Badge>
                )}
                {brand.pricing_currency && <Badge variant="default">{brand.pricing_currency}</Badge>}
                {brand.deleted_at && <Badge variant="error">Deleted</Badge>}
                <span className="text-xs text-[var(--color-brand-500)] underline">Open</span>
              </button>
            )),
          ),
  });

  // Brands member of
  sections.push({
    label: `Brands member of (${brandsMember.length})`,
    fields:
      brandsMember.length === 0
        ? [noneField("Memberships")]
        : brandsMember.map((m) =>
            field(m.brand_name || m.brand_id, m, (mem) => (
              <span className={`flex flex-wrap items-center gap-1.5 ${mem.removed_at ? "opacity-50" : ""}`}>
                <Badge variant={ROLE_VARIANT[mem.role] || "default"}>{mem.role}</Badge>
                {mem.accepted_at && (
                  <span className="text-xs text-[var(--color-text-tertiary)]">joined {formatDate(mem.accepted_at)}</span>
                )}
                {mem.removed_at && <Badge variant="error">removed</Badge>}
              </span>
            )),
          ),
  });

  // Subscription
  const rawTier = subscription.raw?.tier;
  const subFields = [
    field("Effective tier", null, () => (
      <Badge variant={subscription.effective_tier === "mingla_plus" ? "brand" : "default"}>
        {tierLabel(subscription.effective_tier)}
      </Badge>
    )),
    field("Raw tier", rawTier ? tierLabel(rawTier) : "free"),
  ];
  if (subscription.raw?.current_period_end) {
    subFields.push(field("Period ends", subscription.raw.current_period_end, (v) => formatDateTime(v)));
  }
  if (subscription.raw?.trial_end) {
    subFields.push(field("Trial ends", subscription.raw.trial_end, (v) => formatDateTime(v)));
  }
  if (override) {
    subFields.push(
      field("Override tier", null, () => <Badge variant="warning">{tierLabel(override.tier)}</Badge>),
      field("Override reason", override.reason),
      field("Override expires", override.expires_at, (v) => formatDateTime(v)),
    );
  }
  sections.push({ label: "Subscription", fields: subFields });

  // Support tickets
  sections.push({
    label: `Support tickets (${tickets.length})`,
    fields:
      tickets.length === 0
        ? [noneField("Support tickets")]
        : tickets.map((t) =>
            field(t.subject || t.id, t, (tk) => (
              <a
                href="#/support"
                className="flex flex-wrap items-center gap-1.5 hover:opacity-80"
              >
                <Badge variant={TICKET_VARIANT[tk.status] || "default"}>{tk.status}</Badge>
                {tk.priority && <Badge variant="outline">{tk.priority}</Badge>}
                {tk.brand_id && brandNameById[tk.brand_id] && (
                  <span className="text-xs text-[var(--color-text-tertiary)]">{brandNameById[tk.brand_id]}</span>
                )}
                <span className="text-xs text-[var(--color-text-tertiary)]">{timeAgo(tk.last_message_at || tk.created_at)}</span>
              </a>
            )),
          ),
  });

  return sections;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PeopleConsolePage() {
  const [selectedUserId, setSelectedUserId] = useState(() => userIdFromHash());
  const [bundle, setBundle] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Sync the selected user from the hash (?userId=) — supports cross-page
  // deep-links (Wave-2 links from UserManagementPage, brand-owner links) while
  // already mounted on this tab.
  useEffect(() => {
    const sync = () => setSelectedUserId(userIdFromHash());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const loadPerson = useCallback(async (userId) => {
    setLoading(true);
    setError(null);
    setBundle(null);
    try {
      const { data, error: err } = await getPerson(userId);
      if (err) {
        const msg = err.message || "";
        if (msg.includes("not_authorized")) setError("You are not authorized to view this person.");
        else if (msg.includes("not_found")) setError("No user found for this ID.");
        else setError(msg || "Failed to load this person.");
        return;
      }
      setBundle(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedUserId) loadPerson(selectedUserId);
  }, [selectedUserId, loadPerson]);

  const openUser = useCallback((userId) => {
    window.location.hash = `#/business-people?userId=${userId}`;
    setSelectedUserId(userId);
  }, []);

  const openBrand = useCallback((brandId) => {
    window.location.hash = `#/business-brands?brandId=${brandId}`;
  }, []);

  const backToList = useCallback(() => {
    window.location.hash = "#/business-people";
    setSelectedUserId(null);
    setBundle(null);
    setError(null);
  }, []);

  // ── Person detail view ──────────────────────────────────────────────────────
  if (selectedUserId) {
    const person = bundle?.person || {};
    const account = bundle?.account || null;
    const title = person.display_name || account?.business_name || person.email || "Person";
    const badges = [];
    if (person.segment) badges.push({ label: person.segment, variant: SEGMENT_VARIANT[person.segment] || "default" });
    badges.push(
      person.active === false
        ? { label: "Banned", variant: "error" }
        : { label: "Active", variant: "success" },
    );
    badges.push(
      account
        ? { label: "Business", variant: "info" }
        : { label: "Consumer-only", variant: "default" },
    );
    if (account?.deleted_at) badges.push({ label: "Account deleted", variant: "error" });

    return (
      <div className="py-8">
        <EntityDetailView
          loading={loading}
          error={error}
          onRetry={() => loadPerson(selectedUserId)}
          header={{
            title,
            subtitle: bundle ? <span className="font-mono">{selectedUserId}</span> : undefined,
            badges: bundle ? badges : [],
            backLabel: "People",
            onBack: backToList,
          }}
          sections={bundle ? buildPersonSections(bundle, openBrand) : []}
        />
      </div>
    );
  }

  // ── Accounts list view ──────────────────────────────────────────────────────
  return (
    <div className="py-8 flex flex-col gap-6">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-full bg-[var(--color-brand-50)] flex items-center justify-center shrink-0">
          <Users className="w-5 h-5 text-[var(--color-brand-500)]" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">People</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
            Business accounts. Open one for the unified person view — consumer profile, business account,
            brands, subscription, and support tickets.
          </p>
        </div>
      </div>

      <EntityListView
        title="Business accounts"
        columns={COLUMNS}
        fetchPage={listAccounts}
        searchPlaceholder="Search business, name, email, or phone…"
        filters={FILTERS}
        onRowClick={(row) => openUser(row.id)}
        csv={CSV}
        emptyMessage="No business accounts match."
        emptyIcon={Building2}
      />
    </div>
  );
}

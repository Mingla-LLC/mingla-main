// ORCH-1274 [Admin Money console — READ-ONLY] — Payments (per-brand Stripe
// Connect status) console.
//
// Cross-brand list of every brand with a payment provider → a per-brand Connect
// detail: derived status, charges/payouts, requirements-driven next steps,
// external bank accounts, and the Paystack-vs-Stripe provider. READ-ONLY: no
// Stripe API call (schema/webhook-synced data only). The "Refresh from Stripe" /
// "Generate onboarding link" actions are rendered DISABLED with a WAVE-2 tag —
// they ride the ORCH-1271 admin-write-primitive in a later wave (SPEC §9).

import { useState, useEffect, useCallback } from "react";
import { CreditCard } from "lucide-react";
import { EntityListView } from "../components/entity/EntityListView";
import { EntityDetailView } from "../components/entity/EntityDetailView";
import { HighRiskActionModal } from "../components/entity/HighRiskActionModal";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { AlertCard } from "../components/ui/Card";
import { listBrandStripeStatus, getBrandStripeStatus } from "../services/adminMoneyService";
import { connectAction } from "../services/adminMoneyActService";
import { formatDateTime } from "../lib/formatters";

// Map admin-stripe-connect-action edge-fn error codes → user-facing copy.
function connectErrorCopy(code) {
  switch (code) {
    case "no_connect_account": return "This brand has no Stripe account — the brand must onboard first.";
    case "stripe_api_error": return "Stripe request failed — try again in a moment.";
    case "forbidden": return "Admin access required.";
    case "unauthorized": return "Your session expired — sign in again.";
    case "validation_error": return "Invalid request.";
    default: return null;
  }
}

async function parseEdgeError(error) {
  let code = null;
  let detail = null;
  try {
    const b = await error.context?.json();
    code = b?.error;
    detail = b?.detail;
  } catch {
    // non-JSON error body — fall through to the caller's fallback.
  }
  return { code, detail };
}

// ── Maps ──────────────────────────────────────────────────────────────────────

const STATUS_VARIANT = {
  active: "success",
  onboarding: "warning",
  restricted: "error",
  not_connected: "default",
};
const PROVIDER_VARIANT = { stripe: "info", paystack: "brand", none: "default" };

function statusBadge(status) {
  return <Badge variant={STATUS_VARIANT[status] || "default"} dot>{status || "unknown"}</Badge>;
}
function providerBadge(provider) {
  return <Badge variant={PROVIDER_VARIANT[provider] || "default"}>{provider || "none"}</Badge>;
}
function boolMark(v) {
  return v ? <span className="text-[#22c55e] font-semibold">✓</span> : <span className="text-[var(--color-text-muted)]">✗</span>;
}

// ── List columns / filters / csv ──────────────────────────────────────────────

const COLUMNS = [
  {
    key: "brand_name",
    label: "Brand",
    render: (val, row) => (
      <div className="min-w-0">
        <span className="font-medium text-[var(--color-text-primary)] block truncate">{val || "—"}</span>
        {row.brand_slug && <span className="text-xs text-[var(--color-text-muted)] block truncate">/{row.brand_slug}</span>}
      </div>
    ),
  },
  { key: "provider", label: "Provider", render: (val) => providerBadge(val) },
  { key: "derived_status", label: "Status", render: (val) => statusBadge(val) },
  { key: "charges_enabled", label: "Charges", render: (val) => boolMark(val) },
  { key: "payouts_enabled", label: "Payouts", render: (val) => boolMark(val) },
  { key: "country", label: "Country", render: (val) => val || <span className="text-[var(--color-text-muted)]">—</span> },
  { key: "default_currency", label: "Currency", render: (val) => val || <span className="text-[var(--color-text-muted)]">—</span> },
  {
    key: "disabled_reason",
    label: "Blocked by",
    render: (val) =>
      val ? <span className="text-xs text-[#b91c1c]">{val}</span> : <span className="text-[var(--color-text-muted)]">—</span>,
  },
];

const FILTERS = [
  {
    key: "status",
    label: "Status",
    options: [
      { value: "active", label: "Active" },
      { value: "onboarding", label: "Onboarding" },
      { value: "restricted", label: "Restricted" },
      { value: "not_connected", label: "Not connected" },
    ],
  },
  {
    key: "provider",
    label: "Provider",
    options: [
      { value: "stripe", label: "Stripe" },
      { value: "paystack", label: "Paystack" },
      { value: "none", label: "None" },
    ],
  },
];

const CSV = {
  columns: [
    { key: "brand_name", label: "Brand" },
    { key: "brand_slug", label: "Slug" },
    { key: "provider", label: "Provider" },
    { key: "derived_status", label: "Status" },
    { key: "charges_enabled", label: "Charges enabled" },
    { key: "payouts_enabled", label: "Payouts enabled" },
    { key: "country", label: "Country" },
    { key: "default_currency", label: "Currency" },
    { key: "disabled_reason", label: "Blocked by" },
    { key: "stripe_connect_id", label: "Stripe account id" },
  ],
  filename: "brand-payment-status",
};

// ── Hash helpers ──────────────────────────────────────────────────────────────

function brandIdFromHash() {
  const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
  return params.get("brandId");
}

// ── Next-steps renderer (client-side, pure — §4.5) ────────────────────────────

function reqList(requirements, key) {
  const v = requirements?.[key];
  return Array.isArray(v) ? v.filter(Boolean) : [];
}

function NextSteps({ requirements, chargesEnabled }) {
  const disabledReason = requirements?.disabled_reason || null;
  const pastDue = reqList(requirements, "past_due");
  const currentlyDue = reqList(requirements, "currently_due");
  const eventuallyDue = reqList(requirements, "eventually_due");
  const pendingVerification = reqList(requirements, "pending_verification");
  const nothingOutstanding =
    !disabledReason && pastDue.length === 0 && currentlyDue.length === 0 &&
    eventuallyDue.length === 0 && pendingVerification.length === 0;

  if (nothingOutstanding && chargesEnabled) {
    return (
      <AlertCard variant="success" title="Fully onboarded — no outstanding requirements" />
    );
  }

  const groups = [
    { label: "Past due", items: pastDue, className: "text-[#b91c1c]" },
    { label: "Currently due", items: currentlyDue, className: "text-[#b45309]" },
    { label: "Pending verification", items: pendingVerification, className: "text-[#1d4ed8]" },
    { label: "Eventually due", items: eventuallyDue, className: "text-[var(--color-text-tertiary)]" },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-3">
      {disabledReason && (
        <AlertCard variant="error" title="Charges disabled">
          {disabledReason}
        </AlertCard>
      )}
      {groups.length === 0 && !disabledReason ? (
        <p className="text-sm text-[var(--color-text-muted)]">No requirement details on file.</p>
      ) : (
        groups.map((g) => (
          <div key={g.label}>
            <p className={`text-xs font-semibold uppercase tracking-wide ${g.className}`}>{g.label}</p>
            <ul className="mt-1 list-disc pl-5 flex flex-col gap-0.5">
              {g.items.map((item) => (
                <li key={item} className="text-sm text-[var(--color-text-primary)] break-words">{item}</li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}

// ── Detail section builders ───────────────────────────────────────────────────

function field(label, value, render) {
  return { label, value, render };
}

function buildSections(detail) {
  const brand = detail.brand || {};
  const account = detail.account || null;
  const externals = Array.isArray(detail.external_accounts) ? detail.external_accounts : [];
  const provider = detail.provider || "none";

  const sections = [
    {
      label: "Status",
      fields: [
        field("Derived status", null, () => statusBadge(detail.status)),
        field("Provider", null, () => providerBadge(provider)),
        field("Charges enabled", null, () => boolMark(account?.charges_enabled)),
        field("Payouts enabled", null, () => boolMark(account?.payouts_enabled)),
        field("Country", account?.country),
        field("Currency", account?.default_currency || brand.default_currency),
        field("Dashboard type", account?.controller_dashboard_type),
        field("Detached at", account?.detached_at, (v) => formatDateTime(v)),
        field("Stripe account id", account?.stripe_account_id || brand.stripe_connect_id, (v) => (
          <span className="font-mono text-xs break-all">{v}</span>
        )),
      ],
    },
    {
      label: "Requirements / next steps",
      fields: [
        field("", null, () => (
          <NextSteps requirements={detail.requirements} chargesEnabled={account?.charges_enabled} />
        )),
      ],
    },
    {
      label: `Bank / external accounts (${externals.length})`,
      fields:
        externals.length === 0
          ? [field("", "No external accounts on file", (v) => <span className="text-[var(--color-text-muted)]">{v}</span>)]
          : externals.map((ea) =>
              field(`${ea.type || "account"} ••••${ea.last4 || ""}`, ea, (a) => (
                <span className="flex flex-wrap items-center gap-1.5">
                  {a.currency && <Badge variant="default">{a.currency}</Badge>}
                  {a.status && <Badge variant={a.status === "verified" ? "success" : "warning"}>{a.status}</Badge>}
                  {a.default_for_currency && <Badge variant="info">default</Badge>}
                  {a.country && <span className="text-xs text-[var(--color-text-tertiary)]">{a.country}</span>}
                </span>
              )),
            ),
    },
  ];

  if (provider === "paystack") {
    sections.push({
      label: "Paystack",
      fields: [
        field("Subaccount code", brand.paystack_subaccount_code, (v) => <span className="font-mono text-xs break-all">{v}</span>),
      ],
    });
  }

  return sections;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BusinessPaymentsPage() {
  const [selectedBrandId, setSelectedBrandId] = useState(() => brandIdFromHash());
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [actionMode, setActionMode] = useState(null); // null | 'refresh' | 'onboarding_link'
  const [onboardingUrl, setOnboardingUrl] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const sync = () => setSelectedBrandId(brandIdFromHash());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  // Clear the generated link whenever the viewed brand changes.
  useEffect(() => {
    setOnboardingUrl(null);
    setCopied(false);
  }, [selectedBrandId]);

  const runConnectAction = useCallback(async ({ reason }) => {
    const { data, error: err } = await connectAction({ brand_id: selectedBrandId, mode: actionMode, reason });
    if (err) {
      const { code, detail } = await parseEdgeError(err);
      throw new Error(connectErrorCopy(code) || detail || err.message || "Action failed.");
    }
    if (actionMode === "onboarding_link") {
      setOnboardingUrl(data?.onboarding_url || null);
      setCopied(false);
    } else {
      loadDetail(selectedBrandId);
    }
  }, [selectedBrandId, actionMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadDetail = useCallback(async (brandId) => {
    setLoading(true);
    setError(null);
    setDetail(null);
    try {
      const { data, error: err } = await getBrandStripeStatus(brandId);
      if (err) {
        const msg = err.message || "";
        if (msg.includes("not_authorized")) setError("You are not authorized to view this brand's payments.");
        else if (msg.includes("not_found")) setError("No brand found for this ID.");
        else setError(msg || "Failed to load payment status.");
      } else {
        setDetail(data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedBrandId) loadDetail(selectedBrandId);
  }, [selectedBrandId, loadDetail]);

  const openBrand = useCallback((brandId) => {
    window.location.hash = `#/business-payments?brandId=${brandId}`;
    setSelectedBrandId(brandId);
  }, []);

  const backToList = useCallback(() => {
    window.location.hash = "#/business-payments";
    setSelectedBrandId(null);
    setDetail(null);
    setError(null);
  }, []);

  // ── Detail view ───────────────────────────────────────────────────────────
  if (selectedBrandId) {
    const brand = detail?.brand || {};
    const badges = [];
    if (detail) {
      badges.push({ label: detail.status || "unknown", variant: STATUS_VARIANT[detail.status] || "default" });
      badges.push({ label: detail.provider || "none", variant: PROVIDER_VARIANT[detail.provider] || "default" });
    }

    return (
      <div className="py-8">
        <EntityDetailView
          loading={loading}
          error={error}
          onRetry={() => loadDetail(selectedBrandId)}
          header={{
            title: brand.name || "Brand payments",
            subtitle: detail ? <span className="font-mono">{brand.slug ? `/${brand.slug}` : selectedBrandId}</span> : undefined,
            badges: detail ? badges : [],
            backLabel: "Payments",
            onBack: backToList,
          }}
          sections={detail ? buildSections(detail) : []}
        />
        {detail && (
          <div className="mt-4 flex flex-col gap-3 border-t border-[var(--gray-200)] pt-4">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="secondary" size="md" onClick={() => setActionMode("refresh")}>
                Refresh from Stripe
              </Button>
              <Button variant="secondary" size="md" onClick={() => setActionMode("onboarding_link")}>
                Generate onboarding link
              </Button>
            </div>
            {onboardingUrl && (
              <div className="flex flex-col gap-1.5 rounded-lg border border-[var(--gray-200)] bg-[var(--gray-50)] p-3">
                <span className="text-xs font-medium text-[var(--color-text-secondary)]">
                  Onboarding link (send to the brand out-of-band)
                </span>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={onboardingUrl}
                    readOnly
                    className="flex-1 h-9 px-2 text-xs font-mono rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] text-[var(--color-text-primary)] outline-none"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(onboardingUrl);
                        setCopied(true);
                      } catch {
                        setCopied(false);
                      }
                    }}
                  >
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
        <HighRiskActionModal
          open={actionMode != null}
          onClose={() => setActionMode(null)}
          title={actionMode === "onboarding_link" ? "Generate onboarding link" : "Refresh from Stripe"}
          description={
            actionMode === "onboarding_link"
              ? "Mints a fresh Stripe onboarding link for this brand's existing account. No money moves."
              : "Pulls this brand's live Connect status from Stripe and updates the record. No money moves."
          }
          confirmLabel={actionMode === "onboarding_link" ? "Generate link" : "Refresh"}
          onConfirm={runConnectAction}
          successMessage={actionMode === "onboarding_link" ? "Onboarding link generated." : "Status refreshed from Stripe."}
        />
      </div>
    );
  }

  // ── List view ─────────────────────────────────────────────────────────────
  return (
    <div className="py-8 flex flex-col gap-6">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-full bg-[var(--color-brand-50)] flex items-center justify-center shrink-0">
          <CreditCard className="w-5 h-5 text-[var(--color-brand-500)]" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Payments</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
            Every brand's payout readiness — Stripe Connect or Paystack status, what's blocking KYC, and the
            bank accounts on file. Read-only.
          </p>
        </div>
      </div>

      <EntityListView
        title="Payment providers"
        columns={COLUMNS}
        fetchPage={listBrandStripeStatus}
        searchPlaceholder="Search brand, slug, or acct id"
        filters={FILTERS}
        onRowClick={(row) => openBrand(row.brand_id)}
        csv={CSV}
        emptyMessage="No brands with a payment provider yet."
        emptyIcon={CreditCard}
        rowKey={(row) => row.brand_id}
      />
    </div>
  );
}

// Issue #4130 (Wave 3) — Brands: every host brand, with its team, money setup,
// venue, website and offerings in one place.
//
//   - KPI row from admin_brands_summary (deleted and staff/test brands left out).
//   - The list (admin_list_brands_board): owner's real name, payment readiness
//     for Stripe AND Paystack, live offerings, followers. Deleted and staff/test
//     brands are hidden unless "Include deleted and test" is picked. The Mingla
//     fee column shows only when a brand on screen has its own rate.
//   - A row opens the brand drawer (Team, Money, Offerings, Venue, Website).
//   - Brand Sites, Venues and Venue claims are folded in: the drawer links to
//     them, and their old addresses still open them here
//     (#/brand-sites -> #/brands?tab=websites, #/business-venues -> tab=venues,
//     #/claims -> tab=claims), each with a way back to Brands.
//   - #/brands?brandId=<id> opens the drawer; #/brands?view=record&brandId=<id>
//     is the full record (edit, owner, team roles, delete).
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Building2 } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { Badge } from "../components/ui/Badge";
import { LoadError } from "../components/ui/LoadError";
import { StatTileSkeleton } from "../components/crm/home/StatTile";
import { EntityListView } from "../components/entity/EntityListView";
import { BrandDrawer } from "../components/brands/BrandDrawer";
import { HostedPageContext } from "../components/layout/hostedPageContext";
import { BrandsConsolePage } from "./BrandsConsolePage";
import { BrandSitesPage } from "./BrandSitesPage";
import { VenuesConsolePage } from "./VenuesConsolePage";
import { ClaimsPage } from "./ClaimsPage";
import { getBrandsSummary, listBrandsBoard } from "../services/identityReadService";
import { brandToolFor, feeOverrideLabel, hasFeeOverride, paymentReadiness } from "../lib/peopleSegments";
import { READINESS_LABEL } from "../lib/paymentReadiness";
import { formatDate } from "../lib/formatters";

const TOOL_COMPONENTS = { "brand-sites": BrandSitesPage, "business-venues": VenuesConsolePage, claims: ClaimsPage };

function readHash() {
  const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
  return { tab: params.get("tab"), brandId: params.get("brandId"), view: params.get("view") };
}

function setBrandInHash(brandId) {
  window.location.hash = brandId ? `#/brands?brandId=${encodeURIComponent(brandId)}` : "#/brands";
}

const muted = (text) => <span className="text-[var(--color-text-muted)]">{text}</span>;

const BASE_COLUMNS = [
  {
    key: "name",
    label: "Brand",
    sortable: true,
    render: (v, row) => (
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="truncate font-medium text-[var(--color-text-primary)]">{v || "Unnamed brand"}</span>
        {row.deleted_at && <Badge variant="error">Deleted</Badge>}
        {row.internal && <Badge variant="default">Staff or test</Badge>}
        {row.claim_status === "suspended" && <Badge variant="error">Suspended</Badge>}
      </span>
    ),
  },
  { key: "owner_name", label: "Owner", render: (v) => v || muted("No owner") },
  {
    key: "country_code",
    label: "Country · currency",
    render: (v, row) => [v, row.default_currency].filter(Boolean).join(" · ") || muted("Not set"),
  },
  {
    key: "payment_readiness",
    label: "Payments",
    render: (v) => {
      const r = paymentReadiness(v);
      return r ? <Badge variant={r.variant}>{r.label}</Badge> : muted("–");
    },
  },
  { key: "live_offerings", label: "Live offerings", sortable: true, render: (v) => <span className="tabular-nums">{Number(v || 0).toLocaleString()}</span> },
  { key: "followers", label: "Followers", sortable: true, render: (v) => <span className="tabular-nums">{Number(v || 0).toLocaleString()}</span> },
  { key: "created_at", label: "Created", sortable: true, render: (v) => formatDate(v) },
];

const FEE_COLUMN = { key: "take_rate_bps_override", label: "Mingla fee", render: (v) => feeOverrideLabel(v) || muted("Default") };

const FILTERS = [
  {
    key: "payments",
    label: "Any payment setup",
    options: [
      // #4130 (integration): the Payments page's readiness words (Wave 2a).
      { value: "ready", label: READINESS_LABEL.ready },
      { value: "needs_action", label: READINESS_LABEL.needs_action },
      { value: "no_setup", label: READINESS_LABEL.no_setup },
    ],
  },
  { key: "show", label: "Live brands only", options: [{ value: "all", label: "Include deleted and test" }] },
];

const CSV = {
  columns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Brand" },
    { key: "owner_name", label: "Owner" },
    { key: "owner_email", label: "Owner email" },
    { key: "country_code", label: "Country" },
    { key: "default_currency", label: "Currency" },
    { key: "payment_readiness", label: "Payments" },
    { key: "live_offerings", label: "Live offerings" },
    { key: "followers", label: "Followers" },
    { key: "take_rate_bps_override", label: "Custom fee (basis points)" },
    { key: "created_at", label: "Created" },
    { key: "deleted_at", label: "Deleted" },
    { key: "internal", label: "Staff or test" },
  ],
  filename: "brands",
};

function Kpi({ value, label, note, href }) {
  const body = (
    <>
      <span className="text-[28px] font-bold leading-tight tabular-nums text-[var(--color-text-primary)]">{value}</span>
      <span className="text-[13px] text-[var(--color-text-secondary)]">{label}</span>
      {note ? <span className="mt-1 text-xs text-[var(--color-text-tertiary)]">{note}</span> : null}
    </>
  );
  const cls =
    "flex min-h-[92px] min-w-0 flex-col justify-center rounded-xl border border-[var(--gray-200)] border-l-[3px] border-l-[var(--color-brand-500)] bg-[var(--color-background-primary)] p-4 no-underline";
  return href ? <a href={href} className={`${cls} hover:shadow-[var(--shadow-md)]`}>{body}</a> : <div className={cls}>{body}</div>;
}

function BrandTool({ tool, tab }) {
  const Hosted = TOOL_COMPONENTS[tool.hosts];
  const alias = useMemo(() => ({ page: "brands", tab, hosts: tool.hosts }), [tab, tool.hosts]);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <a href="#/brands" className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-brand-600)] underline-offset-2 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to Brands
      </a>
      <HostedPageContext.Provider value={alias}>
        <Hosted />
      </HostedPageContext.Provider>
    </div>
  );
}

export function BrandsPage() {
  const [route, setRoute] = useState(readHash);
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [showFee, setShowFee] = useState(false);
  const [listVersion, setListVersion] = useState(0);
  // The row the drawer was opened from (owner name, readiness, staff/test).
  const [openRow, setOpenRow] = useState(null);

  useEffect(() => {
    const sync = () => setRoute(readHash());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      setSummary(await getBrandsSummary());
    } catch (err) {
      setSummary(null);
      setSummaryError(err?.message || "Couldn't load the brand counts.");
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load on open, like the other admin pages
    loadSummary();
  }, [loadSummary]);

  const fetchPage = useCallback(
    async (query) => {
      const result = await listBrandsBoard(query);
      setShowFee(hasFeeOverride(result.rows));
      return result;
    },
    // listVersion: a write in the drawer reloads the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [listVersion]
  );

  const columns = useMemo(
    () => (showFee ? [...BASE_COLUMNS.slice(0, 4), FEE_COLUMN, ...BASE_COLUMNS.slice(4)] : BASE_COLUMNS),
    [showFee]
  );

  const tool = brandToolFor(route.tab);
  if (route.view === "record" && route.brandId) return <BrandsConsolePage />;
  if (tool) return <BrandTool tool={tool} tab={route.tab} />;

  const n = (key) => Number(summary?.[key] ?? 0).toLocaleString();

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader title="Brands" description="Every host brand, with its team, money setup, venue, website and offerings in one place." />

      {summaryError ? (
        <LoadError title="Couldn't load the brand counts" message={summaryError} onRetry={loadSummary} retrying={summaryLoading} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" role="group" aria-label="Brands at a glance">
          {summaryLoading || !summary ? (
            [0, 1, 2, 3].map((i) => <StatTileSkeleton key={i} />)
          ) : (
            <>
              <Kpi value={n("live_brands")} label="Live brands" note={`${n("hidden_brands")} deleted or staff/test hidden`} />
              <Kpi value={n("ready_to_get_paid")} label="Ready to get paid" />
              <Kpi value={n("with_live_public_offering")} label="With a live public offering" />
              <Kpi value={n("venue_claims_waiting")} label="Venue claims waiting" href="#/brands?tab=claims" />
            </>
          )}
        </div>
      )}

      <EntityListView
        columns={columns}
        fetchPage={fetchPage}
        serverSort
        searchPlaceholder="Brand, city, owner or email"
        filters={FILTERS}
        onRowClick={(row) => {
          setOpenRow(row);
          setBrandInHash(row.id);
        }}
        csv={CSV}
        emptyMessage="No brands match. Brands hosts create in the Business app appear here."
        emptyIcon={Building2}
      />

      <BrandDrawer
        key={route.brandId || "none"}
        brandId={route.brandId}
        row={openRow && openRow.id === route.brandId ? openRow : null}
        onClose={() => setBrandInHash(null)}
        onChanged={() => {
          loadSummary();
          setListVersion((v) => v + 1);
        }}
      />
    </div>
  );
}

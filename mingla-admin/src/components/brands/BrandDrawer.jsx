// Issue #4130 (Wave 3) — one brand, in a drawer over the Brands list.
//
// Tabs: Team, Money, Offerings, Venue, Website (the approved design). Brand
// Sites, Venues and Venue claims now live inside the brand: each tab shows this
// brand's part in plain words and links to the full tool when there is more to
// do. Each tab loads on first open; a failed load is a LoadError with Retry.
//
// Writes (each behind a reason, audited on the server): pause / resume payouts,
// suspend / unsuspend. Everything else (edit details, change owner, team roles,
// delete) is in the full record.
import { useCallback, useEffect, useState } from "react";
import { Drawer } from "../ui/Drawer";
import { Tabs } from "../ui/Tabs";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Skeleton } from "../ui/Skeleton";
import { LoadError } from "../ui/LoadError";
import { HighRiskActionModal } from "../entity/HighRiskActionModal";
import { getBrandDetail, listBrandsBoard } from "../../services/identityReadService";
import { setBrandClaimStatus, setBrandPayoutsPaused, mapWriteError } from "../../services/identityWriteService";
import { getBrandPayoutConsole } from "../../services/adminMoneyService";
import { listOfferingsBoard } from "../../services/offeringsService";
import { listVenues } from "../../services/venuesService";
import { getBrandSiteDetail, listBrandSites } from "../../services/brandSitesAdminService";
import {
  brandRoleLabel,
  feeOverrideLabel,
  offeringState,
  paymentReadiness,
  soldOrGoing,
} from "../../lib/peopleSegments";
import { formatDate, formatDateTime, timeAgo } from "../../lib/formatters";
import { formatMoneyMinor } from "../../lib/moneyFormat";

const TABS = [
  { id: "team", label: "Team" },
  { id: "money", label: "Money" },
  { id: "offerings", label: "Offerings" },
  { id: "venue", label: "Venue" },
  { id: "website", label: "Website" },
];

const CLAIM_STATUS = {
  pending_review: { label: "Claim waiting for review", variant: "warning" },
  verified: { label: "Verified", variant: "success" },
  rejected: { label: "Claim rejected", variant: "error" },
  suspended: { label: "Suspended", variant: "error" },
  revoked: { label: "Revoked", variant: "error" },
};

const SITE_STATUS = {
  provisioning: "Being set up",
  draft: "Not published yet",
  publishing: "Publishing now",
  published: "Live",
  error: "Needs attention",
  suspended: "Suspended",
};

const muted = (text) => <span className="text-[var(--color-text-muted)]">{text}</span>;

function KV({ rows }) {
  return (
    <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-4 gap-y-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-[var(--color-text-secondary)]">{label}</dt>
          <dd className="min-w-0 break-words tabular-nums text-[var(--color-text-primary)]">
            {value === null || value === undefined || value === "" ? muted("Not recorded") : value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Loading() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <Skeleton height={18} width="70%" />
      <Skeleton height={18} width="55%" />
      <Skeleton height={18} width="60%" />
    </div>
  );
}

/** Loads one tab's data the first time it is opened; Retry on failure. */
function useTabLoad(active, loader) {
  const [state, setState] = useState({ loading: false, error: null, data: null, loaded: false });
  const run = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await loader();
      setState({ loading: false, error: null, data, loaded: true });
    } catch (err) {
      setState({ loading: false, error: err?.message || "Couldn't load this.", data: null, loaded: true });
    }
  }, [loader]);
  useEffect(() => {
    if (active && !state.loaded && !state.loading) run();
  }, [active, state.loaded, state.loading, run]);
  return { ...state, reload: run };
}

function daysWaiting(since) {
  if (!since) return null;
  const days = Math.floor((Date.now() - new Date(since).getTime()) / 86400000);
  return Number.isFinite(days) ? days : null;
}

export function BrandDrawer({ brandId, row: rowFromList, onClose, onChanged }) {
  const [tab, setTab] = useState("team");
  // Opened from a link (no list row): read this brand's board row by id.
  const [rowFromServer, setRowFromServer] = useState(null);
  useEffect(() => {
    if (!brandId || rowFromList) return undefined;
    let alive = true;
    listBrandsBoard({ search: brandId, filters: { show: "all" }, page: 0, pageSize: 1 })
      .then((res) => {
        if (alive) setRowFromServer(res.rows.find((r) => r.id === brandId) || null);
      })
      .catch((err) => {
        // The header pills and Team owner fall back to the brand record; say why in the console.
        console.warn("[BrandDrawer] brand board row not loaded:", err?.message || err);
      });
    return () => {
      alive = false;
    };
  }, [brandId, rowFromList]);
  const row = rowFromList || rowFromServer;
  const [action, setAction] = useState(null);
  const [detail, setDetail] = useState({ loading: true, error: null, data: null });

  const loadDetail = useCallback(async () => {
    if (!brandId) return;
    setDetail({ loading: true, error: null, data: null });
    try {
      setDetail({ loading: false, error: null, data: await getBrandDetail(brandId) });
    } catch (err) {
      const msg = err?.message || "";
      setDetail({
        loading: false,
        data: null,
        error: msg === "not_found" ? "This brand no longer exists." : msg || "Couldn't load this brand.",
      });
    }
  }, [brandId]);

  useEffect(() => {
    setTab("team");
    loadDetail();
  }, [loadDetail]);

  const moneyLoader = useCallback(async () => {
    const { data, error } = await getBrandPayoutConsole(brandId);
    if (error) throw new Error(error.message || "Couldn't load this brand's money.");
    return data || {};
  }, [brandId]);
  const offeringsLoader = useCallback(
    () => listOfferingsBoard("all", { page: 0, pageSize: 50, filters: { show: "all" } }, brandId),
    [brandId]
  );
  const venueLoader = useCallback(() => listVenues({ filters: { brand_id: brandId }, page: 0, pageSize: 50 }), [brandId]);
  const websiteLoader = useCallback(async () => {
    const sites = await listBrandSites({ search: brandId, page: 0, pageSize: 100 });
    const own = sites.rows.filter((s) => s.brand_id === brandId);
    const details = await Promise.all(own.map((s) => getBrandSiteDetail(s.site_id)));
    return own.map((s, i) => ({ ...s, detail: details[i] }));
  }, [brandId]);

  const money = useTabLoad(tab === "money" && !!brandId, moneyLoader);
  const offerings = useTabLoad(tab === "offerings" && !!brandId, offeringsLoader);
  const venue = useTabLoad(tab === "venue" && !!brandId, venueLoader);
  const website = useTabLoad(tab === "website" && !!brandId, websiteLoader);

  const b = detail.data?.brand || {};
  const readiness = paymentReadiness(row?.payment_readiness);
  const suspended = b.claim_status === "suspended";
  const paused = money.data?.pause?.paused === true;
  const name = b.name || row?.name || "Brand";

  const modal = (() => {
    switch (action) {
      case "pause":
        return { title: "Pause payouts", description: "Money from sales is held until someone resumes payouts.", confirmLabel: "Pause payouts", destructive: true, run: (r) => setBrandPayoutsPaused(brandId, true, r), success: "Payouts paused." };
      case "resume":
        return { title: "Resume payouts", description: "Held money goes out on the normal schedule.", confirmLabel: "Resume payouts", run: (r) => setBrandPayoutsPaused(brandId, false, r), success: "Payouts resumed." };
      case "suspend":
        return { title: "Suspend this brand", description: "The brand can't sell or publish until someone unsuspends it.", confirmLabel: "Suspend", destructive: true, confirmPhrase: "SUSPEND", run: (r) => setBrandClaimStatus(brandId, "suspended", r), success: "Brand suspended." };
      case "unsuspend":
        return { title: "Unsuspend this brand", description: "The brand goes back to verified.", confirmLabel: "Unsuspend", run: (r) => setBrandClaimStatus(brandId, "verified", r), success: "Brand unsuspended." };
      default:
        return null;
    }
  })();

  const header = (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="truncate text-lg font-semibold text-[var(--color-text-primary)]">{name}</p>
      <div className="flex flex-wrap gap-1.5">
        {readiness && <Badge variant={readiness.variant}>{readiness.label}</Badge>}
        {(b.country_code || row?.country_code) && (
          <Badge variant="outline">
            {b.country_code || row?.country_code}
            {(b.default_currency || row?.default_currency) ? ` · ${b.default_currency || row?.default_currency}` : ""}
          </Badge>
        )}
        {b.deleted_at && <Badge variant="error">Deleted</Badge>}
        {row?.internal && <Badge variant="default">Staff or test</Badge>}
        {suspended && <Badge variant="error" dot>Suspended</Badge>}
      </div>
    </div>
  );

  const footer = detail.data ? (
    <div className="flex flex-wrap items-center gap-2">
      {tab === "money" && money.data && (
        <Button variant={paused ? "secondary" : "danger"} size="sm" onClick={() => setAction(paused ? "resume" : "pause")}>
          {paused ? "Resume payouts…" : "Pause payouts…"}
        </Button>
      )}
      <Button variant={suspended ? "secondary" : "danger"} size="sm" onClick={() => setAction(suspended ? "unsuspend" : "suspend")}>
        {suspended ? "Unsuspend…" : "Suspend…"}
      </Button>
      <a
        href={`#/brands?view=record&brandId=${encodeURIComponent(brandId)}`}
        className="ml-auto text-sm font-medium text-[var(--color-brand-600)] underline-offset-2 hover:underline"
      >
        Full record
      </a>
    </div>
  ) : null;

  const team = (detail.data?.team || []).filter((m) => !m.removed_at);
  const pendingInvites = (detail.data?.invites || []).filter((i) => i.status === "pending");

  return (
    <Drawer open={!!brandId} onClose={onClose} title={name} header={header} footer={footer} suspended={!!action}>
      {detail.loading ? (
        <Loading />
      ) : detail.error ? (
        <LoadError title="Couldn't load this brand" message={detail.error} onRetry={loadDetail} />
      ) : (
        <div className="flex flex-col gap-5">
          <Tabs tabs={TABS} activeTab={tab} onChange={setTab} />
          <div role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {tab === "team" && (
              <div className="flex flex-col gap-4">
                <KV
                  rows={[
                    ["Owner", row?.owner_name || detail.data.owner?.business_name || detail.data.owner?.email],
                    ["Owner email", row?.owner_email || detail.data.owner?.email],
                    ["Team members", team.length.toLocaleString()],
                    ["Invites waiting", pendingInvites.length.toLocaleString()],
                  ]}
                />
                {team.length > 0 && (
                  <ul className="flex flex-col gap-2">
                    {team.map((m) => (
                      <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <a href={`#/people?tab=hosts&userId=${encodeURIComponent(m.user_id)}`} className="font-medium text-[var(--color-brand-600)] underline-offset-2 hover:underline">
                          {m.member_name || m.member_email || "Unnamed person"}
                        </a>
                        <span className="flex items-center gap-1.5">
                          <Badge variant="outline">{brandRoleLabel(m.role)}</Badge>
                          {!m.accepted_at && <Badge variant="warning">Not accepted yet</Badge>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {tab === "money" &&
              (money.loading || !money.loaded ? (
                <Loading />
              ) : money.error ? (
                <LoadError title="Couldn't load this brand's money" message={money.error} onRetry={money.reload} />
              ) : (
                <div className="flex flex-col gap-4">
                  <KV
                    rows={[
                      ["Payments", readiness ? readiness.label : null],
                      ["Mingla fee", feeOverrideLabel(b.take_rate_bps_override) || "Default rate"],
                      ["Payouts", paused ? `Paused${money.data.pause?.reason ? `: ${money.data.pause.reason}` : ""}` : "On"],
                      ["Next payout", paused ? "Paused" : money.data.next_payout_at ? formatDateTime(money.data.next_payout_at) : null],
                    ]}
                  />
                  {(money.data.balances || []).length === 0 ? (
                    <p className="text-sm text-[var(--color-text-secondary)]">No payouts yet. Money from this brand's sales will show here by currency.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-[var(--color-text-tertiary)]">
                          <th className="py-1 font-medium">Currency</th>
                          <th className="py-1 text-right font-medium">Paid out to date</th>
                          <th className="py-1 text-right font-medium">Waiting to go out</th>
                          <th className="py-1 text-right font-medium">Held now</th>
                        </tr>
                      </thead>
                      <tbody className="tabular-nums">
                        {money.data.balances.map((bal) => (
                          <tr key={bal.currency} className="border-t border-[var(--gray-200)]">
                            <td className="py-1.5 font-medium">{(bal.currency || "").toUpperCase()}</td>
                            <td className="py-1.5 text-right">{formatMoneyMinor(bal.released_cents, bal.currency)}</td>
                            <td className="py-1.5 text-right">
                              {formatMoneyMinor(Number(bal.pending_net_cents || 0) + Number(bal.in_flight_cents || 0), bal.currency)}
                            </td>
                            <td className="py-1.5 text-right">
                              {formatMoneyMinor(Number(bal.blocked_cents || 0) + Number(bal.admin_paused_cents || 0), bal.currency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ))}

            {tab === "offerings" &&
              (offerings.loading || !offerings.loaded ? (
                <Loading />
              ) : offerings.error ? (
                <LoadError title="Couldn't load this brand's offerings" message={offerings.error} onRetry={offerings.reload} />
              ) : offerings.data.rows.length === 0 ? (
                <p className="text-sm text-[var(--color-text-secondary)]">No offerings yet. Events, experiences, trips and RSVPs this brand creates appear here.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-[var(--gray-200)]">
                  {offerings.data.rows.map((o) => {
                    const st = offeringState(o.state);
                    return (
                      <li key={o.id} className="flex flex-col gap-1 py-2.5">
                        <a href={`#/business-offerings?offeringId=${encodeURIComponent(o.id)}`} className="font-medium text-[var(--color-brand-600)] underline-offset-2 hover:underline">
                          {o.title || "Untitled"}
                        </a>
                        <span className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
                          <Badge variant={st.variant}>{st.label}</Badge>
                          {o.start_at && <span>{formatDate(o.start_at)}</span>}
                          <span>· {soldOrGoing(o)}</span>
                        </span>
                      </li>
                    );
                  })}
                  {offerings.data.total > offerings.data.rows.length && (
                    <li className="py-2.5 text-xs text-[var(--color-text-tertiary)]">
                      Showing the newest {offerings.data.rows.length} of {offerings.data.total}. Search for the brand on the Offerings page to see them all.
                    </li>
                  )}
                </ul>
              ))}

            {tab === "venue" &&
              (venue.loading || !venue.loaded ? (
                <Loading />
              ) : venue.error ? (
                <LoadError title="Couldn't load this brand's venue" message={venue.error} onRetry={venue.reload} />
              ) : venue.data.rows.length === 0 ? (
                <p className="text-sm text-[var(--color-text-secondary)]">No physical venue. A venue and its claim appear here when the brand adds one.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {venue.data.rows.map((v) => {
                    const claim = CLAIM_STATUS[v.claim_status] || null;
                    const waiting = v.claim_status === "pending_review" ? daysWaiting(v.created_at) : null;
                    return (
                      <li key={v.id} className="flex flex-col gap-1 text-sm">
                        <a href={`#/brands?tab=venues&venueId=${encodeURIComponent(v.id)}`} className="font-medium text-[var(--color-brand-600)] underline-offset-2 hover:underline">
                          {v.name || "Unnamed venue"}
                        </a>
                        <span className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
                          {claim && <Badge variant={claim.variant}>{claim.label}</Badge>}
                          {v.city && <span>{v.city}</span>}
                          {/* The claim wait shows only while a claim is waiting. */}
                          {waiting !== null && <span>· waiting {waiting} {waiting === 1 ? "day" : "days"}</span>}
                        </span>
                        {v.claim_status === "pending_review" && (
                          <a href="#/brands?tab=claims" className="text-xs font-medium text-[var(--color-brand-600)] underline-offset-2 hover:underline">
                            Review the claim
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ))}

            {tab === "website" &&
              (website.loading || !website.loaded ? (
                <Loading />
              ) : website.error ? (
                <LoadError title="Couldn't load this brand's website" message={website.error} onRetry={website.reload} />
              ) : website.data.length === 0 ? (
                <p className="text-sm text-[var(--color-text-secondary)]">
                  No Mingla website yet. When there is one: its address, whether it's live, when it was last published and any failed attempts this week.
                </p>
              ) : (
                <ul className="flex flex-col gap-4">
                  {website.data.map((site) => {
                    const pubs = Array.isArray(site.detail?.publications) ? site.detail.publications : [];
                    const weekAgo = Date.now() - 7 * 86400000;
                    const failedThisWeek = pubs.filter(
                      (p) => p.status === "failed" && p.requested_at && new Date(p.requested_at).getTime() >= weekAgo
                    ).length;
                    return (
                      <li key={site.site_id} className="flex flex-col gap-2">
                        <KV
                          rows={[
                            ["Address", site.permanent_hostname],
                            ["State", SITE_STATUS[site.status] || "Unknown"],
                            ["Last published", site.last_published_at ? `${formatDate(site.last_published_at)} (${timeAgo(site.last_published_at)})` : "Never"],
                            ["Failed publishes this week", failedThisWeek.toLocaleString()],
                          ]}
                        />
                        <a href={`#/brands?tab=websites&siteId=${encodeURIComponent(site.site_id)}`} className="text-sm font-medium text-[var(--color-brand-600)] underline-offset-2 hover:underline">
                          Open the website tools
                        </a>
                      </li>
                    );
                  })}
                </ul>
              ))}
          </div>
        </div>
      )}

      {modal && (
        <HighRiskActionModal
          open={!!modal}
          onClose={() => setAction(null)}
          title={modal.title}
          description={modal.description}
          confirmLabel={modal.confirmLabel}
          destructive={!!modal.destructive}
          confirmPhrase={modal.confirmPhrase}
          successMessage={modal.success}
          onConfirm={async ({ reason }) => {
            const { error } = await modal.run(reason);
            if (error) throw new Error(mapWriteError(error));
            await loadDetail();
            if (action === "pause" || action === "resume") money.reload();
            onChanged?.();
          }}
        />
      )}
    </Drawer>
  );
}

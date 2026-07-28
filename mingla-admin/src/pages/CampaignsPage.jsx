/**
 * ISSUE-864 WP4 [Full Rooms Ad Engine] — the campaign surface (list + detail).
 *
 * This is where LAUNCH lives (never in the builder — SC-10 /
 * I-PROPOSED-864-CREATE-PAUSED). Per campaign:
 *  - DUAL badges: advertiser status + delivery (effective) status
 *  - Launch (with the blueprint §1.8 confirm modal + pacing copy) / Pause
 *  - the 200+warning states from admin-ad-campaign-action rendered, never
 *    swallowed (PENDING_BILLING_INFO / BALANCE_EXCEED / DISAPPROVED…)
 *  - Sync (admin-ad-campaign-sync) per campaign + sweep
 *  - detail (?campaignId=): ad sets + ads with review_status + review_detail
 *    rendered through the blueprint §1.9b cause→fix map (verbatim platform
 *    text ALWAYS shown alongside our mapping).
 */

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Pause, RefreshCw, Rocket } from "lucide-react";
import { AlertCard, SectionCard } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { Spinner } from "../components/ui/Spinner";
import { useToast } from "../context/ToastContext";
import {
  campaignAction,
  getCampaignConversions,
  getCampaignDetail,
  listCampaigns,
  parseEdgeError,
  syncCampaigns,
} from "../services/adEngineService";
import { DELIVERY_BADGE_VARIANTS, mapReviewDetail } from "../lib/adBuilder/reviewDetailMap";
import { launchConfirmCopy } from "../lib/adBuilder/budgetRules";
import { PLATFORM_LABELS } from "../lib/adBuilder/channelPlan";
// ISSUE-865 PR1 WP-4 — pure ROI math (ROAS/cost-per-result only from REAL spend).
import { toCampaignRoiView } from "../lib/adRoi";

function centsToUsd(cents) {
  if (typeof cents !== "number" && typeof cents !== "string") return "—";
  const n = Number(cents);
  if (!Number.isFinite(n)) return "—";
  return `$${(n / 100).toFixed(2)}`;
}

function campaignIdFromHash() {
  const query = window.location.hash.split("?")[1] ?? "";
  return new URLSearchParams(query).get("campaignId");
}

export function CampaignsPage() {
  const { addToast } = useToast();
  const [campaigns, setCampaigns] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedId, setSelectedId] = useState(campaignIdFromHash());
  const [rowBusy, setRowBusy] = useState({});
  const [rowWarning, setRowWarning] = useState({});
  const [launchTarget, setLaunchTarget] = useState(null);
  // ISSUE-865 PR1 WP-4 — per-campaign conversions & ROI (the detail panel feed).
  const [roi, setRoi] = useState(null);
  const [roiLoading, setRoiLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await listCampaigns();
    if (error) {
      addToast({ variant: "error", title: "Campaign list failed", description: error.message });
      setCampaigns([]);
    } else {
      setCampaigns(data ?? []);
    }
    setLoading(false);
  }, [addToast]);

  const loadDetail = useCallback(async (campaignId) => {
    if (!campaignId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    const { data, error } = await getCampaignDetail(campaignId);
    if (error) {
      addToast({ variant: "error", title: "Campaign detail failed", description: error.message });
      setDetail(null);
    } else {
      setDetail(data ?? null);
    }
    setDetailLoading(false);
  }, [addToast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onHashChange = () => setSelectedId(campaignIdFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  // ISSUE-865 PR1 WP-4 — load the campaign's conversions & ROI rollup.
  const loadConversions = useCallback(async (campaignId) => {
    if (!campaignId) {
      setRoi(null);
      return;
    }
    setRoiLoading(true);
    const { data, error } = await getCampaignConversions(campaignId);
    if (error) {
      addToast({ variant: "error", title: "Conversions failed", description: error.message });
      setRoi(null);
    } else {
      setRoi(toCampaignRoiView(data));
    }
    setRoiLoading(false);
  }, [addToast]);

  useEffect(() => {
    loadConversions(selectedId);
  }, [selectedId, loadConversions]);

  const handleAction = async (campaign, action) => {
    setRowBusy((prev) => ({ ...prev, [campaign.id]: action }));
    const { data, error } = await campaignAction(campaign.id, action);
    if (error) {
      const parsed = await parseEdgeError(error);
      addToast({
        variant: "error",
        title: `${action} failed`,
        description: String(
          typeof parsed?.body?.detail === "string"
            ? parsed.body.detail
            : parsed?.body?.detail?.message ?? parsed?.message ?? "",
        ),
      });
    } else {
      if (data?.warning) {
        // The 200 + warning contract: launched, but delivery is gated upstream.
        setRowWarning((prev) => ({ ...prev, [campaign.id]: data.warning }));
        addToast({ variant: "warning", title: "Launched with warning", description: data.warning });
      } else {
        setRowWarning((prev) => ({ ...prev, [campaign.id]: null }));
        addToast({
          variant: "success",
          title: action === "launch"
            ? `Live on ${PLATFORM_LABELS[campaign.platform] ?? campaign.platform}. It'll be in review before it starts delivering.`
            : "Paused. Spending stopped.",
        });
      }
      await load();
      if (selectedId === campaign.id) await loadDetail(campaign.id);
    }
    setRowBusy((prev) => ({ ...prev, [campaign.id]: null }));
  };

  const handleSync = async (campaignId) => {
    setRowBusy((prev) => ({ ...prev, [campaignId ?? "all"]: "sync" }));
    const { error } = await syncCampaigns(campaignId);
    if (error) {
      const parsed = await parseEdgeError(error);
      addToast({ variant: "error", title: "Sync failed", description: String(parsed?.message ?? "") });
    } else {
      addToast({ variant: "success", title: "Status synced" });
      await load();
      if (selectedId) await loadDetail(selectedId);
    }
    setRowBusy((prev) => ({ ...prev, [campaignId ?? "all"]: null }));
  };

  return (
    <div className="space-y-6">
      <SectionCard
        title="Campaigns"
        subtitle="Everything is created paused — launching is the explicit act that starts spend."
        action={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" icon={RefreshCw} loading={rowBusy.all === "sync"} onClick={() => handleSync()}>
              Sync all
            </Button>
            <Button size="sm" icon={Rocket} onClick={() => { window.location.hash = "#/campaign-builder"; }}>
              New campaign
            </Button>
          </div>
        }
      >
        {loading ? (
          <div className="flex items-center gap-2 py-4"><Spinner size="sm" /> Loading campaigns…</div>
        ) : !campaigns || campaigns.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">
            No campaigns yet — build one in the Campaign Builder. It will start paused.
          </p>
        ) : (
          <div className="space-y-2">
            {campaigns.map((campaign) => (
              <div
                key={campaign.id}
                className={[
                  "border rounded-lg p-3 flex flex-wrap items-center gap-3",
                  selectedId === campaign.id
                    ? "border-[var(--color-brand-500)] ring-1 ring-[var(--color-brand-500)]"
                    : "border-[var(--gray-200)]",
                ].join(" ")}
              >
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    className="font-medium text-sm truncate hover:underline text-left"
                    onClick={() => { window.location.hash = `#/campaigns?campaignId=${campaign.id}`; }}
                  >
                    {campaign.name}
                  </button>
                  <div className="text-xs text-[var(--color-text-secondary)]">
                    {PLATFORM_LABELS[campaign.platform] ?? campaign.platform} · {campaign.objective} ·{" "}
                    {centsToUsd(campaign.daily_budget_cents)}/day ·{" "}
                    <a className="underline inline-flex items-center gap-1" href={campaign.dest_url} target="_blank" rel="noreferrer">
                      destination <ExternalLink size={10} />
                    </a>
                  </div>
                  {rowWarning[campaign.id] && (
                    <div className="text-xs text-[var(--color-warning-700)] mt-1">{rowWarning[campaign.id]}</div>
                  )}
                </div>
                {/* DUAL badges: advertiser status + delivery status. */}
                <Badge variant={campaign.status === "ACTIVE" ? "success" : "default"}>{campaign.status}</Badge>
                <Badge variant={DELIVERY_BADGE_VARIANTS[campaign.delivery_status] ?? "info"}>
                  {campaign.delivery_status ?? "unknown"}
                </Badge>
                {campaign.status === "PAUSED" ? (
                  <Button size="sm" icon={Rocket} loading={rowBusy[campaign.id] === "launch"} onClick={() => setLaunchTarget(campaign)}>
                    Launch
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" icon={Pause} loading={rowBusy[campaign.id] === "pause"} onClick={() => handleAction(campaign, "pause")}>
                    Pause
                  </Button>
                )}
                <Button size="sm" variant="ghost" icon={RefreshCw} loading={rowBusy[campaign.id] === "sync"} onClick={() => handleSync(campaign.id)}>
                  Sync
                </Button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* ── Detail (?campaignId=) — review_detail with the §1.9b cause→fix map ── */}
      {selectedId && (
        <SectionCard
          title="Campaign detail"
          subtitle="Review verdicts with cause and fix — the verbatim platform text is always shown."
        >
          {detailLoading ? (
            <div className="flex items-center gap-2 py-4"><Spinner size="sm" /> Loading detail…</div>
          ) : !detail ? (
            <p className="text-sm text-[var(--color-text-secondary)]">Campaign not found.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-semibold text-sm">{detail.name}</span>
                <Badge variant={detail.status === "ACTIVE" ? "success" : "default"}>{detail.status}</Badge>
                <Badge variant={DELIVERY_BADGE_VARIANTS[detail.delivery_status] ?? "info"}>
                  {detail.delivery_status ?? "unknown"}
                </Badge>
                <span className="text-xs text-[var(--color-text-secondary)]">
                  synced {detail.status_synced_at ? new Date(detail.status_synced_at).toLocaleString() : "never"}
                </span>
              </div>

              {(detail.ad_sets ?? []).map((adSet) => (
                <div key={adSet.id} className="border border-[var(--gray-200)] rounded-xl p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-medium">{adSet.name}</span>
                    <Badge variant={adSet.status === "ACTIVE" ? "success" : "default"}>{adSet.status}</Badge>
                    {adSet.external_status && (
                      <Badge variant={DELIVERY_BADGE_VARIANTS[adSet.external_status] ?? "info"}>
                        {adSet.external_status}
                      </Badge>
                    )}
                    {adSet.optimization_goal && (
                      <span className="text-[var(--color-text-tertiary)]">{adSet.optimization_goal}</span>
                    )}
                  </div>
                  {(adSet.ads ?? []).map((ad) => {
                    const cards = mapReviewDetail({
                      platform: detail.platform,
                      ad,
                      deliveryStatus: ad.review_status ?? detail.delivery_status,
                    });
                    return (
                      <div key={ad.id} className="pl-3 border-l-2 border-[var(--gray-100)] space-y-2">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span>{ad.name}</span>
                          <Badge variant={ad.status === "ACTIVE" ? "success" : "default"}>{ad.status}</Badge>
                          {ad.review_status && (
                            <Badge variant={DELIVERY_BADGE_VARIANTS[ad.review_status] ?? "info"}>
                              review: {ad.review_status}
                            </Badge>
                          )}
                        </div>
                        {cards.map((card, i) => (
                          <AlertCard key={i} variant={card.severity} title={card.title}>
                            {card.body}
                            {card.action && (
                              <div className="mt-1 text-xs font-medium">[{card.action}]</div>
                            )}
                          </AlertCard>
                        ))}
                        {ad.review_detail && (
                          <details className="text-xs">
                            <summary className="cursor-pointer text-[var(--color-text-tertiary)]">
                              Raw review detail (verbatim)
                            </summary>
                            <pre className="mt-1 p-2 rounded-lg bg-[var(--gray-50)] overflow-x-auto text-[10px]">
                              {JSON.stringify(ad.review_detail, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {/* ISSUE-865 PR1 WP-4 — Conversions & ROI (below Ad sets & ads). Reads the
          per-campaign ad_campaign_conversion_rollup RPC. Spend/ROAS are shown ONLY
          when a real spend figure exists (spend_cents) — never fabricated. */}
      {selectedId && (
        <SectionCard
          title="Conversions & ROI"
          subtitle="Attributed conversions this campaign drove. ROAS shows only when real spend is connected — never estimated."
        >
          {roiLoading ? (
            <div className="flex items-center gap-2 text-[var(--color-text-secondary)]">
              <Spinner size="sm" /> Loading conversions…
            </div>
          ) : !roi || !roi.hasData ? (
            <div className="text-[var(--color-text-secondary)] text-sm">
              No attributed conversions yet. When someone clicks this campaign's ad and
              purchases or RSVPs on Mingla, the conversion is measured and shows up here.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="border border-[var(--gray-200)] rounded-lg p-3">
                  <div className="text-[var(--color-text-tertiary)] text-xs uppercase">Conversions</div>
                  <div className="text-xl font-semibold">{roi.conversions}</div>
                </div>
                <div className="border border-[var(--gray-200)] rounded-lg p-3">
                  <div className="text-[var(--color-text-tertiary)] text-xs uppercase">Attributed value</div>
                  <div className="text-xl font-semibold">{centsToUsd(roi.valueCents)}</div>
                </div>
                <div className="border border-[var(--gray-200)] rounded-lg p-3">
                  <div className="text-[var(--color-text-tertiary)] text-xs uppercase">Spend</div>
                  <div className="text-xl font-semibold">
                    {roi.spendCents === null ? "—" : centsToUsd(roi.spendCents)}
                  </div>
                </div>
                <div className="border border-[var(--gray-200)] rounded-lg p-3">
                  <div className="text-[var(--color-text-tertiary)] text-xs uppercase">ROAS</div>
                  <div className="text-xl font-semibold">
                    {roi.roas === null ? "—" : `${roi.roas.toFixed(2)}×`}
                  </div>
                </div>
              </div>

              {roi.spendCents === null && (
                <div className="text-[var(--color-text-tertiary)] text-xs">
                  Connect platform spend reporting to see ROAS and cost per result.
                </div>
              )}

              <div className="border border-[var(--gray-200)] rounded-xl overflow-hidden">
                <div className="grid grid-cols-4 gap-2 px-3 py-2 bg-[var(--gray-50)] text-[var(--color-text-tertiary)] text-xs uppercase">
                  <div>Platform</div>
                  <div className="text-right">Conversions</div>
                  <div className="text-right">Value</div>
                  <div className="text-right">Sent / Failed</div>
                </div>
                {roi.byPlatform.map((p) => (
                  <div
                    key={p.platform}
                    className="grid grid-cols-4 gap-2 px-3 py-2 border-t border-[var(--gray-200)] text-sm"
                  >
                    <div>{PLATFORM_LABELS[p.platform] ?? p.platform}</div>
                    <div className="text-right">{p.conversions}</div>
                    <div className="text-right">{centsToUsd(p.valueCents)}</div>
                    <div className="text-right text-[var(--color-text-secondary)]">
                      {p.sent} / {p.failed}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SectionCard>
      )}

      {/* Launch confirm — blueprint §1.8 modal copy (175% pacing truth). */}
      <Modal
        open={launchTarget !== null}
        onClose={() => setLaunchTarget(null)}
        title="Launch this campaign?"
      >
        <ModalBody>
          <p className="text-sm">
            {launchTarget &&
              launchConfirmCopy({
                channelCount: 1,
                totalDailyCents: Number(launchTarget.daily_budget_cents) || 0,
              })}
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setLaunchTarget(null)}>Cancel</Button>
          <Button
            icon={Rocket}
            onClick={() => {
              const target = launchTarget;
              setLaunchTarget(null);
              if (target) handleAction(target, "launch");
            }}
          >
            Launch
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

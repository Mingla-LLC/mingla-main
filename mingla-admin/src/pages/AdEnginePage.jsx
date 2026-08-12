/**
 * ISSUE-862 WP1 [Full Rooms Ad Engine] — minimal functional admin surface.
 *
 * Deliberately minimal per SPEC §2 non-goals: the polished campaign builder is
 * #864; this page exercises the WP1 contract end-to-end (SC-1…SC-7):
 *   - connection states (not configured / invalid / connecting / connected)
 *   - channel preflight (P1-P6 per channel; stubs report not_connected)
 *   - create campaign (everything PAUSED; validate-only passthrough)
 *   - campaign list with BOTH badges (advertiser status + delivery
 *     effective_status), launch / pause / sync, destination link
 *   - every edge error rendered inline with the normalized Meta detail (SC-7)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Megaphone, RefreshCw, Rocket, Pause, ExternalLink } from "lucide-react";
import { SectionCard, AlertCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Input, Textarea, Toggle } from "../components/ui/Input";
import { Spinner } from "../components/ui/Spinner";
import { useToast } from "../context/ToastContext";
import { AdConnectionsPanel } from "../components/AdConnectionsPanel";
import { AppIdentityReadinessPanel } from "../components/AppIdentityReadinessPanel";
import {
  campaignAction,
  connectMeta,
  createCampaign,
  getMetaConnection,
  listCampaigns,
  parseEdgeError,
  runPreflight,
  syncCampaigns,
} from "../services/adEngineService";

const OBJECTIVES = [
  "OUTCOME_TRAFFIC",
  "OUTCOME_AWARENESS",
  "OUTCOME_ENGAGEMENT",
  "OUTCOME_LEADS",
  "OUTCOME_SALES",
  "OUTCOME_APP_PROMOTION",
];

// Meta CTA options exposed in WP1 (server holds the per-platform maps).
const CTA_OPTIONS = ["LEARN_MORE", "BUY_TICKETS", "BOOK_NOW", "GET_DIRECTIONS", "EVENT_RSVP", "SIGN_UP"];

const DELIVERY_BADGE = {
  ACTIVE: "success",
  PAUSED: "default",
  PENDING_REVIEW: "info",
  PREAPPROVED: "info",
  IN_PROCESS: "info",
  PENDING_BILLING_INFO: "warning",
  WITH_ISSUES: "warning",
  DISAPPROVED: "error",
  CAMPAIGN_PAUSED: "default",
  ADSET_PAUSED: "default",
  AD_PAUSED: "default",
};

const PREFLIGHT_BADGE = { green: "success", amber: "warning", red: "error", not_connected: "default" };

function centsToUsd(cents) {
  if (typeof cents !== "number") return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

export function AdEnginePage() {
  const { addToast } = useToast();

  // ── Connection state ──
  const [connection, setConnection] = useState(null);
  const [connectionLoading, setConnectionLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState(null);

  // ── Preflight ──
  const [preflightRows, setPreflightRows] = useState(null);
  const [preflightRunning, setPreflightRunning] = useState(false);

  // ── Campaigns ──
  const [campaigns, setCampaigns] = useState(null);
  const [campaignsLoading, setCampaignsLoading] = useState(true);
  const [rowBusy, setRowBusy] = useState({});
  const [rowWarning, setRowWarning] = useState({});

  // ── Create form ──
  const [form, setForm] = useState({
    name: "",
    objective: "OUTCOME_TRAFFIC",
    optimization_goal: "LINK_CLICKS",
    budget_usd: "5.00",
    countries: "US",
    age_min: "18",
    age_max: "65",
    page_type: "event",
    brand_slug: "",
    entity_slug: "",
    message: "",
    headline: "",
    description: "",
    image_url: "",
    call_to_action_type: "BUY_TICKETS",
    ai_generated: false,
    validate_only: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState(null);

  const setField = (key) => (eOrValue) => {
    const value = eOrValue?.target ? eOrValue.target.value : eOrValue;
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const loadConnection = useCallback(async () => {
    setConnectionLoading(true);
    const { data, error } = await getMetaConnection();
    if (error) setConnectError({ message: error.message });
    setConnection(data ?? null);
    setConnectionLoading(false);
  }, []);

  const loadCampaigns = useCallback(async () => {
    setCampaignsLoading(true);
    const { data, error } = await listCampaigns();
    if (error) {
      addToast({ variant: "error", title: "Campaign list failed", description: error.message });
      setCampaigns([]);
    } else {
      setCampaigns(data ?? []);
    }
    setCampaignsLoading(false);
  }, [addToast]);

  // These callbacks own the paired loading/error transitions for the initial
  // provider snapshot; invoking them together is intentional on mount.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadConnection();
    loadCampaigns();
  }, [loadConnection, loadCampaigns]);

  const handleConnect = async () => {
    setConnecting(true);
    setConnectError(null);
    const { data, error } = await connectMeta("connect");
    if (error) {
      const parsed = await parseEdgeError(error);
      setConnectError({
        status: parsed?.status,
        code: parsed?.body?.error,
        message:
          typeof parsed?.body?.detail === "string"
            ? parsed.body.detail
            : parsed?.body?.detail?.message ?? parsed?.message ?? "Connect failed.",
        trace: parsed?.body?.detail?.trace_id ?? null,
      });
    } else {
      setConnection(data?.connection ?? null);
      addToast({ variant: "success", title: "Meta connected", description: "Connection verified and persisted." });
    }
    setConnecting(false);
  };

  const handlePreflight = async () => {
    setPreflightRunning(true);
    const { data, error } = await runPreflight();
    if (error) {
      const parsed = await parseEdgeError(error);
      addToast({ variant: "error", title: "Preflight failed", description: String(parsed?.message ?? "") });
    } else {
      setPreflightRows(data?.rows ?? []);
    }
    setPreflightRunning(false);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setCreateError(null);
    const amountCents = Math.round(parseFloat(form.budget_usd || "0") * 100);
    const payload = {
      platform: "meta",
      lane: "consumer",
      request_id: crypto.randomUUID(),
      name: form.name,
      objective: form.objective,
      optimization_goal: form.optimization_goal,
      billing_event: "IMPRESSIONS",
      budget: { type: "daily", amount_cents: amountCents },
      targeting: {
        countries: form.countries.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean),
        ...(form.age_min ? { age_min: parseInt(form.age_min, 10) } : {}),
        ...(form.age_max ? { age_max: parseInt(form.age_max, 10) } : {}),
      },
      destination: {
        page_type: form.page_type,
        brand_slug: form.brand_slug.trim(),
        ...(form.entity_slug.trim() ? { entity_slug: form.entity_slug.trim() } : {}),
      },
      creative: {
        message: form.message,
        ...(form.headline ? { headline: form.headline } : {}),
        ...(form.description ? { description: form.description } : {}),
        ...(form.image_url ? { image_url: form.image_url } : {}),
        call_to_action_type: form.call_to_action_type,
        ai_generated: form.ai_generated,
      },
      ...(form.validate_only ? { validate_only: true } : {}),
    };
    const { data, error } = await createCampaign(payload);
    if (error) {
      const parsed = await parseEdgeError(error);
      setCreateError({
        status: parsed?.status,
        code: parsed?.body?.error,
        message:
          typeof parsed?.body?.detail === "string"
            ? parsed.body.detail
            : parsed?.body?.detail?.message ?? parsed?.message ?? "Create failed.",
        trace: parsed?.body?.detail?.trace_id ?? null,
      });
    } else if (data?.validated) {
      const layers = Array.isArray(data.validated_layers) ? data.validated_layers.join(", ") : "";
      const skipped = Array.isArray(data.skipped_layers) && data.skipped_layers.length > 0
        ? ` (skipped: ${data.skipped_layers.map((s) => s.layer).join(", ")})`
        : "";
      addToast({
        variant: "success",
        title: "Validated",
        description: `Validated layers: ${layers}${skipped} — nothing was created.`,
      });
    } else {
      addToast({
        variant: "success",
        title: "Created — Paused.",
        description: "Review the campaign, then Launch.",
      });
      setForm((prev) => ({ ...prev, name: "", message: "", headline: "", description: "", image_url: "" }));
      await loadCampaigns();
    }
    setSubmitting(false);
  };

  const handleAction = async (campaignId, action) => {
    setRowBusy((prev) => ({ ...prev, [campaignId]: action }));
    const { data, error } = await campaignAction(campaignId, action);
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
        setRowWarning((prev) => ({ ...prev, [campaignId]: data.warning }));
        addToast({ variant: "warning", title: "Launched with warning", description: data.warning });
      } else {
        setRowWarning((prev) => ({ ...prev, [campaignId]: null }));
        addToast({ variant: "success", title: action === "launch" ? "Launched" : "Paused" });
      }
      await loadCampaigns();
    }
    setRowBusy((prev) => ({ ...prev, [campaignId]: null }));
  };

  const handleSync = async (campaignId) => {
    setRowBusy((prev) => ({ ...prev, [campaignId ?? "all"]: "sync" }));
    const { error } = await syncCampaigns(campaignId);
    if (error) {
      const parsed = await parseEdgeError(error);
      addToast({ variant: "error", title: "Sync failed", description: String(parsed?.message ?? "") });
    } else {
      addToast({ variant: "success", title: "Status synced" });
      await loadCampaigns();
    }
    setRowBusy((prev) => ({ ...prev, [campaignId ?? "all"]: null }));
  };

  const extra = connection?.extra ?? {};
  const isConnected = Boolean(connection?.connected) && connection?.status === "connected";
  const isInvalid = connection?.status === "invalid";
  const billingWarning = isConnected &&
    (connection?.account_status !== "ACTIVE" || extra?.has_payment_method === false);
  const floors = extra?.minimum_budgets ?? null;

  const goalOptions = useMemo(() => {
    // Server owns the full matrix; the form exposes the two honest traffic goals
    // (LINK_CLICKS default until the pixel fires — A4.e.5) + the gated ones so
    // the 422 pixel_no_signal path is exercisable.
    if (form.objective === "OUTCOME_TRAFFIC") {
      return ["LINK_CLICKS", "LANDING_PAGE_VIEWS", "IMPRESSIONS", "REACH"];
    }
    return ["LINK_CLICKS", "IMPRESSIONS", "REACH", "OFFSITE_CONVERSIONS"];
  }, [form.objective]);

  return (
    <div className="space-y-6">
      {/* ── ISSUE-978 [Ad Connections panel] — all 5 platforms, one-click
          Connect/Reconnect, staleness surfacing. Additive: the Meta-specific
          card below (billing floors, IG link, etc.) is unchanged and still
          drives the Create-campaign gate; this panel is the missing all-5
          operator overview. ── */}
      <AdConnectionsPanel />

      <AppIdentityReadinessPanel />

      {/* ── SC-1…SC-4: Meta connection detail (floors, billing, IG link) ── */}
      <SectionCard
        title="Meta connection — detail"
        subtitle="System User token lives in Supabase Edge Function Secrets — never in the browser or the DB."
        action={
          <Button
            variant="secondary"
            size="sm"
            icon={RefreshCw}
            loading={connecting}
            onClick={handleConnect}
          >
            {isConnected ? "Reconnect" : "Connect Meta"}
          </Button>
        }
      >
        {connectionLoading ? (
          <div className="flex items-center gap-2 py-4"><Spinner size="sm" /> Loading connection…</div>
        ) : (
          <div className="space-y-3">
            {!connection && !connectError && (
              <AlertCard variant="info" title="Not configured">
                No Meta connection yet. Prerequisites (SPEC §7): Business app live, System User token
                + META_* IDs set as Edge Function secrets, Page granted with an ADVERTISE task,
                billing on the ad account. Connect verifies all of it fail-close.
              </AlertCard>
            )}
            {isInvalid && (
              <AlertCard variant="error" title="Meta connection invalid">
                Re-verify the System User token, then Reconnect. Create is disabled while invalid.
              </AlertCard>
            )}
            {connectError && (
              <AlertCard variant="error" title={`Connect failed${connectError.code ? ` — ${connectError.code}` : ""}`}>
                {connectError.message}
                {connectError.trace ? <div className="text-xs mt-1">fbtrace_id: {connectError.trace}</div> : null}
              </AlertCard>
            )}
            {isConnected && (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <Badge variant="success" dot>Connected</Badge>
                <span>{connection.display_name}</span>
                <span className="text-[var(--color-text-secondary)]">
                  account {connection.external_account_id} · {connection.currency ?? "—"} · {connection.account_status ?? "—"}
                </span>
                {floors && (
                  <span className="text-xs text-[var(--color-text-secondary)]">
                    floors: imp {centsToUsd(floors.imp)} · video {centsToUsd(floors.video_views)} · clicks {centsToUsd(floors.high_freq)} · conv {centsToUsd(floors.low_freq)} /day
                  </span>
                )}
              </div>
            )}
            {billingWarning && (
              <AlertCard variant="warning" title="Billing not ready">
                Add a payment method in Meta Ads Manager before launching — campaigns will sit at
                “Pending billing” and never spend.
              </AlertCard>
            )}
          </div>
        )}
      </SectionCard>

      {/* ── Preflight (blueprint §1.0) ── */}
      <SectionCard
        title="Channel preflight"
        subtitle="If I launch right now, will an ad actually run? Meta is live; the other four channels fail-close until their work packages land."
        action={
          <Button variant="secondary" size="sm" icon={Megaphone} loading={preflightRunning} onClick={handlePreflight}>
            Run preflight
          </Button>
        }
      >
        {!preflightRows && !preflightRunning && (
          <p className="text-sm text-[var(--color-text-secondary)]">Not run yet.</p>
        )}
        {preflightRunning && <div className="flex items-center gap-2 py-2"><Spinner size="sm" /> Probing channels…</div>}
        {preflightRows && !preflightRunning && (
          <div className="space-y-3">
            {preflightRows.map((row) => (
              <div key={row.platform} className="border border-[var(--gray-200)] rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant={PREFLIGHT_BADGE[row.overall] ?? "default"} dot>{row.platform}</Badge>
                  <span className="text-xs text-[var(--color-text-secondary)]">{row.overall}</span>
                </div>
                <ul className="space-y-1">
                  {row.checks.map((check) => (
                    <li key={check.id} className="text-xs flex gap-2">
                      <Badge
                        variant={check.status === "pass" ? "success" : check.status === "warn" ? "warning" : check.status === "n/a" ? "default" : "error"}
                      >
                        {check.id}
                      </Badge>
                      <span>{check.label}{check.detail ? ` — ${check.detail}` : ""}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* ── SC-5: create ── */}
      <SectionCard
        title="Create campaign"
        subtitle="Everything is created PAUSED. The ad-visible destination is the canonical public page (never the OneLink)."
      >
        {!isConnected ? (
          <p className="text-sm text-[var(--color-text-secondary)]">Connect Meta first — create is fail-close.</p>
        ) : (
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Input label="Name" value={form.name} onChange={setField("name")} required placeholder="July London push" />
              <label className="block text-sm">
                <span className="block mb-1 text-[var(--color-text-secondary)]">Objective</span>
                <select className="w-full h-10 px-3 rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)]" value={form.objective} onChange={setField("objective")}>
                  {OBJECTIVES.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
              <label className="block text-sm">
                <span className="block mb-1 text-[var(--color-text-secondary)]">Optimization goal</span>
                <select className="w-full h-10 px-3 rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)]" value={form.optimization_goal} onChange={setField("optimization_goal")}>
                  {goalOptions.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </label>
              <Input
                label={`Daily budget (USD)${floors ? ` — clicks floor ${centsToUsd(floors.high_freq)}` : ""}`}
                type="number" step="0.01" min="0" value={form.budget_usd} onChange={setField("budget_usd")} required
              />
              <Input label="Countries (comma-separated)" value={form.countries} onChange={setField("countries")} required placeholder="US, GB" />
              <div className="grid grid-cols-2 gap-2">
                <Input label="Age min" type="number" value={form.age_min} onChange={setField("age_min")} />
                <Input label="Age max" type="number" value={form.age_max} onChange={setField("age_max")} />
              </div>
              <label className="block text-sm">
                <span className="block mb-1 text-[var(--color-text-secondary)]">Destination type</span>
                <select className="w-full h-10 px-3 rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)]" value={form.page_type} onChange={setField("page_type")}>
                  <option value="event">event</option>
                  <option value="brand">brand</option>
                </select>
              </label>
              <Input label="Brand slug" value={form.brand_slug} onChange={setField("brand_slug")} required placeholder="lorne" />
              <Input label="Event slug (event only)" value={form.entity_slug} onChange={setField("entity_slug")} placeholder="tuesday-live" />
              <Input label="Image URL" value={form.image_url} onChange={setField("image_url")} placeholder="https://…" />
              <label className="block text-sm">
                <span className="block mb-1 text-[var(--color-text-secondary)]">Call to action</span>
                <select className="w-full h-10 px-3 rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)]" value={form.call_to_action_type} onChange={setField("call_to_action_type")}>
                  {CTA_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <Input label="Headline" value={form.headline} onChange={setField("headline")} placeholder="Book the night" />
            </div>
            <Textarea label="Primary text" value={form.message} onChange={setField("message")} required rows={2} placeholder="Sold-out energy, Tuesday night…" />
            <div className="flex flex-wrap items-center gap-6">
              <Toggle label="AI-generated creative (discloses OPT_IN)" checked={form.ai_generated} onChange={(v) => setField("ai_generated")(v)} />
              <Toggle label="Validate only (nothing created)" checked={form.validate_only} onChange={(v) => setField("validate_only")(v)} />
              <Button type="submit" loading={submitting} icon={Megaphone}>
                {form.validate_only ? "Validate shapes" : "Create (Paused)"}
              </Button>
            </div>
            {createError && (
              <AlertCard variant="error" title={`Create failed${createError.code ? ` — ${createError.code}` : ""}`}>
                {createError.message}
                {createError.trace ? <div className="text-xs mt-1">fbtrace_id: {createError.trace}</div> : null}
              </AlertCard>
            )}
          </form>
        )}
      </SectionCard>

      {/* ── SC-6: list ── */}
      <SectionCard
        title="Campaigns"
        subtitle="Two badges per row: advertiser status + delivery (effective) status."
        action={
          <Button variant="secondary" size="sm" icon={RefreshCw} loading={rowBusy.all === "sync"} onClick={() => handleSync()}>
            Sync status
          </Button>
        }
      >
        {campaignsLoading ? (
          <div className="flex items-center gap-2 py-4"><Spinner size="sm" /> Loading campaigns…</div>
        ) : !campaigns || campaigns.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">
            No campaigns yet — create one above. It will start Paused.
          </p>
        ) : (
          <div className="space-y-2">
            {campaigns.map((campaign) => (
              <div key={campaign.id} className="border border-[var(--gray-200)] rounded-lg p-3 flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm truncate">{campaign.name}</div>
                  <div className="text-xs text-[var(--color-text-secondary)]">
                    {campaign.objective} · {centsToUsd(Number(campaign.daily_budget_cents))} /day ·{" "}
                    <a
                      className="underline inline-flex items-center gap-1"
                      href={campaign.dest_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      destination <ExternalLink size={10} />
                    </a>
                  </div>
                  {rowWarning[campaign.id] && (
                    <div className="text-xs text-[var(--color-warning-700)] mt-1">{rowWarning[campaign.id]}</div>
                  )}
                </div>
                <Badge variant={campaign.status === "ACTIVE" ? "success" : "default"}>{campaign.status}</Badge>
                <Badge variant={DELIVERY_BADGE[campaign.delivery_status] ?? "info"}>
                  {campaign.delivery_status ?? "unknown"}
                </Badge>
                {campaign.status === "PAUSED" ? (
                  <Button size="sm" icon={Rocket} loading={rowBusy[campaign.id] === "launch"} onClick={() => handleAction(campaign.id, "launch")}>
                    Launch
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" icon={Pause} loading={rowBusy[campaign.id] === "pause"} onClick={() => handleAction(campaign.id, "pause")}>
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
    </div>
  );
}

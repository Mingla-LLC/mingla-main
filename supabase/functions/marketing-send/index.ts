// ORCH-0815-B — Marketing campaign dispatcher.
//
// Triggered two ways:
//   1. pg_cron (every minute) — sends body `{}` with service-role bearer.
//      Function self-discovers up to 10 campaigns where status='scheduled'
//      AND scheduled_for <= now(), atomically flips them to 'sending'
//      with `FOR UPDATE SKIP LOCKED`, then dispatches each.
//   2. Composer "Send now" direct path — sends body `{campaign_id}` with
//      the caller's user JWT. Function verifies the caller owns the
//      campaign (via userClient + RLS), then dispatches that one campaign.
//
// Channel routing (I-PROPOSED-BR) is an exhaustive switch on
// `channel_payload.kind`. SMS / RCS throw `not_yet_enabled` so a future
// phase can plug them in without touching the dispatcher core.
//
// Live-broadcast gate (SPEC §7.4): the `MARKETING_SEND_LIVE_ENABLED`
// env-flag defaults `false`. When false, every recipient gets a
// `marketing_messages.status='preview_skipped'` row and ZERO Resend
// calls fire — the pipeline runs end-to-end against the real buyer
// dataset without sending a single email. Operator flips the flag
// post-ORCH-0777 (production checkout).
//
// Cross-references:
//   - SPEC: Mingla_Artifacts/specs/SPEC_ORCH-0815_B_COMPOSER_AND_SEND.md §7.1
//   - Cron: supabase/migrations/20260603000000_orch_0815_b_marketing_send_cron.sql
//   - Phase A schema: supabase/migrations/20260602000003_orch_0815_marketing_hub_phase_a.sql

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  jsonResponse,
  serviceClient,
  ticketCorsHeaders,
  userClient,
} from "../_shared/ticketCheckout.ts";
import {
  resolveAudience,
  type AudienceQueryDefinition,
  type ResolvedContact,
} from "../_shared/marketingAudience.ts";
import {
  type EmbeddedEvent,
  type MarketingVariables,
  renderMarketingEmail,
} from "../_shared/marketingEmailRender.ts";
import { signUnsubscribeToken } from "../_shared/marketingTokens.ts";

const BATCH_LIMIT = 10;
const RESEND_MAX_RETRIES = 3;
const RESEND_BACKOFF_MS = [1000, 3000, 9000];

interface CampaignRow {
  id: string;
  account_id: string;
  brand_id: string;
  audience_id: string;
  channel: string;
  channel_payload: {
    kind: "email" | "sms" | "rcs";
    subject?: string;
    body_html?: string;
    body_text?: string;
    embedded_events?: string[];
  };
  name: string;
  scheduled_for: string | null;
}

interface AudienceRow {
  id: string;
  brand_id: string | null;
  query_definition: AudienceQueryDefinition;
}

interface DispatchResult {
  campaign_id: string;
  status: "succeeded" | "failed";
  reason?: string;
  recipients?: number;
  preview_skipped?: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ticketCorsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  // Live-broadcast gate parsing.
  const LIVE =
    (Deno.env.get("MARKETING_SEND_LIVE_ENABLED") ?? "false").toLowerCase() ===
      "true";
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
  if (LIVE && RESEND_API_KEY.length === 0) {
    return jsonResponse({ error: "resend_not_configured" }, 503);
  }

  let body: { campaign_id?: string } = {};
  try {
    const raw = await req.text();
    if (raw.length > 0) body = JSON.parse(raw) as { campaign_id?: string };
  } catch (_err) {
    return jsonResponse({ error: "invalid_json_body" }, 400);
  }

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  const isServiceRole = serviceKey.length > 0 &&
    auth === `Bearer ${serviceKey}`;

  // Direct invocation path requires a campaign_id AND a user JWT we can
  // verify ownership against. Cron path has neither.
  if (!isServiceRole) {
    if (typeof body.campaign_id !== "string" || body.campaign_id.length === 0) {
      return jsonResponse({ error: "forbidden" }, 403);
    }
    const ownsCampaign = await verifyCampaignOwnership(req, body.campaign_id);
    if (!ownsCampaign) {
      return jsonResponse({ error: "forbidden" }, 403);
    }
  }

  const supabase = serviceClient();
  let campaigns: CampaignRow[];
  try {
    campaigns = await claimCampaigns(supabase, body.campaign_id ?? null);
  } catch (err) {
    return jsonResponse(
      {
        error: "claim_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }

  const results: DispatchResult[] = [];
  let succeeded = 0;
  let failed = 0;
  let previewSkippedTotal = 0;

  for (const campaign of campaigns) {
    try {
      const outcome = await dispatchByKind(supabase, campaign, {
        live: LIVE,
        resendApiKey: RESEND_API_KEY,
      });
      previewSkippedTotal += outcome.preview_skipped;
      await supabase
        .from("marketing_campaigns")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          recipient_count: outcome.recipients,
          updated_at: new Date().toISOString(),
        })
        .eq("id", campaign.id);
      results.push({
        campaign_id: campaign.id,
        status: "succeeded",
        recipients: outcome.recipients,
        preview_skipped: outcome.preview_skipped,
      });
      succeeded += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[marketing-send] campaign ${campaign.id} failed: ${message}`,
      );
      await supabase
        .from("marketing_campaigns")
        .update({
          status: "failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", campaign.id);
      results.push({
        campaign_id: campaign.id,
        status: "failed",
        reason: message,
      });
      failed += 1;
    }
  }

  return jsonResponse({
    processed: campaigns.length,
    succeeded,
    failed,
    preview_skipped: previewSkippedTotal,
    errors: results
      .filter((r) => r.status === "failed")
      .map((r) => ({ campaign_id: r.campaign_id, reason: r.reason ?? "" })),
  });
});

async function verifyCampaignOwnership(
  req: Request,
  campaignId: string,
): Promise<boolean> {
  try {
    const user = userClient(req);
    // RLS gate on marketing_campaigns_select already enforces caller owns
    // the campaign (or is a brand team member). A row returning here is
    // proof of ownership/membership.
    const { data, error } = await user
      .from("marketing_campaigns")
      .select("id")
      .eq("id", campaignId)
      .maybeSingle();
    if (error) return false;
    return data !== null;
  } catch (_err) {
    return false;
  }
}

async function claimCampaigns(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  specificCampaignId: string | null,
): Promise<CampaignRow[]> {
  // Atomic claim — calls the server-side `mkt_claim_campaigns(p_limit,
  // p_campaign_id)` helper shipped in the Phase B cron migration. That
  // helper performs a single-round-trip
  //   UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)
  //   RETURNING *
  // so two overlapping marketing-send invocations cannot double-claim
  // the same campaign (SPEC §7.1 + §15). The SKIP LOCKED semantics live
  // in SQL because PostgREST cannot express the lock clause.
  const { data, error } = await supabase.rpc("mkt_claim_campaigns", {
    p_limit: BATCH_LIMIT,
    p_campaign_id: specificCampaignId,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as CampaignRow[]);
}

interface DispatchOptions {
  live: boolean;
  resendApiKey: string;
}

interface DispatchOutcome {
  recipients: number;
  preview_skipped: number;
}

async function dispatchByKind(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  campaign: CampaignRow,
  options: DispatchOptions,
): Promise<DispatchOutcome> {
  const kind = campaign.channel_payload.kind;
  switch (kind) {
    case "email":
      return await sendEmail(supabase, campaign, options);
    case "sms":
      throw new Error("sms_not_yet_enabled");
    case "rcs":
      throw new Error("rcs_not_yet_enabled");
    default: {
      // Exhaustiveness sentinel — TS errors at compile time if a new kind
      // is added without a case branch.
      const _exhaustive: never = kind;
      throw new Error(
        `unknown_channel_kind:${String(_exhaustive)}`,
      );
    }
  }
}

async function sendEmail(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  campaign: CampaignRow,
  options: DispatchOptions,
): Promise<DispatchOutcome> {
  // 1. Load audience row + brand display name + embedded events.
  const { data: audienceData, error: audienceErr } = await supabase
    .from("marketing_audiences")
    .select("id, brand_id, query_definition")
    .eq("id", campaign.audience_id)
    .maybeSingle();
  if (audienceErr) throw new Error(`audience_load:${audienceErr.message}`);
  if (audienceData === null) throw new Error("audience_missing");
  const audience = audienceData as AudienceRow;

  const { data: brandRow, error: brandErr } = await supabase
    .from("brands")
    .select("id, name, slug")
    .eq("id", campaign.brand_id)
    .maybeSingle();
  if (brandErr) throw new Error(`brand_load:${brandErr.message}`);
  // The brands table column is `name` (not `display_name` — that's the
  // mobile-side camelCased property mapped through the Brand type).
  const brandName: string = (brandRow as { name?: string } | null)
    ?.name ?? "Mingla brand";
  const brandSlug: string | null = (brandRow as { slug?: string | null } | null)
    ?.slug ?? null;

  // Per-brand sender address: `<brandSlug>@usemingla.com`. Falls back to a
  // slugified version of the brand name when the brand has no slug, and
  // ultimately to `team@usemingla.com` if the slug is unrecoverable.
  // Display name is the actual brand name (Resend accepts the standard
  // `Name <addr>` From header). usemingla.com is already verified at
  // Resend — no per-address verification is needed.
  const brandEmailLocal = slugifyBrandForEmail(brandSlug ?? brandName);
  const brandFromHeader = `${brandName} <${brandEmailLocal}@usemingla.com>`;

  const embedded = await loadEmbeddedEvents(
    supabase,
    campaign.channel_payload.embedded_events ?? [],
  );

  // 2. Resolve audience via shared helper (service-role bypasses RLS).
  const resolved = await resolveAudience(supabase, audience.query_definition);

  // 3. Per-recipient send loop.
  const subject = campaign.channel_payload.subject ?? "";
  const bodyHtml = campaign.channel_payload.body_html ?? "";
  let previewSkipped = 0;
  let sent = 0;

  for (const contact of resolved.rows) {
    if (!contact.email_marketing_ok || contact.raw_email === null) {
      // Skip contacts whose email channel is suppressed. Do NOT write
      // a marketing_messages row — the campaign report should reflect
      // "deliverable audience" not "all audience".
      continue;
    }

    const messageId = crypto.randomUUID();
    const unsubscribeToken = await signUnsubscribeToken({
      campaign_id: campaign.id,
      recipient_email: contact.raw_email,
      brand_id: campaign.brand_id,
    });
    const unsubscribeUrl = `${getUnsubscribeOrigin()}/${unsubscribeToken}`;

    const variables = buildVariables(contact, brandName, embedded);
    const rendered = renderMarketingEmail({
      body_html: bodyHtml,
      variables,
      embedded_events: embedded,
      unsubscribe_url: unsubscribeUrl,
      subject: substituteString(subject, variables),
      brand_name: brandName,
    });

    // INSERT marketing_messages row (status='queued' until terminal).
    const { error: insMsgErr } = await supabase
      .from("marketing_messages")
      .insert({
        id: messageId,
        campaign_id: campaign.id,
        recipient_email: contact.raw_email,
        channel: "email",
        status: "queued",
      });
    if (insMsgErr) {
      throw new Error(`message_insert:${insMsgErr.message}`);
    }

    // INSERT marketing_clicks rows (one per rewritten href).
    if (rendered.links.length > 0) {
      const { error: insClicksErr } = await supabase
        .from("marketing_clicks")
        .insert(
          rendered.links.map((link) => ({
            campaign_id: campaign.id,
            message_id: messageId,
            destination_url: link.destination_url,
            tracking_id: link.tracking_id,
          })),
        );
      if (insClicksErr) {
        throw new Error(`clicks_insert:${insClicksErr.message}`);
      }
    }

    if (!options.live) {
      // Preview gate — skip Resend, mark row preview_skipped.
      await supabase
        .from("marketing_messages")
        .update({ status: "preview_skipped" })
        .eq("id", messageId);
      previewSkipped += 1;
      continue;
    }

    // Live path — POST to Resend with backoff for 429.
    // From-line is now per-brand (`brandFromHeader`), not the static
    // RESEND_MARKETING_FROM env var. usemingla.com domain is verified at
    // Resend so any local-part on it works without per-address verification.
    const sendOutcome = await postToResend({
      apiKey: options.resendApiKey,
      from: brandFromHeader,
      to: contact.raw_email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    if (sendOutcome.ok) {
      await supabase
        .from("marketing_messages")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          provider_message_id: sendOutcome.providerId ?? null,
        })
        .eq("id", messageId);
      sent += 1;
    } else {
      await supabase
        .from("marketing_messages")
        .update({
          status: "failed",
          failure_reason: sendOutcome.error ?? "resend_unknown_error",
        })
        .eq("id", messageId);
    }
  }

  return { recipients: sent + previewSkipped, preview_skipped: previewSkipped };
}

function buildVariables(
  contact: ResolvedContact,
  brandName: string,
  embedded: EmbeddedEvent[],
): MarketingVariables {
  const primaryEvent = embedded[0] ?? null;
  return {
    first_name: contact.first_name,
    brand_name: brandName,
    event_name: contact.last_event_name ?? primaryEvent?.title ?? null,
    event_date: primaryEvent?.date_label ?? null,
    event_time: null,
    doors_open: null,
    event_url: primaryEvent?.url ?? null,
    spots_left: null,
    previous_event_name: contact.last_event_name,
    next_event_name: primaryEvent?.title ?? null,
    event_id: primaryEvent?.id ?? contact.last_event_id,
  };
}

function substituteString(template: string, variables: MarketingVariables): string {
  return template.replace(
    /\{(first_name|event_name|event_date|event_time|doors_open|brand_name|event_url|spots_left|previous_event_name|next_event_name|event_id)\}/g,
    (_match, key: string) => {
      const v = (variables as unknown as Record<string, string | null>)[key];
      return v ?? "";
    },
  );
}

async function loadEmbeddedEvents(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  ids: string[],
): Promise<EmbeddedEvent[]> {
  if (ids.length === 0) return [];
  // ORCH-0792: read from events_with_master_date_view to pick up the
  // master event_dates row (the events table has no direct start_at;
  // cover lives in cover_media_url, not cover_image_url).
  const { data: eventsData, error: eventsErr } = await supabase
    .from("events_with_master_date_view")
    .select("id, title, location_text, cover_media_url, cover_media_type, master_start_at, slug, brand_id")
    .in("id", ids);
  if (eventsErr) throw new Error(`events_load:${eventsErr.message}`);
  const eventRows = (eventsData ?? []) as Array<{
    id: string;
    title: string | null;
    location_text: string | null;
    cover_media_url: string | null;
    cover_media_type: string | null;
    master_start_at: string | null;
    slug: string | null;
    brand_id: string;
  }>;

  // Pull brand slugs for the URL. Public event URLs are
  // `https://business.usemingla.com/e/<brand_slug>/<event_slug>` — both
  // slugs required (see mingla-business/server/socialPreview.js and
  // utils/sharePublicUrl). Without the brand slug the public page 404s.
  const brandIds = Array.from(new Set(eventRows.map((r) => r.brand_id)));
  const brandSlugByBrandId = new Map<string, string>();
  if (brandIds.length > 0) {
    const { data: brandsData, error: brandsErr } = await supabase
      .from("brands")
      .select("id, slug")
      .in("id", brandIds);
    if (brandsErr) throw new Error(`brands_load:${brandsErr.message}`);
    for (const row of ((brandsData ?? []) as Array<{ id: string; slug: string | null }>)) {
      if (row.slug !== null && row.slug.length > 0) {
        brandSlugByBrandId.set(row.id, row.slug);
      }
    }
  }

  const origin = getPublicAppOrigin();
  return eventRows.map((r) => {
    const brandSlug = brandSlugByBrandId.get(r.brand_id);
    const url = brandSlug !== undefined && r.slug !== null && r.slug.length > 0
      ? `${origin}/e/${brandSlug}/${r.slug}`
      // Defensive fallback when slug data is missing: route to brand
      // page so the link still lands somewhere honest.
      : brandSlug !== undefined
        ? `${origin}/b/${brandSlug}`
        : origin;
    // Coerce cover_media_type into the EmbeddedEvent union (`'image' |
    // 'video' | 'gif' | null`). Anything outside the union becomes null
    // — renderEventCard treats that as "no usable cover" and skips the
    // hero block entirely.
    const coverType: "image" | "video" | "gif" | null =
      r.cover_media_type === "image" || r.cover_media_type === "video" ||
        r.cover_media_type === "gif"
        ? r.cover_media_type
        : null;
    return {
      id: r.id,
      title: r.title ?? "Mingla event",
      date_label: r.master_start_at !== null
        ? new Date(r.master_start_at).toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
        })
        : null,
      location_label: r.location_text,
      cover_image_url: r.cover_media_url,
      cover_media_type: coverType,
      url,
    };
  });
}

/**
 * Slugify a brand name OR existing slug into a safe email local-part.
 * Lowercase + ASCII-alphanumeric only + max 32 chars. Falls back to
 * "team" when the input contains no usable characters (foreign-language
 * brand names, emoji-only names, etc.).
 *
 * Caps at 32 chars even though RFC 5321 allows 64 — gives headroom for
 * future suffix patterns ("acme-team@", "acme-receipts@", etc.) without
 * blowing past the limit.
 */
function slugifyBrandForEmail(input: string | null | undefined): string {
  const raw = (input ?? "").toLowerCase().trim();
  // Replace non-alphanumeric runs with nothing (collapses spaces, accents,
  // and punctuation into a single tight slug).
  const slug = raw.replace(/[^a-z0-9]+/g, "").slice(0, 32);
  return slug.length === 0 ? "team" : slug;
}

/**
 * Resolves the origin used to build per-recipient unsubscribe URLs. Same
 * pattern as marketingEmailRender.getTrackingLinkOrigin — defaults to the
 * Supabase function endpoint so the link works without DNS rewrite.
 * Operators can override to `https://usemingla.com/unsubscribe` etc. via
 * the MINGLA_UNSUBSCRIBE_LINK_ORIGIN env var.
 */
function getUnsubscribeOrigin(): string {
  const override = Deno.env.get("MINGLA_UNSUBSCRIBE_LINK_ORIGIN");
  if (override !== undefined && override.trim().length > 0) {
    return override.replace(/\/+$/, "");
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/+$/, "") ??
    "https://gqnoajqerqhnvulmnyvv.supabase.co";
  return `${supabaseUrl}/functions/v1/marketing-unsubscribe`;
}

function getPublicAppOrigin(): string {
  return Deno.env.get("MINGLA_PUBLIC_APP_ORIGIN") ?? "https://mingla.app";
}

interface ResendOutcome {
  ok: boolean;
  providerId?: string;
  error?: string;
}

async function postToResend(input: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<ResendOutcome> {
  let lastError = "";
  for (let attempt = 0; attempt < RESEND_MAX_RETRIES; attempt += 1) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: input.from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });
    if (response.status === 429) {
      lastError = "resend_rate_limited";
      const delay = RESEND_BACKOFF_MS[attempt] ?? 9000;
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (_err) {
      payload = null;
    }
    if (response.ok) {
      const providerId = isResendOk(payload) ? payload.id : undefined;
      return { ok: true, providerId };
    }
    return {
      ok: false,
      error: isResendErr(payload)
        ? `resend_${response.status}:${payload.message ?? "unknown"}`
        : `resend_${response.status}`,
    };
  }
  return { ok: false, error: lastError || "resend_rate_limited_max_retries" };
}

function isResendOk(value: unknown): value is { id: string } {
  return typeof value === "object" && value !== null &&
    typeof (value as { id?: unknown }).id === "string";
}

function isResendErr(value: unknown): value is { message?: string } {
  return typeof value === "object" && value !== null;
}

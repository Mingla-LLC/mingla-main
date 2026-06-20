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
import { generateTrackingId, signUnsubscribeToken } from "../_shared/marketingTokens.ts";
import { computeSegments, isValidE164, smsAdapter } from "../_shared/adapters/smsAdapter.ts";

const BATCH_LIMIT = 10;
const RESEND_MAX_RETRIES = 3;
const RESEND_BACKOFF_MS = [1000, 3000, 9000];

// META-ORCH-1161 Sub-B — SMS throughput throttling. Mirror the email
// BATCH_LIMIT discipline: cap concurrent SMS sends and pace them so we never
// burst-blast past the toll-free/10DLC throughput tier (SPEC §6.8, R-2).
const SMS_BATCH_SIZE = 10; // recipients per batch
const SMS_BATCH_PAUSE_MS = 1100; // ~9 msg/s sustained — under the 1 MPS toll-free + headroom

// META-ORCH-1161 Sub-B — marketing quiet hours (SPEC §6.6 / §8.2). Marketing SMS
// is blocked outside these recipient-local windows. Transactional SMS is NOT
// gated here (this function is marketing-only).
const QUIET_HOURS = {
  US: { startHour: 8, endHour: 21 }, // 8 AM–9 PM recipient-local
  NG: { startHour: 8, endHour: 20 }, // 8 AM–8 PM WAT
} as const;

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
    // SMS payload (ChannelPayloadSms): the GSM-7 body (sans STOP footer — the
    // adapter appends it). short_url_token is reserved; SMS links use the
    // existing /m/{tracking_id} Mingla redirect (Sub-B §6.7).
    body?: string;
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
      // META-ORCH-1161 Sub-B — real SMS dispatch via the Sub-A smsAdapter.
      // The per-market kill-switch (SMS_LIVE_ENABLED_US/_NG, default false)
      // lives inside smsAdapter: when off it returns status='skipped' WITHOUT
      // any Twilio HTTP, so this ships text-dark until the operator flips it.
      // (The Phase-A sentinel string "sms_not_yet_enabled" is retired here.)
      return await sendSms(supabase, campaign, options);
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
    .select("id, name, slug, cover_media_url, cover_media_type")
    .eq("id", campaign.brand_id)
    .maybeSingle();
  if (brandErr) throw new Error(`brand_load:${brandErr.message}`);
  // The brands table column is `name` (not `display_name` — that's the
  // mobile-side camelCased property mapped through the Brand type).
  const brandRowTyped = brandRow as {
    name?: string;
    slug?: string | null;
    cover_media_url?: string | null;
    cover_media_type?: string | null;
  } | null;
  const brandName: string = brandRowTyped?.name ?? "Mingla brand";
  const brandSlug: string | null = brandRowTyped?.slug ?? null;
  // Brand cover for the email header — only when it's a still image
  // (same video-skip rule as event cards; `.mov` URLs render broken in
  // Apple Mail iOS). When null, the renderer falls back to the Mingla
  // logo as before.
  const brandHeaderImageUrl: string | null =
    brandRowTyped?.cover_media_url !== null &&
      brandRowTyped?.cover_media_url !== undefined &&
      brandRowTyped.cover_media_url.length > 0 &&
      brandRowTyped.cover_media_type !== "video"
      ? brandRowTyped.cover_media_url
      : null;

  // Per-brand sender address: `<brandSlug>@usemingla.com`. Falls back to a
  // slugified version of the brand name when the brand has no slug, and
  // ultimately to `team@usemingla.com` if the slug is unrecoverable.
  // Display name is the actual brand name (Resend accepts the standard
  // `Name <addr>` From header). usemingla.com is already verified at
  // Resend — no per-address verification is needed.
  const brandEmailLocal = slugifyBrandForEmail(brandSlug ?? brandName);
  // The angle brackets here are RFC 5322 From-header syntax (`Name <addr>`),
  // not HTML. Local aliases avoid the ORCH-0785-C `brand*` prefix heuristic
  // which would otherwise (falsely) demand escapeHtml on a non-HTML string.
  const fromDisplay = brandName;
  const fromLocal = brandEmailLocal;
  const brandFromHeader = `${fromDisplay} <${fromLocal}@usemingla.com>`;

  const embedded = await loadEmbeddedEvents(
    supabase,
    campaign.channel_payload.embedded_events ?? [],
  );

  // 2. Resolve audience via shared helper (service-role bypasses RLS).
  const resolved = await resolveAudience(supabase, audience.query_definition);

  // 3. Per-recipient send loop.
  const subject = campaign.channel_payload.subject ?? "";
  const bodyHtml = campaign.channel_payload.body_html ?? "";
  const bodyText = campaign.channel_payload.body_text ?? "";
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
      brand_header_image_url: brandHeaderImageUrl,
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

  try {
    await writeBlastIntoEventChat(supabase, campaign, audience, {
      subject,
      bodyHtml,
      bodyText,
    });
  } catch (err) {
    console.error(
      `[ORCH-0897] marketing-send chat fan-out threw for campaign=${campaign.id}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  return { recipients: sent + previewSkipped, preview_skipped: previewSkipped };
}

// ---------------------------------------------------------------------------
// META-ORCH-1161 Sub-B — SMS marketing dispatch.
// ---------------------------------------------------------------------------

interface SmsContact {
  raw_phone: string | null;
  sms_marketing_ok: boolean;
}

/**
 * Derive a region (for quiet-hours + kill-switch routing) from the E.164 phone
 * prefix, since orders carry no buyer country column. +1 → US, +234 → NG. An
 * unrecognized prefix returns null → quiet-hours conservatively DENIES (defer)
 * and the kill-switch defaults to the US switch in the adapter (off by default).
 */
function countryFromE164(phone: string): string | null {
  const trimmed = phone.trim();
  if (trimmed.startsWith("+234")) return "NG";
  if (trimmed.startsWith("+1")) return "US";
  return null;
}

/**
 * Branded short links (SPEC §6.7): rewrite every http(s) URL in the SMS body
 * into a Mingla-hosted /m/{tracking_id} redirect handled by marketing-track-click
 * — NEVER a public shortener. Each rewritten link gets a marketing_clicks row so
 * attribution + per-campaign click tracking works identically to email.
 */
function rewriteSmsLinks(
  body: string,
): { rewritten: string; links: Array<{ tracking_id: string; destination_url: string }> } {
  const links: Array<{ tracking_id: string; destination_url: string }> = [];
  const origin = getTrackingRedirectOrigin();
  const urlRe = /https?:\/\/[^\s]+/g;
  const rewritten = body.replace(urlRe, (match) => {
    // Strip a trailing sentence punctuation so it isn't swallowed into the URL.
    const trailingMatch = match.match(/[.,;:!?)]+$/);
    const trailing = trailingMatch ? trailingMatch[0] : "";
    const destination = trailing.length > 0
      ? match.slice(0, match.length - trailing.length)
      : match;
    const trackingId = generateTrackingId();
    links.push({ tracking_id: trackingId, destination_url: destination });
    return `${origin}/${trackingId}${trailing}`;
  });
  return { rewritten, links };
}

function getTrackingRedirectOrigin(): string {
  const override = Deno.env.get("MINGLA_TRACKING_LINK_ORIGIN");
  if (override !== undefined && override.trim().length > 0) {
    return override.replace(/\/+$/, "");
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/+$/, "") ??
    "https://gqnoajqerqhnvulmnyvv.supabase.co";
  return `${supabaseUrl}/functions/v1/marketing-track-click`;
}

// META-ORCH-1161 go-live-prep (P3-1 carry-forward) — US NANP area-code → IANA
// timezone. The prior quiet-hours logic anchored EVERY US number to
// America/New_York, so a +1 West-Coast recipient was evaluated at Eastern time
// and could be texted at 5 AM local (8 AM ET). FCC/TCPA quiet hours are
// RECIPIENT-LOCAL (8 AM–9 PM), so we derive the actual zone from the area code.
// Covers the 50 states + DC + PR/VI; an area code NOT in the map → unknown → the
// caller conservatively DENIES (defer) rather than guess. Codes that straddle a
// DST/standard quirk (AZ no-DST) get their correct IANA zone (Phoenix).
const US_AREACODE_TZ: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  const add = (tz: string, codes: string[]) => {
    for (const c of codes) m[c] = tz;
  };
  // Eastern.
  add("America/New_York", [
    "201","202","203","207","212","215","216","219","220","223","224","226",
    "229","234","239","240","267","272","276","283","301","302","304","305",
    "321","330","339","340","347","351","352","380","386","401","404","407",
    "410","412","413","419","434","440","443","445","464","470","475","478",
    "484","508","513","516","517","518","540","551","557","561","564","567",
    "570","571","585","586","588","603","606","607","609","610","614","616",
    "617","631","646","667","678","680","681","689","703","704","706","716",
    "717","718","724","727","732","734","737","740","743","754","757","762",
    "770","772","774","781","786","787","802","803","804","810","813","814",
    "828","835","843","845","848","850","856","857","860","862","863","864",
    "878","901","904","910","912","914","917","919","920","929","937","939",
    "941","947","954","959","978","980","984",
  ]);
  // Central.
  add("America/Chicago", [
    "205","210","214","217","218","224","225","228","254","256","262","270",
    "281","309","312","314","318","319","320","331","334","337","361","380",
    "402","405","409","414","417","430","432","447","456","469","479","501",
    "504","507","512","515","531","539","563","573","580","601","608","612",
    "615","618","620","630","636","641","651","657","660","662","682","708",
    "713","715","731","737","763","769","773","779","785","806","815","816",
    "817","830","832","847","850","870","901","903","913","915","920","930",
    "931","936","940","952","956","972","979","985",
  ]);
  // Mountain (DST-observing).
  add("America/Denver", [
    "303","307","308","385","406","435","505","575","719","720","970","984",
  ]);
  // Arizona (no DST — distinct zone).
  add("America/Phoenix", ["480","520","602","623","928"]);
  // Pacific.
  add("America/Los_Angeles", [
    "209","213","279","310","323","341","350","408","415","424","442","510",
    "530","559","562","619","626","628","650","657","661","669","707","714",
    "747","760","805","818","820","831","858","909","916","925","949","951",
  ]);
  // Alaska / Hawaii.
  add("America/Anchorage", ["907"]);
  add("Pacific/Honolulu", ["808"]);
  return m;
})();

/**
 * Resolve the recipient-local IANA timezone for quiet-hours evaluation.
 *   - US (+1): derive from the NANP area code (digits 2-4 of the E.164). An
 *     unrecognized area code returns null → caller defers (no Eastern guess).
 *   - NG (+234): Africa/Lagos (single zone, WAT).
 *   - any other / unknown market: null.
 */
function resolveRecipientTz(phone: string, countryCode: string | null): string | null {
  const cc = (countryCode ?? "").toUpperCase();
  if (cc === "NG") return "Africa/Lagos";
  if (cc === "US") {
    const digits = phone.replace(/[^0-9]/g, "");
    // +1AAANXXXXXX → strip the leading country '1', take the next 3 = area code.
    const national = digits.startsWith("1") ? digits.slice(1) : digits;
    const areaCode = national.slice(0, 3);
    return US_AREACODE_TZ[areaCode] ?? null;
  }
  return null;
}

/**
 * Marketing quiet hours (SPEC §6.6 / §8.2). Returns true when it is currently
 * INSIDE the RECIPIENT-LOCAL sending window for the contact's market. The
 * timezone is derived from the phone itself (US area code; NG = Lagos) so a
 * West-Coast +1 number is evaluated in Pacific time, not Eastern. An unknown
 * market OR an unrecognized US area code conservatively DENIES (defer) — we will
 * not text a number whose local time we cannot establish (fail-safe).
 */
function isWithinQuietHours(
  phone: string,
  countryCode: string | null,
  now: Date,
): boolean {
  const cc = (countryCode ?? "").toUpperCase();
  if (cc !== "US" && cc !== "NG") return false;
  const tz = resolveRecipientTz(phone, countryCode);
  if (tz === null) return false; // unknown recipient zone → conservative deny.
  const market: "US" | "NG" = cc === "NG" ? "NG" : "US";
  const { startHour, endHour } = QUIET_HOURS[market];
  let localHour: number;
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    });
    localHour = parseInt(fmt.format(now), 10);
    if (Number.isNaN(localHour)) return false;
  } catch {
    return false; // unknown tz → conservative deny
  }
  // Inside the window means startHour <= localHour < endHour.
  return localHour >= startHour && localHour < endHour;
}

async function sendSms(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  campaign: CampaignRow,
  options: DispatchOptions,
): Promise<DispatchOutcome> {
  // 1. Load audience + brand display name (sender identity in the SMS body).
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
    .select("id, name")
    .eq("id", campaign.brand_id)
    .maybeSingle();
  if (brandErr) throw new Error(`brand_load:${brandErr.message}`);
  const brandName: string = (brandRow as { name?: string } | null)?.name ?? "Mingla brand";

  // 2. Resolve audience (service-role bypasses RLS). reachable_sms is now truthful
  //    (Sub-B phone-suppression fix in marketingAudience.ts).
  const resolved = await resolveAudience(supabase, audience.query_definition);

  const rawBody = (campaign.channel_payload.body ?? "").trim();
  if (rawBody.length === 0) throw new Error("sms_body_empty");

  const marketingSid = Deno.env.get("TWILIO_MARKETING_MESSAGING_SERVICE_SID") ?? null;

  // 3. Throttled batches.
  const deliverable = resolved.rows.filter(
    (c) => c.sms_marketing_ok && c.raw_phone !== null,
  ) as unknown as SmsContact[];

  let sent = 0;
  let previewSkipped = 0;
  const now = new Date();

  for (let i = 0; i < deliverable.length; i += SMS_BATCH_SIZE) {
    const batch = deliverable.slice(i, i + SMS_BATCH_SIZE);
    for (const contact of batch) {
      const phone = contact.raw_phone;
      if (phone === null || !isValidE164(phone.trim())) {
        // Non-E.164 phone — skip, do NOT write a row (mirrors email's
        // suppressed-skip discipline: report deliverable, not total).
        continue;
      }
      const countryCode = countryFromE164(phone);

      // Quiet hours — defer (do NOT send) outside the recipient-local window.
      // TZ is derived from the phone (US area code; NG = Lagos), not a fixed
      // Eastern anchor, so a West-Coast +1 is judged in Pacific time.
      if (!isWithinQuietHours(phone, countryCode, now)) {
        const messageId = crypto.randomUUID();
        await supabase.from("marketing_messages").insert({
          id: messageId,
          campaign_id: campaign.id,
          recipient_phone: phone,
          channel: "sms",
          status: "failed",
          failure_reason: "quiet_hours_deferred",
        });
        continue;
      }

      // Branded links + per-link click rows.
      const { rewritten, links } = rewriteSmsLinks(rawBody);
      const segments = computeSegments(rewritten);
      const messageId = crypto.randomUUID();

      const { error: insMsgErr } = await supabase
        .from("marketing_messages")
        .insert({
          id: messageId,
          campaign_id: campaign.id,
          recipient_phone: phone,
          channel: "sms",
          status: "queued",
          segments,
        });
      if (insMsgErr) throw new Error(`message_insert:${insMsgErr.message}`);

      if (links.length > 0) {
        const { error: insClicksErr } = await supabase
          .from("marketing_clicks")
          .insert(
            links.map((link) => ({
              campaign_id: campaign.id,
              message_id: messageId,
              destination_url: link.destination_url,
              tracking_id: link.tracking_id,
            })),
          );
        if (insClicksErr) throw new Error(`clicks_insert:${insClicksErr.message}`);
      }

      if (!options.live) {
        await supabase
          .from("marketing_messages")
          .update({ status: "preview_skipped" })
          .eq("id", messageId);
        previewSkipped += 1;
        continue;
      }

      // Live path — adapter enforces the per-market kill-switch internally;
      // when SMS_LIVE_ENABLED_<MKT> is off it returns status='skipped' with
      // ZERO Twilio HTTP, so even LIVE marketing-send is text-dark until flip.
      const result = await smsAdapter.send({
        to: phone.trim(),
        brandName,
        message: rewritten,
        countryCode,
        messagingServiceSid: marketingSid,
      });

      if (result.status === "sent") {
        await supabase
          .from("marketing_messages")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            provider_message_id: result.providerMessageId,
            segments: result.segments ?? segments,
          })
          .eq("id", messageId);
        sent += 1;
      } else {
        // skipped (kill-switch) OR failed — record honestly; no silent drop.
        await supabase
          .from("marketing_messages")
          .update({
            status: result.status === "skipped" ? "preview_skipped" : "failed",
            failure_reason: result.error ?? "sms_unknown_error",
          })
          .eq("id", messageId);
        if (result.status === "skipped") previewSkipped += 1;
      }
    }
    // Pace between batches (skip the trailing pause).
    if (i + SMS_BATCH_SIZE < deliverable.length) {
      await new Promise((resolve) => setTimeout(resolve, SMS_BATCH_PAUSE_MS));
    }
  }

  return { recipients: sent + previewSkipped, preview_skipped: previewSkipped };
}

async function writeBlastIntoEventChat(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  campaign: CampaignRow,
  audience: AudienceRow,
  contentInput: { subject: string; bodyHtml: string; bodyText: string },
): Promise<void> {
  if (audience.query_definition.kind !== "event_buyers") return;

  const eventId = audience.query_definition.event_id;
  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("id")
    .eq("event_id", eventId)
    .in("linked_entity_type", ["trip", "event"])
    .maybeSingle();

  if (conversationError) {
    console.warn(
      `[ORCH-0897] marketing-send: conversation lookup failed for event_id=${eventId}: ${conversationError.message}`,
    );
    return;
  }
  if (conversation === null) {
    console.warn(
      `[ORCH-0897] marketing-send: no group chat for event_id=${eventId}; skipping chat fan-out`,
    );
    return;
  }

  const content = buildBlastChatContent(campaign.name, contentInput);
  if (content.trim().length === 0) {
    console.warn(
      `[ORCH-0897] marketing-send: empty campaign body for campaign=${campaign.id}; skipping chat fan-out`,
    );
    return;
  }

  const { error: messageError } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversation.id,
      sender_id: campaign.account_id,
      content,
      message_type: "text",
      marketing_campaign_id: campaign.id,
    });

  if (messageError) {
    const isDuplicate =
      messageError.code === "23505" ||
      messageError.message?.includes("messages_unique_blast_per_conversation");
    if (!isDuplicate) {
      console.error(
        `[ORCH-0897] marketing-send chat fan-out failed campaign=${campaign.id}: ${messageError.message}`,
      );
    }
  }
}

function buildBlastChatContent(
  campaignName: string,
  input: { subject: string; bodyHtml: string; bodyText: string },
): string {
  const body = input.bodyText.trim().length > 0
    ? input.bodyText
    : stripHtml(input.bodyHtml);
  const title = input.subject.trim().length > 0 ? input.subject : campaignName;
  return [`Announcement: ${title}`, body.trim()].filter(Boolean).join("\n\n");
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
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
    // ORCH-0877 — ends_at variable mirrors the EmbeddedEvent's ends_at_label
    // (e.g., "Ends 11 PM" same-day, "Ends Sun 2 AM" cross-midnight). Null
    // when source has no end time (Constitution #9 — no fabrication).
    ends_at: primaryEvent?.ends_at_label ?? null,
    event_url: primaryEvent?.url ?? null,
    spots_left: null,
    previous_event_name: contact.last_event_name,
    next_event_name: primaryEvent?.title ?? null,
    event_id: primaryEvent?.id ?? contact.last_event_id,
  };
}

function substituteString(template: string, variables: MarketingVariables): string {
  return template.replace(
    /\{(first_name|event_name|event_date|event_time|doors_open|ends_at|brand_name|event_url|spots_left|previous_event_name|next_event_name|event_id)\}/g,
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
    .select("id, title, location_text, cover_media_url, cover_media_type, master_start_at, master_end_at, master_timezone, slug, brand_id")
    .in("id", ids);
  if (eventsErr) throw new Error(`events_load:${eventsErr.message}`);
  const eventRows = (eventsData ?? []) as Array<{
    id: string;
    title: string | null;
    location_text: string | null;
    cover_media_url: string | null;
    cover_media_type: string | null;
    master_start_at: string | null;
    // ORCH-0877 — master end-time + timezone for cross-midnight aware
    // ends_at_label rendering on the marketing event card.
    master_end_at: string | null;
    master_timezone: string | null;
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
      // ORCH-0877 — "Ends 11 PM" same-day, "Ends Sun 2 AM" cross-midnight.
      // Null when source end_at is missing (Constitution #9).
      ends_at_label: buildEndsAtLabel(
        r.master_start_at,
        r.master_end_at,
        r.master_timezone,
      ),
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
/**
 * ORCH-0877 — produce an end-time sub-line for the marketing event card.
 *
 * Returns:
 *   - null when start or end is missing/invalid (Constitution #9 — no fabrication).
 *   - "Ends 11 PM" when start + end fall on the same calendar day in the
 *     event's timezone.
 *   - "Ends Sun 2 AM" when end is on a later calendar day than start
 *     (cross-midnight events).
 *
 * Uses `en-US` locale to match the existing `date_label` locale on this
 * surface; if/when Mingla unifies locale per-recipient this helper should
 * follow.
 */
function buildEndsAtLabel(
  startAtIso: string | null,
  endAtIso: string | null,
  timezone: string | null,
): string | null {
  if (!startAtIso || !endAtIso) return null;
  const start = new Date(startAtIso);
  const end = new Date(endAtIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const tz = timezone && timezone.length > 0 ? timezone : "UTC";

  try {
    const dayKey = (d: Date): string =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(d);

    const time = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
    }).format(end)
      .replace(/\bam\b/g, "AM")
      .replace(/\bpm\b/g, "PM");

    if (dayKey(start) === dayKey(end)) {
      return `Ends ${time}`;
    }
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
    }).format(end);
    return `Ends ${weekday} ${time}`;
  } catch {
    return null;
  }
}

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
    // no-attachment: marketing campaign emails (Cycle B5 Phase B) are pure
    // HTML+text blasts; no PDF tickets or other file attachments are ever
    // sent through this code path. Per ORCH-0785-A invariant.
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

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
// `channel_payload.kind`. Email + SMS are live; any unknown kind throws
// via the `default:` branch (the exhaustiveness sentinel keeps the switch
// total at compile time). ORCH-1283 removed the dead `rcs` kind.
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
  type AudienceQueryDefinition,
  resolveAudience,
  type ResolvedContact,
} from "../_shared/marketingAudience.ts";
import {
  assertAudienceMatchesCampaignBrand,
  assertAudienceQueryMatchesCampaignBrand,
} from "../_shared/marketingAudienceBrandGate.ts";
import { isUndeliverableEmailDomain } from "../_shared/undeliverableEmail.ts";
import {
  buildMarketingBookQuote,
  parseBookQuotedAt,
  publicMarketingBookQuote,
  resolveMarketingTrackingOrigin,
  rewriteMarketingSmsLinks,
} from "../_shared/marketingBookQuote.ts";
import { dbSmsFxConverter } from "../_shared/marketingSmsFx.ts";
import {
  type EmbeddedEvent,
  type MarketingVariables,
  renderMarketingEmail,
} from "../_shared/marketingEmailRender.ts";
import {
  brandFollowPublicUrl,
  smsBlastBodyWithFollow,
} from "../_shared/marketingBlastFollow.ts";
import {
  generateTrackingId,
  signSmsUnsubscribeToken,
  signUnsubscribeToken,
} from "../_shared/marketingTokens.ts";
import {
  composeSmsBody,
  computeSegments,
  isValidE164,
  smsAdapter,
} from "../_shared/adapters/smsAdapter.ts";
// #1529 — the single source of truth for E.164 → ISO-2. Replaces the
// module-private copy that used to sit next to the SMS dispatch below.
import { smsMarketingCountry } from "../_shared/e164Country.ts";
import {
  isWithinSmsWindow,
  smsCountryProfile,
  smsMarketingRoute,
  msUntilSmsWindowOpens,
  smsLocalZones,
} from "../_shared/smsCountries.ts";
import { loadSmsRates, loadSmsRoutes } from "../_shared/smsPriceTable.ts";
import {
  type configuredSmsRoutes,
  SMS_UNPRICED_COUNTRY,
  smsCountryTextableNow,
  smsRateForPhone,
} from "../_shared/smsPriceBook.ts";
import { resolveDeliveryFlagValue } from "../_shared/secretBundle.ts";
import {
  constantTimeTokenHashEquals,
  deriveOfferingInviteToken,
  resolveOfferingInviteTokenPepper,
} from "../_shared/offeringInviteToken.ts";

import {
  buildCampaignGroupPreview,
  type GroupRows,
  type QuoteBrand,
} from "./campaignGroupPreview.ts";
import {
  buildPushQuote,
  parsePushQuotedAt,
  type PushCandidatesEnvelope,
  type PushDispatch,
  publicPushQuote,
  sendPushCampaign,
} from "./pushCampaign.ts";
import {
  buildEmailSnapshot,
  buildSmsSnapshot,
  SAMPLE_TRACKING_ID,
  writeSentSnapshot,
} from "./sentSnapshot.ts";
import { sendOpsAlertEmail } from "../_shared/stripeOpsAlertEmail.ts";
import { resolveAlertRecipientValue } from "../_shared/secretBundle.ts";

const BATCH_LIMIT = 10;

/** #4273 — no guest: buildVariables with this yields per-campaign values only. */
const SNAPSHOT_NO_GUEST: ResolvedContact = {
  contact_key: "",
  display_name: "",
  first_name: "",
  raw_email: null,
  raw_phone: null,
  order_count: 0,
  total_spend_minor: 0,
  total_spend_currency: "",
  last_event_id: null,
  last_event_name: null,
  last_purchase_at: null,
  email_marketing_ok: false,
  sms_marketing_ok: false,
};
const RESEND_MAX_RETRIES = 3;
const RESEND_BACKOFF_MS = [1000, 3000, 9000];

/**
 * #2509 — how long one dispatch pass may run before handing the campaign back.
 *
 * Both 2026-08-24 runs were killed by the runtime at ~196s. 100s leaves ample
 * headroom for the in-flight request plus the finalize call, and the cron
 * re-claims within 60s, so a large blast completes across several passes
 * instead of dying inside one.
 */
const SEND_BUDGET_MS = 100_000;

/** Recipients between liveness heartbeats. ~15s of work at the observed rate. */
const HEARTBEAT_EVERY = 25;

/**
 * #2509 — statuses that mean "this recipient is DONE for this campaign".
 * `queued` and `deferred` are absent on purpose: they are what a resume pass
 * exists to pick up.
 */
const RESUME_TERMINAL_STATUSES = new Set<string>([
  "sent",
  "delivered",
  "opened",
  "clicked",
  "bounced",
  "failed",
  "unsubscribed",
  "preview_skipped",
]);

interface EmailResumeRow {
  id: string;
  recipient_email: string | null;
  status: string;
  attempt_count: number | null;
}

/** #2509 — a row from a previous pass that this pass should REUSE, not re-insert. */
interface ReusableRow {
  id: string;
  attemptCount: number;
}

// META-ORCH-1161 Sub-B — SMS throughput throttling. Mirror the email
// BATCH_LIMIT discipline: cap concurrent SMS sends and pace them so we never
// burst-blast past the toll-free/10DLC throughput tier (SPEC §6.8, R-2).
const SMS_BATCH_SIZE = 10; // recipients per batch
const SMS_BATCH_PAUSE_MS = 1100; // ~9 msg/s sustained — under the 1 MPS toll-free + headroom
const OFFERING_LINK_MARKER = "__MINGLA_OFFERING_INVITE_URL_V1__";

interface OfferingInviteContext {
  attempt_id: string;
  invite_id: string;
  event_id: string;
}

function offeringContext(
  contact: ResolvedContact,
  query: AudienceQueryDefinition,
): OfferingInviteContext | null {
  if (query.kind === "offering_send_group") {
    const value = contact.offering_invite;
    if (
      value === undefined || typeof value.attempt_id !== "string" ||
      typeof value.invite_id !== "string" || typeof value.event_id !== "string"
    ) throw new Error("offering_invite_context_missing");
    return value;
  }
  if (contact.offering_invite !== undefined) {
    throw new Error("offering_invite_context_unexpected");
  }
  return null;
}

// deno-lint-ignore no-explicit-any -- service client has no generated DB types.
async function prepareOfferingLink(
  supabase: any,
  context: OfferingInviteContext,
  eventUrl: string,
): Promise<{ url: string; tokenId: string }> {
  const pepper = await resolveOfferingInviteTokenPepper();
  const proposedTokenId = crypto.randomUUID();
  const proposed = await deriveOfferingInviteToken(pepper, {
    tokenId: proposedTokenId,
    inviteId: context.invite_id,
    deliveryAttemptId: context.attempt_id,
  });
  const { data, error } = await supabase.rpc(
    "biz_prepare_offering_invite_delivery",
    {
      p_attempt_id: context.attempt_id,
      p_proposed_token_id: proposedTokenId,
      p_proposed_token_hash: proposed.tokenHash,
      p_derivation_version: 1,
    },
  );
  if (error || data === null) throw new Error("offering_invite_prepare_failed");
  const prepared = data as {
    tokenId: string;
    inviteId: string;
    attemptId: string;
    tokenHash: string;
    eventId: string;
  };
  if (
    prepared.attemptId !== context.attempt_id ||
    prepared.inviteId !== context.invite_id ||
    prepared.eventId !== context.event_id
  ) throw new Error("offering_invite_prepare_mismatch");
  const winner = await deriveOfferingInviteToken(pepper, {
    tokenId: prepared.tokenId,
    inviteId: prepared.inviteId,
    deliveryAttemptId: prepared.attemptId,
  });
  if (!constantTimeTokenHashEquals(prepared.tokenHash, winner.tokenHash)) {
    throw new Error("offering_invite_token_derivation_mismatch");
  }
  const url = new URL(eventUrl);
  if (url.protocol !== "https:") {
    throw new Error("offering_invite_volatile_link_invalid");
  }
  url.searchParams.set("oi", winner.opaqueToken);
  return {
    url: url.toString(),
    tokenId: prepared.tokenId,
  };
}

// deno-lint-ignore no-explicit-any -- service client has no generated DB types.
async function claimOfferingProviderIo(
  supabase: any,
  context: OfferingInviteContext,
  tokenId: string,
  channel: "email" | "sms",
): Promise<void> {
  const providerKey = `offering:${context.attempt_id}:${channel}:v1`;
  const { data, error } = await supabase.rpc(
    "biz_claim_offering_invite_provider_io",
    {
      p_attempt_id: context.attempt_id,
      p_token_id: tokenId,
      p_provider_idempotency_key: providerKey,
    },
  );
  if (error || data !== "claimed") {
    throw new Error("offering_invite_provider_claim_failed");
  }
}

function replaceSingleMarker(source: string, replacement: string): string {
  if (source.split(OFFERING_LINK_MARKER).length !== 2) {
    throw new Error("offering_invite_volatile_link_invalid");
  }
  return source.replace(OFFERING_LINK_MARKER, replacement);
}

function escapeOfferingUrlForHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll(
    "'",
    "&#39;",
  );
}

function inertOfferingUrl(eventUrl: string): string {
  const url = new URL(eventUrl);
  if (url.protocol !== "https:") {
    throw new Error("offering_invite_volatile_link_invalid");
  }
  url.searchParams.set("oi", "A".repeat(43));
  return url.toString();
}

// META-ORCH-1161 Sub-B — marketing quiet hours (SPEC §6.6 / §8.2). Marketing SMS
// is blocked outside recipient-local windows. Transactional SMS is NOT gated
// here (this function is marketing-only). #4273 — the per-country windows live
// in _shared/smsCountries.ts (SMS_COUNTRIES), one row per mapped country.

// ORCH-1270 — quiet-hours DEFER termination bounds (SPEC §5.1). An out-of-window
// recipient with a RESOLVABLE tz is held (status='deferred') and re-attempted by
// the existing cron until it either sends in-window OR crosses a bound below, at
// which point it becomes terminal failed('quiet_hours_unreachable') so a
// perpetually-unreachable recipient can never loop forever.
const MAX_DEFER_AGE_MS = 24 * 60 * 60 * 1000; // 24 h — guarantees every resolvable tz had ≥1 in-window shot.
const MAX_DEFER_ATTEMPTS = 30; // belt-and-suspenders attempt cap.
const MIN_DEFER_INTERVAL_MS = 5 * 60 * 1000; // never re-check sooner than 5 min.

// ORCH-1270 — a marketing_messages row in any of these statuses is TERMINAL:
// the sendSms loop SKIPS it entirely (no write, no send) so a recipient is never
// re-dispatched under cron re-invocation (idempotency guard, SPEC §5.1 rule 1).
// The pure decideSmsDisposition helper is only called for fresh / 'deferred' rows.
const SMS_TERMINAL_STATUSES = [
  "sent",
  "delivered",
  "opened",
  "clicked",
  "failed",
  "bounced",
  "unsubscribed",
  "preview_skipped",
] as const;

/**
 * ORCH-1270 F-DS-1 — in-loop idempotency guard (SPEC §5.1 rule 1). Given the
 * EXISTING marketing_messages row for a (campaign, phone), decide whether the
 * sendSms loop must SKIP it entirely (no write, no send, no clicks) so cron
 * re-invocation can never re-dispatch a recipient. Skip when the row is EITHER:
 *   - already TERMINAL (status in SMS_TERMINAL_STATUSES), OR
 *   - already DISPATCHED — a non-null `provider_message_id` proves
 *     smsAdapter.send() already handed this recipient to Twilio on a prior pass.
 *     This is the F-DS-1 fix: if a post-send terminal UPDATE was lost, the row
 *     can linger at a NON-terminal status ('queued') while STILL carrying the
 *     provider id; the terminal-only check missed it and a deferred sibling
 *     re-parking the campaign to 'scheduled' let cron re-pick and text the
 *     recipient a SECOND time. A non-null provider id means "already reached the
 *     provider" — NEVER re-send it, whatever the status.
 * Pure + DB-free so it is unit-testable against the real shipped logic.
 */
export function shouldSkipDispatchedRecipient(
  existing: { status: string; provider_message_id?: string | null } | null,
): boolean {
  if (existing === null) return false;
  // Terminal row (sent/failed/…): already resolved — never re-process.
  if ((SMS_TERMINAL_STATUSES as readonly string[]).includes(existing.status)) {
    return true;
  }
  // Already dispatched to Twilio (provider id present) even if non-terminal.
  return existing.provider_message_id !== null &&
    existing.provider_message_id !== undefined;
}

/** #4273 — a pass only ever leaves a row `queued` by dying mid-recipient. */
export function isInterruptedSmsRow(
  existing: { status: string; provider_message_id?: string | null } | null,
): boolean {
  return existing !== null && existing.status === "queued" &&
    (existing.provider_message_id ?? null) === null;
}

// ORCH-1270 — SMS dispatch disposition (SPEC §5.1). Pure, DB-free, unit-testable.
export type SmsDisposition =
  | { action: "send" }
  | { action: "defer"; next_attempt_at: string; attempt_count: number }
  | { action: "fail"; reason: "unknown_timezone" | "quiet_hours_unreachable" };

/**
 * ORCH-1270 — decide what to do with ONE SMS recipient (SPEC §5.1 rules 2-4).
 * Rule 1 (already-terminal skip) is enforced by the caller BEFORE this is
 * called, so `existing` here is either null (fresh) or a 'deferred' row.
 *
 *  2. Unknown timezone (unresolvable market / area code) → fail('unknown_timezone').
 *     Do NOT defer — it can never pass the window check, so deferring loops forever.
 *  3. In window → send.
 *  4. Out of window, resolvable tz → defer with an approximate next_attempt_at,
 *     UNLESS the row has aged past MAX_DEFER_AGE_MS or exceeded MAX_DEFER_ATTEMPTS,
 *     in which case fail('quiet_hours_unreachable'). The estimate is self-correcting:
 *     the next pass re-runs isWithinQuietHours, so a slightly-early guess re-defers.
 */
export function decideSmsDisposition(
  phone: string,
  countryCode: string | null,
  now: Date,
  existing:
    | {
      status?: string | null;
      attempt_count?: number | null;
      created_at?: string | null;
    }
    | null,
): SmsDisposition {
  // Rule 2 — unresolvable recipient timezone is terminal (honest), never deferred.
  const tz = resolveRecipientTz(phone, countryCode);
  if (tz === null) return { action: "fail", reason: "unknown_timezone" };

  // Rule 3 — inside the recipient-local window → send now.
  if (isWithinQuietHours(phone, countryCode, now)) return { action: "send" };

  // Rule 4 — out of window with a resolvable tz → defer (bounded).
  const attempt = (existing?.attempt_count ?? 0) + 1;
  const ageMs = existing?.created_at
    ? now.getTime() - new Date(existing.created_at).getTime()
    : 0;
  if (ageMs > MAX_DEFER_AGE_MS || attempt > MAX_DEFER_ATTEMPTS) {
    return { action: "fail", reason: "quiet_hours_unreachable" };
  }

  // #4273 — the next instant the window opens in every zone the number can
  // be in (never sooner than MIN_DEFER_INTERVAL_MS; the next pass re-checks).
  const untilOpen = msUntilSmsWindowOpens(phone, countryCode, now);
  if (untilOpen === null) {
    return { action: "fail", reason: "quiet_hours_unreachable" };
  }
  const deltaMs = Math.max(untilOpen, MIN_DEFER_INTERVAL_MS);
  return {
    action: "defer",
    next_attempt_at: new Date(now.getTime() + deltaMs).toISOString(),
    attempt_count: attempt,
  };
}

interface CampaignRow {
  id: string;
  account_id: string;
  brand_id: string;
  audience_id: string;
  channel: string;
  channel_payload: {
    kind: "email" | "sms" | "push";
    /** #3682 — optional offering the push opens (same brand). */
    event_id?: string;
    subject?: string;
    body_html?: string;
    body_text?: string;
    embedded_events?: string[];
    // SMS payload (ChannelPayloadSms): the GSM-7 body (sans STOP footer — the
    // adapter appends it). short_url_token is reserved; SMS links use the
    // existing /m/{tracking_id} Mingla redirect (Sub-B §6.7).
    body?: string;
    // #3682 — SMS Follow is optional. Missing/false preserves the author's
    // concise body; true appends the shared Follow line before STOP.
    include_follow_cta?: boolean;
    // ORCH-1282 — MMS media (publicly-fetchable brand_covers URLs). US/Twilio
    // only; NG/Termii drops it (SMS-only). Passenger on the existing send — does
    // NOT alter disposition or the ORCH-1270 dedupe.
    media_urls?: string[];
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
  // ORCH-1270 — per-campaign running counts for the JSON response body only.
  // The campaign row itself is written by mkt_finalize_campaign (RC-2), not these.
  delivered?: number;
  deferred?: number;
  failed?: number;
  preview_skipped?: number;
}

export async function handleMarketingSendRequest(
  req: Request,
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ticketCorsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  // Live-broadcast gate parsing.
  const liveValue = resolveDeliveryFlagValue(
    "marketing_send_live_enabled",
    "MARKETING_SEND_LIVE_ENABLED",
  );
  const LIVE = typeof liveValue === "boolean"
    ? liveValue
    : (liveValue ?? "false").toLowerCase() === "true";
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
  if (LIVE && RESEND_API_KEY.length === 0) {
    return jsonResponse({ error: "resend_not_configured" }, 503);
  }

  let body: {
    action?: string;
    campaign_id?: string;
    client_request_id?: string;
    quoteHash?: string;
    expectedCostMinor?: number | null;
    currency?: string | null;
    scheduledFor?: string | null;
    quotedAt?: string;
    /** #4273 — preview_group_v1: the drafts the client is sending. */
    campaign_ids?: unknown;
  } = {};
  try {
    const raw = await req.text();
    if (raw.length > 0) body = JSON.parse(raw) as typeof body;
  } catch (_err) {
    return jsonResponse({ error: "invalid_json_body" }, 400);
  }

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  const isServiceRole = serviceKey.length > 0 &&
    auth === `Bearer ${serviceKey}`;
  const isPreviewPeopleAction = body.action === "preview_book_v1" ||
    body.action === "preview_people_v2" ||
    body.action === "preview_circle_v1" ||
    body.action === "preview_combined_v1";
  const isConfirmPeopleAction = body.action === "confirm_book_v1" ||
    body.action === "confirm_people_v2" ||
    body.action === "confirm_circle_v1" ||
    body.action === "confirm_combined_v1";
  // #4273 — one locked preview for every method of one campaign.
  const isGroupPreviewAction = body.action === "preview_group_v1";
  const isPushAction = body.action === "preview_push_v1" ||
    body.action === "confirm_push_v1";
  const isBookAction = isPreviewPeopleAction || isConfirmPeopleAction ||
    isPushAction || isGroupPreviewAction;

  // Direct invocation path requires a campaign_id AND a user JWT we can
  // verify ownership against. Cron path has neither.
  if (!isServiceRole) {
    if (typeof body.campaign_id !== "string" || body.campaign_id.length === 0) {
      return jsonResponse({ error: "forbidden" }, 403);
    }
    if (!isBookAction) {
      const ownsCampaign = await verifyCampaignOwnership(req, body.campaign_id);
      if (!ownsCampaign) {
        return jsonResponse({ error: "forbidden" }, 403);
      }
    }
  }

  const supabase = serviceClient();
  if (isGroupPreviewAction) {
    if (typeof body.campaign_id !== "string" || isServiceRole) {
      return jsonResponse({ error: "BOOK_BLAST_FORBIDDEN" }, 403);
    }
    const { data: actor } = await userClient(req).auth.getUser();
    if (actor.user === null) {
      return jsonResponse({ error: "BOOK_BLAST_FORBIDDEN" }, 403);
    }
    const onlyIds = parseGroupCampaignIds(body.campaign_ids, body.campaign_id);
    if (onlyIds === "invalid") {
      return jsonResponse({ error: "BOOK_BLAST_GROUP_INVALID" }, 400);
    }
    return await handleGroupPreview(
      supabase,
      actor.user.id,
      body.campaign_id,
      new Date(),
      onlyIds ?? undefined,
    );
  }
  if (isPushAction) {
    if (typeof body.campaign_id !== "string" || isServiceRole) {
      return jsonResponse({ error: "BOOK_BLAST_FORBIDDEN" }, 403);
    }
    const { data: actor } = await userClient(req).auth.getUser();
    if (actor.user === null) {
      return jsonResponse({ error: "BOOK_BLAST_FORBIDDEN" }, 403);
    }
    return await handlePushCampaignAction(
      supabase,
      actor.user.id,
      body as PushActionBody,
    );
  }
  if (isBookAction) {
    if (typeof body.campaign_id !== "string" || isServiceRole) {
      return jsonResponse({ error: "BOOK_BLAST_FORBIDDEN" }, 403);
    }
    const { data: actor } = await userClient(req).auth.getUser();
    if (actor.user === null) {
      return jsonResponse({ error: "BOOK_BLAST_FORBIDDEN" }, 403);
    }
    if (isConfirmPeopleAction) {
      if (
        typeof body.client_request_id !== "string" ||
        typeof body.quoteHash !== "string" ||
        typeof body.quotedAt !== "string" ||
        (body.expectedCostMinor !== null &&
          typeof body.expectedCostMinor !== "number") ||
        (body.currency !== null && typeof body.currency !== "string") ||
        (body.scheduledFor !== null && body.scheduledFor !== undefined &&
          typeof body.scheduledFor !== "string")
      ) return jsonResponse({ error: "BOOK_BLAST_PREVIEW_STALE" }, 409);
      try {
        const existing = await findExistingBookSend(
          supabase,
          actor.user.id,
          body.campaign_id,
          body.client_request_id,
          body.quoteHash,
          body.quotedAt,
          body.expectedCostMinor ?? null,
          body.currency ?? null,
          body.scheduledFor ?? null,
          body.action === "confirm_combined_v1",
        );
        if (existing !== null) {
          return jsonResponse(
            existingBookSendResponse(existing),
          );
        }
      } catch (error) {
        return bookRpcErrorResponse(
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    const candidates = await supabase.rpc(
      body.action === "preview_combined_v1" ||
        body.action === "confirm_combined_v1"
        ? "biz_marketing_combined_quote_candidates_v1"
        : body.action === "preview_circle_v1" ||
            body.action === "confirm_circle_v1"
        ? "biz_marketing_circle_quote_candidates_v1"
        : "biz_marketing_book_quote_candidates",
      { p_actor_id: actor.user.id, p_campaign_id: body.campaign_id },
    );
    if (candidates.error) {
      return bookRpcErrorResponse(candidates.error.message);
    }
    const publicPeopleQuote = (
      value: Awaited<ReturnType<typeof buildMarketingBookQuote>>,
    ) => publicMarketingBookQuote(value);
    const requestedQuotedAt = isConfirmPeopleAction
      ? parseBookQuotedAt(body.quotedAt)
      : new Date();
    // #4273 — preview and confirm build with the SAME brand inputs and the
    // same FX source, so the confirm rebuild at quotedAt reproduces the hash.
    let quoteBrand: QuoteBrand;
    try {
      quoteBrand = await resolveQuoteBrand(supabase, candidates.data);
    } catch {
      return jsonResponse({ error: "BOOK_BLAST_COST_UNAVAILABLE" }, 503);
    }
    const quoteOptions = {
      followBrand: quoteBrand.followBrand,
      costCurrency: quoteBrand.costCurrency,
      fx: dbSmsFxConverter(supabase),
      // #4273 item 10 — the live prices (public.sms_country_prices). Unreadable
      // → none → the SMS quote fails closed as BOOK_BLAST_RATE_BOOK_UNAVAILABLE.
      ...((candidates.data as { channel?: unknown } | null)?.channel === "sms"
        ? { smsRates: await loadSmsRates(supabase).catch(() => undefined) }
        : {}),
    };
    if (requestedQuotedAt === null) {
      const refreshed = await safeBookQuote(candidates.data, quoteOptions);
      if (refreshed.quote === null) {
        return jsonResponse({ error: refreshed.error }, 503);
      }
      const withAllowance = await attachBookAllowance(
        supabase,
        actor.user.id,
        candidates.data,
        refreshed.quote,
      );
      if (!withAllowance.ok) {
        return jsonResponse({ error: withAllowance.error }, 503);
      }
      return jsonResponse({
        error: "BOOK_BLAST_PREVIEW_STALE",
        preview: withAllowance.quote,
      }, 409);
    }
    let quote;
    try {
      quote = await buildMarketingBookQuote(
        candidates.data as never,
        requestedQuotedAt,
        quoteOptions,
      );
    } catch (error) {
      return jsonResponse({
        error: (error instanceof Error && error.message.includes("mms"))
          ? "BOOK_BLAST_MMS_NOT_SUPPORTED"
          : marketingBookQuoteErrorCode(error),
      }, error instanceof Error && error.message.includes("mms") ? 409 : 503);
    }
    if (isPreviewPeopleAction) {
      const withAllowance = await attachBookAllowance(
        supabase,
        actor.user.id,
        candidates.data,
        publicPeopleQuote(quote),
      );
      if (!withAllowance.ok) {
        return jsonResponse({ error: withAllowance.error }, 503);
      }
      return jsonResponse(withAllowance.quote);
    }
    if (
      body.quoteHash !== quote.quoteHash ||
      body.expectedCostMinor !== quote.estimatedCostMinor ||
      body.currency !== quote.currency
    ) {
      const withAllowance = await attachBookAllowance(
        supabase,
        actor.user.id,
        candidates.data,
        publicPeopleQuote(quote),
      );
      if (!withAllowance.ok) {
        return jsonResponse({ error: withAllowance.error }, 503);
      }
      return jsonResponse({
        error: "BOOK_BLAST_PREVIEW_STALE",
        preview: withAllowance.quote,
      }, 409);
    }
    if (quote.reachableCount === 0) {
      return jsonResponse({ error: "BOOK_BLAST_ZERO_RECIPIENTS" }, 409);
    }
    const confirmed = await supabase.rpc(
      body.action === "confirm_combined_v1"
        ? "biz_confirm_marketing_combined_send_v1"
        : body.action === "confirm_circle_v1"
        ? "biz_confirm_marketing_circle_send_v1"
        : body.action === "confirm_people_v2"
        ? "biz_confirm_marketing_people_send_v2"
        : "biz_confirm_marketing_book_send_v1",
      {
        p_actor_id: actor.user.id,
        p_campaign_id: body.campaign_id,
        p_client_request_id: body.client_request_id,
        p_quote_snapshot: quote,
        p_scheduled_for: body.scheduledFor ?? null,
      },
    );
    if (confirmed.error) {
      return bookRpcErrorResponse(confirmed.error.message);
    }
    if ((confirmed.data as { replay?: boolean } | null)?.replay === true) {
      try {
        const existing = await findExistingBookSend(
          supabase,
          actor.user.id,
          body.campaign_id,
          body.client_request_id as string,
          body.quoteHash as string,
          body.quotedAt as string,
          body.expectedCostMinor ?? null,
          body.currency ?? null,
          body.scheduledFor ?? null,
          body.action === "confirm_combined_v1",
        );
        if (existing === null) throw new Error("book_blast_preview_stale");
        return jsonResponse(
          existingBookSendResponse(existing),
        );
      } catch (error) {
        return bookRpcErrorResponse(
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    // A null schedule is the direct-send contract: atomically confirmed SQL
    // has made the campaign claimable, so enter the exact same claim/dispatch/
    // finalize path as the legacy direct invocation. Future schedules remain
    // untouched for cron.
    //
    // #2509 — this comment used to assert that "marketing_messages uniqueness"
    // made a repeated request provider-idempotent. THAT WAS NOT TRUE: the only
    // unique key on the table was the PRIMARY KEY over a client-generated
    // `id`, so a re-run inserted a second row per recipient and re-sent to
    // everyone. It is true NOW, and only because
    // `20270525002509_issue_2509_blast_durability.sql` added
    // `issue_2509_one_email_row_per_campaign` / `..._one_sms_row_per_campaign`.
    // If either index is ever dropped, this sentence becomes a lie again.
    const directDispatch = body.scheduledFor == null
      ? await dispatchConfirmedBookSend(
        supabase,
        body.campaign_id,
        null,
        { live: LIVE, resendApiKey: RESEND_API_KEY },
      )
      : null;
    if (directDispatch !== null) {
      const accounted = directDispatch.delivered + directDispatch.deferred +
        directDispatch.recipient_failed + directDispatch.preview_skipped;
      if (accounted > quote.reachableCount) {
        return jsonResponse({ error: "BOOK_BLAST_PREVIEW_STALE" }, 409);
      }
      directDispatch.skipped_after_confirm = hostVisibleSkipped(
        quote.reachableCount,
        accounted,
        body.action === "confirm_combined_v1"
          ? await combinedHiddenSkips(supabase, body.campaign_id)
          : 0,
      );
    }
    return jsonResponse({
      ...(confirmed.data as Record<string, unknown>),
      resultState: body.scheduledFor == null
        ? directDispatch?.deferred ? "deferred" : "complete"
        : "scheduled",
      ...(directDispatch === null ? {} : { dispatch: directDispatch }),
    });
  }
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

  return jsonResponse(
    await processClaimedCampaigns(
      supabase,
      campaigns,
      { live: LIVE, resendApiKey: RESEND_API_KEY },
    ),
  );
}

interface PushActionBody {
  action: "preview_push_v1" | "confirm_push_v1";
  campaign_id: string;
  client_request_id?: string;
  quoteHash?: string;
  quotedAt?: string;
  scheduledFor?: string | null;
}

/**
 * #3682 wave 2 — preview / confirm a push campaign. Same sealed contract as
 * the Book lane: preview returns counts (never recipients) plus the brand's
 * allowance; confirm rebuilds the quote server side and the SQL owner refuses
 * any drift. A null schedule sends now through the shared claim path.
 */
export async function handlePushCampaignAction(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  actorId: string,
  body: PushActionBody,
  dispatch?: PushDispatch,
): Promise<Response> {
  const candidates = await supabase.rpc(
    "biz_marketing_push_quote_candidates_v1",
    { p_actor_id: actorId, p_campaign_id: body.campaign_id },
  );
  if (candidates.error) {
    return bookRpcErrorResponse(candidates.error.message);
  }
  const envelope = candidates.data as PushCandidatesEnvelope;
  const confirming = body.action === "confirm_push_v1";
  const quotedAt = confirming ? parsePushQuotedAt(body.quotedAt) : new Date();
  const fresh = await buildPushQuote(body.campaign_id, envelope, new Date());
  const withAllowance = async (quote: Record<string, unknown>) =>
    await attachBookAllowance(supabase, actorId, envelope, quote);
  if (quotedAt === null) {
    const refreshed = await withAllowance(publicPushQuote(fresh));
    return jsonResponse({
      error: "BOOK_BLAST_PREVIEW_STALE",
      ...(refreshed.ok ? { preview: refreshed.quote } : {}),
    }, 409);
  }
  const quote = await buildPushQuote(body.campaign_id, envelope, quotedAt);
  if (!confirming) {
    const preview = await withAllowance(publicPushQuote(quote));
    if (!preview.ok) return jsonResponse({ error: preview.error }, 503);
    return jsonResponse(preview.quote);
  }
  if (
    typeof body.client_request_id !== "string" ||
    body.quoteHash !== quote.quoteHash
  ) {
    const refreshed = await withAllowance(publicPushQuote(fresh));
    return jsonResponse({
      error: "BOOK_BLAST_PREVIEW_STALE",
      ...(refreshed.ok ? { preview: refreshed.quote } : {}),
    }, 409);
  }
  if (quote.reachableCount === 0) {
    return jsonResponse({ error: "BOOK_BLAST_ZERO_RECIPIENTS" }, 409);
  }
  const confirmed = await supabase.rpc("biz_confirm_marketing_push_send_v1", {
    p_actor_id: actorId,
    p_campaign_id: body.campaign_id,
    p_client_request_id: body.client_request_id,
    p_quote_snapshot: quote,
    p_scheduled_for: body.scheduledFor ?? null,
  });
  if (confirmed.error) return bookRpcErrorResponse(confirmed.error.message);
  const result = confirmed.data as Record<string, unknown>;
  if (result.replay === true || body.scheduledFor != null) {
    return jsonResponse({
      ...result,
      resultState: body.scheduledFor != null ? "scheduled" : "in_progress",
    });
  }
  const claimed = await claimCampaigns(supabase, body.campaign_id);
  const dispatchSummary = await processClaimedCampaigns(
    supabase,
    claimed,
    { live: true, resendApiKey: "" },
    dispatch === undefined
      ? dispatchByKind
      : (db, campaign, options) =>
        campaign.channel_payload.kind === "push"
          ? sendPushCampaign(db, campaign, dispatch)
          : dispatchByKind(db, campaign, options),
  );
  dispatchSummary.skipped_after_confirm = Math.max(
    0,
    quote.reachableCount -
      (dispatchSummary.delivered + dispatchSummary.recipient_failed),
  );
  return jsonResponse({
    ...result,
    resultState: "complete",
    dispatch: dispatchSummary,
  });
}

/**
 * #4273 — every method of one campaign previewed at one moment. The same
 * builders as the per-method lanes, so what each method later confirms is what
 * this returned; the group figures count each person once across methods.
 */
export async function handleGroupPreview(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  actorId: string,
  leadCampaignId: string,
  now = new Date(),
  onlyIds?: readonly string[],
): Promise<Response> {
  try {
    const preview = await buildCampaignGroupPreview(
      {
        loadGroup: async (campaignId, only) => {
          const lead = await supabase.from("marketing_campaigns")
            .select("id, campaign_group_id").eq("id", campaignId).maybeSingle();
          if (lead.error) throw new Error(lead.error.message);
          if (lead.data === null) throw new Error("book_blast_audience_not_found");
          const group = lead.data.campaign_group_id ?? lead.data.id;
          const rows = await supabase.from("marketing_campaigns")
            .select("id, channel").or(`campaign_group_id.eq.${group},id.eq.${group}`)
            .eq("status", "draft");
          if (rows.error) throw new Error(rows.error.message);
          const drafts = rows.data as Array<{ id: string; channel: "email" | "sms" | "push" }>;
          return selectGroupDrafts(drafts, only, group);
        },
        candidates: async (campaignId, channel) => {
          const result = await supabase.rpc(
            channel === "push"
              ? "biz_marketing_push_quote_candidates_v1"
              : "biz_marketing_combined_quote_candidates_v1",
            { p_actor_id: actorId, p_campaign_id: campaignId },
          );
          if (result.error) throw new Error(result.error.message);
          return result.data;
        },
        quoteBrand: (candidates) => resolveQuoteBrand(supabase, candidates),
        fx: dbSmsFxConverter(supabase),
        smsRates: await loadSmsRates(supabase).catch(() => undefined),
        allowance: async (candidates, quote) => {
          const attached = await attachBookAllowance(supabase, actorId, candidates, quote);
          if (!attached.ok) throw new Error("cost_unavailable");
          return attached.quote;
        },
        errorCode: groupMethodErrorCode,
      },
      leadCampaignId,
      now,
      onlyIds,
    );
    if (preview.methods.every((method) => method.quote === null)) {
      const code = preview.methods[0]?.error ?? "BOOK_BLAST_AUDIENCE_NOT_FOUND";
      return jsonResponse({ error: code }, groupErrorStatus(code));
    }
    return jsonResponse(preview);
  } catch (error) {
    return bookRpcErrorResponse(
      error instanceof Error ? error.message : String(error),
    );
  }
}

function bookRpcErrorResponse(message: string): Response {
  const envelope = bookRpcErrorEnvelope(message);
  return jsonResponse({ error: envelope.error }, envelope.status);
}

/**
 * #4273 — the Book RPC errors this lane knows, each with its own honest code.
 *
 * STALE must be EXPLICIT. `BOOK_BLAST_PREVIEW_STALE` tells the host "what you
 * reviewed changed, look again"; returning it for a failure that has nothing
 * to do with the sealed set (a lookup error, an unknown database error, a cost
 * that cannot be priced) sends the host round a refresh loop that can never
 * succeed. MINGLA-INVARIANT: I-4273-STALE-MEANS-STALE | issue #4273 | marketing-send returns BOOK_BLAST_PREVIEW_STALE only when the sealed set, hash, cost or currency changed or the quote aged out; any other quote-build failure has its own code.
 */
export function knownBookRpcError(
  message: string,
): { error: string; status: number } | null {
  if (
    message.includes("book_blast_preview_stale") ||
    message.includes("manual_group_preview_stale") ||
    message.includes("circle_blast_snapshot_stale")
  ) {
    return { error: "BOOK_BLAST_PREVIEW_STALE", status: 409 };
  }
  if (
    message.includes("circle_blast_audience_not_found") ||
    message.includes("book_blast_audience_not_found")
  ) {
    return { error: "BOOK_BLAST_AUDIENCE_NOT_FOUND", status: 404 };
  }
  if (
    message.includes("circle_blast_flag_disabled") ||
    message.includes("book_blast_flag_disabled")
  ) {
    return { error: "BOOK_BLAST_FLAG_DISABLED", status: 503 };
  }
  if (
    message.includes("book_blast_forbidden") ||
    message.includes("circle_blast_forbidden")
  ) {
    return { error: "BOOK_BLAST_FORBIDDEN", status: 403 };
  }
  if (message.includes("book_blast_idempotency_conflict")) {
    return { error: "BOOK_BLAST_IDEMPOTENCY_CONFLICT", status: 409 };
  }
  if (message.includes("book_blast_zero_recipients")) {
    return { error: "BOOK_BLAST_ZERO_RECIPIENTS", status: 409 };
  }
  if (message.includes("book_blast_monthly_cap_exceeded")) {
    return { error: "BOOK_BLAST_MONTHLY_CAP_EXCEEDED", status: 409 };
  }
  return null;
}

/** Unknown is UNAVAILABLE, never STALE (I-4273-STALE-MEANS-STALE). */
export function bookRpcErrorEnvelope(
  message: string,
): { error: string; status: number } {
  return knownBookRpcError(message) ??
    { error: "BOOK_BLAST_PREVIEW_UNAVAILABLE", status: 503 };
}

/** #4273 — one group method's refusal, mapped honestly. */
export function groupMethodErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("mms")) return "BOOK_BLAST_MMS_NOT_SUPPORTED";
  return knownBookRpcError(message)?.error ??
    marketingBookQuoteErrorCode(error);
}

const KNOWN_GROUP_STATUS: Record<string, number> = {
  BOOK_BLAST_PREVIEW_STALE: 409,
  BOOK_BLAST_AUDIENCE_NOT_FOUND: 404,
  BOOK_BLAST_FLAG_DISABLED: 503,
  BOOK_BLAST_FORBIDDEN: 403,
  BOOK_BLAST_IDEMPOTENCY_CONFLICT: 409,
  BOOK_BLAST_ZERO_RECIPIENTS: 409,
  BOOK_BLAST_MONTHLY_CAP_EXCEEDED: 409,
  BOOK_BLAST_MMS_NOT_SUPPORTED: 409,
};

/** Status when every group method was refused: the first method's own. */
export function groupErrorStatus(code: string): number {
  return KNOWN_GROUP_STATUS[code] ?? 503;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * #4273 — `campaign_ids` on preview_group_v1: the drafts the client is
 * actually sending. Absent → null (old builds: every group draft, as before).
 * Present → 1–3 unique UUIDs that include the lead, else "invalid".
 */
export function parseGroupCampaignIds(
  value: unknown,
  leadCampaignId: string,
): string[] | null | "invalid" {
  if (value === undefined || value === null) return null;
  if (
    !Array.isArray(value) || value.length < 1 || value.length > 3 ||
    value.some((id) => typeof id !== "string" || !UUID_PATTERN.test(id))
  ) return "invalid";
  const ids = (value as string[]).map((id) => id.toLowerCase());
  if (new Set(ids).size !== ids.length) return "invalid";
  if (!ids.includes(leadCampaignId.toLowerCase())) return "invalid";
  return ids;
}

/**
 * #4273 — keep only the drafts the client named. A named id that is not a
 * draft of this group means the set really changed → stale. Group drafts the
 * client did not name are returned so the client can discard them; they are
 * never priced. MINGLA-INVARIANT: I-4273-GROUP-PREVIEW-PRICES-PICKED-METHODS | issue #4273 | When the client names the campaigns it is sending, the group preview prices only those; a group campaign it did not name is never counted.
 */
export function selectGroupDrafts(
  drafts: Array<{ id: string; channel: "email" | "sms" | "push" }>,
  only: readonly string[] | undefined,
  /** The group's head, COALESCE(campaign_group_id, id): never reported unlisted. */
  headId?: string,
): GroupRows {
  if (only === undefined) return { rows: drafts, unlisted: [] };
  const named = new Set(only.map((id) => id.toLowerCase()));
  const draftIds = new Set(drafts.map((row) => row.id.toLowerCase()));
  for (const id of named) {
    if (!draftIds.has(id)) throw new Error("book_blast_preview_stale");
  }
  return {
    rows: drafts.filter((row) => named.has(row.id.toLowerCase())),
    // The head is the host's original campaign. When the composer's lead is a
    // sibling opened from Drafts, the head is not named, but it must never be
    // handed back for discarding: it is skipped (not priced), not deleted.
    unlisted: drafts.filter((row) =>
      !named.has(row.id.toLowerCase()) &&
      row.id.toLowerCase() !== headId?.toLowerCase()
    ).map((row) => row.id),
  };
}

/**
 * #4273 — one brand read per quote: the Follow line SMS dispatch appends, and
 * the currency a mixed-currency SMS total is shown in. Non-SMS quotes need
 * neither and skip the read. Fails closed: a silent null would price SMS
 * without Follow while dispatch (which re-reads the brand) still appends it
 * (#3682), or leave a mixed-currency total without a currency.
 */
export async function resolveQuoteBrand(
  // deno-lint-ignore no-explicit-any
  db: any,
  candidates: unknown,
): Promise<QuoteBrand> {
  const candidateEnvelope = candidates as {
    channel?: unknown;
    content?: { include_follow_cta?: unknown } | null;
  } | null;
  if (candidateEnvelope?.channel !== "sms") {
    return { followBrand: null, costCurrency: null };
  }
  const brandId = (candidates as { brandId?: unknown } | null)?.brandId;
  if (typeof brandId !== "string" || brandId.length === 0) {
    throw new Error("cost_unavailable:brand_lookup");
  }
  const { data, error } = await db
    .from("brands")
    .select("name, slug, pricing_currency, default_currency")
    .eq("id", brandId)
    .maybeSingle();
  if (error || data === null) {
    throw new Error("cost_unavailable:brand_lookup");
  }
  const rawCurrency = typeof data.pricing_currency === "string" &&
      data.pricing_currency.trim().length > 0
    ? data.pricing_currency
    : data.default_currency;
  const upper = typeof rawCurrency === "string"
    ? rawCurrency.trim().toUpperCase()
    : "";
  const costCurrency = /^[A-Z]{3}$/.test(upper) ? upper : null;
  if (candidateEnvelope.content?.include_follow_cta !== true) {
    return { followBrand: null, costCurrency };
  }
  const slug = typeof data.slug === "string" ? data.slug.trim() : "";
  // No public slug ⇒ Follow URL cannot be formed; omit (same as dispatch).
  if (slug.length === 0) return { followBrand: null, costCurrency };
  const name = typeof data.name === "string" && data.name.trim().length > 0
    ? data.name.trim()
    : "Mingla brand";
  return { followBrand: { name, slug }, costCurrency };
}

async function safeBookQuote(
  candidates: unknown,
  options: Parameters<typeof buildMarketingBookQuote>[2],
) {
  try {
    return {
      quote: publicMarketingBookQuote(
        await buildMarketingBookQuote(candidates as never, new Date(), options),
      ),
      error: null,
    };
  } catch (error) {
    return { quote: null, error: marketingBookQuoteErrorCode(error) };
  }
}

/** Public-safe reason without rate values, contacts, or message content. */
export function marketingBookQuoteErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("sms_rate_book_expired")) {
    return "BOOK_BLAST_RATE_BOOK_EXPIRED";
  }
  if (
    message.includes("sms_rate_book_") ||
    message.includes("sms_rate_unavailable")
  ) {
    return "BOOK_BLAST_RATE_BOOK_UNAVAILABLE";
  }
  // #4273 — no FX snapshot as of quotedAt / conversion failed, or the brand
  // (Follow line, cost currency) could not be read: the cost cannot be stated.
  if (message.includes("fx_unavailable") || message.includes("brand_lookup")) {
    return "BOOK_BLAST_COST_UNAVAILABLE";
  }
  return "BOOK_BLAST_COST_UNAVAILABLE";
}

async function attachBookAllowance(
  // deno-lint-ignore no-explicit-any
  db: any,
  actorId: string,
  candidates: unknown,
  publicQuote: Record<string, unknown>,
): Promise<
  | { ok: true; quote: Record<string, unknown> }
  | { ok: false; error: string }
> {
  const brandId = (candidates as { brandId?: unknown } | null)?.brandId;
  if (typeof brandId !== "string" || brandId.length === 0) {
    return { ok: false, error: "BOOK_BLAST_COST_UNAVAILABLE" };
  }
  const usage = await db.rpc("biz_brand_blast_usage_v1", {
    p_actor_id: actorId,
    p_brand_id: brandId,
  });
  if (usage.error || usage.data == null || typeof usage.data !== "object") {
    return { ok: false, error: "BOOK_BLAST_COST_UNAVAILABLE" };
  }
  return { ok: true, quote: { ...publicQuote, allowance: usage.data } };
}

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
  /**
   * #4273 — tests only: the rate routes the send guard reads. Omitted → the
   * configured book (configuredSmsRoutes); null → no book configured.
   */
  smsRoutes?: ReturnType<typeof configuredSmsRoutes>;
  /** #4273 — tests only: the ops alert (default: the api-health recipients). */
  opsAlert?: (subject: string, paragraphs: string[]) => Promise<void>;
}

interface DispatchOutcome {
  // ORCH-1270 (SPEC §5.1) — honest per-recipient outcome counts.
  //   delivered      = provider send succeeded (status → sent)
  //   deferred       = held for the next in-window pass (status → deferred)
  //   failed         = terminal failure (unknown tz / unreachable / provider error)
  //   preview_skipped = live-gate OFF or adapter kill-switch (no provider HTTP)
  // Used ONLY for the JSON response body; the campaign row is written by the
  // mkt_finalize_campaign RPC which recomputes truth from marketing_messages.
  delivered: number;
  deferred: number;
  failed: number;
  preview_skipped: number;
  /** #2509 — true when the pass stopped on its wall-clock budget, not on completion. */
  budget_paused?: boolean;
  /**
   * #4273 — the pass could not run at all (a sealed SMS send whose price table
   * could not be read) and touched no recipient: re-park the campaign for a
   * later pass instead of finalizing it as reaching nobody.
   */
  retry_later?: boolean;
}

/** #4273 — how long a sealed SMS send waits before retrying an unreadable price table. */
export const SMS_PRICE_RETRY_MS = 10 * 60 * 1000;
/**
 * #4273 tester retest 3 — a sealed SMS send stops waiting for the price table
 * this long after its own scheduled time: it fails (and the Book failure
 * marker is written) so the host sees it and can send again.
 */
export const SMS_PRICE_RETRY_LIMIT_MS = 24 * 60 * 60 * 1000;
/** A re-park this close to the execution's own time is the first one. */
const SMS_PRICE_FIRST_PARK_WINDOW_MS = 5 * 60 * 1000;

async function alertSmsPriceTableUnreadable(
  subject: string,
  paragraphs: string[],
): Promise<void> {
  // The api-health recipients and the ops alert path sms-price-refresh uses.
  const value = resolveAlertRecipientValue(
    "api_health",
    "API_HEALTH_ALERT_EMAILS",
  );
  const recipients = Array.isArray(value)
    ? value
    : (value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  await sendOpsAlertEmail({ subject, paragraphs, recipients });
}

type CampaignDispatcher = (
  // deno-lint-ignore no-explicit-any
  supabase: any,
  campaign: CampaignRow,
  options: DispatchOptions,
) => Promise<DispatchOutcome>;

interface DispatchBatchSummary {
  processed: number;
  succeeded: number;
  failed: number;
  delivered: number;
  deferred: number;
  recipient_failed: number;
  skipped_after_confirm: number;
  preview_skipped: number;
  errors: Array<{ campaign_id: string; reason: string }>;
}

export async function processClaimedCampaigns(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  campaigns: CampaignRow[],
  options: DispatchOptions,
  dispatcher: CampaignDispatcher = dispatchByKind,
): Promise<DispatchBatchSummary> {
  const results: DispatchResult[] = [];
  let succeeded = 0;
  let failed = 0;
  let deliveredTotal = 0;
  let deferredTotal = 0;
  let recipientFailedTotal = 0;
  let previewSkippedTotal = 0;

  for (const campaign of campaigns) {
    try {
      const outcome = await dispatcher(supabase, campaign, options);
      if (outcome.retry_later === true) {
        // #4273 — nothing was attempted: back to scheduled, no finalize.
        const { error: retryErr } = await supabase
          .from("marketing_campaigns")
          .update({
            status: "scheduled",
            scheduled_for: new Date(Date.now() + SMS_PRICE_RETRY_MS)
              .toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", campaign.id);
        if (retryErr) throw new Error(`retry_park:${retryErr.message}`);
        results.push({
          campaign_id: campaign.id,
          status: "succeeded",
          delivered: 0,
          deferred: 0,
          failed: 0,
          preview_skipped: 0,
        });
        succeeded += 1;
        continue;
      }
      deliveredTotal += outcome.delivered;
      deferredTotal += outcome.deferred;
      recipientFailedTotal += outcome.failed;
      previewSkippedTotal += outcome.preview_skipped;
      const { error: finalizeErr } = await supabase.rpc(
        "mkt_finalize_campaign",
        { p_campaign_id: campaign.id },
      );
      if (finalizeErr) throw new Error(`finalize:${finalizeErr.message}`);
      results.push({
        campaign_id: campaign.id,
        status: "succeeded",
        delivered: outcome.delivered,
        deferred: outcome.deferred,
        failed: outcome.failed,
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
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", campaign.id);
      const { error: bookFailureError } = await supabase.rpc(
        "biz_record_marketing_book_send_failure_v1",
        { p_campaign_id: campaign.id },
      );
      if (bookFailureError) {
        console.error(
          `[marketing-send] campaign ${campaign.id} Book failure marker failed: ${bookFailureError.message}`,
        );
      }
      results.push({
        campaign_id: campaign.id,
        status: "failed",
        reason: message,
      });
      failed += 1;
    }
  }

  return {
    processed: campaigns.length,
    succeeded,
    failed,
    delivered: deliveredTotal,
    deferred: deferredTotal,
    recipient_failed: recipientFailedTotal,
    skipped_after_confirm: 0,
    preview_skipped: previewSkippedTotal,
    errors: results
      .filter((result) => result.status === "failed")
      .map((result) => ({
        campaign_id: result.campaign_id,
        reason: result.reason ?? "",
      })),
  };
}

interface ExistingBookResult {
  executionId: string;
  campaignId: string;
  scheduledFor: string;
  sendMode: "now" | "scheduled";
  campaignStatus: string;
  campaignFailed: boolean;
  sealedReachable: number;
  delivered: number;
  deferred: number;
  recipientFailed: number;
  previewSkipped: number;
  queued: number;
  messageRows: number;
}

export function existingBookSendResponse(
  existing: ExistingBookResult,
): Record<string, unknown> {
  if (existing.messageRows > existing.sealedReachable) {
    throw new Error("book_blast_execution_expanded");
  }
  const common = {
    executionId: existing.executionId,
    campaignId: existing.campaignId,
    scheduledFor: existing.scheduledFor,
    replay: true,
  };
  if (
    existing.sendMode === "scheduled" &&
    existing.campaignStatus === "scheduled" && existing.messageRows === 0
  ) {
    return { ...common, resultState: "scheduled" };
  }
  if (
    existing.campaignStatus === "sending" || existing.queued > 0 ||
    (existing.campaignStatus === "scheduled" && existing.messageRows === 0)
  ) return { ...common, resultState: "in_progress" };
  const campaignFailed = existing.campaignFailed;
  return {
    ...common,
    resultState: existing.deferred > 0 ? "deferred" : "complete",
    dispatch: {
      processed: 1,
      succeeded: campaignFailed ? 0 : 1,
      failed: campaignFailed ? 1 : 0,
      delivered: existing.delivered,
      deferred: existing.deferred,
      recipient_failed: existing.recipientFailed,
      preview_skipped: existing.previewSkipped,
      skipped_after_confirm: Math.max(
        existing.sealedReachable - existing.messageRows,
        0,
      ),
      errors: campaignFailed
        ? [{ campaign_id: existing.campaignId, reason: "campaign_failed" }]
        : [],
    },
  };
}

/**
 * #4273 — sealed targets that got the text through another target on the same
 * address (biz_marketing_combined_hidden_skips_v1, redefined by migration
 * 20280422014273). They were reached, so they stay out of the host's skipped
 * count; every other sealed-and-unsent target is in it and reads as "couldn't
 * be reached", with no reason. When the figure cannot be read the whole
 * difference is withheld: a low skipped count is safe, a revealing one is not.
 */
export async function combinedHiddenSkips(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  campaignId: string,
): Promise<number> {
  const { data, error } = await supabase.rpc(
    "biz_marketing_combined_hidden_skips_v1",
    { p_campaign_id: campaignId },
  );
  if (error || typeof data !== "number") {
    console.error(
      `[marketing-send] campaign ${campaignId} hidden skip read failed`,
    );
    return Number.MAX_SAFE_INTEGER;
  }
  return data;
}

export function hostVisibleSkipped(
  sealedReachable: number,
  accounted: number,
  hiddenSkips: number,
): number {
  return Math.max(sealedReachable - accounted - hiddenSkips, 0);
}

async function findExistingBookSend(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  actorId: string,
  campaignId: string,
  clientRequestId: string,
  quoteHash: string,
  quotedAt: string,
  expectedCostMinor: number | null,
  currency: string | null,
  scheduledFor: string | null,
  combined = false,
): Promise<ExistingBookResult | null> {
  const { data, error } = await supabase.rpc(
    "biz_marketing_book_existing_result_v1",
    {
      p_actor_id: actorId,
      p_campaign_id: campaignId,
      p_client_request_id: clientRequestId,
      p_quote_hash: quoteHash,
      p_quoted_at: quotedAt,
      p_expected_cost_minor: expectedCostMinor,
      p_currency: currency,
      p_scheduled_for: scheduledFor,
    },
  );
  if (error) throw new Error(error.message);
  const existing = data as ExistingBookResult | null;
  if (existing === null || !combined) return existing;
  // #4273 — the replay answer hides the same difference the first answer did.
  return {
    ...existing,
    sealedReachable: Math.max(
      existing.sealedReachable -
        await combinedHiddenSkips(supabase, campaignId),
      existing.messageRows,
    ),
  };
}

export async function dispatchConfirmedBookSend(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  campaignId: string,
  scheduledFor: string | null,
  options: DispatchOptions,
  dispatcher: CampaignDispatcher = dispatchByKind,
): Promise<DispatchBatchSummary | null> {
  if (scheduledFor !== null) return null;
  const claimed = await claimCampaigns(supabase, campaignId);
  return await processClaimedCampaigns(
    supabase,
    claimed,
    options,
    dispatcher,
  );
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
    case "push":
      // #3682 wave 2 — push lane through the shared notify pipeline.
      return await sendPushCampaign(supabase, campaign);
    case "sms":
      // META-ORCH-1161 Sub-B — real SMS dispatch via the Sub-A smsAdapter.
      // The per-market kill-switch (SMS_LIVE_ENABLED_US/_NG, default false)
      // lives inside smsAdapter: when off it returns status='skipped' WITHOUT
      // any Twilio HTTP, so this ships text-dark until the operator flips it.
      // (The Phase-A sentinel string "sms_not_yet_enabled" is retired here.)
      return await sendSms(supabase, campaign, options);
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
  // #3682 — never send under brand A to an audience owned by brand B, or whose
  // query_definition resolves buyers for another brand.
  assertAudienceMatchesCampaignBrand(audience.brand_id, campaign.brand_id);
  await assertAudienceQueryMatchesCampaignBrand(
    supabase,
    audience.query_definition,
    campaign.brand_id,
  );

  const { data: brandRow, error: brandErr } = await supabase
    .from("brands")
    // #2485 — contact_email becomes the blast's Reply-To when the brand has one.
    .select("id, name, slug, contact_email, cover_media_url, cover_media_type")
    .eq("id", campaign.brand_id)
    .maybeSingle();
  if (brandErr) throw new Error(`brand_load:${brandErr.message}`);
  // The brands table column is `name` (not `display_name` — that's the
  // mobile-side camelCased property mapped through the Brand type).
  const brandRowTyped = brandRow as {
    name?: string;
    slug?: string | null;
    contact_email?: string | null;
    cover_media_url?: string | null;
    cover_media_type?: string | null;
  } | null;
  const brandName: string = brandRowTyped?.name ?? "Mingla brand";
  // #2485 — a reply must reach a human. The brand's own address when it has
  // one, otherwise Mingla support; never the unmonitored <slug>@usemingla.com
  // From alias, which has no mailbox and bounces.
  const brandContactEmail = (brandRowTyped?.contact_email ?? "").trim();
  const brandReplyTo = brandContactEmail.includes("@")
    ? brandContactEmail
    : FALLBACK_REPLY_TO;
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

  // Per-brand sender address on the dedicated campaign domain. Transactional
  // mail remains isolated on the untracked apex domain.
  // Display name is the actual brand name (Resend accepts the standard
  // `Name <addr>` From header).
  const brandEmailLocal = campaignSenderLocalPart(brandSlug ?? brandName);
  if (brandEmailLocal.length === 0) {
    throw new Error("campaign_sender_local_part_empty");
  }
  // The angle brackets here are RFC 5322 From-header syntax (`Name <addr>`),
  // not HTML. Local aliases avoid the ORCH-0785-C `brand*` prefix heuristic
  // which would otherwise (falsely) demand escapeHtml on a non-HTML string.
  const fromDisplay = brandName;
  const fromLocal = brandEmailLocal;
  const brandFromHeader =
    `${fromDisplay} <${fromLocal}@campaigns.usemingla.com>`;

  const embedded = await loadEmbeddedEvents(
    supabase,
    campaign.channel_payload.embedded_events ?? [],
  );

  // 2. Resolve audience via shared helper (service-role bypasses RLS).
  const resolved = await resolveAudience(
    supabase,
    audience.query_definition,
    campaign.id,
  );

  // 3. Per-recipient send loop.
  const subject = campaign.channel_payload.subject ?? "";
  const bodyHtml = campaign.channel_payload.body_html ?? "";
  const bodyText = campaign.channel_payload.body_text ?? "";

  // issue #2291 — THE LAST LINE BEFORE A REAL CUSTOMER INBOX. DO NOT REMOVE.
  //
  // Nothing upstream of here refuses an empty email. The DB CHECK added by
  // #2291 is deliberately `NOT VALID`, so every row that already existed when
  // it landed can still carry an empty body; the claim RPC
  // (`mkt_claim_campaigns`) reads zero content; `biz_confirm_marketing_book_
  // send_v1` compares the payload only against its own quote snapshot, which an
  // empty payload matches; the renderer and `postToResend` send whatever they
  // are handed. And the last hop needs no human: cron job
  // `orch_0815_b_marketing_send` fires every minute under the service role and
  // dispatches whatever is `scheduled`. This throw is the only thing between
  // that cron and a blank email in a paying customer's inbox.
  //
  // It mirrors `sms_body_empty` in `sendSms` below — the same rule the SMS
  // branch has always had, on the channel that actually reaches buyers.
  //
  // Placement is contractual: BEFORE the recipient loop and therefore before
  // the first `marketing_messages` INSERT, so a refused campaign writes no
  // message rows and issues no provider HTTP. `processClaimedCampaigns` catches
  // this and flips the campaign to `status='failed'` — a whole-campaign refusal,
  // never a partial send.
  //
  // SUBJECT IS REQUIRED HERE AND NOT AT THE DB CHECK, deliberately (Seth's call
  // on #2291): an email arriving with a blank subject line is its own
  // deliverability and trust problem, but failing it closed at DISPATCH refuses
  // the send without stranding a half-finished draft the operator is still
  // editing. The constraint stays permissive about `subject` on purpose — do
  // not "reconcile" the two by relaxing this guard.
  if (bodyHtml.trim().length === 0) throw new Error("email_body_empty");
  if (subject.trim().length === 0) throw new Error("email_subject_empty");

  const isOfferingAudience = audience.query_definition.kind ===
    "offering_send_group";
  if (bodyHtml.includes(OFFERING_LINK_MARKER) !== isOfferingAudience) {
    throw new Error("offering_invite_volatile_link_invalid");
  }

  // #4273 — the send snapshot: write-once, best-effort, never blocks a send.
  // After every guard above (a refused campaign writes none), before the first
  // recipient row. Per-campaign values only (I-4273-SENT-VIEW-NO-CONTACTS).
  {
    const campaignVars = buildVariables(SNAPSHOT_NO_GUEST, brandName, embedded);
    await writeSentSnapshot(
      supabase,
      campaign.id,
      buildEmailSnapshot({
        brandName,
        brandSlug,
        subject,
        bodyHtml,
        fromDisplay,
        fromAddress: `${fromLocal}@campaigns.usemingla.com`,
        replyToIsBrand: brandContactEmail.includes("@"),
        headerImageUrl: brandHeaderImageUrl,
        followUrl: brandSlug !== null && brandSlug.length > 0
          ? brandFollowPublicUrl(brandSlug)
          : null,
        campaignVariables: {
          brand_name: brandName,
          event_date: campaignVars.event_date,
          event_date_short: campaignVars.event_date_short,
          ends_at: campaignVars.ends_at,
          event_url: campaignVars.event_url,
          next_event_name: campaignVars.next_event_name,
          event_id: campaignVars.event_id,
        },
        embedded,
      }),
    );
  }
  let previewSkipped = 0;
  let sent = 0;
  let deferredCount = 0;

  // #2509 — RESUME. A campaign that ran out of wall clock, or whose isolate
  // was killed, comes back through the claim predicate. Without this it would
  // rebuild the whole audience and re-send to everyone already reached:
  // recovering the 8 stranded recipients of `f770996f` by replay would have
  // emailed the 189 who already had it a SECOND time. The unique index added
  // in 20270525002509 makes that structurally impossible now, but relying on a
  // constraint violation to stop a duplicate send is not a plan — we skip them.
  const alreadyHandled = new Set<string>();
  const reusable = new Map<string, ReusableRow>();
  {
    const { data: priorRows, error: priorErr } = await supabase
      .from("marketing_messages")
      .select("id,recipient_email,status,attempt_count")
      .eq("campaign_id", campaign.id)
      .eq("channel", "email");
    if (priorErr) throw new Error(`resume_scan:${priorErr.message}`);
    for (const row of (priorRows ?? []) as EmailResumeRow[]) {
      if (row.recipient_email === null) continue;
      const key = row.recipient_email.toLowerCase();
      if (RESUME_TERMINAL_STATUSES.has(row.status)) {
        alreadyHandled.add(key);
      } else {
        // `deferred` / `queued` — the recipients this pass exists to pick up.
        // Their row must be REUSED: the unique index added in
        // 20270525002509 means a second INSERT for the same
        // (campaign, email) now fails, and inserting a duplicate was the
        // double-send bug in the first place.
        reusable.set(key, { id: row.id, attemptCount: row.attempt_count ?? 0 });
      }
    }
  }

  // #2509 — WALL-CLOCK BUDGET. Both 2026-08-24 runs died at ~196s, mid-loop,
  // with no finalize and no record of where they got to. Stopping ourselves
  // BEFORE the runtime does is what turns "killed and wedged" into "paused and
  // resumable": we hand the campaign back as `scheduled`, and the every-minute
  // cron picks it up within 60s.
  const runStartedAt = Date.now();
  let heartbeatCountdown = HEARTBEAT_EVERY;
  let budgetExhausted = false;

  for (const contact of resolved.rows) {
    if (
      contact.raw_email !== null &&
      alreadyHandled.has(contact.raw_email.toLowerCase())
    ) continue;

    if (Date.now() - runStartedAt > SEND_BUDGET_MS) {
      budgetExhausted = true;
      break;
    }
    if (--heartbeatCountdown <= 0) {
      heartbeatCountdown = HEARTBEAT_EVERY;
      // Proves this isolate is alive so the 10-minute reclaim predicate cannot
      // steal a campaign from a healthy long run. Best-effort: a missed
      // heartbeat costs at worst one reclaimed pass, which resume makes safe.
      await supabase.rpc("mkt_heartbeat_campaign", {
        p_campaign_id: campaign.id,
      }).then(() => undefined, () => undefined);
    }

    if (!contact.email_marketing_ok || contact.raw_email === null) {
      // Skip contacts whose email channel is suppressed. Do NOT write
      // a marketing_messages row — the campaign report should reflect
      // "deliverable audience" not "all audience".
      continue;
    }
    const inviteContext = offeringContext(contact, audience.query_definition);

    // #2509 — reuse the row from a previous pass when there is one, so a
    // resumed recipient keeps their identity and attempt history instead of
    // colliding with the unique index added in 20270525002509.
    const priorRow = contact.raw_email === null
      ? undefined
      : reusable.get(contact.raw_email.toLowerCase());
    const priorAttempts = priorRow?.attemptCount ?? 0;
    const messageId = priorRow?.id ?? crypto.randomUUID();
    const unsubscribeToken = await signUnsubscribeToken({
      campaign_id: campaign.id,
      recipient_email: contact.raw_email,
      brand_id: campaign.brand_id,
    });
    const unsubscribeUrl = `${getUnsubscribeOrigin()}/${unsubscribeToken}`;

    // #3682 — skip reserved / example domains before Resend (reputation).
    if (
      contact.raw_email !== null &&
      isUndeliverableEmailDomain(contact.raw_email)
    ) {
      continue;
    }
    const variables = buildVariables(contact, brandName, embedded);
    const brandFollowUrl = brandSlug !== null && brandSlug.length > 0
      ? brandFollowPublicUrl(brandSlug)
      : null;
    const rendered = renderMarketingEmail({
      body_html: bodyHtml,
      variables,
      embedded_events: embedded,
      unsubscribe_url: unsubscribeUrl,
      subject: substituteString(subject, variables),
      brand_name: brandName,
      brand_header_image_url: brandHeaderImageUrl,
      brand_follow_url: brandFollowUrl,
      offering_invite_url_marker: inviteContext === null
        ? undefined
        : OFFERING_LINK_MARKER,
    });
    if (
      rendered.links.some((link) =>
        link.destination_url.includes("oi=") ||
        link.destination_url.includes(OFFERING_LINK_MARKER)
      )
    ) throw new Error("offering_invite_volatile_link_invalid");

    // Row for this recipient — INSERT on a first pass, reset to `queued` on a
    // resume. Never a second INSERT for the same (campaign, email): that
    // duplicate WAS the double-send bug, and the unique index now refuses it.
    if (priorRow === undefined) {
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
    } else {
      const { error: reErr } = await supabase
        .from("marketing_messages")
        .update({ status: "queued", next_attempt_at: null })
        .eq("id", messageId);
      if (reErr) throw new Error(`message_resume:${reErr.message}`);
    }

    // INSERT marketing_clicks rows (one per rewritten href). On a resume the
    // previous pass's unclicked rows are dropped first: their tracking ids
    // belong to an email that was never delivered, and leaving them would
    // inflate the link count on the campaign report.
    if (priorRow !== undefined) {
      await supabase.from("marketing_clicks").delete()
        .eq("message_id", messageId).is("clicked_at", null);
    }
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
    let providerClaimed = false;
    let providerHtml = rendered.html;
    let providerText = rendered.text;
    let offeringTokenId: string | null = null;
    let offeringProviderKey: string | null = null;
    if (inviteContext !== null) {
      const eventUrl = embedded.find((event) =>
        event.id === inviteContext.event_id
      )
        ?.url;
      if (eventUrl === undefined) {
        throw new Error("offering_invite_volatile_link_invalid");
      }
      const prepared = await prepareOfferingLink(
        supabase,
        inviteContext,
        eventUrl,
      );
      providerHtml = replaceSingleMarker(
        rendered.html,
        escapeOfferingUrlForHtml(prepared.url),
      );
      providerText = replaceSingleMarker(rendered.text, prepared.url);
      offeringTokenId = prepared.tokenId;
      offeringProviderKey = `offering:${inviteContext.attempt_id}:email:v1`;
    }
    const sendOutcome = await postToResend({
      apiKey: options.resendApiKey,
      from: brandFromHeader,
      to: contact.raw_email,
      subject: rendered.subject,
      html: providerHtml,
      text: providerText,
      replyTo: brandReplyTo,
      unsubscribeUrl,
      // #4273 — the provider's own guard for the one window resume cannot see:
      // accepted by Resend, then killed before the row was written. A reclaimed
      // pass repeating this request gets the first answer, not a second email.
      idempotencyKey: offeringProviderKey ??
        `campaign:${campaign.id}:${contact.raw_email.toLowerCase()}`,
      beforeProviderIo: inviteContext === null || offeringTokenId === null
        ? undefined
        : async () => {
          await claimOfferingProviderIo(
            supabase,
            inviteContext,
            offeringTokenId,
            "email",
          );
          providerClaimed = true;
        },
    });
    if (sendOutcome.ok) {
      await persistEmailSentTerminal(
        supabase,
        messageId,
        sendOutcome.providerId,
      );
      sent += 1;
    } else if (providerClaimed && inviteContext !== null) {
      await supabase.from("brand_offering_invite_delivery_attempts").update({
        safe_reason_code: "provider_outcome_unknown",
        is_retryable: false,
      }).eq("id", inviteContext.attempt_id);
    } else if (sendOutcome.retryable === true) {
      // #2509 — the address is fine; the provider was busy or out of quota.
      // Writing this `failed` is precisely what burned 21 invitees on
      // 2026-08-24 with no path back. `next_attempt_at` and `attempt_count`
      // have existed on this table since ORCH-1270 and were simply never
      // written by the email path.
      const waitSeconds = sendOutcome.retryAfterSeconds ?? 300;
      await supabase
        .from("marketing_messages")
        .update({
          status: "deferred",
          failure_reason: sendOutcome.error,
          next_attempt_at: new Date(Date.now() + waitSeconds * 1000)
            .toISOString(),
          attempt_count: priorAttempts + 1,
        })
        .eq("id", messageId);
      deferredCount += 1;
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

  // #2509 — a paused run must come back. `mkt_finalize_campaign` already sends
  // a campaign with deferred recipients to `scheduled` with the earliest
  // `next_attempt_at`; a budget stop needs the same treatment WITHOUT waiting
  // on a provider clock, so it goes back on the very next cron minute.
  if (budgetExhausted) {
    await supabase
      .from("marketing_campaigns")
      .update({
        status: "scheduled",
        scheduled_for: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", campaign.id);
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

  // ORCH-1270 — return-shape adaptation ONLY (DispatchOutcome changed per SPEC
  // §5.1). Email NEVER defers and its send logic is UNCHANGED: delivered = live
  // sends, preview_skipped = preview-gate skips. The finalizer recomputes truth
  // from marketing_messages, so these counts drive only the JSON response body.
  return {
    delivered: sent,
    // #2509 — email DOES defer now. The old comment here said "email NEVER
    // defers" and hard-coded 0; that was true only because a 429'd recipient
    // was written off instead.
    deferred: deferredCount,
    failed: 0,
    preview_skipped: previewSkipped,
    budget_paused: budgetExhausted,
  };
}

// ---------------------------------------------------------------------------
// META-ORCH-1161 Sub-B — SMS marketing dispatch.
// ---------------------------------------------------------------------------

interface SmsContact {
  raw_phone: string | null;
  sms_marketing_ok: boolean;
  offering_invite?: OfferingInviteContext;
}

// Region derivation (for quiet-hours + kill-switch routing) comes from the
// E.164 phone prefix, since orders carry no buyer country column.
//
// #1529 — the module-private copy that used to live HERE has been DELETED in
// favour of the shared `_shared/e164Country.ts` helper imported at the top of
// this file. The repo carried THREE mutually inconsistent copies of this rule
// (#1529 F-7) and no single source of truth, which is how the notification
// pipeline ended up with a country column that no two layers agreed on.
//
// #4273 — every payout country now maps (and Canada splits from +1 by area
// code). Each has its own quiet-hours window (SMS_COUNTRIES) and its own
// SMS switch (sms_live_enabled.<cc>, off until set). An unmapped prefix still
// returns null → quiet-hours fails it closed (unknown_timezone).

/**
 * Branded short links (SPEC §6.7): rewrite every http(s) URL in the SMS body
 * into a Mingla-hosted /m/{tracking_id} redirect handled by marketing-track-click
 * — NEVER a public shortener. Each rewritten link gets a marketing_clicks row so
 * attribution + per-campaign click tracking works identically to email.
 */
// #4273 — the US/CA area-code zone tables moved to _shared/smsCountries.ts,
// beside every other country's window.

/**
 * Resolve the recipient-local IANA timezone(s) for quiet-hours evaluation.
 * #4273 — every mapped country has a row in SMS_COUNTRIES; US and CA resolve
 * the zone from the NANP area code; a country or area code Mingla cannot
 * place returns null (fail closed: unknown_timezone). A number that can be in
 * several zones returns the first; the window check uses all of them.
 */
function resolveRecipientTz(
  phone: string,
  countryCode: string | null,
): string | null {
  return smsLocalZones(phone, countryCode)?.[0] ?? null;
}

/**
 * Marketing quiet hours. True only when it is INSIDE the country's local
 * window in every zone the number can be in (FR also never on a Sunday). An
 * unknown market or zone conservatively DENIES.
 */
function isWithinQuietHours(
  phone: string,
  countryCode: string | null,
  now: Date,
): boolean {
  return isWithinSmsWindow(phone, countryCode, now);
}

/**
 * #4273 — is this campaign a sealed Blast (it has a confirmed execution)?
 * A read error counts as sealed: the cautious answer writes no extra rows.
 * `scheduledFor` is the execution's own scheduled time (null when unknown).
 */
async function sealedBookSend(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  campaignId: string,
): Promise<{ sealed: boolean; scheduledFor: string | null }> {
  try {
    const { data, error } = await supabase
      .from("marketing_book_send_executions")
      .select("id, scheduled_for")
      .eq("campaign_id", campaignId)
      .maybeSingle();
    if (error) return { sealed: true, scheduledFor: null };
    if (data === null || data === undefined) {
      return { sealed: false, scheduledFor: null };
    }
    const at = (data as { scheduled_for?: unknown }).scheduled_for;
    return { sealed: true, scheduledFor: typeof at === "string" ? at : null };
  } catch {
    return { sealed: true, scheduledFor: null };
  }
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
  // #3682 — never send under brand A to an audience owned by brand B, or whose
  // query_definition resolves buyers for another brand.
  assertAudienceMatchesCampaignBrand(audience.brand_id, campaign.brand_id);
  await assertAudienceQueryMatchesCampaignBrand(
    supabase,
    audience.query_definition,
    campaign.brand_id,
  );

  const { data: brandRow, error: brandErr } = await supabase
    .from("brands")
    .select("id, name, slug")
    .eq("id", campaign.brand_id)
    .maybeSingle();
  if (brandErr) throw new Error(`brand_load:${brandErr.message}`);
  const brandRowSms = brandRow as { name?: string; slug?: string | null } | null;
  const brandName: string = brandRowSms?.name ?? "Mingla brand";
  const brandSlugSms: string | null = brandRowSms?.slug ?? null;

  // 2. Resolve audience (service-role bypasses RLS). reachable_sms is now truthful
  //    (Sub-B phone-suppression fix in marketingAudience.ts).
  const resolved = await resolveAudience(
    supabase,
    audience.query_definition,
    campaign.id,
  );

  const rawBodyBase = (campaign.channel_payload.body ?? "").trim();
  if (rawBodyBase.length === 0) throw new Error("sms_body_empty");
  // #3682 — Follow is opt-in; quote, preview, and dispatch use the same flag.
  const rawBody = smsBlastBodyWithFollow(
    rawBodyBase,
    brandName,
    campaign.channel_payload.include_follow_cta === true ? brandSlugSms : null,
  );
  const isOfferingAudience = audience.query_definition.kind ===
    "offering_send_group";
  if (rawBody.includes(OFFERING_LINK_MARKER) !== isOfferingAudience) {
    throw new Error("offering_invite_volatile_link_invalid");
  }
  const embedded = await loadEmbeddedEvents(
    supabase,
    campaign.channel_payload.embedded_events ?? [],
  );

  // ORCH-1282 — MMS media. A passenger on the existing send: it rides the Twilio
  // MediaUrl param (US only); the NG/Termii branch inside the adapter never
  // receives it. Does NOT alter disposition/dedupe (all ORCH-1270 logic below
  // is byte-for-byte unchanged).
  const mediaUrls = Array.isArray(campaign.channel_payload.media_urls)
    ? campaign.channel_payload.media_urls.filter(
      (u) => typeof u === "string" && u.length > 0,
    )
    : [];

  // #4273 — the send snapshot: write-once, best-effort, never blocks a send.
  // After the empty-body and link guards, before the first recipient row. The
  // wire text is the one the segment count below measures, with one sample
  // short link in place of each guest's own (I-4273-SENT-VIEW-NO-CONTACTS).
  try {
    const sample = rewriteMarketingSmsLinks(
      rawBody,
      resolveMarketingTrackingOrigin(),
      () => SAMPLE_TRACKING_ID,
    );
    const primaryEventUrl = embedded[0]?.url ?? null;
    const sampleBody = isOfferingAudience && primaryEventUrl !== null
      ? replaceSingleMarker(sample.rewritten, inertOfferingUrl(primaryEventUrl))
      : sample.rewritten;
    await writeSentSnapshot(
      supabase,
      campaign.id,
      buildSmsSnapshot({
        brandName,
        brandSlug: brandSlugSms,
        bodyAsAuthored: rawBodyBase,
        wireText: composeSmsBody(sampleBody, true),
        mediaUrls,
        followIncluded: rawBody !== rawBodyBase,
        linksShortened: sample.links.length > 0,
      }),
    );
  } catch (error) {
    console.error(
      `[#4273] sent_snapshot_build_failed campaign=${campaign.id}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // #4273 — the marketing Messaging Service holds the alphanumeric "Mingla"
  // sender and no number. It is used ONLY for alphanumeric countries: US and
  // CA texts stay on the toll-free (transactional) service, which the US and
  // Canada require; NG goes to Termii. An alphanumeric country with no
  // marketing service configured is never textable (smsCountryTextableNow),
  // so it never falls back to the toll-free number.
  const marketingSidRaw = Deno.env.get("TWILIO_MARKETING_MESSAGING_SERVICE_SID")
    ?.trim() ?? "";
  const marketingSid = marketingSidRaw.length > 0 ? marketingSidRaw : null;

  // 3. Throttled batches.
  const deliverable = resolved.rows.filter(
    (c) => c.sms_marketing_ok && c.raw_phone !== null,
  ) as unknown as SmsContact[];

  let delivered = 0;
  let deferred = 0;
  let failed = 0;
  let previewSkipped = 0;
  const now = new Date();
  // #4273 — never attempt a phone the quote could not price. The quote sealed
  // such a phone as skipped (sms_unpriced_country); this guard holds the same
  // line at send with the same rule (smsRateForPhone, rate routes + the
  // country's own switch), so a send can never text an unpriced number, even
  // before that seal exists or if the book loses a country after confirm.
  //
  // FAIL SAFE (tester P3): when the book cannot be read at all, nothing is
  // texted — Mingla cannot know any number is priced. That is never silent:
  // it is logged, and a buyer-list (legacy, unsealed) send records each
  // number as failed 'sms_rate_book_unavailable' so the host's report says
  // so. A sealed Blast records nothing extra: its sealed-but-unsent people
  // already read as "couldn't be reached".
  //
  // Unpriced numbers on a legacy send are recorded too
  // ('sms_unpriced_country'), so the host sees them (tester P3). A sealed
  // Blast never reaches here with them once the seal migration is applied.
  //
  // #4273 tester P3: an unreadable price table is transient. It is read up to
  // three times; if it still cannot be read on a SEALED send, the pass stops
  // before any recipient and the campaign is re-parked for a later pass
  // (retry_later), instead of skipping everyone and finalizing as failed.
  //
  // A legacy (unsealed buyer-list) send is NOT re-parked, deliberately: it has
  // no execution and so no fixed time to cap the wait against (re-parking
  // moves the campaign's own time), so parking it could wait forever. It
  // records each number as failed 'sms_rate_book_unavailable' instead, which
  // the host sees on the campaign and can resend from; nothing is texted.
  let smsRoutes = options.smsRoutes !== undefined
    ? options.smsRoutes
    : await loadSmsRoutes(supabase);
  for (
    let attempt = 1;
    smsRoutes === null && options.smsRoutes === undefined && attempt < 3;
    attempt += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    smsRoutes = await loadSmsRoutes(supabase);
  }
  const sealed = await sealedBookSend(supabase, campaign.id);
  const sealedSend = sealed.sealed;
  if (smsRoutes === null) {
    console.error(JSON.stringify({
      event: "marketing_sms_rate_book_unreadable",
      campaign_id: campaign.id,
      retry: sealedSend,
    }));
    if (sealedSend) {
      // #4273 tester retest 3 — not forever. A day past the execution's own
      // time the send fails (the catch in processClaimedCampaigns marks it
      // failed and writes the Book failure marker), so the host sees it and
      // can send again. Ops hear about it once, on the first re-park.
      const scheduledAt = sealed.scheduledFor === null
        ? Number.NaN
        : Date.parse(sealed.scheduledFor);
      const nowMs = Date.now();
      if (
        Number.isFinite(scheduledAt) &&
        nowMs - scheduledAt > SMS_PRICE_RETRY_LIMIT_MS
      ) {
        throw new Error("sms_price_table_unreadable_24h");
      }
      const parkedAt = campaign.scheduled_for === null
        ? Number.NaN
        : Date.parse(campaign.scheduled_for);
      const firstPark = !Number.isFinite(scheduledAt) ||
        !Number.isFinite(parkedAt) ||
        parkedAt - scheduledAt < SMS_PRICE_FIRST_PARK_WINDOW_MS;
      if (firstPark) {
        try {
          await (options.opsAlert ?? alertSmsPriceTableUnreadable)(
            "[SMS] A Blast is waiting: SMS prices can't be read",
            [
              `Campaign ${campaign.id} could not read public.sms_country_prices, so nothing was texted. It retries every 10 minutes.`,
              "If prices still can't be read 24 hours after its scheduled time, it fails and the host is told.",
            ],
          );
        } catch {
          console.error(JSON.stringify({
            event: "marketing_sms_price_alert_failed",
            campaign_id: campaign.id,
          }));
        }
      }
      return {
        delivered: 0,
        deferred: 0,
        failed: 0,
        preview_skipped: 0,
        retry_later: true,
      };
    }
  }
  // A supplied (test) route list is taken as switched on; production reads
  // each country's own switch.
  const smsLiveAtSend = options.smsRoutes !== undefined
    ? () => true
    : smsCountryTextableNow;
  let unpricedSkipped = 0;

  for (let i = 0; i < deliverable.length; i += SMS_BATCH_SIZE) {
    const batch = deliverable.slice(i, i + SMS_BATCH_SIZE);
    for (const contact of batch) {
      const phone = contact.raw_phone;
      if (phone === null || !isValidE164(phone.trim())) {
        // Non-E.164 phone — skip, do NOT write a row (mirrors email's
        // suppressed-skip discipline: report deliverable, not total).
        continue;
      }
      const countryCode = smsMarketingCountry(phone);
      const inviteContext = offeringContext(
        contact as ResolvedContact,
        audience.query_definition,
      );
      const eventUrl = inviteContext === null
        ? null
        : embedded.find((event) => event.id === inviteContext.event_id)?.url ??
          null;
      if (inviteContext !== null && eventUrl === null) {
        throw new Error("offering_invite_volatile_link_invalid");
      }

      // ORCH-1270 RC-1 + F-DS-1 — idempotency guard (SPEC §5.1 rule 1). Read the
      // existing row for (campaign, phone), INCLUDING provider_message_id. If it is
      // already TERMINAL *or* already DISPATCHED (non-null provider_message_id), SKIP
      // entirely: no write, no send, no clicks — so cron re-invocation can never
      // re-dispatch a recipient who already sent/failed OR whose message already
      // reached Twilio (even if a lost terminal write left the row at 'queued'). The
      // decideSmsDisposition helper is only consulted for a fresh (null) or retryable
      // 'deferred' row.
      const { data: existing, error: selErr } = await supabase
        .from("marketing_messages")
        .select("id, status, attempt_count, created_at, provider_message_id")
        .eq("campaign_id", campaign.id)
        .eq("recipient_phone", phone)
        .maybeSingle();
      if (selErr) throw new Error(`message_select:${selErr.message}`);
      if (shouldSkipDispatchedRecipient(existing)) {
        continue;
      }
      const unpricedReason = smsRoutes === null
        ? "sms_rate_book_unavailable"
        : smsRateForPhone(phone.trim(), smsRoutes, smsLiveAtSend) === null
        ? SMS_UNPRICED_COUNTRY
        : null;
      if (unpricedReason !== null) {
        unpricedSkipped += 1;
        // #4273 tester: a sealed recipient who already has a row (deferred by
        // quiet hours on an earlier pass) must be closed out, or the deferred
        // row keeps the campaign re-scheduled forever once their country can
        // no longer be texted. A fresh sealed recipient still writes nothing.
        // An unreadable price table is transient: leave the row for a retry.
        const closeOutSealed = existing !== null && existing !== undefined &&
          unpricedReason === SMS_UNPRICED_COUNTRY;
        if (!sealedSend || closeOutSealed) {
          const { error: skipErr } = await supabase
            .from("marketing_messages")
            .upsert(
              {
                campaign_id: campaign.id,
                recipient_phone: phone,
                channel: "sms",
                status: "failed",
                failure_reason: unpricedReason,
              },
              { onConflict: "campaign_id,recipient_phone" },
            );
          if (skipErr) throw new Error(`message_upsert:${skipErr.message}`);
          failed += 1;
        }
        continue;
      }
      // #4273 — Twilio has no idempotency key. A row already `queued` when a pass
      // starts was left by a run that died around the provider call, so it may
      // have gone out. Reclaim must not text and charge twice: record it as
      // unconfirmed and move on.
      if (isInterruptedSmsRow(existing)) {
        const { error: interruptedErr } = await supabase
          .from("marketing_messages")
          .update({
            status: "failed",
            failure_reason: "interrupted_send_unconfirmed",
          })
          .eq("campaign_id", campaign.id)
          .eq("recipient_phone", phone)
          .eq("status", "queued");
        if (interruptedErr) {
          throw new Error(`message_interrupted:${interruptedErr.message}`);
        }
        failed += 1;
        continue;
      }

      // ORCH-1270 RC-1 — quiet-hours DEFER (not terminal fail). TZ is derived
      // from the phone (US area code; NG = Lagos), not a fixed Eastern anchor.
      const disposition = decideSmsDisposition(
        phone,
        countryCode,
        now,
        existing,
      );

      if (disposition.action === "fail") {
        // Terminal + honest: unresolvable tz OR aged/attempt-capped past the
        // defer bound. No provider call. UPSERT so a re-pick over an existing
        // 'deferred' row transitions it cleanly (double-send guarded by the
        // uq_mkt_msg_campaign_phone unique index).
        const { error: upFailErr } = await supabase
          .from("marketing_messages")
          .upsert(
            {
              campaign_id: campaign.id,
              recipient_phone: phone,
              channel: "sms",
              status: "failed",
              failure_reason: disposition.reason,
            },
            { onConflict: "campaign_id,recipient_phone" },
          );
        if (upFailErr) throw new Error(`message_upsert:${upFailErr.message}`);
        failed += 1;
        continue;
      }

      if (disposition.action === "defer") {
        // Held for the next in-window pass. failure_reason kept as an
        // informational label; status='deferred' carries the real meaning.
        const { error: upDeferErr } = await supabase
          .from("marketing_messages")
          .upsert(
            {
              campaign_id: campaign.id,
              recipient_phone: phone,
              channel: "sms",
              status: "deferred",
              next_attempt_at: disposition.next_attempt_at,
              attempt_count: disposition.attempt_count,
              failure_reason: "quiet_hours_deferred",
            },
            { onConflict: "campaign_id,recipient_phone" },
          );
        if (upDeferErr) throw new Error(`message_upsert:${upDeferErr.message}`);
        deferred += 1;
        continue;
      }

      // disposition.action === "send" — in-window: existing send path.
      // Branded links + per-link click rows.
      const { rewritten, links } = rewriteMarketingSmsLinks(
        rawBody,
        resolveMarketingTrackingOrigin(),
        generateTrackingId,
      );
      if (
        links.some((link) =>
          link.destination_url.includes("oi=") ||
          link.destination_url.includes(OFFERING_LINK_MARKER)
        )
      ) throw new Error("offering_invite_volatile_link_invalid");
      const segmentBody = inviteContext === null || eventUrl === null
        ? rewritten
        : replaceSingleMarker(rewritten, inertOfferingUrl(eventUrl));
      // #4273 — a number whose sender cannot take a "STOP" reply gets a
      // branded, fixed-length opt-out link instead (the quote measured the
      // same length, so quote = send). It is a tracked short link; its
      // destination (the signed opt-out URL) is built below once the message
      // id is known, and names the message, never the number.
      const optOutTrackingId = smsCountryProfile(countryCode)?.replyable === false
        ? generateTrackingId()
        : null;
      const optOutLink = optOutTrackingId === null
        ? undefined
        : `${resolveMarketingTrackingOrigin()}/${optOutTrackingId}`;
      const segments = computeSegments(
        composeSmsBody(segmentBody, true, optOutLink),
      );

      // UPSERT the queued row (∅→queued or deferred→queued). onConflict clears
      // next_attempt_at so a formerly-deferred row is no longer due.
      const { data: upserted, error: upQueuedErr } = await supabase
        .from("marketing_messages")
        .upsert(
          {
            campaign_id: campaign.id,
            recipient_phone: phone,
            channel: "sms",
            status: "queued",
            segments,
            next_attempt_at: null,
          },
          { onConflict: "campaign_id,recipient_phone" },
        )
        .select("id")
        .maybeSingle();
      if (upQueuedErr) throw new Error(`message_upsert:${upQueuedErr.message}`);
      const messageId = (upserted as { id: string }).id;

      // #4273 P1 — the opt-out destination carries {campaign, brand,
      // message} only: campaign members can read marketing_clicks, so no
      // contact may land in it. It is stored as link_kind 'opt_out', which the
      // members' read and the engagement counts never see.
      const clickLinks: Array<
        { tracking_id: string; destination_url: string; link_kind?: "opt_out" }
      > = optOutTrackingId === null ? links : [
        ...links,
        {
          tracking_id: optOutTrackingId,
          // #4273 retest 3: the human page in mingla-marketing, not the
          // function (Supabase serves function GETs as text/plain).
          destination_url: `${getUnsubscribeOrigin()}/sms/${await signSmsUnsubscribeToken(
            {
              campaign_id: campaign.id,
              brand_id: campaign.brand_id,
              message_id: messageId,
            },
          )}`,
          link_kind: "opt_out",
        },
      ];
      if (clickLinks.length > 0) {
        // Clicks are written only on the actual send pass (a deferred row wrote
        // none). Each send re-runs rewriteMarketingSmsLinks producing fresh unique
        // tracking_ids — no dup because a recipient sends at most once.
        const { error: insClicksErr } = await supabase
          .from("marketing_clicks")
          .insert(
            clickLinks.map((link) => ({
              campaign_id: campaign.id,
              message_id: messageId,
              destination_url: link.destination_url,
              tracking_id: link.tracking_id,
              ...(link.link_kind === undefined
                ? {}
                : { link_kind: link.link_kind }),
            })),
          );
        if (insClicksErr) {
          throw new Error(`clicks_insert:${insClicksErr.message}`);
        }
      }

      if (!options.live) {
        await supabase
          .from("marketing_messages")
          .update({ status: "preview_skipped" })
          .eq("id", messageId);
        previewSkipped += 1;
        continue;
      }

      let providerMessage = rewritten;
      let offeringTokenId: string | null = null;
      let providerClaimed = false;
      if (inviteContext !== null && eventUrl !== null) {
        const prepared = await prepareOfferingLink(
          supabase,
          inviteContext,
          eventUrl,
        );
        providerMessage = replaceSingleMarker(rewritten, prepared.url);
        offeringTokenId = prepared.tokenId;
      }

      // Live path — adapter enforces the per-market kill-switch internally;
      // when SMS_LIVE_ENABLED_<MKT> is off it returns status='skipped' with
      // ZERO Twilio HTTP, so even LIVE marketing-send is text-dark until flip.
      const result = await smsAdapter.send({
        to: phone.trim(),
        brandName,
        message: providerMessage,
        countryCode,
        messagingServiceSid:
          smsMarketingRoute(countryCode, marketingSid !== null) === "marketing"
            ? marketingSid
            : null,
        // ORCH-1227 (DEC-192) — NG marketing routes to Termii's `generic`
        // channel (Twilio ignores this field; reputation isolation there is the
        // separate marketing Messaging Service SID above).
        messageType: "marketing",
        // ORCH-1289 — marketing SMS puts the "Reply STOP to opt out." footer on
        // its own line (blank line + STOP line) so the delivered text matches
        // the composer preview. Wire-body change → marketing-send needs redeploy.
        stopFooterOwnLine: true,
        // #4273 — the opt-out link replaces "Reply STOP" where no reply works.
        ...(optOutLink === undefined ? {} : { optOutLink }),
        // ORCH-1282 — MMS media (US/Twilio only; the adapter's NG/Termii branch
        // ignores it → NG silently sends SMS-only). ORCH-1289 — up to 10 items.
        mediaUrls,
        beforeProviderIo: inviteContext === null || offeringTokenId === null
          ? undefined
          : async () => {
            await claimOfferingProviderIo(
              supabase,
              inviteContext,
              offeringTokenId,
              "sms",
            );
            providerClaimed = true;
          },
      });

      if (result.status === "sent") {
        // ORCH-1270 F-DS-1 — the adapter has DISPATCHED to Twilio
        // (provider_message_id returned): the point of no return. This terminal
        // write persists that id (and status='sent'); the in-loop guard above
        // treats a non-null provider_message_id as "already dispatched — never
        // re-send". This UPDATE's error was previously DISCARDED: a lost terminal
        // write left the row non-terminal ('queued') with a NULL
        // provider_message_id, and a deferred sibling re-parking the campaign to
        // 'scheduled' let cron re-pick and TEXT THE RECIPIENT A SECOND TIME. Now:
        // check the error, RETRY once (transient timeout/serialization usually
        // clears), and if it STILL fails THROW rather than leave a silently
        // re-sendable orphan. A throw aborts the campaign (caught by the serve loop
        // → marketing_campaigns.status='failed', which cron never re-picks), so a
        // dispatched recipient can never be re-selected. Loud failure > silent
        // double-send (SPEC §5.1 rule 1).
        const sentPatch = {
          status: "sent",
          sent_at: new Date().toISOString(),
          provider_message_id: result.providerMessageId,
          segments: result.segments ?? segments,
        };
        let { error: sentErr } = await supabase
          .from("marketing_messages")
          .update(sentPatch)
          .eq("id", messageId);
        if (sentErr) {
          ({ error: sentErr } = await supabase
            .from("marketing_messages")
            .update(sentPatch)
            .eq("id", messageId));
        }
        if (sentErr) {
          throw new Error(
            `sms_sent_terminal_update_lost:${messageId}:${
              sentErr.message ?? String(sentErr)
            }`,
          );
        }
        delivered += 1;
      } else if (providerClaimed && inviteContext !== null) {
        await supabase.from("brand_offering_invite_delivery_attempts").update({
          safe_reason_code: "provider_outcome_unknown",
          is_retryable: false,
        }).eq("id", inviteContext.attempt_id);
        failed += 1;
      } else {
        if (inviteContext !== null && offeringTokenId !== null) {
          await supabase.from("brand_offering_invite_tokens").update({
            revoked_at: new Date().toISOString(),
          }).eq("id", offeringTokenId);
        }
        // skipped (kill-switch) OR failed — record honestly; no silent drop. This
        // twin UPDATE is intentionally NOT gated the same way: neither branch
        // reached Twilio (skipped = kill-switch, no HTTP; failed = adapter reported
        // no dispatch), so a lost write here can only cause a RETRY of an unsent
        // recipient on the next pass, never a double-send (F-DS-1 is send-only).
        // #2218 — `deferred` maps to this table's EXISTING deferred state, the
        // one ORCH-1270 built for quiet hours, and counts as neither sent nor
        // failed. In practice the adapter's Nigerian embargo guard cannot fire
        // here: marketing SMS is already confined to 08:00–20:00 WAT, the exact
        // complement of the 20:00–08:00 embargo. The arm exists anyway because
        // the alternative — falling through to `failed` — would burn a campaign
        // recipient over a window change, and "unreachable today" is not a
        // reason to write a branch that lies tomorrow.
        //
        // NAMED SO IT IS NOT A SURPRISE IF THE WINDOWS EVER DIVERGE: this arm
        // shares the else-branch that revokes an offering invite token, and a
        // deferral is not a failure that should cost a token. It is harmless
        // today only because the guard cannot fire here. If NG marketing hours
        // are ever widened past 20:00 WAT, split this arm out ABOVE the token
        // revocation before doing so.
        await supabase
          .from("marketing_messages")
          .update({
            status: result.status === "skipped"
              ? "preview_skipped"
              : result.status === "deferred"
              ? "deferred"
              : "failed",
            failure_reason: result.error ?? "sms_unknown_error",
            // The column ORCH-1270 already uses to schedule a held recipient.
            // Written only on the deferred arm, so no other outcome acquires a
            // due-date it should not have.
            ...(result.status === "deferred" && result.retryAfter
              ? { next_attempt_at: result.retryAfter }
              : {}),
          })
          .eq("id", messageId);
        if (result.status === "skipped") previewSkipped += 1;
        else if (result.status === "deferred") deferred += 1;
        else failed += 1;
      }
    }
    // Pace between batches (skip the trailing pause).
    if (i + SMS_BATCH_SIZE < deliverable.length) {
      await new Promise((resolve) => setTimeout(resolve, SMS_BATCH_PAUSE_MS));
    }
  }

  if (unpricedSkipped > 0) {
    console.info(JSON.stringify({
      event: "marketing_sms_unpriced_skipped",
      campaign_id: campaign.id,
      count: unpricedSkipped,
    }));
  }
  return { delivered, deferred, failed, preview_skipped: previewSkipped };
}

if (import.meta.main) {
  serve(handleMarketingSendRequest);
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
    const isDuplicate = messageError.code === "23505" ||
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
  const eventDate = primaryEvent?.date_label ?? null;
  return {
    first_name: contact.first_name,
    brand_name: brandName,
    event_name: contact.last_event_name ?? primaryEvent?.title ?? null,
    event_date: eventDate,
    event_date_short: eventDate,
    event_time: null,
    doors_open: null,
    // ORCH-0877 — ends_at variable mirrors the EmbeddedEvent's ends_at_label
    // (e.g., "Ends 11 PM" same-day, "Ends Sun 2 AM" cross-midnight). Null
    // when source has no end time (Constitution #9 — no fabrication).
    ends_at: primaryEvent?.ends_at_label ?? null,
    event_url: primaryEvent?.url ?? null,
    // Capacity is not on EmbeddedEvent yet — leave null (Constitution #9).
    // The Last call starter no longer depends on {spots_left} (#3682).
    spots_left: null,
    previous_event_name: contact.last_event_name,
    next_event_name: primaryEvent?.title ?? null,
    event_id: primaryEvent?.id ?? contact.last_event_id,
  };
}

function substituteString(
  template: string,
  variables: MarketingVariables,
): string {
  return template
    .replace(
      /\{(first_name|event_name|event_date|event_date_short|event_time|doors_open|ends_at|brand_name|event_url|spots_left|previous_event_name|next_event_name|event_id)\}/g,
      (_match, key: string) => {
        const v = (variables as unknown as Record<string, string | null>)[key];
        return v ?? "";
      },
    )
    .replace(/\{\{event:(?:\|(?:compact|medium|large))?\}\}/g, "");
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
    .select(
      "id, title, location_text, cover_media_url, cover_media_type, master_start_at, master_end_at, master_timezone, slug, brand_id",
    )
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
  // `https://host.usemingla.com/e/<brand_slug>/<event_slug>` — both
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
    for (
      const row
        of ((brandsData ?? []) as Array<{ id: string; slug: string | null }>)
    ) {
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

function campaignSenderLocalPart(input: string | null | undefined): string {
  const raw = (input ?? "").toLowerCase().trim();
  // Replace non-alphanumeric runs with nothing (collapses spaces, accents,
  // and punctuation into a single tight slug).
  const slug = raw.replace(/[^a-z0-9]+/g, "").slice(0, 32);
  return slug;
}

/**
 * Resolves the origin used to build per-recipient unsubscribe URLs.
 *
 * #2470 — same change, and same reasoning, as
 * marketingEmailRender.getTrackingLinkOrigin: the branded origin is the
 * DEFAULT rather than an env var nobody set. An unsubscribe link is the one
 * link in a marketing email a recipient must trust on sight, so pointing it at
 * a bare `…supabase.co` hostname was the worst instance of the problem.
 *
 * `usemingla.com/unsubscribe/<token>` is served by the marketing app, which
 * rewrites it to `marketing-unsubscribe` (mingla-marketing/next.config.ts).
 * The bare `/unsubscribe` path is a separate human-facing opt-out form and is
 * untouched by that rewrite. Keep origin and rewrite in step.
 */
const BRANDED_UNSUBSCRIBE_LINK_ORIGIN = "https://usemingla.com/unsubscribe";
function getUnsubscribeOrigin(): string {
  const override = Deno.env.get("MINGLA_UNSUBSCRIBE_LINK_ORIGIN");
  if (override !== undefined && override.trim().length > 0) {
    return override.replace(/\/+$/, "");
  }
  return BRANDED_UNSUBSCRIBE_LINK_ORIGIN;
}

function getPublicAppOrigin(): string {
  // ISSUE-927: BUSINESS_WEB_ORIGIN is the canonical secret; the old name is
  // a fallback so its deletion is safely decoupled (same digest, audited).
  return Deno.env.get("BUSINESS_WEB_ORIGIN") ??
    Deno.env.get("MINGLA_PUBLIC_APP_ORIGIN") ?? "https://mingla.app";
}

export type ResendOutcome =
  | { ok: true; providerId: string }
  | {
    ok: false;
    error: string;
    /**
     * #2509 — is this recipient worth coming back for?
     *
     * A rate limit or a spent quota is TRANSIENT: the address is fine and the
     * send will work later. Writing those `failed` is what burned 21 real
     * invitees on 2026-08-24 with no path back. A 4xx about the address
     * itself is not retryable and stays terminal.
     */
    retryable?: boolean;
    /** Seconds to wait, from the provider's own `retry-after` when it sent one. */
    retryAfterSeconds?: number | null;
  };

/**
 * #2509 — clamp a `retry-after` header to something a scheduler can hold.
 * Mirrors `_shared/adCreativePrepare.ts`, which has read this header correctly
 * since ORCH-0891; the marketing path simply never did.
 */
export function boundedRetryAfterSeconds(raw: string | null): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  // `Number("")` is 0, not NaN — so without this an EMPTY header would read as
  // "wait 1 second" instead of "no header was sent". Caught by the adversarial
  // suite, not by inspection.
  if (trimmed.length === 0) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  // Floor 1s so a `0` cannot busy-loop; ceiling 6h so a hostile or confused
  // header cannot park a campaign past the event it is advertising.
  return Math.min(Math.max(Math.ceil(n), 1), 21_600);
}

interface TerminalUpdateError {
  code?: string;
}

interface EmailTerminalRow {
  id: string;
  status: string;
  provider_message_id: string | null;
  sent_at: string | null;
  delivery_tracking_eligible_at: string | null;
  open_tracking_eligible_at: string | null;
  tracking_sender_domain: string | null;
}

function publicEmailAcceptedStatus(status: string): boolean {
  return [
    "sent",
    "delivered",
    "opened",
    "clicked",
    "bounced",
    "complained",
    "unsubscribed",
  ].includes(status);
}

function safeTerminalUpdateError(
  error: TerminalUpdateError | null | undefined,
): string {
  if (error === null || error === undefined) return "write_not_persisted";
  return typeof error.code === "string" && error.code.trim().length > 0
    ? error.code
    : "database_error";
}

// #1821: a Resend success is not locally counted until the exact terminal row
// is read back with the same provider id. Retry once, then fail loud so an
// accepted provider request can never become a silently resendable orphan.
// deno-lint-ignore no-explicit-any -- service client has no generated DB types.
export async function persistEmailSentTerminal(
  supabase: any,
  messageId: string,
  providerMessageId: string,
): Promise<void> {
  const eligibleAt = new Date().toISOString();
  const sentPatch = {
    status: "sent",
    sent_at: eligibleAt,
    provider_message_id: providerMessageId,
    delivery_tracking_eligible_at: eligibleAt,
    open_tracking_eligible_at: eligibleAt,
    tracking_sender_domain: "campaigns.usemingla.com",
  };
  let safeError = "write_not_persisted";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await supabase
      .from("marketing_messages")
      .update(sentPatch)
      .eq("id", messageId)
      .select(
        "id,status,provider_message_id,sent_at,delivery_tracking_eligible_at,open_tracking_eligible_at,tracking_sender_domain",
      )
      .maybeSingle();
    const row = data as EmailTerminalRow | null;
    if (
      error === null && row !== null && row.id === messageId &&
      publicEmailAcceptedStatus(row.status) &&
      row.provider_message_id === providerMessageId &&
      row.sent_at !== null &&
      row.delivery_tracking_eligible_at !== null &&
      row.open_tracking_eligible_at !== null &&
      row.tracking_sender_domain === "campaigns.usemingla.com"
    ) {
      return;
    }
    safeError = safeTerminalUpdateError(error as TerminalUpdateError | null);
  }

  throw new Error(
    `email_sent_terminal_update_lost:${messageId}:${safeError}`,
  );
}

/**
 * #2485 — where a reply goes when the From address has no mailbox.
 *
 * Brand blasts are sent From `<brandSlug>@campaigns.usemingla.com`, which is a display
 * identity, not a mailbox: the domain's MX is Google Workspace and these
 * aliases do not exist there. Until now nothing set Reply-To, so every reply to
 * every brand blast bounced. That is bad for the brand, and a From nobody can
 * answer is its own negative signal to mailbox providers.
 *
 * A brand's own `contact_email` is the right destination when it has one. Only
 * a small minority do, so this fallback is the common path and has to reach a
 * real human rather than another alias into the void.
 */
const FALLBACK_REPLY_TO = "support@usemingla.com";

export async function postToResend(input: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  /** #2485 — brand `contact_email` when set, else FALLBACK_REPLY_TO. */
  replyTo?: string | null;
  /**
   * #2485 — the one-click unsubscribe URL (RFC 8058). Mailbox providers read
   * the HEADER, not the link in the body, and render a native Unsubscribe
   * button beside the sender from it. Without it the only way a recipient can
   * stop mail is the spam button, which damages the sending domain far more
   * than an opt-out does.
   */
  unsubscribeUrl?: string | null;
  idempotencyKey?: string | null;
  beforeProviderIo?: () => Promise<void>;
}): Promise<ResendOutcome> {
  let lastError = "";
  let lastRetryAfterSeconds: number | null = null;
  await input.beforeProviderIo?.();
  for (let attempt = 0; attempt < RESEND_MAX_RETRIES; attempt += 1) {
    // no-attachment: marketing campaign emails (Cycle B5 Phase B) are pure
    // HTML+text blasts; no PDF tickets or other file attachments are ever
    // sent through this code path. Per ORCH-0785-A invariant.
    let response: Response;
    try {
      response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${input.apiKey}`,
          "Content-Type": "application/json",
          ...(input.idempotencyKey === null ||
              input.idempotencyKey === undefined
            ? {}
            : { "Idempotency-Key": input.idempotencyKey }),
        },
        body: JSON.stringify({
          from: input.from,
          to: [input.to],
          subject: input.subject,
          html: input.html,
          text: input.text,
          reply_to: input.replyTo ?? FALLBACK_REPLY_TO,
          // #2485 — RFC 8058 one-click. Both headers are required together:
          // List-Unsubscribe alone gets a confirmation round-trip, and
          // List-Unsubscribe-Post is what makes the provider POST straight to
          // the URL and treat the opt-out as honoured. `marketing-unsubscribe`
          // already accepts POST. Omitted entirely when there is no URL —
          // an unsubscribe header pointing nowhere is worse than none.
          ...(input.unsubscribeUrl
            ? {
              headers: {
                "List-Unsubscribe": `<${input.unsubscribeUrl}>`,
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
              },
            }
            : {}),
        }),
      });
    } catch {
      return { ok: false, error: "resend_network_unknown" };
    }
    if (response.status === 429) {
      // #2509 — CLASSIFY the 429 instead of guessing. Every 429 used to be
      // labelled `resend_rate_limited`, a name that actively points the reader
      // at the wrong cause: on 2026-08-24 the real reason was the FREE plan's
      // 100/day cap (dashboard read 200/100), while the send rate was 1.9/s
      // against a documented 10 req/s allowance. The label cost a dashboard
      // trip to disprove. Resend distinguishes these itself, and other Mingla
      // integrations already read `retry-after` (_shared/adCreativePrepare.ts).
      // https://resend.com/docs/api-reference/rate-limit
      const retryAfter = boundedRetryAfterSeconds(
        response.headers.get("retry-after"),
      );
      let kind = "rate_limit";
      try {
        const body = await response.clone().json() as { name?: string } | null;
        const name = typeof body?.name === "string" ? body.name : "";
        if (name.includes("daily_quota")) kind = "daily_quota_exceeded";
        else if (name.includes("monthly_quota")) {
          kind = "monthly_quota_exceeded";
        } else if (name.length > 0) kind = name;
      } catch { /* body unreadable — the header data below still stands */ }
      const daily = response.headers.get("x-resend-daily-quota");
      const monthly = response.headers.get("x-resend-monthly-quota");
      lastError = `resend_429:${kind}` +
        (daily === null ? "" : `;daily=${daily}`) +
        (monthly === null ? "" : `;monthly=${monthly}`);
      lastRetryAfterSeconds = retryAfter;
      // A QUOTA does not clear in nine seconds. Burning the remaining in-process
      // attempts against it only wastes the run's wall-clock budget, which is
      // exactly how campaign 8a54fc7c spent 180s to send zero emails. Hand it
      // straight back so the caller can DEFER the recipient instead.
      if (kind !== "rate_limit") {
        return {
          ok: false,
          error: lastError,
          retryable: true,
          retryAfterSeconds: retryAfter ?? 3600,
        };
      }
      const delay = retryAfter !== null
        ? Math.min(retryAfter * 1000, 10_000)
        : (RESEND_BACKOFF_MS[attempt] ?? 9000);
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
      if (!isResendOk(payload)) {
        return { ok: false, error: "resend_success_response_invalid" };
      }
      return { ok: true, providerId: payload.id };
    }
    return {
      ok: false,
      error: isResendErr(payload)
        ? `resend_${response.status}:${payload.message ?? "unknown"}`
        : `resend_${response.status}`,
    };
  }
  // #2509 — in-process retries exhausted. The address is not at fault, so the
  // recipient is DEFERRED for another pass rather than burned.
  return {
    ok: false,
    error: lastError || "resend_429:rate_limit;retries_exhausted",
    retryable: true,
    retryAfterSeconds: lastRetryAfterSeconds ?? 300,
  };
}

export function isResendOk(value: unknown): value is { id: string } {
  return typeof value === "object" && value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    (value as { id: string }).id.trim().length > 0;
}

function isResendErr(value: unknown): value is { message?: string } {
  return typeof value === "object" && value !== null;
}

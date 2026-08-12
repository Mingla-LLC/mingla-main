/**
 * adChannel.ts — the Full Rooms Ad Engine channel layer (ISSUE-862 WP1).
 *
 * SPEC: Mingla_Artifacts/specs/SPEC_ISSUE-862_META_ADS_CAMPAIGN_ENGINE.md
 *   Amendment A3 §B (interface + registry) as superseded by Amendment A4.a
 *   (the widened ChannelAdapter — createCreative? + setBudget), grounded in
 *   Mingla_Artifacts/research/ad-pipeline-2026-07-15/PROOF_LOG.md.
 *
 * One interface; per-platform modules _shared/{meta,tiktok,snapchat,google,
 * reddit}.ts each implement it. All five are live adapters — Meta (WP1),
 * Google (WP2), Reddit (WP6 #916), TikTok (WP7 #863) and Snapchat (WP5 #867)
 * — each fail-closing (AdNotConnectedError → 424 <platform>_not_connected)
 * while its secrets are unset.
 *
 * MONEY (A4.a / GR-01 — the 10,000x bug): budgets are stored in MINOR UNITS
 * (cents, bigint) everywhere; conversion to the platform unit happens at
 * EXACTLY ONE place per adapter — centsToPlatformBudget below. Minimum-budget
 * checks run in the platform unit AFTER conversion.
 *
 * CTA maps are per-platform — NEVER a shared normalizer (A4.a / GR-29).
 * Reddit's CTA enum is Title-Case display strings; any generic toUpperCase()
 * normalizer 400s there. Google RSA has NO CTA field at all — deliberately no
 * Google map.
 */

export * from "./adChannelCore.ts";

import {
  type AdConnectionRow,
  AdNotConnectedError,
  type ChannelAdapter,
  type CreateAdInput,
  type CreateAdSetInput,
  type CreateCampaignInput,
  type CreateCreativeInput,
  type Lane,
  PLATFORMS,
  type Platform,
} from "./adChannelCore.ts";

// ── Registry (A3 §B getAdapter) ───────────────────────────────────────────────

import { metaAdapter } from "./meta.ts";
import { googleAdapter } from "./google.ts";
import { redditAdapter } from "./reddit.ts";
import { snapchatAdapter } from "./snapchat.ts";
import { tiktokAdapter } from "./tiktok.ts";

const ADAPTER_REGISTRY: Record<Platform, ChannelAdapter> = {
  meta: metaAdapter,
  tiktok: tiktokAdapter, // WP7 (#863) — live adapter (fail-close until TIKTOK_* secrets are set)
  snapchat: snapchatAdapter, // WP5 (#867) — live adapter (fail-close until SNAPCHAT_* secrets are set)
  google: googleAdapter, // WP2 (#867) — live adapter (A1.3-0 provisioning flip)
  reddit: redditAdapter, // WP6 (#916) — live adapter (SPEC_ISSUE-REDDIT §3)
};

export function getAdapter(platform: Platform): ChannelAdapter {
  const adapter = ADAPTER_REGISTRY[platform];
  if (!adapter) throw new AdNotConnectedError(platform);
  return adapter;
}

export function isPlatform(value: unknown): value is Platform {
  return typeof value === "string" && (PLATFORMS as readonly string[]).includes(value);
}

export function isLane(value: unknown): value is Lane {
  return value === "consumer" || value === "business";
}

// ── GR-52 destination re-checker (ISSUE-867 A1.3 — channel-generic) ───────────
// Google polices "unavailable offers" / "destination not working" for the ad's
// WHOLE life, and every Mingla ad promotes a dated, finite event. The sync fn
// re-asserts the destination is public + live on every sweep and auto-pauses
// (+ audits) on failure — protecting the ACCOUNT, not just the campaign. The
// same check runs for every channel (Meta benefits too).

interface DestinationMaybeSingleResult {
  data: unknown;
}

interface DestinationEventChain {
  // PromiseLike, not Promise — supabase-js query builders are thenables.
  maybeSingle(): PromiseLike<DestinationMaybeSingleResult>;
}

interface DestinationEqChain {
  eq(column: string, value: string): DestinationEqChain;
  in(column: string, values: string[]): DestinationEventChain;
  maybeSingle(): PromiseLike<DestinationMaybeSingleResult>;
}

interface DestinationSelectChain {
  eq(column: string, value: string): DestinationEqChain;
}

/** Minimal structural view of the supabase client the checker needs. */
export interface DestinationQueryClient {
  from(table: string): { select(columns: string): DestinationSelectChain };
}

export interface DestinationRef {
  dest_page_type: string;
  dest_brand_slug: string;
  dest_entity_slug: string | null;
}

/**
 * Mirrors the create-time destination gate (§4.4b): an event destination must
 * still resolve in business_public_events_view with status scheduled|live
 * (the view also exposes ended/cancelled — paid traffic must never point at
 * one); a Stay venue must still resolve in the flag-gated public Stay ad view;
 * a brand destination must still resolve in business_public_brands_view.
 * Unknown/uncreatable page types are NOT public (fail-close).
 */
export async function destinationStillPublicLive(
  db: DestinationQueryClient,
  dest: DestinationRef,
): Promise<boolean> {
  if (dest.dest_page_type === "event") {
    if (!dest.dest_entity_slug) return false;
    const { data } = await db
      .from("business_public_events_view")
      .select("id")
      .eq("brand_slug", dest.dest_brand_slug)
      .eq("slug", dest.dest_entity_slug)
      .in("status", ["scheduled", "live"])
      .maybeSingle();
    return Boolean(data);
  }
  if (dest.dest_page_type === "brand") {
    const { data } = await db
      .from("business_public_brands_view")
      .select("id")
      .eq("slug", dest.dest_brand_slug)
      .maybeSingle();
    return Boolean(data);
  }
  if (dest.dest_page_type === "venue") {
    if (!dest.dest_entity_slug) return false;
    const { data } = await db
      .from("ad_public_stay_destinations_view")
      .select("id")
      .eq("brand_slug", dest.dest_brand_slug)
      .eq("slug", dest.dest_entity_slug)
      .maybeSingle();
    return Boolean(data);
  }
  // Unknown/uncreatable page types remain fail-closed.
  return false;
}

// ── Atomic create with compensating rollback (§4.4b — no orphans) ─────────────

export interface AtomicCreateInput {
  campaign: CreateCampaignInput;
  adSet: CreateAdSetInput;
  creative: CreateCreativeInput;
  ad: Omit<CreateAdInput, "externalCreativeId">;
}

export interface AtomicCreateResult {
  externalCampaignId: string;
  externalAdSetId: string;
  externalCreativeId: string | null;
  postId: string | null;
  externalAdId: string;
  reviewStatus: string | null;
}

export interface AtomicCreateFailure {
  step: "campaign" | "ad_set" | "creative" | "ad";
  partialExternalIds: Record<string, string>;
  rollbackSucceeded: boolean | null; // null = no rollback needed (nothing created)
  /**
   * QA P2-5: account-level creative cleanup outcome. null = no creative was
   * created (nothing to clean); true = deleted; false = RESIDUE REMAINS — the
   * id (partialExternalIds.external_creative_id) must land in the audit row
   * for manual reconciliation.
   */
  creativeRollbackSucceeded: boolean | null;
  cause: unknown;
}

export class AtomicCreateError extends Error {
  readonly failure: AtomicCreateFailure;
  constructor(failure: AtomicCreateFailure) {
    const causeMessage =
      failure.cause instanceof Error ? failure.cause.message : String(failure.cause);
    super(`atomic create failed at step "${failure.step}": ${causeMessage}`);
    this.name = "AtomicCreateError";
    this.failure = failure;
  }
}

/**
 * The fixed create order (campaign → ad set → creative → ad), all PAUSED, with
 * the §4.4b no-orphan contract: if any step fails, the already-created campaign
 * is rolled back via adapter.rollbackCampaign (platform cascade deletes the
 * children) and AtomicCreateError carries the partial IDs for the audit trail.
 * NO DB row is written by this function — the caller persists ONLY on success.
 */
export async function createFullCampaignAtomic(
  adapter: ChannelAdapter,
  conn: AdConnectionRow,
  input: AtomicCreateInput,
): Promise<AtomicCreateResult> {
  const partial: Record<string, string> = {};

  const fail = async (
    step: AtomicCreateFailure["step"],
    cause: unknown,
  ): Promise<never> => {
    // QA P2-5 (proven live): the creative is an ACCOUNT-level object — campaign
    // deletion does NOT cascade it. Clean it FIRST (the failed chain's ad never
    // existed, so the creative is unreferenced and deletable), then the campaign.
    let creativeRollbackSucceeded: boolean | null = null;
    const creativeId = partial.external_creative_id;
    if (creativeId) {
      if (adapter.rollbackCreative) {
        try {
          await adapter.rollbackCreative(conn, creativeId);
          creativeRollbackSucceeded = true;
        } catch {
          creativeRollbackSucceeded = false; // residue — audit row carries the id
        }
      } else {
        creativeRollbackSucceeded = false; // no hook — residue, reconcile from audit
      }
    }

    let rollbackSucceeded: boolean | null = null;
    const campaignId = partial.external_campaign_id;
    if (campaignId && adapter.rollbackCampaign) {
      try {
        await adapter.rollbackCampaign(conn, campaignId);
        rollbackSucceeded = true;
      } catch {
        // Rollback itself failed — the caller records the partial IDs in
        // ad_status_events (action='create_failed') for manual reconciliation.
        rollbackSucceeded = false;
      }
    } else if (campaignId) {
      rollbackSucceeded = false; // campaign exists but no rollback hook — reconcile manually
    }
    throw new AtomicCreateError({
      step,
      partialExternalIds: { ...partial },
      rollbackSucceeded,
      creativeRollbackSucceeded,
      cause,
    });
  };

  // 1. Campaign
  let campaignExternalId: string;
  try {
    const created = await adapter.createCampaign(conn, input.campaign);
    campaignExternalId = created.externalId;
    partial.external_campaign_id = campaignExternalId;
  } catch (cause) {
    return await fail("campaign", cause);
  }

  // 2. Ad set
  let adSetExternalId: string;
  try {
    const created = await adapter.createAdSet(conn, campaignExternalId, input.adSet);
    adSetExternalId = created.externalId;
    partial.external_adset_id = adSetExternalId;
  } catch (cause) {
    return await fail("ad_set", cause);
  }

  // 3. Creative (optional per-adapter — TikTok inlines it in ad create)
  let externalCreativeId: string | null = null;
  let postId: string | null = null;
  if (adapter.createCreative) {
    try {
      const created = await adapter.createCreative(conn, input.creative);
      externalCreativeId = created.externalCreativeId ?? null;
      postId = created.postId ?? null;
      if (externalCreativeId) partial.external_creative_id = externalCreativeId;
      if (postId) partial.post_id = postId;
    } catch (cause) {
      return await fail("creative", cause);
    }
  }

  // 4. Ad
  try {
    const created = await adapter.createAd(conn, adSetExternalId, {
      ...input.ad,
      externalCreativeId: externalCreativeId ?? postId ?? "",
    });
    partial.external_ad_id = created.externalId;
    return {
      externalCampaignId: campaignExternalId,
      externalAdSetId: adSetExternalId,
      externalCreativeId,
      postId,
      externalAdId: created.externalId,
      reviewStatus: created.reviewStatus,
    };
  } catch (cause) {
    return await fail("ad", cause);
  }
}

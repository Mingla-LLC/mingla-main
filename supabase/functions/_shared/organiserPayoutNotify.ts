/**
 * organiserPayoutNotify — Issue #3645 PR10 (organiser payout visibility).
 *
 * The organiser-facing payout notifications that did not exist on the Paystack
 * rail, plus the analytics milestones that go with them. Stripe already tells
 * the organiser "payout sent" / "payout failed" from the payout webhook; this
 * module is the Paystack twin and the shared home for the two new states every
 * rail needs:
 *
 *   business.payout_paid               payout sent        (Paystack twin)
 *   business.payout_failed             payout failed      (Paystack, terminal)
 *   business.payout_waiting_for_bank   money waiting for a bank (both rails)
 *   business.payouts_paused            admin paused payouts
 *   business.payouts_resumed           admin resumed payouts
 *
 * #1180 law: the copy here is organiser-safe by construction. It is built ONLY
 * from the release's status / currency / delivered cents (and the brand name).
 * It never reads or forwards `error_message`, `attempt_count`, OTP or KYC
 * internals, and never carries the admin pause reason.
 *
 * All notifications are idempotent (stable keys), so a replayed webhook or a
 * re-run sweep collapses. Every analytics call is fail-open: nothing here may
 * change a release outcome or a webhook's HTTP result.
 */

// @ts-ignore — Deno ESM
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  BRAND_PAYMENTS_ROLES,
  dispatchNotification,
  formatMoneyCents,
  getBrandTeamUserIdsByRolesOrThrow,
} from "./stripeEdgeAuth.ts";
import {
  claimBrandMilestone,
  postAppsFlyerS2SEvent,
  resolveBrandOwnerUserId,
} from "./appsFlyerS2S.ts";

export type OrganiserNotifyInput = {
  brandId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  relatedId?: string | null;
  relatedType?: string | null;
  idempotencyKey: string;
  deepLink?: string | null;
  roles?: readonly string[];
};

export type OrganiserNotifyDeps = {
  notifyBrandManagers: (
    supabase: SupabaseClient,
    input: OrganiserNotifyInput,
  ) => Promise<void>;
  claimMilestone: typeof claimBrandMilestone;
  resolveOwnerUserId: typeof resolveBrandOwnerUserId;
  postAppsFlyer: typeof postAppsFlyerS2SEvent;
};

export async function notifyBrandManagers(
  supabase: SupabaseClient,
  input: OrganiserNotifyInput,
): Promise<void> {
  // Strict lookup: query ERROR must throw so drainPausedNotices /
  // drainOutcomeNotices leave the notice open for retry. Empty roles or a
  // genuine zero-manager brand may still return [] and complete (no fans-out).
  const userIds = await getBrandTeamUserIdsByRolesOrThrow(
    supabase as never,
    input.brandId,
    input.roles ?? BRAND_PAYMENTS_ROLES,
  );
  for (const userId of userIds) {
    await dispatchNotification({
      userId,
      brandId: input.brandId,
      type: input.type,
      title: input.title,
      body: input.body,
      data: input.data,
      relatedId: input.relatedId,
      relatedType: input.relatedType,
      idempotencyKey: `${input.idempotencyKey}:${userId}`,
      deepLink: input.deepLink,
    });
  }
}

export const defaultOrganiserNotifyDeps: OrganiserNotifyDeps = {
  notifyBrandManagers,
  claimMilestone: claimBrandMilestone,
  resolveOwnerUserId: resolveBrandOwnerUserId,
  postAppsFlyer: postAppsFlyerS2SEvent,
};

/** Payments deep link every payout notification lands on. */
export const organiserPaymentsDeepLink = (brandId: string): string =>
  `mingla-business://brand/${brandId}/payments`;

// ---------------------------------------------------------------------------
// Copy (organiser-safe; one place so the rails cannot drift).
// ---------------------------------------------------------------------------

export function payoutPausedCopy(
  kind: "paused" | "resumed",
  brandName: string,
): { type: string; title: string; body: string } {
  const name = brandName.trim().length > 0 ? brandName.trim() : "Your brand";
  if (kind === "paused") {
    return {
      type: "business.payouts_paused",
      title: "Payouts paused",
      body:
        `${name}: payouts are paused. Your sales keep adding up and will be sent once payouts resume.`,
    };
  }
  return {
    type: "business.payouts_resumed",
    title: "Payouts resumed",
    body: `${name}: payouts are back on. Money waiting for you will be sent.`,
  };
}

export function payoutWaitingForBankCopy(): {
  type: string;
  title: string;
  body: string;
} {
  return {
    type: "business.payout_waiting_for_bank",
    title: "Add a bank to get paid",
    body:
      "A payout is ready to send, but Mingla is waiting until you add a bank account.",
  };
}

// ---------------------------------------------------------------------------
// Paystack payout outcome (sent / failed) + first-payout analytics.
// ---------------------------------------------------------------------------

type ReleaseOutcomeRow = {
  id: string;
  brand_id: string;
  status: string;
  currency: string | null;
  organiser_cash_delivered_cents: number | null;
  net_release_cents: number | null;
};

/**
 * After a Paystack organiser leg settles (webhook transfer.success /
 * transfer.failed, or the sweep's reconcile), look at the release's FINAL
 * status and tell the organiser once:
 *
 *   released → business.payout_paid + first-payout milestone + AppsFlyer
 *              `mingla_first_payout` (mirrors the Stripe payout.paid path).
 *   failed   → business.payout_failed. Only the terminal status notifies: a
 *              retryable transfer failure that the sweep will re-initiate is
 *              not news to the organiser.
 *
 * Any other status is a no-op (the release is still moving). Selects NO
 * `error_message` — the failed copy is generic by design (#1180).
 */
export async function notifyPaystackReleaseOutcome(
  supabase: SupabaseClient,
  releaseId: string,
  deps: OrganiserNotifyDeps = defaultOrganiserNotifyDeps,
): Promise<"paid" | "failed" | "none"> {
  const { data, error } = await supabase
    .from("brand_payout_releases")
    .select(
      "id, brand_id, status, currency, organiser_cash_delivered_cents, net_release_cents",
    )
    .eq("id", releaseId)
    .eq("provider", "paystack")
    .maybeSingle();
  if (error) {
    throw new Error(`organiser release outcome lookup failed: ${error.message}`);
  }
  const release = data as ReleaseOutcomeRow | null;
  if (!release) return "none";

  const currency = (release.currency ?? "ngn").toUpperCase();
  const deepLink = organiserPaymentsDeepLink(release.brand_id);

  if (release.status === "released") {
    const amountCents = Number(
      release.organiser_cash_delivered_cents ?? release.net_release_cents ?? 0,
    );
    await deps.notifyBrandManagers(supabase, {
      brandId: release.brand_id,
      type: "business.payout_paid",
      title: "You got paid",
      body: `${
        formatMoneyCents(amountCents, currency)
      } is on its way to your bank.`,
      data: {
        releaseId: release.id,
        provider: "paystack",
        amountCents,
        currency,
      },
      relatedId: release.id,
      relatedType: "payout_release",
      idempotencyKey: `business.payout_paid:paystack:${release.id}`,
      deepLink,
      roles: ["brand_owner", "finance_manager"],
    });
    await fireFirstPayoutMilestone(
      supabase,
      release.brand_id,
      { amountCents, currency, releaseId: release.id },
      deps,
    );
    return "paid";
  }

  if (release.status === "failed") {
    await deps.notifyBrandManagers(supabase, {
      brandId: release.brand_id,
      type: "business.payout_failed",
      title: "Payout couldn't be sent",
      body:
        "We couldn't send a payout to your bank. Check your bank details or contact support.",
      data: { releaseId: release.id, provider: "paystack" },
      relatedId: release.id,
      relatedType: "payout_release",
      idempotencyKey: `business.payout_failed:paystack:${release.id}`,
      deepLink,
    });
    return "failed";
  }

  return "none";
}

async function fireFirstPayoutMilestone(
  supabase: SupabaseClient,
  brandId: string,
  payout: { amountCents: number; currency: string; releaseId: string },
  deps: OrganiserNotifyDeps,
): Promise<void> {
  try {
    const isFirst = await deps.claimMilestone(
      supabase,
      brandId,
      "first_payout_at",
    );
    if (!isFirst) return;
    const ownerUserId = await deps.resolveOwnerUserId(supabase, brandId);
    if (!ownerUserId) return;
    await deps.postAppsFlyer({
      supabase,
      userId: ownerUserId,
      eventName: "mingla_first_payout",
      eventValues: {
        af_revenue: Math.round(payout.amountCents) / 100,
        af_currency: payout.currency,
        brand_id: brandId,
        provider: "paystack",
        release_id: payout.releaseId,
      },
    });
  } catch (afError) {
    console.warn(
      "[organiser-payout-notify] first-payout analytics threw (non-fatal):",
      afError instanceof Error ? afError.message : String(afError),
    );
  }
}

// ---------------------------------------------------------------------------
// Paystack bank-added analytics.
// ---------------------------------------------------------------------------

/**
 * Fire the once-per-brand `mingla_bank_added` AppsFlyer event the first time a
 * Paystack payout bank is attached (subaccount create or recipient create).
 *
 * Distinct on purpose from `mingla_stripe_connect_activated`, which fires on
 * Stripe `charges_enabled` — i.e. CHARGE-ready (can sell), NOT payout-ready
 * (can receive money). "Bank added" is the payout-ready signal.
 *
 * Fail-open and idempotent via brand_appsflyer_milestones.first_bank_added_at.
 */
export async function fireBankAddedMilestone(
  supabase: SupabaseClient,
  brandId: string,
  source: "paystack_subaccount" | "paystack_recipient",
  deps: OrganiserNotifyDeps = defaultOrganiserNotifyDeps,
): Promise<boolean> {
  try {
    const isFirst = await deps.claimMilestone(
      supabase,
      brandId,
      "first_bank_added_at",
    );
    if (!isFirst) return false;
    const ownerUserId = await deps.resolveOwnerUserId(supabase, brandId);
    if (!ownerUserId) return true;
    await deps.postAppsFlyer({
      supabase,
      userId: ownerUserId,
      eventName: "mingla_bank_added",
      eventValues: {
        brand_id: brandId,
        provider: "paystack",
        source,
      },
    });
    return true;
  } catch (afError) {
    console.warn(
      "[organiser-payout-notify] bank-added analytics threw (non-fatal):",
      afError instanceof Error ? afError.message : String(afError),
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// Admin pause / resume notices (drained by payout-release-sweep).
// ---------------------------------------------------------------------------

export type PausedNoticeRow = {
  notice_id: string;
  brand_id: string;
  kind: "paused" | "resumed";
  brand_name: string | null;
};

/**
 * Drain the durable pause/resume notices recorded by the hold-table trigger:
 * list → notify brand managers (idempotent per notice) → mark done. A notice
 * whose dispatch throws stays open and is retried by the next sweep.
 */
export async function drainPausedNotices(
  supabase: SupabaseClient,
  deps: OrganiserNotifyDeps = defaultOrganiserNotifyDeps,
): Promise<{ listed: number; delivered: number }> {
  const { data, error } = await supabase.rpc(
    "claim_brand_payout_pause_notices" as never,
    { p_limit: 50 } as never,
  );
  if (error) {
    throw new Error(`pause_notice_claim_failed:${error.message}`);
  }
  const rows = (data ?? []) as PausedNoticeRow[];
  const delivered: string[] = [];
  for (const row of rows) {
    try {
      const copy = payoutPausedCopy(row.kind, row.brand_name ?? "");
      await deps.notifyBrandManagers(supabase, {
        brandId: row.brand_id,
        type: copy.type,
        title: copy.title,
        body: copy.body,
        data: { noticeId: row.notice_id, kind: row.kind },
        relatedId: row.notice_id,
        relatedType: "payout_pause_notice",
        idempotencyKey: `${copy.type}:${row.notice_id}`,
        deepLink: organiserPaymentsDeepLink(row.brand_id),
      });
      delivered.push(row.notice_id);
    } catch (notifyError) {
      console.error("[organiser-payout-notify] pause notice dispatch failed", {
        noticeId: row.notice_id,
        message: notifyError instanceof Error
          ? notifyError.message
          : String(notifyError),
      });
    }
  }
  if (delivered.length > 0) {
    const { error: doneError } = await supabase.rpc(
      "complete_brand_payout_pause_notices" as never,
      { p_notice_ids: delivered } as never,
    );
    if (doneError) {
      throw new Error(`pause_notice_complete_failed:${doneError.message}`);
    }
  }
  return { listed: rows.length, delivered: delivered.length };
}

// ---------------------------------------------------------------------------
// Terminal Paystack outcome notices (drained by payout-release-sweep).
// ---------------------------------------------------------------------------

export type OutcomeNoticeRow = {
  notice_id: string;
  release_id: string;
  brand_id: string;
  kind: "paid" | "failed";
};

/**
 * Drain durable terminal Paystack payout notices recorded when a release flips
 * to released/failed. Dispatch failures leave the row open for the next sweep
 * — the webhook must never treat notify as fire-and-forget.
 */
export async function drainOutcomeNotices(
  supabase: SupabaseClient,
  deps: OrganiserNotifyDeps = defaultOrganiserNotifyDeps,
): Promise<{ listed: number; delivered: number }> {
  const { data, error } = await supabase.rpc(
    "claim_brand_payout_outcome_notices" as never,
    { p_limit: 50 } as never,
  );
  if (error) {
    throw new Error(`outcome_notice_claim_failed:${error.message}`);
  }
  const rows = (data ?? []) as OutcomeNoticeRow[];
  const delivered: string[] = [];
  for (const row of rows) {
    try {
      const outcome = await notifyPaystackReleaseOutcome(
        supabase,
        row.release_id,
        deps,
      );
      // Only complete when the release is still in a terminal notifying state.
      // A race that moved the release elsewhere leaves the notice open.
      if (outcome === "none") {
        console.warn(
          "[organiser-payout-notify] outcome notice skipped (release not terminal)",
          { noticeId: row.notice_id, releaseId: row.release_id },
        );
        continue;
      }
      delivered.push(row.notice_id);
    } catch (notifyError) {
      console.error("[organiser-payout-notify] outcome notice dispatch failed", {
        noticeId: row.notice_id,
        releaseId: row.release_id,
        message: notifyError instanceof Error
          ? notifyError.message
          : String(notifyError),
      });
    }
  }
  if (delivered.length > 0) {
    const { error: doneError } = await supabase.rpc(
      "complete_brand_payout_outcome_notices" as never,
      { p_notice_ids: delivered } as never,
    );
    if (doneError) {
      throw new Error(`outcome_notice_complete_failed:${doneError.message}`);
    }
  }
  return { listed: rows.length, delivered: delivered.length };
}

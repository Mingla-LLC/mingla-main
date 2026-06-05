/**
 * Business notification deep-link routing (META-ORCH-1074 Sub-B §4.B.4).
 *
 * Mirrors the consumer `app/index.tsx` processNotification + NAV_TARGETS
 * pattern, re-skinned to the business app's expo-router routes. Parses the
 * `mingla-business://…` `deep_link` Sub-A emits (and falls back to a
 * per-type NAV_TARGETS resolver) so every one of the 11 v1 types — plus the
 * existing `stripe.*` compliance types — lands on a real business screen.
 *
 * On tap: mark the `notifications` row read + `push_clicked` (fire-and-forget
 * UPDATE), Mixpanel-track, then navigate.
 *
 * Pure (`resolveBusinessNavTarget`) so the routing map is unit-testable
 * without a router/store; the impure `processBusinessNotification` wires the
 * side effects (DB write, analytics, navigation, deferred-link stash).
 *
 * The 11 deep_link shapes Sub-A emits:
 *   mingla-business://event/{eventId}     order_paid, event_sold_out,
 *                                         low_inventory, refund_processed
 *   mingla-business://payments            dispute_opened, dispute_action_needed,
 *                                         payout_paid, account_status_changed
 *   mingla-business://brand/{brandId}/listing   new_review, claim_decision
 *   mingla-business://brand/{brandId}/team      team_member_joined
 */

import { useRouter } from "expo-router";

import { supabase } from "./supabase";
import { mixpanelService } from "./mixpanelService";
import { useCurrentBrandStore } from "../store/currentBrandStore";

export interface BusinessPushData {
  type?: string;
  /** notify-dispatch attaches the row id + deepLink + entity ids. */
  notificationId?: string;
  deepLink?: string;
  brandId?: string;
  eventId?: string;
  relatedId?: string;
  [key: string]: unknown;
}

/** An expo-router push target (path string) — never a raw deep-link. */
export type BusinessNavTarget = string;

/** Resolve the current brand id for id-less targets (e.g. `payments`). */
function currentBrandId(): string | null {
  try {
    return useCurrentBrandStore.getState().currentBrandId;
  } catch {
    return null;
  }
}

/** Fallback when payments has no brand context: the account tab. */
const ACCOUNT_FALLBACK = "/(tabs)/account";

/**
 * Parse a `mingla-business://…` deep link into an expo-router path.
 * Returns null when the URI is unrecognized (caller falls back to
 * NAV_TARGETS by type). Pure + synchronous.
 */
export function parseBusinessDeepLink(deepLink: string): BusinessNavTarget | null {
  const SCHEME = "mingla-business://";
  if (!deepLink.startsWith(SCHEME)) return null;
  const path = deepLink.slice(SCHEME.length).replace(/^\/+/, "");
  const [head, ...rest] = path.split("/");

  switch (head) {
    case "event": {
      const eventId = rest[0];
      return eventId ? `/event/${eventId}` : null;
    }
    case "payments": {
      const brandId = currentBrandId();
      return brandId ? `/brand/${brandId}/payments` : ACCOUNT_FALLBACK;
    }
    case "brand": {
      const brandId = rest[0];
      const sub = rest[1];
      if (!brandId) return null;
      if (sub === "team") return `/brand/${brandId}/team`;
      if (sub === "listing") return `/brand/${brandId}/listing`;
      // ORCH-1082 Gap 15: the KYC-stall reminder + deadline warnings emit
      // `mingla-business://brand/{id}/payments/onboard` (stripe-kyc-stall-reminder
      // notifyBrand deepLink). Without this branch the `payments` sub fell through
      // to the bare brand hub, so "Finish Stripe verification" never reached the
      // onboarding screen. rest[2] === "onboard" → onboarding; bare → payments hub.
      if (sub === "payments") {
        return rest[2] === "onboard"
          ? `/brand/${brandId}/payments/onboard`
          : `/brand/${brandId}/payments`;
      }
      return `/brand/${brandId}`;
    }
    // ORCH-1082 Gap 17b: partner-detach notification deep-links to
    // `mingla-business://partner/earnings` (partner-stripe-detach). The old
    // `mingla-business://account/partner-earnings` had no parser head AND no
    // route file; this case maps the real `/partner/earnings` route.
    case "partner": {
      const sub = rest[0];
      return sub === "earnings" ? `/partner/earnings` : null;
    }
    case "(tabs)": {
      // e.g. mingla-business://(tabs)/marketing
      return `/(tabs)/${rest.join("/")}`;
    }
    default:
      return null;
  }
}

/**
 * Per-type NAV_TARGETS fallback (Sub-B §4.B.4). Used when `deepLink` is
 * absent or unparseable — every one of the 11 types (and the stripe.* set)
 * still lands somewhere. Pure given `data` (for entity ids) + the current
 * brand id.
 */
export function resolveBusinessNavTarget(data: BusinessPushData): BusinessNavTarget {
  const type = data.type ?? "";

  // 1) Prefer the explicit deep link when present + parseable.
  if (typeof data.deepLink === "string" && data.deepLink.length > 0) {
    const parsed = parseBusinessDeepLink(data.deepLink);
    if (parsed) return parsed;
  }

  // 2) Type fallback.
  const eventId = (data.eventId ?? data.relatedId) as string | undefined;
  const brandId = (data.brandId ?? currentBrandId() ?? undefined) as
    | string
    | undefined;
  const paymentsTarget = brandId
    ? `/brand/${brandId}/payments`
    : ACCOUNT_FALLBACK;

  switch (type) {
    case "business.order_paid":
    case "business.event_sold_out":
    case "business.low_inventory":
    case "business.refund_processed":
    case "business.new_review":
      return eventId ? `/event/${eventId}` : ACCOUNT_FALLBACK;

    case "business.dispute_opened":
    case "business.dispute_action_needed":
    case "business.payout_paid":
    case "business.account_status_changed":
      return paymentsTarget;

    case "business.claim_decision":
      return brandId ? `/brand/${brandId}/listing` : ACCOUNT_FALLBACK;

    case "business.team_member_joined":
      return brandId ? `/brand/${brandId}/team` : ACCOUNT_FALLBACK;

    default:
      // stripe.* compliance types → payments; anything else → account.
      if (type.startsWith("stripe.")) return paymentsTarget;
      return ACCOUNT_FALLBACK;
  }
}

/**
 * Mark a notification row read + push_clicked (fire-and-forget). Targets by
 * `id` only (I-PROPOSED-W exempts modifying ops).
 */
function markRowClicked(notificationId: string): void {
  const nowIso = new Date().toISOString();
  // I-PROPOSED-I: chain `.select("id")` so the update returns affected rows and
  // we verify exactly one was touched (a 0-row result means RLS blocked it or
  // the id was stale — surfaced, never silently swallowed).
  void supabase
    .from("notifications")
    .update({ read_at: nowIso, push_clicked: true, push_clicked_at: nowIso })
    .eq("id", notificationId)
    .select("id")
    .then(({ data, error }) => {
      if (error) {
        console.warn(
          "[businessNotificationRouting] markRowClicked failed:",
          error.message,
        );
      } else if (!data || data.length === 0) {
        console.warn(
          "[businessNotificationRouting] markRowClicked: no row updated for",
          notificationId,
        );
      }
    });
}

type ExpoRouter = ReturnType<typeof useRouter>;

export interface ProcessBusinessNotificationDeps {
  /** expo-router instance from the registering component. */
  router: Pick<ExpoRouter, "push">;
  /** True once auth is ready + a user is signed in. */
  isAuthenticated: boolean;
  /** Stash for a tap that arrives before auth (replayed post-login). */
  stashDeferred: (target: BusinessNavTarget) => void;
}

/**
 * Handle a tapped business push: mark read, track, navigate. When
 * unauthenticated, stash the resolved target for post-login replay (mirrors
 * consumer deferred-deeplink behavior).
 */
export function processBusinessNotification(
  data: BusinessPushData,
  deps: ProcessBusinessNotificationDeps,
): void {
  const target = resolveBusinessNavTarget(data);

  if (!deps.isAuthenticated) {
    deps.stashDeferred(target);
    return;
  }

  if (typeof data.notificationId === "string" && data.notificationId.length > 0) {
    markRowClicked(data.notificationId);
  }

  try {
    mixpanelService.track("Business Push Notification Clicked", {
      notification_type: data.type ?? "unknown",
      notification_id: data.notificationId ?? "unknown",
    });
  } catch {
    // analytics best-effort
  }

  deps.router.push(target as never);
}

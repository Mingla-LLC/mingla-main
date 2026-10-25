import { stayGuestKeys } from "@mingla/brand-rendering/stayGuest";

import { queryClient } from "../config/queryClient";
import { myReservationsKeys } from "../hooks/useMyReservations";
import { purchaseKeys } from "../hooks/queryKeys";
import {
  claimAttendanceByVerifiedIdentity,
  type ClaimedEntry,
  type VerifiedIdentityClaim,
} from "./attendanceClaimService";

export type ClaimRecheckReason =
  | "sign_in"
  | "otp"
  | "email_code"
  | "add_identity"
  | "claim_link"
  | "foreground"
  | "pull_to_refresh";

export type ClaimSweepResult = {
  count: number;
  eventIds: string[];
  claims: VerifiedIdentityClaim[];
  claimed: ClaimedEntry[];
  more: boolean;
  rateLimited: boolean;
  throttled: boolean;
  reason: ClaimRecheckReason;
};

type SweepOptions = {
  showBanner?: boolean;
  now?: number;
};

const FOREGROUND_THROTTLE_MS = 10 * 60 * 1000;
const PULL_TO_REFRESH_THROTTLE_MS = 60 * 1000;
const MAX_CALLS_PER_TRIGGER = 3;

const lastForegroundByUserId = new Map<string, number>();
const lastPullRefreshByUserId = new Map<string, number>();
const rateLimitedUntilByUserId = new Map<string, number>();
const inFlightByUserId = new Map<string, Promise<ClaimSweepResult>>();
const listeners = new Set<(result: ClaimSweepResult) => void>();

export function claimSweepThrottleMs(reason: ClaimRecheckReason): number {
  if (reason === "foreground") return FOREGROUND_THROTTLE_MS;
  if (reason === "pull_to_refresh") return PULL_TO_REFRESH_THROTTLE_MS;
  return 0;
}

function lastRunForReason(userId: string, reason: ClaimRecheckReason): number | null {
  if (reason === "foreground") return lastForegroundByUserId.get(userId) ?? null;
  if (reason === "pull_to_refresh") return lastPullRefreshByUserId.get(userId) ?? null;
  return null;
}

function recordRun(userId: string, reason: ClaimRecheckReason, now: number): void {
  if (reason === "foreground") lastForegroundByUserId.set(userId, now);
  if (reason === "pull_to_refresh") lastPullRefreshByUserId.set(userId, now);
}

export function isClaimSweepThrottled(
  userId: string,
  reason: ClaimRecheckReason,
  now = Date.now(),
): boolean {
  if ((rateLimitedUntilByUserId.get(userId) ?? 0) > now) return true;
  const throttleMs = claimSweepThrottleMs(reason);
  const lastRun = lastRunForReason(userId, reason);
  return throttleMs > 0 && lastRun !== null && now - lastRun < throttleMs;
}

function emptyResult(
  reason: ClaimRecheckReason,
  fields: Partial<ClaimSweepResult> = {},
): ClaimSweepResult {
  return {
    count: 0,
    eventIds: [],
    claims: [],
    claimed: [],
    more: false,
    rateLimited: false,
    throttled: false,
    reason,
    ...fields,
  };
}

function mergeClaimedEntries(
  current: ClaimedEntry[],
  incoming: ClaimedEntry[],
): ClaimedEntry[] {
  const byKey = new Map(current.map((entry) => [`${entry.kind}:${entry.id}`, entry]));
  for (const entry of incoming) byKey.set(`${entry.kind}:${entry.id}`, entry);
  return [...byKey.values()];
}

function mergeIdentityClaims(
  current: VerifiedIdentityClaim[],
  incoming: VerifiedIdentityClaim[],
): VerifiedIdentityClaim[] {
  const byKey = new Map(
    current.map((entry) => [
      `${entry.orderId ?? "none"}:${entry.eventId}:${entry.conversationId ?? "none"}`,
      entry,
    ]),
  );
  for (const entry of incoming) {
    byKey.set(
      `${entry.orderId ?? "none"}:${entry.eventId}:${entry.conversationId ?? "none"}`,
      entry,
    );
  }
  return [...byKey.values()];
}

async function executeSweep(
  userId: string,
  reason: ClaimRecheckReason,
  options: SweepOptions,
): Promise<ClaimSweepResult> {
  const now = options.now ?? Date.now();
  if (isClaimSweepThrottled(userId, reason, now)) {
    return emptyResult(reason, { throttled: true });
  }
  recordRun(userId, reason, now);

  let aggregate = emptyResult(reason);
  for (let call = 0; call < MAX_CALLS_PER_TRIGGER; call += 1) {
    const page = await claimAttendanceByVerifiedIdentity();
    aggregate = {
      ...aggregate,
      count: aggregate.count + page.count,
      eventIds: [...new Set([...aggregate.eventIds, ...page.eventIds])],
      claims: mergeIdentityClaims(aggregate.claims, page.claims),
      claimed: mergeClaimedEntries(aggregate.claimed, page.claimed),
      more: page.more,
      rateLimited: aggregate.rateLimited || page.rateLimited,
    };
    if (page.rateLimited) {
      rateLimitedUntilByUserId.set(userId, now + FOREGROUND_THROTTLE_MS);
      break;
    }
    if (!page.more) break;
  }

  queryClient.setQueryData(purchaseKeys.lastClaim(userId), aggregate);
  if (aggregate.count > 0) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: purchaseKeys.all }),
      queryClient.invalidateQueries({ queryKey: ["businessEventOrders", userId] }),
      queryClient.invalidateQueries({ queryKey: myReservationsKeys.all }),
      queryClient.invalidateQueries({ queryKey: stayGuestKeys.all }),
    ]);
    if (options.showBanner !== false) {
      for (const listener of listeners) listener(aggregate);
    }
  }
  return aggregate;
}

export function runClaimSweep(
  userId: string,
  reason: ClaimRecheckReason,
  options: SweepOptions = {},
): Promise<ClaimSweepResult> {
  const existing = inFlightByUserId.get(userId);
  if (existing) return existing;
  const promise = executeSweep(userId, reason, options).finally(() => {
    if (inFlightByUserId.get(userId) === promise) inFlightByUserId.delete(userId);
  });
  inFlightByUserId.set(userId, promise);
  return promise;
}

export function subscribeToClaimSweepResults(
  listener: (result: ClaimSweepResult) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetClaimSweepStateForTests(): void {
  lastForegroundByUserId.clear();
  lastPullRefreshByUserId.clear();
  rateLimitedUntilByUserId.clear();
  inFlightByUserId.clear();
  listeners.clear();
}

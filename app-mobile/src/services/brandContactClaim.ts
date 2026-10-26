/**
 * #4111 Wave D — after an email sign-in, attach what this person did on the
 * web with the same (now verified) address:
 *
 *   claim_brand_enquiries_for_user      web "Message {Brand}" threads → this
 *                                       account (they appear in Friends → chats)
 *   claim_brand_subscriptions_for_user  "Stay in the loop" sign-ups → follows
 *
 * Runs next to the pending follow-invite attach in app/index.tsx. Once per
 * account per app session on success; a failure is reported (never swallowed)
 * and retried once, then again on the next sign-in or app start.
 */
import { reportNonFatal } from "../diagnostics/reportNonFatal";
import { brandFollowKeys } from "../hooks/brandFollowKeys";
import { brandEnquiryKeys } from "../hooks/queryKeys";
import { claimBrandContactForUser, type BrandContactClaim } from "./brandEnquiryService";

export interface BrandContactClaimDeps {
  claim: () => Promise<BrandContactClaim>;
  invalidate: (queryKey: readonly unknown[]) => void;
  retryDelayMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
}

const claimedThisSession = new Set<string>();
const inFlight = new Map<string, Promise<BrandContactClaim | null>>();

/** Test seam: forget which accounts already claimed this session. */
export function resetBrandContactClaimSession(): void {
  claimedThisSession.clear();
  inFlight.clear();
}

const DEFAULT_RETRY_MS = 30_000;

/**
 * Claim for `userId` when the session has a verified email. Resolves with the
 * counts, or null when skipped / failed (the failure is reported).
 */
export function runBrandContactClaim(
  userId: string,
  email: string | null | undefined,
  deps: BrandContactClaimDeps,
): Promise<BrandContactClaim | null> {
  if (typeof email !== "string" || email.trim().length === 0) return Promise.resolve(null);
  if (claimedThisSession.has(userId)) return Promise.resolve(null);
  const running = inFlight.get(userId);
  if (running !== undefined) return running;

  const attempt = async (retriesLeft: number): Promise<BrandContactClaim | null> => {
    try {
      const result = await deps.claim();
      claimedThisSession.add(userId);
      if (result.enquiries > 0) deps.invalidate(brandEnquiryKeys.list(userId));
      if (result.subscriptions > 0) deps.invalidate(brandFollowKeys.list(userId));
      return result;
    } catch (error) {
      reportNonFatal("brandContactClaim", error, { retriesLeft });
      if (retriesLeft <= 0) return null;
      await new Promise<void>((resolve) => {
        (deps.setTimer ?? setTimeout)(resolve, deps.retryDelayMs ?? DEFAULT_RETRY_MS);
      });
      return attempt(retriesLeft - 1);
    }
  };

  const promise = attempt(1).finally(() => {
    inFlight.delete(userId);
  });
  inFlight.set(userId, promise);
  return promise;
}

/** The production wiring: real RPCs, the app's one QueryClient. */
export async function runBrandContactClaimForSession(
  userId: string,
  email: string | null | undefined,
): Promise<BrandContactClaim | null> {
  const { queryClient } = await import("../config/queryClient");
  return runBrandContactClaim(userId, email, {
    claim: claimBrandContactForUser,
    invalidate: (queryKey) => {
      void queryClient.invalidateQueries({ queryKey: [...queryKey] });
    },
  });
}

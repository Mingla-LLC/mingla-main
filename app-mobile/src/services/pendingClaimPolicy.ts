/**
 * #4490 W2-N26 / N27 — the rules for the claim link code this device keeps
 * (`/c/<code>`, saved so the signed-out welcome can show "Your pass is
 * waiting" for THAT purchase). Pure: no storage, no network, no React.
 *
 * Why a stamp. The resolve call deliberately does not say whether a purchase
 * is already claimed (#4063 privacy rule: the resolver never reveals
 * `claimed`), so the device itself must know when a saved code has done its
 * job. A code carried into a signed-in session is stamped with that account;
 * once the account is in the app it is cleared, and a stamped code is never
 * shown on a later signed-out welcome (explicit sign-out, session expiry,
 * forced sign-out, or a reinstall that kept the keychain).
 */
import type { ClaimNoun, ClaimPreferredProof, PendingClaim } from "./attendanceClaimService";

export const PENDING_CLAIM_RECORD_VERSION = 2;
export const PENDING_CLAIM_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CODE = /^[0-9A-Za-z]{10}$/;

export type StoredPendingClaim = {
  v: typeof PENDING_CLAIM_RECORD_VERSION;
  code: string;
  savedAt: number;
  /** The account that was signed in when the code was saved or carried in. */
  accountId: string | null;
  /** Last good resolve, shown when the next resolve cannot reach Mingla. */
  claim: PendingClaim | null;
};

export type ParsedPendingClaim =
  | { kind: "none" }
  | { kind: "drop" }
  | { kind: "ok"; record: StoredPendingClaim };

const NOUNS: readonly ClaimNoun[] = ["ticket", "pass", "booking", "receipt"];
const PROOFS: readonly ClaimPreferredProof[] = ["email", "phone", "any"];

function cachedClaim(value: unknown, code: string): PendingClaim | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  if (row.code !== code || typeof row.title !== "string") return null;
  if (!NOUNS.includes(row.noun as ClaimNoun)) return null;
  const text = (v: unknown): string | null => (typeof v === "string" ? v : null);
  return {
    code,
    noun: row.noun as ClaimNoun,
    title: row.title,
    orderLabel: text(row.orderLabel),
    startsAt: text(row.startsAt),
    timezone: text(row.timezone) ?? "UTC",
    emailMasked: text(row.emailMasked),
    phoneLast4: text(row.phoneLast4),
    preferredProof: PROOFS.includes(row.preferredProof as ClaimPreferredProof)
      ? (row.preferredProof as ClaimPreferredProof)
      : "any",
    expired: row.expired === true,
    kind: text(row.kind),
  };
}

/**
 * A record saved before this version has no owner stamp, so the device cannot
 * tell whether an account carried it (W2-N26: the stale card was such a
 * record). It is dropped once; the purchase is still attached by the sign-in
 * sweep, and the guest can open the link again.
 */
export function parseStoredPendingClaim(
  raw: string | null | undefined,
  now: number,
): ParsedPendingClaim {
  if (!raw) return { kind: "none" };
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      value.v !== PENDING_CLAIM_RECORD_VERSION ||
      typeof value.code !== "string" || !CODE.test(value.code) ||
      typeof value.savedAt !== "number" ||
      now - value.savedAt > PENDING_CLAIM_TTL_MS || now - value.savedAt < -60_000
    ) return { kind: "drop" };
    const code = value.code.toUpperCase();
    return {
      kind: "ok",
      record: {
        v: PENDING_CLAIM_RECORD_VERSION,
        code,
        savedAt: value.savedAt,
        accountId: typeof value.accountId === "string" && value.accountId.length > 0
          ? value.accountId
          : null,
        claim: cachedClaim(value.claim, code),
      },
    };
  } catch {
    return { kind: "drop" };
  }
}

export function pendingClaimRecord(
  code: string,
  accountId: string | null,
  now: number,
  claim: PendingClaim | null = null,
): StoredPendingClaim {
  const normalized = code.trim().toUpperCase();
  return {
    v: PENDING_CLAIM_RECORD_VERSION,
    code: normalized,
    savedAt: now,
    accountId,
    claim: claim && claim.code === normalized ? claim : null,
  };
}

/** What the resolve call said, without its network details. */
export type PendingClaimResolve =
  | { status: "claim"; claim: PendingClaim }
  | { status: "redirect" }
  | { status: "not_found" }
  | { status: "unavailable" };

export type WelcomeClaimDecision =
  /** Show this purchase; save the fresh resolve as the cached copy. */
  | { action: "show"; claim: PendingClaim; cached: false }
  /** Mingla could not be reached: keep the code, show the last good copy. */
  | { action: "keep"; claim: PendingClaim | null; cached: true }
  /** Forget the code and show the normal welcome. */
  | { action: "clear" };

/**
 * A stamped record never reaches the resolve call: the account that carried
 * it has left (W2-N26 part 3). Callers check `stampedRecordMustClear` first.
 */
export function stampedRecordMustClear(record: StoredPendingClaim): boolean {
  return record.accountId !== null;
}

/**
 * W2-N26 part 1 — a SAVED code is checked each time the signed-out welcome
 * would show it. Cancelled, unconfirmed or unknown purchases (not_found), an
 * expired link and a redirect code are forgotten. Offline or a failed resolve
 * never destroys a valid saved code.
 */
export function welcomeClaimDecision(
  record: StoredPendingClaim,
  resolve: PendingClaimResolve,
): WelcomeClaimDecision {
  if (stampedRecordMustClear(record)) return { action: "clear" };
  switch (resolve.status) {
    case "claim":
      return resolve.claim.expired
        ? { action: "clear" }
        : { action: "show", claim: resolve.claim, cached: false };
    case "unavailable":
      return {
        action: "keep",
        claim: record.claim && !record.claim.expired ? record.claim : null,
        cached: true,
      };
    case "redirect":
    case "not_found":
    default:
      return { action: "clear" };
  }
}

export type AccountPendingClaimAction = "none" | "stamp" | "clear";

/**
 * W2-N26 part 2 — once an account is signed in the saved code has carried it
 * in. While that account is still in onboarding the code stays (the
 * ticket-first steps read it for prefill) but is stamped with the account;
 * once the account is in the app it is cleared. So every claim that completes
 * (banner View, detail open, sweep success, idempotent repeat) ends with no
 * saved code, whoever signed in.
 */
export function accountPendingClaimAction(input: {
  signedInUserId: string | null | undefined;
  onboardingActive: boolean;
  record: StoredPendingClaim | null;
}): AccountPendingClaimAction {
  if (!input.signedInUserId || input.record === null) return "none";
  if (!input.onboardingActive) return "clear";
  return input.record.accountId === input.signedInUserId ? "none" : "stamp";
}

/**
 * N157 — after a claim-link sign-in that attaches several purchases, View
 * opens the one the link was for. Matched on what both sides carry (kind,
 * title, start); anything ambiguous falls back to the caller's default.
 */
export function linkedClaimedEntry<
  T extends { kind: string; title: string; startsAt: string | null },
>(claimed: readonly T[], linked: PendingClaim | null): T | null {
  if (claimed.length === 1) return claimed[0];
  if (!linked || !linked.kind) return null;
  const sameStart = (a: string | null, b: string | null): boolean =>
    a === b || (a !== null && b !== null && Date.parse(a) === Date.parse(b));
  const matches = claimed.filter((entry) =>
    entry.kind === linked.kind && entry.title === linked.title &&
    sameStart(entry.startsAt, linked.startsAt)
  );
  return matches.length === 1 ? matches[0] : null;
}

/**
 * #4490 W2-N31 — the purchase the signed-out welcome card showed, held in
 * module memory so it survives the sign-in. Signing in changes the key of
 * `SessionManagementProvider` in app/index.tsx, which remounts AppContent and
 * wipes its refs and state; fix 3 kept this claim there, so the new account's
 * AppContent never knew which purchase the link was for. Memory only (never
 * stored): it holds what the card already showed, is replaced by the next
 * card and cleared by a signed-out welcome with no card.
 */
let welcomeLinkedClaimHeld: PendingClaim | null = null;

export function rememberWelcomeLinkedClaim(claim: PendingClaim | null): void {
  welcomeLinkedClaimHeld = claim;
}

export function welcomeLinkedClaim(): PendingClaim | null {
  return welcomeLinkedClaimHeld;
}

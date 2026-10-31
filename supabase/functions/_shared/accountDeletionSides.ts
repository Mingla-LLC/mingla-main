import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateIdempotencyKey } from "./idempotency.ts";
import { stripeDetach, STRIPE_API_VERSION } from "./stripe.ts";
import { paystackUpdateSubaccount } from "./paystack.ts";

export type DeletionSide = "explorer" | "business";

export interface SideDeletionResult {
  authDeleted: boolean;
  authRetained: boolean;
  side: DeletionSide;
}

/**
 * #2321 — why the auth login survived a side deletion. `authRetained: true` with
 * no attributable reason is a server bug, not a business signal: before #2321 the
 * explorer gate could not return true for ANY user, so every deletion retained auth
 * and the payload claimed "your business login is unchanged" to people who had no
 * business side. The reason is what lets the client say something true.
 */
export type AuthRetainReason =
  | "business_side_active"
  | "explorer_side_active"
  /**
   * #3660 — the user owns a brand row (live or soft-deleted). Removing the login
   * would cascade creator_accounts -> brands -> events -> orders / tickets and
   * hard-delete financial records, so the login is kept on EITHER side's deletion.
   */
  | "business_records_retained";

export interface AuthRemovalDecision {
  remove: boolean;
  /** null iff remove === true */
  reason: AuthRetainReason | null;
}

/**
 * #2321 SC-5 fail-closed rule. Deleting the explorer side may only retain auth
 * because the BUSINESS side is still active, and vice-versa. Any other pairing
 * means the gate produced a reason it cannot justify — the caller must refuse to
 * return a success payload rather than ship a message it cannot stand behind.
 */
export function isRetainReasonJustifiedForSide(
  side: DeletionSide,
  reason: AuthRetainReason | null,
): boolean {
  // #3660 — retained business records justify a kept login on both sides.
  if (reason === "business_records_retained") return true;
  if (side === "explorer") return reason === "business_side_active";
  return reason === "explorer_side_active";
}

/**
 * #2321 — a count probe that cannot tell "no rows" from "the query failed" carries
 * no information (#2113 class). Three of `userHasActiveExplorerSide`'s six probes
 * named columns that do not exist; every one of them 400'd and was read as zero.
 * Errors throw; only a real count is allowed to answer.
 */
async function countOrThrow(
  table: string,
  probe: PromiseLike<unknown>,
): Promise<number> {
  const result = await probe as {
    count?: number | null;
    error?: { message?: string } | null;
  };
  if (result?.error) {
    throw new Error(
      `[delete-user] side-gate probe on ${table} failed: ${result.error.message ?? "unknown error"}`,
    );
  }
  return result?.count ?? 0;
}

export async function userHasActiveBusinessSide(
  adminClient: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const ownedBrands = await countOrThrow(
    "brands",
    adminClient
      .from("brands")
      .select("id", { count: "exact", head: true })
      .eq("account_id", userId)
      .is("deleted_at", null),
  );

  if (ownedBrands > 0) return true;

  const teamRows = await countOrThrow(
    "brand_team_members",
    adminClient
      .from("brand_team_members")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("removed_at", null)
      .not("accepted_at", "is", null),
  );

  return teamRows > 0;
}

export async function userHasActiveExplorerSide(
  adminClient: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("explorer_deleted_at")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    throw new Error(
      `[delete-user] side-gate probe on profiles failed: ${profileError.message}`,
    );
  }

  if (profile?.explorer_deleted_at) return false;

  // #2321 — every predicate below names a column that exists in the production
  // schema. `boards.user_id`, `pairings.user_id` and `preferences.id` do NOT, and
  // each of those three 400'd on every deletion for the life of the feature.
  const countRows = (table: string, selectedColumn = "*") =>
    adminClient.from(table).select(selectedColumn, { count: "exact", head: true });

  if (await countOrThrow("friends", countRows("friends").eq("user_id", userId)) > 0) {
    return true;
  }
  if (
    await countOrThrow(
      "calendar_entries",
      countRows("calendar_entries").eq("user_id", userId),
    ) > 0
  ) {
    return true;
  }
  if (
    await countOrThrow(
      "preferences",
      countRows("preferences", "profile_id").eq("profile_id", userId),
    ) > 0
  ) {
    return true;
  }
  if (
    await countOrThrow(
      "pairings",
      countRows("pairings").or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`),
    ) > 0
  ) {
    return true;
  }
  if (await countOrThrow("boards", countRows("boards").eq("created_by", userId)) > 0) {
    return true;
  }

  // #2321 / I-2321-SIDE-GATE-IS-FALSIFIABLE — LOAD-BEARING. This was `return true`,
  // which made all six probes above decorative and made the auth-deletion gate
  // mathematically unable to pass for any user. A predicate that cannot return
  // false is not a check. Do not "simplify" this back.
  return false;
}

/**
 * #3660 — the last question before a login is removed: does this user own ANY
 * brand row, deleted or not? `brands.account_id -> creator_accounts -> auth.users`
 * is ON DELETE CASCADE all the way down to orders and tickets, so removing the
 * login of anyone who ever owned a brand would either be refused by a foreign key
 * or hard-delete the brand's financial records. No `deleted_at` filter, on
 * purpose. Goes through `countOrThrow`: a failed probe is not "zero brands".
 */
async function retainIfBusinessRecordsExist(
  adminClient: SupabaseClient,
  userId: string,
): Promise<AuthRemovalDecision> {
  const brandRows = await countOrThrow(
    "brands",
    adminClient
      .from("brands")
      .select("id", { count: "exact", head: true })
      .eq("account_id", userId),
  );
  if (brandRows > 0) return { remove: false, reason: "business_records_retained" };
  return { remove: true, reason: null };
}

/**
 * #2321 — the reason-carrying evaluator. The exported name is preserved for the
 * existing #668 callers and guards, but a retained login now says WHY, so the
 * client can name a true next action instead of guessing.
 */
export async function shouldDeleteAuthUser(
  adminClient: SupabaseClient,
  userId: string,
): Promise<AuthRemovalDecision> {
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("explorer_deleted_at")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    throw new Error(
      `[delete-user] auth-removal probe on profiles failed: ${profileError.message}`,
    );
  }

  const { data: creator, error: creatorError } = await adminClient
    .from("creator_accounts")
    .select("deleted_at")
    .eq("id", userId)
    .maybeSingle();

  if (creatorError) {
    throw new Error(
      `[delete-user] auth-removal probe on creator_accounts failed: ${creatorError.message}`,
    );
  }

  const explorerGone = profile?.explorer_deleted_at != null;
  const businessGone = creator?.deleted_at != null;
  // #4202 — an active creator_accounts row is itself a retained Business
  // identity. It may own a Creator profile, gig contracts, approved delivery
  // media or payout evidence even when it owns no brand yet. Treating only a
  // brand/team row as an active Business side made Explorer deletion attempt an
  // auth.users cascade through those records; production then either lost data
  // or failed on the first restrictive evidence FK. Keep the shared login and
  // email exactly as the Explorer-deletion contract requires.
  const businessIdentityActive = creator != null && !businessGone;

  if (explorerGone && businessGone) {
    return await retainIfBusinessRecordsExist(adminClient, userId);
  }

  const hasBusiness = businessIdentityActive ||
    await userHasActiveBusinessSide(adminClient, userId);
  const hasExplorer = await userHasActiveExplorerSide(adminClient, userId);

  const businessOk = businessGone || !hasBusiness;
  const explorerOk = explorerGone || !hasExplorer;

  if (businessOk && explorerOk) {
    return await retainIfBusinessRecordsExist(adminClient, userId);
  }
  if (!businessOk) return { remove: false, reason: "business_side_active" };
  return { remove: false, reason: "explorer_side_active" };
}

// ─────────────────────────────────────────────────────────────────────────────
// #3660 — Host account deletion: one transaction, then the outside world.
// ─────────────────────────────────────────────────────────────────────────────

export interface DeletionBlocker {
  code: string;
  count: number;
  items?: Array<{ id: string; title: string }>;
}

export interface DetachedStripeAccount {
  brand_id: string;
  stripe_account_id: string;
}

export interface ClearedPaystackSubaccount {
  brand_id: string;
  subaccount_code: string;
}

/** What `public.biz_delete_host_account` returns when it did not refuse. */
export interface BusinessPurgeResult {
  status: "deleted" | "nothing_to_delete";
  already_deleted: boolean;
  brand_ids: string[];
  events_taken_down: number;
  memberships_removed: number;
  partner_links_ended: number;
  stripe_accounts: DetachedStripeAccount[];
  paystack_subaccounts: ClearedPaystackSubaccount[];
}

/** The database refused the deletion. NOTHING was written. */
export class AccountDeletionBlockedError extends Error {
  readonly code = "account_deletion_blocked";
  readonly blockers: DeletionBlocker[];
  constructor(blockers: DeletionBlocker[]) {
    super("account_deletion_blocked");
    this.name = "AccountDeletionBlockedError";
    this.blockers = blockers;
  }
}

/** The deletion call failed or answered something unreadable. NOTHING was written. */
export class AccountDeletionFailedError extends Error {
  readonly code = "account_deletion_failed";
  constructor(detail: string) {
    super(`account_deletion_failed: ${detail}`);
    this.name = "AccountDeletionFailedError";
  }
}

/** Outside calls a Host deletion makes AFTER the database has committed. */
export interface ProviderDetachDeps {
  /** Returns a Stripe client; throws when Stripe is not configured. */
  stripeClient?: () => {
    accounts: {
      del: (
        id: string,
        opts: { apiVersion: string; idempotencyKey: string },
      ) => Promise<unknown>;
    };
  };
  paystackDeactivate?: (subaccountCode: string) => Promise<unknown>;
}

/**
 * One audit row for a provider call that failed AFTER the local detach
 * committed. Its own failure is logged and never thrown: a finished deletion
 * must not be reported as failed.
 */
async function recordProviderDetachFailure(
  adminClient: SupabaseClient,
  row: {
    user_id: string;
    brand_id: string;
    action: string;
    target_type: string;
    target_id: string;
    after: Record<string, unknown>;
  },
): Promise<void> {
  try {
    const { error } = await adminClient.from("audit_log").insert(row);
    if (error) {
      console.error(
        `[delete-user] audit write failed for ${row.action} (brand ${row.brand_id}):`,
        error.message,
      );
    }
  } catch (err) {
    console.error(
      `[delete-user] audit write threw for ${row.action} (brand ${row.brand_id}):`,
      err,
    );
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * #3660 — the Stripe half of the provider detach. The rows were already marked
 * detached inside `biz_delete_host_account`; this only tells Stripe. It takes the
 * list that function returned (it no longer re-queries, and it no longer writes
 * `stripe_connect_accounts`), it runs only after a `deleted` result, and it NEVER
 * throws: a rejection is logged, audited, and reported in the return value.
 */
export async function detachStripeForOwnedBrands(
  adminClient: SupabaseClient,
  userId: string,
  accounts: DetachedStripeAccount[],
  deps: ProviderDetachDeps = {},
): Promise<{ attempted: number; rejected: number }> {
  let rejected = 0;
  if (!accounts.length) return { attempted: 0, rejected };

  let stripe: ReturnType<NonNullable<ProviderDetachDeps["stripeClient"]>> | null = null;
  let configError: string | null = null;
  try {
    stripe = deps.stripeClient ? deps.stripeClient() : stripeDetach();
  } catch (err) {
    configError = errorText(err);
    console.error("[delete-user] Stripe not configured for detach:", configError);
  }

  for (const account of accounts) {
    let failure: string | null = configError;
    if (stripe) {
      try {
        await stripe.accounts.del(account.stripe_account_id, {
          apiVersion: STRIPE_API_VERSION,
          idempotencyKey: generateIdempotencyKey(account.brand_id, "delete_user_detach"),
        });
      } catch (err) {
        failure = errorText(err);
        console.error(
          `[delete-user] Stripe detach rejected for brand ${account.brand_id}:`,
          failure,
        );
      }
    }
    if (failure !== null) {
      rejected += 1;
      await recordProviderDetachFailure(adminClient, {
        user_id: userId,
        brand_id: account.brand_id,
        action: "stripe_connect.detach_local_success_stripe_rejected",
        target_type: "stripe_connect_account",
        target_id: account.stripe_account_id,
        after: { stripe_delete_error: failure, via: "host_account.deleted" },
      });
    }
  }
  return { attempted: accounts.length, rejected };
}

/**
 * #3660 — the Paystack half. Before this, NOTHING Paystack-related happened on a
 * Host deletion. The subaccount is deactivated; the transfer recipient is left
 * alone on the provider side because Paystack de-duplicates recipients and one
 * code can belong to another brand (#3192). Never throws.
 */
export async function deactivatePaystackForOwnedBrands(
  adminClient: SupabaseClient,
  userId: string,
  subaccounts: ClearedPaystackSubaccount[],
  deps: ProviderDetachDeps = {},
): Promise<{ attempted: number; rejected: number }> {
  let rejected = 0;
  const deactivate = deps.paystackDeactivate ??
    ((code: string) => paystackUpdateSubaccount(code, { active: false }));

  for (const sub of subaccounts) {
    try {
      await deactivate(sub.subaccount_code);
    } catch (err) {
      rejected += 1;
      const failure = errorText(err);
      console.error(
        `[delete-user] Paystack subaccount deactivate rejected for brand ${sub.brand_id}:`,
        failure,
      );
      await recordProviderDetachFailure(adminClient, {
        user_id: userId,
        brand_id: sub.brand_id,
        action: "paystack.subaccount_deactivate_failed",
        target_type: "paystack_subaccount",
        target_id: sub.subaccount_code,
        after: { paystack_error: failure, via: "host_account.deleted" },
      });
    }
  }
  return { attempted: subaccounts.length, rejected };
}

export async function purgeExplorerSideData(
  adminClient: SupabaseClient,
  userId: string,
): Promise<void> {
  const deletes: Array<Promise<unknown>> = [];

  const deleteByUser = (table: string, column = "user_id") =>
    adminClient.from(table).delete().eq(column, userId).then(({ error }) => {
      if (error) console.warn(`[delete-user] purge ${table}:`, error.message);
    });

  deletes.push(
    deleteByUser("friends"),
    adminClient.from("friends").delete().eq("friend_user_id", userId).then(({ error }) => {
      if (error) console.warn("[delete-user] purge friends (friend_user_id):", error.message);
    }),
    // #2321 — `pairings` has no `user_id`; production logs show this purge failing
    // on every single deletion. Two calls, mirroring the friends/blocked_users shape.
    deleteByUser("pairings", "user_a_id"),
    adminClient.from("pairings").delete().eq("user_b_id", userId).then(({ error }) => {
      if (error) console.warn("[delete-user] purge pairings (user_b_id):", error.message);
    }),
    deleteByUser("pair_requests", "sender_id"),
    adminClient.from("pair_requests").delete().eq("receiver_id", userId).then(({ error }) => {
      if (error) console.warn("[delete-user] purge pair_requests receiver:", error.message);
    }),
    deleteByUser("calendar_entries"),
    deleteByUser("discover_daily_cache"),
    deleteByUser("blocked_users", "blocker_id"),
    adminClient.from("blocked_users").delete().eq("blocked_id", userId).then(({ error }) => {
      if (error) console.warn("[delete-user] purge blocked_users blocked:", error.message);
    }),
    deleteByUser("muted_users", "muter_id"),
    adminClient.from("muted_users").delete().eq("muted_id", userId).then(({ error }) => {
      if (error) console.warn("[delete-user] purge muted_users muted:", error.message);
    }),
    deleteByUser("notification_preferences"),
    deleteByUser("notifications"),
    deleteByUser("activity_history"),
    deleteByUser("preferences", "profile_id"),
  );

  // Remove from support + consumer conversations (support must not leak to consumer inbox).
  const { data: participantRows } = await adminClient
    .from("conversation_participants")
    .select("conversation_id, conversations!inner(linked_entity_type)")
    .eq("user_id", userId);

  if (participantRows?.length) {
    const convIds = participantRows.map((r: { conversation_id: string }) => r.conversation_id);
    deletes.push(
      adminClient
        .from("conversation_participants")
        .delete()
        .eq("user_id", userId)
        .in("conversation_id", convIds)
        .then(({ error }) => {
          if (error) console.warn("[delete-user] purge conversation_participants:", error.message);
        }),
    );
  }

  await Promise.allSettled(deletes);

  // #2321 — the identity scrub is the write that makes deletion real. It used to
  // discard its result: PostgREST rejected the whole UPDATE for one unknown column
  // and the user kept their name, username, avatar, bio and onboarding flag while
  // the app told them the account was gone. It throws now.
  const { error: scrubError } = await adminClient
    .from("profiles")
    .update({
      explorer_deleted_at: new Date().toISOString(),
      display_name: null,
      first_name: null,
      last_name: null,
      username: null,
      avatar_url: null,
      bio: null,
      has_completed_onboarding: false,
    })
    .eq("id", userId);

  if (scrubError) {
    console.error("[delete-user] identity scrub FAILED:", scrubError.message);
    throw new Error(
      "Account deletion could not be completed. Please contact support.",
    );
  }
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * #3660 / I-PROPOSED-3660-HOST-DELETION-IS-ONE-TRANSACTION — LOAD-BEARING.
 *
 * This used to be three unchecked table writes (brands, brand_team_members,
 * creator_accounts) after an unchecked Stripe call. One could land alone: the
 * brand soft-delete was refused by a database guard while the account stamp
 * still landed, leaving an account marked deleted that still owned a live brand.
 *
 * It is now exactly ONE call. Every check and every write happens inside
 * `public.biz_delete_host_account`, in one transaction. Do not add a table write
 * or a provider call here.
 *
 *   RPC error / unreadable answer -> AccountDeletionFailedError  (nothing written)
 *   status "blocked"              -> AccountDeletionBlockedError (nothing written)
 *   "deleted" / "nothing_to_delete" -> the payload
 */
export async function purgeBusinessSideData(
  adminClient: SupabaseClient,
  userId: string,
): Promise<BusinessPurgeResult> {
  const { data, error } = await adminClient.rpc("biz_delete_host_account", {
    p_user_id: userId,
  });

  if (error) {
    console.error("[delete-user] biz_delete_host_account failed:", error.message);
    throw new AccountDeletionFailedError(error.message ?? "rpc_error");
  }

  const payload = (data ?? null) as Record<string, unknown> | null;
  const status = payload?.status;

  if (status === "blocked") {
    throw new AccountDeletionBlockedError(asArray<DeletionBlocker>(payload?.blockers));
  }
  if (status !== "deleted" && status !== "nothing_to_delete") {
    console.error("[delete-user] biz_delete_host_account returned an unknown status:", status);
    throw new AccountDeletionFailedError("unknown_status");
  }

  return {
    status,
    already_deleted: payload?.already_deleted === true,
    brand_ids: asArray<string>(payload?.brand_ids),
    events_taken_down: Number(payload?.events_taken_down ?? 0),
    memberships_removed: Number(payload?.memberships_removed ?? 0),
    partner_links_ended: Number(payload?.partner_links_ended ?? 0),
    stripe_accounts: asArray<DetachedStripeAccount>(payload?.stripe_accounts),
    paystack_subaccounts: asArray<ClearedPaystackSubaccount>(payload?.paystack_subaccounts),
  };
}

export interface AuthStepResult {
  authDeleted: boolean;
  authRetained: boolean;
  retainedReason: AuthRetainReason | null;
}

export interface AuthStepDeps {
  /** Defaults to `shouldDeleteAuthUser(adminClient, userId)`. */
  decide?: () => Promise<AuthRemovalDecision>;
  /** Defaults to `adminClient.auth.admin.deleteUser(userId)`. */
  deleteUser?: () => Promise<{ error: unknown }>;
}

/**
 * The login step (moved here from delete-user/index.ts by #3660 so it can be
 * executed in a test).
 *
 * `side === "explorer"`: unchanged. A failed removal throws.
 *
 * `side === "business"`: this runs AFTER `biz_delete_host_account` committed a
 * state that is complete without the login step. Nothing here may turn that
 * finished deletion into a failure, so any error is logged and reported as a
 * retained login. There is nothing half-done to undo.
 */
export async function deleteAuthUserIfReady(
  adminClient: SupabaseClient,
  userId: string,
  side: DeletionSide,
  deps: AuthStepDeps = {},
): Promise<AuthStepResult> {
  const decide = deps.decide ?? (() => shouldDeleteAuthUser(adminClient, userId));
  const deleteUser = deps.deleteUser ??
    (() => adminClient.auth.admin.deleteUser(userId));

  const retainedAfterBusinessCommit = (why: string, err: unknown): AuthStepResult => {
    console.error(
      `[delete-user] side=business login step did not complete for ${userId} (${why}); ` +
        "the Host side is already deleted, the login is kept:",
      err,
    );
    return {
      authDeleted: false,
      authRetained: true,
      retainedReason: "business_records_retained",
    };
  };

  let decision: AuthRemovalDecision;
  try {
    decision = await decide();
  } catch (err) {
    if (side === "business") return retainedAfterBusinessCommit("gate probe failed", err);
    throw err;
  }

  if (!decision.remove) {
    console.log(
      `[delete-user] Auth retained for ${userId} — reason=${decision.reason ?? "unattributed"}`,
    );
    return { authDeleted: false, authRetained: true, retainedReason: decision.reason };
  }

  console.log("[delete-user] Deleting auth user (CASCADE handles remaining tables)...");
  let deleteAuthError: unknown = null;
  try {
    ({ error: deleteAuthError } = await deleteUser());
  } catch (err) {
    deleteAuthError = err;
  }
  if (deleteAuthError) {
    if (side === "business") {
      return retainedAfterBusinessCommit("auth.admin.deleteUser failed", deleteAuthError);
    }
    console.error("[delete-user] Auth deletion failed:", deleteAuthError);
    throw new Error("Failed to delete account. Please try again.");
  }

  try {
    const { data: survivingProfile, error: surviveError } = await adminClient
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();
    if (surviveError) {
      // #3660 rework (F-3): the login is ALREADY gone here. Before #3660 this
      // probe read only `data`, so a probe error still answered "deleted", and
      // SC-10 says the explorer side is unchanged. A first cut of #3660 threw
      // here and told a user whose login had just been removed that the
      // deletion failed. The error is logged (not swallowed) and never thrown,
      // on either side. Do not turn this back into a throw.
      console.error(
        `[delete-user] surviving-profile probe failed after login removal for ${userId}:`,
        surviveError.message,
      );
    }

    if (survivingProfile) {
      const { error: profileError } = await adminClient
        .from("profiles")
        .delete()
        .eq("id", userId);
      if (profileError) {
        throw new Error(
          "Account partially deleted. Please contact support to complete removal.",
        );
      }
    }
  } catch (err) {
    // The login IS gone at this point on either side. On the business side the
    // response must stay 2xx; the leftover profile row is logged for support.
    if (side !== "business") throw err;
    console.error(
      `[delete-user] side=business profile cleanup after login removal failed for ${userId}:`,
      err,
    );
  }

  return { authDeleted: true, authRetained: false, retainedReason: null };
}

export type BusinessDeletionOutcome =
  | { kind: "blocked"; blockers: DeletionBlocker[] }
  | { kind: "failed" }
  | ({ kind: "done"; purge: BusinessPurgeResult } & AuthStepResult);

export interface BusinessDeletionDeps extends ProviderDetachDeps, AuthStepDeps {
  /** Defaults to `purgeBusinessSideData(adminClient, userId)`. */
  purge?: () => Promise<BusinessPurgeResult>;
  /** Runs only after a committed deletion. Its failure is logged, never thrown. */
  recordTrialPhone?: () => Promise<void>;
}

/**
 * #3660 — the whole Host-side deletion, in the only order that is safe:
 *
 *   1. `purgeBusinessSideData`  — one transaction; refuses or commits everything.
 *   2. (only after a commit) trial-phone record, Stripe, Paystack, the login.
 *
 * Nothing in step 2 runs on `blocked` or `failed`, and nothing in step 2 can
 * change the outcome from `done`. The caller maps `blocked` -> 409,
 * `failed` -> 500, `done` -> 200.
 */
export async function runBusinessSideDeletion(
  adminClient: SupabaseClient,
  userId: string,
  deps: BusinessDeletionDeps = {},
): Promise<BusinessDeletionOutcome> {
  let purge: BusinessPurgeResult;
  try {
    purge = await (deps.purge
      ? deps.purge()
      : purgeBusinessSideData(adminClient, userId));
  } catch (err) {
    if (err instanceof AccountDeletionBlockedError) {
      return { kind: "blocked", blockers: err.blockers };
    }
    console.error("[delete-user] Host account deletion did not run:", err);
    return { kind: "failed" };
  }

  // ── Committed. From here on every step logs and continues. ────────────────
  if (deps.recordTrialPhone) {
    try {
      await deps.recordTrialPhone();
    } catch (err) {
      console.error("[delete-user] trial phone record failed after deletion:", err);
    }
  }

  try {
    await detachStripeForOwnedBrands(adminClient, userId, purge.stripe_accounts, deps);
  } catch (err) {
    console.error("[delete-user] Stripe detach step threw after deletion:", err);
  }
  try {
    await deactivatePaystackForOwnedBrands(
      adminClient,
      userId,
      purge.paystack_subaccounts,
      deps,
    );
  } catch (err) {
    console.error("[delete-user] Paystack deactivate step threw after deletion:", err);
  }

  let auth: AuthStepResult;
  try {
    auth = await deleteAuthUserIfReady(adminClient, userId, "business", deps);
  } catch (err) {
    console.error("[delete-user] login step threw after deletion:", err);
    auth = {
      authDeleted: false,
      authRetained: true,
      retainedReason: "business_records_retained",
    };
  }

  return { kind: "done", purge, ...auth };
}

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateIdempotencyKey } from "./idempotency.ts";
import { stripeDetach, STRIPE_API_VERSION } from "./stripe.ts";

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
export type AuthRetainReason = "business_side_active" | "explorer_side_active";

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

  if (explorerGone && businessGone) return { remove: true, reason: null };

  const hasBusiness = await userHasActiveBusinessSide(adminClient, userId);
  const hasExplorer = await userHasActiveExplorerSide(adminClient, userId);

  const businessOk = businessGone || !hasBusiness;
  const explorerOk = explorerGone || !hasExplorer;

  if (businessOk && explorerOk) return { remove: true, reason: null };
  if (!businessOk) return { remove: false, reason: "business_side_active" };
  return { remove: false, reason: "explorer_side_active" };
}

export async function detachStripeForOwnedBrands(
  adminClient: SupabaseClient,
  userId: string,
): Promise<void> {
  const { data: brands } = await adminClient
    .from("brands")
    .select("id")
    .eq("account_id", userId);

  if (!brands?.length) return;

  let stripe: ReturnType<typeof stripeDetach> | null = null;
  try {
    stripe = stripeDetach();
  } catch (err) {
    console.warn("[delete-user] Stripe not configured for detach:", err);
  }

  for (const brand of brands) {
    const brandId = brand.id as string;
    const { data: row } = await adminClient
      .from("stripe_connect_accounts")
      .select("stripe_account_id, detached_at")
      .eq("brand_id", brandId)
      .maybeSingle();

    if (row?.stripe_account_id && !row.detached_at && stripe) {
      try {
        // @ts-ignore — Stripe SDK accounts namespace is runtime-provided.
        await stripe.accounts.del(row.stripe_account_id as string, {
          apiVersion: STRIPE_API_VERSION,
          idempotencyKey: generateIdempotencyKey(brandId, "delete_user_detach"),
        });
      } catch (err) {
        console.warn(`[delete-user] Stripe detach rejected for brand ${brandId}:`, err);
      }
    }

    if (row) {
      const detachedAt = new Date().toISOString();
      await adminClient
        .from("stripe_connect_accounts")
        .update({ detached_at: detachedAt, updated_at: detachedAt })
        .eq("brand_id", brandId);
    }
  }
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

export async function purgeBusinessSideData(
  adminClient: SupabaseClient,
  userId: string,
): Promise<void> {
  await detachStripeForOwnedBrands(adminClient, userId);

  const now = new Date().toISOString();

  await adminClient
    .from("brands")
    .update({ deleted_at: now })
    .eq("account_id", userId)
    .is("deleted_at", null);

  await adminClient
    .from("brand_team_members")
    .update({ removed_at: now })
    .eq("user_id", userId)
    .is("removed_at", null);

  await adminClient
    .from("creator_accounts")
    .update({ deleted_at: now })
    .eq("id", userId);
}

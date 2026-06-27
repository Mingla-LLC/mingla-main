import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateIdempotencyKey } from "./idempotency.ts";
import { stripeDetach, STRIPE_API_VERSION } from "./stripe.ts";

export type DeletionSide = "explorer" | "business";

export interface SideDeletionResult {
  authDeleted: boolean;
  authRetained: boolean;
  side: DeletionSide;
}

export async function userHasActiveBusinessSide(
  adminClient: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { count: ownedBrands } = await adminClient
    .from("brands")
    .select("id", { count: "exact", head: true })
    .eq("account_id", userId)
    .is("deleted_at", null);

  if ((ownedBrands ?? 0) > 0) return true;

  const { count: teamRows } = await adminClient
    .from("brand_team_members")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("removed_at", null)
    .not("accepted_at", "is", null);

  return (teamRows ?? 0) > 0;
}

export async function userHasActiveExplorerSide(
  adminClient: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data: profile } = await adminClient
    .from("profiles")
    .select("explorer_deleted_at")
    .eq("id", userId)
    .maybeSingle();

  if (profile?.explorer_deleted_at) return false;

  const tables = [
    "friends",
    "boards",
    "pairings",
    "calendar_entries",
    "preferences",
  ] as const;

  for (const table of tables) {
    const column = table === "preferences" ? "profile_id" : "user_id";
    const { count } = await adminClient
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq(column, userId);
    if ((count ?? 0) > 0) return true;
  }

  const { count: boardCreated } = await adminClient
    .from("boards")
    .select("id", { count: "exact", head: true })
    .eq("created_by", userId);
  if ((boardCreated ?? 0) > 0) return true;

  return true;
}

export async function shouldDeleteAuthUser(
  adminClient: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data: profile } = await adminClient
    .from("profiles")
    .select("explorer_deleted_at")
    .eq("id", userId)
    .maybeSingle();

  const { data: creator } = await adminClient
    .from("creator_accounts")
    .select("deleted_at")
    .eq("id", userId)
    .maybeSingle();

  const explorerGone = profile?.explorer_deleted_at != null;
  const businessGone = creator?.deleted_at != null;

  if (explorerGone && businessGone) return true;

  const hasBusiness = await userHasActiveBusinessSide(adminClient, userId);
  const hasExplorer = await userHasActiveExplorerSide(adminClient, userId);

  const businessOk = businessGone || !hasBusiness;
  const explorerOk = explorerGone || !hasExplorer;

  return businessOk && explorerOk;
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
    deleteByUser("pairings"),
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

  await adminClient
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

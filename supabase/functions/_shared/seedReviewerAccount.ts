// supabase/functions/_shared/seedReviewerAccount.ts
//
// ORCH-1245 [Seed the App Review reviewer account with pre-populated content].
//
// Apple 2.1(a) rejected build 34: the App Review bypass account
// (+12015550199 / 123456 — see verify-otp/index.ts) lands in a FRESH EMPTY
// account every review (no friends, chats, posts), so reviewers can't verify
// those features. This helper seeds that account, idempotently and safely,
// with realistic FRIENDS (pairings + friends), a GROUP CHAT (collaboration
// session + messages) and POSTS (saved_card), the first time the reviewer
// signs in. It runs INSIDE the existing reviewer bypass branch of verify-otp,
// using the service-role client already in scope.
//
// SAFETY INVARIANTS (see REVIEWER_SEED_DESIGN.md):
//  - Reachable ONLY for the fictional reviewer phone (caller-gated in
//    verify-otp). Every write targets ONLY `reviewerUserId` or the three
//    persistent `*@review.mingla.internal` demo-friend ids. No query touches
//    arbitrary users.
//  - Idempotent: early-return if the reviewer already has any `pairings` row
//    or any `collaboration_sessions` they created. Demo-friends are idempotent
//    via the email-lookup-or-create convention.
//  - Free-tier limits: seed EXACTLY ONE collaboration_session (the
//    enforce_session_creation_limit_trigger rejects a 2nd, max_sessions=1).
//    The pairing cap is NOT trigger-enforced, so 3 pairings is safe.
//  - The group conversation + creator participant are AUTO-created by the
//    ensure_group_conversation_on_session_create AFTER-INSERT trigger — we do
//    NOT hand-insert the conversation. session_participants must be inserted
//    with has_accepted=true or the mirror trigger won't add them to the roster.
//  - Never blocks login: the whole body is wrapped so a seed failure logs and
//    returns normally (the caller also wraps the await in try/catch).

// @ts-ignore — Deno ESM import (pin matches the other _shared edge helpers)
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// ─────────────────────────────────────────────────────────────────────────────
// Stable demo-friend identities. Keyed by a fixed internal email so the SAME
// three auth.users are reused across every review (create-or-lookup). The
// `@review.mingla.internal` domain can never be a real signup.
// ─────────────────────────────────────────────────────────────────────────────
export interface DemoFriendSpec {
  email: string;
  display_name: string;
  username: string;
  avatar_url: string;
}

export const DEMO_FRIENDS: readonly DemoFriendSpec[] = [
  {
    email: "demo-friend-1@review.mingla.internal",
    display_name: "Maya Chen",
    username: "mayachen",
    avatar_url:
      "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=256&h=256&fit=crop&crop=faces&auto=format",
  },
  {
    email: "demo-friend-2@review.mingla.internal",
    display_name: "Jordan Blake",
    username: "jordanblake",
    avatar_url:
      "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=256&h=256&fit=crop&crop=faces&auto=format",
  },
  {
    email: "demo-friend-3@review.mingla.internal",
    display_name: "Sam Okoro",
    username: "samokoro",
    avatar_url:
      "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=256&h=256&fit=crop&crop=faces&auto=format",
  },
];

// Reviewer's own profile polish.
export const REVIEWER_PROFILE = {
  display_name: "Alex Rivera",
  username: "alexrivera",
  avatar_url:
    "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=256&h=256&fit=crop&crop=faces&auto=format",
};

// ─────────────────────────────────────────────────────────────────────────────
// PURE HELPERS (unit-tested in __tests__/seedReviewerAccount.test.ts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canonical pairing UUID ordering. The `pairings_ordered` CHECK requires
 * user_a_id < user_b_id (lexicographic string compare on the UUID text).
 */
export function orderPair(
  a: string,
  b: string,
): { user_a_id: string; user_b_id: string } {
  return a < b
    ? { user_a_id: a, user_b_id: b }
    : { user_a_id: b, user_b_id: a };
}

/**
 * Idempotency decision: given whether the reviewer already has a pairing OR a
 * session they created, decide whether seeding should be skipped.
 */
export function shouldSkipSeed(hasPairing: boolean, hasSession: boolean): boolean {
  return hasPairing || hasSession;
}

export interface SeededMessage {
  conversation_id: string;
  sender_id: string;
  content: string;
  message_type: "text";
  created_at: string;
}

/**
 * Build the group-chat message rows. Senders alternate between the reviewer and
 * the demo-friends; created_at is staggered (oldest first) so the thread reads
 * naturally. Every row carries the NOT-NULL columns (conversation_id, content)
 * and a CHECK-valid message_type.
 */
export function buildMessages(
  conversationId: string,
  reviewerUserId: string,
  friendIds: string[],
  baseTime: number = Date.now(),
): SeededMessage[] {
  const [f1, f2, f3] = friendIds;
  // Scripted, realistic "Weekend Plans" thread, oldest → newest.
  const script: { sender: string; content: string }[] = [
    { sender: f1, content: "Who's free this Saturday? Found a cool spot 👀" },
    { sender: reviewerUserId, content: "I'm in! What did you have in mind?" },
    { sender: f2, content: "There's a rooftop place downtown with live music" },
    { sender: f3, content: "Love that. Let's lock it in for 7pm 🙌" },
    { sender: reviewerUserId, content: "Perfect — I'll save it to the group." },
  ];
  // 6 minutes apart, ending ~now.
  const stepMs = 6 * 60 * 1000;
  const start = baseTime - script.length * stepMs;
  return script.map((m, i) => ({
    conversation_id: conversationId,
    sender_id: m.sender,
    content: m.content,
    message_type: "text" as const,
    created_at: new Date(start + i * stepMs).toISOString(),
  }));
}

export interface SeededCard {
  profile_id: string;
  experience_id: string;
  title: string;
  category: string;
  image_url: string;
  card_data: Record<string, unknown>;
}

/**
 * Build the saved_card "posts". Each row carries every NOT-NULL column
 * (profile_id, experience_id, card_data) and a self-describing card_data
 * payload the consumer UI re-hydrates from (savedCardsService.normalizeRecord).
 */
export function buildSavedCards(reviewerUserId: string): SeededCard[] {
  const seeds: { id: string; title: string; category: string; image: string }[] = [
    {
      id: "reviewer-seed-card-1",
      title: "Sunset Rooftop Lounge",
      category: "Nightlife",
      image:
        "https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=800&auto=format",
    },
    {
      id: "reviewer-seed-card-2",
      title: "Harbor Walk & Coffee",
      category: "Outdoors",
      image:
        "https://images.unsplash.com/photo-1493857671505-72967e2e2760?w=800&auto=format",
    },
    {
      id: "reviewer-seed-card-3",
      title: "Live Jazz Night",
      category: "Music",
      image:
        "https://images.unsplash.com/photo-1511192336575-5a79af67a629?w=800&auto=format",
    },
  ];
  return seeds.map((s) => ({
    profile_id: reviewerUserId,
    experience_id: s.id,
    title: s.title,
    category: s.category,
    image_url: s.image,
    card_data: {
      id: s.id,
      title: s.title,
      category: s.category,
      image: s.image,
      images: [s.image],
      source: "solo",
      dateAdded: new Date().toISOString(),
    },
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// DEMO-FRIEND ACCOUNT ENSURE (create-or-lookup, idempotent)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ensure a single demo-friend auth.users exists for `spec.email` and return its
 * id. createUser ignores a custom id, so the email is the stable key: try to
 * create; if it already exists, page through listUsers to resolve the id.
 * handle_new_user auto-creates the profiles row on insert; we then polish it.
 */
async function ensureDemoFriend(
  service: SupabaseClient,
  spec: DemoFriendSpec,
): Promise<string | null> {
  let userId: string | null = null;

  const { data: created, error: createErr } = await service.auth.admin.createUser({
    email: spec.email,
    email_confirm: true,
    user_metadata: { display_name: spec.display_name, account_type: "explorer" },
  });

  if (created?.user?.id) {
    userId = created.user.id;
  } else {
    // Already exists (or transient) — resolve the id by paging listUsers.
    if (createErr) {
      console.warn(
        `[seedReviewerAccount] createUser(${spec.email}) returned: ${createErr.message} — resolving existing id`,
      );
    }
    userId = await findUserIdByEmail(service, spec.email);
  }

  if (!userId) {
    console.error(
      `[seedReviewerAccount] Could not ensure demo friend ${spec.email}`,
    );
    return null;
  }

  // Polish the auto-created profiles row. is_seed=true keeps these accounts out
  // of any real-user surface that excludes seeds (verified to exist on profiles).
  const { error: profErr } = await service
    .from("profiles")
    .update({
      display_name: spec.display_name,
      username: spec.username,
      avatar_url: spec.avatar_url,
      has_completed_onboarding: true,
      is_seed: true,
    })
    .eq("id", userId);
  if (profErr) {
    console.warn(
      `[seedReviewerAccount] profile polish for ${spec.email} failed: ${profErr.message}`,
    );
  }

  return userId;
}

/** Page through admin.listUsers to find a user id by exact email. */
async function findUserIdByEmail(
  service: SupabaseClient,
  email: string,
): Promise<string | null> {
  const target = email.toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      console.error(`[seedReviewerAccount] listUsers page ${page} failed: ${error.message}`);
      return null;
    }
    const match = data?.users?.find((u) => (u.email ?? "").toLowerCase() === target);
    if (match) return match.id;
    if (!data?.users || data.users.length < 200) break; // last page
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENTRY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Seed the reviewer's account with friends, a group chat, and posts. Idempotent
 * and reviewer-only. NEVER throws — a seeding failure must not block login.
 */
export async function seedReviewerAccount(
  service: SupabaseClient,
  reviewerUserId: string,
): Promise<void> {
  try {
    // ── IDEMPOTENCY ──────────────────────────────────────────────────────────
    const { data: existingPairing } = await service
      .from("pairings")
      .select("id")
      .or(`user_a_id.eq.${reviewerUserId},user_b_id.eq.${reviewerUserId}`)
      .limit(1)
      .maybeSingle();

    const { data: existingSession } = await service
      .from("collaboration_sessions")
      .select("id")
      .eq("created_by", reviewerUserId)
      .limit(1)
      .maybeSingle();

    if (shouldSkipSeed(!!existingPairing, !!existingSession)) {
      console.log("[seedReviewerAccount] Already seeded — skipping.");
      return;
    }

    console.log("[seedReviewerAccount] Seeding reviewer account", reviewerUserId);

    // ── REVIEWER PROFILE POLISH ──────────────────────────────────────────────
    const { error: reviewerProfErr } = await service
      .from("profiles")
      .update({
        display_name: REVIEWER_PROFILE.display_name,
        username: REVIEWER_PROFILE.username,
        avatar_url: REVIEWER_PROFILE.avatar_url,
        has_completed_onboarding: true,
      })
      .eq("id", reviewerUserId);
    if (reviewerProfErr) {
      console.warn(
        `[seedReviewerAccount] reviewer profile polish failed: ${reviewerProfErr.message}`,
      );
    }

    // ── DEMO FRIENDS (ensure + polish) ───────────────────────────────────────
    const friendIds: string[] = [];
    for (const spec of DEMO_FRIENDS) {
      const id = await ensureDemoFriend(service, spec);
      if (id) friendIds.push(id);
    }
    if (friendIds.length === 0) {
      console.error("[seedReviewerAccount] No demo friends ensured — aborting seed.");
      return;
    }

    // ── FRIENDS: pair_requests → pairings (+ friends both directions) ─────────
    for (const friendId of friendIds) {
      // pair_request first (pairings.pair_request_id is NOT NULL).
      const { data: pr, error: prErr } = await service
        .from("pair_requests")
        .insert({
          sender_id: reviewerUserId,
          receiver_id: friendId,
          status: "accepted",
          visibility: "visible",
        })
        .select("id")
        .single();
      if (prErr || !pr) {
        console.warn(
          `[seedReviewerAccount] pair_request for ${friendId} failed: ${prErr?.message}`,
        );
        continue;
      }

      const ordered = orderPair(reviewerUserId, friendId);
      const { error: pairErr } = await service.from("pairings").insert({
        user_a_id: ordered.user_a_id,
        user_b_id: ordered.user_b_id,
        pair_request_id: pr.id,
      });
      if (pairErr) {
        console.warn(
          `[seedReviewerAccount] pairing for ${friendId} failed: ${pairErr.message}`,
        );
      }

      // Also seed the directional `friends` rows (both directions, accepted) so
      // demo friends show on surfaces that read `friends` as well as `pairings`.
      const { error: friendsErr } = await service.from("friends").insert([
        { user_id: reviewerUserId, friend_user_id: friendId, status: "accepted" },
        { user_id: friendId, friend_user_id: reviewerUserId, status: "accepted" },
      ]);
      if (friendsErr) {
        console.warn(
          `[seedReviewerAccount] friends rows for ${friendId} failed: ${friendsErr.message}`,
        );
      }
    }

    // ── GROUP CHAT: exactly ONE session (triggers build the conversation) ─────
    const { data: session, error: sessErr } = await service
      .from("collaboration_sessions")
      .insert({
        name: "Weekend Plans",
        created_by: reviewerUserId,
        session_type: "group_hangout",
        status: "active",
        is_active: true,
      })
      .select("id")
      .single();

    if (sessErr || !session) {
      console.error(
        `[seedReviewerAccount] session insert failed: ${sessErr?.message} — chat not seeded.`,
      );
    } else {
      // session_participants for each friend with has_accepted=true → the mirror
      // trigger copies them into conversation_participants. (Creator already
      // added by ensure_group_conversation_on_session_create.)
      const { error: spErr } = await service.from("session_participants").insert(
        friendIds.map((uid) => ({
          session_id: session.id,
          user_id: uid,
          has_accepted: true,
          role: "member",
        })),
      );
      if (spErr) {
        console.warn(
          `[seedReviewerAccount] session_participants failed: ${spErr.message}`,
        );
      }

      // Resolve the auto-created group conversation for this session.
      const { data: conv } = await service
        .from("conversations")
        .select("id")
        .eq("session_id", session.id)
        .eq("linked_entity_type", "session")
        .maybeSingle();

      if (conv?.id) {
        const rows = buildMessages(conv.id, reviewerUserId, friendIds);
        const { error: msgErr } = await service.from("messages").insert(rows);
        if (msgErr) {
          console.warn(`[seedReviewerAccount] messages insert failed: ${msgErr.message}`);
        }
      } else {
        console.warn(
          "[seedReviewerAccount] group conversation not found for session — messages skipped.",
        );
      }
    }

    // ── POSTS: saved_card rows ───────────────────────────────────────────────
    const cards = buildSavedCards(reviewerUserId);
    const { error: cardErr } = await service
      .from("saved_card")
      .upsert(cards, { onConflict: "profile_id,experience_id" });
    if (cardErr) {
      console.warn(`[seedReviewerAccount] saved_card insert failed: ${cardErr.message}`);
    }

    console.log("[seedReviewerAccount] Seed complete for", reviewerUserId);
  } catch (err) {
    // NEVER block login on a seed error.
    console.error(
      "[seedReviewerAccount] Unexpected seed error (login continues):",
      (err as Error)?.message ?? err,
    );
  }
}

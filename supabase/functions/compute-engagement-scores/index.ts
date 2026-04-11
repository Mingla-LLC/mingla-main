import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MIXPANEL_TOKEN = "f475c3f34381fef9cc8682a714b5768e";
const MIXPANEL_ENGAGE_URL = "https://api.mixpanel.com/engage#profile-set";
const BATCH_SIZE = 200; // Mixpanel allows up to 2000, keep conservative

// ── Scoring weights ─────────────────────────────────────────────────────────
const WEIGHT_RECENCY = 0.30;
const WEIGHT_FREQUENCY = 0.25;
const WEIGHT_DEPTH = 0.20;
const WEIGHT_SOCIAL = 0.15;
const WEIGHT_MONETIZATION = 0.10;

// ── Score helpers ───────────────────────────────────────────────────────────

function scoreRecency(daysSinceActive: number): number {
  if (daysSinceActive <= 0) return 100;
  if (daysSinceActive <= 1) return 90;
  if (daysSinceActive <= 3) return 70;
  if (daysSinceActive <= 7) return 50;
  if (daysSinceActive <= 14) return 30;
  if (daysSinceActive <= 30) return 10;
  return 0;
}

function scoreFrequency(sessions14d: number): number {
  if (sessions14d >= 10) return 100;
  if (sessions14d >= 7) return 80;
  if (sessions14d >= 4) return 60;
  if (sessions14d >= 2) return 40;
  if (sessions14d >= 1) return 20;
  return 0;
}

function scoreDepth(saves14d: number): number {
  if (saves14d >= 15) return 100;
  if (saves14d >= 10) return 80;
  if (saves14d >= 5) return 60;
  if (saves14d >= 3) return 40;
  if (saves14d >= 1) return 20;
  return 0;
}

function scoreSocial(friendsCount: number, hasActiveSession: boolean): number {
  if (friendsCount >= 5 || hasActiveSession) return 100;
  if (friendsCount >= 3) return 70;
  if (friendsCount >= 2) return 50;
  if (friendsCount >= 1) return 30;
  return 0;
}

function scoreMonetization(tier: string, trialActive: boolean): number {
  if (tier === "mingla_plus") return 100;
  if (trialActive) return 50;
  return 0;
}

function computeEngagementScore(
  daysSinceActive: number,
  sessions14d: number,
  saves14d: number,
  friendsCount: number,
  hasActiveSession: boolean,
  tier: string,
  trialActive: boolean,
): number {
  const score =
    scoreRecency(daysSinceActive) * WEIGHT_RECENCY +
    scoreFrequency(sessions14d) * WEIGHT_FREQUENCY +
    scoreDepth(saves14d) * WEIGHT_DEPTH +
    scoreSocial(friendsCount, hasActiveSession) * WEIGHT_SOCIAL +
    scoreMonetization(tier, trialActive) * WEIGHT_MONETIZATION;
  return Math.round(Math.min(100, Math.max(0, score)));
}

function getSegment(score: number): string {
  if (score >= 80) return "power_user";
  if (score >= 60) return "active";
  if (score >= 40) return "casual";
  if (score >= 20) return "at_risk";
  return "dormant";
}

// ── Mixpanel batch push ─────────────────────────────────────────────────────

interface UserScore {
  userId: string;
  score: number;
  segment: string;
}

async function pushToMixpanel(batch: UserScore[]): Promise<{ success: number; failed: number }> {
  const payload = batch.map((u) => ({
    $token: MIXPANEL_TOKEN,
    $distinct_id: u.userId,
    $set: {
      engagement_score: u.score,
      engagement_segment: u.segment,
      engagement_scored_at: new Date().toISOString(),
    },
  }));

  try {
    const res = await fetch(MIXPANEL_ENGAGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/plain" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.warn(`[engagement] Mixpanel HTTP ${res.status}: ${await res.text()}`);
      return { success: 0, failed: batch.length };
    }
    return { success: batch.length, failed: 0 };
  } catch (err) {
    console.warn("[engagement] Mixpanel push failed:", err);
    return { success: 0, failed: batch.length };
  }
}

// ── Main handler ────────────────────────────────────────────────────────────

serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Fetch all users who have completed onboarding
    const { data: users, error: usersError } = await supabase
      .from("profiles")
      .select("id, updated_at")
      .eq("has_completed_onboarding", true);

    if (usersError) {
      console.error("[engagement] Failed to fetch profiles:", usersError.message);
      return new Response(JSON.stringify({ error: usersError.message }), { status: 500 });
    }

    if (!users || users.length === 0) {
      return new Response(JSON.stringify({ message: "No users to score", scored: 0 }), { status: 200 });
    }

    const now = new Date();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const userIds = users.map((u: { id: string }) => u.id);

    // Batch queries for activity data
    const [sessionsRes, savesRes, friendsRes, subsRes, participantsRes] = await Promise.all([
      // Sessions in last 14 days per user
      supabase
        .from("user_sessions")
        .select("user_id")
        .in("user_id", userIds)
        .gte("started_at", fourteenDaysAgo),

      // Saves in last 14 days per user
      supabase
        .from("saved_card")
        .select("profile_id")
        .in("profile_id", userIds)
        .gte("created_at", fourteenDaysAgo),

      // Friends (accepted) per user
      supabase
        .from("friends")
        .select("user_id")
        .in("user_id", userIds)
        .eq("status", "accepted"),

      // Subscriptions per user
      supabase
        .from("subscriptions")
        .select("user_id, tier, is_active, trial_ends_at")
        .in("user_id", userIds),

      // Active session participants
      supabase
        .from("session_participants")
        .select("user_id")
        .in("user_id", userIds),
    ]);

    // Build lookup maps
    const sessionCounts = new Map<string, number>();
    for (const row of sessionsRes.data ?? []) {
      sessionCounts.set(row.user_id, (sessionCounts.get(row.user_id) ?? 0) + 1);
    }

    const saveCounts = new Map<string, number>();
    for (const row of savesRes.data ?? []) {
      saveCounts.set(row.profile_id, (saveCounts.get(row.profile_id) ?? 0) + 1);
    }

    const friendCounts = new Map<string, number>();
    for (const row of friendsRes.data ?? []) {
      friendCounts.set(row.user_id, (friendCounts.get(row.user_id) ?? 0) + 1);
    }

    const subMap = new Map<string, { tier: string; trialActive: boolean }>();
    for (const row of subsRes.data ?? []) {
      const trialActive = row.trial_ends_at ? new Date(row.trial_ends_at) > now : false;
      subMap.set(row.user_id, { tier: row.tier ?? "free", trialActive });
    }

    const activeSessionUsers = new Set<string>();
    for (const row of participantsRes.data ?? []) {
      activeSessionUsers.add(row.user_id);
    }

    // Compute scores
    const scores: UserScore[] = [];
    for (const user of users) {
      const daysSinceActive = Math.max(
        0,
        Math.floor((now.getTime() - new Date(user.updated_at).getTime()) / (1000 * 60 * 60 * 24)),
      );
      const sessions14d = sessionCounts.get(user.id) ?? 0;
      const saves14d = saveCounts.get(user.id) ?? 0;
      const friends = friendCounts.get(user.id) ?? 0;
      const hasActiveSession = activeSessionUsers.has(user.id);
      const sub = subMap.get(user.id) ?? { tier: "free", trialActive: false };

      const score = computeEngagementScore(
        daysSinceActive,
        sessions14d,
        saves14d,
        friends,
        hasActiveSession,
        sub.tier,
        sub.trialActive,
      );

      scores.push({ userId: user.id, score, segment: getSegment(score) });
    }

    // Push to Mixpanel in batches
    let totalSuccess = 0;
    let totalFailed = 0;
    for (let i = 0; i < scores.length; i += BATCH_SIZE) {
      const batch = scores.slice(i, i + BATCH_SIZE);
      const { success, failed } = await pushToMixpanel(batch);
      totalSuccess += success;
      totalFailed += failed;
    }

    const summary = {
      scored: scores.length,
      mixpanel_success: totalSuccess,
      mixpanel_failed: totalFailed,
      segments: {
        power_user: scores.filter((s) => s.segment === "power_user").length,
        active: scores.filter((s) => s.segment === "active").length,
        casual: scores.filter((s) => s.segment === "casual").length,
        at_risk: scores.filter((s) => s.segment === "at_risk").length,
        dormant: scores.filter((s) => s.segment === "dormant").length,
      },
    };

    console.log("[engagement] Scoring complete:", JSON.stringify(summary));
    return new Response(JSON.stringify(summary), { status: 200 });
  } catch (err) {
    console.error("[engagement] Unhandled error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});

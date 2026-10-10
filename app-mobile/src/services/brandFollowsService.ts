// Issue #679 / #3682 — brand_follows direct-RLS writes + manage-follows mute/channels.
//
// The solo `saved_card` pattern is the bound precedent: single-row,
// single-owner writes go straight through owner-scoped RLS — no RPC (the
// RPC/trigger precedents exist for multi-row atomicity/quorum problems Follow
// does not have). All errors throw; no silent catches.
// #3682 Follow contract: upsert with ignoreDuplicates so re-follow of an
// existing row is a clean no-op (E4 / ignoreDuplicates: true).
import { supabase } from "./supabase";

export type BrandFollowChannel = "push" | "email" | "sms";

export type MuteDuration = "week" | "month" | "indefinite";

export type BrandFollowRow = {
  brandId: string;
  brandName: string;
  brandSlug: string | null;
  logoUrl: string | null;
  source: string;
  createdAt: string;
  mutedUntil: string | null;
  channels: Record<BrandFollowChannel, boolean>;
};

function isMuted(mutedUntil: string | null | undefined, now = Date.now()): boolean {
  if (mutedUntil == null || mutedUntil.length === 0) return false;
  const t = Date.parse(mutedUntil);
  if (Number.isNaN(t)) {
    // Postgres infinity serializes in some clients as special strings.
    return mutedUntil === "infinity" || mutedUntil.includes("infinity");
  }
  return t > now;
}

export function brandFollowIsMuted(
  mutedUntil: string | null | undefined,
  now = Date.now(),
): boolean {
  return isMuted(mutedUntil, now);
}

function muteUntilIso(duration: MuteDuration, now = new Date()): string {
  if (duration === "indefinite") {
    // Postgres accepts 'infinity'; PostgREST forwards the literal.
    return "infinity";
  }
  const ms = duration === "week" ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
  return new Date(now.getTime() + ms).toISOString();
}

const DEFAULT_CHANNELS: Record<BrandFollowChannel, boolean> = {
  push: true,
  email: true,
  sms: true,
};

export const brandFollowsService = {
  async followBrand(userId: string, brandId: string): Promise<void> {
    const { error } = await supabase.from("brand_follows").upsert(
      { user_id: userId, brand_id: brandId, source: "brand_page" },
      { onConflict: "user_id,brand_id", ignoreDuplicates: true },
    );
    if (error) throw error;
  },

  async unfollowBrand(userId: string, brandId: string): Promise<void> {
    // Hard delete (spec §3). Zero rows deleted is success — already unfollowed.
    const { error } = await supabase
      .from("brand_follows")
      .delete()
      .eq("user_id", userId)
      .eq("brand_id", brandId);
    if (error) throw error;
  },

  async isFollowing(userId: string, brandId: string): Promise<boolean> {
    const { data, error } = await supabase
      .from("brand_follows")
      .select("brand_id")
      .eq("user_id", userId)
      .eq("brand_id", brandId)
      .maybeSingle();
    if (error) throw error;
    return data !== null;
  },

  async getFollowStatus(
    userId: string,
    brandId: string,
  ): Promise<{ following: boolean; mutedUntil: string | null }> {
    const { data, error } = await supabase
      .from("brand_follows")
      .select("brand_id, muted_until")
      .eq("user_id", userId)
      .eq("brand_id", brandId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { following: false, mutedUntil: null };
    return {
      following: true,
      mutedUntil: (data.muted_until as string | null) ?? null,
    };
  },

  async muteBrand(
    userId: string,
    brandId: string,
    duration: MuteDuration,
  ): Promise<string> {
    const until = muteUntilIso(duration);
    const { error } = await supabase
      .from("brand_follows")
      .update({ muted_until: until })
      .eq("user_id", userId)
      .eq("brand_id", brandId);
    if (error) throw error;
    return until;
  },

  async unmuteBrand(userId: string, brandId: string): Promise<void> {
    const { error } = await supabase
      .from("brand_follows")
      .update({ muted_until: null })
      .eq("user_id", userId)
      .eq("brand_id", brandId);
    if (error) throw error;
  },

  async setChannel(
    userId: string,
    brandId: string,
    channel: BrandFollowChannel,
    enabled: boolean,
  ): Promise<void> {
    const { error } = await supabase.from("brand_follow_channel_prefs").upsert(
      {
        user_id: userId,
        brand_id: brandId,
        channel,
        enabled,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,brand_id,channel" },
    );
    if (error) throw error;
  },

  async listFollows(userId: string): Promise<BrandFollowRow[]> {
    const { data: follows, error } = await supabase
      .from("brand_follows")
      .select("brand_id, source, created_at, muted_until")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw error;

    const brandIds = (follows ?? []).map((r) => r.brand_id as string);
    const brandMeta = new Map<
      string,
      { name: string; slug: string | null; photo: string | null }
    >();
    const channelMap = new Map<string, Record<BrandFollowChannel, boolean>>();
    if (brandIds.length > 0) {
      // Public brand profile view — same surface as ConsumerBrandProfileScreen.
      const { data: brands, error: brandErr } = await supabase
        .from("business_public_brands_view")
        .select("id, name, slug, profile_photo_url")
        .in("id", brandIds);
      if (brandErr) throw brandErr;
      for (const b of brands ?? []) {
        brandMeta.set(b.id as string, {
          name: (b.name as string) ?? "Brand",
          slug: (b.slug as string | null) ?? null,
          photo: (b.profile_photo_url as string | null) ?? null,
        });
      }

      const { data: prefs, error: prefErr } = await supabase
        .from("brand_follow_channel_prefs")
        .select("brand_id, channel, enabled")
        .eq("user_id", userId)
        .in("brand_id", brandIds);
      if (prefErr) throw prefErr;
      for (const p of prefs ?? []) {
        const bid = p.brand_id as string;
        const ch = p.channel as BrandFollowChannel;
        const base = channelMap.get(bid) ?? { ...DEFAULT_CHANNELS };
        base[ch] = p.enabled === true;
        channelMap.set(bid, base);
      }
    }

    return (follows ?? []).map((row) => {
      const bid = row.brand_id as string;
      const meta = brandMeta.get(bid);
      return {
        brandId: bid,
        brandName: meta?.name ?? "Brand",
        brandSlug: meta?.slug ?? null,
        logoUrl: meta?.photo ?? null,
        source: (row.source as string) ?? "brand_page",
        createdAt: row.created_at as string,
        mutedUntil: (row.muted_until as string | null) ?? null,
        channels: channelMap.get(bid) ?? { ...DEFAULT_CHANNELS },
      };
    });
  },
};

/**
 * META-ORCH-1161 Sub-A (slice "a") — notification-preferences matrix service.
 *
 * Reads the LIVE notification_categories seed + the signed-in user's
 * notification_channel_prefs, and upserts a single per-(category,channel) toggle.
 *
 * Contract: services THROW on error (never return null/[] on failure) so the
 * hook's onError + UI revert + toast fire. RLS on notification_channel_prefs is
 * owner-only (user_id = auth.uid()), so the upsert is safe from the client.
 */
import { supabase } from './supabase';
import type {
  ChannelPrefRow,
  ChannelPrefUpsert,
  NotificationCategoryRow,
  NotificationChannel,
} from '../components/profile/notificationPrefsMatrix';

export interface NotificationMatrixData {
  categories: NotificationCategoryRow[];
  prefs: ChannelPrefRow[];
}

/**
 * Fetch the active category seed + the user's channel-pref overrides.
 * Categories are global (readable by all) — channel prefs are user-scoped.
 */
export async function fetchNotificationMatrix(
  userId: string,
): Promise<NotificationMatrixData> {
  const [catRes, prefRes] = await Promise.all([
    supabase
      .from('notification_categories')
      .select('key, section, is_transactional, urgency, default_channels, active')
      .eq('active', true),
    supabase
      .from('notification_channel_prefs')
      .select('category_key, channel, enabled')
      .eq('user_id', userId),
  ]);

  if (catRes.error) {
    throw new Error(
      `Failed to load notification categories: ${catRes.error.message}`,
    );
  }
  if (prefRes.error) {
    throw new Error(
      `Failed to load notification preferences: ${prefRes.error.message}`,
    );
  }

  const categories = (catRes.data ?? []).map((c) => ({
    key: c.key as string,
    section: c.section as string,
    is_transactional: !!c.is_transactional,
    urgency: c.urgency as string,
    default_channels: (c.default_channels ?? []) as NotificationChannel[],
    active: !!c.active,
  }));

  const prefs = (prefRes.data ?? []).map((p) => ({
    category_key: p.category_key as string,
    channel: p.channel as NotificationChannel,
    enabled: !!p.enabled,
  }));

  return { categories, prefs };
}

/**
 * Upsert one (user_id, category_key, channel) → enabled row.
 * PK conflict on (user_id, category_key, channel) updates `enabled` + updated_at.
 */
export async function upsertChannelPref(
  payload: ChannelPrefUpsert,
): Promise<void> {
  const { error } = await supabase.from('notification_channel_prefs').upsert(
    {
      user_id: payload.user_id,
      category_key: payload.category_key,
      channel: payload.channel,
      enabled: payload.enabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,category_key,channel' },
  );

  if (error) {
    throw new Error(
      `Failed to save notification preference (${payload.category_key}/${payload.channel}): ${error.message}`,
    );
  }
}

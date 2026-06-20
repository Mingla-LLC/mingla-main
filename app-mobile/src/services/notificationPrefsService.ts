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
  MarketingSuppressionRow,
  NotificationCategoryRow,
  NotificationChannel,
} from '../components/profile/notificationPrefsMatrix';

export interface NotificationMatrixData {
  categories: NotificationCategoryRow[];
  prefs: ChannelPrefRow[];
  // META-ORCH-1161 go-live-prep — the user's marketing channel_suppressions
  // (email|sms). The single source of truth for marketing opt-out; absence = the
  // DEC-191 default-ON.
  suppressions: MarketingSuppressionRow[];
}

/**
 * Fetch the active category seed + the user's channel-pref overrides.
 * Categories are global (readable by all) — channel prefs are user-scoped.
 */
export async function fetchNotificationMatrix(
  userId: string,
): Promise<NotificationMatrixData> {
  const [catRes, prefRes, suppRes] = await Promise.all([
    supabase
      .from('notification_categories')
      .select('key, section, is_transactional, urgency, default_channels, active')
      .eq('active', true),
    supabase
      .from('notification_channel_prefs')
      .select('category_key, channel, enabled')
      .eq('user_id', userId),
    // META-ORCH-1161 go-live-prep — the user's OWN marketing suppressions
    // (RLS: channel_suppressions read-own). A row in scope marketing|all for
    // email/sms means opted out of marketing on that channel → chip OFF.
    supabase
      .from('channel_suppressions')
      .select('channel, scope')
      .eq('user_id', userId)
      .in('scope', ['marketing', 'all'])
      .in('channel', ['email', 'sms']),
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
  if (suppRes.error) {
    throw new Error(
      `Failed to load marketing suppressions: ${suppRes.error.message}`,
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

  const suppressions: MarketingSuppressionRow[] = (suppRes.data ?? [])
    .map((s) => ({ channel: s.channel as 'email' | 'sms' }))
    .filter((s) => s.channel === 'email' || s.channel === 'sms');

  return { categories, prefs, suppressions };
}

/**
 * META-ORCH-1161 go-live-prep — opt OUT of (suppress=true) or back IN to
 * (suppress=false) marketing on a channel via the SECURITY DEFINER RPC. This is
 * the ONLY authenticated write path to channel_suppressions (the single source of
 * truth honored by can_send AND marketingAudience). Throws on error so the hook's
 * onError + optimistic rollback + toast fire (no silent failure).
 */
export async function setMarketingSuppression(args: {
  channel: 'email' | 'sms';
  suppress: boolean;
}): Promise<void> {
  const { error } = await supabase.rpc('set_marketing_suppression', {
    p_channel: args.channel,
    p_suppress: args.suppress,
  });
  if (error) {
    throw new Error(
      `Failed to update marketing preference (${args.channel}): ${error.message}`,
    );
  }
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

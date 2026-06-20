/**
 * META-ORCH-1161 Sub-A (slice "a") — consumer notification-preferences matrix
 * DECISION CORE (pure, dependency-free).
 *
 * This module holds ALL the matrix logic with ZERO React / RN / Supabase imports
 * so it can be unit-tested under Node's built-in test runner (this app has no
 * jest — see src/hooks/__tests__/useLaunchCityGate.test.ts for the precedent).
 *
 * Source of truth = the LIVE `notification_categories` seed (read at runtime).
 * NOTHING about the category list / channel set / sections is hardcoded here:
 * the matrix is built from whatever rows the DB returns (DESIGN §8 "no hardcoded
 * channel lists in the component — read from notification_categories").
 *
 * Semantics (SPEC §5.1 / §5.3 / DESIGN §S1.3):
 *  - A category supports exactly the channels in its `default_channels` → only
 *    those render as chips. SMS column therefore appears ONLY for categories
 *    whose default_channels contains 'sms' (the closed eligible set, DC-3 /
 *    I-PROPOSED-1161-SMS-ONLY-FOR-POLICY-ELIGIBLE-CATEGORIES).
 *  - Effective ON/OFF for (category, channel) = coalesce(pref.enabled, default):
 *      transactional category → default ON; marketing category → default OFF.
 *  - Locked-on (legal / system-of-record) chips, NOT user-toggleable:
 *      • 'inapp' is locked-on for EVERY category (free durable inbox).
 *      • 'email' is locked-on for is_transactional categories that include email
 *        (legal receipt / CAN-SPAM transactional channel).
 *    Marketing categories lock nothing (full opt-out).
 *  - Writing an OFF toggle inserts/updates a notification_channel_prefs row
 *    enabled=false; ON → enabled=true (PK user_id,category_key,channel).
 */

export type NotificationChannel = 'inapp' | 'push' | 'email' | 'sms';

export const ALL_CHANNELS: readonly NotificationChannel[] = [
  'inapp',
  'push',
  'email',
  'sms',
] as const;

/** A category row exactly as seeded in notification_categories. */
export interface NotificationCategoryRow {
  key: string;
  section: string;
  is_transactional: boolean;
  urgency: string;
  default_channels: NotificationChannel[];
  active: boolean;
}

/** A user's per-(category,channel) override row. Absent → use category default. */
export interface ChannelPrefRow {
  category_key: string;
  channel: NotificationChannel;
  enabled: boolean;
}

/**
 * META-ORCH-1161 go-live-prep — a marketing suppression the user holds, keyed by
 * channel (email|sms). Its PRESENCE means the user has opted OUT of marketing on
 * that channel (scope ∈ {marketing,'all'}). This is the SINGLE source of truth
 * for marketing email/sms opt-out (channel_suppressions), read into the matrix so
 * a suppressed marketing chip renders OFF regardless of any prefs row.
 */
export interface MarketingSuppressionRow {
  channel: 'email' | 'sms';
}

/** One channel cell within a category row. */
export interface ChannelCellState {
  channel: NotificationChannel;
  /** Effective ON/OFF the user sees right now. */
  enabled: boolean;
  /** Locked = legally/structurally always-on; chip non-interactive. */
  locked: boolean;
}

/** One category row in the rendered matrix. */
export interface MatrixCategoryRow {
  key: string;
  section: string;
  isTransactional: boolean;
  /** Channel cells in canonical order (inapp, push, email, sms), only the supported ones. */
  channels: ChannelCellState[];
  /** True if any channel in this row is locked (drives the "Always on" affordance). */
  hasLockedChannel: boolean;
}

/** A labelled section group containing its category rows, in seed-driven order. */
export interface MatrixSection {
  section: string;
  rows: MatrixCategoryRow[];
}

/**
 * Fixed consumer (Explorer) section order. This list is ALSO the consumer
 * AUDIENCE ALLOWLIST: a category renders in the consumer prefs matrix ONLY when
 * its `section` is one of these. Brand/seller-targeted categories live in
 * business-only sections (today `Payouts` for `payout_paid`; the spec's `Sales`
 * + `Payouts` for every `biz_*` alert) and therefore NEVER surface here. This is
 * the SINGLE OWNER of "what is a consumer category" — see `isConsumerCategory`.
 *
 * Consequence: a NEW consumer-facing section requires a deliberate one-line edit
 * to this list (intentional — it guarantees no business category can ever leak
 * into the consumer matrix via a future seed row).
 */
export const CONSUMER_SECTION_ORDER: readonly string[] = [
  'Purchases',
  'Reservations',
  'Reminders',
  'Marketing',
  'Social',
] as const;

/**
 * Audience predicate — TRUE iff this category belongs in the CONSUMER app's
 * notification-preferences matrix. Data-driven on the consumer-section allowlist
 * (not a per-key denylist), so seller/brand categories (`payout_paid` and every
 * `biz_*` alert in `Sales`/`Payouts`) are excluded automatically, and any future
 * brand-only section is excluded with zero further code changes.
 *
 * META-ORCH-1161 slice "a" REWORK (P2): the matrix previously rendered EVERY
 * active `notification_categories` row, leaking the seller-only `payout_paid`
 * (and any seeded brand alert) into the consumer settings screen. This predicate
 * is the fix and its single chokepoint.
 */
export function isConsumerCategory(cat: NotificationCategoryRow): boolean {
  return (CONSUMER_SECTION_ORDER as readonly string[]).includes(cat.section);
}

/**
 * Is a (category, channel) cell locked-on (not user-toggleable)?
 *  - inapp: always locked-on (the free durable inbox / system-of-record).
 *  - email on a transactional category: locked-on (legal receipt channel).
 *  - everything else (push always; sms always; ALL marketing channels): toggleable.
 */
export function isChannelLocked(
  channel: NotificationChannel,
  isTransactional: boolean,
): boolean {
  if (channel === 'inapp') return true;
  if (channel === 'email' && isTransactional) return true;
  return false;
}

/**
 * Default ON/OFF for a (category, channel) when the user has NO pref row.
 *
 * META-ORCH-1161 go-live-prep (DEC-191 / Decision A): marketing is now
 * ENROLLED-BY-DEFAULT (opt-out), so EVERY category — transactional AND marketing —
 * defaults ON when the user has expressed no choice. This mirrors the DEC-191
 * can_send() flip (marketing is default-ON unless an explicit enabled=false pref
 * or a channel_suppressions row exists). The chips reflect the auto-enroll grant
 * (DEC-186) instead of contradicting it. Locked channels are always ON regardless.
 *
 * For marketing email/sms the user's OFF choice is carried by channel_suppressions
 * (written via set_marketing_suppression), NOT a notification_channel_prefs row —
 * see `isMarketingSuppressibleChannel` / `marketingSuppressionChannelsFromState`.
 */
export function defaultChannelEnabled(
  channel: NotificationChannel,
  isTransactional: boolean,
): boolean {
  if (isChannelLocked(channel, isTransactional)) return true;
  return true; // DEC-191 — default-ON for both transactional and marketing.
}

/**
 * META-ORCH-1161 go-live-prep — is this (category, channel) toggle one whose
 * opt-out is canonically carried by channel_suppressions rather than a
 * notification_channel_prefs row? TRUE iff the category is MARKETING and the
 * channel is email or sms (the only suppressible channels — inapp/push are not in
 * channel_suppressions). For these, an OFF toggle calls set_marketing_suppression
 * (the single source of truth honored by can_send AND marketingAudience); an ON
 * toggle removes the suppression. All OTHER toggles (every transactional channel;
 * marketing push) keep the notification_channel_prefs path.
 */
export function isMarketingSuppressibleChannel(
  channel: NotificationChannel,
  isTransactional: boolean,
): boolean {
  return !isTransactional && (channel === 'email' || channel === 'sms');
}

/** Canonical channel ordering for chip layout (a11y reading order). */
function channelSortIndex(c: NotificationChannel): number {
  const i = ALL_CHANNELS.indexOf(c);
  return i === -1 ? ALL_CHANNELS.length : i;
}

/** Stable section ordering: known consumer order first, then unknown sections A→Z. */
function sectionSortIndex(section: string): number {
  const i = CONSUMER_SECTION_ORDER.indexOf(section);
  return i === -1 ? CONSUMER_SECTION_ORDER.length : i;
}

/**
 * Build the full rendered matrix from the live seed + the user's pref rows.
 *
 * @param categories    active notification_categories rows (any inactive are dropped here too)
 * @param prefs         the user's notification_channel_prefs rows
 * @param suppressions  the user's marketing channel_suppressions (email|sms). PRESENCE
 *                      of a channel = opted out of marketing on it → every marketing
 *                      cell for that channel renders OFF (single source of truth,
 *                      DEC-191). Defaults empty for back-compat with existing callers.
 * @returns sections (in consumer order) each with category rows (seed order within section)
 */
export function buildNotificationMatrix(
  categories: NotificationCategoryRow[],
  prefs: ChannelPrefRow[],
  suppressions: MarketingSuppressionRow[] = [],
): MatrixSection[] {
  // Index prefs by (category_key, channel) for O(1) coalesce.
  const prefIndex = new Map<string, boolean>();
  for (const p of prefs) {
    prefIndex.set(`${p.category_key}::${p.channel}`, p.enabled);
  }

  // META-ORCH-1161 go-live-prep — set of marketing channels the user has
  // suppressed. A suppressed marketing email/sms chip is OFF no matter what.
  const suppressedMarketing = new Set<string>();
  for (const s of suppressions) suppressedMarketing.add(s.channel);

  // Active AND consumer-audience only. The audience filter (isConsumerCategory)
  // is what keeps seller-only categories (payout_paid + every biz_* alert) OUT
  // of the consumer matrix — ORCH-1161 slice "a" REWORK (P2).
  const activeCats = categories.filter((c) => c.active && isConsumerCategory(c));

  const rows: MatrixCategoryRow[] = activeCats.map((cat) => {
    // Only the channels the category actually supports render as chips.
    const supported = [...cat.default_channels]
      .filter((c): c is NotificationChannel =>
        (ALL_CHANNELS as readonly string[]).includes(c),
      )
      .sort((a, b) => channelSortIndex(a) - channelSortIndex(b));

    const channels: ChannelCellState[] = supported.map((channel) => {
      const locked = isChannelLocked(channel, cat.is_transactional);
      // META-ORCH-1161 go-live-prep — for a MARKETING email/sms cell the opt-out
      // lives in channel_suppressions (single source of truth), NOT a prefs row.
      // A suppression → OFF; absence → the DEC-191 default-ON. The prefs row is
      // ignored for these cells so the two authorities can never disagree.
      if (isMarketingSuppressibleChannel(channel, cat.is_transactional)) {
        const enabled = !suppressedMarketing.has(channel);
        return { channel, enabled, locked: false };
      }
      const override = prefIndex.get(`${cat.key}::${channel}`);
      const enabled = locked
        ? true
        : override ?? defaultChannelEnabled(channel, cat.is_transactional);
      return { channel, enabled, locked };
    });

    return {
      key: cat.key,
      section: cat.section,
      isTransactional: cat.is_transactional,
      channels,
      hasLockedChannel: channels.some((c) => c.locked),
    };
  });

  // Group into sections preserving seed order within a section.
  const bySection = new Map<string, MatrixCategoryRow[]>();
  for (const r of rows) {
    const arr = bySection.get(r.section) ?? [];
    arr.push(r);
    bySection.set(r.section, arr);
  }

  return [...bySection.entries()]
    .map(([section, sectionRows]) => ({ section, rows: sectionRows }))
    .sort((a, b) => {
      const di = sectionSortIndex(a.section) - sectionSortIndex(b.section);
      if (di !== 0) return di;
      return a.section.localeCompare(b.section);
    });
}

/**
 * The exact upsert payload for a single (category, channel) toggle.
 * PK is (user_id, category_key, channel); `enabled` carries true/false.
 * Returns null when the cell is locked (a locked chip must NEVER write a row).
 */
export interface ChannelPrefUpsert {
  user_id: string;
  category_key: string;
  channel: NotificationChannel;
  enabled: boolean;
}

export function buildChannelPrefUpsert(args: {
  userId: string;
  categoryKey: string;
  channel: NotificationChannel;
  nextEnabled: boolean;
  locked: boolean;
}): ChannelPrefUpsert | null {
  if (args.locked) return null;
  return {
    user_id: args.userId,
    category_key: args.categoryKey,
    channel: args.channel,
    enabled: args.nextEnabled,
  };
}

/** Does this category's policy include SMS? (drives whether an SMS chip exists at all) */
export function categorySupportsSms(cat: NotificationCategoryRow): boolean {
  return cat.default_channels.includes('sms');
}

/**
 * META-ORCH-1161 go-live-prep — the WRITE ACTION a single toggle resolves to.
 * A discriminated union so the hook/service performs exactly one write:
 *  - 'noop'                : a locked chip — never writes (defence-in-depth).
 *  - 'channel_pref_upsert' : the legacy notification_channel_prefs path (every
 *                            transactional channel + marketing push/inapp).
 *  - 'marketing_suppression': call set_marketing_suppression(channel, suppress)
 *                            (marketing email/sms — the single opt-out authority).
 */
export type ToggleAction =
  | { kind: 'noop' }
  | { kind: 'channel_pref_upsert'; upsert: ChannelPrefUpsert }
  | {
      kind: 'marketing_suppression';
      channel: 'email' | 'sms';
      /** true → opt OUT (write suppression); false → opt back IN (remove it). */
      suppress: boolean;
    };

/**
 * Decide the single write a toggle performs. Marketing email/sms routes to the
 * suppression RPC (suppress = the chip is going OFF); everything else uses the
 * prefs upsert; a locked chip is a no-op. This is the SINGLE chokepoint that
 * guarantees a marketing opt-out lands in channel_suppressions (the one authority
 * read by both can_send and marketingAudience) and never depends on a prefs row.
 */
export function resolveToggleAction(args: {
  userId: string;
  categoryKey: string;
  channel: NotificationChannel;
  isTransactional: boolean;
  nextEnabled: boolean;
  locked: boolean;
}): ToggleAction {
  if (args.locked) return { kind: 'noop' };
  if (isMarketingSuppressibleChannel(args.channel, args.isTransactional)) {
    return {
      kind: 'marketing_suppression',
      channel: args.channel as 'email' | 'sms',
      suppress: !args.nextEnabled, // chip OFF → suppress; chip ON → un-suppress.
    };
  }
  return {
    kind: 'channel_pref_upsert',
    upsert: {
      user_id: args.userId,
      category_key: args.categoryKey,
      channel: args.channel,
      enabled: args.nextEnabled,
    },
  };
}

/**
 * ORCH-0685 §7.4: typed converter from CardPayload (chat-share snapshot)
 * to ExpandedCardData (the modal's expected input).
 *
 * Replaces the unsafe `useState<any>` typing (and the latent `as unknown as`
 * cast it permitted) at MessageInterface.tsx:187 + :943 — Constitution #12 fix.
 *
 * ── #1669 [expanded-card-one-producer] ──
 * This is now a NORMALISER, not a second producer. It resolves everything that
 * is specific to a chat-share snapshot — the ORCH-0908 legacy `.card_data`
 * nesting, the snake_case lock-in keys, and the deliberate suppression of the
 * SENDER's distance/travel-time — and then hands a plain pool-card record to
 * the ONE canonical producer, `savedCardToExpandedCardData`.
 *
 * That is what restores the price pill in chat: the canonical mapper spreads
 * `canonicalDiscoveryPriceFields`, and this adapter never did. It also means a
 * field added to the mapper tomorrow reaches chat for free, instead of chat
 * silently keeping an older field list.
 *
 * Chat-specific decisions preserved verbatim:
 *   - distance, travelTime: null (Constitution #9 — never fabricate from the
 *     sender; these are recipient-relative, per the ORCH-0659/0660 lesson).
 *     The modal recomputes viewer-relative travel at open time.
 *   - fullDescription falls back to description (CardPayload carries only one).
 *   - socialStats.shares is forced to 0 (the payload does not carry it).
 *   - lock-in metadata (ORCH-0908) and curated stops (ORCH-0910) pass through.
 */
import type { LegacyCardPayload } from './messagingService';
import type { ExpandedCardData } from '../types/expandedCardTypes';
import { savedCardToExpandedCardData } from '../components/utils/savedCardToExpandedCardData';

export function cardPayloadToExpandedCardData(p: LegacyCardPayload): ExpandedCardData {
  // ORCH-0908: defensive legacy-payload normalizer. The first cut of the
  // combined lock-and-schedule RPC nested the card under card_payload.card_data;
  // migration 20260630000000 flattens it + backfills existing rows, but if any
  // nested row slips through we still render correctly by reading from
  // .card_data as a fallback. Also normalizes the snake_case lock-in keys
  // (scheduled_at, locker_user_id, etc.) to camelCase.
  const raw = p as any;
  const legacy = raw.card_data && typeof raw.card_data === 'object' ? raw.card_data : {};
  const scheduledAt = raw.scheduledAt ?? raw.scheduled_at ?? undefined;
  const socialStats = raw.socialStats ?? legacy.socialStats;

  const record: Record<string, unknown> = {
    // Flatten legacy-nested first so top-level keys win.
    ...legacy,
    ...raw,
    card_data: undefined,
    id: (raw.id ?? legacy.id) ?? '',
    title: (raw.title ?? legacy.title) ?? 'Saved experience',
    // Left empty on purpose when the payload has none: ExpandedCardModal
    // resolves `card.categoryIcon || getCategoryIcon(card.category)`, which is
    // strictly more informative than any placeholder we could stamp here.
    categoryIcon: (raw.categoryIcon ?? legacy.categoryIcon) ?? '',
    // The SENDER's distance and travel time are meaningless to the recipient.
    // Undefined here → `null` out of the mapper → the modal hides the pills and
    // recomputes from the viewer's own GPS.
    distance: undefined,
    travelTime: undefined,
    travelMode: undefined,
    socialStats: socialStats
      ? { views: 0, likes: 0, saves: 0, ...socialStats, shares: 0 }
      : { views: 0, likes: 0, saves: 0, shares: 0 },
    // ORCH-0908 lock-in metadata, camelCased.
    lockInEvent: raw.lockInEvent
      ?? (raw.event === 'card_locked_and_scheduled' ? 'card_locked_and_scheduled' : undefined),
    scheduledAt,
    durationMinutes: raw.durationMinutes ?? raw.duration_minutes,
    lockerUserId: raw.lockerUserId ?? raw.locker_user_id,
    savedCardId: raw.savedCardId ?? raw.saved_card_id,
    sessionId: raw.sessionId ?? raw.session_id,
    // ORCH-0910: only ever the literal discriminator the modal reads.
    cardType: (raw.cardType ?? legacy.cardType) === 'curated' ? 'curated' : undefined,
    selectedDateTime: p.selectedDateTime
      ? new Date(p.selectedDateTime)
      : scheduledAt
        ? new Date(scheduledAt)
        : undefined,
  };

  // A CardPayload always has at least an id, so the mapper never returns null
  // here; the fallback is for the compiler, not a reachable state.
  return (
    savedCardToExpandedCardData(record) ?? ({
      ...record,
      distance: null,
    } as unknown as ExpandedCardData)
  );
}

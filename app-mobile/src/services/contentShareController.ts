import type { ShareEntityKind } from '@mingla/sharing';
import { curatedCompositionIdentity } from './contentShareIdentity';
import type { ContentShareIdentity, ShareMessageContext } from './contentShareAdapter';
import type { ExpandedCardData } from '../types/expandedCardTypes';

export type ContentShareProducerSurface =
  | 'explorer_expanded'
  | 'calendar_expanded'
  | 'saved_expanded'
  | 'session_expanded'
  | 'chat_expanded'
  | 'collab_locked_expanded'
  | 'collab_saved_expanded'
  | 'discover_expanded'
  | 'friend_profile_expanded'
  | 'direct';

export type OpenContentShareInput = {
  kind: ShareEntityKind;
  identity: ContentShareIdentity;
  messageContext?: ShareMessageContext;
  producerSurface?: ContentShareProducerSurface;
};

let handler: ((input: OpenContentShareInput) => void) | null = null;

export function registerContentShareHandler(next: ((input: OpenContentShareInput) => void) | null): void {
  handler = next;
}

export function openUnifiedContentShare(input: OpenContentShareInput): void {
  if (!handler) throw new Error('unified_share_provider_unavailable');
  handler(input);
}

/**
 * Canonical expanded-card adapter for the nine #1880 render sites.
 *
 * The exact card captured at press admission is passed here only after the
 * expanded RN modal has acknowledged native dismissal. Display facts never
 * become identity: curated cards use their ordered place composition (or their
 * persisted source record), and single-place cards use only stored identifiers.
 */
export function openExpandedCardContentShare(
  card: ExpandedCardData,
  producerSurface: Exclude<ContentShareProducerSurface, 'direct'>,
): void {
  const curated = curatedCompositionIdentity(card);
  if (card.cardType === 'curated' || curated !== null) {
    const identity: ContentShareIdentity = card.sourceRecordId
      ? { sourceScope: card.sourceScope, sourceRecordId: card.sourceRecordId }
      : curated ?? { stopPlaceIds: [] };
    if (!identity.sourceRecordId && (identity.stopPlaceIds?.length ?? 0) === 0) {
      throw new Error('expanded_share_identity_unavailable');
    }
    openUnifiedContentShare({
      kind: 'curated',
      identity,
      producerSurface,
      messageContext: card.shareMessageContext,
    });
    return;
  }

  const identity: ContentShareIdentity = {
    sourceScope: card.sourceScope,
    sourceRecordId: card.sourceRecordId,
    placePoolId: card.placePoolId,
    googlePlaceId: card.googlePlaceId,
    savedCardId: card.savedCardId,
  };
  if (!identity.sourceRecordId && !identity.placePoolId && !identity.googlePlaceId && !identity.savedCardId) {
    throw new Error('expanded_share_identity_unavailable');
  }
  openUnifiedContentShare({
    kind: 'place',
    identity,
    producerSurface,
    messageContext: card.shareMessageContext,
  });
}

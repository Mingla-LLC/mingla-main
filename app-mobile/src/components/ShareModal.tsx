import React, { useEffect, useRef } from 'react';
import type { ShareEntityKind } from '@mingla/sharing';
import { useUnifiedShare } from './share/UnifiedShareProvider';
import { curatedCompositionIdentity } from '../services/contentShareIdentity';
import type { ContentShareIdentity } from '../services/contentShareAdapter';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  experienceData: any;
  dateTimePreferences: any;
  userPreferences?: any;
  accountPreferences?: any;
}

/**
 * Compatibility bridge for Explorer/curated call sites that historically
 * mounted a separate provider-button modal. The one app-wide provider now owns
 * every share surface, so this component only translates the legacy card shape
 * into the canonical kind + identity and opens that provider synchronously.
 */
export default function ShareModal({
  isOpen, onClose, experienceData, dateTimePreferences,
}: ShareModalProps): null {
  const { openContentShare } = useUnifiedShare();
  const openedGeneration = useRef<string | null>(null);

  useEffect(() => {
    if (!isOpen || !experienceData) return;
    const curated = curatedCompositionIdentity(experienceData);
    const explicitKind = experienceData.entityType;
    const kind: ShareEntityKind =
      explicitKind === 'brand' || explicitKind === 'event' || explicitKind === 'rsvp_event' ||
      explicitKind === 'trip' || explicitKind === 'experience' || explicitKind === 'venue'
        ? explicitKind
        : curated !== null || experienceData.cardType === 'curated' || Array.isArray(experienceData.stops)
          ? 'curated'
          : 'place';
    const identity: ContentShareIdentity = kind === 'curated'
      ? (curated ?? { stopPlaceIds: [] })
      : kind === 'place'
        ? {
            placePoolId: experienceData.placePoolId ?? experienceData.place_pool_id,
            googlePlaceId: experienceData.placeId ?? experienceData.googlePlaceId ?? experienceData.google_place_id,
            savedCardId: experienceData.savedCardId ?? experienceData.saved_card_id,
          }
        : kind === 'venue'
          ? { brandSlug: experienceData.brandSlug, venueSlug: experienceData.venueSlug }
          : kind === 'brand'
            ? { brandSlug: experienceData.brandSlug }
            : {
                brandSlug: experienceData.brandSlug,
                eventSlug: experienceData.eventSlug ?? experienceData.tripSlug ?? experienceData.experienceSlug,
              };
    const generation = JSON.stringify([kind, identity, dateTimePreferences]);
    if (openedGeneration.current === generation) return;
    openedGeneration.current = generation;
    openContentShare({ kind, identity, messageContext: { planningPreference: dateTimePreferences } });
    onClose();
  }, [dateTimePreferences, experienceData, isOpen, onClose, openContentShare]);

  useEffect(() => { if (!isOpen) openedGeneration.current = null; }, [isOpen]);
  return null;
}

import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useWindowDimensions } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { MAX_FONT_SCALE } from '../../../../packages/card-identity/index.js';
import { photosToPreload, type DeckPhoto } from './deckCardModel';

/** A Date that moves once a minute, so "Closes in 30 min" stays true while you look. */
export function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * #4347 wave 3 follow-up — the person's text size for the deck's tap zones,
 * capped where the deck's text is capped (MAX_FONT_SCALE.title, the largest
 * cap; `tapZoneBottomY` applies the per-row title / meta caps itself). Below
 * 1.0x the column never shrinks under its 1.0x height. An unreadable value
 * falls back to the cap, so a zone can never reach into the words.
 */
export function capDeckTextScale(fontScale: number | null | undefined): number {
  if (typeof fontScale !== 'number' || !Number.isFinite(fontScale) || fontScale <= 0) return MAX_FONT_SCALE.title;
  return Math.max(1, Math.min(fontScale, MAX_FONT_SCALE.title));
}

/** The LIVE text size (it changes when the person changes it in Settings). */
export function useDeckTextScale(): number {
  return capDeckTextScale(useWindowDimensions().fontScale);
}

/**
 * The one-time "Tap the sides to see more photos" hint, stored per device.
 *
 * `visible` is true until the person flips a photo once (or the hint has been
 * shown on a card that then left the top of the deck). Storage failures are
 * logged and treated as "already seen": a hint that cannot remember it was
 * shown must not nag on every launch.
 */
export const PHOTO_HINT_STORAGE_KEY = 'mingla:deck:photoTapHintSeen:v1';

export function usePhotoTapHint(): { visible: boolean; markSeen: () => void } {
  const [state, setState] = useState<'loading' | 'unseen' | 'seen'>('loading');
  const writtenRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(PHOTO_HINT_STORAGE_KEY)
      .then((value) => {
        if (mounted) setState(value === '1' ? 'seen' : 'unseen');
      })
      .catch((error: unknown) => {
        console.warn('[usePhotoTapHint] read failed:', error instanceof Error ? error.message : error);
        if (mounted) setState('seen');
      });
    return () => {
      mounted = false;
    };
  }, []);

  const markSeen = useCallback(() => {
    setState('seen');
    if (writtenRef.current) return;
    writtenRef.current = true;
    AsyncStorage.setItem(PHOTO_HINT_STORAGE_KEY, '1').catch((error: unknown) => {
      console.warn('[usePhotoTapHint] write failed:', error instanceof Error ? error.message : error);
    });
  }, []);

  return { visible: state === 'unseen', markSeen };
}

/**
 * #4347 wave 1 — THE ONE explicit image load in the deck. It warms the next
 * `PHOTO_PAGER.preloadAhead` (2) stills of the TOP card's pager, with the same
 * disk-only cache policy as the posters, so a flip lands on a decoded photo.
 * The behind card is never passed here: it renders its photo 1 poster only.
 * Supersedes #1481's "zero explicit prefetch" rule for exactly this bound.
 */
export function useTopCardPhotoPreload(
  photos: readonly DeckPhoto[],
  index: number,
  failed: ReadonlySet<string>,
): void {
  const key = photosToPreload(photos, index).filter((uri) => !failed.has(uri)).join('|');
  useEffect(() => {
    if (key.length === 0) return;
    ExpoImage.prefetch(key.split('|'), 'disk').catch((error: unknown) => {
      console.warn('[deckCard] photo preload failed:', error instanceof Error ? error.message : error);
    });
  }, [key]);
}

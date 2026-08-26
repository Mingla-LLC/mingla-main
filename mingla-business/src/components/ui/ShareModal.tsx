import React, { Suspense } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Sheet } from './Sheet';
import type { ShareModalProps } from './ShareModalContent';

export type { ShareModalProps } from './ShareModalContent';

/**
 * #2589 — is this offering publicly resolvable, i.e. can a share be created for
 * it at all?
 *
 * WHY THIS EXISTS. The organiser screens offered Share unconditionally. Creating
 * a share for an offering the public cannot resolve returns 404, which reached
 * the sheet as *"Couldn't prepare this share"* beside a Retry that could never
 * succeed — the organiser had no way to learn that the actual answer was
 * "publish it first". Refusing the tap up front, with the reason, is the
 * honest treatment (Constitution #1: no dead taps).
 *
 * THE RULE IS THE SERVER'S, restated at the smallest possible surface. The share
 * edge admits `public`, `discover` and `hidden` — `hidden` being the stored form
 * of Unlisted, which IS shareable by exact link and is deliberately included.
 * `private` is not resolvable by anyone without an invitation, and a draft has no
 * public route at all. Keep this in sync with the visibility gate in
 * `supabase/functions/_shared/contentShare.ts`; it is asserted against that file
 * by `scripts/issue-2589/share-mount-and-copy.test.mjs`.
 *
 * Lives in this eager wrapper, not in the lazily split `ShareModalContent`, so a
 * screen can ask the question WITHOUT pulling the share chunk into its bundle.
 */
export type OfferingShareability = { shareable: true } | { shareable: false; reason: string };

export function offeringShareability(offering: {
  visibility?: string | null;
  publishedAt?: string | null;
  status?: string | null;
}): OfferingShareability {
  if (offering.status === 'draft') {
    return { shareable: false, reason: 'Publish this first, then you can share it.' };
  }
  if (typeof offering.publishedAt !== 'string' || offering.publishedAt.length === 0) {
    return { shareable: false, reason: 'Publish this first, then you can share it.' };
  }
  if (offering.visibility === 'private') {
    return { shareable: false, reason: 'Private offerings have no public link to share. Switch to Public or Unlisted first.' };
  }
  return { shareable: true };
}

// Keep the share implementation out of the eager Business web bundle. The
// lightweight sheet appears on the same tap; facts, poster, QR and transports
// load behind that already-visible boundary.
type ShareModalContentModule = typeof import('./ShareModalContent');

let shareModalContentPromise: Promise<ShareModalContentModule> | null = null;

function importShareModalContent(): Promise<ShareModalContentModule> {
  return import('./ShareModalContent');
}

function loadShareModalContent(): Promise<ShareModalContentModule> {
  shareModalContentPromise ??= importShareModalContent();
  return shareModalContentPromise;
}

const LazyShareModal = React.lazy(async () => {
  const module = await loadShareModalContent();
  return { default: module.ShareModal };
});

export const ShareModal: React.FC<ShareModalProps> = (props) => {
  React.useEffect(() => {
    if (!props.preloadContent) return;
    // Keep the implementation in its split chunk, but fetch it while the
    // management surface is idle so the first Share tap can present promptly.
    void loadShareModalContent();
  }, [props.preloadContent]);

  if (!props.visible) return null;
  return (
    <Suspense fallback={
      <Sheet visible onClose={props.onClose} snapPoint={0.32}>
        <View accessibilityViewIsModal accessibilityLabel={`Share ${props.title}`} style={styles.loading}>
          <Text style={styles.heading}>Share</Text>
          <ActivityIndicator accessibilityLabel="Preparing share" />
        </View>
      </Sheet>
    }>
      <LazyShareModal {...props} />
    </Suspense>
  );
};

const styles = StyleSheet.create({
  loading: { minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: 20 },
  heading: { fontSize: 18, lineHeight: 28, fontWeight: '700' },
});

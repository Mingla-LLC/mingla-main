import React, { Suspense } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Sheet } from './Sheet';
import type { ShareModalProps } from './ShareModalContent';

export type { ShareModalProps } from './ShareModalContent';

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

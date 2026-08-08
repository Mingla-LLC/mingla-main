import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { buildSharePortraitUrl, cleanHttpsUrl, isShortShareCode, selectPreviewFacts } from '@mingla/sharing';
import {
  ContentShareReadError,
  readContentShare,
  type ContentShareRead,
} from '../../src/services/contentShareService';
import { mixpanelService } from '../../src/services/mixpanelService';
import { logAppsFlyerEvent } from '../../src/services/appsFlyerService';

type RouteFailure = 'not_found' | 'gone' | 'temporarily_unavailable';

export const destinationPath = (share: ContentShareRead): string | null => {
  const d = share.destination;
  const segment = (value: unknown): string =>
    typeof value === 'string' && value.length > 0 ? encodeURIComponent(value) : '';
  const brand = segment(d.brandSlug);
  const entity = segment(d.eventSlug);
  if (share.facts.kind === 'brand' && brand) return `/b/${brand}`;
  if (share.facts.kind === 'venue' && brand && segment(d.venueSlug)) {
    return `/b/${brand}/v/${segment(d.venueSlug)}`;
  }
  if (share.facts.kind === 'event' || share.facts.kind === 'rsvp_event') {
    return brand && entity ? `/e/${brand}/${entity}` : null;
  }
  if (share.facts.kind === 'trip') return brand && entity ? `/t/${brand}/${entity}` : null;
  if (share.facts.kind === 'experience') return brand && entity ? `/exp/${brand}/${entity}` : null;
  return null;
};

const capture = (
  event: 'share_native_opened' | 'share_destination_action' | 'share_failure',
  properties: Record<string, string | number | boolean>,
): void => {
  mixpanelService.track(event, properties);
  logAppsFlyerEvent(event, properties);
};

const errorCopy = (failure: RouteFailure): { title: string; body: string; retry: boolean } => {
  if (failure === 'gone') {
    return { title: 'This share has ended', body: 'Ask the sender for a new Mingla link.', retry: false };
  }
  if (failure === 'not_found') {
    return { title: 'We couldn’t find this share', body: 'Check the link or ask the sender to share it again.', retry: false };
  }
  return { title: 'This share is temporarily unavailable', body: 'Check your connection, then try again.', retry: true };
};

export default function ContentShareRoute() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const router = useRouter();
  const [share, setShare] = useState<ContentShareRead | null>(null);
  const [failure, setFailure] = useState<RouteFailure | null>(null);
  const [attempt, setAttempt] = useState(0);

  const load = useCallback((): void => {
    if (!isShortShareCode(code)) {
      setFailure('not_found');
      capture('share_failure', { failure_type: 'resolver', reason: 'invalid_code', recipient_app: 'consumer', recipient_surface: 'native_content_share' });
      return;
    }
    setFailure(null);
    setShare(null);
    readContentShare(code).then(async (next) => {
      // Installed-direct attribution stays opaque on-device. The server can
      // resolve this validated link/version to its privately derived creator
      // referral; the public envelope never exposes the referral code.
      await AsyncStorage.setItem('@mingla_content_share_attribution', JSON.stringify({ shortCode: next.shortCode, version: next.version }));
      capture('share_native_opened', { kind: next.facts.kind, version: next.version, short_code: next.shortCode, recipient_app: 'consumer', recipient_surface: 'native_content_share', outcome: 'resolved' });
      const path = destinationPath(next);
      if (path !== null) {
        router.replace(path as never);
        return;
      }
      setShare(next);
    }).catch((error: unknown) => {
      const reason = error instanceof ContentShareReadError ? error.code : 'temporarily_unavailable';
      capture('share_failure', { failure_type: 'resolver', reason, recipient_app: 'consumer', recipient_surface: 'native_content_share' });
      setFailure(reason);
    });
  }, [code, router]);

  useEffect(() => { load(); }, [load, attempt]);

  if (failure !== null) {
    const copy = errorCopy(failure);
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.errorTitle}>{copy.title}</Text>
        <Text style={styles.errorBody}>{copy.body}</Text>
        {copy.retry ? (
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry shared link" style={styles.retry} onPress={() => setAttempt((value) => value + 1)}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        ) : null}
      </SafeAreaView>
    );
  }
  if (share === null) return <SafeAreaView style={styles.center}><ActivityIndicator color="#EB7825" /></SafeAreaView>;

  const details = share.publicDetails;
  const heroUrl = share.media === null ? null : buildSharePortraitUrl(share.shortCode, share.version);
  const previewFacts = selectPreviewFacts(share.facts, 4);
  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.content}>
        {heroUrl !== null ? <Image source={{ uri: heroUrl }} style={styles.hero} accessibilityLabel={`${share.facts.kind.replace('_', ' ')}: ${share.facts.title}${previewFacts.length > 0 ? `. ${previewFacts.join('. ')}` : ''}`} /> : null}
        <Text style={styles.kind}>{share.facts.kind.replace('_', ' ')}</Text>
        <Text style={styles.title}>{share.facts.title}</Text>
        {previewFacts.length > 0 ? <Text style={styles.facts}>{previewFacts.join(' · ')}</Text> : null}
        {details?.kind === 'place' ? (
          <View style={styles.detailCard}>
            {details.description ? <Text style={styles.description}>{details.description}</Text> : null}
            {details.address ? <Text style={styles.detailText}>{details.address}</Text> : null}
            <View style={styles.actions}>
              {details.directionsUrl ? <Action label="Directions" value={details.directionsUrl} kind="https" share={share} /> : null}
              {details.phone ? <Action label="Call" value={details.phone} kind="phone" share={share} /> : null}
              {details.website ? <Action label="Website" value={details.website} kind="https" share={share} /> : null}
            </View>
          </View>
        ) : null}
        {details?.kind === 'curated' ? (
          <View style={styles.stops}>
            {details.stops.map((stop, index) => (
              <View key={`${stop.title}:${index}`} style={styles.stop}>
                {stop.imageUrl ? <Image source={{ uri: stop.imageUrl }} style={styles.stopImage} accessibilityLabel={stop.title} /> : null}
                <View style={styles.stopBody}>
                  <Text style={styles.stopOrder}>{index + 1}</Text>
                  <View style={styles.stopCopy}>
                    <Text style={styles.stopTitle}>{stop.title}</Text>
                    {[stop.category, stop.area, stop.address].filter(Boolean).length > 0 ? (
                      <Text style={styles.stopMeta}>{[stop.category, stop.area, stop.address].filter(Boolean).join(' · ')}</Text>
                    ) : null}
                    {stop.description ? <Text style={styles.stopDescription}>{stop.description}</Text> : null}
                  </View>
                </View>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

export const validatedPublicActionUrl = (kind: 'https' | 'phone', value: unknown): string | null => {
  if (kind === 'https') return cleanHttpsUrl(value);
  if (typeof value !== 'string' || value.length > 40) return null;
  const trimmed = value.trim();
  if (!/^\+?[0-9().\-\s]+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return `tel:${trimmed.startsWith('+') ? '+' : ''}${digits}`;
};

function Action({ label, value, kind, share }: { label: string; value: string; kind: 'https' | 'phone'; share: ContentShareRead }) {
  const open = (): void => {
    const url = validatedPublicActionUrl(kind, value);
    if (url === null) {
      capture('share_failure', { failure_type: 'action_validation', reason: 'unsafe_action_url', action: label.toLowerCase(), recipient_app: 'consumer', recipient_surface: 'native_content_share' });
      return;
    }
    capture('share_destination_action', { action: label.toLowerCase(), kind: share.facts.kind, version: share.version, short_code: share.shortCode, recipient_app: 'consumer', recipient_surface: 'native_content_share', outcome: 'pressed' });
    Linking.openURL(url).catch((error: unknown) => {
      console.warn('[ContentShareRoute] action failed:', error);
      capture('share_failure', { failure_type: 'action_open', reason: 'action_open_failed', action: label.toLowerCase(), recipient_app: 'consumer', recipient_surface: 'native_content_share' });
    });
  };
  return <TouchableOpacity accessibilityRole="link" accessibilityLabel={label} onPress={open} style={styles.action}><Text style={styles.actionText}>{label}</Text></TouchableOpacity>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#0C0E12' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0C0E12', padding: 28 },
  content: { padding: 24, paddingBottom: 48 },
  hero: { width: '100%', aspectRatio: 4 / 5, borderRadius: 20, backgroundColor: '#22262C', marginBottom: 20 },
  kind: { color: '#EB7825', textTransform: 'capitalize', fontWeight: '700', fontSize: 14 },
  title: { color: 'white', fontSize: 30, lineHeight: 36, fontWeight: '700', marginTop: 8 },
  facts: { color: 'rgba(255,255,255,0.8)', fontSize: 16, lineHeight: 24, marginTop: 12 },
  detailCard: { marginTop: 24, padding: 18, borderRadius: 18, backgroundColor: '#191C22' },
  description: { color: 'white', fontSize: 16, lineHeight: 24, marginBottom: 12 },
  detailText: { color: 'rgba(255,255,255,0.72)', fontSize: 15, lineHeight: 22 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 },
  action: { backgroundColor: '#EB7825', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10 },
  actionText: { color: '#111318', fontWeight: '700' },
  stops: { marginTop: 24, gap: 14 },
  stop: { overflow: 'hidden', borderRadius: 18, backgroundColor: '#191C22' },
  stopImage: { width: '100%', height: 160, backgroundColor: '#22262C' },
  stopBody: { flexDirection: 'row', padding: 16, gap: 12 },
  stopOrder: { color: '#EB7825', fontWeight: '800', fontSize: 18 },
  stopCopy: { flex: 1 },
  stopTitle: { color: 'white', fontWeight: '700', fontSize: 18 },
  stopMeta: { color: 'rgba(255,255,255,0.68)', marginTop: 5, lineHeight: 20 },
  stopDescription: { color: 'rgba(255,255,255,0.82)', marginTop: 8, lineHeight: 21 },
  errorTitle: { color: 'white', fontSize: 22, fontWeight: '700', textAlign: 'center' },
  errorBody: { color: 'rgba(255,255,255,0.72)', fontSize: 16, lineHeight: 23, textAlign: 'center', marginTop: 10 },
  retry: { marginTop: 20, backgroundColor: '#EB7825', borderRadius: 999, paddingHorizontal: 20, paddingVertical: 12 },
  retryText: { color: '#111318', fontWeight: '700' },
});

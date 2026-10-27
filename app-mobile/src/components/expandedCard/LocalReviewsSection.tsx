import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';

import { localProgramService } from '../../services/localProgramService';
import { postHogService } from '../../services/postHogService';
import { Icon } from '../ui/Icon';
import { VideoTile, playPublicVideo } from '../programs/VideoTile';
import { formatMonth } from '../../utils/programFormat';
import { Section } from './SpineParts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function LocalReviewsSection({ placePoolId }: { placePoolId: string | null | undefined }): React.ReactElement | null {
  const enabled = typeof placePoolId === 'string' && UUID.test(placePoolId);
  const query = useQuery({
    queryKey: ['local-program', 'place-reviews', placePoolId ?? 'missing'],
    queryFn: () => localProgramService.publicPlaceReviews(placePoolId!),
    enabled,
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const reviews = query.data ?? [];
  const tracked = useRef(false);
  useEffect(() => {
    if (reviews.length > 0 && !tracked.current) {
      tracked.current = true;
      postHogService.capture('local_review_viewed', { surface: 'place_card' });
    }
  }, [reviews.length]);
  if (!reviews.length) return null;
  return (
    <Section title="Mingla Local">
      <View style={styles.note}>
        <Icon name="shield-checkmark" size={16} color="#c2410c" />
        <Text style={styles.noteText}>Independent visits. This place did not buy or approve these reviews.</Text>
      </View>
      {reviews.slice(0, 2).map((review) => (
        <View key={review.local_month_id} style={styles.review}>
          <View style={styles.row}>
            {review.avatar_url ? <Image source={{ uri: review.avatar_url }} style={styles.avatar} contentFit="cover" />
              : <View style={styles.avatar}><Text style={styles.avatarText}>{review.name.slice(0, 1).toUpperCase()}</Text></View>}
            <View style={styles.who}>
              <Text style={styles.name} numberOfLines={1}>{review.name} · Mingla Local</Text>
              <Text style={styles.date}><Text style={styles.rating}>{'★'.repeat(review.rating)}</Text>{'☆'.repeat(Math.max(0, 5 - review.rating))} · {formatMonth(review.visited_on)}</Text>
            </View>
          </View>
          <Text style={styles.title}>{review.title}</Text>
          <Text style={styles.body} numberOfLines={4}>{review.excerpt || review.body}</Text>
          {review.media_job_ids?.[0] ? <View style={styles.videoRow}><VideoTile accessibilityLabel={`Play ${review.name}'s review video`} onPress={() => void playPublicVideo(review.media_job_ids[0])} /><View style={styles.videoPad} /></View> : null}
          {review.reply ? (
            <View style={styles.reply}>
              <Text style={styles.replyLabel}>REPLY FROM THE PLACE</Text>
              <Text style={styles.replyBody}>{review.reply}</Text>
            </View>
          ) : null}
        </View>
      ))}
    </Section>
  );
}

const styles = StyleSheet.create({
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 12, backgroundColor: '#fff7ed' },
  noteText: { flex: 1, color: '#7c2d12', fontSize: 13, lineHeight: 18 },
  review: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e7e5e4', gap: 5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#3f7d58', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarText: { color: '#ffffff', fontWeight: '900', fontSize: 15 },
  who: { flex: 1, gap: 2 },
  videoRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  videoPad: { flex: 1.4 },
  name: { flex: 1, color: '#111827', fontSize: 14, fontWeight: '800' },
  rating: { color: '#eb7825', fontSize: 13, letterSpacing: 1 },
  title: { color: '#1c1917', fontSize: 15, fontWeight: '800' },
  body: { color: '#57534e', fontSize: 14, lineHeight: 20 },
  date: { color: '#78716c', fontSize: 12 },
  reply: { marginTop: 5, padding: 11, borderRadius: 11, backgroundColor: '#f5f5f4', gap: 3 },
  replyLabel: { color: '#78716c', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  replyBody: { color: '#44403c', fontSize: 13, lineHeight: 18 },
});

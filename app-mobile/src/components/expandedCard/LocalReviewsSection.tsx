import React, { useEffect, useRef } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { localProgramService } from '../../services/localProgramService';
import { publicCreatorMedia } from '../../services/creatorMediaService';
import { postHogService } from '../../services/postHogService';
import { Icon } from '../ui/Icon';
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
  const play = async (jobId: string): Promise<void> => {
    try { const media = await publicCreatorMedia(jobId); await Linking.openURL(media.playback.url); }
    catch (error) { Alert.alert('Video unavailable', error instanceof Error ? error.message : String(error)); }
  };

  return (
    <Section title="Mingla Local">
      <View style={styles.note}>
        <Icon name="shield-checkmark" size={16} color="#c2410c" />
        <Text style={styles.noteText}>Independent visits. This place did not buy or approve these reviews.</Text>
      </View>
      {reviews.slice(0, 2).map((review) => (
        <View key={review.local_month_id} style={styles.review}>
          <View style={styles.row}>
            <Text style={styles.name}>{review.name}</Text>
            <Text style={styles.rating}>{'★'.repeat(review.rating)}</Text>
          </View>
          <Text style={styles.title}>{review.title}</Text>
          <Text style={styles.body} numberOfLines={4}>{review.excerpt || review.body}</Text>
          <Text style={styles.date}>Visited {new Date(review.visited_on).toLocaleDateString()}</Text>
          {review.media_job_ids?.[0] ? <Pressable accessibilityRole="button" onPress={() => void play(review.media_job_ids[0])} style={styles.video}><Icon name="play" size={14} color="#c2410c" /><Text style={styles.videoText}>Watch the Local’s review video</Text></Pressable> : null}
          {review.reply ? (
            <View style={styles.reply}>
              <Text style={styles.replyLabel}>PLACE REPLY</Text>
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
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  name: { flex: 1, color: '#111827', fontSize: 14, fontWeight: '800' },
  rating: { color: '#eb7825', fontSize: 13, letterSpacing: 1 },
  title: { color: '#1c1917', fontSize: 15, fontWeight: '800' },
  body: { color: '#57534e', fontSize: 14, lineHeight: 20 },
  date: { color: '#78716c', fontSize: 12 },
  video: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 6 },
  videoText: { color: '#c2410c', fontSize: 13, fontWeight: '800' },
  reply: { marginTop: 5, padding: 11, borderRadius: 11, backgroundColor: '#f5f5f4', gap: 3 },
  replyLabel: { color: '#78716c', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  replyBody: { color: '#44403c', fontSize: 13, lineHeight: 18 },
});

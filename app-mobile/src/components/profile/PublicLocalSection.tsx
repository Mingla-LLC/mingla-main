import React, { useEffect, useRef } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { localProgramService } from '../../services/localProgramService';
import { publicCreatorMedia } from '../../services/creatorMediaService';
import { postHogService } from '../../services/postHogService';
import { Icon } from '../ui/Icon';

export function PublicLocalSection({ userId, embedded = false }: { userId: string; embedded?: boolean }): React.ReactElement | null {
  const query = useQuery({
    queryKey: ['local-program', 'public-profile', userId],
    queryFn: () => localProgramService.publicProfile(userId),
    enabled: userId.length > 0,
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const local = query.data;
  const tracked = useRef(false);
  useEffect(() => {
    if (local && !tracked.current) {
      tracked.current = true;
      postHogService.capture('local_review_viewed', { surface: 'profile' });
    }
  }, [local]);
  if (!local) return null;
  const play = async (jobId: string): Promise<void> => {
    try { const media = await publicCreatorMedia(jobId); await Linking.openURL(media.playback.url); }
    catch (error) { Alert.alert('Video unavailable', error instanceof Error ? error.message : String(error)); }
  };

  return (
    <View style={[styles.card, embedded && styles.embedded]} accessibilityLabel={`Mingla Local in ${local.city}`}>
      <View style={styles.header}>
        <View style={styles.badge}>
          <Icon name="map-pin" size={16} color="#eb7825" />
          <Text style={styles.badgeText}>Mingla Local</Text>
        </View>
        <Text style={styles.since}>Since {new Date(local.local_since).getFullYear()}</Text>
      </View>
      <Text style={styles.title}>Independent reviews from {local.city}</Text>
      <Text style={styles.copy}>
        Local reviews are selected independently. Places cannot buy or approve them.
      </Text>
      {local.reviews.slice(0, 3).map((review) => (
        <View key={review.local_month_id} style={styles.review}>
          <View style={styles.reviewTop}>
            <Text style={styles.place} numberOfLines={1}>{review.place_name}</Text>
            <Text style={styles.rating}>{'★'.repeat(review.rating)}</Text>
          </View>
          <Text style={styles.reviewTitle}>{review.title}</Text>
          <Text style={styles.body} numberOfLines={3}>{review.body}</Text>
          {review.media_job_ids?.[0] ? <Pressable accessibilityRole="button" onPress={() => void play(review.media_job_ids[0])} style={styles.video}><Icon name="play" size={14} color="#eb7825" /><Text style={styles.videoText}>Watch review video</Text></Pressable> : null}
          {review.reply ? <Text style={styles.reply}>Place reply: {review.reply}</Text> : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  embedded: { marginTop: 12, padding: 14, borderRadius: 14 },
  card: { marginTop: 22, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.10)', backgroundColor: 'rgba(255, 255, 255, 0.04)' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badgeText: { color: '#eb7825', fontWeight: '700', fontSize: 13 },
  since: { color: 'rgba(255, 255, 255, 0.52)', fontSize: 12, fontWeight: '600' },
  title: { color: '#ffffff', fontSize: 19, lineHeight: 24, fontWeight: '800', marginTop: 10 },
  copy: { color: 'rgba(255, 255, 255, 0.72)', fontSize: 13, lineHeight: 19, marginTop: 4 },
  review: { paddingTop: 13, marginTop: 13, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255, 255, 255, 0.10)', gap: 4 },
  reviewTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  place: { flex: 1, color: '#ffffff', fontWeight: '800', fontSize: 14 },
  rating: { color: '#eb7825', fontSize: 12, letterSpacing: 1 },
  reviewTitle: { color: 'rgba(255, 255, 255, 0.92)', fontWeight: '700', fontSize: 14 },
  body: { color: 'rgba(255, 255, 255, 0.72)', fontSize: 13, lineHeight: 19 },
  reply: { color: 'rgba(255, 255, 255, 0.72)', fontSize: 12, lineHeight: 18, fontStyle: 'italic', marginTop: 3 },
  video: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 5 },
  videoText: { color: '#eb7825', fontSize: 12, fontWeight: '800' },
});

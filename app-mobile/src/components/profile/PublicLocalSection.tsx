import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { localProgramService } from '../../services/localProgramService';
import { postHogService } from '../../services/postHogService';
import { Icon } from '../ui/Icon';
import { VideoTile, playPublicVideo } from '../programs/VideoTile';

/**
 * The public Local card: "Mingla Local · City", who pays (Mingla, never the
 * places), and the places this Local has been as video tiles with the rating.
 */
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
  const reviews = local.reviews.slice(0, 3);
  const latest = reviews[0];

  return (
    <View style={[styles.card, embedded && styles.embedded]} accessibilityLabel={`Mingla Local in ${local.city}`}>
      <View style={styles.badge}>
        <Icon name="map-pin" size={15} color="#eb7825" />
        <Text style={styles.badgeText}>Mingla Local · {local.city}</Text>
      </View>
      <Text style={styles.copy}>Paid by Mingla, not the places. Places can’t buy or approve these reviews.</Text>
      {reviews.length ? <>
        <Text style={styles.label}>PLACES I’VE BEEN</Text>
        <View style={styles.tiles}>
          {reviews.map((review, index) => (
            <VideoTile key={review.local_month_id} index={index} label={`${review.place_name} ★${review.rating}`}
              accessibilityLabel={`${review.place_name}, ${review.rating} stars. Play review video`}
              onPress={review.media_job_ids?.[0] ? () => void playPublicVideo(review.media_job_ids[0]) : undefined} />
          ))}
          {Array.from({ length: Math.max(0, 3 - reviews.length) }).map((_, i) => <View key={`pad-${i}`} style={styles.pad} />)}
        </View>
        {latest ? <View style={styles.review}>
          <Text style={styles.reviewTitle} numberOfLines={2}>{latest.title}</Text>
          <Text style={styles.body} numberOfLines={3}>{latest.body}</Text>
          {latest.reply ? <Text style={styles.reply} numberOfLines={3}>Reply from {latest.place_name}: {latest.reply}</Text> : null}
        </View> : null}
      </> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  embedded: { marginTop: 12, padding: 14, borderRadius: 14 },
  card: { marginTop: 22, padding: 16, gap: 10, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.10)', backgroundColor: 'rgba(255, 255, 255, 0.04)' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badgeText: { color: '#eb7825', fontWeight: '800', fontSize: 14 },
  copy: { color: 'rgba(255, 255, 255, 0.72)', fontSize: 13, lineHeight: 19 },
  label: { color: 'rgba(255, 255, 255, 0.45)', fontSize: 11, fontWeight: '800', letterSpacing: 1.1, marginTop: 4 },
  tiles: { flexDirection: 'row', gap: 8 },
  pad: { flex: 1 },
  review: { gap: 4, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255, 255, 255, 0.10)' },
  reviewTitle: { color: 'rgba(255, 255, 255, 0.92)', fontWeight: '700', fontSize: 14 },
  body: { color: 'rgba(255, 255, 255, 0.72)', fontSize: 13, lineHeight: 19 },
  reply: { color: 'rgba(255, 255, 255, 0.72)', fontSize: 12, lineHeight: 18, fontStyle: 'italic' },
});

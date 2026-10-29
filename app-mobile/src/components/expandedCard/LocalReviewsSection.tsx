import React, { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';

import { localProgramService } from '../../services/localProgramService';
import { publicCreatorMedia } from '../../services/creatorMediaService';
import { postHogService } from '../../services/postHogService';
import { VideoTile } from '../programs/VideoTile';
import { CreatorMediaPlayerModal } from '../programs/CreatorMediaPlayerModal';
import { formatMonth } from '../../utils/programFormat';
import { Section } from './SpineParts';
import { SPINE } from './spineTokens';

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
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const tracked = useRef(false);
  useEffect(() => {
    if (reviews.length > 0 && !tracked.current) {
      tracked.current = true;
      postHogService.capture('local_review_viewed', { surface: 'place_card' });
    }
  }, [reviews.length]);
  const openVideo = async (jobId: string) => {
    try {
      const media = await publicCreatorMedia(jobId);
      setVideoUrl(media.playback.url);
    } catch {
      Alert.alert('Video unavailable', 'This review video cannot be played right now. Try again later.');
    }
  };
  if (!reviews.length) return null;
  return (
    <>
      <Section title="Mingla Local">
        <View style={styles.content}>
          {reviews.slice(0, 2).map((review, index) => (
            <View key={review.local_month_id} style={[styles.review, index > 0 ? styles.reviewDivided : null]}>
              <View style={styles.row}>
                {review.avatar_url ? <Image source={{ uri: review.avatar_url }} style={styles.avatar} contentFit="cover" />
                  : <View style={styles.avatar}><Text style={styles.avatarText}>{review.name.slice(0, 1).toUpperCase()}</Text></View>}
                <View style={styles.who}>
                  <Text style={styles.name} numberOfLines={1}>{review.name}</Text>
                  <Text style={styles.meta}>Mingla Local · {formatMonth(review.visited_on)}</Text>
                </View>
                <Text style={styles.rating} accessibilityLabel={`${review.rating} out of 5 stars`}>
                  {'★'.repeat(review.rating)}{'☆'.repeat(Math.max(0, 5 - review.rating))}
                </Text>
              </View>
              <Text style={styles.title}>{review.title}</Text>
              <Text style={styles.body} numberOfLines={4}>{review.excerpt || review.body}</Text>
              {review.media_job_ids?.[0] ? (
                <VideoTile
                  label={`Watch ${review.name}'s visit`}
                  accessibilityLabel={`Play ${review.name}'s review video`}
                  onPress={() => void openVideo(review.media_job_ids[0])}
                  style={styles.video}
                />
              ) : null}
              {review.reply ? (
                <View style={styles.reply}>
                  <Text style={styles.replyLabel}>REPLY FROM THE PLACE</Text>
                  <Text style={styles.replyBody}>{review.reply}</Text>
                </View>
              ) : null}
            </View>
          ))}
        </View>
      </Section>
      <CreatorMediaPlayerModal url={videoUrl} onClose={() => setVideoUrl(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: SPINE.gutter },
  review: { gap: 8, paddingBottom: 4 },
  reviewDivided: { borderTopWidth: 1, borderTopColor: SPINE.rule, marginTop: 20, paddingTop: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#3f7d58', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarText: { color: '#ffffff', fontWeight: '900', fontSize: 15 },
  who: { flex: 1, minWidth: 0, gap: 2 },
  name: { color: SPINE.factValue, fontSize: 15, fontWeight: '800' },
  meta: { color: SPINE.factLabel, fontSize: 12, fontWeight: '500' },
  rating: { color: SPINE.accentFill, fontSize: 13, letterSpacing: 1 },
  title: { color: SPINE.factValue, fontSize: 17, lineHeight: 22, fontWeight: '800', marginTop: 4 },
  body: { color: SPINE.muted, fontSize: 15, lineHeight: 22 },
  video: { flex: 0, width: '100%', aspectRatio: 16 / 9, maxHeight: 210, marginTop: 6 },
  reply: { marginTop: 6, borderLeftWidth: 2, borderLeftColor: SPINE.hairline, paddingLeft: 12, gap: 4 },
  replyLabel: { color: SPINE.factLabel, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  replyBody: { color: SPINE.muted, fontSize: 13, lineHeight: 18 },
});

import React from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { creatorProgramService } from '../../services/creatorProgramService';
import { publicCreatorMedia } from '../../services/creatorMediaService';
import { Icon } from '../ui/Icon';

/**
 * The public Creator card. On someone else's profile it stands alone; on your
 * own Profile it sits inside the Creator programs card (`embedded`) so it reads
 * as part of that section, not a separate block.
 */
export function PublicCreatorSection({ userId, embedded = false }: { userId: string; embedded?: boolean }): React.ReactElement | null {
  const query = useQuery({
    queryKey: ['creator-program', 'public-profile', userId],
    queryFn: () => creatorProgramService.publicProfile(userId),
    enabled: userId.length > 0,
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const creator = query.data;
  if (!creator) return null;
  const play = async (jobId: string): Promise<void> => {
    try {
      const media = await publicCreatorMedia(jobId);
      await Linking.openURL(media.playback.url);
    } catch (error) {
      Alert.alert('Video unavailable', error instanceof Error ? error.message : String(error));
    }
  };

  const track = creator.completed_gigs > 0
    ? `${creator.completed_gigs} gig${creator.completed_gigs === 1 ? '' : 's'} completed`
    : 'New creator';

  return (
    <View style={[styles.card, embedded && styles.embedded]} accessibilityLabel={`Mingla Creator ${creator.display_name}`}>
      <View style={styles.header}>
        <View style={styles.badge}>
          <Icon name="videocam" size={14} color="#eb7825" />
          <Text style={styles.badgeText}>Mingla Creator</Text>
        </View>
        <Text style={styles.track}>{track}</Text>
      </View>
      <Text style={styles.title}>{creator.display_name}</Text>
      {creator.niches.length ? (
        <View style={styles.niches}>
          {creator.niches.map((niche) => (
            <View key={niche} style={styles.niche}>
              <Text style={styles.nicheText}>{niche.replaceAll('_', ' ')}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {creator.showcase.length ? (
        <View style={styles.showcase}>
          {creator.showcase.slice(0, 3).map((item, index) => (
            <Pressable accessibilityRole="button" accessibilityLabel={`Play showcase video ${index + 1}`} onPress={() => void play(item.media_id)} key={item.media_id} style={({ pressed }) => [styles.reel, pressed && styles.pressed]}>
              <Icon name="play" size={18} color="#ffffff" />
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 22, padding: 16, gap: 10, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.10)', backgroundColor: 'rgba(255, 255, 255, 0.04)' },
  embedded: { marginTop: 12, padding: 14, borderRadius: 14 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badgeText: { color: '#eb7825', fontWeight: '700', fontSize: 13 },
  track: { color: 'rgba(255, 255, 255, 0.52)', fontSize: 12, fontWeight: '600' },
  title: { color: '#ffffff', fontSize: 19, lineHeight: 24, fontWeight: '800' },
  niches: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  niche: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.12)' },
  nicheText: { color: 'rgba(255, 255, 255, 0.82)', fontSize: 12, fontWeight: '600', textTransform: 'capitalize' },
  showcase: { flexDirection: 'row', gap: 8 },
  reel: { flex: 1, aspectRatio: 9 / 16, maxHeight: 132, borderRadius: 12, backgroundColor: 'rgba(235, 120, 37, 0.18)', alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.8 },
});

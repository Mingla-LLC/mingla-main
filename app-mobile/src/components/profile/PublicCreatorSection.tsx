import React from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { creatorProgramService } from '../../services/creatorProgramService';
import { publicCreatorMedia } from '../../services/creatorMediaService';
import { Icon } from '../ui/Icon';

export function PublicCreatorSection({ userId }: { userId: string }): React.ReactElement | null {
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

  return (
    <View style={styles.card} accessibilityLabel={`Verified Mingla Creator ${creator.display_name}`}>
      <View style={styles.header}>
        <View style={styles.badge}>
          <Icon name="videocam" size={16} color="#7c3aed" />
          <Text style={styles.badgeText}>VERIFIED MINGLA CREATOR</Text>
        </View>
        <Text style={styles.completed}>
          {creator.completed_gigs} completed gig{creator.completed_gigs === 1 ? '' : 's'}
        </Text>
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
            <Pressable accessibilityRole="button" accessibilityLabel={`Play showcase ${index + 1}`} onPress={() => void play(item.media_id)} key={item.media_id} style={styles.reel}>
              <Icon name="play" size={19} color="#ffffff" />
              <Text style={styles.reelText}>Showcase {index + 1}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Text style={styles.privacy}>
        Contact details and social handles stay private until a paid gig is accepted.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 22, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: '#ddd6fe', backgroundColor: '#faf7ff' },
  header: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badgeText: { color: '#6d28d9', fontWeight: '900', fontSize: 11, letterSpacing: 1.1 },
  completed: { color: '#6b7280', fontSize: 12, fontWeight: '600' },
  title: { color: '#111827', fontSize: 20, lineHeight: 25, fontWeight: '900', marginTop: 10 },
  niches: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10 },
  niche: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: '#ede9fe' },
  nicheText: { color: '#5b21b6', fontSize: 12, fontWeight: '800', textTransform: 'capitalize' },
  showcase: { flexDirection: 'row', gap: 8, marginTop: 13 },
  reel: { flex: 1, minHeight: 82, borderRadius: 13, backgroundColor: '#5b21b6', alignItems: 'center', justifyContent: 'center', gap: 5, padding: 8 },
  reelText: { color: '#ffffff', fontSize: 11, fontWeight: '800', textAlign: 'center' },
  privacy: { color: '#6b7280', fontSize: 12, lineHeight: 17, marginTop: 12 },
});

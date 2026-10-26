import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { creatorProgramService } from '../../services/creatorProgramService';
import { nicheLabel } from '../../utils/programFormat';
import { Icon } from '../ui/Icon';
import { VideoTile, playPublicVideo } from '../programs/VideoTile';

/**
 * The public Creator card on someone's profile. It only renders for verified
 * creators (the server returns nothing otherwise, and we check again), shows
 * up to two showcase videos as real thumbnails, and "Promoting now" when the
 * creator has a live gig.
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
  if (!creator || !creator.id) return null;
  const showcase = creator.showcase.slice(0, 2);
  const gigs = creator.completed_gigs > 0 ? `${creator.completed_gigs} gig${creator.completed_gigs === 1 ? '' : 's'} done` : null;
  const promoting = creator.promoting_now ?? null;

  return (
    <View style={[styles.card, embedded && styles.embedded]} accessibilityLabel={`Mingla Creator ${creator.display_name}`}>
      <View style={styles.header}>
        <View style={styles.badge}>
          <Icon name="videocam" size={14} color="#eb7825" />
          <Text style={styles.badgeText}>Mingla Creator</Text>
        </View>
        {gigs ? <Text style={styles.track}>{gigs}</Text> : null}
      </View>
      {creator.niches.length ? (
        <View style={styles.niches}>
          {creator.niches.map((niche) => (
            <View key={niche} style={styles.niche}><Text style={styles.nicheText}>{nicheLabel(niche)}</Text></View>
          ))}
        </View>
      ) : null}
      {showcase.length ? (
        <View style={styles.showcase}>
          {showcase.map((item, index) => (
            <VideoTile key={item.media_id} index={index} thumbnail={item.thumb} label={item.title ?? null}
              accessibilityLabel={`Play ${creator.display_name}'s showcase video ${index + 1}`} onPress={() => void playPublicVideo(item.media_id)} />
          ))}
          {showcase.length === 1 ? <View style={styles.spacer} /> : null}
        </View>
      ) : null}
      {promoting ? (
        <Pressable accessibilityRole={promoting.url ? 'link' : undefined} disabled={!promoting.url} onPress={() => { if (promoting.url) void Linking.openURL(promoting.url); }} style={styles.promoting}>
          <Text style={styles.promotingLabel}>Promoting now</Text>
          <Text style={styles.promotingValue} numberOfLines={1}>{promoting.title}</Text>
          {promoting.url ? <Icon name="chevron-forward" size={14} color="rgba(255, 255, 255, 0.52)" /> : null}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 22, padding: 16, gap: 12, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.10)', backgroundColor: 'rgba(255, 255, 255, 0.04)' },
  embedded: { marginTop: 12, padding: 14, borderRadius: 14 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badgeText: { color: '#eb7825', fontWeight: '800', fontSize: 14 },
  track: { color: 'rgba(255, 255, 255, 0.52)', fontSize: 12, fontWeight: '600' },
  niches: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  niche: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.12)' },
  nicheText: { color: 'rgba(255, 255, 255, 0.82)', fontSize: 12, fontWeight: '600' },
  showcase: { flexDirection: 'row', gap: 10 },
  spacer: { flex: 1 },
  promoting: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255, 255, 255, 0.10)' },
  promotingLabel: { flex: 1, color: '#ffffff', fontSize: 14, fontWeight: '700' },
  promotingValue: { maxWidth: '55%', color: 'rgba(255, 255, 255, 0.72)', fontSize: 13 },
});

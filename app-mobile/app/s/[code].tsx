import React, { useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet, Text } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { isShortShareCode, selectPreviewFacts } from '@mingla/sharing';
import { readContentShare, type ContentShareRead } from '../../src/services/contentShareService';

const destinationPath = (share: ContentShareRead): string | null => {
  const d = share.destination || {};
  const segment = (value: unknown) => typeof value === 'string' && value ? encodeURIComponent(value) : '';
  const brand = segment(d.brandSlug);
  const entity = segment(d.eventSlug);
  if (share.facts.kind === 'brand' && brand) return `/b/${brand}`;
  if (share.facts.kind === 'venue' && brand && segment(d.venueSlug)) return `/b/${brand}/v/${segment(d.venueSlug)}`;
  if (share.facts.kind === 'event' || share.facts.kind === 'rsvp_event') return brand && entity ? `/e/${brand}/${entity}` : null;
  if (share.facts.kind === 'trip') return brand && entity ? `/t/${brand}/${entity}` : null;
  if (share.facts.kind === 'experience') return brand && entity ? `/exp/${brand}/${entity}` : null;
  return null;
};

export default function ContentShareRoute() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const router = useRouter();
  const [share, setShare] = useState<ContentShareRead | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!isShortShareCode(code)) { setFailed(true); return; }
    readContentShare(code).then((next) => {
      const path = destinationPath(next);
      if (path) router.replace(path as never);
      else setShare(next);
    }).catch(() => setFailed(true));
  }, [code, router]);
  if (failed) return <SafeAreaView style={styles.center}><Text>This shared page is no longer available.</Text></SafeAreaView>;
  if (!share) return <SafeAreaView style={styles.center}><ActivityIndicator color="#EB7825" /></SafeAreaView>;
  return <SafeAreaView style={styles.page}><Text style={styles.kind}>{share.facts.kind.replace('_', ' ')}</Text><Text style={styles.title}>{share.facts.title}</Text><Text style={styles.facts}>{selectPreviewFacts(share.facts, 4).join(' · ')}</Text></SafeAreaView>;
}

export { destinationPath };
const styles = StyleSheet.create({ center:{flex:1,alignItems:'center',justifyContent:'center'},page:{flex:1,backgroundColor:'#0C0E12',padding:24,justifyContent:'center'},kind:{color:'#FFF7EF',textTransform:'capitalize',fontWeight:'600'},title:{color:'white',fontSize:30,lineHeight:36,fontWeight:'700',marginTop:8},facts:{color:'rgba(255,255,255,0.8)',fontSize:16,lineHeight:24,marginTop:12} });

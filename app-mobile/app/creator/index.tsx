import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CREATOR_FORMATS, creatorProgramService, type CreatorSetupStatus } from '../../src/services/creatorProgramService';
import { creatorGigsService, type PublicGig } from '../../src/services/creatorGigsService';
import { ProgramButton, ProgramCard, ProgramChip, programStyles as s } from '../../src/components/programs/ProgramUi';

type Home = Awaited<ReturnType<typeof creatorGigsService.home>>;
export default function CreatorHomeScreen(): React.ReactElement {
  const router = useRouter();
  const [setup, setSetup] = useState<CreatorSetupStatus | null>(null);
  const [home, setHome] = useState<Home>({ contracts: [], interests: [] });
  const [gigs, setGigs] = useState<PublicGig[]>([]);
  const [format, setFormat] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextSetup, nextHome, nextGigs] = await Promise.all([creatorProgramService.status(), creatorGigsService.home(), creatorGigsService.board(format)]);
      setSetup(nextSetup); setHome(nextHome); setGigs(nextGigs);
    } catch (error) { Alert.alert('Couldn’t load Creator', error instanceof Error ? error.message : String(error)); }
    finally { setLoading(false); }
  }, [format]);
  useEffect(() => { void load(); }, [load]);
  const ready = setup?.verification === 'verified';
  return <SafeAreaView style={s.safe}><Stack.Screen options={{ headerShown: false }} /><ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor="#eb7825" />}>
    <Text style={s.eyebrow}>MINGLA CREATOR</Text><Text style={s.heading}>Create. Get hired. Get paid.</Text>
    <Text style={s.lede}>Build your verified profile once, browse private-safe briefs, and manage every paid collaboration from offer to release.</Text>
    <ProgramCard><View style={s.row}><View style={{ flex: 1, gap: 4 }}><Text style={s.title}>{ready ? 'You’re ready for gigs' : 'Finish your Creator setup'}</Text><Text style={s.copy}>{ready ? 'Hosts can match your formats, price and city.' : `Still needed: ${(setup?.missing ?? ['profile']).join(', ')}.`}</Text></View><Text style={ready ? s.success : s.warning}>{ready ? 'READY' : 'SETUP'}</Text></View><ProgramButton label={ready ? 'Review setup' : 'Continue setup'} onPress={() => router.push('/creator/setup' as never)} secondary={ready} /></ProgramCard>
    {home.contracts.length > 0 && <><Text style={s.title}>Your active work</Text>{home.contracts.map((item) => <Pressable key={item.id} onPress={() => router.push(`/creator/contract/${item.id}` as never)}><ProgramCard><View style={s.row}><Text style={[s.title,{flex:1}]}>{item.title}</Text><Text style={s.warning}>{item.state.replaceAll('_',' ')}</Text></View><Text style={s.copy}>{item.city} · Post by {item.post_by}</Text><Text style={s.copy}>{item.currency} {(item.fee_minor / 100).toLocaleString(undefined,{minimumFractionDigits:2})}</Text></ProgramCard></Pressable>)}</>}
    {home.interests.length > 0 && <ProgramCard><Text style={s.title}>Waiting on hosts</Text>{home.interests.map((item) => <View key={item.id} style={s.row}><Text style={[s.copy,{flex:1}]}>{item.title}</Text><Text style={s.warning}>{item.status}</Text></View>)}</ProgramCard>}
    <Text style={s.title}>Open gigs</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}><ProgramChip label="All formats" selected={!format} onPress={() => setFormat(null)} />{CREATOR_FORMATS.map((item) => <ProgramChip key={item.key} label={item.name} selected={format === item.key} onPress={() => setFormat(item.key)} />)}</ScrollView>
    {!loading && gigs.length === 0 ? <ProgramCard><Text style={s.title}>Nothing matches yet</Text><Text style={s.copy}>Try another format or check again after the next matching run.</Text></ProgramCard> : gigs.map((gig) => <Pressable key={gig.id} onPress={() => router.push(`/creator/gig/${gig.id}` as never)}><ProgramCard><View style={s.row}><Text style={s.warning}>{gig.budget_band.toUpperCase()}</Text><Text style={s.copy}>{gig.slots_left} slot{gig.slots_left === 1 ? '' : 's'}</Text></View><Text style={s.title}>{gig.title_public}</Text><Text numberOfLines={3} style={s.copy}>{gig.brief_public}</Text><Text style={s.copy}>{gig.city_name} · Shoot {gig.shoot_window.start}–{gig.shoot_window.end}</Text>{gig.sales_share_bps ? <Text style={s.success}>Plus {(gig.sales_share_bps / 100).toFixed(0)}% sales share</Text> : null}</ProgramCard></Pressable>)}
  </ScrollView></SafeAreaView>;
}

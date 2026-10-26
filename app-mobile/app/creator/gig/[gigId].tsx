import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, Text } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { creatorProgramService, type CreatorSetupStatus } from '../../../src/services/creatorProgramService';
import { creatorGigsService, type PublicGig } from '../../../src/services/creatorGigsService';
import { ProgramButton, ProgramCard, ProgramField, programStyles as s } from '../../../src/components/programs/ProgramUi';

export default function CreatorGigScreen(): React.ReactElement {
  const { gigId } = useLocalSearchParams<{ gigId: string }>(); const router = useRouter();
  const [gig,setGig]=useState<PublicGig|null>(null); const [setup,setSetup]=useState<CreatorSetupStatus|null>(null); const [packageId,setPackageId]=useState(''); const [quote,setQuote]=useState(''); const [note,setNote]=useState(''); const [busy,setBusy]=useState(false);
  useEffect(()=>{ void Promise.all([creatorGigsService.detail(gigId),creatorProgramService.status()]).then(([g,st])=>{setGig(g);setSetup(st);const p=st.packages?.find(x=>x.format_key===g.format_key)??st.packages?.[0];if(p?.id){setPackageId(String(p.id));setQuote(String(p.price_minor??''));}}).catch(e=>Alert.alert('Couldn’t load gig',e instanceof Error?e.message:String(e)));},[gigId]);
  const send=async()=>{setBusy(true);try{await creatorGigsService.sendInterest(gigId,packageId,Number(quote),note);Alert.alert('Interest sent','The Host sees your verified pre-hire profile, package and quote—not your contact details.');router.back();}catch(e){Alert.alert('Couldn’t send interest',e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
  if(!gig)return <SafeAreaView style={s.safe}><Text style={[s.copy,{padding:20}]}>Loading brief…</Text></SafeAreaView>;
  return <SafeAreaView style={s.safe}><Stack.Screen options={{headerShown:false}}/><ScrollView contentContainerStyle={s.content}><Text style={s.eyebrow}>PRIVATE-SAFE BRIEF</Text><Text style={s.heading}>{gig.title_public}</Text><Text style={s.lede}>{gig.brief_public}</Text>
    <ProgramCard><Text style={s.title}>What’s agreed upfront</Text><Text style={s.copy}>Format: {gig.format_key.replaceAll('_',' ')}</Text><Text style={s.copy}>Deliverables: {gig.deliverables.map(x=>`${x.count} ${x.platform} ${x.kind}`).join(', ')}</Text><Text style={s.copy}>Shoot: {gig.shoot_window.start} to {gig.shoot_window.end}</Text><Text style={s.copy}>Post by: {gig.post_by}</Text><Text style={s.copy}>Usage: {gig.usage_days} days</Text><Text style={s.copy}>Budget: {gig.budget_band.toUpperCase()}</Text></ProgramCard>
    <ProgramCard><Text style={s.title}>Send interest</Text>{setup?.verification!=='verified'?<><Text style={s.warning}>Complete setup first. Missing: {(setup?.missing??['readiness checks']).join(', ')}.</Text><ProgramButton label="Finish setup" onPress={()=>router.push('/creator/setup' as never)}/></>:<><ProgramField value={quote} onChangeText={setQuote} keyboardType="number-pad" placeholder="Your price in minor units"/><ProgramField value={note} onChangeText={setNote} multiline placeholder="Optional note—no links, handles, email or phone"/><ProgramButton busy={busy} label="Send interest" onPress={()=>void send()} disabled={!packageId||!Number.isInteger(Number(quote))||Number(quote)<=0}/><Text style={s.copy}>Your identity and contact details stay private until you accept a funded offer.</Text></>}</ProgramCard>
  </ScrollView></SafeAreaView>;
}

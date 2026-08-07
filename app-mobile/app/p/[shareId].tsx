import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ImageBackground, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { PLATE, RAMP, SLIVER, SURFACES, selectSharedCardFacts, surfacePlateBoundary, surfaceSliverBoundary } from '@mingla/card-identity';
import { readSharedCard } from '../../src/services/sharedCardService';
import { referralCodeFromSharedCardAppUrl } from '../../src/services/sharedCardLinks';
import { isOpaqueShareId } from '../../src/services/oneLinkResolver';

export default function SharedCardRoute() {
  const { shareId } = useLocalSearchParams<{ shareId: string }>();
  const [snapshot, setSnapshot] = useState<Record<string, any> | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!isOpaqueShareId(shareId)) { setFailed(true); return; }
    setFailed(false);
    readSharedCard(shareId)
      .then(async ({ snapshot: nextSnapshot, appUrl }) => {
        const referralCode = referralCodeFromSharedCardAppUrl(appUrl);
        if (referralCode) await AsyncStorage.setItem('@mingla_referral_code', referralCode);
        setSnapshot(nextSnapshot);
      })
      .catch(() => setFailed(true));
  }, [shareId]);
  if (failed) return <SafeAreaView style={styles.center}><Text>This shared card is no longer available.</Text></SafeAreaView>;
  if (!snapshot) return <SafeAreaView style={styles.center}><ActivityIndicator color="#eb7825" /></SafeAreaView>;
  const metadata = snapshot.metadata ?? {};
  // selectSharedCardFacts is the sole selector for
  // [metadata.category, metadata.location, metadata.price, metadata.duration].
  const facts = selectSharedCardFacts(metadata).join(' · ');
  return <SafeAreaView style={styles.page}><ImageBackground source={snapshot.cover_url ? { uri: snapshot.cover_url } : undefined} style={styles.hero} imageStyle={styles.image}><LinearGradient colors={RAMP.bottom.colors as any} locations={RAMP.bottom.locations as any} style={StyleSheet.absoluteFill}/>{snapshot.kind === 'curated' ? SLIVER.offsets.map((offset: number, index: number) => <View key={offset} style={[styles.sliver,{left:S6.sideInset+(S6.sliver.insets?.[index] ?? SLIVER.insets[index]),right:S6.sideInset+(S6.sliver.insets?.[index] ?? SLIVER.insets[index]),bottom:S6.bottomInset+S6.plateH+offset}]} />) : null}<Text style={styles.title}>{snapshot.title}</Text><View style={styles.plate}><Text style={styles.facts}>{facts}</Text><Text style={styles.brand}>mingla</Text></View></ImageBackground></SafeAreaView>;
}
const S6 = SURFACES.s6Phone;
const plateBoundary = surfacePlateBoundary('s6Phone');
const sliverBoundary = surfaceSliverBoundary('s6Phone');
const styles = StyleSheet.create({ page:{flex:1,backgroundColor:'#090909',padding:S6.sideInset,justifyContent:'center'},center:{flex:1,alignItems:'center',justifyContent:'center'},hero:{width:'100%',aspectRatio:S6.w/S6.h,maxHeight:S6.h,borderRadius:S6.cardR,overflow:'hidden',backgroundColor:PLATE.fallbackSolid},image:{borderRadius:S6.cardR},title:{position:'absolute',left:S6.sideInset+S6.titleInset,right:S6.sideInset+S6.titleInset,bottom:S6.bottomInset+S6.plateH+S6.gap,color:'white',fontSize:S6.titleSize,lineHeight:S6.titleLH,fontWeight:S6.titleWeight as any},plate:{position:'absolute',left:S6.sideInset,right:S6.sideInset,bottom:S6.bottomInset,height:S6.plateH,borderRadius:S6.plateR,borderWidth:plateBoundary.width,borderColor:plateBoundary.color,backgroundColor:PLATE.fallbackSolid,paddingHorizontal:S6.titleInset,flexDirection:'row',alignItems:'center'},sliver:{position:'absolute',height:S6.sliver.height,borderRadius:S6.sliver.radius,backgroundColor:S6.sliver.opaque[0],borderWidth:sliverBoundary.width,borderColor:sliverBoundary.color},facts:{color:'white',fontSize:S6.metaSize,flex:1},brand:{color:'rgba(255,255,255,0.72)',fontWeight:'800'}});

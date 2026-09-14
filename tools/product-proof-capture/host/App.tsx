import React, { useState } from "react";
import { Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EventListCard } from "../../../mingla-business/src/components/event/EventListCard";
import { PublicEventPage } from "../../../mingla-business/src/components/event/PublicEventPage";
import { CAPTURE_SENTINEL } from "../shared/captureIdentity";
import { sampleBrand, sampleLiveEvent } from "./fixtures";

const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnMount: false, refetchOnWindowFocus: false, staleTime: Infinity }, mutations: { retry: false } } });
export default function App() {
  const [open, setOpen] = useState(false);
  return <GestureHandlerRootView style={styles.flex}><SafeAreaProvider><QueryClientProvider client={client}><SafeAreaView style={styles.safe}>
    {open ? <PublicEventPage event={sampleLiveEvent as never} brand={sampleBrand as never} /> : <View style={styles.screen}>
      <View accessibilityLabel={CAPTURE_SENTINEL} style={styles.header}><Text style={styles.kicker}>MINGLA HOST • SAMPLE LISTING</Text><Text style={styles.title}>Your live events</Text><Text style={styles.sub}>See exactly what an Explorer can open from your public link.</Text></View>
      <View style={styles.panel}><EventListCard event={sampleLiveEvent as never} kind="live" brand={sampleBrand as never} status="upcoming" onOpen={() => setOpen(true)} onManageOpen={() => { throw new Error("capture_harness_blocked_mutation"); }} /></View>
      <Pressable accessibilityRole="button" accessibilityLabel="Open sample public page" style={styles.cta} onPress={() => setOpen(true)}><Text style={styles.ctaText}>View sample public page</Text></Pressable>
      <View style={styles.note}><Text style={styles.noteTitle}>Published</Text><Text style={styles.noteBody}>This sample listing is visible in the real public-page component.</Text></View>
    </View>}
  </SafeAreaView></QueryClientProvider></SafeAreaProvider></GestureHandlerRootView>;
}
const styles=StyleSheet.create({flex:{flex:1},safe:{flex:1,backgroundColor:"#0B0B0B"},screen:{flex:1,padding:20},header:{paddingTop:12,paddingBottom:28},kicker:{color:"#EB7825",fontSize:12,fontWeight:"800",letterSpacing:1.4},title:{color:"white",fontSize:34,fontWeight:"900",marginTop:8},sub:{color:"#B4B4B4",fontSize:16,lineHeight:23,marginTop:8},panel:{backgroundColor:"#171717",borderRadius:24,padding:10,overflow:"hidden"},cta:{marginTop:18,backgroundColor:"#EB7825",borderRadius:999,paddingVertical:16,alignItems:"center"},ctaText:{color:"#111",fontSize:16,fontWeight:"900"},note:{marginTop:28,borderTopWidth:1,borderColor:"#333",paddingTop:20},noteTitle:{color:"#6FCF97",fontWeight:"800",fontSize:14},noteBody:{color:"#B4B4B4",marginTop:8,lineHeight:21}});

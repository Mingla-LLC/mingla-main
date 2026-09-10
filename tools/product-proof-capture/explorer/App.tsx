import React, { useState } from "react";
import { Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../../app-mobile/src/i18n";
import SavedTab from "../../../app-mobile/src/components/activity/SavedTab";
import { BoardDiscussionTab } from "../../../app-mobile/src/components/board/BoardDiscussionTab";
import { RsvpPassSheet } from "../../../app-mobile/src/components/activity/RsvpPassSheet";
import { ToastProvider } from "../../../app-mobile/src/components/ToastManager";
import { UnifiedShareProvider } from "../../../app-mobile/src/components/share/UnifiedShareProvider";
import { CAPTURE_SENTINEL } from "../shared/captureIdentity";
import { sampleParticipants, sampleRsvpRow, sampleSavedCard } from "./fixtures";

type Scene = "saved" | "collaboration" | "rsvp";
const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnMount: false, refetchOnWindowFocus: false, staleTime: Infinity }, mutations: { retry: false } } });

export default function App() {
  const [scene, setScene] = useState<Scene>("saved");
  return <GestureHandlerRootView style={styles.flex}><SafeAreaProvider><QueryClientProvider client={client}><ToastProvider><UnifiedShareProvider><SafeAreaView style={styles.safe}>
    <View accessibilityLabel={CAPTURE_SENTINEL} style={styles.header}><Text style={styles.kicker}>MINGLA • SAMPLE PLAN</Text><Text style={styles.title}>{scene === "saved" ? "Saved for later" : scene === "collaboration" ? "Plan together" : "Your RSVP pass"}</Text></View>
    <View style={styles.tabs}>{(["saved","collaboration","rsvp"] as Scene[]).map(item => <Pressable key={item} accessibilityRole="button" accessibilityLabel={`Show ${item} sample`} onPress={() => setScene(item)} style={[styles.tab, scene===item && styles.tabActive]}><Text style={[styles.tabText, scene===item && styles.tabTextActive]}>{item === "rsvp" ? "RSVP" : item[0].toUpperCase()+item.slice(1)}</Text></Pressable>)}</View>
    <View style={styles.body}>
      {scene === "saved" ? <SavedTab savedCards={[sampleSavedCard]} calendarEntries={[]} onScheduleFromSaved={() => { throw new Error("capture_harness_blocked_mutation"); }} onPurchaseFromSaved={() => { throw new Error("capture_harness_blocked_checkout"); }} onShareCard={() => { throw new Error("capture_harness_blocked_share"); }} accountPreferences={{currency:"USD",measurementSystem:"Imperial"}} /> : null}
      {scene === "collaboration" ? <BoardDiscussionTab sessionId="sample-session-3176" participants={sampleParticipants as never} savedCards={[{id:sampleSavedCard.id,card_data:sampleSavedCard}]} /> : null}
      {scene === "rsvp" ? <><View style={styles.rsvpBackdrop}><Text style={styles.rsvpBackdropTitle}>Going</Text><Text style={styles.rsvpBackdropText}>Your confirmed sample plans appear here.</Text></View><RsvpPassSheet visible onClose={() => setScene("saved")} row={sampleRsvpRow} /></> : null}
    </View>
  </SafeAreaView></UnifiedShareProvider></ToastProvider></QueryClientProvider></SafeAreaProvider></GestureHandlerRootView>;
}
const styles=StyleSheet.create({flex:{flex:1},safe:{flex:1,backgroundColor:"#090909"},header:{paddingHorizontal:20,paddingTop:12,paddingBottom:8},kicker:{color:"#EB7825",fontSize:12,fontWeight:"800",letterSpacing:1.4},title:{color:"white",fontSize:30,fontWeight:"900",marginTop:4},tabs:{flexDirection:"row",padding:12,gap:8},tab:{flex:1,paddingVertical:10,borderRadius:999,backgroundColor:"#242424",alignItems:"center"},tabActive:{backgroundColor:"#EB7825"},tabText:{color:"#BDBDBD",fontWeight:"700",fontSize:12},tabTextActive:{color:"#111"},body:{flex:1,backgroundColor:"#111",overflow:"hidden"},rsvpBackdrop:{padding:24},rsvpBackdropTitle:{color:"white",fontSize:24,fontWeight:"800"},rsvpBackdropText:{color:"#aaa",marginTop:8}});

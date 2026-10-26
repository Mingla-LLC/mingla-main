import React, { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "../../../src/components/ui/Button";
import { GlassCard } from "../../../src/components/ui/GlassCard";
import { chooseAndUploadCreatorShowcase } from "../../../src/services/creatorMediaService";
import { accent, canvas, glass, radius, spacing, text as textTokens } from "../../../src/constants/designSystem";
import { ProgramBackBar } from "../../../src/components/programs/ProgramBackBar";

export default function CreatorShowcaseUploadScreen(): React.ReactElement {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [complete, setComplete] = useState(false);
  const upload = async () => {
    setBusy(true); setProgress(0);
    try {
      const result = await chooseAndUploadCreatorShowcase(setProgress);
      setComplete(true);
      Alert.alert("Showcase uploaded", result.aspectWarning ? "It is processing. It may need a more vertical crop before hosts can see it." : "It is processing securely. We’ll mark this step complete when it is ready.");
    } catch (error) {
      if (error instanceof Error && error.message === "No video selected.") return;
      Alert.alert("Couldn’t upload", error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  };
  return <SafeAreaView style={styles.safe} edges={["top","bottom"]}>
    <Stack.Screen options={{ headerShown: false }} /><ProgramBackBar title="Showcase video" fallback="/creator/setup" />
    <View style={styles.page}>
      <Text style={styles.eyebrow}>SHOWCASE</Text>
      <Text style={styles.heading}>One strong sample is enough.</Text>
      <Text style={styles.lede}>Choose a vertical video up to 90 seconds and 150 MB. It stays private during review and your original is removed after processing.</Text>
      <GlassCard style={styles.card}>
        <Text style={styles.rule}>• 9:16 vertical works best</Text><Text style={styles.rule}>• MP4 or a standard phone video</Text><Text style={styles.rule}>• No brand contact details in the clip</Text>
        {(busy || complete) && <View style={styles.track}><View style={[styles.fill,{width:`${Math.max(4,Math.round(progress*100))}%`}]} /></View>}
        <Text style={styles.state}>{complete ? "Uploaded — processing securely" : busy ? `Uploading ${Math.round(progress*100)}%` : "Your video has not been uploaded yet."}</Text>
        <Button fullWidth loading={busy} label={complete ? "Choose a replacement" : "Choose video"} onPress={() => void upload()} />
        {complete && <Button fullWidth variant="secondary" label="Back to readiness" onPress={() => router.replace("/creator/setup" as never)} />}
      </GlassCard>
    </View>
  </SafeAreaView>;
}
const styles=StyleSheet.create({
  safe:{flex:1,backgroundColor:canvas.profile},page:{flex:1,padding:spacing.lg,gap:spacing.md,maxWidth:720,width:"100%",alignSelf:"center"},eyebrow:{color:accent.warm,fontSize:12,fontWeight:"900",letterSpacing:1.6},heading:{color:textTokens.primary,fontSize:34,lineHeight:40,fontWeight:"900"},lede:{color:textTokens.secondary,fontSize:16,lineHeight:24},card:{padding:spacing.lg,gap:spacing.md},rule:{color:textTokens.primary,fontSize:15},track:{height:10,borderRadius:radius.full,backgroundColor:glass.tint.chrome.idle,overflow:"hidden"},fill:{height:10,backgroundColor:accent.warm,borderRadius:radius.full},state:{color:textTokens.secondary,fontSize:14},
});

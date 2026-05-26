// ORCH-0978 — PoC measurement screen for react-native-compressor performance.
// THROWAWAY: delete this file after PoC numbers are captured + reported.
// Reached by deep-link or by navigating to /compression-poc in the dev client.
// See Mingla_Artifacts/POC_ORCH-0978_COMPRESSION_RUNBOOK.md for run procedure.

import { useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { Video as VideoCompressor } from "react-native-compressor";
import { useVideoPlayer, VideoView } from "expo-video";

type Measurement = {
  sourceUri: string;
  sourceBytes: number;
  outputUri: string;
  outputBytes: number;
  elapsedMs: number;
  progressSamples: number;
};

export default function CompressionPocScreen() {
  const [measurement, setMeasurement] = useState<Measurement | null>(null);
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(false);

  const runTest = async (): Promise<void> => {
    setMeasurement(null);
    setProgress(0);
    setRunning(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Permission required", "Grant photo library access to run the PoC.");
        return;
      }
      const pickResult = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        allowsEditing: false,
        videoQuality: 1,
      });
      if (pickResult.canceled || pickResult.assets.length === 0) return;

      const sourceUri = pickResult.assets[0].uri;
      const sourceInfo = await FileSystem.getInfoAsync(sourceUri, { size: true });
      const sourceBytes = "size" in sourceInfo && typeof sourceInfo.size === "number"
        ? sourceInfo.size
        : 0;

      let samples = 0;
      const startedAt = Date.now();
      const outputUri = await VideoCompressor.compress(
        sourceUri,
        { compressionMethod: "auto" },
        (raw: number) => {
          samples += 1;
          setProgress(Math.round(raw * 100));
        },
      );
      const elapsedMs = Date.now() - startedAt;
      const outputInfo = await FileSystem.getInfoAsync(outputUri, { size: true });
      const outputBytes = "size" in outputInfo && typeof outputInfo.size === "number"
        ? outputInfo.size
        : 0;

      const result: Measurement = {
        sourceUri,
        sourceBytes,
        outputUri,
        outputBytes,
        elapsedMs,
        progressSamples: samples,
      };
      setMeasurement(result);

      console.log(
        "[ORCH-0978-POC]",
        JSON.stringify({
          platform: Platform.OS,
          sourceMB: (sourceBytes / 1024 / 1024).toFixed(2),
          outputMB: (outputBytes / 1024 / 1024).toFixed(2),
          ratioPercent:
            sourceBytes > 0 ? ((outputBytes / sourceBytes) * 100).toFixed(1) : "0",
          elapsedSeconds: (elapsedMs / 1000).toFixed(2),
          progressSampleCount: samples,
        }),
      );
    } catch (error) {
      Alert.alert(
        "Compression failed",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setRunning(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>ORCH-0978 Compression PoC</Text>
      <Text style={styles.subtitle}>
        react-native-compressor "auto" preset — measures real-device performance against the
        SPEC's 5–15s assumption.
      </Text>

      <Pressable
        accessibilityRole="button"
        style={[styles.button, running ? styles.buttonDisabled : null]}
        disabled={running}
        onPress={runTest}
      >
        <Text style={styles.buttonText}>
          {running ? `Compressing... ${progress}%` : "Pick video + measure"}
        </Text>
      </Pressable>

      {measurement !== null ? (
        <View style={styles.results}>
          <Row label="Platform" value={Platform.OS} />
          <Row label="Source size" value={formatMB(measurement.sourceBytes)} />
          <Row label="Output size" value={formatMB(measurement.outputBytes)} />
          <Row
            label="Compression ratio"
            value={`${((measurement.outputBytes / measurement.sourceBytes) * 100).toFixed(1)}%`}
          />
          <Row
            label="Elapsed time"
            value={`${(measurement.elapsedMs / 1000).toFixed(2)} s`}
          />
          <Row label="Progress samples" value={String(measurement.progressSamples)} />

          <Text style={styles.sectionLabel}>Source video (playback)</Text>
          <PocVideo uri={measurement.sourceUri} />
          <Text style={styles.sectionLabel}>Compressed output (playback)</Text>
          <PocVideo uri={measurement.outputUri} />

          <Text style={styles.qualityPrompt}>
            Quality check: does the compressed output look indistinguishable from the source?
            Note same/worse in your report.
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

type RowProps = { label: string; value: string };

const Row = ({ label, value }: RowProps): JSX.Element => (
  <View style={styles.row}>
    <Text style={styles.rowLabel}>{label}</Text>
    <Text style={styles.rowValue}>{value}</Text>
  </View>
);

type PocVideoProps = { uri: string };

const PocVideo = ({ uri }: PocVideoProps): JSX.Element => {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = false;
    p.play();
  });
  return (
    <VideoView
      player={player}
      style={styles.video}
      contentFit="contain"
      nativeControls
    />
  );
};

const formatMB = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

const styles = StyleSheet.create({
  container: { padding: 20, gap: 16 },
  title: { fontSize: 22, fontWeight: "700" },
  subtitle: { fontSize: 13, color: "#666" },
  button: {
    backgroundColor: "#007AFF",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "white", fontSize: 16, fontWeight: "600" },
  results: { gap: 12, marginTop: 8 },
  row: { flexDirection: "row", justifyContent: "space-between" },
  rowLabel: { color: "#666" },
  rowValue: { fontWeight: "600", fontVariant: ["tabular-nums"] },
  sectionLabel: { fontSize: 14, fontWeight: "600", marginTop: 12 },
  video: {
    width: "100%",
    height: 220,
    backgroundColor: "#000",
    borderRadius: 8,
  },
  qualityPrompt: {
    fontSize: 13,
    color: "#666",
    marginTop: 12,
    fontStyle: "italic",
  },
});

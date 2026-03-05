import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  Alert,
  ActivityIndicator,
  Animated,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Audio } from "expo-av";
import * as Haptics from "expo-haptics";
import { PersonAudioClip, MAX_AUDIO_CLIPS, MAX_CLIP_DURATION_SECONDS } from "../types/personAudio";
import { startRecording, stopRecording, pickAudioFile } from "../services/personAudioService";
import { s } from "../utils/responsive";

interface AudioDescriptionManagerProps {
  personId: string;
  userId: string;
  clips: PersonAudioClip[];
  onClipsChange: (clips: PersonAudioClip[]) => void;
  maxClips?: number;
  editable?: boolean;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function AudioDescriptionManager({
  personId,
  userId,
  clips,
  onClipsChange,
  maxClips = MAX_AUDIO_CLIPS,
  editable = true,
}: AudioDescriptionManagerProps) {
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [playingClipId, setPlayingClipId] = useState<string | null>(null);
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const durationInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const maxReached = clips.length >= maxClips;

  // Pulse animation for recording
  useEffect(() => {
    if (isRecording) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.15,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isRecording, pulseAnim]);

  // Cleanup sound on unmount
  useEffect(() => {
    return () => {
      if (sound) {
        sound.unloadAsync();
      }
      if (durationInterval.current) {
        clearInterval(durationInterval.current);
      }
    };
  }, [sound]);

  const handleStopRecording = useCallback(async () => {
    const currentRecording = recordingRef.current;
    if (!currentRecording) return;

    try {
      if (durationInterval.current) {
        clearInterval(durationInterval.current);
        durationInterval.current = null;
      }

      const result = await stopRecording(currentRecording);
      recordingRef.current = null;
      setRecording(null);
      setIsRecording(false);

      const tempClip: PersonAudioClip = {
        id: `temp_${Date.now()}`,
        personId: personId || "",
        userId,
        storagePath: "",
        fileName: `recording_${Date.now()}.m4a`,
        durationSeconds: result.durationSeconds || recordingDuration,
        sortOrder: clips.length,
        createdAt: new Date().toISOString(),
        localUri: result.uri,
      };

      onClipsChange([...clips, tempClip]);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (err: any) {
      recordingRef.current = null;
      setRecording(null);
      setIsRecording(false);
      Alert.alert("Recording Error", err.message || "Could not stop recording");
    }
  }, [personId, userId, clips, onClipsChange, recordingDuration]);

  const handleStartRecording = useCallback(async () => {
    if (maxReached || !editable) return;

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const rec = await startRecording();
      recordingRef.current = rec;
      setRecording(rec);
      setIsRecording(true);
      setRecordingDuration(0);

      durationInterval.current = setInterval(() => {
        setRecordingDuration((prev) => {
          if (prev + 1 >= MAX_CLIP_DURATION_SECONDS) {
            handleStopRecording();
            return prev;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (err: any) {
      Alert.alert("Recording Error", err.message || "Could not start recording");
    }
  }, [maxReached, editable, handleStopRecording]);

  const handleToggleRecording = useCallback(() => {
    if (isRecording) {
      handleStopRecording();
    } else {
      handleStartRecording();
    }
  }, [isRecording, handleStopRecording, handleStartRecording]);

  const handlePickFile = useCallback(async () => {
    if (maxReached || !editable) return;

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setIsUploading(true);
      const result = await pickAudioFile();

      if (result) {
        const tempClip: PersonAudioClip = {
          id: `temp_${Date.now()}`,
          personId: personId || "",
          userId,
          storagePath: "",
          fileName: result.fileName,
          durationSeconds: result.durationSeconds,
          sortOrder: clips.length,
          createdAt: new Date().toISOString(),
          localUri: result.uri,
        };

        onClipsChange([...clips, tempClip]);
      }
    } catch (err: any) {
      Alert.alert("File Error", err.message || "Could not pick audio file");
    } finally {
      setIsUploading(false);
    }
  }, [maxReached, editable, personId, userId, clips, onClipsChange]);

  const handleDeleteClip = useCallback(
    (clipId: string) => {
      Alert.alert("Delete Recording", "Are you sure you want to delete this recording?", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            const updated = clips.filter((c) => c.id !== clipId);
            onClipsChange(updated);
          },
        },
      ]);
    },
    [clips, onClipsChange]
  );

  const handlePlayPause = useCallback(
    async (clip: PersonAudioClip) => {
      try {
        // If same clip is playing, pause it
        if (playingClipId === clip.id && sound) {
          await sound.pauseAsync();
          setPlayingClipId(null);
          return;
        }

        // Unload previous sound
        if (sound) {
          await sound.unloadAsync();
          setSound(null);
        }

        const uri = clip.signedUrl || clip.localUri;
        if (!uri) {
          Alert.alert("Playback Error", "No audio source available");
          return;
        }

        const { sound: newSound } = await Audio.Sound.createAsync(
          { uri },
          { shouldPlay: true }
        );

        newSound.setOnPlaybackStatusUpdate((status) => {
          if (status.isLoaded && status.didJustFinish) {
            setPlayingClipId(null);
            newSound.unloadAsync();
            setSound(null);
          }
        });

        setSound(newSound);
        setPlayingClipId(clip.id);
      } catch (err: any) {
        Alert.alert("Playback Error", err.message || "Could not play audio");
        setPlayingClipId(null);
      }
    },
    [playingClipId, sound]
  );

  const renderClipItem = useCallback(
    ({ item }: { item: PersonAudioClip }) => (
      <View style={styles.clipRow}>
        <TouchableOpacity
          style={styles.playButton}
          onPress={() => handlePlayPause(item)}
          activeOpacity={0.7}
        >
          <Ionicons
            name={playingClipId === item.id ? "pause-circle" : "play-circle"}
            size={s(36)}
            color="#eb7825"
          />
        </TouchableOpacity>
        <View style={styles.clipInfo}>
          <Text style={styles.clipDuration}>{formatDuration(item.durationSeconds)}</Text>
          <Text style={styles.clipName} numberOfLines={1}>
            {item.fileName}
          </Text>
        </View>
        {editable && (
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={() => handleDeleteClip(item.id)}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="trash-outline" size={s(20)} color="#ef4444" />
          </TouchableOpacity>
        )}
      </View>
    ),
    [playingClipId, editable, handlePlayPause, handleDeleteClip]
  );

  return (
    <View style={styles.container}>
      <Text style={styles.sectionLabel}>Voice Descriptions</Text>
      <Text style={styles.sectionHint}>
        Record voice notes describing this person to improve recommendations.
      </Text>

      {/* Action buttons */}
      {editable && (
        <View style={styles.actionRow}>
          <Animated.View style={{ transform: [{ scale: isRecording ? pulseAnim : 1 }] }}>
            <TouchableOpacity
              style={[
                styles.recordButton,
                isRecording && styles.recordButtonActive,
                maxReached && styles.buttonDisabled,
              ]}
              onPress={handleToggleRecording}
              activeOpacity={0.7}
              disabled={maxReached && !isRecording}
            >
              <Ionicons
                name={isRecording ? "stop" : "mic-outline"}
                size={s(24)}
                color={isRecording ? "#ffffff" : maxReached ? "#6b7280" : "#eb7825"}
              />
            </TouchableOpacity>
          </Animated.View>

          {isRecording && (
            <View style={styles.recordingIndicator}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingTimer}>{formatDuration(recordingDuration)}</Text>
            </View>
          )}

          {!isRecording && (
            <TouchableOpacity
              style={[styles.uploadButton, maxReached && styles.buttonDisabled]}
              onPress={handlePickFile}
              activeOpacity={0.7}
              disabled={maxReached || isUploading}
            >
              {isUploading ? (
                <ActivityIndicator size="small" color="#eb7825" />
              ) : (
                <Ionicons
                  name="document-outline"
                  size={s(24)}
                  color={maxReached ? "#6b7280" : "#eb7825"}
                />
              )}
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Clip list */}
      {clips.length > 0 && (
        <FlatList
          data={clips}
          keyExtractor={(item) => item.id}
          renderItem={renderClipItem}
          scrollEnabled={false}
          style={styles.clipList}
        />
      )}

      {/* Counter */}
      <Text style={[styles.counterText, maxReached && styles.counterTextMax]}>
        {maxReached ? "Maximum reached" : `${clips.length}/${maxClips} recordings`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: s(16),
  },
  sectionLabel: {
    fontSize: s(14),
    fontWeight: "500",
    color: "#374151",
    marginBottom: s(4),
  },
  sectionHint: {
    fontSize: s(12),
    color: "#6b7280",
    marginBottom: s(12),
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(16),
    marginBottom: s(12),
  },
  recordButton: {
    width: s(56),
    height: s(56),
    borderRadius: s(28),
    backgroundColor: "#1a1a1a",
    borderWidth: 2,
    borderColor: "#eb7825",
    justifyContent: "center",
    alignItems: "center",
  },
  recordButtonActive: {
    backgroundColor: "#ef4444",
    borderColor: "#ef4444",
  },
  uploadButton: {
    width: s(48),
    height: s(48),
    borderRadius: s(24),
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "#2a2a2a",
    justifyContent: "center",
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  recordingIndicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(8),
  },
  recordingDot: {
    width: s(10),
    height: s(10),
    borderRadius: s(5),
    backgroundColor: "#ef4444",
  },
  recordingTimer: {
    fontSize: s(18),
    fontWeight: "600",
    color: "#ef4444",
    fontVariant: ["tabular-nums"],
  },
  clipList: {
    marginBottom: s(8),
  },
  clipRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a1a1a",
    borderRadius: s(12),
    borderWidth: 1,
    borderColor: "#2a2a2a",
    paddingVertical: s(10),
    paddingHorizontal: s(12),
    marginBottom: s(8),
  },
  playButton: {
    marginRight: s(10),
  },
  clipInfo: {
    flex: 1,
  },
  clipDuration: {
    fontSize: s(14),
    fontWeight: "600",
    color: "#ffffff",
  },
  clipName: {
    fontSize: s(11),
    color: "#9ca3af",
    marginTop: s(2),
  },
  deleteButton: {
    padding: s(4),
    marginLeft: s(8),
  },
  counterText: {
    fontSize: s(12),
    color: "#9ca3af",
    textAlign: "center",
  },
  counterTextMax: {
    color: "#ef4444",
  },
});

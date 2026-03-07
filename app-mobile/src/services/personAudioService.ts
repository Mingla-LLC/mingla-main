import { Audio } from "expo-av";
import { supabase } from "./supabase";
import { PersonAudioClip } from "../types/personAudio";

// ── Helpers ─────────────────────────────────────────────────────────────────

function mapAudioClip(row: any, signedUrl?: string): PersonAudioClip {
  return {
    id: row.id,
    personId: row.person_id,
    userId: row.user_id,
    storagePath: row.storage_path,
    fileName: row.file_name,
    durationSeconds: row.duration_seconds,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    signedUrl,
  };
}

// ── Recording ───────────────────────────────────────────────────────────────

export async function startRecording(): Promise<Audio.Recording> {
  const { status } = await Audio.requestPermissionsAsync();
  if (status !== "granted") {
    throw new Error("Microphone permission denied");
  }

  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
  });

  const recording = new Audio.Recording();

  await recording.prepareToRecordAsync({
    isMeteringEnabled: true,
    android: {
      extension: ".m4a",
      outputFormat: Audio.AndroidOutputFormat.MPEG_4,
      audioEncoder: Audio.AndroidAudioEncoder.AAC,
      sampleRate: 44100,
      numberOfChannels: 1,
      bitRate: 128000,
    },
    ios: {
      extension: ".m4a",
      audioQuality: Audio.IOSAudioQuality.HIGH,
      sampleRate: 44100,
      numberOfChannels: 1,
      bitRate: 128000,
      outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
    },
    web: {},
  });

  await recording.startAsync();
  return recording;
}

export async function stopRecording(
  recording: Audio.Recording
): Promise<{ uri: string; durationSeconds: number }> {
  const status = await recording.getStatusAsync();
  await recording.stopAndUnloadAsync();

  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
  });

  const uri = recording.getURI();
  if (!uri) {
    throw new Error("Recording URI is null after stopping");
  }

  const durationSeconds = Math.round((status.durationMillis || 0) / 1000);

  return { uri, durationSeconds };
}

// ── Upload & Delete ─────────────────────────────────────────────────────────

export async function uploadAudioClip(
  userId: string,
  personId: string,
  localUri: string,
  fileName: string,
  durationSeconds: number,
  sortOrder: number
): Promise<PersonAudioClip> {
  const storagePath = `${userId}/person-audio/${personId}/${fileName}`;

  // Upload to Supabase Storage
  const formData = new FormData();
  formData.append("file", {
    uri: localUri,
    type: "audio/mp4",
    name: fileName,
  } as any);

  const { error: uploadError } = await supabase.storage
    .from("voice-reviews")
    .upload(storagePath, formData, {
      contentType: "audio/mp4",
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`Failed to upload audio clip: ${uploadError.message}`);
  }

  // Insert DB record
  const { data, error: insertError } = await supabase
    .from("person_audio_clips")
    .insert({
      person_id: personId,
      user_id: userId,
      storage_path: storagePath,
      file_name: fileName,
      duration_seconds: durationSeconds,
      sort_order: sortOrder,
    })
    .select()
    .single();

  if (insertError || !data) {
    throw new Error(
      `Failed to save audio clip record: ${insertError?.message || "No data returned"}`
    );
  }

  return mapAudioClip(data);
}

export async function deleteAudioClip(
  clipId: string,
  storagePath: string
): Promise<void> {
  const { error: storageError } = await supabase.storage
    .from("voice-reviews")
    .remove([storagePath]);

  if (storageError) {
    console.error("[PersonAudio] Storage delete error:", storageError.message);
  }

  const { error: dbError } = await supabase
    .from("person_audio_clips")
    .delete()
    .eq("id", clipId);

  if (dbError) throw new Error(dbError.message);
}

// ── Fetch Clips ─────────────────────────────────────────────────────────────

export async function getAudioClips(
  personId: string
): Promise<PersonAudioClip[]> {
  const { data, error } = await supabase
    .from("person_audio_clips")
    .select("*")
    .eq("person_id", personId)
    .order("sort_order");

  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return [];

  // Generate signed URLs for each clip
  const clips = await Promise.all(
    data.map(async (row: any) => {
      const { data: signedData } = await supabase.storage
        .from("voice-reviews")
        .createSignedUrl(row.storage_path, 3600);

      return mapAudioClip(row, signedData?.signedUrl);
    })
  );

  return clips;
}

// ── Onboarding Staging (eager upload before saved_person exists) ─────────────

/**
 * Upload a recording to staging storage so it survives app restarts.
 * Returns the storage path (not a URL — use getSignedAudioUrl to play).
 */
export async function uploadOnboardingAudio(
  userId: string,
  key: string,
  localUri: string
): Promise<string> {
  // Sanitize key for storage paths — E.164 phone numbers contain "+" which
  // gets URL-encoded differently across HTTP implementations and can cause
  // RLS policy failures or path mismatches.
  const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
  const storagePath = `${userId}/onboarding-audio/${safeKey}.m4a`;

  const formData = new FormData();
  formData.append("file", {
    uri: localUri,
    type: "audio/mp4",
    name: `${safeKey}.m4a`,
  } as any);

  const { error } = await supabase.storage
    .from("voice-reviews")
    .upload(storagePath, formData, {
      contentType: "audio/mp4",
      upsert: true,
    });

  if (error) {
    throw new Error(`Failed to upload onboarding audio: ${error.message}`);
  }

  return storagePath;
}

/**
 * Delete a file from the voice-reviews bucket (used when re-recording or clearing).
 */
export async function deleteFromStorage(storagePath: string): Promise<void> {
  const { error } = await supabase.storage
    .from("voice-reviews")
    .remove([storagePath]);

  if (error) {
    console.error("[PersonAudio] Storage delete error:", error.message);
  }
}

/**
 * Create a person_audio_clips DB record pointing to an already-uploaded file.
 * Used when the file was eagerly uploaded during onboarding.
 */
export async function createAudioClipRecord(
  userId: string,
  personId: string,
  storagePath: string,
  fileName: string,
  durationSeconds: number,
  sortOrder: number
): Promise<PersonAudioClip> {
  const { data, error } = await supabase
    .from("person_audio_clips")
    .insert({
      person_id: personId,
      user_id: userId,
      storage_path: storagePath,
      file_name: fileName,
      duration_seconds: durationSeconds,
      sort_order: sortOrder,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to save audio clip record: ${error?.message || "No data returned"}`
    );
  }

  return mapAudioClip(data);
}

/**
 * Get a signed URL for playback of a file already in storage.
 */
export async function getSignedAudioUrl(
  storagePath: string
): Promise<string | null> {
  const { data } = await supabase.storage
    .from("voice-reviews")
    .createSignedUrl(storagePath, 3600);

  return data?.signedUrl || null;
}

// ── File Picker ─────────────────────────────────────────────────────────────

export async function pickAudioFile(): Promise<{
  uri: string;
  fileName: string;
  durationSeconds: number;
} | null> {
  const DocumentPicker = await import("expo-document-picker");
  const result = await DocumentPicker.getDocumentAsync({
    type: "audio/*",
    copyToCacheDirectory: true,
  });

  if (result.canceled || !result.assets || result.assets.length === 0) {
    return null;
  }

  const asset = result.assets[0];
  const uri = asset.uri;
  const fileName = asset.name || `audio_${Date.now()}.m4a`;

  // Load with Audio.Sound to get duration
  let durationSeconds = 0;
  try {
    const { sound, status } = await Audio.Sound.createAsync({ uri });
    if (status.isLoaded && status.durationMillis) {
      durationSeconds = Math.round(status.durationMillis / 1000);
    }
    await sound.unloadAsync();
  } catch (err) {
    console.error("[PersonAudio] Error reading audio duration:", err);
  }

  return { uri, fileName, durationSeconds };
}

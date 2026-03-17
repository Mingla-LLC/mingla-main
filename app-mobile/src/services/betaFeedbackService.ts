import { Audio } from 'expo-av';
import { supabase } from './supabase';
import { extractFunctionError } from '../utils/edgeFunctionError';

// ── Types ───────────────────────────────────────────────────────────────────

export type FeedbackCategory = 'bug' | 'feature_request' | 'ux_issue' | 'general';

export interface SubmitFeedbackRequest {
  category: FeedbackCategory;
  audio_path: string;
  audio_duration_ms: number;
  device_os: string;
  device_os_version: string;
  device_model: string;
  app_version: string;
  screen_before: string;
  session_duration_ms: number;
  latitude?: number;
  longitude?: number;
}

export interface BetaFeedback {
  id: string;
  user_id: string;
  category: FeedbackCategory;
  audio_path: string;
  audio_url: string | null;
  audio_duration_ms: number;
  user_display_name: string | null;
  user_email: string | null;
  user_phone: string | null;
  device_os: string;
  device_os_version: string | null;
  device_model: string | null;
  app_version: string;
  screen_before: string | null;
  session_duration_ms: number | null;
  latitude: number | null;
  longitude: number | null;
  admin_notes: string | null;
  status: 'new' | 'reviewed' | 'actioned' | 'dismissed';
  created_at: string;
  updated_at: string;
}

/**
 * React Native's FormData.append() accepts a non-standard object shape
 * with { uri, type, name } instead of a Blob. TypeScript's DOM lib doesn't
 * know about this, so we declare the shape explicitly to avoid `as any`.
 */
interface RNFormDataBlob {
  uri: string;
  type: string;
  name: string;
}

// ── Constants ───────────────────────────────────────────────────────────────

export const MAX_FEEDBACK_DURATION_MS = 300_000; // 5 minutes
export const MIN_FEEDBACK_DURATION_MS = 3_000;   // 3 seconds
const SIGNED_URL_EXPIRY_SECONDS = 3600;          // 1 hour

// ── FeedbackRecorder Class ──────────────────────────────────────────────────

class FeedbackRecorder {
  private recording: Audio.Recording | null = null;
  private permissionGranted = false;
  private startTime: number = 0;

  async initialize(): Promise<boolean> {
    try {
      const { status } = await Audio.requestPermissionsAsync();

      if (status !== 'granted') {
        console.warn('[BetaFeedback] Microphone permission denied');
        this.permissionGranted = false;
        return false;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      this.permissionGranted = true;
      return true;
    } catch (error) {
      console.error('[BetaFeedback] Error initializing recorder:', error);
      this.permissionGranted = false;
      return false;
    }
  }

  async startRecording(): Promise<boolean> {
    if (this.recording) {
      console.warn('[BetaFeedback] Already recording');
      return false;
    }

    if (!this.permissionGranted) {
      const granted = await this.initialize();
      if (!granted) return false;
    }

    try {
      const newRecording = new Audio.Recording();

      await newRecording.prepareToRecordAsync({
        isMeteringEnabled: true,
        android: {
          extension: '.m4a',
          outputFormat: Audio.AndroidOutputFormat.MPEG_4,
          audioEncoder: Audio.AndroidAudioEncoder.AAC,
          sampleRate: 44100,
          numberOfChannels: 1,
          bitRate: 128000,
        },
        ios: {
          extension: '.m4a',
          audioQuality: Audio.IOSAudioQuality.HIGH,
          sampleRate: 44100,
          numberOfChannels: 1,
          bitRate: 128000,
          outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
        },
        web: {},
      });

      await newRecording.startAsync();
      this.recording = newRecording;
      this.startTime = Date.now();
      return true;
    } catch (error) {
      console.error('[BetaFeedback] Error starting recording:', error);
      this.recording = null;
      return false;
    }
  }

  async stopRecording(): Promise<{ uri: string; durationMs: number } | null> {
    if (!this.recording) {
      console.warn('[BetaFeedback] No active recording to stop');
      return null;
    }

    try {
      const status = await this.recording.getStatusAsync();
      await this.recording.stopAndUnloadAsync();

      const uri = this.recording.getURI();

      // Reset audio mode so playback works normally after recording
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

      this.recording = null;

      if (!uri) {
        console.error('[BetaFeedback] Recording URI is null after stopping');
        return null;
      }

      const durationMs = status.durationMillis || 0;

      return { uri, durationMs };
    } catch (error) {
      console.error('[BetaFeedback] Error stopping recording:', error);
      this.recording = null;
      return null;
    }
  }

  async cancelRecording(): Promise<void> {
    if (!this.recording) return;

    try {
      await this.recording.stopAndUnloadAsync();

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });
    } catch (error) {
      console.error('[BetaFeedback] Error cancelling recording:', error);
    } finally {
      this.recording = null;
      this.startTime = 0;
    }
  }

  getElapsedMs(): number {
    if (!this.recording || this.startTime === 0) return 0;
    return Date.now() - this.startTime;
  }

  isRecording(): boolean {
    return this.recording !== null;
  }
}

// ── Upload Audio ────────────────────────────────────────────────────────────

async function uploadFeedbackAudio(
  userId: string,
  localUri: string,
): Promise<string> {
  const fileName = `feedback_${Date.now()}.m4a`;
  const filePath = `${userId}/${fileName}`;

  const formData = new FormData();
  const blob: RNFormDataBlob = { uri: localUri, type: 'audio/mp4', name: fileName };
  formData.append('file', blob as unknown as Blob);

  const { error: uploadError } = await supabase.storage
    .from('beta-feedback')
    .upload(filePath, formData, {
      contentType: 'audio/mp4',
      upsert: false,
    });

  if (uploadError) {
    console.error('[BetaFeedback] Upload error:', uploadError.message);
    throw new Error(`Failed to upload feedback audio: ${uploadError.message}`);
  }

  return filePath;
}

// ── Submit Feedback ─────────────────────────────────────────────────────────

async function submitFeedback(
  params: SubmitFeedbackRequest,
): Promise<{ feedback_id: string }> {
  const { data, error } = await supabase.functions.invoke('submit-feedback', {
    body: params,
  });

  if (error) {
    const message = await extractFunctionError(error, 'Failed to submit feedback');
    throw new Error(message);
  }

  if (!data?.feedback_id) {
    throw new Error('No feedback ID returned from server');
  }

  return { feedback_id: data.feedback_id };
}

// ── History ─────────────────────────────────────────────────────────────────

async function getUserFeedbackHistory(
  userId: string,
): Promise<BetaFeedback[]> {
  const { data, error } = await supabase
    .from('beta_feedback')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[BetaFeedback] History fetch error:', error.message);
    throw new Error(`Failed to fetch feedback history: ${error.message}`);
  }

  return (data ?? []) as BetaFeedback[];
}

// ── Audio URL ───────────────────────────────────────────────────────────────

async function getFeedbackAudioUrl(
  audioPath: string,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from('beta-feedback')
    .createSignedUrl(audioPath, SIGNED_URL_EXPIRY_SECONDS);

  if (error || !data?.signedUrl) {
    console.error('[BetaFeedback] Signed URL error:', error?.message);
    throw new Error(`Failed to get audio URL: ${error?.message || 'No URL returned'}`);
  }

  return data.signedUrl;
}

// ── Exports ─────────────────────────────────────────────────────────────────

export const feedbackRecorder = new FeedbackRecorder();

export const betaFeedbackService = {
  uploadFeedbackAudio,
  submitFeedback,
  getUserFeedbackHistory,
  getFeedbackAudioUrl,
};

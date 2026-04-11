import { Audio } from 'expo-av';
import { AppState } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
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
  screenshot_paths?: string[];
}

export interface BetaFeedback {
  id: string;
  user_id: string | null;
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
  screenshot_paths: string[] | null;
  screenshot_urls: string[] | null;
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
export const MAX_SCREENSHOTS = 10;
const SIGNED_URL_EXPIRY_SECONDS = 3600;          // 1 hour
const SCREENSHOT_MAX_DIMENSION = 1920;            // px, longest edge
const SCREENSHOT_JPEG_QUALITY = 0.7;

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

    // Guard: don't attempt recording if app isn't in the foreground.
    // The mic permission dialog can briefly push the app to 'inactive',
    // causing prepareToRecordAsync to throw.
    if (AppState.currentState !== 'active') {
      console.warn('[BetaFeedback] Cannot start recording — app is not in active state:', AppState.currentState);
      return false;
    }

    // Always re-check permissions — user may have revoked in iOS Settings
    // since the last recording. requestPermissionsAsync() returns instantly
    // if already granted, so there's no UX cost.
    const granted = await this.initialize();
    if (!granted) return false;

    const newRecording = new Audio.Recording();
    try {
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
      // CRITICAL: Clean up the native Recording object that was created but never
      // fully prepared. Without this, the iOS audio session leaks and stays in
      // recording mode permanently. See INVESTIGATION_FEEDBACK_RECORDING_FREEZE.
      try {
        await newRecording.stopAndUnloadAsync();
      } catch {
        // May throw if never prepared — safe to ignore
      }
      await this.resetAudioMode();
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

  async resetAudioMode(): Promise<void> {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });
    } catch (error) {
      console.warn('[BetaFeedback] Failed to reset audio mode:', error);
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

// ── Screenshot Compression ─────────────────────────────────────────────────

async function compressScreenshot(
  uri: string,
  width: number,
  height: number,
): Promise<{ uri: string; width: number; height: number }> {
  const longest = Math.max(width, height);
  const actions: ImageManipulator.Action[] = [];

  if (longest > SCREENSHOT_MAX_DIMENSION) {
    const scale = SCREENSHOT_MAX_DIMENSION / longest;
    actions.push({
      resize: {
        width: Math.round(width * scale),
        height: Math.round(height * scale),
      },
    });
  }

  const result = await ImageManipulator.manipulateAsync(uri, actions, {
    compress: SCREENSHOT_JPEG_QUALITY,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  return { uri: result.uri, width: result.width, height: result.height };
}

// ── Upload Screenshots ────────────────────────────────────────────────────

async function uploadFeedbackScreenshots(
  userId: string,
  screenshots: Array<{ uri: string; width: number; height: number }>,
): Promise<string[]> {
  const ts = Date.now();

  const uploadOne = async (
    shot: { uri: string; width: number; height: number },
    index: number,
  ): Promise<string> => {
    const compressed = await compressScreenshot(shot.uri, shot.width, shot.height);
    const fileName = `feedback_${ts}_${index}.jpg`;
    const filePath = `${userId}/screenshots/${fileName}`;

    const formData = new FormData();
    const blob: RNFormDataBlob = {
      uri: compressed.uri,
      type: 'image/jpeg',
      name: fileName,
    };
    formData.append('file', blob as unknown as Blob);

    const { error: uploadError } = await supabase.storage
      .from('beta-feedback')
      .upload(filePath, formData, {
        contentType: 'image/jpeg',
        upsert: false,
      });

    if (uploadError) {
      throw new Error(
        `Failed to upload screenshot ${index + 1} of ${screenshots.length}: ${uploadError.message}`,
      );
    }

    return filePath;
  };

  return Promise.all(screenshots.map((shot, i) => uploadOne(shot, i)));
}

// ── Screenshot Signed URLs ────────────────────────────────────────────────

async function getScreenshotSignedUrls(
  paths: string[],
): Promise<string[]> {
  const results = await Promise.all(
    paths.map(async (path) => {
      try {
        const { data, error } = await supabase.storage
          .from('beta-feedback')
          .createSignedUrl(path, SIGNED_URL_EXPIRY_SECONDS);
        if (error || !data?.signedUrl) return '';
        return data.signedUrl;
      } catch {
        return '';
      }
    }),
  );
  return results;
}

// ── Delete Feedback ────────────────────────────────────────────────────────

async function deleteFeedback(
  feedbackId: string,
  audioPath: string,
  screenshotPaths: string[] | null,
): Promise<void> {
  // 1. Delete storage files (best-effort — orphaned files are harmless)
  const allPaths = [audioPath, ...(screenshotPaths ?? [])];
  const { error: storageError } = await supabase.storage
    .from('beta-feedback')
    .remove(allPaths);

  if (storageError) {
    console.warn('[BetaFeedback] Storage cleanup error (non-blocking):', storageError.message);
  }

  // 2. Delete database row (required — must succeed)
  const { error: deleteError } = await supabase
    .from('beta_feedback')
    .delete()
    .eq('id', feedbackId);

  if (deleteError) {
    throw new Error(`Failed to delete feedback: ${deleteError.message}`);
  }
}

// ── Exports ─────────────────────────────────────────────────────────────────

export const feedbackRecorder = new FeedbackRecorder();

export const betaFeedbackService = {
  uploadFeedbackAudio,
  uploadFeedbackScreenshots,
  submitFeedback,
  deleteFeedback,
  getUserFeedbackHistory,
  getFeedbackAudioUrl,
  getScreenshotSignedUrls,
};

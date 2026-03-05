import { Audio } from 'expo-av';
import { supabase } from './supabase';

// ── Types ───────────────────────────────────────────────────────────────────

export interface VoiceClip {
  uri: string;
  durationSeconds: number;
  fileName: string;
}

export interface VoiceReviewSubmission {
  calendarEntryId: string;
  placePoolId?: string;
  googlePlaceId?: string;
  cardId: string;
  placeName: string;
  placeAddress?: string;
  placeCategory?: string;
  rating: number;
  didAttend: boolean;
  audioClips: VoiceClip[];
  feedbackText?: string;
}

export interface VoiceReviewResult {
  reviewId: string;
  audioUrls: string[];
}

// ── Constants ───────────────────────────────────────────────────────────────

export const MAX_CLIP_DURATION_MS = 60_000;
export const MAX_CLIPS = 5;

// ── VoiceReviewRecorder Class ───────────────────────────────────────────────

class VoiceReviewRecorder {
  private recording: Audio.Recording | null = null;
  private permissionGranted = false;

  async initialize(): Promise<boolean> {
    try {
      const { status } = await Audio.requestPermissionsAsync();

      if (status !== 'granted') {
        console.warn('[VoiceReview] Microphone permission denied');
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
      console.error('[VoiceReview] Error initializing recorder:', error);
      this.permissionGranted = false;
      return false;
    }
  }

  async startRecording(): Promise<boolean> {
    if (this.recording) {
      console.warn('[VoiceReview] Already recording');
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
      return true;
    } catch (error) {
      console.error('[VoiceReview] Error starting recording:', error);
      this.recording = null;
      return false;
    }
  }

  async stopRecording(): Promise<VoiceClip | null> {
    if (!this.recording) {
      console.warn('[VoiceReview] No active recording to stop');
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
        console.error('[VoiceReview] Recording URI is null after stopping');
        return null;
      }

      const durationMs = status.durationMillis || 0;
      const durationSeconds = Math.round(durationMs / 100) / 10;
      const fileName = `review_${Date.now()}.m4a`;

      return {
        uri,
        durationSeconds,
        fileName,
      };
    } catch (error) {
      console.error('[VoiceReview] Error stopping recording:', error);
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
      console.error('[VoiceReview] Error cancelling recording:', error);
    } finally {
      this.recording = null;
    }
  }

  isRecording(): boolean {
    return this.recording !== null;
  }
}

// ── Upload Audio Clip ───────────────────────────────────────────────────────

async function uploadAudioClip(
  userId: string,
  clip: VoiceClip,
): Promise<{ filePath: string; signedUrl: string }> {
  const filePath = `${userId}/${clip.fileName}`;

  const formData = new FormData();
  formData.append('file', {
    uri: clip.uri,
    type: 'audio/mp4',
    name: clip.fileName,
  } as any);

  const { error: uploadError } = await supabase.storage
    .from('voice-reviews')
    .upload(filePath, formData, {
      contentType: 'audio/mp4',
      upsert: false,
    });

  if (uploadError) {
    console.error('[VoiceReview] Upload error:', uploadError.message);
    throw new Error(`Failed to upload audio clip: ${uploadError.message}`);
  }

  const { data: signedData, error: signedError } = await supabase.storage
    .from('voice-reviews')
    .createSignedUrl(filePath, 60 * 60 * 24 * 365);

  if (signedError || !signedData?.signedUrl) {
    console.error('[VoiceReview] Signed URL error:', signedError?.message);
    throw new Error(`Failed to get signed URL: ${signedError?.message || 'No URL returned'}`);
  }

  return { filePath, signedUrl: signedData.signedUrl };
}

// ── Submit Voice Review ─────────────────────────────────────────────────────

async function submitVoiceReview(
  userId: string,
  submission: VoiceReviewSubmission,
): Promise<VoiceReviewResult> {
  if (submission.rating < 1 || submission.rating > 5 || !Number.isInteger(submission.rating)) {
    throw new Error('Rating must be an integer between 1 and 5');
  }

  // Store file paths for the DB (edge function reads these to create signed URLs)
  // and signed URLs for the UI (returned in VoiceReviewResult)
  const audioFilePaths: string[] = [];
  const audioSignedUrls: string[] = [];
  const audioDurations: number[] = [];

  if (submission.audioClips.length > 0) {
    const uploadResults = await Promise.all(
      submission.audioClips.map(async (clip) => {
        const { filePath, signedUrl } = await uploadAudioClip(userId, clip);
        return { filePath, signedUrl, durationSeconds: clip.durationSeconds };
      }),
    );

    for (const result of uploadResults) {
      audioFilePaths.push(result.filePath);
      audioSignedUrls.push(result.signedUrl);
      audioDurations.push(result.durationSeconds);
    }
  }

  const { data: review, error: insertError } = await supabase
    .from('place_reviews')
    .insert({
      user_id: userId,
      calendar_entry_id: submission.calendarEntryId,
      place_pool_id: submission.placePoolId || null,
      google_place_id: submission.googlePlaceId || null,
      card_id: submission.cardId,
      place_name: submission.placeName,
      place_address: submission.placeAddress || null,
      place_category: submission.placeCategory || null,
      rating: submission.rating,
      did_attend: submission.didAttend,
      audio_urls: audioFilePaths,
      audio_durations_seconds: audioDurations,
      feedback_text: submission.feedbackText || null,
      processing_status: audioFilePaths.length > 0 ? 'pending' : 'completed',
    })
    .select('id')
    .single();

  if (insertError || !review) {
    console.error('[VoiceReview] Insert error:', insertError?.message);
    throw new Error(`Failed to create review: ${insertError?.message || 'No data returned'}`);
  }

  const { error: calendarError } = await supabase
    .from('calendar_entries')
    .update({
      feedback_status: 'completed',
      review_id: review.id,
      status: 'completed',
    })
    .eq('id', submission.calendarEntryId)
    .eq('user_id', userId);

  if (calendarError) {
    console.error('[VoiceReview] Calendar update error:', calendarError.message);
  }

  if (audioFilePaths.length > 0) {
    supabase.functions
      .invoke('process-voice-review', {
        body: { reviewId: review.id },
      })
      .catch((err: unknown) => {
        console.error('[VoiceReview] Edge function call failed:', err);
      });
  }

  return {
    reviewId: review.id,
    audioUrls: audioSignedUrls,
  };
}

// ── Mark Rescheduled ────────────────────────────────────────────────────────

async function markRescheduled(userId: string, calendarEntryId: string): Promise<void> {
  const { error } = await supabase
    .from('calendar_entries')
    .update({ feedback_status: 'rescheduled' })
    .eq('id', calendarEntryId)
    .eq('user_id', userId);

  if (error) {
    console.error('[VoiceReview] Mark rescheduled error:', error.message);
    throw new Error(`Failed to mark as rescheduled: ${error.message}`);
  }
}

// ── Exports ─────────────────────────────────────────────────────────────────

export const voiceReviewRecorder = new VoiceReviewRecorder();

export const voiceReviewService = {
  submitVoiceReview,
  markRescheduled,
  uploadAudioClip,
};
